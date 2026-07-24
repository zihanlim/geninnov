import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

import pytest

from backend.services.trade_ranker import (
    rank_trade_candidates,
    allocate_portfolio,
    TradeCandidate,
    classify,
)
from backend.services.hype_calculator import ScoringConfig


def _cfg(hype_threshold: float = 50.0) -> ScoringConfig:
    return ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )


def test_rank_filters_below_threshold():
    """Themes with hype_score < threshold should be excluded entirely."""
    scored = [
        {"theme_id": "t1", "hype_score": 30.0, "trade_score": 1.0, "avg_sentiment": 0.5},
        {"theme_id": "t2", "hype_score": 80.0, "trade_score": 0.5, "avg_sentiment": 0.2},
    ]
    assets = {"t1": ["AAA"], "t2": ["BBB"]}
    longs, shorts = rank_trade_candidates(scored, assets, hype_threshold=50.0)
    assert all(c.theme_id != "t1" for c in longs + shorts)
    assert len(longs) == 1
    assert longs[0].asset == "BBB"


def test_rank_splits_longs_and_shorts_by_sign():
    """Positive trade_score -> long, negative -> short."""
    scored = [
        {"theme_id": "long1", "hype_score": 75.0, "trade_score": 0.8, "avg_sentiment": 0.4},
        {"theme_id": "long2", "hype_score": 65.0, "trade_score": 0.2, "avg_sentiment": 0.1},
        {"theme_id": "short1", "hype_score": 70.0, "trade_score": -0.6, "avg_sentiment": -0.3},
        {"theme_id": "short2", "hype_score": 60.0, "trade_score": -0.1, "avg_sentiment": -0.05},
    ]
    assets = {t["theme_id"]: [t["theme_id"].upper()] for t in scored}
    longs, shorts = rank_trade_candidates(scored, assets, hype_threshold=50.0)
    assert [c.theme_id for c in longs] == ["long1", "long2"]
    assert [c.theme_id for c in shorts] == ["short1", "short2"]
    assert all(c.direction == "long" for c in longs)
    assert all(c.direction == "short" for c in shorts)


def test_rank_takes_top_n():
    """Should return at most N long themes and N short themes."""
    scored = [
        {"theme_id": f"t{i}", "hype_score": 80.0, "trade_score": 1.0 - i * 0.05, "avg_sentiment": 0.5}
        for i in range(8)
    ]
    assets = {f"t{i}": [f"T{i}"] for i in range(8)}
    longs, shorts = rank_trade_candidates(scored, assets, hype_threshold=50.0, top_n=5)
    assert len(longs) == 5
    assert len(shorts) == 0  # all positive -> no shorts
    assert [c.theme_id for c in longs] == ["t0", "t1", "t2", "t3", "t4"]


def test_rank_expands_theme_to_multiple_assets():
    """Each qualifying theme should yield one candidate per asset."""
    scored = [
        {"theme_id": "t1", "hype_score": 75.0, "trade_score": 0.5, "avg_sentiment": 0.2},
    ]
    assets = {"t1": ["AAA", "BBB", "CCC"]}
    longs, _ = rank_trade_candidates(scored, assets, hype_threshold=50.0)
    assert len(longs) == 3
    assert {c.asset for c in longs} == {"AAA", "BBB", "CCC"}


def test_rank_skips_theme_with_no_assets():
    """Theme with empty asset list should produce no candidates."""
    scored = [
        {"theme_id": "t1", "hype_score": 75.0, "trade_score": 0.5, "avg_sentiment": 0.2},
        {"theme_id": "t2", "hype_score": 75.0, "trade_score": 0.3, "avg_sentiment": 0.2},
    ]
    assets = {"t1": ["AAA"], "t2": []}
    longs, _ = rank_trade_candidates(scored, assets, hype_threshold=50.0)
    assert [c.theme_id for c in longs] == ["t1"]


