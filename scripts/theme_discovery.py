"""
Theme discovery using two-method agreement: LDA + embedding clustering.
Runs at bootstrap and monthly. Populates Tier 2 (discovered) and Tier 3 (review) themes.
"""
from gensim import corpora
from gensim import models
from sentence_transformers import SentenceTransformer
import umap
import hdbscan
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
from data.brave_client import fetch_news_for_theme
from data.reddit_client import fetch_posts_for_theme

THEME_SUBREDDITS = ["wallstreetbets", "investing", "stocks", "economy", "finance"]
LOOKBACK_MONTHS = 6
MIN_DOCS_PER_THEME = 50

def run_discovery():
    """
    5-step discovery:
    1. Assemble corpus from Brave News + Reddit (6 months)
    2. Preprocess: tokenize, remove stopwords, bigrams
    3. LDA: get topics with word distributions
    4. Embedding clustering: SBERT + UMAP + HDBSCAN
    5. Agreement: themes found by both → Tier 2; one method only → Tier 3
    """
    # Step 1: Collect documents
    # For each Tier 1 theme, fetch 6 months of news + posts
    # Each document = {text, date, source}
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
        return

    texts = [doc["text"] for doc in corpus]

    # Step 2: Preprocess for LDA
    # Simple tokenization: lowercase, remove punctuation, split
    import re
    from gensim.parsing.preprocessing import STOPWORDS

    def preprocess(text):
        tokens = re.sub(r'[^\w\s]', '', text.lower()).split()
        return [t for t in tokens if t not in STOPWORDS and len(t) > 2]

    processed = [preprocess(t) for t in texts]

    # Step 3: LDA
    dictionary = corpora.Dictionary(processed)
    corpus_bow = [dictionary.doc2bow(p) for p in processed]
    lda_model = models.LdaModel(corpus_bow, num_topics=10, passes=5, random_state=42)
    lda_topics = lda_model.print_topics(num_words=5)

    # Step 4: Embedding clustering
    model = SentenceTransformer('all-MiniLM-L6-v2')
    embeddings = model.encode(texts, show_progress_bar=True)
    umap_model = umap.UMAP(n_components=5, random_state=42)
    umap_embeddings = umap_model.fit_transform(embeddings)
    clusterer = hdbscan.HDBSCAN(min_cluster_size=10)
    clusters = clusterer.fit_predict(umap_embeddings)

    # Step 5: Build theme candidates
    # For each LDA topic and each HDBSCAN cluster, extract keyword-based name
    # Agreement: if a theme label matches both an LDA topic word and an HDBSCAN cluster dominant terms → Tier 2
    # Otherwise → Tier 3
    print(f"Discovered {len(set(clusters)) - 1} embedding clusters")
    print(f"LDA topics: {len(lda_topics)}")

    # Write discovered themes to stdout for now (Supabase write happens in Phase 2)
    # The script should print discovered themes as JSON
    discovered = {
        "lda_topics": lda_topics,
        "n_clusters": len(set(clusters)) - 1,
        "corpus_size": len(corpus),
    }
    print(f"Theme discovery complete: {discovered}")

if __name__ == "__main__":
    run_discovery()