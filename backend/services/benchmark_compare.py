"""
L4 — the book versus its benchmark: tracking error, information ratio, capture.

Read from `im-Jarvis/backend/app/services/benchmark_compare.py` (its S.2 / ADR-0031)
and reimplemented in float on 252-day annualisation.

**What this closes.** ADR-0094 built `benchmark_returns` so `/risk` could answer
"versus what?", and the answer it can currently give is a second line on a cumulative
chart. Two curves is the *picture* of relative performance, not the *measurement* of
it. A reader who can see the book beat the index by 2% still cannot tell whether that
came from taking more risk, from a different risk, or from skill.

Six numbers answer that, and none of them existed here before:

    active_return    = portfolio_cumulative - benchmark_cumulative
    tracking_error   = stdev(p - b) * sqrt(252)
    information_ratio= annualised active return / tracking error
    beta             = cov(p, b) / var(b)
    up_capture       = compounded p over days b rose / compounded b over those days
    down_capture     = same, over the days b fell

Up/down capture is the pair that matters most for **this** book, because it is
market-neutral by construction: a book whose whole claim is that it is short the market
should show a down-capture below zero. That is a checkable claim, and until now nothing
checked it.

**Statistics are computed over the common dates only.** Inner-join, ascending. A
session where one series has an observation and the other does not tells you nothing
about relative performance, and carrying it forward would let a market holiday register
as a day of pure alpha.

**Both series must share an origin.** `benchmark_returns.cumulative_return` is already
compounded from the BOOK's inception for exactly this reason (ADR-0094). This module
recompounds from the aligned daily returns rather than trusting either stored
cumulative, so the overlay it emits cannot disagree with the statistics beside it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

TRADING_DAYS = 252

# Below this, an annualised tracking error is an artefact of the sample rather than a
# measurement of the book. The number is still returned — with `n` beside it, so the
# reader can discount it — but `sufficient` says plainly that it is thin.
MIN_OBS_FOR_STATISTICS = 20


@dataclass(frozen=True)
class ComparisonMetrics:
    n: int
    as_of: str | None
    sufficient: bool
    portfolio_cumulative: float
    benchmark_cumulative: float
    active_return: float
    tracking_error: float
    information_ratio: float | None
    beta: float | None
    correlation: float | None
    up_capture: float | None
    down_capture: float | None
    up_days: int
    down_days: int
    overlay: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self, include_overlay: bool = False) -> dict:
        out = {
            "n": self.n,
            "as_of": self.as_of,
            "sufficient": self.sufficient,
            "portfolio_cumulative": self.portfolio_cumulative,
            "benchmark_cumulative": self.benchmark_cumulative,
            "active_return": self.active_return,
            "tracking_error": self.tracking_error,
            "information_ratio": self.information_ratio,
            "beta": self.beta,
            "correlation": self.correlation,
            "up_capture": self.up_capture,
            "down_capture": self.down_capture,
            "up_days": self.up_days,
            "down_days": self.down_days,
            "warnings": list(self.warnings),
        }
        if include_overlay:
            out["overlay"] = list(self.overlay)
        return out


def _compound(returns: list[float]) -> float:
    """prod(1 + r) - 1."""
    accumulator = 1.0
    for r in returns:
        accumulator *= 1.0 + r
    return accumulator - 1.0


def _capture(
    portfolio: list[float], benchmark: list[float], up: bool
) -> tuple[float | None, int]:
    """Geometric up/down capture, and the number of days it was measured over.

    Returns `(None, count)` when the benchmark's compounded move over those days is
    zero — the ratio is undefined, and reporting it as 0 or 1 would both be claims the
    data does not support. The count travels regardless, because "no up days in the
    sample" and "up days that netted to nothing" are different absences (ADR-0098).
    """
    selected = [
        (p, b) for p, b in zip(portfolio, benchmark) if (b > 0.0 if up else b < 0.0)
    ]
    if not selected:
        return None, 0
    benchmark_move = _compound([b for _, b in selected])
    if benchmark_move == 0.0:
        return None, len(selected)
    return _compound([p for p, _ in selected]) / benchmark_move, len(selected)


def compute_comparison(
    portfolio: list[tuple[str, float]],
    benchmark: list[tuple[str, float]],
    trading_days: int = TRADING_DAYS,
) -> ComparisonMetrics | None:
    """Compare two daily-return series over their common dates.

    Args:
        portfolio: [(iso_date, daily_return), ...] — e.g. `portfolio_returns`.
        benchmark: [(iso_date, daily_return), ...] — e.g. `benchmark_returns`.

    Returns None on an empty intersection, so the caller renders "no overlap" rather
    than a row of zeros that reads like a measured result.
    """
    if not portfolio or not benchmark:
        return None

    benchmark_by_date = {str(d): float(r) for d, r in benchmark if r is not None}
    common = sorted(
        (str(d), float(r), benchmark_by_date[str(d)])
        for d, r in portfolio
        if r is not None and str(d) in benchmark_by_date
    )
    n = len(common)
    if n == 0:
        return None

    p = [row[1] for row in common]
    b = [row[2] for row in common]
    active = [pi - bi for pi, bi in zip(p, b)]

    portfolio_cumulative = _compound(p)
    benchmark_cumulative = _compound(b)

    warnings: list[str] = []
    sufficient = n >= MIN_OBS_FOR_STATISTICS
    if not sufficient:
        warnings.append(
            f"{n} overlapping sessions — below the {MIN_OBS_FOR_STATISTICS} this "
            "repo treats as the floor for an annualised statistic"
        )

    # Sample statistics (ddof=1), matching `risk_engine`. The source uses population
    # (ddof=0) to stay bit-compatible with its own legacy oracle; matching the local
    # convention matters more, or the book reports two tracking errors.
    if n >= 2:
        active_mean = sum(active) / n
        active_variance = sum((a - active_mean) ** 2 for a in active) / (n - 1)
        tracking_error = math.sqrt(active_variance) * math.sqrt(trading_days)

        p_mean, b_mean = sum(p) / n, sum(b) / n
        covariance = sum((pi - p_mean) * (bi - b_mean) for pi, bi in zip(p, b)) / (n - 1)
        p_variance = sum((pi - p_mean) ** 2 for pi in p) / (n - 1)
        b_variance = sum((bi - b_mean) ** 2 for bi in b) / (n - 1)
    else:
        active_mean = 0.0
        tracking_error = 0.0
        covariance = p_variance = b_variance = 0.0

    information_ratio = (
        (active_mean * trading_days) / tracking_error if tracking_error > 0 else None
    )
    beta = covariance / b_variance if b_variance > 0 else None
    correlation = (
        covariance / math.sqrt(p_variance * b_variance)
        if p_variance > 0 and b_variance > 0
        else None
    )

    up_capture, up_days = _capture(p, b, up=True)
    down_capture, down_days = _capture(p, b, up=False)

    overlay: list[dict] = []
    portfolio_accumulator = 1.0
    benchmark_accumulator = 1.0
    for date, pi, bi in common:
        portfolio_accumulator *= 1.0 + pi
        benchmark_accumulator *= 1.0 + bi
        overlay.append(
            {
                "date": date,
                "portfolio_cumulative": portfolio_accumulator - 1.0,
                "benchmark_cumulative": benchmark_accumulator - 1.0,
            }
        )

    return ComparisonMetrics(
        n=n,
        as_of=common[-1][0],
        sufficient=sufficient,
        portfolio_cumulative=portfolio_cumulative,
        benchmark_cumulative=benchmark_cumulative,
        active_return=portfolio_cumulative - benchmark_cumulative,
        tracking_error=tracking_error,
        information_ratio=information_ratio,
        beta=beta,
        correlation=correlation,
        up_capture=up_capture,
        down_capture=down_capture,
        up_days=up_days,
        down_days=down_days,
        overlay=overlay,
        warnings=warnings,
    )
