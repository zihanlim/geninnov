"""
A backtest of one weight vector, and the ways it must not be mistaken for a track record.

The numbers here are easy. What is worth testing is the discipline around them: that an
unpriced holding is excluded rather than treated as flat, that a short window refuses with a
reason instead of producing a confident drawdown, and that the caveats travel in the payload
rather than living on a page an MCP consumer never sees.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.weights_backtest import (  # noqa: E402
    METHOD_ID,
    MIN_SESSIONS,
    backtest_weights,
)

ASSETS = ["A", "B", "C"]


def _returns(n=300, seed=5):
    rng = np.random.default_rng(seed)
    return pd.DataFrame(
        rng.normal(0.0004, 0.011, size=(n, 3)),
        columns=ASSETS,
        index=pd.date_range("2025-01-01", periods=n, freq="B"),
    )


WEIGHTS = {"A": 0.2, "B": -0.15, "C": 0.1}


def test_it_computes_the_path_statistics_ex_ante_cannot():
    out = backtest_weights(WEIGHTS, _returns())
    assert out["computed"] is True
    for key in ("max_drawdown", "sortino", "calmar", "var_95_historical", "es_95_historical"):
        assert out[key] is not None, f"{key} should resolve on a full window"
    assert out["max_drawdown"] <= 0
    assert out["n_observations"] == 300


def test_it_never_claims_to_be_a_track_record():
    """Stored as a literal, not inferred from the column name — this column is reachable
    through /ask and the MCP server, where page copy does not travel."""
    out = backtest_weights(WEIGHTS, _returns())
    assert out["is_track_record"] is False
    assert "chosen knowing this history" in out["selection_caveat"]
    assert "no rebalancing" in out["method_caveat"]
    assert out["method_id"] == METHOD_ID


def test_an_unpriced_holding_is_excluded_not_treated_as_flat():
    """A zero return for a name we cannot price would assert the position was flat AND
    leave its weight diluting the total. Both are wrong; the honest move is to exclude it
    and report the coverage."""
    weights = {**WEIGHTS, "GONE": 0.05}
    out = backtest_weights(weights, _returns())
    assert out["dropped_assets"] == ["GONE"]
    assert out["gross_total"] == pytest.approx(0.50)
    assert out["gross_covered"] == pytest.approx(0.45)
    assert out["coverage_share"] == pytest.approx(0.9)

    # And the series itself must be identical to the one without the phantom holding —
    # if the drop leaked in as a zero, the cumulative return would move.
    clean = backtest_weights(WEIGHTS, _returns())
    assert out["cumulative_return"] == pytest.approx(clean["cumulative_return"])


def test_a_short_window_refuses_with_a_reason_rather_than_a_confident_drawdown():
    out = backtest_weights(WEIGHTS, _returns(n=100))
    assert out["computed"] is False
    assert out["n_observations"] == 100
    assert out["min_sessions"] == MIN_SESSIONS
    assert "describes the window, not the book" in out["reason"]
    # No statistics at all — not zeros, not nulls in a shape that reads as measured.
    assert "max_drawdown" not in out
    assert "sharpe" not in out


def test_the_window_is_the_intersection_across_held_names():
    """A per-column dropna would compute each day's book return from a different subset of
    the book — the same trap `decompose_risk` documents."""
    frame = _returns()
    frame.loc[frame.index[:40], "B"] = np.nan
    out = backtest_weights(WEIGHTS, frame, min_sessions=200)
    assert out["computed"] is True
    assert out["n_observations"] == 260
    assert out["window_start"] == str(frame.index[40])


def test_shorts_contribute_negatively():
    """Signed weights, as everywhere else here. If the sign were dropped, a book that is
    short a falling asset would show a loss."""
    frame = _returns()
    frame["B"] = 0.01          # B rises every day
    frame["A"] = 0.0
    frame["C"] = 0.0
    out = backtest_weights({"A": 0.0, "B": -0.15, "C": 0.0}, frame)
    assert out["cumulative_return"] < 0, "short a rising asset must lose"

    out_long = backtest_weights({"A": 0.0, "B": +0.15, "C": 0.0}, frame)
    assert out_long["cumulative_return"] > 0


def test_benchmark_comparison_rides_along_when_available():
    frame = _returns()
    rng = np.random.default_rng(9)
    benchmark = [
        (d.strftime("%Y-%m-%d"), float(v))
        for d, v in zip(frame.index, rng.normal(0.0003, 0.01, len(frame)))
    ]
    out = backtest_weights(WEIGHTS, frame, benchmark=benchmark)
    assert "benchmark" in out
    assert out["benchmark"]["n"] > 0
    assert "down_capture" in out["benchmark"]


def test_nothing_to_backtest_returns_none():
    assert backtest_weights({}, _returns()) is None
    assert backtest_weights(WEIGHTS, pd.DataFrame()) is None
    assert backtest_weights({"A": 0.0}, _returns()) is None
    # Every held name unpriced: there is no series to compute, not a zero one.
    assert backtest_weights({"NOPE": 0.2}, _returns()) is None


def test_non_finite_statistics_become_none_not_nan():
    """NaN mangles differently in JSON and in a REAL column. An unresolved statistic is
    unavailable (ADR-0066)."""
    flat = pd.DataFrame(
        {a: [0.0] * 300 for a in ASSETS},
        index=pd.date_range("2025-01-01", periods=300, freq="B"),
    )
    out = backtest_weights(WEIGHTS, flat)
    assert out["computed"] is True
    # Zero variance and zero drawdown: Sharpe, Sortino and Calmar are all undefined.
    for key in ("sharpe", "sortino", "calmar"):
        assert out[key] is None, f"{key} should be None, not NaN"


def test_the_fetch_window_can_actually_reach_the_floor():
    """The defect this file's own floor caused, as a test.

    `MIN_SESSIONS` is 252 TRADING days. `finalise_book_analytics` asks
    `fetch_pick_returns` for a window in CALENDAR days, and the first live run requested
    252 — about 195 trading sessions — so the backtest returned "190 sessions against the
    252 needed" and could never have computed. A capability with no reachable caller
    (ADR-0099), in the code written to avoid exactly that.

    Derived rather than asserted against a magic number: whatever lookback the pipeline
    requests must, at the ~252/365 trading-day density, leave headroom over the floor.
    """
    import re

    source = (
        Path(__file__).resolve().parents[2] / "backend" / "services" / "q1_agent.py"
    ).read_text(encoding="utf-8")

    match = re.search(
        r"fetch_pick_returns\(sorted\(signed\.keys\(\)\), lookback_days=(\d+)\)", source
    )
    assert match, "the backtest's own fetch should be explicit about its lookback"
    calendar_days = int(match.group(1))

    trading_days = calendar_days * 252 / 365
    assert trading_days > MIN_SESSIONS, (
        f"a {calendar_days}-calendar-day window is about {trading_days:.0f} trading "
        f"sessions, under the {MIN_SESSIONS} the floor needs — the backtest could never "
        "compute"
    )
