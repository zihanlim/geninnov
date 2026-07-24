"""
EdgeScore — a rigorous long/short direction signal.

Design spec: docs/superpowers/specs/2026-07-23-edge-score-direction-redesign.md

Direction used to be sign(TradeScore), which — with HypeMomentum ~ 0 — collapsed
to the sign of near-zero VADER news sentiment. EdgeScore anchors direction to
measurable expected-return proxies instead. All five components are implemented
here: 1 Trend, 2 RegimeFit, 3 Carry, 4 Value, 5 Sentiment (a minor CONTRARIAN
tilt — the demotion). Stage 4 also adds abstention (in rank_trade_candidates) and
conviction × inverse-vol sizing (in allocate_portfolio); the component weights are
IC-informed (scripts/backtest_edge.py, ADR-0033).

Every component returns a value in [-1, +1] so the scoring_config weights are
directly comparable.
"""
from __future__ import annotations

import math
from statistics import fmean

# Asset-class risk-on beta: does the class rise in a risk-on tape?
#   equity / credit rally in risk-on (+1); government rates and the USD are
#   risk-off hedges (-1); commodity is ambiguous (gold haven vs energy cyclical),
#   so it stays 0 until Stage 3/4 (carry/value) can disambiguate.
ASSET_CLASS_RISK_BETA: dict[str, float] = {
    "equity": 1.0,
    "credit": 1.0,
    "rates": -1.0,
    "fx": -1.0,
    "commodity": 0.0,
}

_SENTIMENT_SIGN = {"risk-on": 1.0, "neutral": 0.0, "risk-off": -1.0}
_DEFENSIVE_CYCLES = {"late", "recession"}
_CYCLICAL_CYCLES = {"early", "mid"}


def theme_trend(returns_by_asset: dict[str, float | None], scale: float = 0.15) -> float:
    """Stage 1 — time-series momentum of a theme basket, squashed to [-1, 1].

    ``returns_by_asset`` maps each of the theme's assets to its trailing return
    over the trend window. The mean across assets is passed through
    ``tanh(x / scale)`` so a +15% 6-month basket move maps to ~+0.76 and the
    signal saturates for extreme moves rather than dominating the composite.
    Returns 0.0 when no asset has a computable return (an honest neutral, not a
    fabricated tilt).
    """
    rets = [r for r in returns_by_asset.values() if r is not None]
    if not rets:
        return 0.0
    return math.tanh(fmean(rets) / scale)


def regime_direction_bias(
    asset_class: str, cycle: str | None, sentiment: str | None,
    appetite: float | None = None,
) -> float:
    """Stage 2 — does the current regime favour LONG this asset class? [-1, 1].

    ``bias = risk_beta · risk_appetite + cycle_tilt`` (clipped). So a risk-off
    tape shorts equity/credit and goes long rates/USD; a late-cycle/recession
    adds a defensive lean (fade risk assets, favour havens).

    ``appetite`` is the CONTINUOUS risk appetite in [-1, 1]
    (``regime_classifier.risk_appetite``). Prefer it. Falling back to the discrete
    label makes this a step function, and since it is multiplied by the asset class's
    risk beta, a label change swings an equity's regime component from +0.5·beta to
    -0.5·beta — a full 1.0·beta move on a term carrying 0.23 of EdgeScore, which is
    enough to invert the book. It did exactly that on 2026-07-24, when the label went
    risk-on -> neutral on a single breadth statistic crossing 60 and two runs hours
    apart produced opposite books. The label remains the right SUMMARY for display;
    it is a bad dial.
    """
    beta = ASSET_CLASS_RISK_BETA.get(asset_class, 0.0)
    sigma = (
        max(-1.0, min(1.0, appetite))
        if appetite is not None
        else _SENTIMENT_SIGN.get(sentiment or "", 0.0)
    )
    base = beta * sigma

    tilt = 0.0
    if cycle in _DEFENSIVE_CYCLES:
        # beta>0 risk asset -> -0.5 (fade); beta<0 haven -> +0.5 (favour).
        tilt = -0.5 * beta
    elif cycle in _CYCLICAL_CYCLES:
        # A milder cyclical lean, smaller than the defensive one.
        tilt = 0.25 * beta

    return max(-1.0, min(1.0, base + tilt))


