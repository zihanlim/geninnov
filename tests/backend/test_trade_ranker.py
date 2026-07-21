import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.trade_ranker import (
    rank_trade_candidates,
    allocate_portfolio,
    TradeCandidate,
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


def test_allocate_proportional_to_hype_score():
    """Capital split proportional to each candidate's hype_score."""
    c1 = TradeCandidate("t1", "AAA", "long", 0.5, 80.0, 0.3)
    c2 = TradeCandidate("t2", "BBB", "long", 0.3, 20.0, 0.1)
    out = allocate_portfolio([c1, c2], total_capital=100_000_000)
    by_cand = {c: (n, w) for c, n, w in out}
    assert abs(by_cand[c1][0] - 80_000_000) < 1e-6
    assert abs(by_cand[c2][0] - 20_000_000) < 1e-6
    assert abs(by_cand[c1][1] - 0.8) < 1e-6
    assert abs(by_cand[c2][1] - 0.2) < 1e-6


def test_allocate_equal_weight_when_all_hype_zero():
    """All hype_scores zero -> fall back to equal weight."""
    c1 = TradeCandidate("t1", "AAA", "long", 0.5, 0.0, 0.0)
    c2 = TradeCandidate("t2", "BBB", "long", 0.3, 0.0, 0.0)
    out = allocate_portfolio([c1, c2], total_capital=100_000_000)
    for _, notional, weight in out:
        assert abs(notional - 50_000_000) < 1e-6
        assert abs(weight - 0.5) < 1e-6


def test_allocate_empty_candidates_returns_empty():
    assert allocate_portfolio([], total_capital=100_000_000) == []


def test_allocate_rejects_zero_capital():
    c1 = TradeCandidate("t1", "AAA", "long", 0.5, 80.0, 0.3)
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
