import pytest
import sys
sys.path.insert(0, "backend/services")
from hype_calculator import (
    ScoringConfig,
    minmax_norm,
    rescale_vader,
    hype_score,
    compute_hype_scores,
    crowding_score,
    crowding_label,
    robust_momentum,
    volume_base,
)


class TestRobustMomentum:
    def test_spike_is_positive_and_clipped(self):
        mom, degenerate = robust_momentum(10, [2, 3, 2, 3, 2, 3])
        assert degenerate is False
        assert mom == pytest.approx(4.0)   # large spike clips at +4

    def test_drop_is_negative(self):
        mom, degenerate = robust_momentum(0, [8, 9, 8, 9, 8, 9])
        assert degenerate is False
        assert mom < 0

    def test_ignores_a_single_outlier_in_history(self):
        # A lone 100 in history should NOT distort the read of a normal value.
        # mean/std would report a spurious non-zero; median/MAD reports ~0.
        mom, degenerate = robust_momentum(2, [1, 2, 1, 2, 1, 2, 100])
        assert degenerate is False
        assert abs(mom) < 0.5

    def test_flat_window_is_degenerate(self):
        mom, degenerate = robust_momentum(5, [3, 3, 3, 3, 3, 3])
        assert degenerate is True
        assert mom == 0.0

    def test_empty_history_is_degenerate(self):
        mom, degenerate = robust_momentum(5, [])
        assert degenerate is True
        assert mom == 0.0


class TestCrowding:
    def test_crowding_score_preserves_sign(self):
        assert crowding_score(0.6) == pytest.approx(0.6)
        assert crowding_score(-0.6) == pytest.approx(-0.6)

    def test_crowding_score_clamps_to_unit_interval(self):
        assert crowding_score(1.9) == 1.0
        assert crowding_score(-3.0) == -1.0

    def test_crowding_score_handles_non_numeric(self):
        assert crowding_score(None) == 0.0

    def test_label_crowded_on_strong_positive(self):
        assert crowding_label(0.6) == "crowded"

    def test_label_hedge_on_strong_negative(self):
        assert crowding_label(-0.6) == "hedge"

    def test_label_neutral_on_weak_correlation(self):
        assert crowding_label(0.2) == "neutral"

    def test_label_neutral_when_attention_is_low(self):
        # Strong correlation but low volume → not really crowded.
        assert crowding_label(0.9, volume_norm=0.3) == "neutral"

    def test_label_crowded_when_attention_is_high(self):
        assert crowding_label(0.9, volume_norm=0.8) == "crowded"


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
            # ADR-0028: corr is now min-max'd like volume/momentum, so identical
            # signals put ALL four sub-scores at their 0.5 neutral → 0.25*4*0.5 =
            # 0.5 → 50. (The old raw-abs corr gave 0 here, so the test name
            # "score_50" disagreed with its own 37.5 assertion.)
            assert 49.9 < s["hype_score"] < 50.1


