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

from backend.data._ols_core import ols_window as _ols_window

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

# ---------------------------------------------------------------------------
# THE UNIT CONVENTION, and why it is two explicit constants rather than one
# fudge factor.
#
# A published beta here must read as PERCENT RETURN PER 100BP, so that
# `-beta_ust10` is effective duration in years: TLT at ~17y duration loses
# ~17% when 10y yields rise 100bp.
#
# The two inputs arrive in different units, and neither is the one we publish:
#   * `asset_returns` comes from `close.pct_change()` -> DECIMAL (-0.17 = -17%)
#   * `legs` come from `build_credit_legs` -> BASIS POINTS (a 25bp day is 25.0)
#
# Regressing decimal-on-bp yields -17/10000 = -0.0017 for TLT, which is a
# correct number in the wrong unit and reads as "no rate sensitivity" to
# anyone who does not know the convention. Publishing it would be the
# ADR-0023 fabrication failure in miniature: a real computation whose LABEL
# lies about what it measures.
#
# So both sides are converted at the fit, and the conversion is named:
#   return_pct       = return_decimal * 100
#   leg_hundred_bp   = leg_bp / 100
#   beta             = return_pct / leg_hundred_bp
#
# Do not "simplify" these into a single 10000. The whole defect this fixes
# was a single scale factor nobody could dimension-check by reading it.
_PCT_PER_DECIMAL = 100.0      # decimal return -> percent return
_BP_PER_100BP = 100.0         # basis points -> hundreds of basis points


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


def compute_total_betas(
    asset_returns: pd.Series,
    legs: pd.DataFrame,
    lookback_days: int,
) -> dict[str, float]:
    """Three univariate OLS fits, one per leg.

    Each fit is `r_asset = alpha + beta_leg * leg + epsilon` over the most
    recent `lookback_days` of intersection between asset_returns and legs.
    The returned betas are interpretable (the spec's "total" variant) but
    include whatever the equity factors would also have explained — a
    scenario that shocks both equity and spreads while using total betas
    double-counts. They MUST NEVER drive a scenario.

    Returns keys `beta_ust10` / `beta_ig` / `beta_qual` / `r2_*` / `n_obs`.
    Values are `float('nan')` when the fit window is too short — never 0.0.

    Betas are PERCENT RETURN PER 100BP (see the unit-convention block at the
    top of this module): `-beta_ust10` is effective duration in years.
    """
    common = asset_returns.index.intersection(legs.index)
    n_obs = len(common)
    nan = float("nan")
    out: dict[str, float] = {
        "beta_ust10": nan, "beta_ig": nan, "beta_qual": nan,
        "r2_ust10": nan, "r2_ig": nan, "r2_qual": nan,
        "n_obs": n_obs,
    }
    if n_obs < lookback_days:
        return out

    # n_obs is the regression window, not the intersection size.
    out["n_obs"] = lookback_days
    # Decimal returns -> percent, so the fitted coefficient is per-percent.
    y = asset_returns.loc[common] * _PCT_PER_DECIMAL
    for leg_name in _MARGINAL_FACTORS:
        # Basis points -> hundreds of basis points, so the coefficient is
        # per-100bp. r_squared is scale-invariant and is unaffected by both.
        x = legs[leg_name].loc[common] / _BP_PER_100BP
        # Reuse the OLS core via a one-column DataFrame — but fit on the
        # SAME window the rolling fit would use (the most recent
        # `lookback_days`), not on the whole intersection.
        y_win = y.iloc[-lookback_days:]
        x_win = x.iloc[-lookback_days:]
        result = _ols_window(y_win, pd.DataFrame({leg_name: x_win}))
        if result is None:
            # Singular or NaN; leave NaN rather than guess.
            continue
        out[f"beta_{leg_name[2:]}"] = result[leg_name]
        out[f"r2_{leg_name[2:]}"] = result["r_squared"]
    return out


