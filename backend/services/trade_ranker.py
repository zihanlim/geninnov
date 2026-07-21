"""
Trade ranking and position sizing.

Spec section 6.2 -- Long/short ranking:
  - Direction rule: Sign(TradeScore) determines direction. Positive -> long, Negative -> short.
  - Top 5 Longs:  5 highest TradeScore values where direction = long, HypeScore >= threshold.
  - Top 5 Shorts: 5 lowest TradeScore values where direction = short, HypeScore >= threshold.

Spec section 7.1 -- Position sizing:
  - Weight each candidate by HypeScore/100 (higher confidence = more capital).
  - Normalize across the candidate set and scale to total_capital.
  - Each (theme, asset, direction) is one candidate.
  - Sector cap: no single sector > 30% of book
  - Geography cap: no single geography > 35% of book
  - Single-name cap: no single position > 20% of book
"""
from __future__ import annotations

from dataclasses import dataclass

# Re-exported from book_metrics for use by callers
from .book_metrics import SECTOR_MAP, GEO_MAP
from .book_metrics import (
    MAX_SINGLE_NAME_WEIGHT,
    MAX_SECTOR_WEIGHT,
    MAX_GEO_WEIGHT,
)


@dataclass(frozen=True)
class TradeCandidate:
    theme_id: str
    asset: str
    direction: str  # "long" | "short"
    trade_score: float
    hype_score: float
    avg_sentiment: float

    def to_trade_candidate_row(self, run_date: str, timeframe: str = "1-2 weeks") -> dict:
        side = "Long" if self.direction == "long" else "Short"
        thesis = (
            f"{side} {self.asset} on theme momentum "
            f"(HypeScore {self.hype_score:.1f}, TradeScore {self.trade_score:+.2f}, "
            f"sentiment {self.avg_sentiment:+.2f})."
        )
        risk = (
            "Theme correlation risk (CorrScore may be unstable on small samples); "
            "mean-reversion if hype fades; event risk around scheduled macro prints (FOMC/CPI/NFP)."
        )
        return {
            "theme_id": self.theme_id,
            "asset": self.asset,
            "direction": self.direction,
            "trade_score": self.trade_score,
            "hype_score": self.hype_score,
            "entry_thesis": thesis,
            "risk_factors": risk,
            "timeframe": timeframe,
        }

    def to_portfolio_position_row(self, notional: float, weight: float) -> dict:
        return {
            "theme_id": self.theme_id,
            "asset": self.asset,
            "direction": self.direction,
            "notional": notional,
            "weight": weight,
            "hype_score": self.hype_score,
            "trade_score": self.trade_score,
        }


def rank_trade_candidates(
    scored: list[dict],
    theme_assets_map: dict[str, list[str]],
    hype_threshold: float,
    top_n: int = 5,
) -> tuple[list[TradeCandidate], list[TradeCandidate]]:
    """Select top N longs and top N shorts from scored themes.

    Args:
        scored:            list of dicts with keys theme_id, trade_score, hype_score, avg_sentiment.
        theme_assets_map:  {theme_id: [ticker, ...]} - how to expand each theme into candidates.
                           Use empty list to skip a theme.
        hype_threshold:    only consider themes with hype_score >= this value.
        top_n:             number of long candidates AND number of short candidates to return.

    Returns:
        (longs, shorts) as lists of TradeCandidate.
    """
    eligible = [r for r in scored if (r.get("hype_score") or 0) >= hype_threshold]

    long_pool = [r for r in eligible if (r.get("trade_score") or 0) > 0]
    short_pool = [r for r in eligible if (r.get("trade_score") or 0) < 0]

    long_pool.sort(key=lambda r: r["trade_score"], reverse=True)
    short_pool.sort(key=lambda r: r["trade_score"])

    top_long_themes = long_pool[:top_n]
    top_short_themes = short_pool[:top_n]

    longs = _expand(top_long_themes, theme_assets_map, direction="long")
    shorts = _expand(top_short_themes, theme_assets_map, direction="short")

    return longs, shorts