class TestVolumeBase:
    """ADR-0035: Volume magnitude = the trailing 7-day average mentions, not the
    frequently-zero 1-day count."""

    def test_prefers_7d_average_when_present(self):
        r = {"mention_count_1d": 0, "mention_count_7d_avg": 5.57}
        assert volume_base(r) == pytest.approx(5.57)

    def test_falls_back_to_1d_when_average_missing(self):
        r = {"mention_count_1d": 7}
        assert volume_base(r) == 7.0

    def test_falls_back_to_1d_when_average_is_none(self):
        r = {"mention_count_1d": 3, "mention_count_7d_avg": None}
        assert volume_base(r) == 3.0

    def test_all_zero_1d_counts_still_spread_by_7d_average(self):
        """The exact production degeneracy: every theme's 1-day count is 0 on a
        run that collected no same-day article, but their 7-day averages differ.
        Volume must carry real cross-theme spread, not collapse to a flat 0.5."""
        cfg = ScoringConfig(1.0, 0.0, 0.0, 0.0, 0.0, 0.0)  # 100% volume weight
        raw = [
            {"mention_count_1d": 0, "mention_count_7d_avg": 0.4, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 0, "mention_count_7d_avg": 5.6, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 0, "mention_count_7d_avg": 1.0, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        scored = compute_hype_scores(raw, cfg)
        vols = [s["hype_score"] for s in scored]
        # Loudest (5.6/day) scores well above quietest (0.4/day), and the three are
        # genuinely spread — NOT the flat 50 the old 1-day path produced.
        assert vols[1] > vols[2] > vols[0]
        assert len(set(round(v, 2) for v in vols)) == 3
        # ADR-0042: absolute, so these are levels rather than ranks — 5.6/day is a
        # busy theme and 0.4/day is a quiet one, on any day, against any peer group.
        assert vols[1] > 80
        assert vols[0] < 25


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
        assert scored[1]["hype_score"] > scored[0]["hype_score"]


class TestSentimentRescaling:
    def test_positive_sentiment_rescaled_to_one(self):
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": 1.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        scored = compute_hype_scores(raw_signals, cfg)
        score_pos = scored[1]["hype_score"]
        # Theme B: volume=0.5, sent=1.0, corr=0.5 (ADR-0028), momentum=0.5
        # weighted: 0.25*0.5 + 0.25*1.0 + 0.25*0.5 + 0.25*0.5 = 0.625, *100 = 62.5
        assert 62.4 < score_pos < 62.6

    def test_negative_sentiment_rescaled_to_zero(self):
        cfg = ScoringConfig(0.25, 0.25, 0.25, 0.25, 0.0, 0.0)
        raw_signals = [
            {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.0, "momentum_raw": 0.0},
            {"mention_count_1d": 10, "avg_sentiment": -1.0, "price_corr": 0.0, "momentum_raw": 0.0},
        ]
        scored = compute_hype_scores(raw_signals, cfg)
        score_neg = scored[1]["hype_score"]
        # Theme B: volume=0.5, sent=0.0, corr=0.5 (ADR-0028), momentum=0.5
        # weighted: 0.25*0.5 + 0.25*0.0 + 0.25*0.5 + 0.25*0.5 = 0.375, *100 = 37.5
        assert 37.4 < score_neg < 37.6


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


def test_corr_uses_an_absolute_anchor_and_keeps_the_abs_fold():
    """ADR-0042 supersedes ADR-0028's min-max for |corr|.

    ADR-0028 min-maxed |corr| because a raw 0.1-0.4 under-delivered against a 30%
    weight. That was a CALIBRATION complaint and min-max was the wrong remedy — it
    fixed the scale by making the reading RELATIVE, so a theme's correlation score
    moved when other themes' correlations moved. Dividing by a documented
    full-credit level (CORR_FULL = 0.50) fixes the calibration and keeps the number
    comparable over time. The abs fold survives: attention is direction-agnostic.
    """
    cfg = ScoringConfig(0.0, 0.0, 1.0, 0.0, 0.0, 0.0)  # 100% corr weight, isolate it
    raw_signals = [
        {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": 0.1, "momentum_raw": 0.0},
        {"mention_count_1d": 10, "avg_sentiment": 0.0, "price_corr": -0.5, "momentum_raw": 0.0},
    ]
    scored = compute_hype_scores(raw_signals, cfg)
    assert scored[0]["hype_score"] == pytest.approx(20.0)    # 0.1/0.5
    assert scored[1]["hype_score"] == pytest.approx(100.0)   # |-0.5|/0.5, saturated


def test_a_themes_score_does_not_move_when_only_its_PEERS_move():
    """The property min-max could never have. This is what Q2's "risk monitoring"
    needs: a theme's attention reading must be a statement about that theme.

    Measured on production data before this change — China Growth's 7-day mention
    count was byte-identical across 2026-07-23 and 07-24 (1.14286) and its HypeScore
    still fell 60.6 -> 36.6; Corporate Credit's was identical (0.857143) and fell
    45.7 -> 34.2. Both moved because OTHER themes moved.
    """
    cfg = ScoringConfig(0.30, 0.20, 0.30, 0.20, 0.0, 0.0)
    subject = {"mention_count_1d": 0, "mention_count_7d_avg": 1.14,
               "avg_sentiment": -0.01, "price_corr": 0.30, "momentum_raw": 2.0}
    quiet_peers = [{"mention_count_1d": 0, "mention_count_7d_avg": 0.5,
                    "avg_sentiment": 0.0, "price_corr": 0.05, "momentum_raw": 0.0}]
    loud_peers = [{"mention_count_1d": 0, "mention_count_7d_avg": 40.0,
                   "avg_sentiment": 0.9, "price_corr": 0.95, "momentum_raw": 4.0}]

    with_quiet = compute_hype_scores([subject] + quiet_peers, cfg)[0]["hype_score"]
    with_loud = compute_hype_scores([subject] + loud_peers, cfg)[0]["hype_score"]
    assert with_quiet == pytest.approx(with_loud)


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
