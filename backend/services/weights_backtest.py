"""
What THESE weights would have done — which is not what we did.

**The problem this solves.** The book is three sessions old. Every realised statistic on
`/risk` is therefore withheld: VaR needs 30 sessions, Sharpe 60, historical VaR 100, Calmar
a full year. The ex-ante figures (`risk_decomposition`, `monte_carlo_var`, `var_forecast`)
cover the risk question honestly on day one because they borrow history from the
CONSTITUENTS rather than from the book — but they are all distributional. They say nothing
about the *path*: drawdown depth, downside asymmetry, or how the book behaves specifically
on days the market falls. Those are the emptiest panels on the page and ex-ante cannot fill
them.

**What this is.** Hold today's published weights fixed across 252 days of constituent
returns and read the path statistics off the resulting series.

**What this is NOT, and the distinction is the whole design.** It is a *backtest of one
weight vector*, not a track record. Three things follow and all three are enforced rather
than described:

1. **It never touches `portfolio_returns`.** That table is the realised series `/risk`
   reads and `pick_outcomes` scores against; writing a simulated series into it would
   assert the book earned returns it did not. `scripts/backfill_regime.py` already refuses
   the same move for the book itself — *"writing it into research_recommendations would
   assert the system published on days it did not"* — and this is that rule applied one
   table along.
2. **It is weaker evidence than it looks, because the weights were chosen knowing this
   history.** Today's book holds single names added in migration 032 partly because they
   screened well recently. A backtest over the window that informed the selection is
   contaminated by construction. `selection_caveat` travels in the payload so the caveat
   cannot be left behind in a commit message.
3. **Fixed weights, no rebalancing, no costs.** A real book drifts and is rebalanced, and
   each rebalance costs (`cost_model`). This is the frictionless version, which flatters.

**Why it is still worth computing.** "How would this book have behaved through the last
year" is a question a reviewer will ask, and answering it with a stated method beats
answering it with silence — provided the answer never wears the clothes of a track record.

See ADR-0112.
"""
from __future__ import annotations

import math
from typing import Optional

import pandas as pd

from .benchmark_compare import compute_comparison
from .risk_engine import (
    _annualized_sharpe,
    _annualized_sortino,
    _calmar,
    _historical_es,
    _historical_var,
    _max_drawdown,
)

TRADING_DAYS = 252

# A path statistic needs a path. Below a year the drawdown and Calmar describe a window
# rather than the book, which is the same reason `MIN_DAYS_FOR_CALMAR` is 252.
MIN_SESSIONS = 252

METHOD_ID = "risk.backtest.fixed_weights.v1"

SELECTION_CAVEAT = (
    "These weights were chosen knowing this history — several holdings entered the "
    "universe because they screened well recently — so the window that scores them is the "
    "window that informed them. Read this as a description of the weight vector, not as "
    "evidence the selection works."
)

METHOD_CAVEAT = (
    "Weights are held FIXED across the window: no rebalancing, no drift, no transaction "
    "costs. A real book would have paid to stay at these weights."
)


