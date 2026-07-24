"""
Trade ranking and position sizing.

Spec section 6.2 -- Long/short ranking (revised by ADR-0029):
  - Direction rule: Sign(TradeScore) determines direction. Positive -> long, Negative -> short.
  - Hype-eligible themes (HypeScore >= threshold) fill each side first, ordered
    by TradeScore (longs highest-first, shorts lowest-first), up to top_n.
  - Direction is DECOUPLED from the hype gate: the gate sets *priority*, not
    whether a side can exist. If a side is still short of `min_side` after the
    eligible pass, it is backfilled from the strongest sub-threshold themes of
    that direction, so the book is two-sided whenever the signal is. Backfilled
    positions carry a low HypeScore, so hype-weighted sizing keeps them small.
  - A side stays empty only when NO theme of that sign exists anywhere (honest:
    a genuinely one-directional day). The original rule intersected
    `eligible AND sign`, so a day where every hype-eligible theme shared one sign
    produced an empty opposite side (the "0 long candidates" pathology).

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
    "UUP": "fx", "FXE": "fx", "EWZ": "fx",
    # commodity
    "GLD": "commodity", "SLV": "commodity", "UNG": "commodity",
    "OIH": "commodity", "CL": "commodity", "IAU": "commodity",
    # equity (GDX holds gold-miner equities, so it is an equity ETF even though
    # its theme is commodity-adjacent)
    "GDX": "equity",
    # equity — single companies (ADR-0043)
    "JPM": "equity",
    "GS": "equity",
    "XOM": "equity",
    "CVX": "equity",
    "SLB": "equity",
    "UNH": "equity",
    "LMT": "equity",
    "NOC": "equity",
    "RTX": "equity",
    "F": "equity",
    "JD": "equity",
    "PDD": "equity",
    "FCX": "equity",
    "NEM": "equity",
    "NUE": "equity",
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
    edge_score: float = 0.0   # direction basis (ADR-0031); sign(edge_score) == direction
    trend_signal: float = 0.0   # EdgeScore component: 6m price trend
    regime_bias: float = 0.0    # EdgeScore component: regime fit
    carry_signal: float = 0.0   # EdgeScore component: yield/spread carry
    value_signal: float = 0.0   # EdgeScore component: value (z-score vs history)
    sentiment_signal: float = 0.0  # EdgeScore component: contrarian sentiment tilt (Stage 5)
    vol: float = 0.0          # daily-return vol of the theme basket (ADR-0032 sizing)
    conviction: float = 0.0   # |edge_score| / vol — Stage-4 conviction × inverse-vol weight

    def _edge_row(self) -> dict:
        """The EdgeScore decision block persisted on both candidate + position rows,
        so the frontend can show the real 4-component direction + conviction sizing
        (ADR-0031/0032) instead of the superseded 2-component / HypeScore view."""
        return {
            "edge_score": self.edge_score,
            "trend_signal": self.trend_signal,
            "regime_bias": self.regime_bias,
            "carry_signal": self.carry_signal,
            "value_signal": self.value_signal,
            "sentiment_signal": self.sentiment_signal,
            "conviction": self.conviction,
            "vol": self.vol,
        }

    def to_trade_candidate_row(self, run_date: str, timeframe: str = "1-2 weeks") -> dict:
        side = "Long" if self.direction == "long" else "Short"
        thesis = (
            f"{side} {self.asset} — direction from EdgeScore {self.edge_score:+.2f} "
            f"(price trend + regime fit; HypeScore {self.hype_score:.1f} attention, "
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
            **self._edge_row(),
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
            **self._edge_row(),
        }


def rank_trade_candidates(
    scored: list[dict],
    theme_assets_map: dict[str, list[str]],
    hype_threshold: float,
    top_n: int = 5,
    min_side: int = 1,
    score_key: str = "trade_score",
    abstain_threshold: float = 0.0,
    asset_edges: dict | None = None,
) -> tuple[list[TradeCandidate], list[TradeCandidate]]:
    """Select up to N longs and N shorts from scored themes (ADR-0029).

    Args:
        scored:            list of dicts with keys theme_id, hype_score, avg_sentiment,
                           and the direction basis named by ``score_key``.
        theme_assets_map:  {theme_id: [ticker, ...]} - how to expand each theme into candidates.
                           Use empty list to skip a theme.
        hype_threshold:    themes with hype_score >= this value fill each side first.
        top_n:             max long themes AND max short themes to return.
        min_side:          guaranteed minimum themes per side. If the hype-eligible
                           pass yields fewer than this on a side, backfill from the
                           strongest sub-threshold themes of that direction so the
                           book is never one-sided while opposite-sign signal exists.
        score_key:         the field whose SIGN sets direction and whose MAGNITUDE
                           ranks within a side. Defaults to "trade_score"; daily_refresh
                           passes "edge_score" so direction is anchored to the EdgeScore
                           (price trend + regime fit), not near-zero news sentiment (ADR-0031).
        abstain_threshold: Stage-4 abstention band (ADR-0032). A theme enters a side
                           only if |score_key| >= this. A weak/flat signal produces NO
                           position rather than a forced one; a side (or the whole book)
                           can legitimately be empty when conviction is absent.

    Returns:
        (longs, shorts) as lists of TradeCandidate.
    """
    def _pool(rows: list[dict], positive: bool) -> list[dict]:
        # Themes of the requested direction, strongest-signal-first. Abstains on a
        # signal weaker than abstain_threshold (0.0 => only exclude exactly-zero).
        side = [
            r for r in rows
            if abs(r.get(score_key) or 0) >= max(abstain_threshold, 1e-12)
            and ((r.get(score_key) or 0) > 0) == positive
        ]
        side.sort(key=lambda r: (r.get(score_key) or 0), reverse=positive)
        return side

    eligible = [r for r in scored if (r.get("hype_score") or 0) >= hype_threshold]
    below = [r for r in scored if (r.get("hype_score") or 0) < hype_threshold]

    def _select(positive: bool) -> list[dict]:
        # NOTE (2026-07-24): the backfill is capped at `min_side`, NOT `top_n`, and
        # that is deliberate — ADR-0029's purpose is two-SIDEDNESS ("so the book is
        # never one-sided while opposite-sign signal exists"), not filling the book.
        # Backfilled themes sit BELOW the hype gate, so topping a side up to top_n
        # from them would build the book out of low-attention themes and quietly
        # contradict the attention premise the whole product rests on.
        #
        # This is why the live book is 2 long / 3 short rather than five-and-five:
        # on 2026-07-24 the three highest-hype themes all abstained while all three
        # direction-capable themes sat below the gate, so both sides fell through to
        # this slice. The honest route to more breadth is a wider universe (more
        # themes, more expressions per theme, single names) — not re-slicing here.
        picks = _pool(eligible, positive)[:top_n]
        if len(picks) < min_side:
            seen = {r["theme_id"] for r in picks}
            backfill = [r for r in _pool(below, positive) if r["theme_id"] not in seen]
            picks = picks + backfill[: min_side - len(picks)]
        return picks

    if asset_edges:
        # Per-asset direction (ADR-0038/0039). Scope is chosen by ATTENTION, which is
        # the premise the product rests on; direction and abstention are decided per
        # ASSET, which is where the decision actually is.
        #
        # Scope is deliberately NOT filtered by the theme's own |EdgeScore|. Once
        # direction is per-asset, the theme edge is a summary statistic and not the
        # decision variable — and it is smallest exactly when cross-sectional
        # opportunity is largest, because a theme whose assets disagree averages to
        # zero. Measured on 2026-07-24, the three themes the old gate abstained were
        # the three richest in shorts: US Dollar (the HIGHEST-attention theme of the
        # day at hype 73.4, edge +0.144) held 3 short-capable assets, China Growth
        # (-0.080) held 2, and Inflation (+0.086) was 4-for-4 short-capable and
        # still abstained. Its theme edge blends the rates leg's carry and value with
        # the commodity leg's trend — a number describing no asset that exists.
        #
        # This does not weaken abstention, it moves it to where the position is
        # taken: every candidate below still has to clear |its own edge| >=
        # abstain_threshold in _expand. Gating on both meant abstaining twice, once
        # on a statistic that is not the decision.
        eligible_by_hype = sorted(eligible, key=lambda r: -(r.get("hype_score") or 0))
        themes_in_scope = eligible_by_hype[:top_n]
        if len(themes_in_scope) < min_side:
            seen_t = {r["theme_id"] for r in themes_in_scope}
            rest = sorted((r for r in below if r["theme_id"] not in seen_t),
                          key=lambda r: -(r.get("hype_score") or 0))
            themes_in_scope += rest[: min_side - len(themes_in_scope)]
        expanded = _expand(themes_in_scope, theme_assets_map, direction="long",
                           asset_edges=asset_edges, abstain_threshold=abstain_threshold)
        # The same ticker can express several themes; keep its strongest conviction.
        best: dict[str, TradeCandidate] = {}
        for c in expanded:
            cur = best.get(c.asset)
            if cur is None or abs(c.edge_score) > abs(cur.edge_score):
                best[c.asset] = c
        deduped = list(best.values())
        longs = sorted([c for c in deduped if c.direction == "long"],
                       key=lambda c: -c.edge_score)
        shorts = sorted([c for c in deduped if c.direction == "short"],
                        key=lambda c: c.edge_score)
        return longs, shorts

    longs = _expand(_select(positive=True), theme_assets_map, direction="long")
    shorts = _expand(_select(positive=False), theme_assets_map, direction="short")

    return longs, shorts


def _expand(
    themes: list[dict],
    theme_assets_map: dict[str, list[str]],
    direction: str,
    asset_edges: dict | None = None,
    abstain_threshold: float = 0.0,
) -> list[TradeCandidate]:
    """Expand selected themes into per-asset candidates.

    With ``asset_edges`` supplied (ADR-0038) each asset carries its OWN EdgeScore
    and therefore its OWN side, and is dropped when its own |edge| falls inside the
    abstention band. The theme decides what is in scope; the asset decides which way
    it goes. Without it, every asset inherits the theme's direction — the legacy
    behaviour, kept so existing callers and tests are unaffected.
    """
    out: list[TradeCandidate] = []
    for r in themes:
        theme_id = r["theme_id"]
        for asset in theme_assets_map.get(theme_id, []):
            ae = (asset_edges or {}).get((theme_id, asset))
            if ae is None:
                comp, side = r, direction
            else:
                edge = ae.get("edge_score") or 0.0
                if abs(edge) < max(abstain_threshold, 1e-12):
                    continue          # this asset has no view of its own
                comp, side = ae, ("long" if edge > 0 else "short")
            out.append(
                TradeCandidate(
                    theme_id=theme_id,
                    asset=asset,
                    direction=side,
                    trade_score=r["trade_score"],
                    hype_score=r["hype_score"],
                    avg_sentiment=r.get("avg_sentiment", 0.0),
                    edge_score=comp.get("edge_score", 0.0),
                    trend_signal=comp.get("trend_signal", 0.0),
                    regime_bias=comp.get("regime_bias", 0.0),
                    carry_signal=comp.get("carry_signal", 0.0),
                    value_signal=comp.get("value_signal", 0.0),
                    sentiment_signal=comp.get("sentiment_signal", 0.0),
                    vol=comp.get("vol", 0.0),
                    conviction=comp.get("conviction", 0.0),
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
    size_by: str = "hype",
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
        size_by:     "hype" (default, ∝ HypeScore) or "conviction" (Stage-4:
                     ∝ conviction = |EdgeScore| / vol, i.e. conviction × inverse-vol).
                     "conviction" falls back to hype if no candidate carries any.

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

    if size_by == "conviction":
        raw_weights = [max(c.conviction, 0.0) for c in candidates]
        if sum(raw_weights) == 0:   # no conviction anywhere → fall back to hype
            raw_weights = [max(c.hype_score, 0.0) / 100.0 for c in candidates]
    else:
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
    # Cap every over-weight name to max_single and redistribute the freed capacity
    # across the names still under the cap, in proportion to their current weights so
    # relative conviction is preserved. Then DO IT AGAIN, because redistribution can
    # push a recipient over the cap itself.
    #
    # That re-check was missing: the pass ran exactly once, so a two-name book with
    # an 88/12 split capped the first to 20% and handed the whole 68% excess to the
    # second, leaving it at 80% — four times its own 20% limit. A test asserted that
    # $80M as correct.
    #
    # Iterating to a fixed point means the excess stops somewhere real: it lands on
    # names that can still take it, and once nobody can, it stays undeployed as cash
    # rather than being forced into a name whose conviction never earned it.
    for _ in range(50):
        over = [i for i, w in enumerate(weights) if w > max_single + 1e-12]
        if not over:
            break
        under = [i for i, w in enumerate(weights) if w < max_single - 1e-12]
        freed = sum(weights[i] - max_single for i in over)
        for i in over:
            weights[i] = max_single
        under_sum = sum(weights[i] for i in under)
        if not under or under_sum <= 0:
            break          # nowhere left to put it → it becomes cash
        # Give each under-cap name a share of the freed capacity proportional to its
        # current weight. Any resulting over-shoot is caught on the next iteration.
        for i in under:
            weights[i] += freed * weights[i] / under_sum

    # ── Group caps: sector, then geography ──────────────────────────────────────
    # A group cap binds on the GROUP TOTAL, so when it is exceeded every member is
    # scaled down by the same factor. That keeps their relative sizes intact and
    # lets the freed capital fall to cash rather than pushing it into other names,
    # which would just relocate the concentration.
    #
    # The previous implementation missed the ordinary case entirely. It only acted
    # on members whose OWN weight exceeded the GROUP cap — so two credit names at
    # 20% each put the Credit sector at 40% against a 30% limit while neither member
    # individually exceeded 30%, and nothing was capped. It then skipped any group
    # with fewer than three members outright ("the single-name cap is sufficient"),
    # which it is not: 2 x 20% = 40% > 30%. Verified live — a HYG/LQD/GLD book sat
    # at Credit 40% with the cap reported as satisfied.
    def _apply_group_cap(group_of: dict[str, str], cap: float) -> None:
        if cap <= 0:
            return
        totals: dict[str, float] = {}
        members: dict[str, list[int]] = {}
        for i, c in enumerate(candidates):
            # Unmapped tickers must raise — no silent fallback.
            g = group_of[c.asset]
            totals[g] = totals.get(g, 0.0) + weights[i]
            members.setdefault(g, []).append(i)

        for g, total in totals.items():
            if total > cap + 1e-12:
                scale = cap / total
                for i in members[g]:
                    weights[i] *= scale

    _apply_group_cap(sector_map, max_sector)
    _apply_group_cap(geo_map, max_geo)

    # NO final renormalisation. If the caps bind, we deploy less than the full
    # capital and hold the remainder in cash.
    #
    # There used to be a "normalise so weights sum exactly to 1.0" step here, and it
    # erased every cap above it. Capping three names at 20% leaves the weights
    # summing to 0.60 — that IS the cap working — and dividing through by 0.60 put
    # all three straight back to 33.3%. Observed live on 2026-07-24: a three-name
    # book reported six violations (each name 33.3% against a 20% limit, each sector
    # 33.3% against 30%) while ARCHITECTURE.md claimed the caps were "actually
    # enforced". They were computed, reported, and then undone one line later.
    #
    # Forcing full notional into whatever names happen to clear is precisely what a
    # position limit exists to prevent: the fewer the names, the harder the book
    # breaks its own published limit, which is exactly backwards. A book that cannot
    # be filled inside its risk limits should be smaller, not more concentrated.
    #
    # When no cap binds this is a no-op — the weights already sum to 1.0 — so only
    # genuinely constrained books change.
    deployed = sum(weights)
    if deployed > 1.0 + 1e-9:
        # Caps can only ever reduce weight, so this means the base weights did not
        # normalise. Guard rather than silently lever the book above its capital.
        weights = [w / deployed for w in weights]

    return [
        (c, w * total_capital, w)
        for c, w in zip(candidates, weights)
    ]