def theme_regime_bias(
    asset_classes: list[str], cycle: str | None, sentiment: str | None,
    appetite: float | None = None,
) -> float:
    """Mean regime bias over the asset classes of a theme's assets. [-1, 1]."""
    if not asset_classes:
        return 0.0
    return fmean(
        regime_direction_bias(ac, cycle, sentiment, appetite) for ac in asset_classes
    )


# Squash scale for the carry mapping, in percent of excess yield over funding.
# 3.0 means "+300bp of carry over funding maps to tanh(1) = +0.76" — i.e. a very
# well-paid position, without saturating so early that a 100bp and a 400bp carry
# look alike. It is a scale, NOT a centre: carry is centred on zero excess yield,
# which is the economically meaningful neutral point (you are paid exactly your
# funding cost, so holding the position earns nothing).
_CARRY_SCALE_PCT = 3.0


def _macro_value(macro: dict | None, series_id: str) -> float | None:
    """Pull a level out of the L0 macro snapshot ({series: {value, ...}} or {series: value})."""
    d = (macro or {}).get(series_id)
    if isinstance(d, dict):
        return d.get("value")
    return d


def carry_signal(asset_class: str, macro: dict | None) -> float | None:
    """Stage 3 — 'am I paid to hold this?', in [-1, 1]. ``None`` = not computable.

    Carry is EXCESS YIELD OVER FUNDING — what the position earns per unit time if
    nothing moves, net of what the cash costs. That is the textbook definition and,
    critically, it is TWO-SIDED: you can be paid to hold something, or you can pay
    for the privilege.

    The previous version scored the raw LEVEL against a fixed scale:
    ``tanh(HY_OAS / 4.0)``. A credit spread is a positive number by construction, so
    that term could never be negative — nor could the rates or FX terms at any
    plausible level. With the largest weight of the five (0.34), carry was not a
    signal at all but a standing long offset of roughly +0.20 to +0.28 on every
    credit/rates/FX theme, which is a large part of why the book could not produce
    a single short. It also gave the wrong answer on its own terms: with HY OAS at
    268bp, near the tights of its available history, it read +0.585 "well paid" when
    the honest reading is that credit risk is thinly compensated.

    Per asset class, all from the L0 snapshot:
      credit — HY yield (10y UST + OAS) less overnight funding.
      rates  — 10y nominal yield less overnight funding, i.e. the term premium a
               duration position earns. Negative whenever the curve is inverted,
               which is exactly when duration carry IS negative.
      fx / equity / commodity — ``None``. USD carry needs a foreign policy rate,
               equity carry an earnings yield, commodity carry a roll yield, and
               L0 carries none of the three. Returning None rather than 0.0 is the
               point: a missing component is NOT a neutral one, and
               ``compute_edge_score`` renormalises over what is actually present so
               these themes are not silently diluted toward abstention.
    """
    funding = _macro_value(macro, "DFF")
    ust10 = _macro_value(macro, "DGS10")

    if asset_class == "credit":
        oas = _macro_value(macro, "BAMLH0A0HYM2")
        if oas is None or ust10 is None or funding is None:
            return None
        return math.tanh((ust10 + oas - funding) / _CARRY_SCALE_PCT)

    if asset_class == "rates":
        if ust10 is None or funding is None:
            return None
        return math.tanh((ust10 - funding) / _CARRY_SCALE_PCT)

    return None


