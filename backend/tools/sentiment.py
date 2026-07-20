# backend/tools/sentiment.py
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer

_nltk_downloaded = False

def _ensure_vader():
    global _nltk_downloaded
    if not _nltk_downloaded:
        for resource in ["vader_lexicon", "punkt", "punkt_tab"]:
            try:
                nltk.download(resource, quiet=True)
            except Exception:
                pass
        _nltk_downloaded = True

def sentiment_score(text: str) -> float:
    """Return VADER compound score for a single text."""
    _ensure_vader()
    analyzer = SentimentIntensityAnalyzer()
    return analyzer.polarity_scores(text)["compound"]

def batch_sentiment(texts: list[str]) -> list[float]:
    """Return list of compound scores for a batch of texts."""
    _ensure_vader()
    analyzer = SentimentIntensityAnalyzer()
    return [analyzer.polarity_scores(t)["compound"] for t in texts]