def _expand(
    themes: list[dict],
    theme_assets_map: dict[str, list[str]],
    direction: str,
) -> list[TradeCandidate]:
    out: list[TradeCandidate] = []
    for r in themes:
        theme_id = r["theme_id"]
        for asset in theme_assets_map.get(theme_id, []):
            out.append(
                TradeCandidate(
                    theme_id=theme_id,
                    asset=asset,
                    direction=direction,
                    trade_score=r["trade_score"],
                    hype_score=r["hype_score"],
                    avg_sentiment=r.get("avg_sentiment", 0.0),
                )
            )
    return out


def allocate_portfolio(
    candidates: list[TradeCandidate],
    total_capital: float,
    sector_map: dict[str, str] | None = None,
    geo_map: dict[str, str] | None = None,
    max_single: float = MAX_SINGLE_NAME_WEIGHT,
    max_sector: float = MAX_SECTOR_WEIGHT,
    max_geo: float = MAX_GEO_WEIGHT,
) -> list[tuple[TradeCandidate, float, float]]:
    """Size positions per spec section 7.1 with sector/geo/single-name caps.

    Args:
        candidates:    list of TradeCandidate with asset attribute
        total_capital: $100M
        sector_map:    {ticker -> sector name}, defaults to SECTOR_MAP
        geo_map:      {ticker -> geography name}, defaults to GEO_MAP
        max_single:  max weight per single name (default 20%)
        max_sector:  max weight per sector (default 30%)
        max_geo:     max weight per geography (default 35%)

    Returns:
        List of (candidate, notional, weight) tuples. weight is the notional's
        share of total_capital (i.e., notional / total_capital).
    """
    if not candidates:
        return []
    if total_capital <= 0:
        raise ValueError("total_capital must be > 0")

    sector_map = sector_map or SECTOR_MAP
    geo_map = geo_map or GEO_MAP

    raw_weights = [max(c.hype_score, 0.0) / 100.0 for c in candidates]
    total_raw = sum(raw_weights)

    if total_raw == 0:
        n = len(candidates)
        return [(c, total_capital / n, 1.0 / n) for c in candidates]

    # Normalise to sum to 1.0
    base_weights = [w / total_raw for w in raw_weights]

    # Iterative cap enforcement
    weights = list(base_weights)
    for _ in range(20):   # safety: 20 iterations is enough to converge
        violations_fixed = True

        # 1. Single-name cap
        for i, w in enumerate(weights):
            if w > max_single:
                weights[i] = max_single
                violations_fixed = False

        # 2. Sector cap
        sec_weights: dict[str, float] = {}
        for i, c in enumerate(candidates):
            sec = sector_map.get(c.asset, "Other")
            sec_weights[sec] = sec_weights.get(sec, 0.0) + weights[i]

        for sec, sw in sec_weights.items():
            if sw > max_sector:
                excess = sw - max_sector
                # Proportional reduction across all names in this sector
                sec_members = [i for i, c in enumerate(candidates)
                               if sector_map.get(c.asset, "Other") == sec]
                for i in sec_members:
                    if weights[i] > 0:
                        reduction = weights[i] * excess / sw
                        weights[i] = max(0.0, weights[i] - reduction)
                violations_fixed = False

        # 3. Geography cap
        geo_weights: dict[str, float] = {}
        for i, c in enumerate(candidates):
            geo = geo_map.get(c.asset, "Other")
            geo_weights[geo] = geo_weights.get(geo, 0.0) + weights[i]

        for geo, gw in geo_weights.items():
            if gw > max_geo:
                excess = gw - max_geo
                geo_members = [i for i, c in enumerate(candidates)
                              if geo_map.get(c.asset, "Other") == geo]
                for i in geo_members:
                    if weights[i] > 0:
                        reduction = weights[i] * excess / gw
                        weights[i] = max(0.0, weights[i] - reduction)
                violations_fixed = False

        if violations_fixed:
            break

    # Normalise to sum to 1.0 after cap reductions
    total_w = sum(weights)
    if total_w > 0:
        weights = [w / total_w for w in weights]

    return [
        (c, w * total_capital, w)
        for c, w in zip(candidates, weights)
    ]
