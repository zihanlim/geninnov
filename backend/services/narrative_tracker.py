"""
L1b: Narrative tracker — which narratives are trending, without being told what
to look for.

WHY THIS EXISTS (ADR-0128)
==========================
Until now every narrative this system could see was named in advance, twice:
eight rows in the `themes` table and eight keyword lists in
`brave_client.THEME_KEYWORDS`. Attention was measured by asking Brave for those
keywords, so a narrative that did not lexically match one of eight lists had no
counter — it was structurally invisible, not merely low-scoring. "AI capex
cycle" is the standing example: no theme, no keyword, no mapped asset, and
therefore a HypeScore of nothing at all rather than a low one.

`theme_discovery.py` was supposed to answer this and cannot, for two reasons the
script's own docstring concedes:

  1. **Its corpus is circular.** It reads `theme_news`, which was collected using
     those same eight keyword queries. It can only surface sub-themes of the
     narratives already named.
  2. **It runs monthly, and it is heavy.** SBERT + UMAP + HDBSCAN + LDA is a
     multi-hundred-megabyte dependency tree that is not installed in CI (import
     of `gensim` fails outright), so the one component meant to find new themes
     does not run in the environment that runs everything else.

This module is the daily counterpart, and it is deliberately the *cheap* method:
document frequency over n-grams, share-of-voice, and a robust velocity against
each phrase's own history. No embeddings, no topic model, no downloads — pandas
and the standard library. That buys three things the heavy method cannot give:

  * it runs **every day**, so a narrative forming over a week is visible on day
    two rather than at the next month boundary;
  * it runs **in CI**, so the logic is tested rather than asserted;
  * it is **deterministic**, so two runs over the same corpus agree exactly —
    which ADR-0013 requires and which HDBSCAN over UMAP does not offer.

It does NOT replace the two-method agreement. Frequency-and-velocity is a weaker
claim than "LDA and embedding clustering independently found this", and the
monthly job stays exactly as it is. This one answers "what is moving today"; that
one answers "what is a coherent theme". Where they agree, the candidate is
stronger — `methods` on the persisted row records which saw it.

WHAT IT IS NOT
==============
This is a **shadow** signal, on the same footing as `discovered_themes`: nothing
here enters the live theme board, sizes a position, or reaches the L5 agent
without an operator promoting it. A phrase trending in the news is evidence that
a narrative exists, not evidence that it is tradeable — the tradeable claim needs
mapped instruments and a measured price link, which is exactly what the anchor
themes have and a fresh phrase does not.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import median


# ─────────────────────────────────────────────────────────────────────────────
# Tokenisation
# ─────────────────────────────────────────────────────────────────────────────

# A LOCAL stoplist, not nltk's and not gensim's. Both need a downloaded corpus at
# import time; a daily job that can fail because a wordlist did not download is a
# worse trade than fifty lines of literal here. It is also auditable: a reader can
# see exactly which words this system refuses to treat as a narrative, which
# matters because a stoplist is a silent editorial decision about what counts.
_STOPWORDS: frozenset[str] = frozenset("""
a about above after again against all also am an and any are aren as at back be
because been before being below between both but by can cannot could couldn did
didn do does doesn doing don down during each few for from further had hadn has
hasn have haven having he her here hers herself him himself his how however i if
in into is isn it its itself just ll me more most must my myself new no nor not
now of off on once only or other ought our ours ourselves out over own re s same
shan she should shouldn so some such t than that the their theirs them themselves
then there these they this those through to too under until up ve very vs was wasn
we were weren what when where which while who whom why will with won would
wouldn you your yours yourself yourselves
""".split())

# NOT stopped, deliberately: "us". In a financial-news corpus it is "US" — as in
# "US dollar", "US election", two of the eight anchor themes — far more often than
# the pronoun, and stopping it silently decapitated both phrases.

# Newswire furniture: words that are frequent in headlines and carry no narrative.
# Kept SEPARATE from the English stoplist above because they are a domain
# judgement, not a grammatical one, and a future reader should be able to argue
# with this list without touching the other.
#
# NOT stopped, deliberately: "data". It reads as furniture ("economic data",
# "data shows") and was stopped until ADR-0129 - which silently destroyed
# "data center", the phrase the entire AI capex buildout is described in. Because
# n-grams are built over the FILTERED token stream, stopping one token removes
# every phrase containing it, so a furniture judgement on a common word can
# delete a theme.
_NEWSWIRE_STOP: frozenset[str] = frozenset("""
analysis breaking briefing bulletin chart close closing daily dow dr eyes
exclusive first friday here highlights how insight investors latest live market
markets monday morning mr news open opening opinion outlook percent points podcast
poll preview quarter read recap report reports reuters roundup said says session
share shares st stock stocks story street summary thursday today tuesday update
updates video watch wednesday week weekly what why wrap year years
january february march april may june july august september october
november december holds forecast forecasts primary times ahead amid set
meeting top wall
""".split())

# `top` and `wall`, added 2026-07-29 after both reached the emerging shortlist on
# the deepened archive (`wall` at 0.208 max share over 6 days, `top` at 0.122 over
# 5). Neither is a narrative, and the reason each is safe to stop is different:
#
#   top   Ordinary furniture, in the same class as `highlights` and `roundup`
#         already here -- "top stocks", "top gainers", "top picks". No phrase worth
#         tracking needs it.
#
#   wall  Looks like the `data` / `data center` trap above, and is its INVERSE.
#         `street` is already stopped (see the list above), so "wall street" can
#         never form as a bigram -- which is why the corpus yields `wall`,
#         `wall drifts` and `wall drifts mixed` from "Wall Street drifts mixed as
#         ...". `wall` is not a fragment competing with a real phrase; it is the
#         residue of one that was already dismantled, and stopping it destroys
#         nothing that could be formed.
#
# The general rule the `data` case establishes still binds: before stopping a
# token, check what n-grams containing it exist in the live corpus. Here that check
# is what showed "wall street" was already unreachable.

# Publisher names, which are NOT narratives. Measured on the live corpus: with
# these unstopped, "fxstreet" ranked as the 6th-loudest narrative of the day at
# 8.4% share — above OPEC. A backstop only; `strip_attribution` below removes most
# of these structurally, and a blocklist of publishers can never be complete.
_PUBLISHER_STOP: frozenset[str] = frozenset("""
barron barrons benzinga bloomberg businessinsider cnbc coindesk economist
finbold forbes fortune fxempire fxstreet insider investing investopedia
investorplace kitco marketwatch mining moneycontrol msn nasdaq newsweek
oilprice pravda reuters seekingalpha simplywall stocktwits thestreet
tipranks wsj yahoo zacks zerohedge
""".split())

_TOKEN_RE = re.compile(r"[a-z][a-z0-9'&.-]*")

# Trailing source attribution: "OPEC+ Set to Raise Output | OilPrice.com".
# The segment after the last pipe is feed metadata, not headline content, and
# tokenising it makes every story that publisher ran vote for the publisher's own
# name. Bounded to a short tail so a headline that legitimately contains a pipe
# keeps its content.
_ATTRIBUTION_RE = re.compile(r"\s*\|\s*[^|]{1,40}\s*$")


def strip_attribution(text: str) -> str:
    """Drop a trailing ``| Publisher`` segment from a headline.

    Structural, not a blocklist: it removes the attribution regardless of which
    publisher it names, including ones no list anticipates.
    """
    return _ATTRIBUTION_RE.sub("", text or "").strip()

# The longest n-gram we build. Three catches "ai capex cycle" and "central bank
# pivot"; four would mostly catch sentence fragments that never repeat, which
# cannot clear MIN_DOC_COUNT anyway and only cost memory.
MAX_NGRAM = 3

# A phrase must appear in at least this many DISTINCT documents on a day to be
# tracked at all. Below it, share-of-voice is one editor's word choice rather than
# a narrative, and the velocity of a 1-document phrase is pure noise.
MIN_DOC_COUNT = 3

#: The floor as a SHARE of the day's corpus, applied alongside MIN_DOC_COUNT.
#:
#: A fixed document count does not survive a change of scale, and the corpus grew
#: 80-fold in one day. Measured on live runs:
#:
#:     11 docs/day  ->  3 docs is an 11% bar   (far too strict: only register clears)
#:    868 docs/day  ->  3 docs is a 0.35% bar  (far too loose: 3 of 868 is coincidence)
#:  24000 docs/day  ->  3 docs is a 0.01% bar  (pure noise)
#:
#: So the effective floor is `max(MIN_DOC_COUNT, ceil(corpus_size * MIN_DOC_SHARE))`.
#: The absolute term binds on thin days, where a share floor would admit a phrase
#: seen once; the share term binds once the corpus is large enough for 3 documents
#: to be an accident.
#:
#: 1% is chosen against what a real narrative looked like when we could see one: the
#: emerging finds on the archive sat at 8-25% share, and the quietest phrase worth
#: persisting on the 868-document run was ~1%. Below that, on this corpus, a phrase
#: is a handful of syndicated copies of one story.
#:
#: Crossover is at 300 documents/day: thinner and the count binds, denser and the
#: share does.
MIN_DOC_SHARE = 0.01

# A phrase must be observed on at least this many days before its velocity is
# reported. `robust_momentum` needs spread in the window to say anything; with
# fewer points it returns its degenerate 0.0, which reads as "no change" when the
# truth is "no history".
MIN_DAYS_FOR_VELOCITY = 4

# |velocity| above which today's share counts as a genuine break from the
# phrase's own history. A MAD-scaled z, so 1.5 is ~1.5 robust sigmas.
VELOCITY_MATERIAL = 1.5

# A phrase first seen within this many days is still "young" — the window in which
# a rising phrase is genuinely emerging rather than an established theme having a
# busy week.
EMERGENCE_WINDOW_DAYS = 21

# Floor on the MAD scale used to z-score a share series, in share-of-voice units.
# 0.005 is half a percentage point of the day's coverage.
#
# WHY A FLOOR (the same argument as ADR-0047's conviction vol floor): a phrase
# that sat at exactly the same share for eight days has a MAD of zero, so the
# z-score is 0/0 — undefined. Reporting "no reading" there is backwards. A
# departure from a perfectly stable base is the STRONGEST evidence of a break in
# the series, not the weakest, and it is precisely the shape a genuinely new
# narrative makes: flat at nothing, then not.
#
# Without the floor the ratio measures the denominator instead of the idea, and
# the phrases most likely to be new — the ones with the least history and so the
# least spread — are exactly the ones the statistic refuses to score.
SHARE_SCALE_FLOOR = 0.005


def tokenize(text: str) -> list[str]:
    """Lowercase content tokens, stopwords and newswire furniture removed.

    Tokens keep internal `'`, `&`, `.` and `-` so "s&p", "u.s." and "risk-off"
    survive as single tokens; a tokenizer that split those would manufacture
    "risk" and "off" as separate narratives.

    The minimum length is TWO, not three. Three deleted "ai" — and with it every
    phrase the AI capex narrative is expressed in, which is the single example the
    brief names. It also deleted "eu", "uk", "em", "hy", "ig" and "qt". Two-letter
    grammatical words are handled where they belong, in the stoplist, rather than
    by a length rule that cannot tell "as" from "AI".
    """
    out: list[str] = []
    for tok in _TOKEN_RE.findall(strip_attribution(text).lower()):
        tok = tok.strip("-.'&")
        if len(tok) < 2:
            continue
        if tok in _STOPWORDS or tok in _NEWSWIRE_STOP or tok in _PUBLISHER_STOP:
            continue
        out.append(tok)
    return out


def phrases_in(text: str, max_ngram: int = MAX_NGRAM) -> set[str]:
    """The distinct n-grams (1..max_ngram) in one document.

    A SET, so a headline that says "tariffs" three times contributes one document
    to "tariffs" rather than three. Document frequency is the right unit for
    share-of-voice: the question is how many stories are about a narrative, not
    how emphatically one of them repeats itself.

    N-grams are built over the FILTERED token stream, so "the Fed is hawkish"
    yields the bigram "fed hawkish". That deliberately bridges dropped stopwords —
    the alternative (n-grams over raw tokens) buries every real phrase under
    "of the", "in a" and their kin.
    """
    tokens = tokenize(text)
    out: set[str] = set()
    for n in range(1, max_ngram + 1):
        for i in range(len(tokens) - n + 1):
            out.add(" ".join(tokens[i:i + n]))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Daily aggregation
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class DailyCorpus:
    """One day's phrase counts, plus what they were counted out of."""
    run_date: date
    doc_counts: dict[str, int]
    corpus_size: int
    #: The document count a phrase had to reach on this day. Carried rather than
    #: recomputed, so a run can SAY what bar it applied instead of leaving a reader
    #: to infer it from a constant that is no longer the whole story.
    floor: int = 0
    #: Phrases that appeared but did not clear the floor. A count, not a list —
    #: carried so a run can SAY how much of the tail it discarded rather than
    #: presenting the survivors as if they were everything (GOAL: no silent caps).
    below_threshold: int = 0


