import math
import sys
import os

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.risk_engine import (
    value_at_risk,
    conditional_value_at_risk,
    sharpe_ratio,
    beta_to_spx,
    concentration_hhi,
    compute_risk_metrics,
    portfolio_daily_return,
    annualized_vol,
    _z_score,
    _normal_pdf,
)


def _returns(values):
    return pd.Series(values)


# ── _z_score / _normal_pdf ───────────────────────────────────────────────────


def test_z_score_95():
    """z(0.95) one-tailed ~ 1.6449."""
    assert abs(_z_score(0.95) - 1.6449) < 0.001


def test_z_score_99():
    """z(0.99) one-tailed ~ 2.3263. Winitzki approximation is ~2e-3 at the tails."""
    assert abs(_z_score(0.99) - 2.3263) < 0.005


def test_normal_pdf_at_zero():
    """phi(0) = 1/sqrt(2*pi) ~ 0.3989."""
    assert abs(_normal_pdf(0) - 0.3989) < 0.001


# ── value_at_risk ────────────────────────────────────────────────────────────


def test_var_positive_for_nonzero_returns():
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 100))
    var = value_at_risk(rets, portfolio_value=100_000_000, confidence=0.95)
    assert var is not None
    assert var > 0


def test_var_scales_with_portfolio_value():
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 100))
    var_1x = value_at_risk(rets, portfolio_value=100_000_000)
    var_2x = value_at_risk(rets, portfolio_value=200_000_000)
    assert abs(var_2x - 2 * var_1x) < 1e-6


def test_var_none_for_insufficient_history():
    rets = _returns([0.01, -0.02, 0.005])
    assert value_at_risk(rets, portfolio_value=100_000_000) is None


# ── conditional_value_at_risk ───────────────────────────────────────────────


def test_cvar_larger_than_var():
    """For normal returns, CVaR should exceed VaR (tail is heavier than the threshold)."""
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 200))
    var = value_at_risk(rets, 100_000_000)
    cvar = conditional_value_at_risk(rets, 100_000_000)
    assert var is not None and cvar is not None
    assert cvar > var


def test_cvar_95_matches_formula():
    """CVaR_0.95 = sigma * phi(1.645) / 0.05 * PV."""
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 200))
    sigma = float(rets.std(ddof=1))
    expected = sigma * 0.1031 / 0.05 * 100_000_000
    cvar = conditional_value_at_risk(rets, 100_000_000, confidence=0.95)
    assert cvar is not None
    assert abs(cvar - expected) / expected < 0.01


# ── sharpe_ratio ─────────────────────────────────────────────────────────────


def test_sharpe_zero_for_zero_returns():
    """All-zero returns -> std=0 -> Sharpe is undefined, returns None."""
    rets = _returns([0.0] * 100)
    assert sharpe_ratio(rets) is None


def test_sharpe_higher_for_higher_excess_return():
    """Higher mean / same std -> higher Sharpe."""
    rng = np.random.default_rng(42)
    rets_low = _returns(rng.normal(0.0001, 0.01, 100))
    rets_high = _returns(rng.normal(0.001, 0.01, 100))
    s_low = sharpe_ratio(rets_low)
    s_high = sharpe_ratio(rets_high)
    assert s_low is not None and s_high is not None
    assert s_high > s_low


def test_sharpe_none_for_insufficient_history():
    rets = _returns([0.01] * 30)  # < MIN_DAYS_FOR_SHARPE (60)
    assert sharpe_ratio(rets) is None


# ── beta_to_spx ──────────────────────────────────────────────────────────────


def test_beta_equals_one_when_perfectly_correlated():
    n = 100
    spx = _returns(np.random.default_rng(0).normal(0.001, 0.01, n))
    port = spx + 0.0001  # identical return stream (no scaling)
    b = beta_to_spx(port, spx)
    assert b is not None
    assert abs(b - 1.0) < 0.01


def test_beta_one_point_five_with_leverage():
    n = 100
    spx = _returns(np.random.default_rng(0).normal(0.001, 0.01, n))
    port = spx * 1.5 + 0.0001  # 1.5x leveraged exposure
    b = beta_to_spx(port, spx)
    assert b is not None
    assert abs(b - 1.5) < 0.01


def test_beta_negative_for_inverse_returns():
    n = 100
    spx = _returns(np.random.default_rng(0).normal(0.001, 0.01, n))
    port = -spx + 0.0001
    b = beta_to_spx(port, spx)
    assert b is not None
    assert b < 0