def test_rank_backfills_thin_side_from_below_threshold():
    """ADR-0029: when every hype-eligible theme shares one direction, the empty
    side is backfilled from the strongest sub-threshold theme of the other sign,
    so the book is two-sided. Reproduces the real "0 long candidates" day where
    China Growth (90) and US Dollar (71.8) were both mildly bearish and every
    positive-signal theme sat below the hype gate."""
    scored = [
        {"theme_id": "china", "hype_score": 90.0, "trade_score": -0.002, "avg_sentiment": -0.004},
        {"theme_id": "usd", "hype_score": 71.8, "trade_score": -0.002, "avg_sentiment": -0.004},
        {"theme_id": "credit", "hype_score": 39.0, "trade_score": 0.040, "avg_sentiment": 0.088},
        {"theme_id": "election", "hype_score": 49.9, "trade_score": 0.039, "avg_sentiment": 0.086},
    ]
    assets = {t["theme_id"]: [t["theme_id"].upper()] for t in scored}
    longs, shorts = rank_trade_candidates(scored, assets, hype_threshold=50.0, top_n=5, min_side=1)
    assert [c.theme_id for c in shorts] == ["china", "usd"]  # from eligible pool
    assert len(longs) == 1                                   # backfilled to min_side
    assert longs[0].theme_id == "credit"                     # strongest positive (0.040 > 0.039)
    assert longs[0].direction == "long"


def test_rank_no_backfill_when_both_sides_populated():
    """Backfill fires only for a thin side; a stronger sub-threshold theme is NOT
    pulled in when the eligible pool already covers that direction."""
    scored = [
        {"theme_id": "long_elig", "hype_score": 80.0, "trade_score": 0.5, "avg_sentiment": 0.3},
        {"theme_id": "short_elig", "hype_score": 70.0, "trade_score": -0.5, "avg_sentiment": -0.3},
        {"theme_id": "long_below", "hype_score": 20.0, "trade_score": 0.9, "avg_sentiment": 0.6},
    ]
    assets = {t["theme_id"]: [t["theme_id"].upper()] for t in scored}
    longs, shorts = rank_trade_candidates(scored, assets, hype_threshold=50.0, top_n=5, min_side=1)
    assert [c.theme_id for c in longs] == ["long_elig"]      # long_below not pulled despite 0.9 > 0.5
    assert [c.theme_id for c in shorts] == ["short_elig"]


def test_rank_side_stays_empty_when_no_opposite_sign_exists():
    """Two-sidedness is guaranteed only when the signal supports it: a side stays
    empty when no theme of that sign exists anywhere. The fix never fabricates."""
    scored = [
        {"theme_id": "s1", "hype_score": 80.0, "trade_score": -0.4, "avg_sentiment": -0.2},
        {"theme_id": "s2", "hype_score": 30.0, "trade_score": -0.9, "avg_sentiment": -0.5},
    ]
    assets = {t["theme_id"]: [t["theme_id"].upper()] for t in scored}
    longs, shorts = rank_trade_candidates(scored, assets, hype_threshold=50.0, min_side=1)
    assert longs == []                                       # no positive theme to backfill
    assert [c.theme_id for c in shorts] == ["s1"]


def test_rank_backfill_respects_min_side():
    """min_side controls how many themes are backfilled onto a thin side."""
    scored = [
        {"theme_id": "short_elig", "hype_score": 70.0, "trade_score": -0.5, "avg_sentiment": -0.3},
        {"theme_id": "l1", "hype_score": 40.0, "trade_score": 0.30, "avg_sentiment": 0.2},
        {"theme_id": "l2", "hype_score": 35.0, "trade_score": 0.20, "avg_sentiment": 0.1},
        {"theme_id": "l3", "hype_score": 30.0, "trade_score": 0.10, "avg_sentiment": 0.05},
    ]
    assets = {t["theme_id"]: [t["theme_id"].upper()] for t in scored}
    longs, _ = rank_trade_candidates(scored, assets, hype_threshold=50.0, top_n=5, min_side=2)
    assert [c.theme_id for c in longs] == ["l1", "l2"]       # top-2 sub-threshold longs


