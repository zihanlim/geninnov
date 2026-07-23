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


def test_allocate_proportional_to_hype_score():
    """Capital split proportional to each candidate's hype_score.

    80:20 hype ratio → 80:20 notional ratio ($80M : $20M) when cap is disabled.
    With max_single=0.20, A's 80% share exceeds the cap → capped to 20%,
    excess redistributed to B → B absorbs → B=80%/$80M, A=20%/$20M.
    """
    c1 = TradeCandidate("t1", "TLT", "long", 0.5, 80.0, 0.3)
    c2 = TradeCandidate("t2", "HYG", "long", 0.3, 20.0, 0.1)
    out = allocate_portfolio([c1, c2], total_capital=100_000_000,
                             max_single=0.20)
    by_cand = {c.asset: (n, w) for c, n, w in out}
    # A dominated (80% > 20% cap) → capped to 20%, B absorbs excess → B=80%
    assert abs(by_cand["TLT"][0] - 20_000_000) < 1e-6
    assert abs(by_cand["HYG"][0] - 80_000_000) < 1e-6
    assert abs(by_cand["TLT"][1] - 0.2) < 1e-6
    assert abs(by_cand["HYG"][1] - 0.8) < 1e-6


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
