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

EACH SERIES IS WATCHED THE WAY IT IS BUILT
==========================================
The two corpora are assembled by DIFFERENT code in the pipeline, and this script has to
match each or its ratios are against a denominator nothing uses:

    archive    `extend_archive_series` -> `load_corpus_by_day`, bucketed by
               PUBLICATION date. One GDELT call returns 45 days of history, so every
               one of those documents carries today's `run_date` (ADR-0158).
    combined   `load_market_corpus(run_date)`, a 7-day window on `run_date`, deduped.

Getting this wrong is not theoretical — the first draft of this file used
`load_market_corpus` for BOTH. On the archive that returned 913 documents where the
series counts 109, because `deepen_archive.py` had loaded 2,309 GDELT rows across two
fetch days. It then reported an 8.4x corpus break and predicted the night's velocities
would be withheld. Nothing was wrong with the pipeline; the watch had reproduced the
exact bug ADR-0158 was written to fix, and its alarm was about itself.

Two earlier drafts were wrong two further ways, both worth naming because they fail
silently: rows read straight from `market_news` are truncated at PostgREST's 1000-row
response cap (ADR-0154 — `load_corpus_by_day` pages), and headlines are not deduplicated
unless the loader does it.

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
    #: The term's BEST single day: documents containing it, and that day's floor.
    #: Best rather than summed, because the floor is applied per day — a phrase seen
    #: once on each of five days clears nothing, and reporting 5 would imply it had.
    docs: int
    floor: int
    #: From `narrative_signals`, if the term ever cleared the floor. 0 = never has.
    tracked_days: int
    tracked_velocity: float | None
    tracked_covered_by: str | None
    day: date | None = None
    #: Days in the window on which the term appeared at all.
    days_present: int = 0

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
            return "not in a single headline in the window"
        seen = f", {self.days_present}d present" if self.days_present > 1 else ""
        return f"best {self.docs} of {self.floor} needed ({self.day}{seen})"


def _parse_day(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


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
    """Document frequency per term for ONE day, and the corpus size it is out of.

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


def observe_days(
    by_day: dict[date, list[str]],
    terms: tuple[str, ...],
) -> tuple[dict[str, tuple[date | None, int, int, int]], dict[date, int]]:
    """Per term across days: (best day, docs that day, that day's floor, days present).

    Per DAY and not pooled, because the floor is applied per day. Pooling a window
    would let a phrase seen once on each of ten days read as ten documents against one
    day's floor, and report a narrative as nearly-tracked that no single day is close
    to tracking.
    """
    best: dict[str, tuple[date | None, int, int, int]] = {t: (None, 0, 0, 0) for t in terms}
    sizes: dict[date, int] = {}
    for day in sorted(by_day):
        counts, n_docs = observe(by_day[day], terms)
        sizes[day] = n_docs
        floor = document_floor(n_docs)
        for t in terms:
            b_day, b_docs, b_floor, present = best[t]
            if counts[t] > 0:
                present += 1
            if counts[t] > b_docs:
                b_day, b_docs, b_floor = day, counts[t], floor
            best[t] = (b_day, b_docs, b_floor, present)
    return best, sizes


def build_states(
    best: dict[str, tuple[date | None, int, int, int]],
    tracked: dict[str, tuple[int, float | None, str | None]],
) -> list[TermState]:
    return [
        TermState(
            term=term,
            docs=obs[1],
            floor=obs[2],
            day=obs[0],
            days_present=obs[3],
            tracked_days=tracked.get(term, (0, None, None))[0],
            tracked_velocity=tracked.get(term, (0, None, None))[1],
            tracked_covered_by=tracked.get(term, (0, None, None))[2],
        )
        for term, obs in best.items()
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
    ap.add_argument("--days", type=int, default=14,
                    help="How many of the most recent days of the series to look over.")
    args = ap.parse_args()

    # Same pattern as `check_data_integrity`: local runs read `.env`, CI runs already
    # have the secrets in the environment and this is a no-op.
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY")):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.", file=sys.stderr)
        return 2

    # Imported late: `daily_refresh` builds a Supabase client at import time, so the
    # credential check above must run first to fail with a sentence rather than a
    # traceback.
    from scripts.backfill_narratives import load_corpus_by_day  # noqa: E402
    from scripts.daily_refresh import load_market_corpus, supabase  # noqa: E402

    run_date = date.today()
    if args.corpus == ARCHIVE_CORPUS:
        # PUBLICATION days — the field `extend_archive_series` buckets on (ADR-0158).
        # `load_market_corpus` would select on `run_date`, the FETCH day, and return
        # every publication day GDELT has ever handed us as if it were one day.
        by_day = load_corpus_by_day(supabase)
    else:
        # The combined series really is a `run_date` window, so here that IS the
        # right loader — one corpus per run, exactly as `daily_refresh` builds it.
        by_day = {run_date: load_market_corpus(run_date)}

    by_day = {d: docs for d, docs in sorted(by_day.items())[-args.days:] if docs}
    if not by_day:
        print(f"No {args.corpus} documents. Nothing to watch against — that is a "
              f"failed read, not a quiet market (ADR-0156).")
        return 1

    all_terms = tuple(t for w in WATCHES for t in w.terms)
    best, sizes = observe_days(by_day, all_terms)

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
    board_day = _parse_day(last[0]["run_date"]) if last else None

    days = sorted(sizes)
    newest = days[-1]
    print(f"\nPhrase watch — {args.corpus} corpus, {len(days)} days "
          f"({days[0]} to {newest})")
    if board_day and board_day in sizes:
        print(f"  Board's last scored day: {board_day}, {board_size} documents. "
              f"This watch reads {sizes[board_day]} there.")
    else:
        print(f"  Board's last scored day: "
              f"{board_day or 'none yet'} ({board_size or 0} documents), "
              f"outside this window.")
    if newest != board_day:
        print(f"  Newest day {newest} holds {sizes[newest]}. It is structurally the "
              f"thinnest and back-fills as the")
        print(f"  provider publishes (ADR-0159) — thin here is a lag, not a break.")
    print(f"  A phrase gets a velocity after {MIN_DAYS_FOR_VELOCITY} observed days "
          f"and is eligible for ADR-0143's")
    print(f"  price link after {PRICE_LINK_SESSIONS}. None of that promotes anything; "
          f"it only earns a human's attention.")

    # Compared on the SAME DAY the board last scored, and on no other.
    #
    # This check has cried wolf twice, both times by comparing two things that were
    # not the same day. First against a `run_date` window total (913 against 109,
    # "8.4x"), which was the ADR-0158 bug living in this file. Then against the newest
    # PUBLICATION day (11 against 109, "0.1x"), which is ADR-0159's lesson: the newest
    # day is always the thinnest because the provider publishes with a lag, so keying
    # anything off it reports the lag. A corpus break is a real thing this should
    # catch; neither of those was one.
    if board_day and board_day in sizes:
        warning = comparability(sizes[board_day], board_size, args.corpus)
        if warning:
            print()
            print(warning)

    for watch in WATCHES:
        states = build_states({t: best[t] for t in watch.terms}, tracked)
        print(render(watch, states))
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
