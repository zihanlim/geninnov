"""Backfill macro_daily_history to ~3 years for the credit-rates legs.

The credit/rates exposures fit (backend/services/credit_rates_exposures.py)
runs on a 252-day rolling window and needs at least that many observations
of macro_daily_history for DGS10, BAMLC0A0CM and BAMLH0A0HYM2; with the
default macro_fetcher._get_lookback_start=365 the live series is one bad
intersection (a holiday, a FRED outage, a skipped nightly run) away from
sitting under the floor. Three years buys both that floor and the stability
analysis — rolling the 252-day window back through history to ask whether
an asset's spread beta is stable or drifting rather than a single fitted
snapshot.

This script is SAFE TO BACKFILL — unlike L1 HypeScore and L5's book.
FRED history is a start-date parameter and is identical whenever it is
fetched (bar a rare source revision); it carries no mention_count, no
sentiment, no LLM thesis that would need to be presented as having been
"published" on a day it was not. scripts/backfill_regime.py exists on the
same premise, and its module docstring records why the other two layers
are deliberately NOT backfillable. Nothing here changes that reasoning.

This script reuses MacroFetcher (backend/data/macro_fetcher.py) rather than
reimplementing the FRED fetch. That matters more than it looks: the fetcher
owns the percent-unit serialisation and the trading_date normalisation, and
a backfill with its own copy of that logic is exactly how a backfill
diverges from the nightly run by one row — silently, since both write to
the same table.

Only the requested `--series` columns are ever written here (default: the
three credit-rates legs). MacroFetcher.fetch_fred_batch() always pulls the
full FRED_SERIES catalogue in one call — there is no per-series fetch —
so this script fetches the wide result and drops every column not asked
for before persisting, rather than writing all twelve series when three
were requested. The nightly `daily_refresh.py` path is what keeps the rest
of the catalogue current; this script's scope stays tight to what
credit_rates_exposures.py actually reads.

`--overwrite` follows backfill_regime.py's contract: without it, dates that
already have a row for a given series are left untouched (existing values
are nulled out of the fetched frame before persisting, so persist's own
skip-if-NaN check — not a reimplementation of it — is what protects them).
With it, every date in range is written, which only matters if FRED has
revised a value since it was first backfilled.

Usage:
    python -m scripts.backfill_macro                       # dry run
    python -m scripts.backfill_macro --apply                # write
    python -m scripts.backfill_macro --apply --overwrite    # re-fetch existing rows too
    python -m scripts.backfill_macro --from 2024-01-01 --to 2026-07-30
    python -m scripts.backfill_macro --series DGS10,BAMLC0A0CM
"""
from __future__ import annotations

import argparse
import os
from datetime import date, timedelta
from typing import Optional

import pandas as pd
from supabase import Client, create_client

from backend.data.macro_fetcher import MacroFetcher

# The three series build_credit_legs (credit_rates_exposures.py) requires.
# Backfilling only these keeps the scope tight; the macro_fetcher nightly
# path continues to populate the full FRED_SERIES catalog for everything
# else.
DEFAULT_SERIES: tuple[str, ...] = ("DGS10", "BAMLC0A0CM", "BAMLH0A0HYM2")

# Three years in calendar days — comfortably more than the 252 trading days
# the fit needs, with room for the rolling stability analysis besides.
_LOOKBACK_DAYS = 3 * 365

#: PostgREST caps a response at 1000 rows regardless of `.limit()`. A single
#: series over 3 years is ~780 rows so one page is normally enough, but a
#: wider --from/--to or a daily (not just business-day) series could cross
#: it — see backfill_regime.py's PAGE constant for the same guard.
PAGE = 1000


