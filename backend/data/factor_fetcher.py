"""
M2: Factor Exposure Fetcher
Downloads Ken French FF5 + UMD factor portfolios from his Data Library,
then runs rolling 252d OLS regressions against asset returns to produce
per-asset factor betas (Mkt, SMB, HML, RMW, CMA, UMD).

Factor source: Ken French Data Library
  https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/
  F-F_Research_Data_5_Factors_2x3_CSV
  UMD_US_B同行_Monthly_CSV

Returns a DataFrame of factor betas per (asset, run_date).
Stores results to Supabase factor_exposures table.

Usage:
    from backend.data.factor_fetcher import FactorFetcher, fetch_factors_csv
    fetcher = FactorFetcher(supabase_url=..., supabase_key=..., data_dir=".")
    fetcher.upsert_factor_exposures(asset_returns_df, run_date=date.today())
"""

from __future__ import annotations

import os
import urllib.request
from datetime import date, timedelta
from io import StringIO
from typing import Optional

import numpy as np
import pandas as pd
from supabase import Client, create_client

# ---------------------------------------------------------------------------
# Ken French data library URLs
# ---------------------------------------------------------------------------
FF5_MONTHLY_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_5_Factors_2x3_CSV"
UMD_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_12_9_CSV"


def _parse_ken_french_monthly(url: str, value_cols: list[str]) -> pd.DataFrame:
    """
    Download and parse a Ken French monthly CSV.
    Returns DataFrame with DateIndex and value columns.
    value_cols are the expected numeric columns (e.g. ['Mkt-RF','SMB','HML','RMW','CMA','RF']).
    """
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            raw = resp.read().decode("latin-1")
    except Exception:
        return pd.DataFrame()

    # Find the main data block (skip header lines starting with whitespace or description)
    lines = raw.splitlines()
    # The file has a header row starting with "Date,"
    start_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith("Date,"):
            start_idx = i
            break
    if start_idx is None:
        return pd.DataFrame()

    csv_text = "\n".join(lines[start_idx:])
    df = pd.read_csv(StringIO(csv_text), index_col=0)

    # Ken French uses YYYYMM integer dates; convert to period then to date
    df.index = pd.to_datetime(df.index.astype(str) + "01", format="%Y%m%d")
    df.index.name = "date"

    # Keep only what we need; rename RF to avoid conflict
    cols = [c.strip() for c in df.columns]
    df.columns = cols
    keep = [c for c in value_cols if c in df.columns]
    if not keep:
        return pd.DataFrame()
    df = df[keep].apply(pd.to_numeric, errors="coerce").dropna()
    return df