def daily_phrase_counts(
    documents: list[str],
    run_date: date,
    min_doc_count: int = MIN_DOC_COUNT,
    max_ngram: int = MAX_NGRAM,
    min_doc_share: float = MIN_DOC_SHARE,
) -> DailyCorpus:
    """Document frequency per phrase across one day's headlines.

    The floor is `max(min_doc_count, ceil(corpus_size * min_doc_share))` — see
    MIN_DOC_SHARE for why a fixed count alone breaks at both ends of the density
    range this corpus actually spans.
    """
    counts: dict[str, int] = {}
    n_docs = 0
    for doc in documents:
        found = phrases_in(doc, max_ngram=max_ngram)
        if not found:
            continue
        n_docs += 1
        for p in found:
            counts[p] = counts.get(p, 0) + 1

    # The floor is whichever of the two is HIGHER (ADR-0155): an absolute document
    # count, which protects a thin day from admitting a phrase seen once, and a
    # share of the corpus, which stops 3 documents from being a 0.35% accident once
    # the corpus is large. Neither alone survives an 80-fold change in corpus size.
    floor = max(min_doc_count, math.ceil(n_docs * min_doc_share))
    kept = {p: c for p, c in counts.items() if c >= floor}
    return DailyCorpus(
        run_date=run_date,
        doc_counts=prune_subsumed(kept),
        corpus_size=n_docs,
        below_threshold=len(counts) - len(kept),
        floor=floor,
    )


