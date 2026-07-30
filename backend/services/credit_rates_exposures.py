"""Per-asset sensitivity to duration, broad credit and quality premium (L2b).

This module is SHADOW. It persists and validates but sizes nothing and
changes no published figure. S (a fallen-angel stress scenario) and B
(publish the credit-lens book) each opt in deliberately in their own ADR.

Why a duration leg at all, when the critique asked for credit. Three reasons.
The rates sleeve is currently invisible to the risk model and is a large part
of any credit book. Credit ETF returns are jointly driven by rates and
spreads, so estimating spread sensitivity without controlling for rates
attributes rate moves to spreads. And — decisively — duration is the only
leg with a known correct answer, which is what makes the acceptance
fixture possible.

This file imports `rolling_ols` from `backend/data/_ols_core.py`, NOT
`rolling_regression` from `backend/data/factor_fetcher.py`. The latter is
the FF5+UMD-specialised wrapper, kept bit-identical to its pre-extraction
output by a golden test. The former is the generic engine the two-variant
design needs.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

# Series the legs require. Lifted from macro_fetcher.FRED_SERIES — kept as a
# module-level constant rather than an import so this file is testable
# without booting the macro fetcher.
_REQUIRED_SERIES: tuple[str, ...] = ("DGS10", "BAMLC0A0CM", "BAMLH0A0HYM2")

# Series for the joint marginal fit. Order matters only for the coefficient
# names in the output dict.
_MARGINAL_FACTORS: tuple[str, ...] = ("d_ust10", "d_ig", "d_qual")

# Page-cap on macro_daily_history reads, mirroring backfill_regime.SERIES_PAGE_CAP.
# A response that lands exactly at this size has probably truncated the OLD end
# (PostgREST's 1000-row silent cap), which we surface as insufficient_history.
_SERIES_PAGE_CAP = 1000


def _series_window(sb, series_id: str, as_of: date, lookback_days: int) -> pd.Series:
    """Read `series_id` from `macro_daily_history` bounded by `as_of`. Returns
    a date-indexed pd.Series of floats. Raises ValueError if the series is
    absent (so the caller can decide between status='insufficient_history'
    and status='degenerate')."""
    from datetime import timedelta
    start = as_of - timedelta(days=lookback_days)
    rows = (
        sb.table("macro_daily_history")
        .select("series_id, trading_date, value")
        .eq("series_id", series_id)
        .gte("trading_date", start.isoformat())
        .lte("trading_date", as_of.isoformat())
        .order("trading_date")
        .execute()
        .data
        or []
    )
    if not rows:
        raise ValueError(f"macro_daily_history has no rows for series_id={series_id}")
    if len(rows) >= _SERIES_PAGE_CAP:
        # Probably truncated at the OLD end. Surface this honestly.
        raise ValueError(
            f"macro_daily_history.{series_id} hit {_SERIES_PAGE_CAP}-row page cap; "
            f"the oldest dates may be missing."
        )
    df = pd.DataFrame(rows)
    df["trading_date"] = pd.to_datetime(df["trading_date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    out = df.dropna().set_index("trading_date")["value"].sort_index()
    if out.empty:
        raise ValueError(f"macro_daily_history.{series_id} has no numeric values")
    return out


def build_credit_legs(
    sb,
    *,
    lookback_days: int = 252,
    as_of: date | None = None,
) -> pd.DataFrame:
    """Three differenced, bp-expressed legs on one DatetimeIndex.

    Returns a DataFrame with columns `d_ust10`, `d_ig`, `d_qual` whose index
    is the trading dates present in ALL THREE underlying series. Each leg
    is `(value_t - value_{t-1}) * 100`, so the value is in basis points
    and a positive number means the leg moved AGAINST a bondholder.

    Raises ValueError when any required series is missing — the caller
    picks the status between `insufficient_history` and `degenerate`.
    """
    if as_of is None:
        as_of = date.today()

    dgs10 = _series_window(sb, "DGS10", as_of, lookback_days)
    ig_oas = _series_window(sb, "BAMLC0A0CM", as_of, lookback_days)
    hy_oas = _series_window(sb, "BAMLH0A0HYM2", as_of, lookback_days)

    # Align on intersection so a missing day in any series drops that day
    # from ALL three legs. A leg computed on a non-intersection would be
    # date-mismatched against the asset return series at the fit.
    common = dgs10.index.intersection(ig_oas.index).intersection(hy_oas.index)
    if len(common) < 2:
        raise ValueError(
            "credit legs have <2 dates of overlap "
            f"(DGS10={len(dgs10)}, IG={len(ig_oas)}, HY={len(hy_oas)})"
        )

    dgs10 = dgs10.loc[common]
    ig_oas = ig_oas.loc[common]
    hy_oas = hy_oas.loc[common]

    # Percent to bp: FRED reports in percent (2.69 = 2.69% = 269bp). x100 once.
    # Apply on the diff, not the level — a level of 4.30% is 430bp and we
    # want daily changes in bp.
    d_ust10 = dgs10.diff() * 100.0
    d_ig = ig_oas.diff() * 100.0
    d_qual = (hy_oas - ig_oas).diff() * 100.0

    out = pd.DataFrame(
        {"d_ust10": d_ust10, "d_ig": d_ig, "d_qual": d_qual},
        index=common,
    ).dropna()
    if out.empty:
        raise ValueError("credit legs are empty after differencing")
    return out
