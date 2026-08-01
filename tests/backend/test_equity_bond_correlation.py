"""Tests for equity_bond_correlation.compute_equity_bond_corr.

The function is a pure rolling-window correlation. Tests cover:
  - the formula on a synthetic frame with a known right answer
  - the SocGen flip rule
  - every absence path (status='unknown' / 'insufficient_history')

The synthetic frames are constructed so that the function's input
TRANSFORMS (simple returns for prices, first differences for yields)
are themselves monotonic, which is what makes the correlation ±1.0
exactly. A monotonically rising level is not sufficient: simple
returns divide by the level, so a linear-up level gives a
monotonically-DOWN return series, and a constant-derivative level
gives constant returns (zero variance → undefined correlation).
"""
import math
import sys
from datetime import date

sys.path.insert(0, "backend/services")

import pytest
from equity_bond_correlation import (
    SOCGEN_YIELD_THRESHOLD_PCT,
    _pearson,
    compute_equity_bond_corr,
)


def _spx_with_monotonic_returns(n: int = 250, *, start: float = 5000.0) -> list[float]:
    """SPX levels whose DAILY RETURNS form a strictly increasing series.
    That means levels grow quadratically in the index. We construct
    spx[0] = start, spx[i+1] = spx[i] * (1 + r0 * (i+1)) for small r0.
    """
    r0 = 0.0001
    out = [start]
    for i in range(1, n):
        out.append(out[-1] * (1.0 + r0 * i))
    return out


def _spx_with_monotonic_decreasing_returns(
    n: int = 250, *, start: float = 5000.0
) -> list[float]:
    """SPX levels whose DAILY RETURNS form a strictly decreasing series.
    spx[0] = start, spx[i+1] = spx[i] * (1 + r0 / (i+1)) for small r0.
    """
    r0 = 0.05
    out = [start]
    for i in range(1, n):
        out.append(out[-1] * (1.0 + r0 / (i + 1)))
    return out


def _ust10_with_monotonic_changes(
    n: int = 250, *, start: float = 3.0, end: float = 5.5
) -> list[float]:
    """Ust10 levels whose DAILY CHANGES form a strictly increasing series.
    cumulative_delta[i] = i * (end-start) / (n-1), so the increment
    from i-1 to i is (end-start) / (n-1), constant. To make changes
    monotonically INCREASING, use a quadratic cumulative."""
    out = [start]
    # cumulative changes are i*(i+1) form
    cumulative = [0.0]
    for i in range(1, n):
        cumulative.append(cumulative[-1] + i)
    # rescale so cumulative[n-1] = (end - start)
    scale = (end - start) / cumulative[-1]
    for i in range(1, n):
        out.append(start + cumulative[i] * scale)
    return out


def _ust10_decreasing_changes(
    n: int = 250, *, start: float = 5.5, end: float = 3.0
) -> list[float]:
    """Ust10 levels whose DAILY CHANGES form a strictly decreasing series.
    Negative direction; cumulative decreases."""
    return _ust10_with_monotonic_changes(n, start=start, end=end)


def test_pearson_helper_is_pure_math() -> None:
    """The Pearson r helper is unit-testable directly: given two
    perfectly collinear series, r = 1.0; given perfect anti-correlation,
    r = -1.0; given one constant, r is None."""
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    ys = [2.0, 4.0, 6.0, 8.0, 10.0]
    assert _pearson(xs, ys) == pytest.approx(1.0, abs=1e-12)
    assert _pearson(xs, [-y for y in ys]) == pytest.approx(-1.0, abs=1e-12)
    assert _pearson(xs, [5.0] * 5) is None  # zero variance in y
    assert _pearson([5.0] * 5, ys) is None  # zero variance in x


