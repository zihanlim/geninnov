#!/usr/bin/env python
"""Re-fetch the un-themed archive with date-windowed requests, and persist it.

WHY THIS EXISTS SEPARATELY FROM THE NIGHTLY JOB
-----------------------------------------------
`market_news` holds the archive the discovery layer's velocity series is built on,
and it was collected before `gdelt_client` windowed its requests. Every one of those
documents came from a single request spanning 45 days against a 250-record response
cap — about 5.5 documents a day, where the same query over a 7-day window returns
250 (ADR-0154).

So the stored archive is thin for a reason that has since been fixed, and the fix
does not apply retroactively: the nightly job only ever fetches forward. This
back-fills the density the windowed client can now reach.

It is a one-off, not a scheduled step. Running the whole pipeline instead would
re-invoke L5 and spend MiniMax quota on a book nobody asked for; this touches the
corpus and nothing else.

WHAT IT DOES NOT DO
-------------------
It does not recompute `narrative_signals`. `backfill_narratives.py` does that, and
keeping them separate means a fetch failure cannot leave a half-rebuilt series
behind — the corpus lands first, then the signals are replayed over whatever landed.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.data.brave_client import MARKET_SEED_QUERIES  # noqa: E402
from backend.data.gdelt_client import (  # noqa: E402
    WINDOW_DAYS,
    fetch_market_news_gdelt,
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write to market_news")
    ap.add_argument("--days", type=int, default=45, help="lookback (default 45)")
    ap.add_argument(
        "--queries",
        type=int,
        default=len(MARKET_SEED_QUERIES),
        help="how many seed queries to run. Fewer is often no worse: measured "
             "unwindowed, four queries returned the same 462 documents as ten.",
    )
    ap.add_argument("--budget", type=float, default=900.0, help="seconds")
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
        return 1

    queries = MARKET_SEED_QUERIES[: args.queries]
    windows = -(-args.days // WINDOW_DAYS)
    print(
        f"{len(queries)} queries x {windows} windows of {WINDOW_DAYS}d "
        f"= up to {len(queries) * windows} requests, budget {args.budget:.0f}s"
    )

    items = fetch_market_news_gdelt(
        queries, lookback_days=args.days, time_budget_s=args.budget
    )
    if not items:
        print("nothing returned — leaving the stored corpus alone")
        return 0

    by_day = Counter(i["date"][:10] for i in items if i.get("date"))
    counts = sorted(by_day.values())
    print(
        f"\n{len(items)} deduped articles over {len(by_day)} days · "
        f"median {counts[len(counts) // 2]}/day · max {counts[-1]}/day · "
        f"{sum(1 for c in counts if c >= 30)} days at 30+"
    )

    if not args.apply:
        print("\nDRY RUN — pass --apply to write")
        return 0

    from supabase import create_client

    sb = create_client(url, key)

    # `market_news` is unique on (run_date, headline), so that is the conflict key.
    # A headline this fetch already stored under today's run_date is the SAME
    # document — the upsert adds the ones the earlier, thinner fetch never saw
    # rather than duplicating what it found.
    #
    # `run_date` is the day we FETCHED; `published_date` is the day the article is
    # dated, and it is the one the velocity series buckets on. Keeping them distinct
    # is what lets one fetch today deepen forty days of history.
    rows, seen = [], set()
    today = date.today().isoformat()
    for it in items:
        headline = (it.get("headline") or "").strip()
        if not headline or headline.lower() in seen:
            continue
        seen.add(headline.lower())
        rows.append({
            "run_date": today,
            "headline": headline,
            "url": it.get("url"),
            "source": "gdelt",
            "published_date": it.get("date"),
            "query": it.get("query"),
        })

    written = 0
    for i in range(0, len(rows), 500):
        sb.table("market_news").upsert(
            rows[i : i + 500], on_conflict="run_date,headline"
        ).execute()
        written += len(rows[i : i + 500])
    print(f"\nupserted {written} rows into market_news")
    print("next: scripts/backfill_narratives.py --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
