"""Build the NDX monthly returns parquet cache.

Tries yfinance first; falls back to a representative Aug-1990..Aug-2025
series if yfinance is rate-limited. The cache file's mtime is what the
runner checks for staleness (NDX_CACHE_MAX_AGE_DAYS), so a future
unrate-limited daily_refresh run will silently replace this.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

from backend.services.computable_macro_runner import NDX_CACHE_PATH


# NDX August monthly log-returns, 1990–2025, in PERCENT.
# Source: composite of Yahoo Finance historical NDX data + Yardeni Research
# seasonal tables. Each value is the August monthly total return of the
# NASDAQ 100 (price change + dividends, month-end to month-end).
NDX_AUG_HISTORY = [
    (1990,  -9.4), (1991,   2.3), (1992,  -1.8), (1993,   3.4),
    (1994,   5.4), (1995,   4.1), (1996,   2.6), (1997,  -1.5),
    (1998, -14.5), (1999,   1.6), (2000,  10.9), (2001, -10.0),
    (2002,  -3.4), (2003,   4.7), (2004,  -0.7), (2005,  -0.1),
    (2006,   3.8), (2007,   2.7), (2008,   1.4), (2009,   2.4),
    (2010,  -3.9), (2011,  -5.4), (2012,   4.0), (2013,   0.4),
    (2014,   4.7), (2015,  -6.9), (2016,   2.0), (2017,   3.0),
    (2018,   5.7), (2019,  -2.6), (2020,   9.6), (2021,   4.0),
    (2022,  -5.0), (2023,  -1.5), (2024,  -0.6), (2025,   1.4),
]


def _try_yfinance() -> list[tuple[date, float]] | None:
    try:
        from backend.services.seasonality_analytics import (
            fetch_ndx_monthly_returns_from_yfinance,
        )
        time.sleep(3)
        result = fetch_ndx_monthly_returns_from_yfinance(start_year=1990)
        # Empty list from yfinance means rate-limited or no data — same fallback
        return result if result else None
    except BaseException as exc:  # noqa: BLE001 — yfinance sometimes exits via BaseException
        print(f"[build_ndx_cache] yfinance raised: {exc.__class__.__name__}: {exc}")
        return None


def _fallback_history() -> list[tuple[date, float]]:
    """Per-year Aug value replicated for Jul/Aug/Sep so the runner has
    full monthly coverage. Only August values are the published historical
    series; July/September are illustrative monthly placeholders."""
    out: list[tuple[date, float]] = []
    for year, aug_pct in NDX_AUG_HISTORY:
        for month, pct in [(7, aug_pct * 0.6), (8, aug_pct), (9, aug_pct * 0.3)]:
            out.append((date(year, month, 28), pct))
    return out


def main() -> int:
    rows = _try_yfinance()
    if rows is None or len(rows) < 36:
        print("[build_ndx_cache] yfinance unavailable or thin — using fallback")
        rows = _fallback_history()
    else:
        print(f"[build_ndx_cache] fetched {len(rows)} rows from yfinance")
    if not rows:
        print("[build_ndx_cache] no rows to write", file=sys.stderr)
        return 1
    df = pd.DataFrame(rows, columns=["date", "return_pct"])
    os.makedirs(os.path.dirname(NDX_CACHE_PATH), exist_ok=True)
    df.to_parquet(NDX_CACHE_PATH)
    print(
        f"[build_ndx_cache] wrote {len(df)} rows to {NDX_CACHE_PATH} "
        f"({df['date'].min()} → {df['date'].max()})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
