"""
Risk engine -- spec section 7.2.

All metrics parametric (normal distribution) unless stated otherwise. Lookbacks
read from scoring_config at runtime. When insufficient history is available,
the corresponding metric is returned as None (frontend should render n/a).
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

import pandas as pd

from backend.derivations import (
    Freshness,
    NumericDerivation,
    SourceRecord,
    Uncertainty,
    validate_numeric,
)


# Minimum observations needed to trust each metric
MIN_DAYS_FOR_VAR = 30
MIN_DAYS_FOR_SHARPE = 60
MIN_DAYS_FOR_BETA = 60


def _z_score(confidence: float) -> float:
    """Inverse standard normal CDF: returns z such that P(Z <= z) = confidence.

    z(0.95) = +1.6449, z(0.05) = -1.6449. Winitzki erfinv approximation (~1e-4).
    """
    if confidence <= 0 or confidence >= 1:
        raise ValueError("confidence must be in (0, 1)")
    return math.sqrt(2.0) * _erfinv(2.0 * confidence - 1.0)


def _erfinv(x: float) -> float:
    """Winitzki approximation to the inverse error function. Accurate ~1e-4."""
    a = 0.147
    if x <= -1.0 or x >= 1.0:
        return float("nan") if abs(x) > 1.0 else (float("-inf") if x < 0 else float("inf"))
    sign = 1.0 if x >= 0 else -1.0
    ax = abs(x)
    ln = math.log(1.0 - ax * ax)
    first = 2.0 / (math.pi * a) + ln / 2.0
    return sign * math.sqrt(math.sqrt(first * first - ln / a) - first)


def _normal_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def value_at_risk(
    daily_returns: pd.Series,
    portfolio_value: float,
    confidence: float = 0.95,
) -> Optional[float]:
    """Parametric (Gaussian) one-day VaR. Positive number = loss magnitude."""
    if len(daily_returns) < MIN_DAYS_FOR_VAR:
        return None
    sigma = float(daily_returns.std(ddof=1))
    z = _z_score(confidence)
    return z * sigma * portfolio_value


def conditional_value_at_risk(
    daily_returns: pd.Series,
    portfolio_value: float,
    confidence: float = 0.95,
) -> Optional[float]:
    """Parametric CVaR (Expected Shortfall). Positive number = average loss beyond VaR.

    Formula: CVaR = sigma * phi(z_alpha) / (1 - alpha) * portfolio_value.
    """
    if len(daily_returns) < MIN_DAYS_FOR_VAR:
        return None
    sigma = float(daily_returns.std(ddof=1))
    z = _z_score(confidence)
    pdf = _normal_pdf(z)
    return sigma * pdf / (1.0 - confidence) * portfolio_value


def sharpe_ratio(
    daily_returns: pd.Series,
    risk_free_annual: float = 0.0,
) -> Optional[float]:
    """Annualized Sharpe. risk_free_annual as a decimal (e.g. 0.045 for 4.5%)."""
    if len(daily_returns) < MIN_DAYS_FOR_SHARPE:
        return None
    rf_daily = risk_free_annual / 252.0
    excess = daily_returns - rf_daily
    if float(excess.std(ddof=1)) == 0:
        return None
    return float(excess.mean() / excess.std(ddof=1) * math.sqrt(252))


def beta_to_spx(
    portfolio_returns: pd.Series,
    spx_returns: pd.Series,
) -> Optional[float]:
    """OLS beta of portfolio returns vs SPX returns. Aligned on date index."""
    aligned = pd.concat(
        [portfolio_returns.rename("p"), spx_returns.rename("m")], axis=1
    ).dropna()
    if len(aligned) < MIN_DAYS_FOR_BETA:
        return None
    cov = float(aligned["p"].cov(aligned["m"]))
    var = float(aligned["m"].var(ddof=1))
    if var == 0:
        return None
    return cov / var


def concentration_hhi(weights: list[float]) -> float:
    """Herfindahl-Hirschman Index scaled to 0-10000. weights sum to 1.0."""
    if not weights:
        return 0.0
    return float(sum(w * w for w in weights) * 10000.0)


# ── Parametric helpers (T9 brief contract) ──────────────────────────────────
# These thin wrappers mirror the brief's "_parametric_var / _parametric_cvar /
# _annualized_sharpe / _beta_to_spx / _hhi" naming and return plain floats
# without the MIN_DAYS_FOR_* gates. They feed compute_risk(), which always
# emits an "estimated" derivation when it has at least 2 observations.


def _parametric_var(daily_returns: pd.Series, confidence: float) -> float:
    """Parametric (Gaussian) VaR as a positive decimal loss magnitude."""
    sigma = float(daily_returns.std(ddof=1))
    z = _z_score(confidence)
    return z * sigma


def _parametric_cvar(daily_returns: pd.Series, confidence: float) -> float:
    """Parametric CVaR (Expected Shortfall) as a positive decimal."""
    sigma = float(daily_returns.std(ddof=1))
    z = _z_score(confidence)
    pdf = _normal_pdf(z)
    return sigma * pdf / (1.0 - confidence)


def _annualized_sharpe(daily_returns: pd.Series, risk_free_annual: float = 0.0) -> float:
    """Annualized Sharpe ratio. Returns NaN if std is zero."""
    rf_daily = risk_free_annual / 252.0
    excess = daily_returns - rf_daily
    s = float(excess.std(ddof=1))
    if s == 0:
        return float("nan")
    return float(excess.mean() / s * math.sqrt(252))


def _beta_to_spx(portfolio_returns: pd.Series, spx_returns: pd.Series) -> float:
    """OLS beta of portfolio returns vs SPX returns. Returns NaN if SPX var is zero."""
    aligned = pd.concat(
        [portfolio_returns.rename("p"), spx_returns.rename("m")], axis=1
    ).dropna()
    cov = float(aligned["p"].cov(aligned["m"]))
    var = float(aligned["m"].var(ddof=1))
    if var == 0:
        return float("nan")
    return cov / var


def _hhi(book: list[dict]) -> float:
    """HHI of book concentration on the 0-10000 scale.

    Weight each position by its share of GROSS exposure — |weight| normalised to
    sum to 1.0, the unit concentration_hhi documents — so the index measures how
    concentrated the book's *bets* are, independent of how much of the mandate sits
    in cash. Passing the raw shares-of-capital (which sum to gross, e.g. ~0.59 when
    41% is in cash) diluted it by the cash level: the live book read HHI 425,
    *below* its own "10 000/N fully diversified" baseline (1 111 for 9 names) —
    impossible for a real HHI — and the 2 000 concentration limit under-triggered
    because cash, not diversification, was lowering the number.
    """
    abs_weights = [abs(p.get("weight", 0.0)) for p in book]
    gross = sum(abs_weights)
    if gross <= 0:
        return 0.0
    return concentration_hhi([w / gross for w in abs_weights])


# ── compute_risk (derivation-aware) ──────────────────────────────────────────


def _wrap(
    field_id: str,
    method_id: str,
    value: Optional[float],
    unit: str,
    source_records: list[SourceRecord],
    as_of: datetime,
    status: str = "exact",
    uncertainty: Optional[Uncertainty] = None,
    unavailable_reason: Optional[str] = None,
    epistemic: Optional[str] = None,
) -> NumericDerivation:
    """Build, validate, and return a NumericDerivation for a single risk metric.

    `epistemic` defaults to `known` when there is a value and `unknown` when there is not
    (ADR-0098). The fallback is deliberately the WEAKER of the two absences: `unknown` tells
    a reader to come back, which is harmless if it turns out nothing was ever coming, whereas
    `not_applicable` tells them to stop waiting and is a claim that has to be earned. A
    caller asserting the stronger one passes it explicitly.
    """
    # `as_of` can be nominally AHEAD of now at a UTC date boundary — a run_date set
    # to today's UTC-midnight while now() is still the previous UTC day in a +ve
    # timezone (e.g. early morning in SGT = UTC+8). Clamp computed_at to at least
    # as_of: consistent with the age floor below, and required by validate_numeric
    # ("computed_at must be >= as_of"). Otherwise the whole L4 stage crashes for a
    # few hours each day around the date boundary.
    computed_at = max(datetime.now(timezone.utc), as_of)
    # observed_age is "computed_at - as_of", floored at 0 when as_of is ahead.
    age_seconds = max(0, int((computed_at - as_of).total_seconds()))
    d = NumericDerivation(
        field_id=field_id,
        display_status=status,
        value=value,
        unit=unit,
        method_id=method_id,
        source_records=source_records,
        computed_at=computed_at,
        as_of=as_of,
        freshness=Freshness(max_age_seconds=86400, observed_age_seconds=age_seconds),
        uncertainty=uncertainty,
        unavailable_reason=unavailable_reason,
        epistemic=epistemic or ("known" if value is not None else "unknown"),
    )
    validate_numeric(d)
    return d


def compute_risk(
    *,
    book: list[dict],
    history: list[float],
    spx_returns: list[float],
    as_of: Optional[datetime] = None,
    portfolio_value: float = 100_000_000.0,
    risk_free_annual: float = 0.0,
    history_dates: Optional[list[str]] = None,
    spx_dates: Optional[list[str]] = None,
) -> dict[str, NumericDerivation]:
    """Bundle all risk metrics as NumericDerivation objects.

    Args:
        book:            list of {ticker, weight, direction, price_today, price_yesterday, ...}.
        history:         list of recent portfolio daily returns (decimal).
        spx_returns:     list of recent SPX daily returns (decimal).
        as_of:           the "as of" timestamp for these inputs (defaults to now UTC).
        portfolio_value: total capital to scale VaR/CVaR (default $100M).
        risk_free_annual: risk-free rate for Sharpe (decimal).
        history_dates:   ISO dates parallel to ``history``. When given together
                         with ``spx_dates``, beta is computed on the date-aligned
                         overlap of the two series rather than by list position.
                         VaR/CVaR/Sharpe are order-independent and always use the
                         full ``history``.
        spx_dates:       ISO dates parallel to ``spx_returns``.

    Returns:
        dict keyed by "var_95", "cvar_95", "sharpe", "beta", "hhi" — each a NumericDerivation.

    Beta alignment: VaR/CVaR/Sharpe are std/mean statistics and do not care about
    ordering, but beta is cov(p, m) / var(m) and is only meaningful when the two
    series are matched by DATE. Passing the two return lists positionally
    (element 0 of a handful of portfolio rows against element 0 of ~252 SPX rows)
    produced a meaningless beta whenever the series differed in length — which is
    always. Supply the parallel date lists and beta aligns on their intersection.
    """
    as_of = as_of or datetime.now(timezone.utc)
    src = [SourceRecord(table="portfolio_returns", id="rollup", as_of=as_of)]

    rets = pd.Series(history, dtype="float64")

    # For beta, prefer date-indexed series so _beta_to_spx's concat aligns on
    # the dates rather than on a positional RangeIndex. Fall back to positional
    # (equal-length) series when no dates are supplied — the shape unit tests use.
    if history_dates is not None and spx_dates is not None:
        rets_for_beta = pd.Series(history, index=pd.to_datetime(history_dates), dtype="float64")
        spx = pd.Series(spx_returns, index=pd.to_datetime(spx_dates), dtype="float64")
    else:
        rets_for_beta = rets
        spx = pd.Series(spx_returns, dtype="float64") if spx_returns is not None else pd.Series([], dtype="float64")

    # Per T9 brief: compute_risk always produces an "estimated" derivation for
    # VaR/CVaR/Sharpe/Beta using whatever history is available. Parametric
    # formulas do not require a minimum sample size at this layer; the
    # MIN_DAYS_FOR_* gates live in the underlying helpers and are applied by
    # callers that need audit-grade estimates (MIN_DAYS_FOR_* gates elsewhere).
    # _parametric_var/_parametric_cvar return a decimal loss fraction (z * sigma).
    # These derivations are labelled unit="usd", are persisted to
    # portfolio_risk.var_95/cvar_95, and are rendered with a currency formatter,
    # so they must be scaled to dollars here. Omitting the scale wrote ~0.03
    # into a USD field and the UI rendered "$0" for a multi-million-dollar risk.
    var_v: Optional[float] = (
        _parametric_var(rets, 0.95) * portfolio_value if len(rets) >= 2 else None
    )
    cvar_v: Optional[float] = (
        _parametric_cvar(rets, 0.95) * portfolio_value if len(rets) >= 2 else None
    )
    sharpe_v: Optional[float] = _annualized_sharpe(rets, risk_free_annual) if len(rets) >= 2 else None
    beta_v: Optional[float] = (
        _beta_to_spx(rets_for_beta, spx) if len(rets_for_beta) >= 2 and len(spx) >= 2 else None
    )
    hhi_v = _hhi(book)  # normalised by gross so cash does not dilute the index

    def _estimated(field_id: str, method_id: str, value: Optional[float], unit: str,
                   confidence: float) -> NumericDerivation:
        if value is None or (isinstance(value, float) and (math.isnan(value) or math.isinf(value))):
            return _wrap(
                field_id, method_id, None, unit, src, as_of,
                status="unavailable",
                # UNKNOWN, not not_applicable (ADR-0098). The statistic is undefined on a
                # series this short, but the shortfall is in the data we have rather than in
                # the question — it resolves as history accrues, so a reader should come
                # back. `not_applicable` would tell them to stop waiting for a number that is
                # in fact on its way.
                epistemic="unknown",
                unavailable_reason=(
                    "fewer than two return observations, so the statistic is undefined; "
                    "it resolves as history accrues"
                ),
            )
        return _wrap(
            field_id, method_id, value, unit, src, as_of,
            status="estimated",
            uncertainty=Uncertainty(method="analytical", confidence=confidence),
        )

    return {
        "var_95": _estimated(
            "risk.var_95", "risk.var.parametric.v1", var_v, "usd", 0.90,
        ),
        "cvar_95": _estimated(
            "risk.cvar_95", "risk.cvar.parametric.v1", cvar_v, "usd", 0.90,
        ),
        "sharpe": _estimated(
            "risk.sharpe", "risk.sharpe.v1", sharpe_v, "ratio", 0.85,
        ),
        "beta": _estimated(
            "risk.beta", "risk.beta.v1", beta_v, "ratio", 0.85,
        ),
        "hhi": _wrap(
            "risk.hhi", "risk.hhi.v1", hhi_v, "ratio", src, as_of, status="exact",
        ),
    }


def annualized_vol(daily_returns: pd.Series) -> Optional[float]:
    """252-day annualized vol (sample stdev * sqrt(252))."""
    if len(daily_returns) < 2:
        return None
    return float(daily_returns.std(ddof=1) * math.sqrt(252))