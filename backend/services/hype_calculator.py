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
    # Conviction vol floor (ADR-0047). conviction = |EdgeScore| / max(vol, floor).
    # 0.00315 daily ~= 5% annualised: the conventional boundary between a cash-like
    # instrument and a risk position. Without it the ratio measures the denominator
    # rather than the idea — BIL at 0.19% annualised vol scored 2375x conviction
    # against a 16x book median on 2026-07-25. 0 disables the floor.
    conviction_vol_floor: float = 0.00315

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
            conviction_vol_floor=vals.get("conviction_vol_floor", 0.00315),
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


# The |corr| at which an asset class counts as MATERIALLY moving with the theme's
# attention, for the breadth count. Half of CORR_FULL: a class at this level earns
# half the magnitude credit, which is the natural boundary for "this class is
# participating" without demanding saturation.
CORR_MATERIAL = 0.25


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


# ─── Cross-asset correlation (ADR-0127) ──────────────────────────────────────
# A "market theme" is a narrative driving CROSS-ASSET moves. Until ADR-0127 the
# correlation term measured one instrument: daily_refresh looped over a theme's
# mapped tickers and broke on the first, guarded by a test that could never fail
# (`correlation_with_mentions` returned the 0.0 sentinel, never NaN). So Fed
# Policy — mapped across rates, commodities and equity — was scored on whichever
# ticker the theme_assets query happened to return first, and a theme that moved
# four asset classes together scored identically to one tracking a single ETF.
#
# These three functions replace that with a reading over every mapped instrument,
# collapsed per ASSET CLASS so a theme carrying five rates ETFs cannot outvote one
# carrying a single FX position. Magnitude and breadth are both scored, because
# each answers a different question: "how hard does attention move prices" and
# "how much of the cross-asset complex does it move".


def per_class_corr(
    measured: dict[str, float | None],
    asset_class_of: dict[str, str],
) -> dict[str, float]:
    """Collapse per-ticker correlations to one SIGNED reading per asset class.

    ``measured`` maps ticker -> correlation, where **None means not measurable**
    (see ``correlation_with_mentions``) and is dropped rather than counted as 0.
    A ticker missing from ``asset_class_of`` is also dropped — an unclassified
    instrument cannot contribute to a cross-asset breadth claim.

    Within a class the STRONGEST |corr| wins, with its sign preserved. Not the
    mean: two rates ETFs that both track the theme are one reading of the rates
    complex, and averaging them against a third that happens to be cash-like
    would understate the class rather than describe it.
    """
    best: dict[str, float] = {}
    for ticker, corr in measured.items():
        if corr is None:
            continue
        cls = asset_class_of.get(ticker)
        if cls is None:
            continue
        if cls not in best or abs(corr) > abs(best[cls]):
            best[cls] = float(corr)
    return best


def cross_asset_corr_subscore(per_class: dict[str, float]) -> float | None:
    """The correlation sub-score, [0, 1] — magnitude AND breadth. None if nothing
    was measurable.

    Mean over the MEASURED asset classes of ``min(1, |c| / CORR_FULL)``. Two
    properties follow, and both are the point:

    * A theme correlating strongly in four of its four classes scores near 1.0; a
      theme correlating just as strongly in one of four scores near 0.25. Under
      the old single-ticker reading these were indistinguishable.
    * The denominator counts only classes we could MEASURE, never classes we
      mapped. A missing price history must not be scored as an absence of
      correlation — the same renormalise-over-what-is-present rule ADR-0036
      applies to EdgeScore.

    Absolute on its own scale, so ADR-0042 still holds: the number means the same
    thing tomorrow, and does not move when another theme's correlations move.
    """
    if not per_class:
        return None
    return sum(min(1.0, abs(c) / CORR_FULL) for c in per_class.values()) / len(per_class)


def corr_breadth(per_class: dict[str, float], threshold: float = CORR_MATERIAL) -> tuple[int, int]:
    """``(classes moving materially, classes measured)``.

    The literal cross-asset claim, carried alongside the score so a reader can see
    *"3 of 4 asset classes"* rather than inferring it from a decimal. Reported, not
    scored — ``cross_asset_corr_subscore`` already prices breadth continuously, and
    counting it twice would double-weight it.
    """
    if not per_class:
        return (0, 0)
    material = sum(1 for c in per_class.values() if abs(c) >= threshold)
    return (material, len(per_class))


