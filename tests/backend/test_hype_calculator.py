import pytest
import sys
sys.path.insert(0, "backend/services")
from hype_calculator import (
    ScoringConfig,
    minmax_norm,
    rescale_vader,
    hype_score,
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
        # All themes have identical raw signals
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        all_counts = [r["mention_count_1d"] for r in raw_signals]
        all_sents = [r["avg_sentiment"] for r in raw_signals]
        all_corrs = [r["price_corr"] for r in raw_signals]
        all_moms = [r["momentum_raw"] for r in raw_signals]

        scores = [
            hype_score(
                r["mention_count_1d"],
                r["avg_sentiment"],
                r["price_corr"],
                r["momentum_raw"],
                all_counts,
                all_sents,
                all_corrs,
                all_moms,
                cfg,
            )
            for r in raw_signals
        ]
        # Each normalized value is 0.5 (identical values), weighted sum = 0.25*0.5*4 = 0.5, times 100 = 50
        for s in scores:
            assert 49.9 < s < 50.1


class TestHypeScoreHighestVolume:
    def test_highest_mention_count_near_one(self):
        """Theme with highest mention_count should have volume score near 1.0."""
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        # Theme B has double the mentions of Theme A
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 20, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        all_counts = [r["mention_count_1d"] for r in raw_signals]
        all_sents = [r["avg_sentiment"] for r in raw_signals]
        all_corrs = [r["price_corr"] for r in raw_signals]
        all_moms = [r["momentum_raw"] for r in raw_signals]

        score_high = hype_score(
            raw_signals[1]["mention_count_1d"],
            raw_signals[1]["avg_sentiment"],
            raw_signals[1]["price_corr"],
            raw_signals[1]["momentum_raw"],
            all_counts,
            all_sents,
            all_corrs,
            all_moms,
            cfg,
        )
        # volume = 1.0 (max), others = 0.5, weighted = 0.25*1 + 0.25*0.5*3 = 0.25 + 0.375 = 0.625, *100 = 62.5
        # But if only volume is different: minmax_norm(20, [10, 20]) = 1.0
        # So weighted: 0.25*1 + 0.25*0.5 + 0.25*0.5 + 0.25*0.5 = 0.25 + 0.125*3 = 0.625, *100 = 62.5
        assert 62.4 < score_high < 62.6


class TestSentimentRescaling:
    def test_positive_sentiment_rescaled_to_one(self):
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        # All identical except sentiment for the tested theme
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": 1.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        all_counts = [r["mention_count_1d"] for r in raw_signals]
        all_sents = [r["avg_sentiment"] for r in raw_signals]
        all_corrs = [r["price_corr"] for r in raw_signals]
        all_moms = [r["momentum_raw"] for r in raw_signals]

        score_pos = hype_score(
            raw_signals[1]["mention_count_1d"],
            raw_signals[1]["avg_sentiment"],
            raw_signals[1]["price_corr"],
            raw_signals[1]["momentum_raw"],
            all_counts,
            all_sents,
            all_corrs,
            all_moms,
            cfg,
        )
        # sent = rescale_vader(1.0) = 1.0; minmax_norm of 1.0 in [0,1] = 1.0
        # weighted: 0.25*0.5 + 0.25*1.0 + 0.25*0.5 + 0.25*0.5 = 0.125 + 0.25 + 0.125 + 0.125 = 0.625, *100 = 62.5
        assert 62.4 < score_pos < 62.6

    def test_negative_sentiment_rescaled_to_zero(self):
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": -1.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        all_counts = [r["mention_count_1d"] for r in raw_signals]
        all_sents = [r["avg_sentiment"] for r in raw_signals]
        all_corrs = [r["price_corr"] for r in raw_signals]
        all_moms = [r["momentum_raw"] for r in raw_signals]

        score_neg = hype_score(
            raw_signals[1]["mention_count_1d"],
            raw_signals[1]["avg_sentiment"],
            raw_signals[1]["price_corr"],
            raw_signals[1]["momentum_raw"],
            all_counts,
            all_sents,
            all_corrs,
            all_moms,
            cfg,
        )
        # sent = rescale_vader(-1.0) = 0.0; minmax_norm of 0.0 in [0,1] = 0.0
        # weighted: 0.25*0.5 + 0.25*0.0 + 0.25*0.5 + 0.25*0.5 = 0.125 + 0 + 0.125 + 0.125 = 0.375, *100 = 37.5
        assert 37.4 < score_neg < 37.6