def test_beta_none_for_insufficient_history():
    spx = _returns([0.01, -0.005, 0.002])
    port = _returns([0.01, -0.005, 0.002])
    assert beta_to_spx(port, spx) is None


# ── concentration_hhi ───────────────────────────────────────────────────────


def test_hhi_zero_for_no_positions():
    assert concentration_hhi([]) == 0.0


def test_hhi_max_for_single_position():
    assert concentration_hhi([1.0]) == 10000.0


def test_hhi_scales_with_concentration():
    hhi_concentrated = concentration_hhi([1.0, 0.0, 0.0])
    hhi_balanced = concentration_hhi([1 / 3, 1 / 3, 1 / 3])
    assert hhi_concentrated > hhi_balanced


# ── portfolio_daily_return ───────────────────────────────────────────────────


def test_daily_return_long_position():
    positions = [{"asset": "TLT", "weight": 0.5, "direction": "long"}]
    r = portfolio_daily_return({"TLT": 0.02}, positions, 100_000_000)
    assert abs(r - 0.01) < 1e-9  # 0.5 * 0.02


def test_daily_return_short_position_sign_flips():
    positions = [{"asset": "HYG", "weight": 0.5, "direction": "short"}]
    r = portfolio_daily_return({"HYG": 0.02}, positions, 100_000_000)
    assert abs(r - (-0.01)) < 1e-9


def test_daily_return_mixed_portfolio():
    positions = [
        {"asset": "TLT", "weight": 0.5, "direction": "long"},
        {"asset": "HYG", "weight": 0.5, "direction": "short"},
    ]
    # TLT +1%, HYG +2% -> long: +0.005, short: -0.01 -> total: -0.005
    r = portfolio_daily_return({"TLT": 0.01, "HYG": 0.02}, positions, 100_000_000)
    assert abs(r - (-0.005)) < 1e-9


def test_daily_return_handles_missing_ticker():
    positions = [{"asset": "TLT", "weight": 0.5, "direction": "long"}]
    r = portfolio_daily_return({}, positions, 100_000_000)
    assert r == 0.0


def test_daily_return_empty_portfolio():
    assert portfolio_daily_return({}, [], 100_000_000) == 0.0


# ── compute_risk_metrics bundle ─────────────────────────────────────────────


def test_compute_risk_metrics_returns_all_keys():
    positions = [
        {"notional": 50_000_000, "weight": 0.5},
        {"notional": 50_000_000, "weight": 0.5},
    ]
    rets = _returns(np.random.default_rng(0).normal(0, 0.01, 200))
    spx = _returns(np.random.default_rng(1).normal(0, 0.01, 200))
    m = compute_risk_metrics(positions, rets, spx_returns=spx, risk_free_annual=0.045)
    expected = {"total_capital", "var_95", "cvar_95", "sharpe", "beta", "concentration_hhi"}
    assert set(m.keys()) == expected
    assert m["total_capital"] == 100_000_000
    assert m["var_95"] is not None and m["var_95"] > 0
    assert m["cvar_95"] is not None and m["cvar_95"] > 0
    assert m["sharpe"] is not None
    assert m["beta"] is not None
    # 50/50 weights -> HHI = 0.5^2 + 0.5^2 = 0.5, *10000 = 5000
    assert abs(m["concentration_hhi"] - 5000.0) < 1e-6


def test_compute_risk_metrics_handles_no_history():
    """With empty returns, VaR/CVaR/Sharpe are None, HHI still computable."""
    positions = [{"notional": 100_000_000, "weight": 1.0}]
    rets = _returns([])
    m = compute_risk_metrics(positions, rets)
    assert m["var_95"] is None
    assert m["cvar_95"] is None
    assert m["sharpe"] is None
    assert m["beta"] is None
    assert m["concentration_hhi"] == 10000.0


# ── annualized_vol ──────────────────────────────────────────────────────────


def test_annualized_vol_zero_for_constant_returns():
    rets = _returns([0.01] * 100)
    vol = annualized_vol(rets)
    assert vol is not None
    assert abs(vol) < 1e-10


def test_annualized_vol_known_value():
    """Std of 0.01 daily, annualized = 0.01 * sqrt(252) ~ 0.1587."""
    rets = _returns([0.01, -0.01] * 50)
    vol = annualized_vol(rets)
    assert vol is not None
    expected = 0.01 * math.sqrt(252)
    assert abs(vol - expected) / expected < 0.01
