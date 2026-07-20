from dataclasses import dataclass

@dataclass
class ScoringConfig:
    hype_volume_weight: float
    hype_sentiment_weight: float
    hype_corr_weight: float
    hype_momentum_weight: float
    trade_hype_weight: float
    trade_sentiment_weight: float

    @classmethod
    def from_db_rows(cls, rows: list[dict]) -> "ScoringConfig":
        vals = {r["param_name"]: float(r["value"]) for r in rows}
        return cls(
            hype_volume_weight=vals["hype_volume_weight"],
            hype_sentiment_weight=vals["hype_sentiment_weight"],
            hype_corr_weight=vals["hype_corr_weight"],
            hype_momentum_weight=vals["hype_momentum_weight"],
            trade_hype_weight=vals["trade_hype_weight"],
            trade_sentiment_weight=vals["trade_sentiment_weight"],
        )

def minmax_norm(value: float, values: list[float]) -> float:
    """Min-max normalize a value across a list. Returns 0.5 if all values identical."""
    mn, mx = min(values), max(values)
    if mx == mn:
        return 0.5
    return (value - mn) / (mx - mn)

def rescale_vader(compound: float) -> float:
    """Rescale VADER compound [-1, +1] to [0, 1]."""
    return (compound + 1) / 2

def hype_score(
    mention_count_1d: int,
    avg_sentiment: float,
    price_corr: float,
    momentum_raw: float,
    all_mention_counts: list[int],
    all_sentiments: list[float],
    all_corrs: list[float],
    all_momentum: list[float],
    cfg: ScoringConfig,
) -> float:
    """
    Compute HypeScore for a single theme.

    All 4 sub-scores are independently min-max normalized across all themes,
    then weighted and summed to produce a score in [0, 100].
    """
    volume = minmax_norm(float(mention_count_1d), all_mention_counts)
    sent = rescale_vader(avg_sentiment)  # already [-1, +1]
    corr = minmax_norm(abs(price_corr), [abs(c) for c in all_corrs])
    momentum = minmax_norm(momentum_raw, all_momentum)

    return 100 * (
        cfg.hype_volume_weight * volume +
        cfg.hype_sentiment_weight * sent +
        cfg.hype_corr_weight * corr +
        cfg.hype_momentum_weight * momentum
    )