def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Backfill macro_daily_history for credit/rates exposures.")
    ap.add_argument("--from", dest="lo", type=date.fromisoformat, default=None)
    ap.add_argument("--to", dest="hi", type=date.fromisoformat, default=None)
    ap.add_argument("--apply", action="store_true", help="Write rows. Without it, this only reports.")
    ap.add_argument(
        "--overwrite",
        action="store_true",
        help="Also rewrite dates that already have a row. Off by default: the existing rows are "
             "the PUBLISHED record and a backfill should not quietly restate them.",
    )
    ap.add_argument(
        "--series",
        default=",".join(DEFAULT_SERIES),
        help=f"Comma-separated FRED series IDs (default: {','.join(DEFAULT_SERIES)}).",
    )
    return ap.parse_args(argv)


def _fetch_series(sb: Client, series_id: str, lo: date, hi: date) -> list[dict]:
    """Read macro_daily_history for one series in [lo, hi], paginated.

    PostgREST caps a response at 1000 rows; see PAGE above.
    """
    rows: list[dict] = []
    start = 0
    while True:
        batch = (
            sb.table("macro_daily_history")
            .select("trading_date, value, unit")
            .eq("series_id", series_id)
            .gte("trading_date", lo.isoformat())
            .lte("trading_date", hi.isoformat())
            .order("trading_date")
            .range(start, start + PAGE - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        start += PAGE
    return rows


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv)

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not (url and key):
        print("[backfill_macro] SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
        return 1

    sb: Client = create_client(url, key)
    hi = args.hi or date.today()
    lo = args.lo or (hi - timedelta(days=_LOOKBACK_DAYS))
    series_ids = tuple(s.strip() for s in args.series.split(",") if s.strip())

    existing_by_series: dict[str, set] = {}
    for series_id in series_ids:
        existing_rows = _fetch_series(sb, series_id, lo, hi)
        existing_by_series[series_id] = {date.fromisoformat(r["trading_date"]) for r in existing_rows}
        print(f"[backfill_macro] {series_id}: {len(existing_rows)} row(s) already in [{lo}, {hi}].")

    if not args.apply:
        print("[backfill_macro] DRY RUN — nothing written.")
        return 0

    mf = MacroFetcher(url, key)
    # fetch_fred_batch() always calls self._get_lookback_start() with no
    # override, so the only way to widen the window to `lo` is to replace
    # the bound method on this instance for the duration of the call —
    # rather than reimplementing the FRED request here.
    original_lookback = mf._get_lookback_start
    mf._get_lookback_start = lambda days=365: lo - timedelta(days=1)
    try:
        fred_df = mf.fetch_fred_batch(end=hi)
    finally:
        mf._get_lookback_start = original_lookback

    if fred_df is None or fred_df.empty:
        print("[backfill_macro] FRED returned no rows for the window — nothing written "
              "(check FRED_API_KEY).")
        return 0

    # Keep only the requested series' columns. fetch_fred_batch() returns the
    # FULL FRED_SERIES catalog merged into one wide frame; persist_daily_history
    # would otherwise write every one of those columns, not just the three
    # this script was asked for.
    keep_cols = ["trading_date"] + [c for c in series_ids if c in fred_df.columns]
    missing = [c for c in series_ids if c not in fred_df.columns]
    if missing:
        print(f"[backfill_macro] WARNING: FRED returned no data at all for {missing} "
              f"in [{lo}, {hi}] — not in FRED_SERIES, or the request failed.")
    fred_df = fred_df[keep_cols]

    if not args.overwrite:
        # Null out cells for dates that already have a row for that series so
        # persist_daily_history's own pd.isna skip — not a copy of it — leaves
        # the published value untouched.
        for series_id in series_ids:
            if series_id not in fred_df.columns:
                continue
            already = existing_by_series.get(series_id, set())
            if not already:
                continue
            mask = fred_df["trading_date"].isin(already)
            fred_df.loc[mask, series_id] = pd.NA

    written = mf.persist_daily_history(fred_df, pd.DataFrame())
    print(f"[backfill_macro] wrote {written} row(s) across {len(series_ids)} series in [{lo}, {hi}].")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