class FactorsUnavailable(Exception):
    """FF5+UMD could not be loaded, so the MARGINAL variant cannot be
    computed. The TOTAL variant may still be computed and the row written
    with status='measured' and the marginal columns NULL.

    A typed signal rather than a returned sentinel, because the caller has
    to distinguish "the equity factors were missing" (partial success, a
    row is still worth writing) from "this asset has too little history"
    (insufficient_history) and from "the design matrix is singular"
    (degenerate). A None or a NaN collapses those three into one.
    """


def _ff5umd_columns(factor_df: pd.DataFrame) -> list[str]:
    """The FF5+UMD regressors present in `factor_df`, excluding RF.

    RF is not a factor; it is the funding rate subtracted from the asset's
    return to form the excess return, exactly as `rolling_regression` does.
    Including it as a regressor would fit the risk-free rate as if it were
    a risk premium.
    """
    return [c for c in factor_df.columns
            if c in ("Mkt-RF", "SMB", "HML", "RMW", "CMA", "UMD")]


def _residualise(leg: pd.Series, factor_df: pd.DataFrame) -> pd.Series:
    """Regress `leg` on the FF5+UMD columns of `factor_df`; return the residual.

    The residual is by construction orthogonal to every factor it was
    regressed on — it is the part of the credit or rate move that the equity
    factors do NOT explain. This is what lets the marginal variant enter a
    joint regression alongside FF5+UMD without the multicollinearity that
    raw delta-OAS would introduce, and — the reason it matters here — it is
    why the published `factor_exposures` betas do not move: the joint fit
    adds no new information to the equity block, so nothing in that block
    is re-estimated (ADR-0093 obligation avoided rather than discharged).

    Raises FactorsUnavailable when the factors cannot support a fit.
    """
    cols = _ff5umd_columns(factor_df)
    if not cols:
        raise FactorsUnavailable("no FF5/UMD columns in factor_df")
    common = leg.index.intersection(factor_df.index)
    if len(common) < 30:
        raise FactorsUnavailable(
            f"FF5/UMD factor intersection is {len(common)} sessions, needs 30")
    y = leg.loc[common].dropna()
    X = factor_df.loc[common, cols].dropna().reindex(y.index)
    if X.empty or y.empty or X.isna().any(axis=None):
        raise FactorsUnavailable("FF5/UMD residualisation input is empty")
    result = _ols_window(y, X)
    if result is None:
        raise FactorsUnavailable("FF5/UMD residualisation produced a singular matrix")
    fitted = X.values @ np.array([result[c] for c in cols]) + result["alpha"]
    resid = pd.Series(y.values - fitted, index=y.index)
    # Re-attach on the full original index; NaN outside the intersection so
    # the joint fit's own dropna decides the window rather than this helper.
    return resid.reindex(leg.index)


