"""
L4 — Euler risk decomposition over a position-level covariance matrix.

**Why this exists.** `risk_engine.compute_risk` derives VaR from the book's own realised
`portfolio_returns` series. That series is as old as the book, so on a young book the number
is built on a handful of observations — and it can say nothing at all about *which position*
is responsible, because it only ever sees one aggregate number per day.

This module answers a different question from different inputs: given the weights the book
actually holds and 252 days of the *constituents'* returns, what is the book's ex-ante
volatility, and how does it decompose by name? It is available on day one of a book, because
it borrows history from the assets rather than from the book.

**The identity.** With signed weights `w` and annualised covariance `Σ`:

    σ_p  = √(wᵀΣw)                     portfolio volatility
    MCRᵢ = (Σw)ᵢ / σ_p                  marginal contribution — ∂σ_p/∂wᵢ
    CCRᵢ = wᵢ · MCRᵢ                    component contribution
    Σ CCRᵢ = σ_p                        exactly, by Euler's homogeneous function theorem

σ_p is homogeneous of degree 1 in `w`, which is what makes the contributions sum to the total
rather than merely correlate with it. Component VaR scales the same decomposition by the
normal quantile: `component VaRᵢ = z · CCRᵢ`, so `Σ component VaRᵢ = portfolio VaR`.

**This is not the same number as `portfolio_risk.var_95` and must never overwrite it.**
That one is realised, from the book's own series; this one is ex-ante, from a covariance.
They answer different questions, disagree routinely, and two contradicting VaRs rendered
without distinct labels is the exact regression PROGRESS records twice. Separate field,
separate method id, separate label at render.

**Signs are load-bearing.** Weights are signed, and a negative `CCRᵢ` is a real result: a
position whose correlation to the rest of the book makes it a hedge genuinely reduces
portfolio volatility. Clipping that at zero, or rendering the contributions as a share-of-whole
bar or pie, destroys the only thing the decomposition is for (ADR-0060).

See ADR-0079.
"""
from __future__ import annotations

from statistics import NormalDist

import numpy as np
import pandas as pd

# The book is annualised at 252 elsewhere in this codebase (risk_engine, book_metrics).
# im-Jarvis, where this decomposition was read from, uses 260; matching the local
# convention matters more than matching the source, or the same book reports two vols.
TRADING_DAYS = 252

# A covariance matrix estimates O(n²) parameters, so it needs materially more history than
# a single variance does. 60 sessions is a quarter — short enough that a book becomes
# measurable inside a reporting period, long enough that the off-diagonals mean something.
# Below it we return None rather than a fragile matrix: an unavailable number is honest,
# a number computed from 20 observations is not (ADR-0023).
MIN_OBS_FOR_COVARIANCE = 60


def decompose_risk(
    signed_weights: dict[str, float],
    returns: pd.DataFrame,
    confidence: float = 0.95,
) -> dict | None:
    """Decompose book volatility and VaR into per-position contributions.

    Args:
        signed_weights: {asset: weight}. **Signed** — shorts are negative. Used as given;
            see `_check_not_renormalised` in the tests for why they are not rescaled.
        returns: daily returns, date index, one column per asset (`fetch_pick_returns`).
        confidence: VaR confidence level, e.g. 0.95.

    Returns:
        A dict of book-level figures plus a `positions` list sorted by absolute risk
        contribution, or **None** when the inputs cannot support a covariance — no
        weights, fewer than two priced names, or fewer than `MIN_OBS_FOR_COVARIANCE`
        overlapping sessions.
    """
    if not signed_weights or returns is None or returns.empty:
        return None

    # Zero-weight names are not positions. They are excluded silently — unlike names that
    # are *held* but unpriced, which are reported (see `dropped` below), because those
    # carry real unmeasured risk and the caller has to be able to say so.
    weighted = {a: float(w) for a, w in signed_weights.items() if w}
    if not weighted:
        return None

    priced = [a for a in weighted if a in returns.columns]
    dropped = sorted(a for a in weighted if a not in returns.columns)
    if len(priced) < 2:
        return None

    # Inner join on common dates. A per-column dropna would leave each pair estimated over
    # a different window, and the resulting matrix need not be positive semi-definite —
    # which shows up as a negative wᵀΣw and a NaN volatility rather than as an error.
    aligned = returns[priced].dropna(how="any")
    if len(aligned) < MIN_OBS_FOR_COVARIANCE:
        return None

    # Order is fixed once here and reused for every vector below.
    assets = [a for a in priced if a in aligned.columns]
    w = np.array([weighted[a] for a in assets], dtype=float)

    cov = aligned[assets].cov().to_numpy() * TRADING_DAYS
    variance = float(w @ cov @ w)
    if not np.isfinite(variance) or variance <= 0:
        return None

    portfolio_vol = float(np.sqrt(variance))

    # ── The Euler decomposition ──────────────────────────────────────────────
    marginal = (cov @ w) / portfolio_vol          # MCRᵢ = ∂σ_p/∂wᵢ
    component = w * marginal                      # CCRᵢ, Σ CCRᵢ = σ_p exactly

    z = NormalDist().inv_cdf(confidence)
    portfolio_var = z * portfolio_vol
    component_var = z * component

    standalone = np.sqrt(np.diag(cov))

    positions = [
        {
            "asset": a,
            "signed_weight": float(w[i]),
            "standalone_vol": float(standalone[i]),
            "marginal_contribution": float(marginal[i]),
            "contribution_to_vol": float(component[i]),
            "component_var": float(component_var[i]),
            # Signed share of total risk. Sums to 1.0, but individual entries can be
            # negative for a hedge — never render this as a share-of-whole bar.
            "risk_contribution_pct": float(component[i] / portfolio_vol),
        }
        for i, a in enumerate(assets)
    ]
    positions.sort(key=lambda p: abs(p["contribution_to_vol"]), reverse=True)

    # Σ|wᵢ|σᵢ / σ_p. The textbook numerator is Σwᵢσᵢ, which is a long-only construct:
    # with shorts it can go negative and the "ratio" stops meaning anything.
    weighted_avg_vol = float(np.abs(w) @ standalone)

    return {
        "portfolio_vol": portfolio_vol,
        "portfolio_var": portfolio_var,
        "confidence": confidence,
        "gross_exposure": float(np.abs(w).sum()),
        "net_exposure": float(w.sum()),
        "diversification_ratio": (
            weighted_avg_vol / portfolio_vol if portfolio_vol > 0 else None
        ),
        "n_observations": int(len(aligned)),
        "lookback_start": str(aligned.index[0]),
        "lookback_end": str(aligned.index[-1]),
        "dropped_assets": dropped,
        "positions": positions,
    }
