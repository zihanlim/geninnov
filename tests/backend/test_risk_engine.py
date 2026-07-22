import math
import sys
import os

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.risk_engine import (
    value_at_risk,
    conditional_value_at_risk,
    sharpe_ratio,
    beta_to_spx,
    concentration_hhi,
    compute_risk,
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


# ── compute_risk (derivation-aware) ─────────────────────────────────────────


def test_risk_engine_returns_derivations(monkeypatch):
    from backend.services import risk_engine as re
    book = [
        {"ticker": "A", "weight": 0.5, "price_today": 101.0, "price_yesterday": 100.0},
        {"ticker": "B", "weight": -0.5, "price_today": 99.0, "price_yesterday": 100.0},
    ]
    history = [0.001, -0.002, 0.0005, 0.003]
    out = re.compute_risk(book=book, history=history, spx_returns=[0.001, -0.0015, 0.0006, 0.002])
    assert "var_95" in out and out["var_95"].field_id == "risk.var_95"
    assert out["var_95"].display_status == "estimated"  # parametric
    assert out["var_95"].uncertainty is not None
    assert "hhi" in out


def test_compute_risk_returns_all_five_keys():
    book = [{"weight": 0.5}, {"weight": 0.5}]
    # 200 obs so VaR/CVaR/Sharpe/Beta are all computable
    rng = np.random.default_rng(0)
    history = rng.normal(0.0005, 0.01, 200).tolist()
    spx = rng.normal(0.0005, 0.01, 200).tolist()
    out = compute_risk(book=book, history=history, spx_returns=spx)
    assert set(out.keys()) == {"var_95", "cvar_95", "sharpe", "beta", "hhi"}
    for key in ("var_95", "cvar_95", "sharpe", "beta"):
        d = out[key]
        assert d.display_status == "estimated"
        assert d.value is not None
        assert d.uncertainty is not None
        assert d.uncertainty.method == "analytical"
        assert d.source_records
    assert out["hhi"].display_status == "exact"
    assert out["hhi"].uncertainty is None


def test_compute_risk_hhi_exact_with_short_book():
    """HHI uses |weight| so a 50/50 long/short is HHI=5000 (balanced), exact."""
    book = [{"weight": 0.5}, {"weight": -0.5}]
    out = compute_risk(book=book, history=[0.001] * 200, spx_returns=[0.001] * 200)
    assert out["hhi"].value == 5000.0
    assert out["hhi"].display_status == "exact"


def test_compute_risk_emits_estimated_even_with_short_history():
    """Parametric formulas emit 'estimated' (not 'unavailable') even with <30 obs,
    as long as we have at least 2 data points. HHI is exact and doesn't need history."""
    book = [{"weight": 1.0}]
    out = compute_risk(book=book, history=[0.001, -0.002], spx_returns=[0.001, -0.002])
    for key in ("var_95", "cvar_95", "sharpe", "beta"):
        assert out[key].display_status == "estimated"
        assert out[key].value is not None
        assert out[key].uncertainty is not None
    # HHI doesn't need history
    assert out["hhi"].display_status == "exact"
    assert out["hhi"].value == 10000.0


def test_compute_risk_unavailable_when_history_too_short():
    """With <2 obs, we genuinely cannot compute parametric metrics."""
    book = [{"weight": 1.0}]
    out = compute_risk(book=book, history=[0.001], spx_returns=[0.001])
    for key in ("var_95", "cvar_95", "sharpe", "beta"):
        assert out[key].display_status == "unavailable"
        assert out[key].value is None
        assert out[key].unavailable_reason
    assert out["hhi"].display_status == "exact"
    assert out["hhi"].value == 10000.0


def test_compute_risk_hhi_empty_book_is_zero():
    """No positions => HHI = 0, exact."""
    out = compute_risk(book=[], history=[0.001] * 200, spx_returns=[0.001] * 200)
    assert out["hhi"].value == 0.0
    assert out["hhi"].display_status == "exact"


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

class TestVaRIsScaledToDollars:
    """VaR/CVaR are persisted to portfolio_risk.var_95 and rendered with a
    currency formatter, so compute_risk must emit dollars, not decimals.

    compute_risk accepted portfolio_value and never used it: the parametric
    helpers return `z * sigma` (a decimal ~0.03) and the result was wrapped
    unit="usd". A $100M book with ~2% daily vol persisted var_95 = 0.033 and
    the UI rendered "$0" where the real figure is ~$3.3M.

    These assertions are on magnitude and unit deliberately. The original
    tests only checked that a value was present with the right status, which
    is exactly why the defect shipped.
    """

    BOOK = [
        {"ticker": "AAA", "weight": 0.5, "sector": "tech", "geo": "us"},
        {"ticker": "BBB", "weight": -0.5, "sector": "energy", "geo": "eu"},
    ]
    HISTORY = [0.01, -0.02, 0.015, -0.005, 0.02, -0.01, 0.005, -0.015]
    SPX = [0.008, -0.018, 0.012, -0.004, 0.017, -0.009, 0.004, -0.012]
    CAPITAL = 100_000_000.0

    def _risk(self, **kw):
        from backend.services.risk_engine import compute_risk

        params = dict(
            book=self.BOOK, history=self.HISTORY, spx_returns=self.SPX,
            portfolio_value=self.CAPITAL,
        )
        params.update(kw)
        return compute_risk(**params)

    def test_var_is_a_dollar_amount_not_a_decimal(self):
        var = self._risk()["var_95"]
        assert var.unit == "usd"
        # A ~1.4% daily sigma on $100M is millions, never cents.
        assert var.value > 1_000_000, (
            f"var_95={var.value} looks like a decimal fraction, not dollars"
        )

    def test_var_scales_linearly_with_portfolio_value(self):
        small = self._risk(portfolio_value=1_000_000.0)["var_95"].value
        large = self._risk(portfolio_value=100_000_000.0)["var_95"].value
        assert large == pytest.approx(small * 100.0, rel=1e-6)

    def test_cvar_exceeds_var_and_is_in_dollars(self):
        r = self._risk()
        assert r["cvar_95"].unit == "usd"
        assert r["cvar_95"].value > r["var_95"].value

    def test_ratio_metrics_are_not_scaled_by_capital(self):
        """Sharpe/beta/hhi are unitless; capital must not touch them."""
        small = self._risk(portfolio_value=1_000_000.0)
        large = self._risk(portfolio_value=100_000_000.0)
        for key in ("sharpe", "beta", "hhi"):
            assert small[key].value == pytest.approx(large[key].value)
            assert small[key].unit == "ratio"
