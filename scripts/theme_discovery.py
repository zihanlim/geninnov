"""
Theme discovery using two-method agreement: LDA + embedding clustering.
Runs at bootstrap and monthly. Populates Tier 2 (both methods agree) and
Tier 3 (single method) candidates.

Previously this script computed LDA topics and HDBSCAN clusters but only printed
counts to stdout — the "agreement" step (§5) was never implemented and nothing
was persisted. It now:
  * derives top-term sets from each method,
  * cross-checks them (agree_themes) → Tier 2 (agreement) / Tier 3 (single),
  * persists candidates to the `discovered_themes` shadow table (migration 021).

Persistence is shadow-mode only: candidates are NOT auto-promoted into the live
`themes` table (RESIDUAL R5) — an operator reviews and promotes them.

The heavy ML (SBERT / UMAP / HDBSCAN / LDA) lives in run_discovery; the
agreement + labelling logic is factored into pure functions that are unit-tested
without the models.
"""
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

from gensim import corpora
from gensim import models
from sentence_transformers import SentenceTransformer
import umap
import hdbscan

# Root at the repo, not backend/, so `backend.*` resolves the same way it does
# everywhere else in the codebase. See the note in scripts/daily_refresh.py.
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.data.brave_client import fetch_news_for_theme
from backend.data.reddit_client import fetch_posts_for_theme

THEME_SUBREDDITS = ["wallstreetbets", "investing", "stocks", "economy", "finance"]
LOOKBACK_MONTHS = 6
MIN_DOCS_PER_THEME = 50

# A small English stop-list on top of gensim's, for term-frequency cluster labels.
_EXTRA_STOP = {"amid", "eyes", "eye", "says", "new", "market", "markets", "week"}


# ─────────────────────────────────────────────────────────────────────────────
# Pure helpers (unit-tested — no models required)
# ─────────────────────────────────────────────────────────────────────────────

def preprocess(text: str) -> list[str]:
    """Lowercase, strip punctuation, drop stopwords + short tokens."""
    from gensim.parsing.preprocessing import STOPWORDS
    tokens = re.sub(r"[^\w\s]", "", (text or "").lower()).split()
    return [t for t in tokens if t not in STOPWORDS and t not in _EXTRA_STOP and len(t) > 2]


def cluster_term_sets(texts: list[str], clusters: list[int], topn: int = 6) -> list[set[str]]:
    """
    Top-``topn`` term set per HDBSCAN cluster (label >= 0; -1 is noise).

    Pure: takes texts + cluster labels, returns one term set per cluster ordered
    by cluster label. Used as the "embedding method" side of the agreement.
    """
    by_cluster: dict[int, Counter] = {}
    for text, cl in zip(texts, clusters):
        if cl is None or cl < 0:
            continue
        by_cluster.setdefault(cl, Counter()).update(preprocess(text))
    out: list[set[str]] = []
    for cl in sorted(by_cluster):
        top = [w for w, _ in by_cluster[cl].most_common(topn)]
        if top:
            out.append(set(top))
    return out


def lda_topic_sets(lda_model, topn: int = 6) -> list[set[str]]:
    """Top-``topn`` word set per LDA topic (thin wrapper over gensim)."""
    sets: list[set[str]] = []
    for _tid, pairs in lda_model.show_topics(num_topics=-1, num_words=topn, formatted=False):
        sets.append({w for w, _ in pairs})
    return sets


def _label_from_terms(terms: list[str], n: int = 3) -> str:
    return " / ".join(list(terms)[:n]) if terms else "unlabelled"


def agree_themes(lda_sets: list[set[str]], cluster_sets: list[set[str]],
                 min_overlap: int = 2) -> dict:
    """
    Two-method agreement.

    A top-term set is promoted to **Tier 2** when an LDA topic and an embedding
    cluster overlap by >= ``min_overlap`` terms (each cluster matches at most one
    topic). Sets with no cross-method match are **Tier 3** (single-method).

    Returns {"tier2": [...], "tier3": [...]}, each item
    {"label", "terms", "methods"}.
    """
    tier2: list[dict] = []
    matched_a: set[int] = set()
    matched_b: set[int] = set()

    for i, a in enumerate(lda_sets):
        best_j, best_ov = None, 0
        for j, b in enumerate(cluster_sets):
            if j in matched_b:
                continue
            ov = len(a & b)
            if ov > best_ov:
                best_ov, best_j = ov, j
        if best_j is not None and best_ov >= min_overlap:
            shared = sorted(lda_sets[i] & cluster_sets[best_j]) or sorted(lda_sets[i])
            tier2.append({"label": _label_from_terms(shared), "terms": shared,
                          "methods": ["lda", "embedding"]})
            matched_a.add(i)
            matched_b.add(best_j)

    tier3: list[dict] = []
    for i, a in enumerate(lda_sets):
        if i not in matched_a:
            terms = sorted(a)
            tier3.append({"label": _label_from_terms(terms), "terms": terms, "methods": ["lda"]})
    for j, b in enumerate(cluster_sets):
        if j not in matched_b:
            terms = sorted(b)
            tier3.append({"label": _label_from_terms(terms), "terms": terms, "methods": ["embedding"]})

    return {"tier2": tier2, "tier3": tier3}