def test_rank_uses_edge_score_when_score_key_given():
    """ADR-0031: direction + intra-side ranking follow score_key. A theme whose
    news sentiment (trade_score) is negative but whose EdgeScore (trend + regime)
    is positive becomes a LONG under score_key='edge_score' — the whole point of
    moving direction off near-zero sentiment."""
    scored = [
        {"theme_id": "t1", "hype_score": 80.0, "trade_score": -0.3, "edge_score": 0.5, "avg_sentiment": -0.2},
        {"theme_id": "t2", "hype_score": 70.0, "trade_score": 0.4, "edge_score": -0.6, "avg_sentiment": 0.3},
    ]
    assets = {"t1": ["AAA"], "t2": ["BBB"]}
    longs, shorts = rank_trade_candidates(scored, assets, hype_threshold=50.0, score_key="edge_score")
    assert [c.theme_id for c in longs] == ["t1"]    # +edge -> long despite -trade_score
    assert [c.theme_id for c in shorts] == ["t2"]   # -edge -> short despite +trade_score
    assert longs[0].edge_score == 0.5               # carried onto the candidate


def test_rank_abstains_on_weak_edge():
    """ADR-0032: |EdgeScore| below abstain_threshold yields NO position, not a
    forced one. A strong-edge theme survives; a flat one is abstained."""
    scored = [
        {"theme_id": "strong", "hype_score": 80.0, "trade_score": 0.0, "edge_score": 0.30, "avg_sentiment": 0.0},
        {"theme_id": "weak", "hype_score": 75.0, "trade_score": 0.0, "edge_score": 0.05, "avg_sentiment": 0.0},
    ]
    assets = {"strong": ["AAA"], "weak": ["BBB"]}
    longs, shorts = rank_trade_candidates(
        scored, assets, hype_threshold=50.0, score_key="edge_score", abstain_threshold=0.15,
    )
    assert [c.theme_id for c in longs] == ["strong"]
    assert all(c.theme_id != "weak" for c in longs + shorts)   # abstained on weak edge


def test_allocate_size_by_conviction_orders_by_conviction():
    """ADR-0032: with caps relaxed, size_by='conviction' weights strictly by
    conviction (|EdgeScore|/vol), not HypeScore."""
    cands = [
        TradeCandidate(theme_id="a", asset="SPY", direction="long", trade_score=0.0,
                       hype_score=90.0, avg_sentiment=0.0, edge_score=0.1, vol=0.02, conviction=1.0),
        TradeCandidate(theme_id="b", asset="TLT", direction="long", trade_score=0.0,
                       hype_score=30.0, avg_sentiment=0.0, edge_score=0.8, vol=0.01, conviction=4.0),
    ]
    sized = allocate_portfolio(cands, 100_000_000.0, size_by="conviction",
                               max_single=1.0, max_sector=1.0, max_geo=1.0)
    w = {c.asset: weight for c, _, weight in sized}
    assert w["TLT"] == pytest.approx(0.8)   # conviction 4 vs 1 despite far lower hype
    assert w["SPY"] == pytest.approx(0.2)


def test_allocate_conviction_falls_back_to_hype_when_no_conviction():
    """No conviction anywhere → conviction sizing reduces to hype weighting."""
    cands = [
        TradeCandidate(theme_id="a", asset="SPY", direction="long", trade_score=0.0,
                       hype_score=80.0, avg_sentiment=0.0, edge_score=0.2, vol=0.0, conviction=0.0),
        TradeCandidate(theme_id="b", asset="TLT", direction="long", trade_score=0.0,
                       hype_score=40.0, avg_sentiment=0.0, edge_score=0.2, vol=0.0, conviction=0.0),
    ]
    by_conv = {c.asset: w for c, _, w in allocate_portfolio(cands, 100_000_000.0, size_by="conviction")}
    by_hype = {c.asset: w for c, _, w in allocate_portfolio(cands, 100_000_000.0, size_by="hype")}
    assert by_conv == by_hype


def test_allocate_redistribution_cannot_push_a_name_past_its_own_cap():
    """An 80:20 hype split, both names capped at 20%.

    This test used to assert TLT $20M / HYG $80M — "A is capped, B absorbs the
    excess" — which put HYG at FOUR TIMES its own 20% limit. The single-name pass
    ran once, so a redistribution recipient was never re-checked. The excess has to
    stop somewhere: it goes to names that can still take it, and when none can, it
    stays in cash rather than being forced into a name whose conviction never
    earned it.

    Sector/geo caps are disabled so this isolates the single-name rule; both names
    are US, so a live 35% geography cap would otherwise bind first.
    """
    c1 = TradeCandidate("t1", "TLT", "long", 0.5, 80.0, 0.3)
    c2 = TradeCandidate("t2", "HYG", "long", 0.3, 20.0, 0.1)
    out = allocate_portfolio([c1, c2], total_capital=100_000_000,
                             max_single=0.20, max_sector=1.0, max_geo=1.0)
    by_cand = {c.asset: (n, w) for c, n, w in out}
    assert by_cand["TLT"][1] == pytest.approx(0.20)
    assert by_cand["HYG"][1] == pytest.approx(0.20)
    assert by_cand["TLT"][0] == pytest.approx(20_000_000)
    assert by_cand["HYG"][0] == pytest.approx(20_000_000)
    # 60% of the capital has nowhere it can legally go, so it is not deployed.
    assert sum(w for _, _, w in out) == pytest.approx(0.40)


