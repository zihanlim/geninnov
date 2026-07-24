import math
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
    # EdgeScore direction weights (migrations 023–024). Direction = sign(EdgeScore),
    # EdgeScore = w_trend·Trend + w_regime·RegimeFit + w_carry·Carry + w_value·Value.
    # |EdgeScore| < edge_abstain_threshold → abstain (Stage 4).
    # Priors informed by a WEAK POSITIVE IC, not a fitted result (ADR-0044).
    # ADR-0033 set carry highest on "a strong significant IC, p=0.007" — measured
    # on the OLD carry definition. ADR-0036 replaced that signal with excess yield
    # over funding and never re-ran the test. Re-measured on the live definition:
    # carry IC +0.128 (N=94, p=0.221), trend +0.033 (N=975, p=0.300), value +0.094
    # (p=0.368) — all positive, NONE significant. Weights deliberately unchanged:
    # re-fitting on p=0.22 would be fitting noise.
    edge_trend_weight: float = 0.20
    edge_regime_weight: float = 0.23
    edge_carry_weight: float = 0.34
    edge_value_weight: float = 0.18
    edge_sentiment_weight: float = 0.05   # small CONTRARIAN tilt (Stage 5)
    edge_abstain_threshold: float = 0.15
    # Conviction override (ADR-0046). |asset edge| at which a theme BELOW the
    # attention gate is pulled into scope anyway. Strictly above the abstention
    # band by design: a name has to be decisive to earn a look its theme's
    # attention did not. 0 disables the override.
    edge_conviction_override: float = 0.25

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
            edge_trend_weight=vals.get("edge_trend_weight", 0.20),
            edge_regime_weight=vals.get("edge_regime_weight", 0.23),
            edge_carry_weight=vals.get("edge_carry_weight", 0.34),
            edge_value_weight=vals.get("edge_value_weight", 0.18),
            edge_sentiment_weight=vals.get("edge_sentiment_weight", 0.05),
            edge_abstain_threshold=vals.get("edge_abstain_threshold", 0.15),
            edge_conviction_override=vals.get("edge_conviction_override", 0.25),
        )

# ─── Absolute sub-score scales (ADR-0042) ────────────────────────────────────
# Each is a documented anchor on the signal's OWN scale, so a theme's HypeScore
# depends only on that theme's signals. Cross-sectional min-max made a score a
# statement about the day's peer group rather than about the theme: on 2026-07-24
# China Growth's mention count was byte-identical to the day before (1.14286) and
# its HypeScore still fell 60.6 -> 36.6, and Corporate Credit's was identical
# (0.857143) while its score fell 45.7 -> 34.2.
VOLUME_BUSY_MENTIONS = 3.0   # 7d-avg mentions/day that counts as a busy theme
CORR_FULL = 0.50             # |corr| at which the correlation sub-score saturates
MOMENTUM_SCALE = 2.0         # robust-momentum z at which momentum is ~0.88


def volume_subscore(mentions_7d_avg: float) -> float:
    """Attention volume on an ABSOLUTE scale, [0, 1]. Saturating, never relative.

    ``tanh(m / 3.0)`` — a theme averaging 3 mentions/day scores 0.76, one averaging
    0.4 scores 0.13, and the number means the same thing tomorrow.
    """
    return math.tanh(max(0.0, mentions_7d_avg) / VOLUME_BUSY_MENTIONS)


def corr_subscore(price_corr: float) -> float:
    """|corr| against a fixed anchor, [0, 1].

    ADR-0028 min-maxed |corr| across themes because a raw 0.1-0.4 "structurally
    under-delivered" against a 30% weight. That was a CALIBRATION complaint and
    min-max was the wrong remedy: it fixed the scale by making the score relative,
    so a theme's correlation reading moved when OTHER themes' correlations moved.
    Dividing by a documented full-credit level fixes the calibration without
    surrendering time-comparability.
    """
    return min(1.0, abs(price_corr) / CORR_FULL)


def momentum_subscore(momentum_raw: float) -> float:
    """Robust-momentum z mapped to [0, 1] with 0.5 at "no change".

    ``robust_momentum`` already returns a MAD-scaled z clipped to [-4, 4], which is
    self-referenced by construction — it compares a theme to its OWN history. Only
    the final squash was cross-sectional, and this replaces it.
    """
    return (math.tanh(momentum_raw / MOMENTUM_SCALE) + 1.0) / 2.0


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


def volume_base(r: dict) -> float:
    """
    The attention-volume magnitude for a theme = its trailing 7-day average
    daily mentions (``mention_count_7d_avg``), falling back to the 1-day count
    only when the average is missing.

    Why the 7-day average and not the 1-day count (ADR-0035): a daily run
    frequently collects ZERO articles dated that exact calendar day (news is
    fetched with prior-day timestamps), so ``mention_count_1d`` was 0 for *every*
    theme on many runs. min-max over an all-equal list returns its 0.5 neutral
    fallback, so the Volume sub-score collapsed to a flat 50 across the whole
    board — informative signal destroyed. The 7-day average carries genuine
    cross-theme spread (a theme mentioned ~6×/day vs ~0.4×/day), and today's
    deviation *from* that level is already captured separately by Momentum
    (``robust_momentum`` of the 1-day count vs its 7-day window). Volume = level,
    Momentum = change — a cleaner separation than the old volume=today's-count,
    which conflated the two and was usually zero.

    Both the score computation (here) and the persisted display (``persist`` in
    daily_refresh) call this so the four sub-scores always reproduce hype_score.
    """
    avg = r.get("mention_count_7d_avg")
    if avg is None:
        return float(r.get("mention_count_1d", 0) or 0)
    return float(avg)


def compute_hype_scores(raw_signals: list[dict], cfg: ScoringConfig) -> list[dict]:
    """
    Cross-theme helper: min-max normalize each sub-score across all themes,
    then call hype_score for each theme. Returns scored rows with 'hype_score'.

    Empty input returns an empty list — min()/max() on empty sequences raises
    ValueError, which would otherwise crash daily_refresh on bootstrap.
    """
    if not raw_signals:
        return []

    scored = []
    for r in raw_signals:
        # ABSOLUTE sub-scores (ADR-0042). Each depends only on this theme's own
        # signal, so the number means the same thing tomorrow — which is what Q2's
        # "support risk monitoring" requires and cross-sectional min-max cannot do.
        volume = volume_subscore(volume_base(r))
        momentum = momentum_subscore(r["momentum_raw"])
        corr = corr_subscore(r["price_corr"])
        score = hype_score(
            volume=volume,
            sentiment=r["avg_sentiment"],
            corr=corr,
            momentum=momentum,
            cfg=cfg,
        )
        scored.append({**r, "hype_score": score})
    return scored
