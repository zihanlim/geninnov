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


def test_persisted_subscores_reproduce_the_persisted_hype_score():
    """The four sub-scores shown on / and in the derivation drawer must recompose
    to the HypeScore stored beside them.

    This invariant lived only in a comment in daily_refresh.persist(), and ADR-0042
    broke it: compute_hype_scores moved to absolute sub-scores while persist() still
    wrote min-maxed ones, so the heatmap showed VOL 0 for a theme whose HypeScore
    was 35 and nothing could reconcile the two.
    """
    from backend.services.hype_calculator import (
        volume_subscore, corr_subscore, momentum_subscore, rescale_vader, volume_base,
    )
    cfg = ScoringConfig(0.30, 0.20, 0.30, 0.20, 0.0, 0.0)
    raw = [
        {"mention_count_1d": 0, "mention_count_7d_avg": 5.29,
         "avg_sentiment": 0.04, "price_corr": 0.42, "momentum_raw": 1.1},
        {"mention_count_1d": 0, "mention_count_7d_avg": 0.43,
         "avg_sentiment": -0.02, "price_corr": -0.31, "momentum_raw": -0.6},
    ]
    for scored_row, r in zip(compute_hype_scores(raw, cfg), raw):
        # Recompose exactly the way persist() stores them.
        recomposed = 100 * (
            cfg.hype_volume_weight * volume_subscore(volume_base(r))
            + cfg.hype_sentiment_weight * rescale_vader(r["avg_sentiment"])
            + cfg.hype_corr_weight * corr_subscore(r["price_corr"])
            + cfg.hype_momentum_weight * momentum_subscore(r["momentum_raw"])
        )
        assert scored_row["hype_score"] == pytest.approx(recomposed)


# ─── Cross-asset correlation (ADR-0127) ──────────────────────────────────────

class TestCrossAssetCorrelation:
    """A theme is a narrative driving CROSS-ASSET moves. Before ADR-0127 the
    correlation term read one instrument — whichever ticker came back first — so
    a theme moving four asset classes together and a theme tracking a single ETF
    were indistinguishable."""

    CLASSES = {
        "TLT": "rates", "IEF": "rates", "SHY": "rates",
        "GLD": "commodity", "SLV": "commodity",
        "UUP": "fx",
        "SPY": "equity",
    }

    def test_unmeasurable_tickers_are_dropped_not_counted_as_zero(self):
        from backend.services.hype_calculator import per_class_corr
        per_class = per_class_corr(
            {"TLT": None, "GLD": 0.6, "UUP": None}, self.CLASSES
        )
        assert per_class == {"commodity": 0.6}

    def test_unclassified_tickers_cannot_contribute_to_a_breadth_claim(self):
        from backend.services.hype_calculator import per_class_corr
        per_class = per_class_corr({"GLD": 0.6, "WHAT": 0.9}, self.CLASSES)
        assert per_class == {"commodity": 0.6}

    def test_strongest_reading_wins_within_a_class_with_its_sign(self):
        from backend.services.hype_calculator import per_class_corr
        per_class = per_class_corr(
            {"TLT": 0.2, "IEF": -0.55, "SHY": 0.1}, self.CLASSES
        )
        assert per_class == {"rates": -0.55}

    def test_breadth_beats_depth_a_theme_moving_four_classes_scores_higher(self):
        """The whole point. Both themes have a 0.50 strongest correlation; one
        moves its entire complex and the other moves one leg of it."""
        from backend.services.hype_calculator import cross_asset_corr_subscore
        broad = cross_asset_corr_subscore(
            {"rates": 0.5, "commodity": 0.5, "fx": -0.5, "equity": 0.5}
        )
        narrow = cross_asset_corr_subscore(
            {"rates": 0.5, "commodity": 0.02, "fx": 0.01, "equity": 0.0}
        )
        assert broad == pytest.approx(1.0)
        assert narrow < 0.3
        assert broad > narrow

    def test_the_old_single_ticker_reading_could_not_tell_these_apart(self):
        """Regression, stated as the defect: representative_corr — the one-number
        summary that replaces the old `price_corr` — is IDENTICAL for both books
        above. Only the sub-score separates them, which is why the sub-score is
        what HypeScore consumes."""
        from backend.services.hype_calculator import (
            representative_corr, cross_asset_corr_subscore,
        )
        broad = {"rates": 0.5, "commodity": 0.5, "fx": -0.5, "equity": 0.5}
        narrow = {"rates": 0.5, "commodity": 0.02, "fx": 0.01, "equity": 0.0}
        assert representative_corr(broad) == representative_corr(narrow) == 0.5
        assert cross_asset_corr_subscore(broad) != cross_asset_corr_subscore(narrow)

    def test_the_denominator_counts_measured_classes_not_mapped_ones(self):
        """A class we could not measure must not depress the score — the same
        renormalise-over-what-is-present rule ADR-0036 applies to EdgeScore."""
        from backend.services.hype_calculator import per_class_corr, cross_asset_corr_subscore
        # rates and fx unmeasurable; commodity saturated.
        measured = per_class_corr({"TLT": None, "UUP": None, "GLD": 0.5}, self.CLASSES)
        assert cross_asset_corr_subscore(measured) == pytest.approx(1.0)

    def test_nothing_measurable_is_none_not_zero(self):
        from backend.services.hype_calculator import per_class_corr, cross_asset_corr_subscore
        assert cross_asset_corr_subscore(per_class_corr({"TLT": None}, self.CLASSES)) is None
        assert cross_asset_corr_subscore({}) is None

    def test_representative_corr_keeps_the_sign_crowding_depends_on(self):
        from backend.services.hype_calculator import representative_corr, crowding_label
        per_class = {"rates": 0.2, "equity": -0.8}
        rep = representative_corr(per_class)
        assert rep == -0.8
        # An inverse mover is a natural HEDGE, not a crowded consensus. A breadth
        # average would have folded the sign away and reported "neutral".
        assert crowding_label(rep, volume_norm=0.9) == "hedge"

    def test_breadth_counts_are_reported_as_n_of_m(self):
        from backend.services.hype_calculator import corr_breadth
        assert corr_breadth({"rates": 0.5, "commodity": 0.3, "fx": 0.05, "equity": 0.0}) == (2, 4)
        assert corr_breadth({}) == (0, 0)


