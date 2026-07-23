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

# Asset-class mirror of the DB taxonomy (supabase/migrations/009_asset_class_lens.sql).
# Kept in sync with theme_assets.asset_class so the L5 seam can classify without
# a DB round-trip. Frontend mirror lives in frontend/lib/assetMetadata.ts.
_ASSET_CLASS_MAP: dict[str, str] = {
    # credit
    "HYG": "credit", "LQD": "credit", "JNK": "credit",
    "BKLN": "credit", "ANGL": "credit", "EMB": "credit",
    # rates
    "TLT": "rates", "IEF": "rates", "SHY": "rates",
    "TIPS": "rates", "AGG": "rates", "BIL": "rates", "SVXY": "rates",
    # equity
    "QQQ": "equity", "SPY": "equity", "IWM": "equity",
    "FXI": "equity", "MCHI": "equity", "BABA": "equity", "KWEB": "equity",
    "XLE": "equity", "XLF": "equity", "XLV": "equity", "ARKK": "equity",
    "EWJ": "equity", "EFA": "equity", "EEM": "equity", "BULL": "equity",
    # fx
    "UUP": "fx", "FXE": "fx", "EWZ": "fx", "DXY": "fx",
    # commodity
    "GLD": "commodity", "SLV": "commodity", "UNG": "commodity",
    "OIH": "commodity", "CL": "commodity", "IAU": "commodity",
    # equity (GDX holds gold-miner equities, so it is an equity ETF even though
    # its theme is commodity-adjacent)
    "GDX": "equity",
}


def is_classified(ticker: str) -> bool:
    """True iff ``ticker`` is present in all three taxonomy maps.

    Use this to filter a candidate pool BEFORE it reaches allocate_portfolio /
    compute_book_metrics, which hard-index the maps. `theme_discovery` can emit
    a ticker nobody has mapped yet; dropping that one candidate with a warning
    keeps the daily run alive, whereas letting it reach the hard-index sites
    aborts the entire pipeline. The maps themselves are kept co-extensive and a
    test enforces it, so this only fires for a genuinely new ticker.
    """
    return (
        ticker in SECTOR_MAP
        and ticker in GEO_MAP
        and ticker in _ASSET_CLASS_MAP
    )


def classify(ticker: str) -> dict:
    """Single seam for asset taxonomy. Unmapped tickers raise — no silent fallback.

    Returns ``{"ticker", "sector", "geo", "asset_class"}``. If any of the three
    underlying maps is missing the ticker, raises ``KeyError``. Callers that must
    survive a novel ticker should gate on `is_classified` first rather than
    catch this.
    """
    if not is_classified(ticker):
        raise KeyError(f"unclassified ticker: {ticker}")
    return {
        "ticker": ticker,
        "sector": SECTOR_MAP[ticker],
        "geo": GEO_MAP[ticker],
        "asset_class": _ASSET_CLASS_MAP[ticker],
    }


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

    # One-shot capped weights — no iteration needed.
    # Formula: cap the dominated asset (weight > max_single) to max_single,
    # scale all non-dominated assets proportionally to absorb the freed capacity.
    #   new_non_dom_i = old_non_dom_i × (1 - dominated_sum) / non_dom_sum
    #   new_dom_i     = max_single
    # This preserves the relative proportions of non-dominated assets.
    # Normalise once at the end so weights sum to exactly 1.0.

    weights = list(base_weights)

    # ── Single-name cap ──────────────────────────────────────────────────────────
    # Strategy: cap all dominated names to max_single, redistribute their excess
    # to non-dominated names PROPORTIONALLY BY THEIR ORIGINAL WEIGHTS (not scaled).
    # This preserves the relative proportions of uncapped names.
    dominated = [i for i, w in enumerate(weights) if w > max_single]
    non_dom = [i for i, w in enumerate(weights) if w <= max_single]
    dominated_sum = sum(weights[i] for i in dominated)
    non_dom_sum = sum(weights[i] for i in non_dom)
    excess = dominated_sum - len(dominated) * max_single  # total freed capacity

    if dominated and non_dom and non_dom_sum > 0:
        # Cap dominated, redistribute excess proportionally to non-dom by original weights
        for i in dominated:
            weights[i] = max_single
        for i in non_dom:
            # Non-dom_i_new = Non-dom_i / non_dom_sum × (non_dom_sum + excess)
            #                 = Non-dom_i + Non-dom_i / non_dom_sum × excess
            weights[i] = weights[i] / non_dom_sum * (non_dom_sum + excess)
    elif dominated:
        for i in dominated:
            weights[i] = max_single

    # ── Sector cap ──────────────────────────────────────────────────────────────
    # Only apply sector cap when there are at least 3 members in the sector
    # and the sector genuinely exceeds max_sector. With ≤2 members the
    # single-name cap is sufficient.
    for _ in range(10):
        sec_weights: dict[str, float] = {}
        sec_members: dict[str, list[int]] = {}
        for i, c in enumerate(candidates):
            # Unmapped tickers must raise — no silent fallback.
            sec = sector_map[c.asset]
            sec_weights[sec] = sec_weights.get(sec, 0.0) + weights[i]
            sec_members.setdefault(sec, []).append(i)

        violating = {
            sec for sec, sw in sec_weights.items()
            if sw > max_sector and len(sec_members[sec]) >= 3
        }
        if not violating:
            break

        for sec in violating:
            members = sec_members[sec]
            dominated_m = [i for i in members if weights[i] > max_sector]
            non_dom_m = [i for i in members if weights[i] <= max_sector]
            dom_sum = sum(weights[i] for i in dominated_m)
            non_sum = sum(weights[i] for i in non_dom_m)
            excess_s = dom_sum - len(dominated_m) * max_sector

            if dominated_m and non_dom_m and non_sum > 0:
                for i in dominated_m:
                    weights[i] = max_sector
                for i in non_dom_m:
                    weights[i] = weights[i] / non_sum * (non_sum + excess_s)
            elif dominated_m:
                for i in dominated_m:
                    weights[i] = max_sector

    # ── Geography cap ───────────────────────────────────────────────────────────
    # Same guard: ≥3 members in the geography group before applying.
    for _ in range(10):
        geo_weights: dict[str, float] = {}
        geo_members: dict[str, list[int]] = {}
        for i, c in enumerate(candidates):
            # Unmapped tickers must raise — no silent fallback.
            geo = geo_map[c.asset]
            geo_weights[geo] = geo_weights.get(geo, 0.0) + weights[i]
            geo_members.setdefault(geo, []).append(i)

        violating = {
            geo for geo, gw in geo_weights.items()
            if gw > max_geo and len(geo_members[geo]) >= 3
        }
        if not violating:
            break

        for geo in violating:
            members = geo_members[geo]
            dominated_m = [i for i in members if weights[i] > max_geo]
            non_dom_m = [i for i in members if weights[i] <= max_geo]
            dom_sum = sum(weights[i] for i in dominated_m)
            non_sum = sum(weights[i] for i in non_dom_m)
            excess_g = dom_sum - len(dominated_m) * max_geo

            if dominated_m and non_dom_m and non_sum > 0:
                for i in dominated_m:
                    weights[i] = max_geo
                for i in non_dom_m:
                    weights[i] = weights[i] / non_sum * (non_sum + excess_g)
            elif dominated_m:
                for i in dominated_m:
                    weights[i] = max_geo

    # Final normalisation so weights sum exactly to 1.0
    total_w = sum(weights)
    if total_w > 0:
        weights = [w / total_w for w in weights]

    return [
        (c, w * total_capital, w)
        for c, w in zip(candidates, weights)
    ]
