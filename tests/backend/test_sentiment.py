# tests/backend/test_sentiment.py
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from tools.sentiment import sentiment_score


def test_negative_sentiment():
    # Note: "crashing" is not in VADER lexicon, using "turmoil" which is recognized
    score = sentiment_score("The Fed raised rates and markets are in turmoil")
    assert score < 0, f"Expected negative score, got {score}"


def test_positive_sentiment():
    score = sentiment_score("Stocks rally on strong earnings and economic optimism")
    assert score > 0, f"Expected positive score, got {score}"


def test_neutral_sentiment():
    score = sentiment_score("Company announces earnings")
    assert -0.3 <= score <= 0.3, f"Expected score between -0.3 and 0.3, got {score}"