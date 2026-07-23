"""
Unit tests for the HypeScore IC backtest core (scripts/backtest_hype.py).

Only the pure methodology functions are tested here — spearman_ic,
cross_sectional_ic, pooled_ic, forward_return, build_panel. The data layer
(run_backtest) needs live Supabase + yfinance and is exercised operationally,
not in CI.
"""
import os
import sys
from datetime import date

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.backtest_hype import (
    spearman_ic,
    cross_sectional_ic,
    pooled_ic,
    forward_return,
    build_panel,
)


# ─── spearman_ic ─────────────────────────────────────────────────────────────

def test_spearman_ic_perfect_positive():
    assert spearman_ic([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)


def test_spearman_ic_perfect_negative():
    assert spearman_ic([1, 2, 3, 4], [40, 30, 20, 10]) == pytest.approx(-1.0)


def test_spearman_ic_is_rank_based_not_linear():
    # Monotonic but nonlinear → rank IC still +1.
    assert spearman_ic([1, 2, 3, 4], [1, 4, 9, 16]) == pytest.approx(1.0)


def test_spearman_ic_constant_signal_is_none():
    assert spearman_ic([5, 5, 5, 5], [1, 2, 3, 4]) is None


def test_spearman_ic_too_few_points_is_none():
    assert spearman_ic([1, 2], [3, 4]) is None


def test_spearman_ic_ignores_nans():
    import numpy as np
    ic = spearman_ic([1, 2, 3, 4, np.nan], [10, 20, 30, 40, 99])
    assert ic == pytest.approx(1.0)


# ─── cross_sectional_ic ──────────────────────────────────────────────────────

def _panel(date_label, signals, fwds):
    return [
        {"date": date_label, "asset": f"A{i}", "signal": s, "fwd_return": f}
        for i, (s, f) in enumerate(zip(signals, fwds))
    ]


def test_cross_sectional_ic_perfect_across_dates():
    panel = (
        _panel("d1", [1, 2, 3, 4], [0.01, 0.02, 0.03, 0.04]) +
        _panel("d2", [1, 2, 3, 4], [0.005, 0.01, 0.02, 0.03])
    )
    res = cross_sectional_ic(panel)
    assert res["mean_ic"] == pytest.approx(1.0)
    assert res["n_dates"] == 2
    assert res["hit_rate"] == pytest.approx(1.0)


def test_cross_sectional_ic_mixed_sign_averages_out():
    panel = (
        _panel("d1", [1, 2, 3, 4], [0.01, 0.02, 0.03, 0.04]) +   # +1
        _panel("d2", [1, 2, 3, 4], [0.04, 0.03, 0.02, 0.01])     # -1
    )
    res = cross_sectional_ic(panel)
    assert res["mean_ic"] == pytest.approx(0.0)
    assert res["hit_rate"] == pytest.approx(0.5)
    assert res["n_dates"] == 2


def test_cross_sectional_ic_skips_thin_dates():
    panel = (
        _panel("d1", [1, 2, 3, 4], [0.01, 0.02, 0.03, 0.04]) +   # counts
        _panel("d2", [1, 2], [0.01, 0.02])                        # 2 names → skipped
    )
    res = cross_sectional_ic(panel)
    assert res["n_dates"] == 1


def test_cross_sectional_ic_empty_returns_none_fields():
    res = cross_sectional_ic([])
    assert res["mean_ic"] is None
    assert res["n_dates"] == 0


def test_pooled_ic_positive():
    panel = _panel("d1", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])
    assert pooled_ic(panel) == pytest.approx(1.0)


# ─── forward_return ──────────────────────────────────────────────────────────

def _prices():
    idx = pd.to_datetime(["2026-07-01", "2026-07-02", "2026-07-03",
                          "2026-07-06", "2026-07-07"])
    return pd.Series([100.0, 101.0, 102.0, 103.0, 104.0], index=idx)


def test_forward_return_one_step():
    assert forward_return(_prices(), "2026-07-01", 1) == pytest.approx(0.01)


def test_forward_return_multi_step():
    assert forward_return(_prices(), "2026-07-01", 4) == pytest.approx(0.04)


def test_forward_return_aligns_to_next_trading_row():
    # 2026-07-04 is a Saturday → entry aligns to 2026-07-06 (103).
    assert forward_return(_prices(), "2026-07-04", 1) == pytest.approx(104.0 / 103.0 - 1.0)


def test_forward_return_insufficient_future_is_none():
    # Entry at the last row → no forward row.
    assert forward_return(_prices(), "2026-07-07", 1) is None


def test_forward_return_empty_series_is_none():
    assert forward_return(pd.Series(dtype=float), "2026-07-01", 1) is None


# ─── build_panel ─────────────────────────────────────────────────────────────

def test_build_panel_assembles_and_skips_unpriced_and_short():
    history = [
        {"theme_id": "t1", "run_date": "2026-07-01", "hype_score": 70.0},
        {"theme_id": "t2", "run_date": "2026-07-01", "hype_score": 40.0},
        {"theme_id": "t3", "run_date": "2026-07-01", "hype_score": 55.0},  # asset unpriced
        {"theme_id": "t1", "run_date": "2026-07-07", "hype_score": 60.0},  # no forward row
    ]
    asset_map = {"t1": "AAA", "t2": "BBB", "t3": "CCC"}
    prices = {"AAA": _prices(), "BBB": _prices()}   # CCC missing on purpose

    panel = build_panel(history, asset_map, prices, horizon_days=1)

    # t3 dropped (no price); the 2026-07-07 t1 row dropped (no forward row).
    dates_assets = {(r["date"], r["asset"]) for r in panel}
    assert dates_assets == {("2026-07-01", "AAA"), ("2026-07-01", "BBB")}
    for r in panel:
        assert r["fwd_return"] == pytest.approx(0.01)