def prune_subsumed(counts: dict[str, int], ratio: float = 0.8) -> dict[str, int]:
    """Drop a short phrase that is really just a longer one.

    If "intelligence" appears in 12 documents and "artificial intelligence" in 11,
    the unigram is not a separate narrative — it is the bigram with a word missing,
    and reporting both double-counts the same story and crowds the shortlist.

    A shorter phrase is dropped when a longer phrase CONTAINING it holds at least
    ``ratio`` of its documents. The longer phrase always survives: it is the more
    specific claim, and specificity is what makes a narrative label useful.
    """
    by_len: dict[int, list[str]] = {}
    for p in counts:
        by_len.setdefault(p.count(" ") + 1, []).append(p)

    drop: set[str] = set()
    for n, shorter in by_len.items():
        longer = [p for m, ps in by_len.items() if m > n for p in ps]
        for s in shorter:
            needle = s
            for l in longer:
                if l in drop:
                    continue
                # Word-boundary containment: "us" must not match "thus".
                if f" {needle} " in f" {l} " and counts[l] >= ratio * counts[s]:
                    drop.add(s)
                    break
    return {p: c for p, c in counts.items() if p not in drop}


# ─────────────────────────────────────────────────────────────────────────────
# The signal
# ─────────────────────────────────────────────────────────────────────────────