def compute_marginal_betas(
    asset_returns: pd.Series,
    legs: pd.DataFrame,
    factor_df: pd.DataFrame,
    lookback_days: int,
) -> dict[str, float]:
    """Marginal (orthogonalised, joint) variant.

    Each leg is residualised on FF5+UMD; the three residuals then enter ONE
    joint regression alongside the six equity factors. Two properties follow
    and both are the point: the estimates are stable because the residuals
    carry no equity-factor collinearity, and the published FF5+UMD betas in
    `factor_exposures` are untouched because this regression adds no new
    factor to that block.

    This is the variant S will transmit shocks through. The TOTAL variant
    must never drive a scenario — it double-counts with `beta_mkt`.

    Same unit convention as `compute_total_betas`: percent return per 100bp
    (see the block at the top of this module).

    Returns NaN-valued betas on insufficient history or a singular fit.
    Raises FactorsUnavailable when the equity factors are missing entirely,
    so the caller can record partial success rather than a failed row.
    """
    nan = float("nan")
    out: dict[str, float] = {
        "beta_ust10": nan, "beta_ig": nan, "beta_qual": nan,
        "r2_marginal": nan, "n_obs": 0,
    }

    # Raised before the history check: "the factors are missing" and "this
    # asset is too new" are different states and the caller writes a
    # different status for each.
    if not _ff5umd_columns(factor_df):
        raise FactorsUnavailable("no FF5/UMD columns in factor_df")

    common = asset_returns.index.intersection(legs.index).intersection(factor_df.index)
    out["n_obs"] = len(common)
    if len(common) < lookback_days:
        return out

    # Residualise in the leg's own units, then convert at the fit — the
    # residual of a bp series is still a bp series.
    resid = pd.DataFrame({
        leg: _residualise(legs[leg].loc[common], factor_df.loc[common])
        for leg in _MARGINAL_FACTORS
    }) / _BP_PER_100BP

    ff5_cols = _ff5umd_columns(factor_df)
    fit_df = pd.concat([factor_df.loc[common, ff5_cols], resid], axis=1).dropna()
    if fit_df.empty:
        return out

    # Excess return, in percent. RF is subtracted BEFORE the percent
    # conversion because both are decimals at that point.
    y = asset_returns.loc[fit_df.index]
    if "RF" in factor_df.columns:
        y = y - factor_df.loc[fit_df.index, "RF"]
    y = y * _PCT_PER_DECIMAL

    # The equity factors are decimals too, and must be scaled with the
    # return so their own betas keep their conventional magnitude.
    fit_df = fit_df.copy()
    for c in ff5_cols:
        fit_df[c] = fit_df[c] * _PCT_PER_DECIMAL

    # Most recent window, matching factor_fetcher's rolling convention: the
    # figure is current sensitivity, not an average over all history.
    y_win = y.iloc[-lookback_days:]
    x_win = fit_df.iloc[-lookback_days:]
    result = _ols_window(y_win, x_win)
    if result is None:
        return out

    out["beta_ust10"] = result["d_ust10"]
    out["beta_ig"] = result["d_ig"]
    out["beta_qual"] = result["d_qual"]
    out["r2_marginal"] = result["r_squared"]
    return out


def assemble_row(
    *,
    asset: str,
    run_date: date,
    lookback_days: int,
    total: dict,
    marginal: dict | None,
    factors_unavailable: bool,
) -> dict:
    """Combine total and marginal into a row for credit_rates_exposures.

    Status rules (spec §6):
      - n_obs < lookback_days -> 'insufficient_history'
      - any leg's design matrix is rank-deficient (NaN r^2) -> 'degenerate'
      - otherwise -> 'measured' (even when FF5 unavailable; partial success)

    Betas are stored as float or None; NaN inputs become None on the wire.
    """
    n_obs = total.get("n_obs", 0)
    if n_obs < lookback_days:
        status = "insufficient_history"
    elif any(
        v != v  # NaN check
        for v in (
            total.get("r2_ust10"), total.get("r2_ig"), total.get("r2_qual"),
        )
    ):
        status = "degenerate"
    else:
        status = "measured"

    def _f(v):
        return None if v is None or (isinstance(v, float) and v != v) else float(v)

    row = {
        "asset": asset,
        "run_date": run_date.isoformat(),
        "lookback_days": lookback_days,
        "total_beta_ust10": _f(total.get("beta_ust10")),
        "total_beta_ig":    _f(total.get("beta_ig")),
        "total_beta_qual":  _f(total.get("beta_qual")),
        "total_r2_ust10":   _f(total.get("r2_ust10")),
        "total_r2_ig":      _f(total.get("r2_ig")),
        "total_r2_qual":    _f(total.get("r2_qual")),
        "marginal_beta_ust10": _f(marginal.get("beta_ust10")) if marginal else None,
        "marginal_beta_ig":    _f(marginal.get("beta_ig"))    if marginal else None,
        "marginal_beta_qual":  _f(marginal.get("beta_qual"))  if marginal else None,
        "marginal_r2":         _f(marginal.get("r2_marginal")) if marginal else None,
        "n_obs": int(n_obs),
        "status": status,
    }
    return row
