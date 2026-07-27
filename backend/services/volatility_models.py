"""
L4 — conditional volatility: EWMA and GARCH(1,1).

Read from `im-Jarvis/backend/app/services/volatility_models.py` (its ADR-0054) and
reimplemented in float on 252-day annualisation.

**What this replaces.** Everywhere this repo needs a volatility today it takes the
plain sample standard deviation of a trailing window — `_conviction` in
`daily_refresh`, `expected_returns.annualised_vol`, the diagonal of the covariance in
`risk_decomposition`. A sample standard deviation over 252 days weights the crash 200
sessions ago exactly as heavily as yesterday, so it is slow to rise into a shock and
slow to come down out of one. Both estimators here are *conditional*: they say what
volatility is now, not what it averaged over the past year.

  * **EWMA** (RiskMetrics, lambda = 0.94) — closed form, no fitting, one parameter.
    `sigma2_t = lambda sigma2_{t-1} + (1 - lambda) r2_{t-1}`, seeded with the sample
    variance.
  * **GARCH(1,1)**, variance-targeted — the long-run variance is pinned to the sample
    variance so only alpha and beta are fit, which is far better behaved on a few
    hundred observations than fitting all three. Reports persistence (alpha + beta)
    and the long-run vol alongside the one-step-ahead conditional vol.

**Where the conviction sizing uses this.** `conviction = |EdgeScore| / max(vol, floor)`
(ADR-0032, floor per ADR-0047). Substituting an EWMA vol for the sample vol makes
conviction react to a regime the day it changes rather than a quarter later. The floor
still applies and still matters: an unfloored inverse-vol scored BIL at 2375x against a
book median of 16x.

`scipy.optimize` is already a backend dependency (`backtest_edge`/`backtest_hype` use
`scipy.stats.spearmanr`), so the GARCH fit adds no new install. Note the source repo
declares scipy dev-only while importing it at module top — that latent packaging bug
does not travel here.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

TRADING_DAYS = 252
DEFAULT_LAMBDA = 0.94

# Below this a GARCH fit is describing noise. The source uses the same threshold and
# degrades to EWMA rather than returning a confidently-fitted nothing.
MIN_OBS_FOR_GARCH = 30
MIN_OBS_FOR_EWMA = 2


@dataclass(frozen=True)
class EwmaVol:
    n_obs: int
    lam: float
    daily_vol: float
    annualised_vol: float
    series: list[float] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self, include_series: bool = False) -> dict:
        out = {
            "n_obs": self.n_obs,
            "lam": self.lam,
            "daily_vol": self.daily_vol,
            "annualised_vol": self.annualised_vol,
            "warnings": list(self.warnings),
        }
        if include_series:
            out["series"] = list(self.series)
        return out


@dataclass(frozen=True)
class Garch11:
    n_obs: int
    omega: float
    alpha: float
    beta: float
    persistence: float
    daily_vol: float
    annualised_vol: float
    longrun_annualised_vol: float
    converged: bool
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "n_obs": self.n_obs,
            "omega": self.omega,
            "alpha": self.alpha,
            "beta": self.beta,
            "persistence": self.persistence,
            "daily_vol": self.daily_vol,
            "annualised_vol": self.annualised_vol,
            "longrun_annualised_vol": self.longrun_annualised_vol,
            "converged": self.converged,
            "warnings": list(self.warnings),
        }


def _clean(returns) -> np.ndarray:
    array = np.asarray(list(returns), dtype=float)
    return array[np.isfinite(array)]


def ewma_volatility(
    returns,
    lam: float = DEFAULT_LAMBDA,
    trading_days: int = TRADING_DAYS,
) -> EwmaVol:
    """RiskMetrics EWMA one-step conditional volatility.

    `series` is the annualised conditional-vol path, one value per observation, so a
    caller can show whether volatility is elevated *now* rather than only what its
    latest level is. A single number cannot answer that.
    """
    values = _clean(returns)
    n = int(values.size)
    if n < MIN_OBS_FOR_EWMA:
        return EwmaVol(
            n_obs=n, lam=lam, daily_vol=0.0, annualised_vol=0.0,
            warnings=[f"need at least {MIN_OBS_FOR_EWMA} returns for EWMA"],
        )
    if not (0.0 < lam < 1.0):
        return EwmaVol(
            n_obs=n, lam=lam, daily_vol=0.0, annualised_vol=0.0,
            warnings=["lambda must be in (0, 1)"],
        )

    annualiser = math.sqrt(trading_days)
    variance = float(np.var(values, ddof=1)) if n > 1 else 0.0
    series: list[float] = []
    for r in values:
        variance = lam * variance + (1.0 - lam) * float(r) * float(r)
        series.append(math.sqrt(max(variance, 0.0)) * annualiser)

    daily = math.sqrt(max(variance, 0.0))
    return EwmaVol(
        n_obs=n,
        lam=float(lam),
        daily_vol=daily,
        annualised_vol=daily * annualiser,
        series=series,
    )


def garch11(returns, trading_days: int = TRADING_DAYS) -> Garch11:
    """Variance-targeted GARCH(1,1) by Gaussian MLE over (alpha, beta).

    `omega` is pinned to `(1 - alpha - beta) * s2` so the model's unconditional
    variance equals the sample variance by construction. That removes the parameter
    the likelihood is least able to identify on a short series, and it guarantees the
    long-run vol is a number the data actually supports.

    Degrades to `ewma_volatility` below `MIN_OBS_FOR_GARCH` with `converged=False` and
    a stated reason, rather than reporting a fit that did not happen.
    """
    values = _clean(returns)
    n = int(values.size)

    if n < MIN_OBS_FOR_GARCH:
        fallback = ewma_volatility(values, trading_days=trading_days)
        return Garch11(
            n_obs=n, omega=0.0, alpha=0.0, beta=0.0, persistence=0.0,
            daily_vol=fallback.daily_vol,
            annualised_vol=fallback.annualised_vol,
            longrun_annualised_vol=fallback.annualised_vol,
            converged=False,
            warnings=[f"sample < {MIN_OBS_FOR_GARCH}; returned the EWMA vol, not a GARCH fit"],
        )

    try:
        from scipy.optimize import minimize
    except ImportError:                                  # pragma: no cover
        fallback = ewma_volatility(values, trading_days=trading_days)
        return Garch11(
            n_obs=n, omega=0.0, alpha=0.0, beta=0.0, persistence=0.0,
            daily_vol=fallback.daily_vol,
            annualised_vol=fallback.annualised_vol,
            longrun_annualised_vol=fallback.annualised_vol,
            converged=False,
            warnings=["scipy unavailable; returned the EWMA vol, not a GARCH fit"],
        )

    residual = values - values.mean()                    # GARCH on the residual
    s2 = float(np.var(residual))
    if s2 <= 0.0:
        return Garch11(
            n_obs=n, omega=0.0, alpha=0.0, beta=0.0, persistence=0.0,
            daily_vol=0.0, annualised_vol=0.0, longrun_annualised_vol=0.0,
            converged=False, warnings=["zero-variance sample"],
        )

    squared = residual ** 2

    def negative_log_likelihood(params: np.ndarray) -> float:
        alpha, beta = float(params[0]), float(params[1])
        if alpha < 0 or beta < 0 or alpha + beta >= 0.9999:
            return 1e12
        omega = (1.0 - alpha - beta) * s2
        sigma2 = s2
        total = 0.0
        for r2 in squared:
            total += math.log(sigma2) + r2 / sigma2
            sigma2 = omega + alpha * r2 + beta * sigma2
        return 0.5 * total

    result = minimize(
        negative_log_likelihood,
        x0=np.array([0.05, 0.90]),
        method="Nelder-Mead",
        options={"xatol": 1e-6, "fatol": 1e-6, "maxiter": 2000},
    )

    alpha = max(float(result.x[0]), 0.0)
    beta = max(float(result.x[1]), 0.0)
    warnings: list[str] = []
    if alpha + beta >= 0.9999:
        # A non-stationary fit has no long-run variance to report. Scale back to just
        # inside the stationarity boundary and say so.
        scale = 0.999 / (alpha + beta)
        alpha, beta = alpha * scale, beta * scale
        warnings.append("fit hit the stationarity boundary; alpha + beta scaled to 0.999")
    if not bool(result.success):
        warnings.append("optimiser did not report convergence")

    omega = (1.0 - alpha - beta) * s2
    sigma2 = s2
    for r2 in squared:
        sigma2 = omega + alpha * r2 + beta * sigma2

    annualiser = math.sqrt(trading_days)
    daily = math.sqrt(max(sigma2, 0.0))
    return Garch11(
        n_obs=n,
        omega=omega,
        alpha=alpha,
        beta=beta,
        persistence=alpha + beta,
        daily_vol=daily,
        annualised_vol=daily * annualiser,
        longrun_annualised_vol=math.sqrt(s2) * annualiser,
        converged=bool(result.success),
        warnings=warnings,
    )