def share_velocity(
    current: float,
    history: list[float],
    floor: float = SHARE_SCALE_FLOOR,
) -> float | None:
    """How unusual today's share is against this phrase's OWN history.

    Median/MAD rather than mean/std, for the reason ``robust_momentum`` gives: on
    a short window one viral day inflates the mean and one quiet day shrinks the
    std, so a naive z swings on noise. Clipped to [-4, 4] to match.

    Differs from ``robust_momentum`` in one deliberate way — the MAD scale is
    FLOORED at ``SHARE_SCALE_FLOOR`` instead of returning a degenerate reading
    when the history has no spread. See that constant for why.

    Returns None only when there is genuinely nothing to compare against.
    """
    past = [h for h in history if h is not None]
    if not past:
        return None
    med = median(past)
    mad = median([abs(h - med) for h in past])
    scale = max(1.4826 * mad, floor)
    return max(-4.0, min(4.0, (current - med) / scale))


@dataclass(frozen=True)
class NarrativeSignal:
    """One phrase's reading on one day.

    ``share`` — not ``doc_count`` — is the series a chart should plot and the
    series velocity is measured on. The daily corpus size swings with how many
    articles the fetch returned, so a raw count rises on a day the fetcher simply
    worked better. Share of voice is the Google-Trends normalisation and is the
    only version of this number that is comparable across days.
    """
    phrase: str
    run_date: date
    doc_count: int
    corpus_size: int
    share: float
    #: Robust (median/MAD) z of today's share against this phrase's own history.
    #: None when the phrase has too little history to say — never 0.0, which would
    #: read as "flat".
    velocity: float | None
    #: Distinct days this phrase has been observed, including today.
    days_observed: int
    first_seen: date
    #: new | emerging | established | fading
    status: str
    #: The anchor theme whose keywords already cover this phrase, or None if this
    #: narrative is genuinely outside the hard-coded eight.
    covered_by: str | None = None
    methods: list[str] = field(default_factory=lambda: ["frequency"])


