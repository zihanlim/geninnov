"""
Risk engine -- spec section 7.2.

All metrics parametric (normal distribution) unless stated otherwise. Lookbacks
read from scoring_config at runtime. When insufficient history is available,
the corresponding metric is returned as None (frontend should render n/a).
"""
from __future__ import annotations

import math
from typing import Optional

import pandas as pd


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


def compute_risk_metrics(
    positions: list[dict],
    daily_returns: pd.Series,
    spx_returns: Optional[pd.Series] = None,
    risk_free_annual: float = 0.0,
    var_confidence: float = 0.95,
) -> dict:
    """Bundle all risk metrics into a single dict for the portfolio_risk table.

    positions:     list of {notional, weight} from the sized portfolio.
    daily_returns: pd.Series indexed by date of portfolio daily returns.
    spx_returns:   optional pd.Series for beta. If absent, beta is None.
    """
    total_capital = sum(p["notional"] for p in positions) if positions else 0.0
    weights = [p["weight"] for p in positions]

    return {
        "total_capital": total_capital,
        "var_95": value_at_risk(daily_returns, total_capital, var_confidence) if total_capital else None,
        "cvar_95": conditional_value_at_risk(daily_returns, total_capital, var_confidence) if total_capital else None,
        "sharpe": sharpe_ratio(daily_returns, risk_free_annual),
        "beta": beta_to_spx(daily_returns, spx_returns) if spx_returns is not None else None,
        "concentration_hhi": concentration_hhi(weights),
    }


def portfolio_daily_return(
    position_returns: dict[str, float],
    positions: list[dict],
    total_capital: float,
) -> float:
    """Compute the day's portfolio return as the weighted sum of position returns.

    position_returns: {ticker: daily_return} as a decimal (e.g. 0.01 for +1%).
    positions:        [{asset, weight, direction, ...}]; direction sign-flips shorts.
    total_capital:    current portfolio value (kept for API symmetry).
    """
    if not positions or total_capital == 0:
        return 0.0
    daily = 0.0
    for p in positions:
        r = position_returns.get(p["asset"], 0.0)
        if p["direction"] == "short":
            r = -r
        daily += p["weight"] * r
    return float(daily)


def annualized_vol(daily_returns: pd.Series) -> Optional[float]:
    """252-day annualized vol (sample stdev * sqrt(252))."""
    if len(daily_returns) < 2:
        return None
    return float(daily_returns.std(ddof=1) * math.sqrt(252))