def test_allocate_equal_weight_when_all_hype_zero():
    """All hype_scores zero -> fall back to equal weight."""
    c1 = TradeCandidate("t1", "TLT", "long", 0.5, 0.0, 0.0)
    c2 = TradeCandidate("t2", "HYG", "long", 0.3, 0.0, 0.0)
    out = allocate_portfolio([c1, c2], total_capital=100_000_000)
    for _, notional, weight in out:
        assert abs(notional - 50_000_000) < 1e-6
        assert abs(weight - 0.5) < 1e-6


def test_allocate_empty_candidates_returns_empty():
    assert allocate_portfolio([], total_capital=100_000_000) == []


def test_allocate_rejects_zero_capital():
    c1 = TradeCandidate("t1", "TLT", "long", 0.5, 80.0, 0.3)
    try:
        allocate_portfolio([c1], total_capital=0)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for total_capital=0")


def test_to_trade_candidate_row_has_required_keys():
    c = TradeCandidate("t1", "TLT", "long", 0.42, 75.0, 0.15)
    row = c.to_trade_candidate_row("2026-07-21")
    assert row["theme_id"] == "t1"
    assert row["asset"] == "TLT"
    assert row["direction"] == "long"
    assert row["trade_score"] == 0.42
    assert row["hype_score"] == 75.0
    assert "long" in row["entry_thesis"].lower()
    assert "risk_factors" in row
    assert row["timeframe"] == "1-2 weeks"


def test_to_portfolio_position_row_has_required_keys():
    c = TradeCandidate("t1", "TLT", "long", 0.42, 75.0, 0.15)
    row = c.to_portfolio_position_row(notional=12_500_000, weight=0.125)
    assert row["theme_id"] == "t1"
    assert row["asset"] == "TLT"
    assert row["direction"] == "long"
    assert row["notional"] == 12_500_000
    assert row["weight"] == 0.125
    assert row["hype_score"] == 75.0
    assert row["trade_score"] == 0.42


def test_unmapped_ticker_raises():
    """Unmapped tickers must raise — no silent fallback."""
    with pytest.raises(KeyError):
        classify("ZZZZ")


def test_taxonomy_maps_are_co_extensive():
    """The three taxonomy maps must have identical keys.

    classify() and the hard-indexing sites in allocate_portfolio /
    compute_book_metrics require a ticker to be in all three maps. When they
    drift apart, classify() raises for a ticker that looks mapped — and it did:
    the credit-lens ETFs (JNK, BKLN, ANGL, EMB, BIL) were in the asset-class map
    but not sector/geo, so the flagship credit lens aborted the daily run. This
    test fails at build time instead, the moment a ticker is added to one map
    and not the others.
    """
    from backend.services.trade_ranker import _ASSET_CLASS_MAP
    from backend.services.book_metrics import SECTOR_MAP, GEO_MAP

    sector, geo, cls = set(SECTOR_MAP), set(GEO_MAP), set(_ASSET_CLASS_MAP)
    assert sector == geo == cls, (
        "taxonomy maps disagree — "
        f"class-only: {sorted(cls - (sector & geo))}, "
        f"sector/geo-only: {sorted((sector & geo) - cls)}"
    )


def test_every_mapped_ticker_classifies():
    """Given co-extensive maps, classify() must succeed for every mapped ticker."""
    from backend.services.book_metrics import SECTOR_MAP

    for ticker in SECTOR_MAP:
        result = classify(ticker)
        assert result["ticker"] == ticker
        assert result["sector"] and result["geo"] and result["asset_class"]


