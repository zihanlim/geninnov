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

def test_carry_is_excess_yield_over_funding_and_positive_when_paid():
    # 10y 4.67, funding 3.63 -> duration earns +104bp; credit adds 268bp of spread.
    macro = {"BAMLH0A0HYM2": {"value": 2.68}, "DGS10": {"value": 4.67}, "DFF": {"value": 3.63}}
    assert carry_signal("credit", macro) > 0
    assert carry_signal("rates", macro) > 0
    # Credit earns the same term premium PLUS the spread, so it must rank higher.
    assert carry_signal("credit", macro) > carry_signal("rates", macro)


def test_carry_is_two_sided_when_funding_exceeds_yield():
    """The whole point of the rewrite: carry must be able to say 'you PAY to hold
    this'. The old level-based form (tanh(real_yield / 2.0), tanh(OAS / 4.0)) was
    non-negative by construction, which pinned ~34% of EdgeScore to a standing long
    offset and made a short book unreachable."""
    inverted = {"DGS10": {"value": 3.20}, "DFF": {"value": 5.33}}
    assert carry_signal("rates", inverted) < 0
    # Even credit turns negative once the spread no longer covers the inversion.
    assert carry_signal("credit", {**inverted, "BAMLH0A0HYM2": {"value": 0.50}}) < 0


def test_carry_is_none_where_l0_cannot_support_it():
    """None, NOT 0.0. FX carry needs a foreign policy rate, equity an earnings
    yield, commodity a roll yield — L0 has none of them. Scoring these as 0.0
    silently diluted those themes toward abstention; compute_edge_score
    renormalises over what is actually present instead."""
    macro = {"BAMLH0A0HYM2": {"value": 2.68}, "DGS10": {"value": 4.67}, "DFF": {"value": 3.63}}
    assert carry_signal("fx", macro) is None
    assert carry_signal("equity", macro) is None
    assert carry_signal("commodity", macro) is None
    assert carry_signal("credit", {}) is None         # series missing -> not computable
    assert carry_signal("rates", None) is None


def test_carry_accepts_flat_macro_values():
    # tolerate {series: value} as well as {series: {value: ...}}
    assert carry_signal("rates", {"DGS10": 4.67, "DFF": 3.63}) > 0


# ─── Stage 4: Value ───────────────────────────────────────────────────────────

def test_value_credit_wide_is_long_tight_is_short():
    assert value_signal("credit", {"BAMLH0A0HYM2": 1.5}) > 0    # wide vs history = cheap = long
    assert value_signal("credit", {"BAMLH0A0HYM2": -1.5}) < 0   # tight = rich = short


def test_value_rates_high_real_yield_is_long():
    assert value_signal("rates", {"DFII10": 1.2}) > 0


def test_value_is_none_where_l0_carries_no_valuation():
    """Same contract as carry: not-computable is None, never a neutral-looking 0.0."""
    assert value_signal("equity", {"BAMLH0A0HYM2": 2.0}) is None
    assert value_signal("fx", {"DFF": 2.0}) is None
    assert value_signal("credit", {}) is None
    assert value_signal("rates", None) is None


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
    # An explicit 0.0 is a COMPUTED neutral: it takes part and keeps the divisor at 1.0.
    assert compute_edge_score(1.0, 0.0, 0.0, 0.0, 0.0,
                              w_trend=0.20, w_regime=0.23, w_carry=0.34,
                              w_value=0.18, w_sentiment=0.05) == pytest.approx(0.20)
    # An OMITTED component is not computable, so its weight leaves the denominator
    # rather than dragging the score toward the abstention band: 0.20 / 0.95.
    assert compute_edge_score(1.0, 0.0, 0.0, 0.0,
                              w_trend=0.20, w_regime=0.23, w_carry=0.34,
                              w_value=0.18, w_sentiment=0.05) == pytest.approx(0.20 / 0.95)


def test_compute_edge_score_renormalises_over_computable_components():
    """An equity theme has no carry and no value proxy in L0. Before renormalising
    it could not exceed |0.48| however strong its trend and regime were, while a
    credit theme reached 1.0 — and both were then judged against the same 0.15
    abstention band, as if commensurate."""
    W = dict(w_trend=0.20, w_regime=0.23, w_carry=0.34, w_value=0.18, w_sentiment=0.05)
    # Trend and regime maxed, carry/value unavailable: the score reflects the
    # evidence that exists rather than being diluted by the evidence that does not.
    equity_like = compute_edge_score(1.0, 1.0, None, None, 0.0, **W)
    assert equity_like == pytest.approx((0.20 + 0.23) / (0.20 + 0.23 + 0.05))
    assert equity_like > 0.48          # the old ceiling for a no-carry, no-value theme
    # A fully-scored theme with identical component values lands in the same place,
    # which is the comparability the renormalisation exists to restore.
    assert compute_edge_score(1.0, 1.0, 1.0, 1.0, 1.0, **W) == pytest.approx(1.0)
    # No evidence at all -> 0.0, which abstains. The right answer, not a crash.
    assert compute_edge_score(None, None, None, None, None, **W) == 0.0


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


# ─── Regime as a dial, not a cliff (ADR-0041) ─────────────────────────────────

def test_risk_appetite_is_continuous_across_the_breadth_threshold():
    """The book inverted on 2026-07-24 because the discrete label flipped.

    With VIX 18.6 (failing the <15 and <18 rules) and HY OAS 268bp (failing <250),
    the only rule that could return "risk-on" was `breadth > 60` — so $100M of
    positioning hung on one breadth statistic crossing a single integer. 61 and 59
    are not different market states.
    """
    from backend.services.regime_classifier import risk_appetite
    hi = risk_appetite(18.6, 268, -1.79, 61)
    lo = risk_appetite(18.6, 268, -1.79, 59)
    assert abs(hi - lo) < 0.05          # the old label moved 1.0 across this point
    assert hi > lo                      # ordering preserved


def test_risk_appetite_still_separates_genuine_regimes():
    """Smoothing must not flatten the signal — real stress and real calm stay apart."""
    from backend.services.regime_classifier import risk_appetite
    stress = risk_appetite(32.0, 620, 6.0, 25)
    calm = risk_appetite(12.0, 240, -5.0, 72)
    assert stress < -0.5
    assert calm > 0.5
    assert risk_appetite(None, None, None, None) is None


def test_regime_bias_prefers_continuous_appetite_over_the_label():
    """A mildly risk-on tape must not read the same as a flat one.

    Under the label, VIX 18.6 / HY 268 / breadth 60 classifies "neutral" -> sigma 0,
    so a late-cycle equity gets the full -0.5 defensive tilt and nothing else. The
    continuous appetite (+0.39) partly offsets it, which is the honest reading.
    """
    by_label = regime_direction_bias("equity", "late", "neutral")
    by_appetite = regime_direction_bias("equity", "late", "neutral", appetite=0.392)
    assert by_label == pytest.approx(-0.5)
    assert by_appetite > by_label
    assert by_appetite == pytest.approx(1.0 * 0.392 - 0.5)
    # Falling back to the label when no appetite is available stays byte-identical.
    assert regime_direction_bias("equity", "late", "neutral", None) == by_label
