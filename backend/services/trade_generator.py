from typing import Optional

from backend.services.hype_calculator import ScoringConfig


_DEFAULT_TRADE_CFG = ScoringConfig(
    hype_volume_weight=0.25,
    hype_sentiment_weight=0.25,
    hype_corr_weight=0.25,
    hype_momentum_weight=0.25,
    trade_hype_weight=0.55,
    trade_sentiment_weight=0.45,
)


def trade_score(
    hype_today: float,
    hype_yesterday: float,
    sentiment: float,  # VADER compound [-1, +1]
    cfg: Optional[ScoringConfig] = None,
    elapsed_days: int = 1,
) -> float:
    """
    Compute TradeScore for a theme.

    HypeMomentum = (hype_today - hype_yesterday) / hype_yesterday / max(1, elapsed_days)
    SentimentDirection = sentiment  # already [-1, +1]

    `elapsed_days` normalizes the raw hype diff by the number of days that
    passed between the two snapshots, so a 50-point drift over 5 days
    contributes less momentum than a 50-point drift over 1 day.
    """
    if cfg is None:
        cfg = _DEFAULT_TRADE_CFG

    if hype_yesterday == 0:
        hype_momentum = 0.0
    else:
        hype_momentum = (hype_today - hype_yesterday) / hype_yesterday

    # Normalize by elapsed days
    hype_momentum = hype_momentum / max(1, elapsed_days)

    # Clamp to [-1, 1] for numerical stability
    hype_momentum = max(-1.0, min(1.0, hype_momentum))

    return (
        cfg.trade_hype_weight * hype_momentum +
        cfg.trade_sentiment_weight * sentiment
    )
