# tests/backend/test_trade_generator.py
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.trade_generator import trade_score
from backend.services.hype_calculator import ScoringConfig


def test_same_hype_neutral_sentiment():
    """Same hype + neutral sentiment → trade score = 0."""
    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )
    score = trade_score(hype_today=100.0, hype_yesterday=100.0, sentiment=0.0, cfg=cfg)
    assert score == 0.0, f"Expected 0.0, got {score}"


def test_rising_hype_positive_sentiment():
    """Rising hype + positive sentiment → positive trade score."""
    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )
    score = trade_score(hype_today=150.0, hype_yesterday=100.0, sentiment=0.5, cfg=cfg)
    assert score > 0.0, f"Expected positive score, got {score}"


def test_falling_hype_negative_sentiment():
    """Falling hype + negative sentiment → negative trade score."""
    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )
    score = trade_score(hype_today=50.0, hype_yesterday=100.0, sentiment=-0.5, cfg=cfg)
    assert score < 0.0, f"Expected negative score, got {score}"


# Brief test (Task 22): elapsed-days momentum normalization.
# Same hype diff spread over more days should yield smaller momentum.
# (Brief test as written had hype_today == hype_yesterday which gives zero
# momentum; corrected to use a nonzero diff so the normalization is visible.)
def test_trade_score_treats_missing_yesterday_as_no_momentum():
    """A theme with no usable prior HypeScore has no measurable momentum.

    theme_signals_history rows predating migration 003 carry a NULL hype_score,
    which reaches this function as None. Subtracting from None crashed the L4
    stage of the live pipeline, so None must degrade to zero momentum and let
    the sentiment term stand alone.
    """
    from backend.services.trade_generator import trade_score, _DEFAULT_TRADE_CFG

    got = trade_score(hype_today=50.0, hype_yesterday=None, sentiment=0.4)
    assert got == pytest.approx(_DEFAULT_TRADE_CFG.trade_sentiment_weight * 0.4)


def test_trade_score_missing_sentiment_is_treated_as_neutral():
    from backend.services.trade_generator import trade_score

    got = trade_score(hype_today=50.0, hype_yesterday=None, sentiment=None)
    assert got == pytest.approx(0.0)


def test_trade_score_normalizes_momentum_by_elapsed_days():
    from backend.services.trade_generator import trade_score
    a = trade_score(hype_today=0.6, hype_yesterday=0.5, sentiment=0.0, elapsed_days=1)
    b = trade_score(hype_today=0.6, hype_yesterday=0.5, sentiment=0.0, elapsed_days=5)
    # Same hype diff spread over more days should yield smaller momentum.
    assert abs(a) > abs(b)

