"""
L4 — the VaR fan: parametric VaR projected across horizons by square-root-of-time.

Read from `im-Jarvis/backend/app/services/var_forecast_service.py` (its ADR-0049) and
reimplemented in float on 252-day annualisation.

    VaR(t) = z * sigma_p * sqrt(t)

Five confidence bands over five horizons: 1 day, 1 week, 2 weeks, **1 month**, 3 months.

**The 21-day point is the one that matters here.** ADR-0090 made every published pick
falsifiable against a pipeline-assigned **21-trading-day** horizon, and `pick_outcomes`
resolves the track record on exactly that window. Until now the book carried no risk
number on the horizon it is actually scored over: `portfolio_risk.var_95` is a 1-day
number and the Euler decomposition is a 1-day number. A reader comparing a 21-day
realised outcome against a 1-day VaR is comparing two different questions.

**The caveat travels with the number.** Square-root-of-time assumes IID returns and a
stationary covariance. Neither holds — volatility clusters, which is the entire premise
of `volatility_models`. So the fan is a *projection under a stated assumption*, not a
forecast, and every surface that renders it has to say so. It is offered because the
alternative on a book with two days of live history is no multi-horizon risk number at
all, not because the assumption is true.

`sigma_p` comes from the same constituent covariance the optimizer and the Euler
decomposition use, so the 1-day band reconciles with `risk_decomposition.portfolio_var`
by construction. That is deliberate: two ex-ante VaRs from one covariance that
disagreed at t=1 would be a defect, not a nuance.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import NormalDist

import numpy as np

TRADING_DAYS = 252

# 1d, 1w, 2w, 1m, 3m in trading days. 21 is load-bearing — see the module docstring.
HORIZONS_DAYS: tuple[int, ...] = (1, 5, 10, 21, 63)
CONFIDENCES: tuple[float, ...] = (0.50, 0.75, 0.90, 0.95, 0.99)

_STANDARD_NORMAL = NormalDist()


@dataclass(frozen=True)
class VarBand:
    horizon_days: int
    # {confidence: loss as a positive fraction of capital}
    quantiles: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"horizon_days": self.horizon_days, "quantiles": dict(self.quantiles)}


@dataclass(frozen=True)
class VarForecast:
    portfolio_volatility_daily: float
    portfolio_volatility_annual: float
    n_assets: int
    bands: list[VarBand] = field(default_factory=list)
    dropped_assets: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "portfolio_volatility_daily": self.portfolio_volatility_daily,
            "portfolio_volatility_annual": self.portfolio_volatility_annual,
            "n_assets": self.n_assets,
            "bands": [b.to_dict() for b in self.bands],
            "dropped_assets": list(self.dropped_assets),
            "warnings": list(self.warnings),
            "method": "square-root-of-time on a parametric Gaussian quantile",
            "assumption": (
                "IID returns and a stationary covariance; volatility clustering makes "
                "the longer horizons optimistic"
            ),
        }


def compute_var_forecast(
    assets: list[str],
    signed_weights: dict[str, float],
    cov_annual: np.ndarray,
    horizons: tuple[int, ...] = HORIZONS_DAYS,
    confidences: tuple[float, ...] = CONFIDENCES,
    trading_days: int = TRADING_DAYS,
) -> VarForecast | None:
    """Project the book's parametric VaR across horizons.

    Args:
        assets:         column order for `cov_annual`.
        signed_weights: {asset: weight}, **signed**. Only relative magnitudes affect
                        `sigma_p` via `w' Sigma w`; they are used as given and never
                        renormalised (ADR-0037 — the cash is real).
        cov_annual:     **annualised** covariance in `assets` order, as every other
                        producer here emits.

    Returns None when there is no volatility to project from, so the caller can render
    an absence with a cause rather than a zero (ADR-0023).
    """
    if not assets or not signed_weights:
        return None

    cov_annual = np.asarray(cov_annual, dtype=float)
    n = len(assets)
    if cov_annual.shape != (n, n):
        return None

    weights = np.array([float(signed_weights.get(a, 0.0)) for a in assets])
    dropped = sorted(a for a in signed_weights if a not in assets and signed_weights[a])
    if not np.any(weights):
        return None

    variance_annual = float(weights @ ((cov_annual + cov_annual.T) / 2.0) @ weights)
    if not math.isfinite(variance_annual) or variance_annual <= 0:
        return None

    sigma_annual = math.sqrt(variance_annual)
    sigma_daily = sigma_annual / math.sqrt(trading_days)

    bands = [
        VarBand(
            horizon_days=int(horizon),
            quantiles={
                f"p{int(round(c * 100))}": (
                    _STANDARD_NORMAL.inv_cdf(c) * sigma_daily * math.sqrt(horizon)
                )
                for c in confidences
            },
        )
        for horizon in horizons
    ]

    warnings: list[str] = []
    if dropped:
        warnings.append(
            "held but not priced, excluded from sigma_p: " + ", ".join(dropped)
        )

    return VarForecast(
        portfolio_volatility_daily=sigma_daily,
        portfolio_volatility_annual=sigma_annual,
        n_assets=n,
        bands=bands,
        dropped_assets=dropped,
        warnings=warnings,
    )
