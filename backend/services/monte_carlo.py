"""
L4 — Monte Carlo VaR: correlated paths with Student-t innovations.

Read from `im-Jarvis/backend/app/services/monte_carlo_service.py` (its ADR-0062) and
reimplemented in float on 252-day annualisation.

**The third VaR in this repo, and it must never be confused with the other two.**

  * `risk_engine.compute_risk` -> `portfolio_risk.var_95` is **parametric Gaussian on
    the book's own realised return series**. As old as the book.
  * `risk_decomposition.decompose_risk` -> `portfolio_var` is **ex-ante, from the
    constituents' covariance**, and decomposes exactly by name.
  * This one is **ex-ante, from the same covariance, but simulated with fat tails**.

They answer different questions from different inputs and will disagree routinely.
Three VaR numbers rendered on one surface without distinct labels and method ids is
the regression `PROGRESS.md` records twice — see ADR-0082, which had to say the same
thing when there were only two.

**Why simulate at all when there is a closed form.** The parametric VaR assumes normal
returns, which understates the tail exactly where a risk number matters. Drawing daily
innovations from a multivariate Student-t (nu = `df`, default 5) makes the 99% VaR and
the expected shortfall heavier and more realistic, and it lets a loss exceed the worst
day in the sample — which the historical method structurally cannot.

The t draw is scaled by `sqrt((nu - 2) / g)`, `g ~ chi2(nu)`, so its covariance is
**exactly** the covariance handed in. The simulation is therefore comparable to the
Gaussian version rather than being a differently-scaled distribution wearing the same
label. Needs nu > 2 for a finite variance.

**This does not inject stochasticity into the pipeline** (ADR-0013). The generator is
seeded, so a given (weights, mu, Sigma, horizon, n_sims, df, seed) always returns the
same numbers. It is a deterministic function that happens to be computed by sampling —
the same standing this repo already gives the covariance estimate.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

TRADING_DAYS = 252
DEFAULT_SEED = 12345
DEFAULT_SIMS = 10_000
DEFAULT_DF = 5.0
HISTOGRAM_BINS = 41


@dataclass(frozen=True)
class VarBand:
    confidence: float
    var: float          # loss as a POSITIVE fraction of capital
    es: float           # expected shortfall beyond VaR, same sign convention

    def to_dict(self) -> dict:
        return {"confidence": self.confidence, "var": self.var, "es": self.es}


@dataclass(frozen=True)
class MonteCarloVaR:
    horizon_days: int
    n_sims: int
    seed: int
    df: float
    n_assets: int
    mean_terminal_return: float
    prob_loss: float
    p05_return: float
    p50_return: float
    p95_return: float
    bands: list[VarBand] = field(default_factory=list)
    histogram: list[dict] = field(default_factory=list)
    dropped_assets: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "horizon_days": self.horizon_days,
            "n_sims": self.n_sims,
            "seed": self.seed,
            "df": self.df,
            "n_assets": self.n_assets,
            "mean_terminal_return": self.mean_terminal_return,
            "prob_loss": self.prob_loss,
            "p05_return": self.p05_return,
            "p50_return": self.p50_return,
            "p95_return": self.p95_return,
            "bands": [b.to_dict() for b in self.bands],
            "histogram": list(self.histogram),
            "dropped_assets": list(self.dropped_assets),
            "warnings": list(self.warnings),
        }


def _cholesky(cov: np.ndarray) -> np.ndarray:
    """Cholesky factor, robust to a covariance estimate that is not quite PD.

    A sample covariance over a short window can come back with a tiny negative
    eigenvalue. Clipping the spectrum and re-forming is preferable to failing: the
    alternative is no VaR at all because the 40th eigenvalue was -1e-18.
    """
    try:
        return np.linalg.cholesky(cov)
    except np.linalg.LinAlgError:
        values, vectors = np.linalg.eigh(cov)
        values = np.clip(values, 1e-16, None)
        psd = (vectors * values) @ vectors.T
        return np.linalg.cholesky(psd + np.eye(cov.shape[0]) * 1e-12)


def monte_carlo_var(
    assets: list[str],
    signed_weights: dict[str, float],
    cov_annual: np.ndarray,
    mu_annual: dict[str, float] | None = None,
    horizon_days: int = 21,
    n_sims: int = DEFAULT_SIMS,
    confidence_levels: tuple[float, ...] = (0.95, 0.99),
    seed: int = DEFAULT_SEED,
    df: float = DEFAULT_DF,
    trading_days: int = TRADING_DAYS,
) -> MonteCarloVaR | None:
    """Simulate the book's P&L distribution and read VaR/ES off the empirical losses.

    Args:
        assets:         column order for `cov_annual`.
        signed_weights: {asset: weight}. **Signed** — shorts negative, as everywhere
                        else in this repo. Names absent from `assets` are reported in
                        `dropped_assets` rather than dropped silently (ADR-0023).
        cov_annual:     **annualised** covariance, in `assets` order. Annualised
                        because that is what every other producer in this repo emits
                        (`risk_decomposition`, `optimizer.covariance_from_returns`);
                        it is de-annualised internally. Handing this a daily
                        covariance would understate the risk by a factor of 252.
        mu_annual:      annualised expected returns. Defaults to zero drift, which is
                        the honest choice for a risk number — a VaR that quietly
                        assumes the book earns its alpha is not a risk number.
        horizon_days:   trading days. Defaults to **21**, matching the horizon a
                        published pick is actually scored over (ADR-0090).

    Returns None when there is nothing to simulate, so the caller can say so.
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

    warnings: list[str] = []
    if horizon_days < 1:
        horizon_days = 1
        warnings.append("horizon_days below 1; using 1")

    cov_daily = (cov_annual + cov_annual.T) / 2.0 / float(trading_days)
    if not np.all(np.isfinite(cov_daily)):
        return None

    mu_daily = np.array(
        [float((mu_annual or {}).get(a, 0.0)) / float(trading_days) for a in assets]
    )

    df_effective = df if df > 2.0 else DEFAULT_DF
    if df <= 2.0:
        warnings.append("df must be > 2 for a finite variance; using 5")
    # t = sqrt((nu - 2) / g) * (L z) has covariance exactly Sigma.
    t_scale = math.sqrt(df_effective - 2.0)

    chol = _cholesky(cov_daily)
    rng = np.random.default_rng(seed)

    wealth = np.ones(n_sims)
    for _ in range(int(horizon_days)):
        z = rng.standard_normal((n_sims, n))
        g = rng.chisquare(df_effective, size=(n_sims, 1))
        daily = mu_daily + (t_scale / np.sqrt(g)) * (z @ chol.T)
        wealth *= 1.0 + (daily @ weights)

    terminal = wealth - 1.0
    losses = -terminal

    bands: list[VarBand] = []
    for level in confidence_levels:
        var_level = float(np.quantile(losses, float(level)))
        tail = losses[losses >= var_level]
        es_level = float(tail.mean()) if tail.size else var_level
        bands.append(VarBand(confidence=float(level), var=var_level, es=es_level))

    # Clip the histogram range to [0.5%, 99.5%] so a handful of extreme paths do not
    # flatten every visible bar into the middle bin.
    low = float(np.quantile(terminal, 0.005))
    high = float(np.quantile(terminal, 0.995))
    if high <= low:
        high = low + 1e-9
    counts, edges = np.histogram(terminal, bins=HISTOGRAM_BINS, range=(low, high))
    total = float(counts.sum()) or 1.0
    histogram = [
        {
            "mid": float((edges[i] + edges[i + 1]) / 2.0),
            "density": float(counts[i]) / total,
        }
        for i in range(len(counts))
    ]

    if dropped:
        warnings.append(
            "held but not priced, excluded from the simulation: " + ", ".join(dropped)
        )

    return MonteCarloVaR(
        horizon_days=int(horizon_days),
        n_sims=int(n_sims),
        seed=int(seed),
        df=float(df_effective),
        n_assets=n,
        mean_terminal_return=float(terminal.mean()),
        prob_loss=float((terminal < 0).mean()),
        p05_return=float(np.quantile(terminal, 0.05)),
        p50_return=float(np.quantile(terminal, 0.50)),
        p95_return=float(np.quantile(terminal, 0.95)),
        bands=bands,
        histogram=histogram,
        dropped_assets=dropped,
        warnings=warnings,
    )