def classify_status(
    velocity: float | None,
    days_observed: int,
    first_seen: date,
    run_date: date,
    emergence_window: int = EMERGENCE_WINDOW_DAYS,
    material: float = VELOCITY_MATERIAL,
) -> str:
    """Where a phrase sits in its own life cycle.

    * ``new`` — too little history to judge. Said plainly rather than guessed at:
      a phrase seen twice is not yet evidence of anything, and calling it
      "emerging" would promote noise on its second day.
    * ``emerging`` — young AND accelerating. Both halves matter. Without the age
      test, "inflation" having a loud week reads as a new narrative; without the
      velocity test, every phrase is emerging for three weeks.
    * ``fading`` — decelerating materially against its own history.
    * ``established`` — everything else: present, not breaking out either way.
    """
    if velocity is None or days_observed < MIN_DAYS_FOR_VELOCITY:
        return "new"
    age_days = (run_date - first_seen).days
    if velocity >= material and age_days <= emergence_window:
        return "emerging"
    if velocity <= -material:
        return "fading"
    return "established"


def build_narrative_signals(
    today: DailyCorpus,
    history: dict[str, list[tuple[date, float]]],
    anchor_keywords: dict[str, list[str]] | None = None,
) -> list[NarrativeSignal]:
    """Turn one day's counts into signals, given each phrase's own past shares.

    ``history`` maps phrase -> [(run_date, share), ...] for PRIOR days, ascending.
    It is passed in rather than fetched so this function stays pure and testable;
    ``load_history`` does the Supabase read.

    Sorted by share descending — the shortlist a reader sees is "what the news was
    about today", and emergence is a status on that list rather than a separate
    ranking. A phrase can be the day's loudest and still be `established`; that is
    information, not a defect.
    """
    anchor_keywords = anchor_keywords or {}
    signals: list[NarrativeSignal] = []

    for phrase, count in today.doc_counts.items():
        share = count / today.corpus_size if today.corpus_size else 0.0
        past = history.get(phrase, [])
        past_shares = [s for _, s in past]

        velocity: float | None = None
        if len(past_shares) >= MIN_DAYS_FOR_VELOCITY - 1:
            velocity = share_velocity(share, past_shares)

        first_seen = past[0][0] if past else today.run_date
        days_observed = len(past) + 1

        signals.append(NarrativeSignal(
            phrase=phrase,
            run_date=today.run_date,
            doc_count=count,
            corpus_size=today.corpus_size,
            share=share,
            velocity=velocity,
            days_observed=days_observed,
            first_seen=first_seen,
            status=classify_status(velocity, days_observed, first_seen, today.run_date),
            covered_by=anchor_for_phrase(phrase, anchor_keywords),
        ))

    signals.sort(key=lambda s: (-s.share, s.phrase))
    return signals


