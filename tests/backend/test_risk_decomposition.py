"""L4 Euler risk decomposition — see ADR-0079.

The load-bearing property is the Euler identity: for a positively-homogeneous risk
measure, the component contributions sum to the total **exactly**. That is what makes
"which position is causing the risk" a decomposition rather than a table of loosely
related numbers, and it is the first thing to break if the algebra is edited.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.risk_decomposition import (  # noqa: E402
    MIN_OBS_FOR_COVARIANCE,
    TRADING_DAYS,
    decompose_risk,
)


def _returns(n_obs: int = 260, seed: int = 7) -> pd.DataFrame:
    """Three correlated series. Values are arbitrary — the identity holds for any Σ."""
    rng = np.random.default_rng(seed)
    mkt = rng.normal(0, 0.010, n_obs)
    return pd.DataFrame(
        {
            "SPY": mkt + rng.normal(0, 0.002, n_obs),
            "QQQ": 1.2 * mkt + rng.normal(0, 0.004, n_obs),
            "TLT": -0.3 * mkt + rng.normal(0, 0.006, n_obs),
        },
        index=pd.bdate_range("2025-01-01", periods=n_obs),
    )


# ─────────────────────────────────────────────────────────────────────────────
# The Euler identity — the reason this module exists
# ─────────────────────────────────────────────────────────────────────────────

def test_contributions_sum_to_portfolio_vol_exactly():
    w = {"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}
    out = decompose_risk(w, _returns())

    total = sum(p["contribution_to_vol"] for p in out["positions"])
    assert total == pytest.approx(out["portfolio_vol"], abs=1e-9)


def test_component_var_sums_to_portfolio_var_exactly():
    w = {"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}
    out = decompose_risk(w, _returns())

    total = sum(p["component_var"] for p in out["positions"])
    assert total == pytest.approx(out["portfolio_var"], abs=1e-9)


def test_risk_contribution_pct_sums_to_one():
    w = {"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}
    out = decompose_risk(w, _returns())

    total = sum(p["risk_contribution_pct"] for p in out["positions"])
    assert total == pytest.approx(1.0, abs=1e-9)


def test_portfolio_vol_matches_quadratic_form_computed_independently():
    """Cross-check σ_p against √(wᵀΣw) built directly, not via the MCR path."""
    w = {"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}
    rets = _returns()
    out = decompose_risk(w, rets)

    order = [p["asset"] for p in out["positions"]]
    wv = np.array([w[a] for a in order])
    cov = rets[order].cov().to_numpy() * TRADING_DAYS
    expected = float(np.sqrt(wv @ cov @ wv))

    assert out["portfolio_vol"] == pytest.approx(expected, rel=1e-12)


# ─────────────────────────────────────────────────────────────────────────────
# Signed weights — a short is not a small long
# ─────────────────────────────────────────────────────────────────────────────

def test_a_genuine_hedge_contributes_negative_risk():
    """TLT is negatively correlated to the book; shorting it ADDS risk, holding it
    long REDUCES it. The sign must survive to the caller — clipping it at zero would
    erase the only thing the panel is for."""
    rets = _returns()
    long_hedge = decompose_risk({"SPY": 0.5, "QQQ": 0.3, "TLT": 0.2}, rets)
    tlt = next(p for p in long_hedge["positions"] if p["asset"] == "TLT")

    assert tlt["contribution_to_vol"] < 0
    assert tlt["risk_contribution_pct"] < 0


def test_flipping_a_position_sign_flips_its_contribution_sign():
    rets = _returns()
    base = {"SPY": 0.5, "QQQ": 0.3}
    long_tlt = decompose_risk({**base, "TLT": 0.2}, rets)
    short_tlt = decompose_risk({**base, "TLT": -0.2}, rets)

    a = next(p for p in long_tlt["positions"] if p["asset"] == "TLT")
    b = next(p for p in short_tlt["positions"] if p["asset"] == "TLT")
    assert a["contribution_to_vol"] * b["contribution_to_vol"] < 0


# ─────────────────────────────────────────────────────────────────────────────
# Weights are used as given — ADR-0037 leaves the cap residual in cash
# ─────────────────────────────────────────────────────────────────────────────

def test_weights_are_not_renormalised():
    """σ_p is homogeneous of degree 1: halving every weight halves it. If the
    implementation renormalised to Σ|w| = 1, both books would report the same vol."""
    rets = _returns()
    full = decompose_risk({"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}, rets)
    half = decompose_risk({"SPY": 0.20, "QQQ": 0.125, "TLT": -0.10}, rets)

    assert half["portfolio_vol"] == pytest.approx(full["portfolio_vol"] / 2, rel=1e-12)


def test_gross_below_one_is_preserved_not_scaled_up():
    rets = _returns()
    out = decompose_risk({"SPY": 0.10, "QQQ": 0.05}, rets)
    assert out["gross_exposure"] == pytest.approx(0.15, abs=1e-12)
    assert out["net_exposure"] == pytest.approx(0.15, abs=1e-12)


def test_net_exposure_is_signed_gross_is_absolute():
    out = decompose_risk({"SPY": 0.40, "TLT": -0.25}, _returns())
    assert out["net_exposure"] == pytest.approx(0.15, abs=1e-12)
    assert out["gross_exposure"] == pytest.approx(0.65, abs=1e-12)


# ─────────────────────────────────────────────────────────────────────────────
# Conventions
# ─────────────────────────────────────────────────────────────────────────────

def test_annualises_at_252_not_260():
    rets = _returns()
    w = {"SPY": 0.4, "QQQ": 0.3}
    out = decompose_risk(w, rets)

    order = [p["asset"] for p in out["positions"]]
    wv = np.array([w[a] for a in order])
    daily = float(np.sqrt(wv @ rets[order].cov().to_numpy() @ wv))
    assert out["portfolio_vol"] == pytest.approx(daily * np.sqrt(252), rel=1e-12)


def test_diversification_ratio_uses_absolute_weights():
    """Σwᵢσᵢ/σ_p is a long-only construct. With shorts the signed numerator can go
    negative and the 'ratio' becomes meaningless, so the weighted-average leg uses |w|."""
    rets = _returns()
    out = decompose_risk({"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}, rets)

    vols = {p["asset"]: p["standalone_vol"] for p in out["positions"]}
    w = {"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}
    weighted_avg = sum(abs(w[a]) * vols[a] for a in vols)
    assert out["diversification_ratio"] == pytest.approx(
        weighted_avg / out["portfolio_vol"], rel=1e-12
    )
    assert out["diversification_ratio"] > 1.0


def test_var_is_a_positive_loss_at_the_stated_confidence():
    out = decompose_risk({"SPY": 0.40, "QQQ": 0.25}, _returns(), confidence=0.95)
    assert out["portfolio_var"] > 0
    assert out["confidence"] == 0.95
    # z(0.95) ≈ 1.6449
    assert out["portfolio_var"] == pytest.approx(out["portfolio_vol"] * 1.6448536, rel=1e-5)


def test_higher_confidence_gives_larger_var():
    rets = _returns()
    w = {"SPY": 0.40, "QQQ": 0.25}
    assert decompose_risk(w, rets, confidence=0.99)["portfolio_var"] > \
           decompose_risk(w, rets, confidence=0.95)["portfolio_var"]


# ─────────────────────────────────────────────────────────────────────────────
# Degradation — ADR-0023: report the gap, never fabricate across it
# ─────────────────────────────────────────────────────────────────────────────

def test_returns_none_on_empty_frame():
    assert decompose_risk({"SPY": 0.5}, pd.DataFrame()) is None


def test_returns_none_when_no_weights():
    assert decompose_risk({}, _returns()) is None


def test_returns_none_with_fewer_than_two_priced_names():
    assert decompose_risk({"SPY": 0.5}, _returns()) is None


def test_returns_none_below_minimum_observations():
    short = _returns(n_obs=MIN_OBS_FOR_COVARIANCE - 1)
    assert decompose_risk({"SPY": 0.4, "QQQ": 0.3}, short) is None


def test_drops_weighted_names_with_no_price_history_and_reports_them():
    """A name the book holds but yfinance did not return must not silently vanish —
    its risk is real and unmeasured, and the panel has to be able to say so."""
    out = decompose_risk(
        {"SPY": 0.40, "QQQ": 0.25, "NOTREAL": 0.30}, _returns()
    )
    assert [p["asset"] for p in out["positions"]] == ["SPY", "QQQ"]
    assert out["dropped_assets"] == ["NOTREAL"]
    # The identity still holds over what WAS measured.
    total = sum(p["contribution_to_vol"] for p in out["positions"])
    assert total == pytest.approx(out["portfolio_vol"], abs=1e-9)


def test_zero_weight_names_are_excluded():
    out = decompose_risk({"SPY": 0.4, "QQQ": 0.3, "TLT": 0.0}, _returns())
    assert [p["asset"] for p in out["positions"]] == ["SPY", "QQQ"]
    assert out["dropped_assets"] == []


def test_all_zero_weights_returns_none():
    assert decompose_risk({"SPY": 0.0, "QQQ": 0.0}, _returns()) is None


def test_positions_sorted_by_absolute_risk_contribution():
    out = decompose_risk({"SPY": 0.40, "QQQ": 0.25, "TLT": -0.20}, _returns())
    mags = [abs(p["contribution_to_vol"]) for p in out["positions"]]
    assert mags == sorted(mags, reverse=True)
