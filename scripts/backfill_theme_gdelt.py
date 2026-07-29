"""Backfill `theme_news` with GDELT articles, per anchor theme.

WHY THIS IS POSSIBLE AT ALL, when `backfill_regime.py` says L1 is not backfillable.

That refusal is PROVIDER-SPECIFIC, and worth quoting because it is the reason this
script is narrow:

    "mention_count and sentiment come from Brave News and Reddit, which are
     recency-biased. Nothing can tell you how much attention a theme drew on
     2025-11-14."

GDELT does not have that property. It is an archive — 18% of a 45-day window falls
in the last 7 days against Brave's 48%, and 40 of 45 days are populated (ADR-0144).
So it CAN answer for a day Brave cannot, which is exactly what a backfill needs.

WHAT THIS DELIBERATELY DOES NOT TOUCH, and why.

`theme_signals_history` is left completely alone: not `mention_count_1d`, not
`hype_score`, not momentum, not `price_corr`. The rest of that same docstring is the
reason —

    "Backfilling the half that is available would produce a number that is not
     HypeScore while being stored in the column that says it is."

Rewriting `mention_count_1d` for a past run would leave the `hype_score` beside it
computed from a DIFFERENT count. Same failure, one column over. The published series
stays exactly as it was published; this script only adds documents to the corpus
those numbers were drawn from, tagged with their provider so a consumer can choose.

DATES. Rows carry `run_date` = today (when we fetched) and `published_date` = the
article's own date, which is the split ADR-0158 exists to enforce. One GDELT call
returns weeks of history, so every row from one pass shares a `run_date` and spans
many `published_date`s. Anything counting a DAY must count `published_date`.

COLLISIONS. `theme_news` is unique on `(theme_id, run_date, headline)` — with no
`source` in the key. So a GDELT row matching a headline Brave already stored today
would OVERWRITE it and relabel its provider. Existing keys are read first and
collisions skipped, which is also semantically right: if both providers returned the
same headline today, Brave already recorded it.

Dry-run by default. `--apply` writes.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.data.brave_client import THEME_KEYWORDS  # noqa: E402
from backend.data.gdelt_client import fetch_theme_news_gdelt  # noqa: E402

GDELT_SOURCE = "gdelt"
DEFAULT_LOOKBACK_DAYS = 45
#: Supabase caps a PostgREST response at 1000 rows regardless of the limit asked
#: for, so existing-key reads are paged. Learned by shipping a chart whose trend was
#: a truncation artifact of exactly this cap.
PAGE = 1000


def _supabase():
    from supabase import create_client

    # Same pattern as `check_data_integrity` and `watch_phrases`: local runs read
    # `.env`, CI runs already have the secrets in the environment and this is a no-op.
    # Without it the documented usage below does not work on a developer's machine,
    # which is the whole of the bug that fix was written for.
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise SystemExit(
            "Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or put them in .env). This "
            "script writes to theme_news; there is no offline mode that would mean "
            "anything."
        )
    return create_client(url, key)


def load_themes(sb) -> dict[str, str]:
    """Theme name -> id, for the anchors we have keywords for."""
    rows = sb.table("themes").select("id, name").execute().data or []
    return {r["name"]: r["id"] for r in rows}


def existing_keys(sb, theme_ids: list[str], run_date: str) -> set[tuple[str, str]]:
    """(theme_id, headline) already stored for this run_date, paged past the row cap."""
    seen: set[tuple[str, str]] = set()
    offset = 0
    while True:
        res = (
            sb.table("theme_news")
            .select("theme_id, headline")
            .eq("run_date", run_date)
            .in_("theme_id", theme_ids)
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            seen.add((r["theme_id"], r["headline"]))
        if len(rows) < PAGE:
            return seen
        offset += PAGE


def build_rows(
    fetched: dict[str, list[dict]],
    theme_ids: dict[str, str],
    run_date: str,
    skip: set[tuple[str, str]],
) -> tuple[list[dict], Counter]:
    """Shape GDELT articles into theme_news rows, dropping collisions and undated items."""
    rows: list[dict] = []
    stats: Counter = Counter()
    for theme, items in fetched.items():
        tid = theme_ids.get(theme)
        if tid is None:
            stats[f"no theme row: {theme}"] += len(items)
            continue
        for it in items:
            headline = (it.get("headline") or "").strip()
            published = (it.get("date") or "")[:10]
            if not headline:
                stats["dropped: no headline"] += 1
                continue
            if not published:
                # ADR-0066: an undated item belongs in no day. Stamping it with today
                # would invent the one field the whole series buckets on.
                stats["dropped: undated"] += 1
                continue
            if (tid, headline) in skip:
                stats["skipped: already stored today"] += 1
                continue
            skip.add((tid, headline))  # also dedupes within this pass
            rows.append(
                {
                    "theme_id": tid,
                    "run_date": run_date,
                    "source": GDELT_SOURCE,
                    "headline": headline,
                    "published_date": published,
                    "url": it.get("url"),
                }
            )
            stats[f"kept: {theme}"] += 1
    return rows, stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write; otherwise dry-run")
    ap.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS)
    ap.add_argument("--themes", help="comma-separated subset, for a cheap trial run")
    args = ap.parse_args()

    sb = _supabase()
    run_date = date.today().isoformat()

    keywords = dict(THEME_KEYWORDS)
    if args.themes:
        wanted = {t.strip() for t in args.themes.split(",") if t.strip()}
        missing = wanted - set(keywords)
        if missing:
            raise SystemExit(f"unknown theme(s): {sorted(missing)}")
        keywords = {k: v for k, v in keywords.items() if k in wanted}

    theme_ids = load_themes(sb)
    unknown = [t for t in keywords if t not in theme_ids]
    if unknown:
        # Named rather than skipped silently: a keyword list with no themes row is a
        # theme the pipeline scores but the database does not know about.
        print(f"WARNING: no `themes` row for {unknown} — their articles cannot be stored.")

    print(f"Fetching GDELT for {len(keywords)} theme(s), {args.lookback_days}d lookback.")
    print("Expect roughly "
          f"{len(keywords) * -(-args.lookback_days // 7) * 5}s of pacing at 1 req/5s.\n")
    fetched = fetch_theme_news_gdelt(keywords, lookback_days=args.lookback_days)

    ids = [theme_ids[t] for t in keywords if t in theme_ids]
    skip = existing_keys(sb, ids, run_date) if ids else set()
    print(f"\n{len(skip)} (theme, headline) pairs already stored for run_date {run_date}.")

    rows, stats = build_rows(fetched, theme_ids, run_date, skip)

    print("\n--- what this pass produced ---")
    for k, v in sorted(stats.items()):
        print(f"  {k}: {v}")
    by_day: Counter = Counter(r["published_date"] for r in rows)
    print(f"\n{len(rows)} new rows across {len(by_day)} publication days.")
    if by_day:
        span = f"{min(by_day)} .. {max(by_day)}"
        print(f"  span {span}; median day {sorted(by_day.values())[len(by_day)//2]} docs")

    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        return 0
    if not rows:
        print("\nNothing to write.")
        return 0

    written = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i : i + 500]
        sb.table("theme_news").upsert(
            chunk, on_conflict="theme_id,run_date,headline"
        ).execute()
        written += len(chunk)
    print(f"\nWrote {written} rows to theme_news (source={GDELT_SOURCE}).")
    print("theme_signals_history was NOT modified — no published number moved.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
