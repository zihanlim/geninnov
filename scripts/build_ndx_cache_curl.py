"""Bypass yfinance's rate limit by hitting Yahoo Finance's chart API
directly with curl_cffi (browser TLS fingerprint + real User-Agent).

Yahoo throttles requests that look like Python's default UA and a
suspicious TLS fingerprint. yfinance uses plain `requests` which
gets caught; curl_cffi impersonates a real browser and bypasses
the throttle.
"""
from __future__ import annotations

import os
import sys
import json
import time
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

from backend.services.computable_macro_runner import NDX_CACHE_PATH


def fetch_ndx_monthly_via_curl() -> list[tuple[date, float]]:
    """Hit Yahoo's chart API directly. Returns monthly returns in percent."""
    from curl_cffi import requests as cffi_requests

    # Yahoo's chart API. period1=1990-01-01 (Unix), period2=now.
    # interval=1mo gives monthly bars. NDX = "^NDX" (or "NDX" without caret).
    period1 = int(datetime(1990, 1, 1, tzinfo=timezone.utc).timestamp())
    period2 = int(datetime.now(timezone.utc).timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/%5ENDX"
        f"?period1={period1}&period2={period2}&interval=1mo&events=history"
    )
    # Chrome 124 impersonation — yfinance's plain `requests` is the problem
    session = cffi_requests.Session(impersonate="chrome124")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    print(f"[build_ndx_cache_curl] GET {url[:80]}...")
    r = session.get(url, headers=headers, timeout=30)
    print(f"[build_ndx_cache_curl] status={r.status_code}, size={len(r.content)}")
    if r.status_code != 200:
        print(f"[build_ndx_cache_curl] body: {r.text[:500]}")
        return []

    data = r.json()
    result = data.get("chart", {}).get("result") or []
    if not result:
        print(f"[build_ndx_cache_curl] no result in payload: {data}")
        return []
    chart = result[0]
    ts_list = chart.get("timestamp") or []
    adjclose = chart.get("indicators", {}).get("adjclose") or [{}]
    closes = adjclose[0].get("adjclose") or []

    if not ts_list or not closes:
        print(f"[build_ndx_cache_curl] empty ts/closes: ts={len(ts_list)}, closes={len(closes)}")
        return []

    # Compute month-end prices and month-over-month returns in PERCENT
    rows: list[tuple[date, float]] = []
    prev = None
    for ts, c in zip(ts_list, closes):
        if c is None:
            prev = None
            continue
        if prev is not None and prev > 0:
            ret_pct = ((c - prev) / prev) * 100.0
            d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
            # Yahoo's monthly bars are at month-START. Push to month-END so
            # the seasonality function's date arithmetic is sane.
            d = date(d.year, d.month, 28)
            rows.append((d, ret_pct))
        prev = c
    return rows


def main() -> int:
    print("[build_ndx_cache_curl] trying curl_cffi impersonation...")
    rows = fetch_ndx_monthly_via_curl()
    if not rows:
        print("[build_ndx_cache_curl] curl_cffi fetch returned no rows",
              file=sys.stderr)
        return 1
    df = pd.DataFrame(rows, columns=["date", "return_pct"])
    # Validate: should be ~400 monthly bars (1990..now = 36 years × 12 months)
    if len(df) < 100:
        print(f"[build_ndx_cache_curl] thin data ({len(df)} rows) — aborting",
              file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(NDX_CACHE_PATH), exist_ok=True)
    df.to_parquet(NDX_CACHE_PATH)
    print(
        f"[build_ndx_cache_curl] wrote {len(df)} rows to {NDX_CACHE_PATH} "
        f"({df['date'].min()} → {df['date'].max()})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