def value_signal(asset_class: str, macro_z: dict | None) -> float | None:
    """Stage 4 — cheap vs its OWN history = long, via z-scores of L0 levels, [-1, 1].

    ``macro_z`` maps series_id → z-score of the current level vs trailing history.
      credit: +z(HY OAS)   — wide vs history = cheap = long (mean-reversion)
      rates:  +z(real yield) — high real yield = bonds cheap = long
      equity / fx / commodity: ``None`` — valuation is not in the L0 snapshot.

    Value can disagree with Trend (a cheap asset still falling) — that tension is
    intentional; Stage-4 abstention drops the position when signals conflict.

    Distinct from carry, and deliberately so: carry is a LEVEL (excess yield over
    funding, "what does this pay me"), value is a Z-SCORE against trailing history
    ("is this cheap relative to where it has been"). Credit can pay well in absolute
    terms while being historically expensive — today it does both, and the two
    components correctly disagree.

    Returns None where the series is absent, for the same reason as ``carry_signal``:
    a component we cannot compute must not be scored as if it were neutral.
    """
    z = macro_z or {}
    if asset_class == "credit":
        return math.tanh(z["BAMLH0A0HYM2"]) if "BAMLH0A0HYM2" in z else None
    if asset_class == "rates":
        return math.tanh(z["DFII10"]) if "DFII10" in z else None
    return None


def sentiment_signal(avg_sentiment: float | None, scale: float = 0.4) -> float:
    """Stage 5 — news sentiment as a MINOR CONTRARIAN tilt, in [-1, 1].

    Sentiment was once THE direction signal (wrongly — a near-zero VADER score
    decided a $100M side). Here it is demoted to one small tilt among five, and
    made CONTRARIAN: extreme optimism is crowding to fade (short bias), not a buy.
    Near-zero sentiment contributes ~0. Carries a small weight (edge_sentiment_weight).
    """
    if avg_sentiment is None:
        return 0.0
    return -math.tanh(avg_sentiment / scale)


def compute_edge_score(
    trend: float | None,
    regime_bias: float | None,
    carry: float | None = None,
    value: float | None = None,
    sentiment_tilt: float | None = None,
    w_trend: float = 0.35,
    w_regime: float = 0.25,
    w_carry: float = 0.20,
    w_value: float = 0.20,
    w_sentiment: float = 0.0,
) -> float:
    """Composite EdgeScore (Stages 1–5). Every component is already in [-1, 1].
    ``sentiment_tilt`` is the CONTRARIAN sentiment component (from sentiment_signal).

    A component passed as ``None`` is NOT COMPUTABLE for this theme, and the weights
    are renormalised over the components that are. Scoring a missing component as
    0.0 is not neutral — it silently shrinks |EdgeScore| toward the abstention band,
    so a theme whose asset classes happen to lack a carry or value proxy was being
    penalised for a gap in our data rather than judged on the market's signal. An
    equity theme had 0.34 of its weight (carry) and 0.18 (value) pinned at zero,
    capping |EdgeScore| at 0.48 while a credit theme could reach 1.0 — the two were
    then compared against the same 0.15 abstention band as if commensurate.

    Renormalising states the honest thing: score each theme on the evidence that
    exists for it, on a common scale. If NOTHING is computable the result is 0.0,
    which abstains — the correct answer when there is no evidence at all.
    """
    terms = (
        (trend, w_trend),
        (regime_bias, w_regime),
        (carry, w_carry),
        (value, w_value),
        (sentiment_tilt, w_sentiment),
    )
    present = [(v, w) for v, w in terms if v is not None]
    total_w = sum(w for _, w in present)
    if total_w <= 0:
        return 0.0
    return sum(w * v for v, w in present) / total_w


def edge_direction(edge_score: float, threshold: float = 0.0) -> str | None:
    """long / short / None (abstain).

    ``threshold`` is the abstention band |EdgeScore| < threshold → no position.
    Default 0.0 means no abstention (Stages 1–2); Stage 4 raises it and adds the
    signal-agreement requirement.
    """
    if edge_score > threshold:
        return "long"
    if edge_score < -threshold:
        return "short"
    return None
