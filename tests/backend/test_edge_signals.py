import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

import pytest

from backend.services.edge_signals import (
    theme_trend,
    regime_direction_bias,
    theme_regime_bias,
    carry_signal,
    value_signal,
    sentiment_signal,
    compute_edge_score,
    edge_direction,
    ASSET_CLASS_RISK_BETA,
)


# ─── Stage 1: Trend ───────────────────────────────────────────────────────────

def test_trend_positive_returns_positive_signal():
    assert theme_trend({"A": 0.10, "B": 0.20}) > 0


def test_trend_negative_returns_negative_signal():
    assert theme_trend({"A": -0.10, "B": -0.20}) < 0


def test_trend_bounded_and_saturates():
    # tanh keeps the signal in [-1, 1] and saturates for extreme moves.
    hot = theme_trend({"A": 5.0})
    assert 0.99 < hot <= 1.0
    assert -1.0 <= theme_trend({"A": -5.0}) < -0.99


def test_trend_ignores_none_and_empty_is_neutral():
    assert theme_trend({"A": 0.10, "B": None}) == theme_trend({"A": 0.10})
    assert theme_trend({}) == 0.0
    assert theme_trend({"A": None}) == 0.0


# ─── Stage 2: RegimeFit ───────────────────────────────────────────────────────

def test_regime_risk_off_shorts_equity_longs_rates():
    # risk-off: equity (risk beta +1) -> short bias; rates (-1) -> long bias.
    assert regime_direction_bias("equity", "mid", "risk-off") < 0
    assert regime_direction_bias("rates", "mid", "risk-off") > 0


def test_regime_risk_on_longs_equity_shorts_rates():
    assert regime_direction_bias("equity", "mid", "risk-on") > 0
    assert regime_direction_bias("rates", "mid", "risk-on") < 0


def test_regime_neutral_sentiment_only_cycle_tilt():
    # neutral sentiment -> base 0; mid-cycle applies a mild cyclical tilt only.
    eq = regime_direction_bias("equity", "mid", "neutral")
    assert eq == pytest.approx(0.25)   # 0 + 0.25*beta(+1)


def test_regime_late_cycle_is_defensive():
    # late cycle fades risk assets (equity) and favours havens (rates) vs mid.
    assert regime_direction_bias("equity", "late", "neutral") < 0
    assert regime_direction_bias("rates", "late", "neutral") > 0


def test_regime_bias_is_clipped():
    assert -1.0 <= regime_direction_bias("equity", "late", "risk-off") <= 1.0
    assert -1.0 <= regime_direction_bias("rates", "recession", "risk-off") <= 1.0


def test_regime_commodity_is_neutral_risk_beta():
    assert ASSET_CLASS_RISK_BETA["commodity"] == 0.0
    # commodity: no sentiment lean, and cycle tilt scales beta(0) -> 0.
    assert regime_direction_bias("commodity", "late", "risk-off") == 0.0


def test_theme_regime_bias_averages_and_empty_is_zero():
    mixed = theme_regime_bias(["equity", "rates"], "mid", "risk-off")
    eq = regime_direction_bias("equity", "mid", "risk-off")
    ra = regime_direction_bias("rates", "mid", "risk-off")
    assert mixed == pytest.approx((eq + ra) / 2)
    assert theme_regime_bias([], "mid", "risk-off") == 0.0


def test_regime_missing_inputs_neutral():
    assert regime_direction_bias("equity", None, None) == 0.0


# ─── Stage 3: Carry ───────────────────────────────────────────────────────────

def test_carry_credit_rates_fx_positive_on_high_levels():
    macro = {"BAMLH0A0HYM2": {"value": 2.69}, "DFII10": {"value": 2.37}, "DFF": {"value": 4.3}}
    assert carry_signal("credit", macro) > 0     # spread income
    assert carry_signal("rates", macro) > 0       # positive real yield
    assert carry_signal("fx", macro) > 0          # positive USD carry vs neutral


def test_carry_equity_commodity_and_missing_are_zero():
    macro = {"BAMLH0A0HYM2": {"value": 2.69}}
    assert carry_signal("equity", macro) == 0.0
    assert carry_signal("commodity", macro) == 0.0
    assert carry_signal("credit", {}) == 0.0          # series missing -> 0
    assert carry_signal("rates", None) == 0.0


def test_carry_accepts_flat_macro_values():
    # tolerate {series: value} as well as {series: {value: ...}}
    assert carry_signal("rates", {"DFII10": 2.0}) > 0


