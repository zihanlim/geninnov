import pytest
import sys
sys.path.insert(0, "backend/services")
from hype_calculator import (
    ScoringConfig,
    minmax_norm,
    rescale_vader,
    hype_score,
    compute_hype_scores,
)


class TestMinMaxNorm:
    def test_identical_values_returns_05(self):
        """If all values are identical, minmax_norm returns 0.5."""
        assert minmax_norm(5.0, [5.0, 5.0, 5.0]) == 0.5

    def test_min_value_returns_0(self):
        values = [1.0, 2.0, 3.0]
        assert minmax_norm(1.0, values) == 0.0

    def test_max_value_returns_1(self):
        values = [1.0, 2.0, 3.0]
        assert minmax_norm(3.0, values) == 1.0

    def test_mid_value_returns_mid(self):
        values = [0.0, 100.0]
        result = minmax_norm(50.0, values)
        assert 0.49 < result < 0.51


class TestRescaleVader:
    def test_compound_plus_one_returns_one(self):
        assert rescale_vader(1.0) == 1.0

    def test_compound_minus_one_returns_zero(self):
        assert rescale_vader(-1.0) == 0.0

    def test_compound_zero_returns_point_five(self):
        assert rescale_vader(0.0) == 0.5


class TestScoringConfigFromDbRows:
    def test_parses_all_six_weights(self):
        rows = [
            {"param_name": "hype_volume_weight", "value": "0.20"},
            {"param_name": "hype_sentiment_weight", "value": "0.25"},
            {"param_name": "hype_corr_weight", "value": "0.15"},
            {"param_name": "hype_momentum_weight", "value": "0.20"},
            {"param_name": "trade_hype_weight", "value": "0.10"},
            {"param_name": "trade_sentiment_weight", "value": "0.10"},
        ]
        cfg = ScoringConfig.from_db_rows(rows)
        assert cfg.hype_volume_weight == 0.20
        assert cfg.hype_sentiment_weight == 0.25
        assert cfg.hype_corr_weight == 0.15
        assert cfg.hype_momentum_weight == 0.20
        assert cfg.trade_hype_weight == 0.10
        assert cfg.trade_sentiment_weight == 0.10


class TestHypeScoreIdenticalSignals:
    def test_identical_signals_all_score_50(self):
        """All themes with identical signals should score ~50."""
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        # volume=0.5, sentiment=0.0 -> sent=0.5, corr=0.0 -> corr_abs=0.0, momentum=0.5
        # weighted: 0.25*0.5 + 0.25*0.5 + 0.25*0.0 + 0.25*0.5 = 0.375, *100 = 37.5
        # Use compute_hype_scores to test the full cross-theme path
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        scored = compute_hype_scores(raw_signals, cfg)
        for s in scored:
            # With identical values, volume and momentum normalize to 0.5,
            # sent=0.5, corr_abs=0.0. Weighted: 0.25*0.5 + 0.25*0.5 + 0 + 0.25*0.5 = 0.375
            assert 37.4 < s["hype_score"] < 37.6


class TestHypeScoreHighestVolume:
    def test_highest_mention_count_near_one(self):
        """Theme with highest mention_count should have volume score near 1.0."""
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        # Theme B has double the mentions of Theme A
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 20, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        scored = compute_hype_scores(raw_signals, cfg)
        # Theme A: volume=0, momentum=0.5, sent=0.5, corr=0 -> 0.25*0 + 0.25*0.5 + 0 + 0.25*0.5 = 0.25
        # Theme B: volume=1, momentum=0.5, sent=0.5, corr=0 -> 0.25*1 + 0.25*0.5 + 0 + 0.25*0.5 = 0.5
        # Theme B should score higher than Theme A
        assert scored[1]["hype_score"] > scored[0]["hype_score"]
        assert 49.9 < scored[1]["hype_score"] < 50.1


class TestSentimentRescaling:
    def test_positive_sentiment_rescaled_to_one(self):
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": 1.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        scored = compute_hype_scores(raw_signals, cfg)
        score_pos = scored[1]["hype_score"]
        # Theme B: volume=0.5, sent=1.0, corr=0, momentum=0.5
        # weighted: 0.25*0.5 + 0.25*1.0 + 0 + 0.25*0.5 = 0.5, *100 = 50
        assert 49.9 < score_pos < 50.1

    def test_negative_sentiment_rescaled_to_zero(self):
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": -1.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        scored = compute_hype_scores(raw_signals, cfg)
        score_neg = scored[1]["hype_score"]
        # Theme B: volume=0.5, sent=0.0, corr=0, momentum=0.5
        # weighted: 0.25*0.5 + 0.25*0.0 + 0 + 0.25*0.5 = 0.25, *100 = 25
        assert 24.9 < score_neg < 25.1


# Brief test (Task 22): sign-folded correlation.
# hype_score applies abs() to the corr term in the weighted sum,
# so positive and negative correlations of equal magnitude must produce equal scores.
def test_hype_uses_unsigned_correlation_strength():
    from backend.services.hype_calculator import hype_score
    cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
    # positive correlation with positive returns should score high
    pos = hype_score(volume=1.0, sentiment=0.5, corr=0.9, momentum=0.1, cfg=cfg)
    # negative correlation with positive returns should score the same magnitude (abs)
    neg = hype_score(volume=1.0, sentiment=0.5, corr=-0.9, momentum=0.1, cfg=cfg)
    assert pos == pytest.approx(neg)


# T22 Minor: compute_hype_scores([]) must short-circuit instead of raising
# ValueError on min()/max() of empty sequences during bootstrap.
def test_compute_hype_scores_empty_input_returns_empty():
    cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
    assert compute_hype_scores([], cfg) == []


# T22: trade_score() should normalize momentum by elapsed_days so a 50-point
# drift over 5 days contributes less than a 50-point drift over 1 day.
def test_trade_score_normalizes_momentum_by_elapsed_days():
    from backend.services.trade_generator import trade_score
    same_diff_one_day = trade_score(hype_today=60.0, hype_yesterday=50.0, sentiment=0.0, elapsed_days=1)
    same_diff_five_days = trade_score(hype_today=60.0, hype_yesterday=50.0, sentiment=0.0, elapsed_days=5)
    # Same hype diff spread over more days yields a smaller absolute momentum.
    assert abs(same_diff_one_day) > abs(same_diff_five_days)
    # And specifically the 5-day one should be a 5th of the 1-day one (all else equal).
    assert pytest.approx(abs(same_diff_one_day) / abs(same_diff_five_days), rel=0.01) == 5.0