def test_is_classified_matches_classify():
    from backend.services.trade_ranker import is_classified

    assert is_classified("HYG") is True
    assert is_classified("ZZZZ") is False


def test_allocate_caps_bind_and_leave_the_rest_in_cash():
    """A book too small to fill inside its caps must be SMALLER, not concentrated.

    Regression for the live 2026-07-24 book: three names, one sector each, sized to
    33.3% apiece against a published 20% single-name limit — six cap violations on a
    page that also rendered the limits as enforced. The caps were computed and then
    undone by a final "normalise so weights sum to 1.0" step, which divided the
    capped 0.60 total straight back up to 1.0.

    Forcing full notional into whatever names happen to clear is exactly what a
    position limit exists to prevent: the fewer the names, the harder the book breaks
    its own limit.
    """
    cands = [
        TradeCandidate(theme_id="geo", asset=a, direction="long", trade_score=0.0,
                       hype_score=59.0, avg_sentiment=0.0, edge_score=0.219,
                       vol=0.023, conviction=9.6)
        for a in ("TLT", "GLD", "EFA")
    ]
    out = allocate_portfolio(cands, 100_000_000.0, size_by="conviction",
                             max_single=0.20)

    weights = [w for _, _, w in out]
    assert all(w <= 0.20 + 1e-9 for w in weights), "single-name cap must bind"
    assert sum(weights) == pytest.approx(0.60)          # deployed, not 1.0
    assert sum(n for _, n, _ in out) == pytest.approx(60_000_000.0)
    # The undeployed 40% is cash. It must NOT be redistributed into the three names.
    assert all(w == pytest.approx(0.20) for w in weights)


def test_allocate_deploys_nearly_everything_when_the_book_is_diversified():
    """The counterpart: enforcing the caps must not strangle a sensible book.

    Eight names spread across sectors and geographies deploy ~98% — the geography
    cap grazes 35% on US and nothing else binds. Concentrated books SHOULD shrink;
    diversified ones should not, and that asymmetry is the whole point of a limit.
    """
    cands = [
        TradeCandidate(theme_id="t", asset=a, direction="long", trade_score=0.0,
                       hype_score=50.0, avg_sentiment=0.0, edge_score=0.2,
                       vol=0.02, conviction=5.0)
        for a in ("TLT", "GLD", "EFA", "FXI", "UUP", "SPY", "EMB", "UNG")
    ]
    out = allocate_portfolio(cands, 100_000_000.0, size_by="conviction",
                             max_single=0.20)
    assert sum(w for _, _, w in out) > 0.95
    assert max(w for _, _, w in out) <= 0.20 + 1e-9


def test_allocate_group_cap_binds_on_the_GROUP_total_not_the_member():
    """Two credit names at 20% each put the sector at 40% against a 30% cap.

    Neither member individually exceeds 30%, and the old implementation only acted
    on members whose own weight exceeded the group cap — so it capped nothing and
    reported the limit as satisfied. It also skipped any group with fewer than three
    members outright, on the stated reasoning that "the single-name cap is
    sufficient", which 2 x 20% = 40% disproves.
    """
    cands = [
        TradeCandidate(theme_id="t", asset=a, direction="long", trade_score=0.0,
                       hype_score=50.0, avg_sentiment=0.0, edge_score=0.2,
                       vol=0.02, conviction=5.0)
        for a in ("HYG", "LQD", "GLD")
    ]
    out = allocate_portfolio(cands, 100_000_000.0, size_by="conviction",
                             max_single=0.20, max_sector=0.30)
    by = {c.asset: w for c, _, w in out}
    assert by["HYG"] + by["LQD"] == pytest.approx(0.30)   # Credit capped at 30%
    assert by["HYG"] == pytest.approx(by["LQD"])          # relative sizes preserved
    assert by["GLD"] == pytest.approx(0.20)               # untouched, its own sector


def _theme_row(theme_id, edge, hype=60.0):
    return {"theme_id": theme_id, "trade_score": 0.3, "hype_score": hype,
            "avg_sentiment": 0.0, "edge_score": edge, "trend_signal": 0.0,
            "regime_bias": 0.0, "carry_signal": 0.0, "value_signal": 0.0,
            "sentiment_signal": 0.0, "vol": 0.02, "conviction": 5.0}


