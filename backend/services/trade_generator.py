from backend.services.hype_calculator import ScoringConfig


def trade_score(
    hype_today: float,
    hype_yesterday: float,
    sentiment: float,  # VADER compound [-1, +1]
    cfg: ScoringConfig,
) -> float:
    """
    Compute TradeScore for a theme.

    HypeMomentum = (hype_today - hype_yesterday) / hype_yesterday
    SentimentDirection = sentiment  # already [-1, +1]
    """
    if hype_yesterday == 0:
        hype_momentum = 0.0
    else:
        hype_momentum = (hype_today - hype_yesterday) / hype_yesterday

    # Clamp to [-1, 1] for numerical stability
    hype_momentum = max(-1.0, min(1.0, hype_momentum))

    return (
        cfg.trade_hype_weight * hype_momentum +
        cfg.trade_sentiment_weight * sentiment
    )