def backtest_weights(
    signed_weights: dict[str, float],
    returns: pd.DataFrame,
    benchmark: Optional[list[tuple[str, float]]] = None,
    min_sessions: int = MIN_SESSIONS,
) -> Optional[dict]:
    """Path statistics for a fixed weight vector over the constituents' own history.

    Args:
        signed_weights: {asset: weight}, **signed** — shorts negative, as everywhere here.
        returns:        daily returns, date index, one column per asset. The SAME frame
                        `decompose_risk` and the optimizer use, so the backtest and the
                        ex-ante figures describe one reading of history rather than two.
        benchmark:      [(iso_date, daily_return)] for the reference series, if available.

    Returns None when the window cannot support path statistics — which is a finding, not
    a failure, and the caller renders it as one (ADR-0023).
    """
    if not signed_weights or returns is None or returns.empty:
        return None

    weighted = {a: float(w) for a, w in signed_weights.items() if w}
    if not weighted:
        return None

    priced = [a for a in weighted if a in returns.columns]
    dropped = sorted(a for a in weighted if a not in returns.columns)
    if not priced:
        return None

    # Inner join, for the reason `decompose_risk` gives: a per-column dropna would compute
    # each day's book return from a different subset of the book.
    aligned = returns[priced].dropna(how="any")
    if len(aligned) < min_sessions:
        return {
            "computed": False,
            "method_id": METHOD_ID,
            "n_observations": int(len(aligned)),
            "min_sessions": min_sessions,
            "dropped_assets": dropped,
            "reason": (
                f"{len(aligned)} overlapping sessions across the held names, against the "
                f"{min_sessions} a path statistic needs. A drawdown measured over less than "
                "a year describes the window, not the book."
            ),
        }

    # The book's daily return under fixed weights. Names the frame cannot price are EXCLUDED
    # from the weight vector rather than treated as zero-return: a zero would quietly assert
    # the unpriced position was flat, and its weight would still dilute the total.
    vector = pd.Series({a: weighted[a] for a in priced})
    series = aligned[priced].mul(vector, axis=1).sum(axis=1)

    covered = float(sum(abs(w) for w in vector))
    total_gross = float(sum(abs(w) for w in weighted.values()))

    cumulative = float((1.0 + series).prod() - 1.0)
    annualised_return = float(series.mean() * TRADING_DAYS)
    annualised_vol = float(series.std(ddof=1) * math.sqrt(TRADING_DAYS))

    out = {
        "computed": True,
        "method_id": METHOD_ID,
        "n_observations": int(len(series)),
        "window_start": str(aligned.index[0]),
        "window_end": str(aligned.index[-1]),
        "n_priced": len(priced),
        "dropped_assets": dropped,
        # How much of the book the backtest could actually hold. Coverage first, for the
        # same reason the crowding overlay leads with it: a path statistic over 60% of the
        # book is not a path statistic about the book.
        "gross_covered": covered,
        "gross_total": total_gross,
        "coverage_share": (covered / total_gross) if total_gross > 0 else None,
        "cumulative_return": cumulative,
        "annualised_return": annualised_return,
        "annualised_vol": annualised_vol,
        # Reusing risk_engine's own estimators rather than reimplementing them: two copies
        # of a Sortino would drift, and the whole point of the ported quant layer is that
        # there is one implementation per statistic.
        "sharpe": _finite(_annualized_sharpe(series)),
        "sortino": _finite(_annualized_sortino(series)),
        "max_drawdown": _finite(_max_drawdown(series)),
        "calmar": _finite(_calmar(series)),
        "var_95_historical": _finite(_historical_var(series, 0.95)),
        "es_95_historical": _finite(_historical_es(series, 0.95)),
        "best_day": float(series.max()),
        "worst_day": float(series.min()),
        "positive_days": int((series > 0).sum()),
        "selection_caveat": SELECTION_CAVEAT,
        "method_caveat": METHOD_CAVEAT,
        "is_track_record": False,
    }

    if benchmark:
        try:
            portfolio = [
                (pd.Timestamp(d).strftime("%Y-%m-%d"), float(v))
                for d, v in zip(series.index, series.values)
            ]
            comparison = compute_comparison(portfolio, benchmark)
            if comparison is not None:
                out["benchmark"] = comparison.to_dict()
        except Exception as exc:                       # pragma: no cover - defensive
            out["benchmark_error"] = f"{exc.__class__.__name__}: {exc}"

    return out


def _finite(value: float) -> Optional[float]:
    """NaN and infinity become None. A statistic that did not resolve is unavailable, and
    `REAL` columns and JSON both mangle NaN in their own ways (ADR-0066)."""
    return float(value) if isinstance(value, float) and math.isfinite(value) else None
