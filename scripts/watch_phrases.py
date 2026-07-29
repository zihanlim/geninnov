"""Phrase watch: is a candidate narrative approaching the point where it can be named?

WHY THIS EXISTS
===============
The narrative board answers "what is the news about today" over phrases that cleared
the document floor. It is silent about the state one step before that — a narrative
that is *in the headlines* but has not yet repeated itself enough to be counted.

That state is not hypothetical. On 2026-07-28 the phrase `ai` held 15.6% of the archive
corpus, and its 16 documents were at least two different narratives:

    the capex chain          "AI investment cycle has room to run"
                             "concerns around AI spending; Nvidia, Micron down 6%"
                             "Bond market anxiety is growing over AI capex budgets"

    the AI trade as a        "Big Short investor warns AI has become one dangerous trade"
    POSITION                 "Why India stock market is the 'inverse AI trade'"
                             "Indian equities as an AI market hedge"

The second is not the AI Capex theme. It points at different instruments with the
opposite sign — long Indian equities AGAINST the complex, not long NVDA with it — so
if it is real it is a theme of its own rather than a leg of the existing one.

It cannot be seen on the board, and the reason is NOT attribution. ADR-0128's asymmetry
means the one-token alias `ai` claims only the exact phrase `ai`, so `inverse ai trade`
and `ai hedge` are already uncovered and would surface on their own. They do not surface
because the corpus is too thin for them to repeat: each of those framings appears in ONE
document, against a floor of three. The narrative exists and has no name yet.

This script reports that pre-tracking state, so "should this be a theme?" is answered by
watching rather than by taste. It is the path AI Capex itself took (ADR-0129): the
tracker found it, it was watched, and then it was promoted.

WHY IT CALLS THE PIPELINE'S OWN LOADER
======================================
`load_market_corpus` is imported, not reimplemented. A watch that assembled its own
corpus would answer a question the tracker never asked, and three ways of being wrong
were live in the first draft of this file: `market_news` rows were read straight and
silently truncated at PostgREST's 1000-row response cap (ADR-0154); they were grouped by
`run_date`, which is the FETCH day and not the day a corpus is built for (ADR-0158); and
they were not deduplicated by headline, which the loader does. Each would have moved the
denominator, and the whole output of this script is a ratio against that denominator.

The same argument covers `document_floor` and `phrases_in`, both imported from the
tracker. "How close is this phrase to being counted" is only meaningful if `counted`
means exactly what it means to the thing doing the counting.

WHAT IT IS NOT
==============
Read-only, and it decides nothing. It writes no table, promotes nothing, and reaching
every gate below is an argument for a human to look — not a trigger. Whether a narrative
deserves instruments is a judgement about transmission, which no phrase count can make.

Usage:
    python -m scripts.watch_phrases                      # archive (GDELT alone)
    python -m scripts.watch_phrases --corpus combined    # denser, no velocity yet
    python -m scripts.watch_phrases --lookback 14

Requires SUPABASE_URL + SUPABASE_SERVICE_KEY.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.narrative_tracker import (  # noqa: E402
    ARCHIVE_CORPUS,
    COMBINED_CORPUS,
    MAX_CORPUS_SIZE_RATIO,
    MIN_DAYS_FOR_VELOCITY,
    document_floor,
    phrases_in,
)

#: Sessions of history before ADR-0143's price-link gate will BELIEVE a correlation.
#: Restated here only as a REPORTING threshold — this script computes no price link. It
#: reports how far a phrase is from being eligible for one.
PRICE_LINK_SESSIONS = 20


@dataclass(frozen=True)
class Watch:
    """A candidate narrative, and the phrasings the tracker would actually form."""
    name: str
    why: str
    #: Phrases EXACTLY as `phrases_in` emits them — lowercased, stopwords and newswire
    #: furniture removed, n-grams built over the FILTERED token stream. A term written
    #: the way a person says it ("the AI trade") can never match: "the" is gone before
    #: n-grams are built, and so are "market", "stock" and "shares". Every term below
    #: was read back out of `phrases_in` over live headlines rather than guessed, which
    #: is why "ai market hedge" is absent and "ai hedge" is here.
    terms: tuple[str, ...]


WATCHES: tuple[Watch, ...] = (
    Watch(
        name="the AI trade as a position",
        why=(
            "Crowding in the AI complex, and trades expressing a view ON that "
            "crowding. Distinct from AI Capex: the instruments are the hedge side "
            "(Indian equities, defensives) rather than the chain, and the sign is "
            "opposite. If this earns a theme it is a SECOND one, not a leg."
        ),
        terms=(
            "ai trade", "inverse ai", "inverse ai trade", "ai hedge", "ai caution",
            "ai bubble", "ai crowding", "ai concentration", "ai correction",
            "ai selloff", "ai revolution",
        ),
    ),
    Watch(
        name="AI capex funding stress",
        why=(
            "Already INSIDE AI Capex — JNK and IEF are the chain's funding and "
            "duration links (migration 050). Watched not for promotion but because "
            "it is the leg most likely to move first, and the one a credit mandate "
            "cares about most."
        ),
        terms=("ai debt", "ai debt wave", "capex budgets", "capex guidance", "capex hike"),
    ),
)


@dataclass(frozen=True)
class TermState:
    term: str
    #: Documents in the corpus containing this phrase, and the bar it must clear.
    docs: int
    floor: int
    #: From `narrative_signals`, if the term ever cleared the floor. 0 = never has.
    tracked_days: int
    tracked_velocity: float | None
    tracked_covered_by: str | None

    @property
    def verdict(self) -> str:
        if self.tracked_days == 0:
            return "absent" if self.docs == 0 else "below floor"
        if self.tracked_days < MIN_DAYS_FOR_VELOCITY:
            return "tracked, no velocity yet"
        if self.tracked_days < PRICE_LINK_SESSIONS:
            return "measurable"
        return "eligible for a price link"

    @property
    def detail(self) -> str:
        if self.tracked_days:
            v = "none" if self.tracked_velocity is None else f"{self.tracked_velocity:+.2f}"
            return (f"{self.tracked_days}d observed · velocity {v} · watched by "
                    f"{self.tracked_covered_by or 'nothing'}")
        if self.docs == 0:
            return "not in a single headline in the corpus"
        return f"{self.docs} of {self.floor} documents needed"


def comparability(n_docs: int, board_size: int | None, corpus: str = ARCHIVE_CORPUS) -> str | None:
    """Whether this corpus is the same SIZE of thing the board's history was counted from.

    Not decoration. A share is `doc_count / corpus_size`, so when the denominator moves
    every phrase's share moves with it and a robust z of that movement reports the fetch
    rather than the news — which is why `build_narrative_signals` withholds velocity
    entirely past `MAX_CORPUS_SIZE_RATIO` (ADR-0155).

    This watch's whole output is a ratio against a floor derived from `n_docs`. If that
    number has broken away from what the board last counted, the floors printed below
    are not the floors that produced the board, and saying "1 of 10" without saying so
    would be quietly comparing two different corpora.
    """
    if not board_size or not n_docs:
        return None
    ratio = n_docs / board_size
    if (1 / MAX_CORPUS_SIZE_RATIO) <= ratio <= MAX_CORPUS_SIZE_RATIO:
        return None
    return (
        f"  !! This corpus is {ratio:.1f}x the board's last one ({n_docs} against "
        f"{board_size}), past ADR-0155's {MAX_CORPUS_SIZE_RATIO}x limit.\n"
        f"     The floor below is computed from {n_docs} and is NOT the floor that "
        f"produced the board's current rows.\n"
        f"     Expect the next {corpus} run to WITHHOLD velocity for exactly this "
        f"reason. Says nothing about the other corpus, which was not measured."
    )


def observe(documents: list[str], terms: tuple[str, ...]) -> tuple[dict[str, int], int]:
    """Document frequency per term, and the corpus size it is a fraction of.

    Counted with `phrases_in` — the tracker's OWN tokeniser — rather than a substring
    or regex match. A regex finds "ai trade" in a headline the tracker tokenises into
    something else entirely, and the question here is what the TRACKER would count.

    `n_docs` skips documents that yield no phrase at all, exactly as
    `daily_phrase_counts` does, so the floor derived from it is the real one.
    """
    counts = {t: 0 for t in terms}
    n_docs = 0
    for doc in documents:
        found = phrases_in(doc)
        if not found:
            continue
        n_docs += 1
        for t in terms:
            if t in found:
                counts[t] += 1
    return counts, n_docs


def build_states(
    counts: dict[str, int],
    floor: int,
    tracked: dict[str, tuple[int, float | None, str | None]],
) -> list[TermState]:
    return [
        TermState(
            term=term,
            docs=docs,
            floor=floor,
            tracked_days=tracked.get(term, (0, None, None))[0],
            tracked_velocity=tracked.get(term, (0, None, None))[1],
            tracked_covered_by=tracked.get(term, (0, None, None))[2],
        )
        for term, docs in counts.items()
    ]


def render(watch: Watch, states: list[TermState]) -> str:
    """The report for one candidate, ordered by how close each term is."""
    ranked = sorted(
        states,
        key=lambda s: (-s.tracked_days, -s.docs, s.term),
    )
    width = max(len(s.term) for s in ranked)
    lines = [f"\n  {watch.name.upper()}", f"    {watch.why}", ""]
    for s in ranked:
        lines.append(f"    {s.term:<{width}}  {s.verdict:<26}  {s.detail}")
    if all(s.tracked_days == 0 for s in ranked):
        near = [s for s in ranked if s.docs > 0]
        if near:
            lines.append(
                f"\n    Nothing named yet, and that is the finding: {len(near)} of "
                f"{len(ranked)} phrasings ARE in the corpus, none often enough to be "
                f"counted. A narrative existing without a name is not the same as a "
                f"narrative being absent, and only this line can tell them apart."
            )
        else:
            lines.append("\n    Nothing named, and nothing in the corpus either.")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description="Phrase watch over the un-themed corpus.")
    ap.add_argument("--corpus", choices=[ARCHIVE_CORPUS, COMBINED_CORPUS],
                    default=ARCHIVE_CORPUS)
    ap.add_argument("--lookback", type=int, default=7,
                    help="Days of market_news to assemble, as load_market_corpus does.")
    args = ap.parse_args()

    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY")):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.", file=sys.stderr)
        return 2

    # Imported late: `daily_refresh` builds a Supabase client at import time, so the
    # credential check above must run first to fail with a sentence rather than a
    # traceback.
    from scripts.daily_refresh import (  # noqa: E402
        ARCHIVE_SOURCE, COMBINED_SOURCES, load_market_corpus, supabase,
    )

    run_date = date.today()
    sources = [ARCHIVE_SOURCE] if args.corpus == ARCHIVE_CORPUS else COMBINED_SOURCES
    documents = load_market_corpus(run_date, lookback_days=args.lookback, sources=sources)
    if not documents:
        print(f"No {args.corpus} documents. Nothing to watch against — that is a "
              f"failed read, not a quiet market (ADR-0156).")
        return 1

    all_terms = tuple(t for w in WATCHES for t in w.terms)
    counts, n_docs = observe(documents, all_terms)
    floor = document_floor(n_docs)

    tracked_rows = (
        supabase.table("narrative_signals")
        .select("phrase, run_date, velocity, covered_by, days_observed")
        .eq("corpus", args.corpus)
        .in_("phrase", list(all_terms))
        .order("run_date", desc=True)
        .limit(1000)
        .execute()
        .data
    ) or []
    tracked: dict[str, tuple[int, float | None, str | None]] = {}
    for r in tracked_rows:  # date-descending, so the first row per phrase is newest
        p = r.get("phrase")
        if p and p not in tracked:
            tracked[p] = (int(r.get("days_observed") or 0), r.get("velocity"),
                          r.get("covered_by"))

    # The board's own last denominator, printed beside ours. They should be close; a
    # wide gap means this watch is measuring a differently-sized thing than the board
    # and its ratios do not transfer.
    last = (
        supabase.table("narrative_signals")
        .select("run_date, corpus_size")
        .eq("corpus", args.corpus)
        .order("run_date", desc=True)
        .limit(1)
        .execute()
        .data
    ) or []
    board_size = int(last[0]["corpus_size"]) if last else None
    board = f"{board_size} on {last[0]['run_date']}" if last else "none yet"

    print(f"\nPhrase watch — {args.corpus} corpus, {args.lookback}-day window, "
          f"{n_docs} documents (board's last: {board})")
    print(f"  Floor today: {floor} documents. A phrase gets a velocity after "
          f"{MIN_DAYS_FOR_VELOCITY} observed days and is eligible for")
    print(f"  ADR-0143's price link after {PRICE_LINK_SESSIONS}. None of that promotes "
          f"anything; it only earns a human's attention.")

    warning = comparability(n_docs, board_size, args.corpus)
    if warning:
        print()
        print(warning)

    for watch in WATCHES:
        states = build_states(
            {t: counts[t] for t in watch.terms}, floor, tracked,
        )
        print(render(watch, states))
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