# ─── Stage 4: Value ───────────────────────────────────────────────────────────

def test_value_credit_wide_is_long_tight_is_short():
    assert value_signal("credit", {"BAMLH0A0HYM2": 1.5}) > 0    # wide vs history = cheap = long
    assert value_signal("credit", {"BAMLH0A0HYM2": -1.5}) < 0   # tight = rich = short


def test_value_rates_high_real_yield_is_long():
    assert value_signal("rates", {"DFII10": 1.2}) > 0


def test_value_equity_fx_commodity_and_empty_are_zero():
    assert value_signal("equity", {"BAMLH0A0HYM2": 2.0}) == 0.0
    assert value_signal("fx", {"DFF": 2.0}) == 0.0
    assert value_signal("credit", {}) == 0.0
    assert value_signal("rates", None) == 0.0


# ─── Composite + direction ────────────────────────────────────────────────────

def test_compute_edge_score_backcompat_two_component():
    # carry/value default to 0, so the old 2-arg call still works.
    assert compute_edge_score(1.0, 0.0, w_trend=0.6, w_regime=0.4) == pytest.approx(0.6)
    assert compute_edge_score(0.0, 1.0, w_trend=0.6, w_regime=0.4) == pytest.approx(0.4)
    assert compute_edge_score(0.5, -0.5, w_trend=0.6, w_regime=0.4) == pytest.approx(0.1)


def test_sentiment_is_contrarian_and_minor():
    """Stage 5: sentiment is a CONTRARIAN tilt — positive tone (crowded) -> short
    bias, negative tone -> long bias — bounded, and ~0 near neutral."""
    assert sentiment_signal(0.5) < 0      # optimism -> fade (short)
    assert sentiment_signal(-0.5) > 0     # pessimism -> long
    assert sentiment_signal(0.0) == 0.0
    assert sentiment_signal(None) == 0.0
    assert -1.0 <= sentiment_signal(5.0) <= 0.0    # bounded, saturates
    assert abs(sentiment_signal(0.02)) < 0.1       # near-neutral contributes little


def test_compute_edge_score_five_component():
    assert compute_edge_score(0.0, 0.0, 0.0, 0.0, 1.0,
                              w_trend=0.20, w_regime=0.23, w_carry=0.34,
                              w_value=0.18, w_sentiment=0.05) == pytest.approx(0.05)
    # all five present, weights sum to 1 -> EdgeScore = weighted mean
    assert compute_edge_score(1.0, 1.0, 1.0, 1.0, 1.0,
                              w_trend=0.20, w_regime=0.23, w_carry=0.34,
                              w_value=0.18, w_sentiment=0.05) == pytest.approx(1.0)
    # sentiment defaults to 0 contribution -> back-compat with 4-component callers
    assert compute_edge_score(1.0, 0.0, 0.0, 0.0,
                              w_trend=0.20, w_regime=0.23, w_carry=0.34,
                              w_value=0.18) == pytest.approx(0.20)


def test_compute_edge_score_four_component():
    assert compute_edge_score(1.0, 0.0, 0.0, 0.0,
                              w_trend=0.35, w_regime=0.25, w_carry=0.20, w_value=0.20) == pytest.approx(0.35)
    assert compute_edge_score(0.0, 0.0, 1.0, 0.0,
                              w_trend=0.35, w_regime=0.25, w_carry=0.20, w_value=0.20) == pytest.approx(0.20)
    assert compute_edge_score(0.0, 0.0, 0.0, 1.0,
                              w_trend=0.35, w_regime=0.25, w_carry=0.20, w_value=0.20) == pytest.approx(0.20)
    assert compute_edge_score(1.0, 1.0, 1.0, 1.0,
                              w_trend=0.35, w_regime=0.25, w_carry=0.20, w_value=0.20) == pytest.approx(1.0)


def test_edge_direction_sign_and_abstain():
    assert edge_direction(0.3) == "long"
    assert edge_direction(-0.3) == "short"
    assert edge_direction(0.0) is None
    # abstention band: |edge| < threshold -> no position
    assert edge_direction(0.05, threshold=0.1) is None
    assert edge_direction(0.2, threshold=0.1) == "long"


def test_trend_can_overturn_regime_in_composite():
    # A strong downtrend outweighs a mild long regime bias -> net short.
    edge = compute_edge_score(theme_trend({"A": -0.30}), 0.2, w_trend=0.6, w_regime=0.4)
    assert edge < 0
