#!/usr/bin/env python
"""Rebuild `narrative_signals` history from the archived corpus.

WHY THE DISCOVERY LAYER CANNOT SEE ANYTHING
-------------------------------------------
`narrative_signals` held **358 phrases, one run_date, and velocity on zero of
them**. Velocity is a phrase's share measured against its OWN history
(`MIN_DAYS_FOR_VELOCITY = 4`), so with one day of signals nothing can ever be
classified `emerging` — and "is anything accelerating that nothing watches?" is the
entire question the discovery layer exists to answer.

The history was already being collected and then thrown away. `market_news` holds
**462 GDELT documents across 41 distinct days** (2026-06-14 → 2026-07-28), because
ADR-0144 added GDELT precisely for its archive property. The daily job then ran the
frequency tracker over that corpus **once**, for today, and discarded the other 40
days. This replays them.

GDELT ONLY, AND THAT IS THE LOAD-BEARING CHOICE
-----------------------------------------------
[ADR-0144](../docs/adrs/0144-a-second-provider-that-is-an-archive.md) measured both
providers on one 45-day window: Brave puts **48%** of its documents in the last 7
days, GDELT **18%**. Brave is a recency RANKING, so a share-of-voice series built
from it is "mostly zeros punctuated by spurious 100%s" — and, far worse, would clear
the minimum-observation floors with fabricated density. The backfill would defeat the
guard by satisfying it.

That argument bans a Brave backfill. It also bans a MIXED one, for a reason the ADR
did not have to state: the corpus definition would change mid-window. Days before
Brave's coverage begins would be GDELT-only and days after would be both, so every
phrase's share would jump on the day the second provider appears — a velocity spike
that is an artefact of provider mix rather than of attention. A series has to be
counted out of the same kind of corpus every day or its differences mean nothing.

So these rows are GDELT alone, every day, and they are written as
`corpus = 'archive'` (ADR-0153). They do NOT replace the combined series: the daily
job now writes both, because "what is the news about today" wants density and "what
is accelerating" wants comparability, and those are different questions with
different right answers. This script only ever touches archive rows — it deletes and
rebuilds by `(run_date, corpus)`, so the dense series is untouched by a replay.

WHAT THIS IS AND IS NOT
-----------------------
It is arithmetic over documents already persisted, with their own publication dates,
re-running the same pure functions the nightly job runs — `daily_phrase_counts` and
`build_narrative_signals`, imported, never reimplemented. No LLM, no re-fetch, no
judgement re-made. That is the same rule `backfill_regime.py` states for what may be
rebuilt and `rebuild_held_book.py` follows.

It is NOT a claim that the pipeline ran on those days. `narrative_signals` records
what the corpus said on a date, and the corpus is dated by publication.

Dry run by default. `--apply` writes.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.data.brave_client import coverage_keywords  # noqa: E402
from backend.services.narrative_tracker import (  # noqa: E402
    ARCHIVE_CORPUS,
    MIN_DAYS_FOR_VELOCITY,
    TOP_N_PERSISTED,
    build_narrative_signals,
    daily_phrase_counts,
)

#: The only provider whose date distribution can carry a share-of-voice series.
ARCHIVE_SOURCE = "gdelt"


def load_corpus_by_day(sb) -> dict[date, list[str]]:
    """Every archived headline, bucketed by its own publication date."""
    rows: list[dict] = []
    page = 0
    while True:
        batch = (
            sb.table("market_news")
            .select("headline, published_date, source")
            .eq("source", ARCHIVE_SOURCE)
            .order("published_date", desc=False)
            .range(page * 1000, page * 1000 + 999)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        page += 1

    by_day: dict[date, list[str]] = defaultdict(list)
    for r in rows:
        headline, published = r.get("headline"), r.get("published_date")
        if not headline or not published:
            continue
        by_day[date.fromisoformat(str(published)[:10])].append(headline)
    return dict(by_day)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write to Supabase")
    ap.add_argument(
        "--min-docs",
        type=int,
        default=8,
        help="skip a day with fewer headlines than this: a share computed out of "
             "three documents is 33%% by arithmetic and says nothing (default 8)",
    )
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
        return 1

    from supabase import create_client

    sb = create_client(url, key)

    by_day = load_corpus_by_day(sb)
    if not by_day:
        print(f"no '{ARCHIVE_SOURCE}' rows in market_news — nothing to replay")
        return 0

    days = sorted(by_day)
    thin = [d for d in days if len(by_day[d]) < args.min_docs]
    usable = [d for d in days if len(by_day[d]) >= args.min_docs]

    print(f"{len(days)} archived days, {sum(len(v) for v in by_day.values())} headlines")
    print(f"{len(usable)} usable at >= {args.min_docs} docs/day; {len(thin)} too thin, skipped")
    if not usable:
        return 0

    # Replay forward, accumulating history exactly as the live job sees it: each
    # day's signals are built against the days BEFORE it, never against itself or
    # the future. Anything else would leak information backwards and manufacture
    # velocity.
    history: dict[str, list[tuple[date, float]]] = defaultdict(list)
    all_rows: list[dict] = []
    first_measurable: date | None = None

    # `covered_by` needs the anchor keywords or it is NULL for every phrase,
    # which makes "watched by no anchor theme" vacuously true and the whole
    # shortlist meaningless. The first version omitted them and every row read
    # uncovered.
    #
    # These are TODAY's anchors, which answers "would the themes we now track
    # have caught this?" -- NOT "was anything watching it at the time". The
    # second question needs the theme roster as it stood on each date, which is
    # not persisted. The distinction bites hardest on AI Capex, an anchor only
    # from 2026-07-27: judged by today's keywords an earlier surge in `ai` reads
    # as COVERED, and judged by the roster of the day it was a narrative nothing
    # was watching. This prints the conservative reading.
    anchors = coverage_keywords()
    print(f"anchors: {len(anchors)} themes, judged as of TODAY")

    print(f"\n{'date':12} {'docs':>5} {'phrases':>8} {'w/vel':>6} {'emerging':>9}  top phrase")
    for d in usable:
        corpus = daily_phrase_counts(by_day[d], d)
        signals = build_narrative_signals(corpus, dict(history), anchors)

        with_vel = sum(1 for s in signals if s.velocity is not None)
        emerging = [s for s in signals if s.status == "emerging"]
        if with_vel and first_measurable is None:
            first_measurable = d

        top = max(signals, key=lambda s: s.share).phrase if signals else "—"
        print(
            f"{d.isoformat():12} {corpus.corpus_size:>5} {len(signals):>8} "
            f"{with_vel:>6} {len(emerging):>9}  {top[:36]}"
        )

        for s in signals[:TOP_N_PERSISTED]:
            all_rows.append({
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
                # These rows ARE the archive series, and mislabelling them would
                # put GDELT-only shares into the combined series' history.
                "corpus": ARCHIVE_CORPUS,
            })

        # Feed today's share forward for tomorrow's comparison.
        for s in signals:
            history[s.phrase].append((d, s.share))

    measurable = sum(1 for r in all_rows if r["velocity"] is not None)
    emerging_rows = [r for r in all_rows if r["status"] == "emerging"]
    print(
        f"\n{len(all_rows)} signal rows over {len(usable)} days · "
        f"{measurable} with velocity · {len(emerging_rows)} emerging"
    )
    print(
        f"velocity needs {MIN_DAYS_FOR_VELOCITY} observations; first measurable day: "
        f"{first_measurable.isoformat() if first_measurable else 'none'}"
    )

    uncovered = [r for r in emerging_rows if not r["covered_by"]]
    if uncovered:
        print(f"\nEMERGING AND WATCHED BY NO ANCHOR THEME ({len(uncovered)}):")
        for r in sorted(uncovered, key=lambda r: -(r["velocity"] or 0))[:15]:
            print(
                f"  {r['run_date']}  {r['phrase'][:40]:40} "
                f"share {r['share']:.3f}  velocity {r['velocity']:+.2f}"
            )

    if not args.apply:
        print("\nDRY RUN — pass --apply to write")
        return 0

    # Clear every date being rebuilt before inserting. An upsert alone would leave
    # behind phrases that were persisted for a date and are not in the recomputed
    # set, so the day would become a union of two runs rather than the corpus's
    # actual top-N — the same defect `extend_held_book` had (ADR-0152).
    for d in usable:
        (sb.table("narrative_signals")
           .delete()
           .eq("run_date", d.isoformat())
           .eq("corpus", ARCHIVE_CORPUS)
           .execute())
    for i in range(0, len(all_rows), 500):
        sb.table("narrative_signals").insert(all_rows[i : i + 500]).execute()

    print(f"\nwrote {len(all_rows)} rows across {len(usable)} run dates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
