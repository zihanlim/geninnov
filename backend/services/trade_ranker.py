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
"""
from __future__ import annotations

from dataclasses import dataclass


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
) -> list[tuple[TradeCandidate, float, float]]:
    """Size positions per spec section 7.1.

        weight_i = hype_score_i / 100
        notional_i = (weight_i / sum(weights)) * total_capital

    Returns:
        List of (candidate, notional, weight) tuples. weight is the notional's
        share of total_capital (i.e., notional / total_capital).
    """
    if not candidates:
        return []
    if total_capital <= 0:
        raise ValueError("total_capital must be > 0")

    raw_weights = [max(c.hype_score, 0.0) / 100.0 for c in candidates]
    total_w = sum(raw_weights)

    if total_w == 0:
        n = len(candidates)
        return [(c, total_capital / n, 1.0 / n) for c in candidates]

    return [
        (c, (w / total_w) * total_capital, w / total_w)
        for c, w in zip(candidates, raw_weights)
    ]
