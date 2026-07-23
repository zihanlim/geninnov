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
    # EdgeScore direction weights (migration 023). Direction = sign(EdgeScore),
    # EdgeScore = edge_trend_weight·Trend + edge_regime_weight·RegimeFit.
    edge_trend_weight: float = 0.6
    edge_regime_weight: float = 0.4
    edge_abstain_threshold: float = 0.0

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
            edge_trend_weight=vals.get("edge_trend_weight", 0.6),
            edge_regime_weight=vals.get("edge_regime_weight", 0.4),
            edge_abstain_threshold=vals.get("edge_abstain_threshold", 0.0),
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

    `volume`, `momentum` and `corr` are the three magnitude signals and are
    expected to be min-max normalized to [0, 1] across the theme universe by the
    caller (ADR-0006 / ADR-0028); `corr` is folded via abs() before normalizing
    so direction doesn't matter. `sentiment` is VADER compound in [-1, +1] and is
    rescaled here (NOT cross-theme normalized) because its SIGN carries meaning —
    ranking would corrupt bullish/bearish direction. The abs() below is a
    harmless defensive fold (a no-op on an already-normalized [0, 1] value).
    """
    sent = rescale_vader(sentiment)  # [-1, +1] -> [0, 1]
    corr_abs = abs(corr)              # [-1, +1] -> [0, 1]

    return 100 * (
        cfg.hype_volume_weight * volume +
        cfg.hype_sentiment_weight * sent +
        cfg.hype_corr_weight * corr_abs +
        cfg.hype_momentum_weight * momentum
    )


def robust_momentum(current: float, history: list[float]) -> tuple[float, bool]:
    """
    Robust momentum: how unusual is ``current`` versus its recent ``history``.

    Uses median + MAD (median absolute deviation, scaled by 1.4826 so it matches
    a normal's std) instead of mean + std. A raw z-score is fragile on a 7-point
    window: one viral day inflates the mean and one quiet day shrinks the std,
    so the naive momentum swings on noise. The median/MAD version ignores a
    single outlier. Result is clipped to [-4, 4].

    Returns (momentum, degenerate). ``degenerate`` is True when the window has no
    spread (MAD == 0) or is empty — momentum is 0 and the caller should log it,
    rather than silently emitting a 0 that looks like "no change".
    """
    import numpy as np
    arr = np.asarray([h for h in history if h is not None], dtype=float)
    if arr.size == 0:
        return 0.0, True
    med = float(np.median(arr))
    mad = float(np.median(np.abs(arr - med)))
    scaled = 1.4826 * mad
    if scaled <= 0.0:
        return 0.0, True
    z = (float(current) - med) / scaled
    return float(max(-4.0, min(4.0, z))), False


def crowding_score(price_corr: float) -> float:
    """
    Signed market-correlation strength in [-1, 1] — crowding preserves the sign
    that HypeScore throws away.

    HypeScore intentionally folds correlation via abs() (ADR-0006): *attention*
    is direction-agnostic, so a theme that co-moves strongly either way is
    equally "hot". But for TRADE and RISK use the sign is the whole point — a
    high-attention theme co-moving positively with the market is a *crowded*
    consensus (mean-reversion risk), while an inverse mover is a natural hedge.
    This keeps the sign for those downstream consumers instead of discarding it.
    """
    try:
        c = float(price_corr)
    except (TypeError, ValueError):
        return 0.0
    return max(-1.0, min(1.0, c))


def crowding_label(
    price_corr: float,
    volume_norm: float | None = None,
    corr_threshold: float = 0.5,
    min_volume: float = 0.5,
) -> str:
    """
    Categorise a theme's crowding for the trade/risk layer:

      "crowded" — strong positive market correlation (consensus co-move),
      "hedge"   — strong negative correlation (contrarian / natural hedge),
      "neutral" — weak correlation, or low attention.

    Crowding only matters when a theme actually has attention, so a strong
    correlation on a low-volume theme (``volume_norm < min_volume``) is reported
    as "neutral" rather than "crowded".
    """
    c = crowding_score(price_corr)
    if volume_norm is not None and volume_norm < min_volume:
        return "neutral"
    if c >= corr_threshold:
        return "crowded"
    if c <= -corr_threshold:
        return "hedge"
    return "neutral"


def compute_hype_scores(raw_signals: list[dict], cfg: ScoringConfig) -> list[dict]:
    """
    Cross-theme helper: min-max normalize each sub-score across all themes,
    then call hype_score for each theme. Returns scored rows with 'hype_score'.

    Empty input returns an empty list — min()/max() on empty sequences raises
    ValueError, which would otherwise crash daily_refresh on bootstrap.
    """
    if not raw_signals:
        return []
    all_counts = [r["mention_count_1d"] for r in raw_signals]
    all_momenta = [r["momentum_raw"] for r in raw_signals]
    all_abscorr = [abs(r["price_corr"]) for r in raw_signals]

    scored = []
    for r in raw_signals:
        volume = minmax_norm(float(r["mention_count_1d"]), all_counts)
        momentum = minmax_norm(r["momentum_raw"], all_momenta)
        # ADR-0028: min-max |corr| across themes, consistent with volume/momentum.
        # T22 fed a RAW abs(corr) (~0.1–0.4 on a noisy short window), so the 30%
        # corr weight structurally under-delivered — it added a near-constant to
        # every theme and compressed the distribution below the 50 threshold.
        # Min-max lets the top-corr theme claim the full corr weight. Keeps the
        # abs() fold (attention is direction-agnostic).
        corr = minmax_norm(abs(r["price_corr"]), all_abscorr)
        score = hype_score(
            volume=volume,
            sentiment=r["avg_sentiment"],
            corr=corr,
            momentum=momentum,
            cfg=cfg,
        )
        scored.append({**r, "hype_score": score})
    return scored
