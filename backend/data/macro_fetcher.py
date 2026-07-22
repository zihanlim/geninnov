"""
M1: L0 Macro Data Fetcher
Fetches daily macro indicators from FRED (via pandas-datareader or requests)
and yfinance (VIX, DXY, gold, oil, copper).

Stores both a "latest snapshot" (macro_indicators) and a daily time-series
(macro_daily_history) for regime lookback.

FRED series used:
  DGS10        10y Treasury yield (%)
  DGS2         2y Treasury yield (%)
  BAMLH0A0HYM2 HY credit OAS (bps)
  T10YIE       10y breakeven inflation (%)
  CPALTT01USM  CPIYoY (%)
  PCECTPI      PCE price index
  PAYEMS       NFP payrolls (k)
  UNRATE       Unemployment rate (%)

yfinance tickers:
  ^VIX         VIX spot
  ^VIX3M       VIX 3M futures
  DX-Y.NYB     DXY dollar index
  GC=F         Gold futures
  CL=F         WTI crude oil
  HG=F         Copper

Usage:
    from backend.data.macro_fetcher import MacroFetcher
    fetcher = MacroFetcher(supabase_url=..., supabase_key=...)
    snapshot = fetcher.fetch_today()
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

import pandas as pd
import requests
from supabase import Client, create_client

# ---------------------------------------------------------------------------
# FRED series catalogue
# ---------------------------------------------------------------------------
FRED_SERIES = {
    "DGS10": {"name": "10y Treasury Yield", "unit": "pct"},
    "DGS2": {"name": "2y Treasury Yield", "unit": "pct"},
    "BAMLH0A0HYM2": {"name": "HY Credit OAS", "unit": "bps"},
    "T10YIE": {"name": "10y Breakeven Inflation", "unit": "pct"},
    "CPALTT01USM": {"name": "CPI YoY", "unit": "pct"},
    "PAYEMS": {"name": "NFP Payrolls", "unit": "k"},
    "UNRATE": {"name": "Unemployment Rate", "unit": "pct"},
    "TEDRATE": {"name": "TED Spread", "unit": "bps"},
    "DPRRE": {"name": "Dallas Fed PCE RLE", "unit": "pct"},
}

YFINANCE_TICKERS = {
    "^VIX": {"name": "VIX Spot", "unit": "index"},
    "^VIX3M": {"name": "VIX 3M", "unit": "index"},
    "^SPX": {"name": "S&P 500", "unit": "pts"},
    "^NDX": {"name": "NASDAQ 100", "unit": "pts"},
    "^DJI": {"name": "Dow Jones", "unit": "pts"},
    "^RUT": {"name": "Russell 2000", "unit": "pts"},
    "DX-Y.NYB": {"name": "DXY Dollar Index", "unit": "index"},
    "GC=F": {"name": "Gold", "unit": "USD"},
    "CL=F": {"name": "WTI Crude Oil", "unit": "USD"},
    "HG=F": {"name": "Copper", "unit": "USD"},
}

# Equity index tickers (subset of YFINANCE_TICKERS for the market bar display)
EQUITY_INDICES = ["^SPX", "^NDX", "^DJI", "^RUT"]

FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_API_KEY = os.getenv("FRED_API_KEY", "")


def _fred_observation(series_id: str, start: date, end: date) -> pd.DataFrame | None:
    """Fetch a FRED series as DataFrame. Returns None on failure."""
    if not FRED_API_KEY:
        return None
    url = FRED_BASE_URL
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": start.isoformat(),
        "observation_end": end.isoformat(),
    }
    try:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        records = data.get("observations", [])
        if not records:
            return None
        df = pd.DataFrame(records)[["date", "value"]]
        df.columns = ["trading_date", series_id]
        df["trading_date"] = pd.to_datetime(df["trading_date"]).dt.date
        df[series_id] = pd.to_numeric(df[series_id], errors="coerce")
        return df
    except Exception:
        return None


def _yfinance_batch(tickers: list[str], start: date, end: date) -> pd.DataFrame:
    """Fetch multiple yfinance tickers in one go."""
    try:
        import yfinance as yf

        out = {}
        for ticker in tickers:
            try:
                df = yf.download(ticker, start=start.isoformat(), end=end.isoformat(), progress=False, auto_adjust=True)
                if df.empty:
                    continue
                # Handle multi-level columns from yfinance
                if isinstance(df.columns, pd.MultiIndex):
                    close = df["Close"][ticker]
                else:
                    close = df["Close"]
                out[ticker] = close
            except Exception:
                continue
        if not out:
            return pd.DataFrame()
        result = pd.DataFrame(out)
        result.index = pd.to_datetime(result.index).date
        result = result[result.index <= end]
        return result.reset_index().rename(columns={"index": "trading_date"})
    except ImportError:
        return pd.DataFrame()


class MacroFetcher:
    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)

    def _get_lookback_start(self, lookback_days: int = 365) -> date:
        return date.today() - timedelta(days=lookback_days)

    def fetch_fred_batch(self, end: date | None = None) -> pd.DataFrame:
        """Fetch all FRED series. Returns DataFrame with trading_date + series columns."""
        end = end or date.today()
        start = self._get_lookback_start()
        frames = []
        for series_id in FRED_SERIES:
            df = _fred_observation(series_id, start, end)
            if df is not None and not df.empty:
                frames.append(df)
        if not frames:
            return pd.DataFrame()
        result = frames[0]
        for df in frames[1:]:
            result = result.merge(df, on="trading_date", how="outer")
        result = result.sort_values("trading_date")
        return result

    def fetch_yfinance_batch(self, end: date | None = None) -> pd.DataFrame:
        """Fetch VIX, DXY, gold, oil, copper from yfinance."""
        end = end or (date.today() + timedelta(days=1))
        start = self._get_lookback_start()
        return _yfinance_batch(list(YFINANCE_TICKERS), start, end)

    def persist_daily_history(self, fred_df: pd.DataFrame, yf_df: pd.DataFrame) -> int:
        """Append daily values to macro_daily_history. Returns rows inserted."""
        if fred_df.empty and yf_df.empty:
            return 0

        rows = []
        today = date.today()

        # FRED rows
        for _, row in fred_df.iterrows():
            td = row["trading_date"]
            if hasattr(td, "isoformat"):
                td = td.isoformat()
            for series_id in FRED_SERIES:
                val = row.get(series_id)
                if pd.isna(val):
                    continue
                rows.append({
                    "series_id": series_id,
                    "value": float(val),
                    "unit": FRED_SERIES[series_id]["unit"],
                    "trading_date": td,
                })

        # yfinance rows
        for _, row in yf_df.iterrows():
            td = row["trading_date"]
            if hasattr(td, "isoformat"):
                td = td.isoformat()
            for ticker in YFINANCE_TICKERS:
                if ticker not in row or pd.isna(row.get(ticker)):
                    continue
                rows.append({
                    "series_id": ticker,
                    "value": float(row[ticker]),
                    "unit": YFINANCE_TICKERS[ticker]["unit"],
                    "trading_date": td,
                })

        if not rows:
            return 0

        self.supabase.table("macro_daily_history").upsert(rows, on_conflict="series_id,trading_date").execute()
        return len(rows)

    def upsert_latest_snapshot(self, fred_df: pd.DataFrame, yf_df: pd.DataFrame) -> int:
        """
        Compute latest non-null value per series and upsert macro_indicators.
        Returns number of series inserted.
        """
        today = date.today().isoformat()
        rows = []

        for series_id, meta in FRED_SERIES.items():
            if series_id not in fred_df.columns:
                continue
            col = fred_df[fred_df[series_id].notna()][series_id]
            if col.empty:
                continue
            rows.append({
                "series_id": series_id,
                "series_name": meta["name"],
                "value": float(col.iloc[-1]),
                "unit": meta["unit"],
                "fetch_date": today,
            })

        for ticker, meta in YFINANCE_TICKERS.items():
            if ticker not in yf_df.columns:
                continue
            col = yf_df[yf_df[ticker].notna()][ticker]
            if col.empty:
                continue
            rows.append({
                "series_id": ticker,
                "series_name": meta["name"],
                "value": float(col.iloc[-1]),
                "unit": meta["unit"],
                "fetch_date": today,
            })

        if not rows:
            return 0

        self.supabase.table("macro_indicators").upsert(rows, on_conflict="series_id,fetch_date").execute()
        return len(rows)

    def fetch_today(self) -> dict[str, dict[str, Any]]:
        """
        Full L0 fetch + persist. Returns {series_id: {name, value, unit, fetch_date}}.
        """
        fred_df = self.fetch_fred_batch()
        yf_df = self.fetch_yfinance_batch()
        self.persist_daily_history(fred_df, yf_df)
        self.upsert_latest_snapshot(fred_df, yf_df)

        # Return latest snapshot from DB
        resp = self.supabase.table("macro_indicators").select("*").eq("fetch_date", date.today().isoformat()).execute()
        snapshot = {}
        for row in resp.data:
            snapshot[row["series_id"]] = {
                "name": row["series_name"],
                "value": row["value"],
                "unit": row["unit"],
                "fetch_date": row["fetch_date"],
            }
        return snapshot

    def fetch_market_assets(self, tickers: list[str] | None = None) -> list[dict]:
        """
        Returns latest two closes for equity indices from macro_daily_history,
        with pct_change computed. Stores result in market_assets table.
        Returns [{ticker, name, current, prev_close, pct_change}].
        """
        tickers = tickers or EQUITY_INDICES
        today = date.today()
        # Last 5 trading days should cover any weekend gap
        start = (today - timedelta(days=7)).isoformat()
        end = today.isoformat()

        resp = (
            self.supabase.table("macro_daily_history")
            .select("series_id, trading_date, value")
            .in_("series_id", tickers)
            .gte("trading_date", start)
            .lte("trading_date", end)
            .order("trading_date", desc=True)
            .execute()
        )

        # Group by ticker → keep last 2 values
        by_ticker: dict[str, list] = {}
        for row in resp.data:
            sid = row["series_id"]
            if sid not in by_ticker:
                by_ticker[sid] = []
            if len(by_ticker[sid]) < 2:
                by_ticker[sid].append({"date": row["trading_date"], "value": row["value"]})

        results = []
        for ticker in tickers:
            meta = YFINANCE_TICKERS.get(ticker, {"name": ticker})
            vals = by_ticker.get(ticker, [])
            if len(vals) < 2:
                continue
            curr = vals[0]["value"]
            prev = vals[1]["value"]
            if curr is None or prev is None or prev == 0:
                continue
            pct = (curr - prev) / prev * 100
            results.append({
                "ticker": ticker,
                "name": meta["name"],
                "current": round(curr, 2),
                "prev_close": round(prev, 2),
                "pct_change": round(pct, 2),
            })

        # Persist to market_assets table
        if results:
            rows = [{"ticker": r["ticker"], "current": r["current"],
                     "prev_close": r["prev_close"], "pct_change": r["pct_change"]}
                    for r in results]
            self.supabase.table("market_assets").upsert(rows, on_conflict="ticker").execute()
        return results


if __name__ == "__main__":
    # Smoke test
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if url and key:
        f = MacroFetcher(url, key)
        snap = f.fetch_today()
        print(f"Fetched {len(snap)} series:", list(snap.keys()))
    else:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY to run")