def _fold(tokens: set[str]) -> set[str]:
    """Fold a trailing plural 's' so "rates" and "rate" compare equal.

    Crude on purpose — no stemmer, no dependency. It exists because the anchor
    keyword lists are written in whichever number reads naturally to a human
    ("interest rates", "credit spreads") while a headline uses either, and a
    number mismatch was reporting Fed Policy's own vocabulary as unwatched.
    """
    return {t[:-1] if len(t) > 3 and t.endswith("s") and not t.endswith("ss") else t
            for t in tokens}


def anchor_for_phrase(phrase: str, anchor_keywords: dict[str, list[str]]) -> str | None:
    """The anchor theme already covering this phrase, if any.

    This is the field that makes the output answer the actual question. A trending
    phrase is only *news to this system* if the eight hard-coded themes were not
    already asking for it: "fomc" trending is Fed Policy doing its job, while
    "ai capex cycle" trending is a narrative nothing in the pipeline is watching.

    A **one-word keyword covers only the one-word phrase**; a multi-word keyword
    covers any phrase at least as specific as it. Concretely:

    * ``"AI capex"`` (2 tokens) covers "ai capex cycle" — every token present.
    * ``"US dollar"`` (2 tokens) covers "us dollar", and "us dollar index".
    * ``"dollar"`` (1 token) covers the phrase "dollar" and **nothing else**.

    That last case is the rule's whole purpose. Without it, the single-word alias
    "dollar" claims **"dollar debasement"** — a narrative the anchor's cyclical
    dollar keywords do not ask for and which this system documented as the
    motivating example of a theme it could not see (ADR-0128). One generic token
    would silently annex every specific narrative built on it: "de-dollarisation",
    "dollar weaponisation", and any framing not yet invented.

    The asymmetry is deliberate, and it follows from which error costs more.
    A phrase wrongly marked covered **disappears from the "nothing is watching
    this" shortlist**, which is the only thing the shortlist is for; a phrase
    wrongly marked uncovered merely appears on a list a human reads. So
    attribution must be *specific* to claim, and generic tokens claim only
    themselves.
    """
    phrase_tokens = _fold(set(phrase.split()))
    if not phrase_tokens:
        return None
    for theme, keywords in anchor_keywords.items():
        for kw in keywords:
            kw_tokens = _fold(set(tokenize(kw)))
            if not kw_tokens:
                continue
            if len(kw_tokens) == 1:
                # Generic single token: exact phrase match only.
                if phrase_tokens == kw_tokens:
                    return theme
                continue
            if kw_tokens <= phrase_tokens:
                return theme
            # A multi-token phrase sitting inside a longer keyword — "us dollar"
            # against "us dollar index". Still floored at two tokens, so a lone
            # generic token cannot be claimed by a multi-word keyword either.
            if len(phrase_tokens) >= 2 and phrase_tokens <= kw_tokens:
                return theme
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Persistence (impure — everything above this line is a pure function)
# ─────────────────────────────────────────────────────────────────────────────

#: How many phrases a run persists. The tail below this is real but unreadable,
#: and writing every n-gram of every headline would add tens of thousands of rows
#: a day for signal nobody reads. The number dropped is persisted alongside so a
#: run states its own truncation rather than presenting the survivors as the whole
#: picture.
TOP_N_PERSISTED = 150

#: Days of history to load for the velocity computation.
HISTORY_DAYS = 60

