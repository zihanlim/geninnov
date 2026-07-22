from dataclasses import dataclass

@dataclass
class ScoringConfig:
    hype_volume_weight: float
    hype_sentiment_weight: float
    hype_corr_weight: float
    hype_momentum_weight: float
    trade_hype_weight: float
    trade_sentiment_weight: float
    hype_score_threshold: float = 50.0
    total_capital: float = 100_000_000.0
    risk_free_annual: float = 0.045

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
            hype_score_threshold=vals.get("hype_score_threshold", 50.0),
            total_capital=vals.get("total_capital", 100_000_000.0),
            risk_free_annual=vals.get("risk_free_annual", 0.045),
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
    volume: float,
    sentiment: float,
    corr: float,
    momentum: float,
    cfg: ScoringConfig,
) -> float:
    """
    Compute HypeScore for a single theme.

    `volume` and `momentum` are expected to be min-max normalized to [0, 1]
    across the theme universe (by the caller). `sentiment` is VADER compound
    in [-1, +1] and is rescaled here. `corr` is the raw price correlation
    in [-1, +1]; it is folded via abs() so that negative correlations
    contribute the same magnitude as positive ones.
    """
    sent = rescale_vader(sentiment)  # [-1, +1] -> [0, 1]
    corr_abs = abs(corr)              # [-1, +1] -> [0, 1]

    return 100 * (
        cfg.hype_volume_weight * volume +
        cfg.hype_sentiment_weight * sent +
        cfg.hype_corr_weight * corr_abs +
        cfg.hype_momentum_weight * momentum
    )


def compute_hype_scores(raw_signals: list[dict], cfg: ScoringConfig) -> list[dict]:
    """
    Cross-theme helper: min-max normalize each sub-score across all themes,
    then call hype_score for each theme. Returns scored rows with 'hype_score'.
    """
    all_counts = [r["mention_count_1d"] for r in raw_signals]
    all_momenta = [r["momentum_raw"] for r in raw_signals]

    scored = []
    for r in raw_signals:
        volume = minmax_norm(float(r["mention_count_1d"]), all_counts)
        momentum = minmax_norm(r["momentum_raw"], all_momenta)
        score = hype_score(
            volume=volume,
            sentiment=r["avg_sentiment"],
            corr=r["price_corr"],
            momentum=momentum,
            cfg=cfg,
        )
        scored.append({**r, "hype_score": score})
    return scored