def _ae(edge, vol=0.02):
    return {"edge_score": edge, "trend_signal": 0.0, "regime_bias": 0.0,
            "carry_signal": 0.0, "value_signal": 0.0, "sentiment_signal": 0.0,
            "vol": vol, "conviction": abs(edge) / vol}


def test_asset_takes_its_own_side_against_its_theme():
    """ADR-0038 — the reason the book could not produce a short.

    Direction used to be a THEME property: `_expand(..., direction="long")` stamped
    every asset in a long theme long. Live on 2026-07-24 that held GLD long inside
    Fed Policy, Inflation, US Dollar and Geopolitical Risk simultaneously, because
    each theme averaged to a positive edge — while GLD's own trend and regime scored
    it -0.44. Four of EdgeScore's five components are natively per-asset or
    per-asset-class, so the theme average was destroying real dispersion.
    """
    scored = [_theme_row("geo", +0.22)]
    asset_edges = {
        ("geo", "TLT"): _ae(+0.15),     # agrees with its theme
        ("geo", "GLD"): _ae(-0.40),     # disagrees, strongly
    }
    longs, shorts = rank_trade_candidates(
        scored, {"geo": ["TLT", "GLD"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges)

    assert [c.asset for c in longs] == ["TLT"]
    assert [c.asset for c in shorts] == ["GLD"]      # a SHORT out of a LONG theme
    assert shorts[0].edge_score == pytest.approx(-0.40)
    # The candidate carries the ASSET's components, not the theme's.
    assert shorts[0].conviction == pytest.approx(0.40 / 0.02)


def test_asset_abstains_on_its_own_edge_not_its_themes():
    """A strong theme does not drag a flat asset into the book."""
    scored = [_theme_row("geo", +0.22)]
    asset_edges = {("geo", "TLT"): _ae(+0.30), ("geo", "EFA"): _ae(+0.04)}
    longs, shorts = rank_trade_candidates(
        scored, {"geo": ["TLT", "EFA"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges)
    assert [c.asset for c in longs] == ["TLT"]       # EFA held out on its own |edge|
    assert shorts == []


def test_same_ticker_in_two_themes_is_deduped_to_its_strongest_view():
    """GLD expresses four themes. It must appear once, at its strongest conviction,
    or the book double-counts a single position."""
    scored = [_theme_row("infl", +0.09), _theme_row("geo", +0.22)]
    asset_edges = {("infl", "GLD"): _ae(-0.30), ("geo", "GLD"): _ae(-0.44)}
    longs, shorts = rank_trade_candidates(
        scored, {"infl": ["GLD"], "geo": ["GLD"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges)
    assert len(shorts) == 1
    assert shorts[0].edge_score == pytest.approx(-0.44)


def test_without_asset_edges_direction_still_comes_from_the_theme():
    """Legacy path unchanged, so existing callers and tests are unaffected."""
    scored = [_theme_row("geo", +0.22)]
    longs, shorts = rank_trade_candidates(
        scored, {"geo": ["TLT", "GLD"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15)
    assert {c.asset for c in longs} == {"TLT", "GLD"}
    assert shorts == []


def test_scope_is_attention_not_theme_edge():
    """ADR-0039 — a theme whose assets DISAGREE must not be gated out.

    Theme-level abstention was a second gate applied to a summary statistic that is
    no longer the decision variable, and it is smallest precisely when
    cross-sectional opportunity is largest. Live on 2026-07-24 the three themes it
    abstained were the three richest in shorts — Inflation was 4-for-4 short-capable
    at a theme edge of +0.086, because that number blends the rates leg's carry with
    the commodity leg's trend and describes no asset that exists.
    """
    scored = [_theme_row("infl", edge=+0.086, hype=70.0)]   # would abstain on |edge|
    asset_edges = {
        ("infl", "GLD"): _ae(-0.38),
        ("infl", "SLV"): _ae(-0.43),
        ("infl", "IAU"): _ae(-0.38),
    }
    longs, shorts = rank_trade_candidates(
        scored, {"infl": ["GLD", "SLV", "IAU"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges)
    assert longs == []
    assert {c.asset for c in shorts} == {"GLD", "SLV", "IAU"}


def test_attention_gate_still_binds():
    """Scope is attention — a theme below the hype gate stays out of the book, so
    the premise the product rests on is untouched. min_side backfill still applies
    so the book is never empty when signal exists."""
    scored = [
        _theme_row("loud", edge=+0.30, hype=80.0),
        _theme_row("quiet", edge=+0.30, hype=10.0),
    ]
    asset_edges = {("loud", "SPY"): _ae(+0.40), ("quiet", "TLT"): _ae(+0.40)}
    longs, shorts = rank_trade_candidates(
        scored, {"loud": ["SPY"], "quiet": ["TLT"]}, hype_threshold=50.0,
        top_n=5, min_side=1, score_key="edge_score",
        abstain_threshold=0.15, asset_edges=asset_edges)
    assert [c.asset for c in longs] == ["SPY"]      # quiet theme never entered scope
    assert shorts == []


def test_per_asset_abstention_still_applies_inside_a_scoped_theme():
    """Removing the theme gate must not remove abstention — it moves it to the asset."""
    scored = [_theme_row("infl", edge=+0.086, hype=70.0)]
    asset_edges = {("infl", "GLD"): _ae(-0.38), ("infl", "TIP"): _ae(+0.03)}
    longs, shorts = rank_trade_candidates(
        scored, {"infl": ["GLD", "TIP"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges)
    assert [c.asset for c in shorts] == ["GLD"]
    assert longs == []                               # TIP held out on its own |edge|


# ─── Conviction override (ADR-0046) ──────────────────────────────────────────

def test_conviction_override_admits_a_quiet_theme_holding_a_decisive_name():
    """ADR-0046 — the attention gate was deciding TRADABILITY, not just priority.

    Live on 2026-07-24: four of eight themes cleared hype >= 50 and the other four
    were never expanded. China Growth sat at theme edge -0.264 — the most negative
    signal on the board and the only decisively short THEME in the system — and was
    excluded for being 3.3 HypeScore points quiet, while the book's three shorts
    were all taken out of themes whose own edge is POSITIVE.
    """
    scored = [
        _theme_row("loud", edge=+0.20, hype=68.0),
        _theme_row("quiet", edge=-0.26, hype=46.7),   # China Growth's actual numbers
    ]
    asset_edges = {
        ("loud", "SPY"): _ae(+0.22),
        ("quiet", "FXI"): _ae(-0.35),                 # decisive
    }
    longs, shorts = rank_trade_candidates(
        scored, {"loud": ["SPY"], "quiet": ["FXI"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges,
        conviction_override=0.25)
    assert [c.asset for c in longs] == ["SPY"]
    assert [c.asset for c in shorts] == ["FXI"]


def test_conviction_override_is_a_stricter_door_not_a_looser_one():
    """A name that merely clears abstention does NOT drag its quiet theme in.

    This is the difference between widening the universe and lowering a threshold —
    the distinction GOAL.md's operating principles turn on.
    """
    scored = [
        _theme_row("loud", edge=+0.20, hype=68.0),
        _theme_row("quiet", edge=-0.10, hype=30.0),
    ]
    asset_edges = {
        ("loud", "SPY"): _ae(+0.22),
        ("quiet", "FXI"): _ae(-0.18),   # above abstain (0.15), below override (0.25)
    }
    longs, shorts = rank_trade_candidates(
        scored, {"loud": ["SPY"], "quiet": ["FXI"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges,
        conviction_override=0.25)
    assert shorts == []
    assert [c.asset for c in longs] == ["SPY"]


def test_conviction_override_admits_the_theme_not_just_the_decisive_name():
    """One decisive name earns the THEME a look, so its siblings are scored too —
    each still on its own edge. Admitting only the trigger would re-introduce the
    single-asset view ADR-0038 removed."""
    scored = [
        _theme_row("loud", edge=+0.20, hype=68.0),
        _theme_row("quiet", edge=-0.26, hype=46.7),
    ]
    asset_edges = {
        ("loud", "SPY"): _ae(+0.22),
        ("quiet", "FXI"): _ae(-0.35),   # the trigger
        ("quiet", "KWEB"): _ae(-0.19),  # sibling: clears abstention, not the override
        ("quiet", "BABA"): _ae(+0.02),  # sibling: flat, still abstains
    }
    longs, shorts = rank_trade_candidates(
        scored, {"loud": ["SPY"], "quiet": ["FXI", "KWEB", "BABA"]},
        hype_threshold=50.0, score_key="edge_score", abstain_threshold=0.15,
        asset_edges=asset_edges, conviction_override=0.25)
    assert {c.asset for c in shorts} == {"FXI", "KWEB"}
    assert "BABA" not in {c.asset for c in longs + shorts}


def test_conviction_override_marks_which_door_a_candidate_used():
    """'Arrived on attention' and 'arrived on conviction' are different claims and
    must not render identically on /book."""
    scored = [
        _theme_row("loud", edge=+0.20, hype=68.0),
        _theme_row("quiet", edge=-0.26, hype=46.7),
    ]
    asset_edges = {("loud", "SPY"): _ae(+0.22), ("quiet", "FXI"): _ae(-0.35)}
    longs, shorts = rank_trade_candidates(
        scored, {"loud": ["SPY"], "quiet": ["FXI"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges,
        conviction_override=0.25)
    assert longs[0].via_conviction is False
    assert shorts[0].via_conviction is True
    assert shorts[0].to_trade_candidate_row("2026-07-24")["via_conviction"] is True


def test_conviction_override_off_by_default_leaves_scope_untouched():
    """Callers that do not opt in keep pre-ADR-0046 behaviour exactly."""
    scored = [
        _theme_row("loud", edge=+0.20, hype=68.0),
        _theme_row("quiet", edge=-0.26, hype=46.7),
    ]
    asset_edges = {("loud", "SPY"): _ae(+0.22), ("quiet", "FXI"): _ae(-0.90)}
    longs, shorts = rank_trade_candidates(
        scored, {"loud": ["SPY"], "quiet": ["FXI"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges)
    assert shorts == []


def test_conviction_override_never_admits_below_the_abstention_band():
    """A misconfigured override lower than the abstention band must not become a
    back door around abstention — the floor is the stricter of the two."""
    scored = [
        _theme_row("loud", edge=+0.20, hype=68.0),
        _theme_row("quiet", edge=-0.10, hype=30.0),
    ]
    asset_edges = {("loud", "SPY"): _ae(+0.22), ("quiet", "FXI"): _ae(-0.08)}
    longs, shorts = rank_trade_candidates(
        scored, {"loud": ["SPY"], "quiet": ["FXI"]}, hype_threshold=50.0,
        score_key="edge_score", abstain_threshold=0.15, asset_edges=asset_edges,
        conviction_override=0.01)
    assert shorts == []


def test_not_computable_components_survive_to_the_persisted_row():
    """None must reach the row as None, not as 0.0 (ADR-0066).

    `compute_edge_score` renormalises over the components that EXIST, so a row whose
    carry column reads 0.0 when carry was not computable contradicts the score sitting
    beside it. Measured on the live 2026-07-25 book, eight of nine positions satisfied
    `persisted_edge == naive_sum / 0.48` — the score renormalised over
    trend+regime+sentiment while carry and value were written as 0 — which made
    /book's per-position decomposition unreconcilable by construction.
    """
    from backend.services.trade_ranker import TradeCandidate

    c = TradeCandidate(
        theme_id="t", asset="XLE", direction="long",
        trade_score=1.0, hype_score=50.0, avg_sentiment=0.0,
        edge_score=0.4305, trend_signal=0.94, regime_bias=0.06,
        carry_signal=None, value_signal=None, sentiment_signal=0.06,
    )
    d = c._edge_row()
    assert d["carry_signal"] is None
    assert d["value_signal"] is None
    # The computable ones are untouched.
    assert d["trend_signal"] == 0.94
    assert d["edge_score"] == 0.4305


def test_a_fully_computable_candidate_still_carries_numbers():
    from backend.services.trade_ranker import TradeCandidate

    c = TradeCandidate(
        theme_id="t", asset="JPM", direction="long",
        trade_score=1.0, hype_score=50.0, avg_sentiment=0.0,
        edge_score=0.31, trend_signal=0.74, regime_bias=0.06,
        carry_signal=0.12, value_signal=-0.03, sentiment_signal=-0.23,
    )
    d = c._edge_row()
    assert d["carry_signal"] == 0.12
    assert d["value_signal"] == -0.03
