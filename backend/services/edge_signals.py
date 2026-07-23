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
    asset_class: str, cycle: str | None, sentiment: str | None
) -> float:
    """Stage 2 — does the current regime favour LONG this asset class? [-1, 1].

    ``bias = risk_beta · sentiment_sign + cycle_tilt`` (clipped). So a risk-off
    tape shorts equity/credit and goes long rates/USD; a late-cycle/recession
    adds a defensive lean (fade risk assets, favour havens).
    """
    beta = ASSET_CLASS_RISK_BETA.get(asset_class, 0.0)
    sigma = _SENTIMENT_SIGN.get(sentiment or "", 0.0)
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
    asset_classes: list[str], cycle: str | None, sentiment: str | None
) -> float:
    """Mean regime bias over the asset classes of a theme's assets. [-1, 1]."""
    if not asset_classes:
        return 0.0
    return fmean(regime_direction_bias(ac, cycle, sentiment) for ac in asset_classes)


# Reference levels for the Stage-3 carry mapping (percent). Documented magic
# numbers — Stage 5 replaces them with historical / cross-sectional normalization.
_CARRY_CREDIT_REF = 4.0   # HY OAS scale (~4% "normal" spread)
_CARRY_RATES_REF = 2.0    # 10y real-yield scale
_CARRY_FX_NEUTRAL = 1.0   # neutral USD funding rate


def _macro_value(macro: dict | None, series_id: str) -> float | None:
    """Pull a level out of the L0 macro snapshot ({series: {value, ...}} or {series: value})."""
    d = (macro or {}).get(series_id)
    if isinstance(d, dict):
        return d.get("value")
    return d


def carry_signal(asset_class: str, macro: dict | None) -> float:
    """Stage 3 — 'am I paid to hold this?' from L0 macro LEVELS, in [-1, 1].

    High yield / spread → positive carry → long bias.
      credit: HY OAS (spread income);  rates: 10y real yield;  fx: USD short rate.
      equity / commodity: 0 (no clean carry in the L0 snapshot).
    """
    if asset_class == "credit":
        oas = _macro_value(macro, "BAMLH0A0HYM2")
        return math.tanh(oas / _CARRY_CREDIT_REF) if oas is not None else 0.0
    if asset_class == "rates":
        rr = _macro_value(macro, "DFII10")
        return math.tanh(rr / _CARRY_RATES_REF) if rr is not None else 0.0
    if asset_class == "fx":
        dff = _macro_value(macro, "DFF")
        return math.tanh((dff - _CARRY_FX_NEUTRAL) / 3.0) if dff is not None else 0.0
    return 0.0


def value_signal(asset_class: str, macro_z: dict | None) -> float:
    """Stage 4 — cheap vs its OWN history = long, via z-scores of L0 levels, [-1, 1].

    ``macro_z`` maps series_id → z-score of the current level vs trailing history.
      credit: +z(HY OAS)   — wide vs history = cheap = long (mean-reversion)
      rates:  +z(real yield) — high real yield = bonds cheap = long
      equity / fx / commodity: 0 (valuation not in the L0 snapshot).

    Value can disagree with Trend (a cheap asset still falling) — that tension is
    intentional; Stage-4 abstention drops the position when signals conflict.
    """
    z = macro_z or {}
    if asset_class == "credit":
        return math.tanh(z.get("BAMLH0A0HYM2", 0.0))
    if asset_class == "rates":
        return math.tanh(z.get("DFII10", 0.0))
    return 0.0


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
    trend: float,
    regime_bias: float,
    carry: float = 0.0,
    value: float = 0.0,
    sentiment_tilt: float = 0.0,
    w_trend: float = 0.35,
    w_regime: float = 0.25,
    w_carry: float = 0.20,
    w_value: float = 0.20,
    w_sentiment: float = 0.0,
) -> float:
    """Composite EdgeScore (Stages 1–5). Every component is already in [-1, 1].
    ``sentiment_tilt`` is the CONTRARIAN sentiment component (from sentiment_signal)."""
    return (
        w_trend * trend
        + w_regime * regime_bias
        + w_carry * carry
        + w_value * value
        + w_sentiment * sentiment_tilt
    )


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