#: The two corpora a phrase can be counted out of (ADR-0153). They answer different
#: questions and must never share a comparison:
#:
#:   combined  every un-themed source. Dense (~98 docs/day) and therefore the honest
#:             answer to "what is the news about today". Its composition changes as
#:             providers come and go — Brave contributes 87-94 docs/day after
#:             2026-07-21 and nothing before it — so shares are only comparable
#:             across days where the mix is stable.
#:   archive   GDELT alone. Sparse (~11 docs/day) but ONE definition all the way
#:             back, which is the only thing that makes a velocity mean anything.
#:
#: A share is a fraction OF a corpus. Comparing one to the other measures the corpus
#: difference and calls it attention.
COMBINED_CORPUS = "combined"
ARCHIVE_CORPUS = "archive"


def load_history(
    sb,
    run_date: date,
    days: int = HISTORY_DAYS,
    corpus: str = COMBINED_CORPUS,
) -> dict[str, list[tuple[date, float]]]:
    """Prior daily shares per phrase, ascending, EXCLUDING ``run_date`` itself.

    Excluding today matters: `build_narrative_signals` compares today's share
    against its history, and a window that already contained today would compare
    the value to itself and damp every genuine break.

    **Filtered to one corpus, and that filter is load-bearing** (ADR-0153). A share
    is a fraction OF a corpus, so comparing today's archive share against a history
    of combined shares measures the difference between the two corpora — GDELT's ~11
    documents a day against a combined ~98 — and reports it as a change in
    attention. The filter is what keeps a velocity a statement about the phrase.
    """
    cutoff = (run_date - timedelta(days=days)).isoformat()
    try:
        rows = (
            sb.table("narrative_signals")
            .select("phrase, run_date, share")
            .eq("corpus", corpus)
            .gte("run_date", cutoff)
            .lt("run_date", run_date.isoformat())
            .order("run_date", desc=False)
            .limit(20000)
            .execute()
            .data
        )
    except Exception as exc:
        print(f"[narrative_tracker] history read failed ({exc.__class__.__name__}); "
              f"apply migration 049. Every phrase will read as 'new' this run.")
        return {}

    hist: dict[str, list[tuple[date, float]]] = {}
    for r in rows or []:
        phrase = r.get("phrase")
        share = r.get("share")
        raw_date = r.get("run_date")
        if not phrase or share is None or not raw_date:
            continue
        hist.setdefault(phrase, []).append((date.fromisoformat(str(raw_date)[:10]), float(share)))
    return hist


def persist_narrative_signals(
    sb,
    signals: list[NarrativeSignal],
    top_n: int = TOP_N_PERSISTED,
    note: str = "",
    corpus: str = COMBINED_CORPUS,
) -> int:
    """Upsert the day's narrative signals. Best-effort: logs and returns 0 if the
    table isn't deployed, exactly as `persist_discovered_themes` does."""
    if not signals:
        return 0

    # Top-N BY SHARE, plus every phrase below the cut that is actually moving.
    #
    # `signals` is sorted by share descending, so `signals[:top_n]` keeps the day's
    # LOUDEST phrases. That was harmless when a day yielded ~20 phrases. At 868
    # documents it yields 736, and truncating by share discards 586 of them — by
    # exactly the wrong criterion, because an emerging narrative is by definition
    # QUIET and accelerating. The phrase this detector exists to find ranks ~600th
    # and never reached the table; the 2026-07-29 run reported 0 emerging on a day
    # with 34 measured velocities (ADR-0155).
    #
    # So the keep-list is a union of the two questions the table serves: "what is
    # the news about today" (share) and "what is breaking out" (velocity). The
    # second set is naturally small — it is bounded by the phrases with enough
    # history to have a velocity at all — so this cannot balloon.
    loudest = signals[:top_n]
    loud_keys = {s.phrase for s in loudest}
    movers = [
        s for s in signals[top_n:]
        if s.phrase not in loud_keys
        and s.velocity is not None
        and abs(s.velocity) >= VELOCITY_MATERIAL
    ]
    kept = loudest + movers
    dropped = len(signals) - len(kept)
    rows = [{
        "run_date": s.run_date.isoformat(),
        "phrase": s.phrase,
        "doc_count": s.doc_count,
        "corpus_size": s.corpus_size,
        "share": s.share,
        "velocity": s.velocity,
        "days_observed": s.days_observed,
        "first_seen": s.first_seen.isoformat(),
        "status": s.status,
        "covered_by": s.covered_by,
        "methods": s.methods,
        "corpus": corpus,
    } for s in kept]

    try:
        # (run_date, phrase, corpus) — migration 057. Without the corpus in the key
        # the second series would overwrite the first and the survivor would depend
        # on write order.
        sb.table("narrative_signals").upsert(
            rows, on_conflict="run_date,phrase,corpus"
        ).execute()
    except Exception as exc:
        print(f"[narrative_tracker] narrative_signals upsert failed "
              f"({exc.__class__.__name__}); apply migration 049. Nothing persisted.")
        return 0

    emerging = [s for s in kept if s.status == "emerging" and s.covered_by is None]
    # `note` distinguishes the second write of a run. Corroboration re-persists to
    # widen `methods`, and two byte-identical "Persisted 150 phrases" lines read
    # as an accidental double-write rather than a deliberate update.
    print(f"[narrative_tracker] Persisted {len(rows)} {corpus} phrases{note}"
          f"{f' = {len(loudest)} loudest + {len(movers)} movers below the cut' if movers else ''}"
          f"{f' (dropped {dropped}: below the top {top_n} by share AND not moving)' if dropped else ''}. "
          f"{len(emerging)} emerging and not covered by an anchor theme.")
    for s in emerging[:10]:
        print(f"[narrative_tracker]   EMERGING  {s.phrase!r} "
              f"share {s.share:.3f} velocity {s.velocity:+.2f} "
              f"first seen {s.first_seen.isoformat()}")
    return len(rows)