def test_known_positive_corr() -> None:
    """SPX with monotonically-increasing returns and ust10 with
    monotonically-increasing changes. Pearson r is positive, near
    +1.0; not exactly +1.0 because the spx return sequence is not
    a linear function of the change sequence — the function uses
    simple returns, not log returns, and the relationship is
    monotonic but not perfectly linear."""
    spx = _spx_with_monotonic_returns(250, start=5000.0)
    ust10 = _ust10_with_monotonic_changes(250, start=3.0, end=5.5)
    r = compute_equity_bond_corr(spx, ust10)
    assert r["status"] == "measured"
    assert r["corr"] is not None
    assert r["corr"] > 0.95, f"expected strongly positive corr, got {r['corr']}"
    assert r["socgen_flip_active"] is False  # corr > 0, no flip


def test_known_negative_corr_with_high_yields_triggers_socgen() -> None:
    """SocGen rule: corr<0 AND ust10>4.5 -> socgen_flip_active=True.
    SPX with monotonically-decreasing returns, ust10 with
    monotonically-increasing changes ending above 4.5%."""
    spx = _spx_with_monotonic_decreasing_returns(250, start=5000.0)
    ust10 = _ust10_with_monotonic_changes(250, start=3.0, end=5.5)
    r = compute_equity_bond_corr(spx, ust10)
    assert r["status"] == "measured"
    assert r["corr"] is not None
    assert r["corr"] < -0.95, f"expected strongly negative corr, got {r['corr']}"
    assert r["ust10_pct"] > SOCGEN_YIELD_THRESHOLD_PCT
    assert r["socgen_flip_active"] is True


def test_negative_corr_below_yield_threshold_does_not_trigger() -> None:
    """Same negative correlation but ust10 below 4.5% — flip rule
    requires BOTH conditions."""
    spx = _spx_with_monotonic_decreasing_returns(250, start=5000.0)
    ust10 = _ust10_with_monotonic_changes(250, start=2.0, end=3.2)
    r = compute_equity_bond_corr(spx, ust10)
    assert r["status"] == "measured"
    assert r["corr"] is not None
    assert r["corr"] < -0.95
    assert r["ust10_pct"] < SOCGEN_YIELD_THRESHOLD_PCT
    assert r["socgen_flip_active"] is False


def test_insufficient_history_returns_status() -> None:
    """Too few paired observations => insufficient_history, not
    a flaky correlation computed on noise."""
    spx = _spx_with_monotonic_returns(10, start=5000.0)
    ust10 = _ust10_with_monotonic_changes(10, start=4.0, end=4.5)
    r = compute_equity_bond_corr(spx, ust10, min_pairs=20)
    assert r["status"] == "insufficient_history"
    assert r["corr"] is None
    assert r["socgen_flip_active"] is None
    assert r["reason"] is not None


def test_mismatched_lengths_returns_unknown() -> None:
    r = compute_equity_bond_corr([100.0, 101.0, 102.0], [4.0, 4.1])
    assert r["status"] == "unknown"
    assert r["reason"] is not None


def test_zero_variance_leg_returns_unknown() -> None:
    """If ust10 never moves (constant), the correlation is undefined.
    Must not be reported as 0.0 or 1.0 by accident."""
    spx = _spx_with_monotonic_returns(250, start=5000.0)
    ust10 = [4.5] * 250
    r = compute_equity_bond_corr(spx, ust10)
    assert r["status"] in ("unknown", "insufficient_history")
    assert r["corr"] is None


def test_default_window_is_60_days() -> None:
    spx = _spx_with_monotonic_returns(250, start=5000.0)
    ust10 = _ust10_with_monotonic_changes(250, start=3.0, end=5.5)
    r = compute_equity_bond_corr(spx, ust10)
    assert r["lookback_days"] == 60
    assert r["n_pairs"] == 60


def test_as_of_echo() -> None:
    spx = _spx_with_monotonic_returns(250, start=5000.0)
    ust10 = _ust10_with_monotonic_changes(250, start=3.0, end=5.5)
    d = date(2026, 7, 31)
    r = compute_equity_bond_corr(spx, ust10, as_of=d)
    assert r["as_of"] == d


# Silence unused import warnings: math is imported for the Pearson
# helper signature tests; date is imported for the as_of echo test.
_ = (math, date)
