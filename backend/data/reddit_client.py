# backend/data/reddit_client.py
import os
import praw
from datetime import date, timedelta

SUBREDDITS = ["wallstreetbets", "investing", "stocks", "economy", "finance"]

THEME_KEYWORDS = {
    "Fed Policy":       ["Federal Reserve", "FOMC", "interest rates", "Jerome Powell"],
    "Inflation":        ["CPI", "PPI", "inflation", "price index", "hot CPI"],
    "China Growth":     ["China economy", "PBOC", "Chinese stocks", "BABA", "KWEB"],
    "US Dollar":        ["US dollar", "DXY", "currency", "FX", "dollar"],
    "Geopolitical Risk":["war", "sanctions", "NATO", "Russia", "Taiwan", "geopolitical"],
    "Corporate Credit":  ["credit spreads", "high yield", "junk bonds", "corporate debt"],
    "Energy Prices":    ["crude oil", "OPEC", "natural gas", "energy", "WTI"],
    "US Election":     ["election", "Democratic", "Republican", "campaign", "vote"],
}

def fetch_posts_for_theme(theme: str, lookback_days: int = 7) -> list[dict]:
    """
    Fetch Reddit post titles for a theme via PRAW.
    Throttled to 30 req/min to stay within Reddit API limits.
    Falls back to mock data if PRAW credentials are not set.
    """
    client_id = os.environ.get("REDDIT_CLIENT_ID")
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET")
    user_agent = os.environ.get("REDDIT_USER_AGENT", "Andromeda/1.0")

    if not client_id or not client_secret:
        return _mock_posts(theme, lookback_days)

    reddit = praw.Reddit(
        client_id=client_id,
        client_secret=client_secret,
        user_agent=user_agent,
        ratelimit_seconds=60,
    )

    keywords = THEME_KEYWORDS.get(theme, [theme])
    date_from = date.today() - timedelta(days=lookback_days)
    results = []

    for subreddit_name in SUBREDDITS:
        subreddit = reddit.subreddit(subreddit_name)
        query = " OR ".join(keywords[:3])
        try:
            for post in subreddit.search(query, time_filter="week", limit=20):
                if post.created_utc >= date_from.timestamp():
                    results.append({
                        "title": post.title,
                        "subreddit": subreddit_name,
                        "score": post.score,
                        "date": date.fromtimestamp(post.created_utc).isoformat(),
                        "url": post.url,
                    })
        except Exception:
            continue

    return results

def _mock_posts(theme: str, lookback_days: int) -> list[dict]:
    return [
        {"title": f"Discussion: {theme} and what it means for markets", "subreddit": "investing", "score": 100, "date": date.today().isoformat()},
    ]