class TestHypeScoreWithUnmeasurableCorrelation:
    def test_an_unmeasurable_correlation_renormalises_instead_of_scoring_zero(self):
        """With hype_corr_weight = 0.30, scoring an unmeasured correlation as 0
        silently deducts up to 30 points for a gap in our data, and the theme
        reads as quiet when it was never measured."""
        cfg = ScoringConfig(0.30, 0.20, 0.30, 0.20, 0.0, 0.0)
        as_zero = hype_score(volume=0.8, sentiment=0.0, corr=0.0, momentum=0.6, cfg=cfg)
        unmeasured = hype_score(volume=0.8, sentiment=0.0, corr=None, momentum=0.6, cfg=cfg)
        assert unmeasured > as_zero
        # Renormalised over the three present components (0.30 + 0.20 + 0.20).
        expected = 100 * (0.30 * 0.8 + 0.20 * 0.5 + 0.20 * 0.6) / 0.70
        assert unmeasured == pytest.approx(expected)

    def test_all_four_present_is_arithmetically_unchanged(self):
        """/method reproduces HypeScore as `100 x sum(w_i . s_i)` from the
        persisted sub-scores. That reconciliation must stay byte-exact."""
        cfg = ScoringConfig(0.30, 0.20, 0.30, 0.20, 0.0, 0.0)
        got = hype_score(volume=0.8, sentiment=0.4, corr=0.55, momentum=0.6, cfg=cfg)
        expected = 100 * (0.30 * 0.8 + 0.20 * rescale_vader(0.4) + 0.30 * 0.55 + 0.20 * 0.6)
        assert got == pytest.approx(expected)


class TestThemeCorrSubscoreRouting:
    def test_prefers_the_cross_asset_reading_over_the_legacy_scalar(self):
        from backend.services.hype_calculator import theme_corr_subscore
        row = {"price_corr": 0.5, "corr_by_class": {"rates": 0.5, "fx": 0.02}}
        # The legacy scalar would say min(1, 0.5/0.5) = 1.0; the cross-asset
        # reading says the fx leg did not participate.
        assert theme_corr_subscore(row) < 0.6

    def test_falls_back_to_the_legacy_scalar_for_pre_adr0123_rows(self):
        from backend.services.hype_calculator import theme_corr_subscore, corr_subscore
        row = {"price_corr": 0.4}
        assert theme_corr_subscore(row) == pytest.approx(corr_subscore(0.4))

    def test_an_empty_measured_map_is_unmeasured_not_zero(self):
        from backend.services.hype_calculator import theme_corr_subscore
        assert theme_corr_subscore({"price_corr": None, "corr_by_class": {}}) is None