def fetch_ff5_factors() -> pd.DataFrame:
    """Download and return monthly FF5 factor DataFrame."""
    return _parse_ken_french_monthly(FF5_MONTHLY_URL, ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"])


def fetch_umd_factors() -> pd.DataFrame:
    """Download and return monthly UMD (momentum) factor DataFrame."""
    return _parse_ken_french_monthly(UMD_URL, ["Mom   "]) if False else pd.DataFrame()


def _get_umd() -> pd.DataFrame:
    """Fetch UMD from the dedicated momentum file."""
    url = UMD_URL
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            raw = resp.read().decode("latin-1")
    except Exception:
        return pd.DataFrame()
    lines = raw.splitlines()
    start_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith("Date,"):
            start_idx = i
            break
    if start_idx is None:
        return pd.DataFrame()
    csv_text = "\n".join(lines[start_idx:])
    df = pd.read_csv(StringIO(csv_text), index_col=0)
    cols = [c.strip() for c in df.columns]
    df.columns = cols
    df.index = pd.to_datetime(df.index.astype(str) + "01", format="%Y%m%d")
    df.index.name = "date"
    # Ken French momentum file often has "Unnamed: 1" or "Mom   " — find it
    for col in df.columns:
        if "mom" in col.lower():
            df = df[[col]].rename(columns={col: "UMD"})
            break
    else:
        return pd.DataFrame()
    df["UMD"] = pd.to_numeric(df["UMD"], errors="coerce")
    return df.dropna()


def fetch_umd_monthly() -> pd.DataFrame:
    return _get_umd()


def _monthly_to_daily(
    monthly_factor: pd.DataFrame,
    trading_days: pd.DatetimeIndex,
) -> pd.DataFrame:
    """
    Forward-fill monthly factor values to daily trading-day index.
    """
    # Reindex to daily: each month covers days until the next month starts
    daily_index = trading_days
    out = monthly_factor.reindex(daily_index, method="ffill")
    return out.fillna(method="ffill")


def rolling_regression(
    asset_returns: pd.Series,
    factor_df: pd.DataFrame,
    lookback_days: int = 252,
) -> dict[str, float]:
    """
    Run rolling OLS: r_asset_t = alpha + beta_MKT*MKT_t + ... + epsilon_t

    Both asset_returns and factor_df must have aligned daily DatetimeIndex.
    Returns {beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared, alpha}.
    """
    factors = ["Mkt-RF", "SMB", "HML", "RMW", "CMA"]
    if "UMD" in factor_df.columns:
        factors.append("UMD")

    # Align
    common = asset_returns.index.intersection(factor_df.index)
    if len(common) < lookback_days // 2:
        return {}

    y = asset_returns.loc[common].dropna()
    X = factor_df.loc[common].dropna()
    X = X.reindex(y.index)
    # Subtract RF from asset excess return
    if "RF" in X.columns:
        excess = y - X["RF"]
    else:
        excess = y

    # Rolling window
    betas = {}
    n = len(excess)
    if n < lookback_days:
        return {}

    windows = []
    for i in range(lookback_days, n + 1):
        y_win = excess.iloc[i - lookback_days:i]
        x_win = X[factors].iloc[i - lookback_days:i]
        if y_win.isna().any() or x_win.isna().any(axis=None):
            continue
        try:
            # OLS via np.linalg
            X_mat = np.column_stack([np.ones(len(x_win)), x_win.values])
            coeffs, residuals, rank, s = np.linalg.lstsq(X_mat, y_win.values, rcond=None)
            y_pred = X_mat @ coeffs
            ss_res = np.sum((y_win.values - y_pred) ** 2)
            ss_tot = np.sum((y_win.values - np.mean(y_win.values)) ** 2)
            r2 = 1 - ss_res / ss_tot if ss_tot != 0 else 0
            window_result = {
                "alpha": float(coeffs[0]),
                "beta_mkt": float(coeffs[1]),
                "beta_smb": float(coeffs[2]),
                "beta_hml": float(coeffs[3]),
                "beta_rmw": float(coeffs[4]),
                "beta_cma": float(coeffs[5]),
                "r_squared": float(r2),
            }
            if "UMD" in factors and len(coeffs) > 6:
                window_result["beta_umd"] = float(coeffs[6])
            windows.append(window_result)
        except Exception:
            continue

    if not windows:
        return {}

    # Return the most recent window's betas
    return windows[-1]


class FactorFetcher:
    def __init__(self, supabase_url: str, supabase_key: str, data_dir: str = "."):
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.data_dir = data_dir

    def fetch_and_cache_factors(self) -> pd.DataFrame:
        """
        Download FF5 + UMD monthly, convert to daily via ffill.
        Returns daily factor DataFrame. Caches in data_dir.
        """
        ff5 = fetch_ff5_factors()
        umd = fetch_umd_monthly()
        if ff5.empty:
            return pd.DataFrame()
        if not umd.empty:
            ff5 = ff5.join(umd, how="left")
        # Save
        cache_path = os.path.join(self.data_dir, "factors_daily.csv")
        ff5.to_csv(cache_path)
        return ff5

    def load_cached_factors(self) -> pd.DataFrame:
        cache_path = os.path.join(self.data_dir, "factors_daily.csv")
        if os.path.exists(cache_path):
            df = pd.read_csv(cache_path, index_col=0, parse_dates=True)
            df.index = pd.to_datetime(df.index)
            return df
        return self.fetch_and_cache_factors()

    def compute_exposures(
        self,
        asset: str,
        asset_returns: pd.Series,
        run_date: date,
        lookback_days: int = 252,
    ) -> dict:
        """
        Given daily log-returns of an asset, compute factor betas.
        Returns a dict ready for the factor_exposures table.
        """
        factor_df = self.load_cached_factors()
        if factor_df.empty:
            return {}
        # Limit to up to run_date
        cutoff = pd.Timestamp(run_date)
        factor_df = factor_df[factor_df.index <= cutoff]
        if len(factor_df) < lookback_days:
            return {}

        result = rolling_regression(asset_returns, factor_df, lookback_days)
        if not result:
            return {}
        result["asset"] = asset
        result["run_date"] = run_date.isoformat()
        result["lookback_days"] = lookback_days
        return result

    def upsert_exposures(self, exposures: list[dict]) -> int:
        if not exposures:
            return 0
        self.supabase.table("factor_exposures").upsert(
            exposures,
            on_conflict="asset,run_date,lookback_days",
        ).execute()
        return len(exposures)

    def get_trading_dates(self, days: int = 365) -> pd.DatetimeIndex:
        """Fetch trading dates from theme_signals_history dates."""
        resp = self.supabase.table("theme_signals_history").select("signal_date").limit(days * 2).execute()
        if not resp.data:
            # Fall back: generate business day range
            from pandas.tseries.offsets import BDay
            today = date.today()
            dates = pd.bdate_range(end=today, periods=days)
            return dates
        dates = sorted(set(row["signal_date"] for row in resp.data if row["signal_date"]))
        return pd.DatetimeIndex(dates)