def representative_corr(per_class: dict[str, float]) -> float | None:
    """The single SIGNED number that best represents the theme's price link — the
    strongest per-class correlation.

    This is what ``price_corr`` persists and what ``crowding_label`` reads, because
    crowding is a directional claim (co-moving with the market = consensus;
    inverse = natural hedge) and needs a sign that a breadth average would destroy.
    None when nothing was measurable.
    """
    if not per_class:
        return None
    return max(per_class.values(), key=abs)


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
    corr: float | None,
    momentum: float,
    cfg: ScoringConfig,
) -> float:
    """
    Compute HypeScore for a single theme.

    `volume`, `momentum` and `corr` are the three magnitude signals, each an
    absolute [0, 1] sub-score on its own documented scale (ADR-0042). `sentiment`
    is VADER compound in [-1, +1] and is rescaled here (NOT cross-theme
    normalized) because its SIGN carries meaning — ranking would corrupt
    bullish/bearish direction. The abs() below is a harmless defensive fold (a
    no-op on an already-normalized [0, 1] value).

    `corr` may be **None**: no mapped instrument had enough overlapping history to
    measure a correlation at all. That component is then dropped and the remaining
    weights RENORMALISED over what is present, exactly as
    ``edge_signals.compute_edge_score`` does for a missing EdgeScore component
    (ADR-0036). Scoring an unmeasurable correlation as 0 is not neutral: with
    ``hype_corr_weight = 0.30`` it silently deducts up to 30 points of HypeScore
    for a gap in our data, and the theme reads as quiet when it was never measured.
    """
    sent = rescale_vader(sentiment)  # [-1, +1] -> [0, 1]

    present = [
        (cfg.hype_volume_weight, volume),
        (cfg.hype_sentiment_weight, sent),
        (cfg.hype_momentum_weight, momentum),
    ]
    if corr is not None:
        # All four present: the arithmetic is UNCHANGED — a plain weighted sum,
        # not a renormalised one. /method reproduces this line as
        # `100 x Σ(w_i · s_i)` from the persisted sub-scores and must keep
        # reconciling byte-for-byte, which it would not if this divided by a
        # weight total the page does not divide by.
        return 100 * (
            cfg.hype_volume_weight * volume +
            cfg.hype_sentiment_weight * sent +
            cfg.hype_corr_weight * abs(corr) +
            cfg.hype_momentum_weight * momentum
        )

    weight_present = sum(w for w, _ in present)
    if weight_present <= 0:
        return 0.0
    return 100 * sum(w * v for w, v in present) / weight_present


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


def theme_corr_subscore(r: dict) -> float | None:
    """The correlation sub-score for one theme's raw signal row.

    Prefers the CROSS-ASSET reading (``corr_by_class``, written by
    ``build_theme_signals``): the per-asset-class correlations measured over every
    instrument the theme maps to. Falls back to the legacy single ``price_corr``
    only for rows that predate ADR-0127 — a backfill or a replay of an old row —
    so the two paths never disagree about which number is authoritative.

    Returns None when the correlation was not measurable at all; ``hype_score``
    renormalises over the remaining components rather than scoring it 0.

    Both the score computation and the persisted ``corr_score`` display call this,
    so the four persisted sub-scores always reproduce the persisted HypeScore.
    """
    by_class = r.get("corr_by_class")
    if by_class:
        return cross_asset_corr_subscore(by_class)
    if by_class is not None:
        # Present but empty: measured nothing. Explicitly unmeasurable, not 0.
        return None
    legacy = r.get("price_corr")
    return None if legacy is None else corr_subscore(legacy)


def compute_hype_scores(raw_signals: list[dict], cfg: ScoringConfig) -> list[dict]:
    """
    Per-theme scoring: build each absolute sub-score, then call hype_score.
    Returns scored rows with 'hype_score'.

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
        corr = theme_corr_subscore(r)
        score = hype_score(
            volume=volume,
            sentiment=r["avg_sentiment"],
            corr=corr,
            momentum=momentum,
            cfg=cfg,
        )
        scored.append({**r, "hype_score": score})
    return scored
