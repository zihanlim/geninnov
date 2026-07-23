"""
EdgeScore — a rigorous long/short direction signal.

Design spec: docs/superpowers/specs/2026-07-23-edge-score-direction-redesign.md

Direction used to be sign(TradeScore), which — with HypeMomentum ~ 0 — collapsed
to the sign of near-zero VADER news sentiment. EdgeScore anchors direction to
measurable expected-return proxies instead. Stages 1 (Trend) and 2 (RegimeFit)
are implemented here; Carry / Value / Sentiment-demotion (Stages 3–5) are planned.

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


def compute_edge_score(
    trend: float, regime_bias: float, w_trend: float = 0.6, w_regime: float = 0.4
) -> float:
    """Composite EdgeScore for Stages 1+2. Both inputs are already in [-1, 1]."""
    return w_trend * trend + w_regime * regime_bias


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