def track_narratives(
    sb,
    run_date: date,
    documents: list[str],
    anchor_keywords: dict[str, list[str]] | None = None,
    corpus: str = COMBINED_CORPUS,
) -> list[NarrativeSignal]:
    """One day's narrative tracking, end to end, over ONE corpus.

    `corpus` labels which set of documents these counts came from and is threaded
    through BOTH the history read and the write (ADR-0153). Counting today out of
    one corpus while reading history from another compares a share against
    fractions of a different denominator and reports the gap as attention.

    Returns the signals it built (persisted or not) so the caller can log or
    surface them even when the table is missing. An empty corpus returns an empty
    list WITH a printed reason — never a fabricated one, and never silence.
    """
    if not documents:
        print("[narrative_tracker] Corpus is empty — no market news was collected "
              "this run. No narrative signals (not zero signals: none measured).")
        return []

    today = daily_phrase_counts(documents, run_date)
    if not today.doc_counts:
        print(f"[narrative_tracker] {len(documents)} documents yielded no phrase "
              f"above MIN_DOC_COUNT={MIN_DOC_COUNT}; corpus is too small or too "
              f"heterogeneous to support a frequency claim.")
        return []

    history = load_history(sb, run_date, corpus=corpus) if sb is not None else {}
    signals = build_narrative_signals(today, history, anchor_keywords)

    print(f"[narrative_tracker] [{corpus}] {today.corpus_size} documents, "
          f"{len(today.doc_counts)} tracked phrases "
          f"({today.below_threshold} below the {MIN_DOC_COUNT}-document floor).")

    if sb is not None:
        persist_narrative_signals(sb, signals, corpus=corpus)
    return signals


def emerging_narratives(
    signals: list[NarrativeSignal],
    include_covered: bool = False,
) -> list[NarrativeSignal]:
    """The shortlist: accelerating, young, and — by default — NOT already covered
    by one of the eight anchors.

    ``include_covered=False`` is the honest default because the question this
    answers is "what is the pipeline missing", and a surge in "fomc" is not a miss.
    Ordered by velocity, because among genuinely new narratives the useful sort is
    how fast it is arriving, not how loud it already is.
    """
    out = [s for s in signals if s.status == "emerging"]
    if not include_covered:
        out = [s for s in out if s.covered_by is None]
    return sorted(out, key=lambda s: (-(s.velocity or 0.0), s.phrase))
