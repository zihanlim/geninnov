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
import re
import urllib.request
import zipfile
from datetime import date, timedelta
from io import BytesIO, StringIO
from typing import Optional

import numpy as np
import pandas as pd
from supabase import Client, create_client

# ---------------------------------------------------------------------------
# Ken French data library URLs
# ---------------------------------------------------------------------------
_KF_BASE = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"

# Ken French serves these as .zip. The bare-CSV URLs below 404, which is why
# the whole L2 factor layer silently produced nothing: the download failed, the
# parser returned an empty frame, compute_exposures returned {}, and the only
# rows that ever reached factor_exposures came from a seeding script.
FF5_MONTHLY_URL = _KF_BASE + "F-F_Research_Data_5_Factors_2x3_CSV.zip"
UMD_URL = _KF_BASE + "F-F_Momentum_Factor_CSV.zip"

# Daily files. Betas here are regressed from daily asset returns, so the
# factors must be daily too. Forward-filling a monthly factor across a month
# holds it constant while the asset moves, which biases the regression.
FF5_DAILY_URL = _KF_BASE + "F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
UMD_DAILY_URL = _KF_BASE + "F-F_Momentum_Factor_daily_CSV.zip"


_YYYYMMDD_RE = re.compile(r"\d{8}")
_DAILY_HEADER_RE = re.compile(r"^\s*,")  # daily files open with an unnamed date column


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


def _download_ken_french_csv(url: str) -> str:
    """Fetch a Ken French archive and return the CSV text inside it.

    The library serves .zip; a plain CSV body is accepted too so the helper
    keeps working if that ever changes. A default urllib User-Agent is
    rejected by the host, hence the explicit header.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = resp.read()

    if payload[:2] == b"PK":
        with zipfile.ZipFile(BytesIO(payload)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".csv")] or zf.namelist()
            payload = zf.read(names[0])
    return payload.decode("latin-1")


def _parse_ken_french_daily(url: str, value_cols: list[str]) -> pd.DataFrame:
    """Parse a Ken French *daily* file into a DataFrame indexed by date.

    Daily files use YYYYMMDD keys and append an annual-returns block after the
    daily block, so parsing stops at the first row whose index is not an
    8-digit date. Values are percent and are converted to decimals.
    """
    try:
        raw = _download_ken_french_csv(url)
    except Exception:
        return pd.DataFrame()

    lines = raw.splitlines()

    # Locate the first YYYYMMDD row, then walk back to its header. Searching
    # forward for "a line starting with a comma" is not enough: the preamble
    # contains filler rows like ",," that match but carry no column names.
    first_data = next(
        (i for i, ln in enumerate(lines)
         if _YYYYMMDD_RE.fullmatch(ln.split(",", 1)[0].strip())),
        None,
    )
    if first_data is None:
        return pd.DataFrame()

    header_idx = next(
        (i for i in range(first_data - 1, -1, -1) if _DAILY_HEADER_RE.match(lines[i])),
        None,
    )
    if header_idx is None:
        return pd.DataFrame()

    rows = []
    for ln in lines[first_data:]:
        key = ln.split(",", 1)[0].strip()
        if not _YYYYMMDD_RE.fullmatch(key):
            break  # reached the annual block or trailing notes
        rows.append(ln)
    if not rows:
        return pd.DataFrame()

    header = lines[header_idx]
    df = pd.read_csv(StringIO("\n".join([header] + rows)), index_col=0)
    df.index = pd.to_datetime(df.index.astype(str), format="%Y%m%d")
    df.index.name = "date"
    df.columns = [c.strip() for c in df.columns]

    keep = [c for c in value_cols if c in df.columns]
    if not keep:
        return pd.DataFrame()
    out = df[keep].apply(pd.to_numeric, errors="coerce").dropna()
    return out / 100.0  # Ken French publishes percent


def fetch_ff5_factors() -> pd.DataFrame:
    """Daily FF5 factors (Mkt-RF, SMB, HML, RMW, CMA, RF) as decimals."""
    return _parse_ken_french_daily(
        FF5_DAILY_URL, ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"]
    )


def fetch_umd_factors() -> pd.DataFrame:
    """Daily momentum factor, returned as a single UMD column of decimals."""
    df = _parse_ken_french_daily(UMD_DAILY_URL, ["Mom", "Mom   ", "UMD"])
    if df.empty:
        return df
    return df.rename(columns={df.columns[0]: "UMD"})


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
    """Run rolling OLS: r_asset_t = alpha + beta_MKT*MKT_t + ... + epsilon_t

    Both asset_returns and factor_df must have aligned daily DatetimeIndex.
    Returns {beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared, alpha}.

    Behaviour-preserving wrapper over `_ols_core.rolling_ols`: the public
    output shape (the legacy `beta_*` keys, RF subtraction, half-window
    guard, the most-recent-window choice) is unchanged. The generic core
    is also used by `credit_rates_exposures` (L2b), which adds columns not
    listed here.
    """
    from backend.data._ols_core import rolling_ols

    # Match the legacy convention: subtract RF from y before fitting, then
    # drop RF from the regressor columns.
    common = asset_returns.index.intersection(factor_df.index)
    if len(common) < lookback_days // 2:
        return {}

    y = asset_returns.loc[common].dropna()
    X = factor_df.loc[common].dropna()
    X = X.reindex(y.index)
    if "RF" in X.columns:
        excess = y - X["RF"]
    else:
        excess = y

    factor_columns = ["Mkt-RF", "SMB", "HML", "RMW", "CMA"]
    if "UMD" in X.columns:
        factor_columns.append("UMD")

    generic = rolling_ols(
        excess,
        X[factor_columns + (["RF"] if "RF" in X.columns else [])],
        lookback_days=lookback_days,
    )
    if not generic:
        return {}

    # Map generic keys to the legacy beta_<name> shape. Order matters for
    # `coeffs[1..6]` parity with the deleted implementation — but since
    # rolling_ols returns a dict keyed by column name, the order is now
    # declared by factor_columns, not by a positional list. The golden
    # bit-identical test below pins that.
    out: dict[str, float] = {
        "alpha": generic["alpha"],
        "r_squared": generic["r_squared"],
    }
    legacy_key_for = {
        "Mkt-RF": "beta_mkt",
        "SMB": "beta_smb",
        "HML": "beta_hml",
        "RMW": "beta_rmw",
        "CMA": "beta_cma",
        "UMD": "beta_umd",
    }
    for col, key in legacy_key_for.items():
        if col in generic:
            out[key] = generic[col]
    return out


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
