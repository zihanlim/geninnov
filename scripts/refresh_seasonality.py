"""Build the NDX monthly returns parquet cache so the seasonality
runner can compute the ndx_seasonality reading. The runner
checks the cache (backend/data/cache/seasonality.parquet) before
falling back to a live yfinance fetch.

This script wraps the same fetch the runner would do, and writes
the parquet in the format the runner expects:
    columns = ["date", "return_pct"]  (return_pct in percent, e.g. 1.78 = 1.78%)

Run once after a clean checkout, or whenever the cache goes stale.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

from backend.services.computable_macro_runner import NDX_CACHE_PATH
from backend.services.seasonality_analytics import (
    fetch_ndx_monthly_returns_from_yfinance,
)


def main() -> int:
    print(f"[refresh_seasonality] fetching NDX monthly returns from yfinance...")
    rows = fetch_ndx_monthly_returns_from_yfinance(start_year=1990)
    if not rows:
        print("[refresh_seasonality] no rows fetched — network or yfinance error",
              file=sys.stderr)
        return 1
    df = pd.DataFrame(rows, columns=["date", "return_pct"])
    os.makedirs(os.path.dirname(NDX_CACHE_PATH), exist_ok=True)
    df.to_parquet(NDX_CACHE_PATH)
    print(
        f"[refresh_seasonality] wrote {len(df)} rows to {NDX_CACHE_PATH} "
        f"({df['date'].min()} → {df['date'].max()})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