# ─────────────────────────────────────────────────────────────────────────────
# Persistence (shadow table — not auto-promoted; RESIDUAL R5)
# ─────────────────────────────────────────────────────────────────────────────

def persist_discovered_themes(sb, run_date: date, agreement: dict, corpus_size: int) -> int:
    """Upsert Tier 2/3 candidates into `discovered_themes`. Best-effort: logs and
    returns 0 if the table isn't deployed (migration 021)."""
    rows: list[dict] = []
    for tier, key in ((2, "tier2"), (3, "tier3")):
        for item in agreement.get(key, []):
            rows.append({
                "run_date": run_date.isoformat(),
                "label": item["label"],
                "terms": item["terms"],
                "tier": tier,
                "methods": item["methods"],
                "corpus_size": corpus_size,
                "status": "shadow",
            })
    if not rows:
        return 0
    try:
        sb.table("discovered_themes").upsert(rows, on_conflict="run_date,label").execute()
    except Exception as exc:
        print(f"[theme_discovery] discovered_themes upsert failed "
              f"({exc.__class__.__name__}); apply migration 021. Nothing persisted.")
        return 0
    print(f"[theme_discovery] Persisted {len(rows)} shadow candidates "
          f"({len(agreement.get('tier2', []))} Tier 2, {len(agreement.get('tier3', []))} Tier 3).")
    return len(rows)


def _make_supabase():
    """Create a Supabase client from env, or None if not configured."""
    import os
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("[theme_discovery] SUPABASE_URL/SERVICE_KEY not set — skipping persistence.")
        return None
    from supabase import create_client
    return create_client(url, key)


# ─────────────────────────────────────────────────────────────────────────────
# Orchestration
# ─────────────────────────────────────────────────────────────────────────────

def run_discovery(sb=None, run_date: date | None = None) -> dict | None:
    """
    5-step discovery:
    1. Assemble corpus from Brave News + Reddit (6 months)
    2. Preprocess: tokenize, remove stopwords
    3. LDA: topics with word distributions
    4. Embedding clustering: SBERT + UMAP + HDBSCAN
    5. Agreement: both methods → Tier 2; one method → Tier 3 → persist (shadow)
    """
    run_date = run_date or date.today()

    # Step 1: Collect documents — for each Tier 1 theme, 6 months of news + posts.
    corpus = []
    themes_to_scan = [
        "Fed Policy", "Inflation", "China Growth", "US Dollar",
        "Geopolitical Risk", "Corporate Credit", "Energy Prices", "US Election"
    ]
    for theme in themes_to_scan:
        news = fetch_news_for_theme(theme, lookback_days=LOOKBACK_MONTHS * 30)
        posts = fetch_posts_for_theme(theme, lookback_days=LOOKBACK_MONTHS * 30)
        for n in news:
            corpus.append({"text": n["headline"], "date": n.get("date", ""), "source": "brave", "theme": theme})
        for p in posts:
            corpus.append({"text": p["title"], "date": p.get("date", ""), "source": "reddit", "theme": theme})

    if len(corpus) < MIN_DOCS_PER_THEME:
        print(f"Warning: corpus has only {len(corpus)} docs, expected >= {MIN_DOCS_PER_THEME}")
        return None

    texts = [doc["text"] for doc in corpus]

    # Step 2 + 3: Preprocess + LDA
    processed = [preprocess(t) for t in texts]
    dictionary = corpora.Dictionary(processed)
    corpus_bow = [dictionary.doc2bow(p) for p in processed]
    lda_model = models.LdaModel(corpus_bow, num_topics=10, passes=5, random_state=42)
    lda_sets = lda_topic_sets(lda_model, topn=6)

    # Step 4: Embedding clustering
    model = SentenceTransformer("all-MiniLM-L6-v2")
    embeddings = model.encode(texts, show_progress_bar=False)
    umap_embeddings = umap.UMAP(n_components=5, random_state=42).fit_transform(embeddings)
    clusters = hdbscan.HDBSCAN(min_cluster_size=10).fit_predict(umap_embeddings)
    cluster_sets = cluster_term_sets(texts, list(clusters), topn=6)

    # Step 5: Agreement + persist
    agreement = agree_themes(lda_sets, cluster_sets)
    print(f"Theme discovery: {len(agreement['tier2'])} Tier 2 (agreement), "
          f"{len(agreement['tier3'])} Tier 3 (single-method), corpus={len(corpus)}")

    sb = sb or _make_supabase()
    if sb is not None:
        persist_discovered_themes(sb, run_date, agreement, corpus_size=len(corpus))

    return agreement


if __name__ == "__main__":
    run_discovery()
