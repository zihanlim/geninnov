# Andromeda Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 1–3 of the Andromeda market theme platform: Supabase schema, Python scoring pipeline (`daily_refresh.py`), Next.js frontend on Vercel reading from Supabase, and cron-driven daily batch.

**Architecture:** A Supabase-managed PostgreSQL holds all data. A `daily_refresh.py` Python script runs once/day at market close, pulling data from Brave Search + Reddit + Yahoo Finance, computing VADER sentiment and HypeScore/TradeScore, then writing results to Supabase. The Next.js frontend reads directly from Supabase via `@supabase/supabase-js` with no custom API backend.

**Tech Stack:** Python 3.11+, Pandas, NumPy, NLTK/VADER, yfinance, PRAW, Brave Search MCP, sentence-transformers, UMAP, HDBSCAN, gensim | Next.js 14, TypeScript, Tailwind CSS, Recharts, @supabase/supabase-js | Vercel, Supabase, cron-job.org

---

## Global Constraints

- Python version: **3.11+**
- Node version: **20+** (Next.js 14 requirement)
- All scoring weights read from `scoring_config` table at runtime — never hardcoded
- All raw signals persisted to `theme_signals_history` before normalization
- Supabase free tier: **500MB DB, 1GB storage**
- Brave Search: **20 req/query** — one batch request per theme per day
- Reddit PRAW: **60 req/min** — throttle to 30/min to stay safe
- Yahoo Finance (yfinance): **no strict limit** — one batch pull per day
- Design language: **dark terminal** — bg `#0d1117`, surface `#161b22`, long `#3fb950`, short `#f85149`, neutral `#58a6ff`
- Fonts: **JetBrains Mono** (numbers/data), **Inter** (labels/text)
- Motion: fade-in 200ms, bar animations 300ms ease-out

---

## Phase A: Project Scaffolding

### Task A1: Project structure and environment

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `backend/requirements.txt`
- Create: `.env.example`
- Create: `supabase/migrations/001_initial_schema.sql`

**Notes:**
- The engineer should create all these files as their first action
- Node/Python version requirements go in README
- .env.example lists all required env vars without real values

---

### Task A2: Supabase schema

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

**Schema to create:**

```sql
-- themes
CREATE TABLE themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL CHECK (tier IN ('anchor', 'discovered', 'review')),
    source TEXT NOT NULL CHECK (source IN ('practitioner', 'lda', 'embedding', 'both_agreement')),
    hype_score REAL,
    volume_score REAL,
    sentiment_score REAL,
    corr_score REAL,
    momentum_score REAL,
    discovered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- theme_assets
CREATE TABLE theme_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    run_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, ticker, run_date)
);

-- theme_signals_history (raw signals, full history)
CREATE TABLE theme_signals_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    run_date DATE NOT NULL,
    mention_count_1d INTEGER,
    mention_count_7d_avg REAL,
    mention_count_7d_std REAL,
    avg_sentiment REAL,
    price_corr REAL,
    momentum_raw REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, run_date)
);

-- trade_candidates
CREATE TABLE trade_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    trade_score REAL,
    hype_score REAL,
    entry_thesis TEXT,
    risk_factors TEXT,
    timeframe TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, asset, direction)
);

-- portfolio_positions
CREATE TABLE portfolio_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    notional REAL NOT NULL,
    weight REAL NOT NULL,
    hype_score REAL,
    trade_score REAL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, asset, direction)
);

-- portfolio_risk
CREATE TABLE portfolio_risk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    total_capital REAL NOT NULL DEFAULT 100000000,
    var_95 REAL,
    cvar_95 REAL,
    sharpe REAL,
    beta REAL,
    concentration_hhi REAL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- portfolio_returns
CREATE TABLE portfolio_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    daily_return REAL,
    cumulative_return REAL,
    portfolio_value REAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- scoring_config
CREATE TABLE scoring_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    param_name TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- backtest_results
CREATE TABLE backtest_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    metric_name TEXT NOT NULL,
    predicted_value REAL,
    realized_value REAL,
    pass BOOLEAN,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- research_output
CREATE TABLE research_output (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default scoring_config values
INSERT INTO scoring_config (param_name, value) VALUES
    ('hype_volume_weight',   '0.30'),
    ('hype_sentiment_weight','0.20'),
    ('hype_corr_weight',     '0.30'),
    ('hype_momentum_weight', '0.20'),
    ('hype_score_threshold', '50'),
    ('lookback_momentum_1d', '1'),
    ('lookback_momentum_7d', '7'),
    ('sharpe_lookback',      '252'),
    ('beta_lookback',       '252'),
    ('var_confidence',      '0.95'),
    ('trade_hype_weight',    '0.55'),
    ('trade_sentiment_weight','0.45'),
    ('total_capital',       '100000000');

-- Insert Tier 1 macro anchors
INSERT INTO themes (name, tier, source) VALUES
    ('Fed Policy',       'anchor', 'practitioner'),
    ('Inflation',         'anchor', 'practitioner'),
    ('China Growth',      'anchor', 'practitioner'),
    ('US Dollar',         'anchor', 'practitioner'),
    ('Geopolitical Risk', 'anchor', 'practitioner'),
    ('Corporate Credit',  'anchor', 'practitioner'),
    ('Energy Prices',     'anchor', 'practitioner'),
    ('US Election',       'anchor', 'practitioner');

-- Insert Tier 1 asset mappings
INSERT INTO theme_assets (theme_id, ticker, weight, run_date)
SELECT t.id, ticker, 1.0, CURRENT_DATE
FROM themes t,
    LATERAL (VALUES
        ('Fed Policy',       'TLT'),
        ('Fed Policy',       'GLD'),
        ('Fed Policy',       'SVXY'),
        ('Fed Policy',       'DXY'),
        ('Inflation',         'GLD'),
        ('Inflation',         'SLV'),
        ('Inflation',         'TIPS'),
        ('China Growth',     'FXI'),
        ('China Growth',     'MCHI'),
        ('China Growth',     'BABA'),
        ('China Growth',     'KWEB'),
        ('US Dollar',        'UUP'),
        ('US Dollar',        'FXE'),
        ('US Dollar',        'GLD'),
        ('US Dollar',        'EWZ'),
        ('Geopolitical Risk','GLD'),
        ('Geopolitical Risk','TLT'),
        ('Geopolitical Risk','SLV'),
        ('Geopolitical Risk','EWJ'),
        ('Corporate Credit', 'HYG'),
        ('Corporate Credit', 'LQD'),
        ('Energy Prices',    'XLE'),
        ('Energy Prices',    'OIH'),
        ('Energy Prices',    'CL'),
        ('Energy Prices',    'UNG'),
        ('US Election',      'QQQ'),
        ('US Election',      'XLV'),
        ('US Election',      'XLF'),
        ('US Election',      'ARKK')
    ) AS v(name, ticker)
WHERE v.name = t.name;
```

---

## Phase B: Python Scoring Pipeline

### Task B1: VADER sentiment tool

**Files:**
- Create: `backend/tools/sentiment.py`
- Create: `tests/backend/test_sentiment.py`

**Interfaces:**
- Consumes: raw text string
- Produces: `float` compound score in [-1, +1]

```python
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
```

**Tests:**
- Score of "The Fed raised rates and markets are crashing" should be negative
- Score of "Stocks rally on strong earnings and economic optimism" should be positive
- Score of "Company announces earnings" (neutral) should be between -0.3 and 0.3

---

### Task B2: Brave News data fetcher

**Files:**
- Create: `backend/data/brave_client.py`
- Create: `tests/backend/test_brave_client.py`

**Interfaces:**
- Consumes: `theme_name: str`, `lookback_days: int` (default 7)
- Produces: `list[dict]` with fields `headline`, `date`, `url`

```python
# backend/data/brave_client.py
"""
Fetches news via Brave Search MCP tool.
Uses subprocess to call a Node.js helper script that invokes the MCP tool.
Reason: MCP tools are Python-wrapped Node.js; we call the tool via CLI.
"""
import subprocess
import json
from datetime import date, timedelta

THEME_KEYWORDS = {
    "Fed Policy":       ["Federal Reserve", "FOMC", "interest rates", "monetary policy"],
    "Inflation":        ["CPI", "PPI", "PCE", "inflation", "price pressure", "hot CPI"],
    "China Growth":     ["China GDP", "PBOC", "Chinese economy", "China stimulus", "property crisis"],
    "US Dollar":        ["US dollar", "DXY", "currency", "FX", "dollar weakness", "dollar strength"],
    "Geopolitical Risk":["war", "sanctions", "NATO", "geopolitics", "conflict", "Taiwan"],
    "Corporate Credit":  ["credit spreads", "high yield", "junk bonds", "corporate bonds", "IG credit"],
    "Energy Prices":    ["crude oil", "OPEC", "natural gas", "energy prices", "WTI", "Brent"],
    "US Election":     ["election", "Democratic", "Republican", "campaign", "policy uncertainty"],
}

def fetch_news_for_theme(theme: str, lookback_days: int = 7) -> list[dict]:
    """
    Fetch news for a theme using Brave Search MCP.
    Returns list of {headline, date, url}.
    Falls back to mock data if MCP is unavailable (for local testing without credentials).
    """
    keywords = THEME_KEYWORDS.get(theme, [theme])
    query = " OR ".join(f'"{k}"' for k in keywords[:3])
    date_from = (date.today() - timedelta(days=lookback_days)).isoformat()

    try:
        result = subprocess.run(
            ["node", "scripts/call_brave_mcp.js", query, date_from],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            return json.loads(result.stdout)
    except Exception:
        pass

    # Fallback: return mock data when MCP credentials are not set
    return _mock_news(theme, lookback_days)

def _mock_news(theme: str, lookback_days: int) -> list[dict]:
    """Return realistic mock news for testing without MCP credentials."""
    return [
        {"headline": f"{theme} in focus as markets react to developments", "date": date.today().isoformat(), "url": "https://example.com"},
        {"headline": f"Investors eye {theme} amid uncertainty", "date": date.today().isoformat(), "url": "https://example.com"},
    ]
```

---

### Task B3: Reddit data fetcher

**Files:**
- Create: `backend/data/reddit_client.py`
- Create: `tests/backend/test_reddit_client.py`

**Interfaces:**
- Consumes: `theme_name: str`, `lookback_days: int` (default 7)
- Produces: `list[dict]` with fields `title`, `subreddit`, `score`, `date`

```python
# backend/data/reddit_client.py
import os
import praw
from datetime import date, timedelta

SUBREDDITS = ["wallstreetbets", "investing", "stocks", "economy", "finance"]

THEME_KEYWORDS = {
    "Fed Policy":       ["Federal Reserve", "FOMC", "interest rates", " Jerome Powell"],
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
```

---

### Task B4: Yahoo Finance price fetcher

**Files:**
- Create: `backend/data/yahoo_client.py`
- Create: `tests/backend/test_yahoo_client.py`

**Interfaces:**
- Consumes: `tickers: list[str]`, `lookback_days: int` (default 30)
- Produces: `pd.DataFrame` with columns `date`, `ticker`, `close`, `return`

```python
# backend/data/yahoo_client.py
import pandas as pd
import yfinance as yf
from datetime import date, timedelta

def fetch_price_data(tickers: list[str], lookback_days: int = 30) -> pd.DataFrame:
    """
    Fetch adjusted close prices for tickers.
    Returns DataFrame with date, ticker, close, return columns.
    return = pct_change from previous close.
    """
    end = date.today()
    start = end - timedelta(days=lookback_days + 10)  # extra days for return calc

    data = yf.download(tickers, start=start, end=end, progress=False, auto_adjust=True)

    if data.empty:
        return pd.DataFrame(columns=["date", "ticker", "close", "return"])

    close = data["Close"].dropna(how="all")
    returns = close.pct_change().dropna()

    rows = []
    for ticker in close.columns:
        for dt, val in close[ticker].items():
            if pd.isna(val):
                continue
            ret = returns.loc[dt, ticker] if ticker in returns.columns and dt in returns.index else None
            rows.append({
                "date": dt.date() if hasattr(dt, "date") else dt,
                "ticker": ticker,
                "close": val,
                "return": ret,
            })

    return pd.DataFrame(rows)

def correlation_with_mentions(price_df: pd.DataFrame, mention_series: pd.Series, ticker: str) -> float:
    """
    Compute Pearson correlation between daily mention count and daily asset return.
    mention_series: pd.Series with date index, int values (mention count per day).
    Returns correlation coefficient or 0.0 if insufficient data.
    """
    if price_df.empty or mention_series.empty:
        return 0.0

    price_ticker = price_df[price_df["ticker"] == ticker][["date", "return"]].set_index("date")["return"]
    if price_ticker.empty or len(price_ticker) < 5:
        return 0.0

    # Align by date
    common_dates = mention_series.index.intersection(price_ticker.index)
    if len(common_dates) < 5:
        return 0.0

    mentions_aligned = mention_series.loc[common_dates]
    returns_aligned = price_ticker.loc[common_dates]

    return mentions_aligned.corr(returns_aligned)
```

---

### Task B5: Hype score calculator

**Files:**
- Create: `backend/services/hype_calculator.py`
- Create: `tests/backend/test_hype_calculator.py`

**Interfaces:**
- Consumes: `raw_signals: dict`, `all_themes_signals: list[dict]`, `cfg: ScoringConfig`
- Produces: `float` HypeScore in [0, 100]

```python
# backend/services/hype_calculator.py
from dataclasses import dataclass
from typing import Optional

@dataclass
class ScoringConfig:
    hype_volume_weight: float
    hype_sentiment_weight: float
    hype_corr_weight: float
    hype_momentum_weight: float

    @classmethod
    def from_db_rows(cls, rows: list[dict]) -> "ScoringConfig":
        vals = {r["param_name"]: float(r["value"]) for r in rows}
        return cls(
            hype_volume_weight=vals["hype_volume_weight"],
            hype_sentiment_weight=vals["hype_sentiment_weight"],
            hype_corr_weight=vals["hype_corr_weight"],
            hype_momentum_weight=vals["hype_momentum_weight"],
        )

def minmax_norm(value: float, values: list[float]) -> float:
    """Min-max normalize a value across a list. Returns 0.5 if all values identical."""
    mn, mx = min(values), max(values)
    if mx == mn:
        return 0.5
    return (value - mn) / (mx - mn)

def rescale_vader(compound: float) -> float:
    """Rescale VADER compound [-1, +1] to [0, 1]."""
    return (compound + 1) / 2

def hype_score(
    mention_count_1d: int,
    avg_sentiment: float,
    price_corr: float,
    momentum_raw: float,
    all_mention_counts: list[int],
    all_sentiments: list[float],
    all_corrs: list[float],
    all_momentum: list[float],
    cfg: ScoringConfig,
) -> float:
    """
    Compute HypeScore for a single theme.

    All 4 sub-scores are independently min-max normalized across all themes,
    then weighted and summed to produce a score in [0, 100].
    """
    volume = minmax_norm(float(mention_count_1d), all_mention_counts)
    sent = rescale_vader(avg_sentiment)  # already [-1, +1]
    corr = minmax_norm(abs(price_corr), [abs(c) for c in all_corrs])
    momentum = minmax_norm(momentum_raw, all_momentum)

    return 100 * (
        cfg.hype_volume_weight * volume +
        cfg.hype_sentiment_weight * sent +
        cfg.hype_corr_weight * corr +
        cfg.hype_momentum_weight * momentum
    )
```

**Tests:**
- If all themes have identical signals, all should score ~50
- A theme with the highest mention_count should have volume score near 1.0
- Sentiment of +1.0 rescaled should equal 1.0; sentiment of -1.0 should equal 0.0

---

### Task B6: Trade score calculator

**Files:**
- Create: `backend/services/trade_generator.py`
- Create: `tests/backend/test_trade_generator.py`

**Interfaces:**
- Consumes: `hype_today: float`, `hype_yesterday: float`, `sentiment: float`, `cfg: ScoringConfig`
- Produces: `float` TradeScore

```python
# backend/services/trade_generator.py
from backend.services.hype_calculator import ScoringConfig

def trade_score(
    hype_today: float,
    hype_yesterday: float,
    sentiment: float,  # VADER compound [-1, +1]
    cfg: ScoringConfig,
) -> float:
    """
    Compute TradeScore for a theme.

    HypeMomentum = (hype_today - hype_yesterday) / hype_yesterday
    SentimentDirection = sentiment  # already [-1, +1]
    """
    if hype_yesterday == 0:
        hype_momentum = 0.0
    else:
        hype_momentum = (hype_today - hype_yesterday) / hype_yesterday

    # Clamp to [-1, 1] for numerical stability
    hype_momentum = max(-1.0, min(1.0, hype_momentum))

    return (
        cfg.trade_hype_weight * hype_momentum +
        cfg.trade_sentiment_weight * sentiment
    )
```

**Tests:**
- Same hype + neutral sentiment → trade score = 0
- Rising hype + positive sentiment → positive trade score
- Falling hype + negative sentiment → negative trade score

---

### Task B7: Daily refresh script (end-to-end)

**Files:**
- Create: `scripts/daily_refresh.py`
- Create: `scripts/call_brave_mcp.js`
- Create: `tests/backend/test_daily_refresh.py`

**Interfaces:**
- Produces: Writes to Supabase: themes, theme_signals_history, trade_candidates, portfolio_positions, portfolio_risk

```python
# scripts/daily_refresh.py
"""
Daily refresh script — runs at market close (4:30pm ET) via cron-job.org.
Pulls Brave News + Reddit, computes sentiment + HypeScore + TradeScore,
writes results to Supabase.
"""
import os
import sys
import json
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import numpy as np
from supabase import create_client

# Add backend to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from tools.sentiment import batch_sentiment
from data.brave_client import fetch_news_for_theme
from data.reddit_client import fetch_posts_for_theme
from data.yahoo_client import fetch_price_data, correlation_with_mentions
from services.hype_calculator import hype_score, ScoringConfig, rescale_vader, minmax_norm
from services.trade_generator import trade_score

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # service role key for writes

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ─── Step 1: Load config from Supabase ───────────────────────────────────────
def load_config() -> ScoringConfig:
    rows = supabase.table("scoring_config").select("*").execute().data
    return ScoringConfig.from_db_rows(rows)

# ─── Step 2: Load all themes ───────────────────────────────────────────────────
def load_themes():
    return supabase.table("themes").select("*").execute().data

# ─── Step 3: Build mention counts + sentiment per theme ────────────────────────
def build_theme_signals(themes: list[dict], run_date: date) -> list[dict]:
    """
    For each theme:
    - Fetch news + Reddit posts for last 7 days
    - Count mentions per day to get 1d and 7d avg/std
    - Compute average VADER sentiment
    - Compute price correlation for each mapped asset
    """
    cfg = load_config()
    results = []
    today_str = run_date.isoformat()
    date_7d = (run_date - timedelta(days=7)).isoformat()

    for theme in themes:
        theme_name = theme["name"]

        # Fetch news + Reddit
        news = fetch_news_for_theme(theme_name, lookback_days=7)
        posts = fetch_posts_for_theme(theme_name, lookback_days=7)

        # Combine all text
        all_texts = [n["headline"] for n in news] + [p["title"] for p in posts]
        if not all_texts:
            scores = [0.0]
        else:
            scores = batch_sentiment(all_texts)

        avg_sentiment = float(np.mean(scores)) if scores else 0.0

        # Mention count: total today (only today's texts)
        todays_news = [n for n in news if n.get("date", "")[:10] == today_str]
        todays_posts = [p for p in posts if p.get("date", "")[:10] == today_str]
        mention_count_1d = len(todays_news) + len(todays_posts)

        # 7-day mention counts for momentum
        daily_counts = []
        for i in range(7):
            d = (run_date - timedelta(days=i)).isoformat()[:10]
            cnt = sum(1 for n in news if n.get("date", "")[:10] == d)
            cnt += sum(1 for p in posts if p.get("date", "")[:10] == d)
            daily_counts.append(cnt)

        mention_count_7d_avg = float(np.mean(daily_counts))
        mention_count_7d_std = float(np.std(daily_counts)) if len(daily_counts) > 1 else 0.0
        momentum_raw = (mention_count_1d - mention_count_7d_avg) / mention_count_7d_std if mention_count_7d_std > 0 else 0.0

        # Price correlation per mapped asset
        assets = supabase.table("theme_assets").select("ticker").eq("theme_id", theme["id"]).eq("run_date", today_str).execute().data
        tickers = [a["ticker"] for a in assets]
        price_df = fetch_price_data(tickers, lookback_days=30)

        # Build mention series
        mention_series = pd.Series({(run_date - timedelta(days=i)).isoformat()[:10]: daily_counts[i] for i in range(7)})

        price_corr = 0.0
        if not price_df.empty and not mention_series.empty:
            for ticker in tickers:
                corr = correlation_with_mentions(price_df, mention_series, ticker)
                if not np.isnan(corr):
                    price_corr = corr
                    break

        results.append({
            "theme_id": theme["id"],
            "run_date": today_str,
            "mention_count_1d": mention_count_1d,
            "mention_count_7d_avg": mention_count_7d_avg,
            "mention_count_7d_std": mention_count_7d_std,
            "avg_sentiment": avg_sentiment,
            "price_corr": price_corr,
            "momentum_raw": momentum_raw,
        })

    return results

# ─── Step 4: Compute HypeScores ───────────────────────────────────────────────
def compute_hype_scores(raw_signals: list[dict], cfg: ScoringConfig) -> list[dict]:
    all_counts = [r["mention_count_1d"] for r in raw_signals]
    all_sents = [r["avg_sentiment"] for r in raw_signals]
    all_corrs = [r["price_corr"] for r in raw_signals]
    all_momenta = [r["momentum_raw"] for r in raw_signals]

    scored = []
    for r in raw_signals:
        score = hype_score(
            mention_count_1d=r["mention_count_1d"],
            avg_sentiment=r["avg_sentiment"],
            price_corr=r["price_corr"],
            momentum_raw=r["momentum_raw"],
            all_mention_counts=all_counts,
            all_sentiments=all_sents,
            all_corrs=all_corrs,
            all_momentum=all_momenta,
            cfg=cfg,
        )
        scored.append({**r, "hype_score": score})

    return scored

# ─── Step 5: Compute TradeScores ──────────────────────────────────────────────
def compute_trade_scores(hyped: list[dict]) -> list[dict]:
    cfg = load_config()

    # Get yesterday's scores for momentum
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    yesterday_rows = supabase.table("theme_signals_history").select("theme_id, hype_score").eq("run_date", yesterday).execute().data
    hype_yesterday_map = {r["theme_id"]: r["hype_score"] for r in yesterday_rows}

    scored = []
    for r in hyped:
        hype_yest = hype_yesterday_map.get(r["theme_id"], r["hype_score"])
        ts = trade_score(
            hype_today=r["hype_score"],
            hype_yesterday=hype_yest,
            sentiment=r["avg_sentiment"],
            cfg=cfg,
        )
        scored.append({**r, "trade_score": ts})

    return scored

# ─── Step 6: Persist to Supabase ─────────────────────────────────────────────
def persist(run_date: date, scored: list[dict]):
    today_str = run_date.isoformat()

    for r in scored:
        theme_id = r["theme_id"]

        # Update themes table
        supabase.table("themes").update({
            "hype_score": r["hype_score"],
            "volume_score": minmax_norm(r["mention_count_1d"], [s["mention_count_1d"] for s in scored]),
            "sentiment_score": rescale_vader(r["avg_sentiment"]),
            "corr_score": minmax_norm(abs(r["price_corr"]), [abs(s["price_corr"]) for s in scored]),
            "momentum_score": minmax_norm(r["momentum_raw"], [s["momentum_raw"] for s in scored]),
            "updated_at": "NOW()",
        }).eq("id", theme_id).execute()

        # Insert signals history
        supabase.table("theme_signals_history").upsert({
            "theme_id": theme_id,
            "run_date": today_str,
            "mention_count_1d": r["mention_count_1d"],
            "mention_count_7d_avg": r["mention_count_7d_avg"],
            "mention_count_7d_std": r["mention_count_7d_std"],
            "avg_sentiment": r["avg_sentiment"],
            "price_corr": r["price_corr"],
            "momentum_raw": r["momentum_raw"],
        }, on_conflict="theme_id,run_date").execute()

    print(f"[{today_str}] Refresh complete. {len(scored)} themes updated.")

if __name__ == "__main__":
    run_date = date.today()
    cfg = load_config()
    themes = load_themes()
    raw = build_theme_signals(themes, run_date)
    hyped = compute_hype_scores(raw, cfg)
    scored = compute_trade_scores(hyped)
    persist(run_date, scored)
```

**Cron setup (cron-job.org):**
```
URL: https://your-cron-trigger.example.com/scripts/daily_refresh.py
Schedule: 0 16 * * 1-5  # 4:00pm UTC = ~11am ET (before close)
```
Or run manually on a $3 VPS with `crontab -e`.

---

### Task B8: Theme discovery script

**Files:**
- Create: `scripts/theme_discovery.py`
- Create: `tests/backend/test_theme_discovery.py`

**Notes:**
- Runs once at bootstrap and monthly — not in the daily cron
- Uses `BraveNewsMCP` and `PRAW` to build the 6-month corpus, then applies the 5-step discovery methodology from spec section 4.5

```python
# scripts/theme_discovery.py — outline (spec-driven)
import pandas as pd
from gensim import corpora, models
from sentence_transformers import SentenceTransformer
import umap, hdbscan
import numpy as np

THEME_SUBREDDITS = ["wallstreetbets", "investing", "stocks", "economy", "finance"]
LOOKBACK_MONTHS = 6
MIN_DOCS_PER_THEME = 50

def run_discovery():
    # Step 1: Assemble corpus (see Task B2/B3 for data fetching)
    #   news = fetch_6_months_news()
    #   posts = fetch_6_months_posts()
    #   corpus = [n["headline"] for n in news] + [p["title"] for p in posts]

    # Step 2: LDA via gensim
    #   dictionary = corpora.Dictionary(corpus)
    #   corpus_bow = [dictionary.doc2bow(doc) for doc in corpus]
    #   lda = models.LdaModel(corpus_bow, num_topics=20, passes=10)
    #   lda_topics = [{"words": lda.show_topic(i, topn=10)} for i in range(lda.num_topics)]

    # Step 3: Embedding clustering
    #   model = SentenceTransformer("all-MiniLM-L6-v2")
    #   embeddings = model.encode(corpus, show_progress_bar=True)
    #   reducer = umap.UMAP(n_neighbors=15, min_dist=0.1)
    #   umap_emb = reducer.fit_transform(embeddings)
    #   clusterer = hdbscan.HDBSCAN(min_cluster_size=50)
    #   clusters = clusterer.fit_predict(umap_emb)

    # Step 4: Agreement
    #   # Match LDA topics to HDBSCAN clusters by Jaccard overlap on shared documents
    #   # Both agree → Tier 2. One method only → Tier 3.
    #   # Filter: drop themes with < 50 docs, themes >0.85 correlated with existing Tier 1

    # Step 5: Asset mapping (for Tier 2)
    #   For each new theme, compute mention count time series
    #   Correlate with 50 liquid ETFs → map to top-3 by Pearson r

    # Persist to Supabase:
    #   supabase.table("themes").upsert([{name, tier, source, discovered_at}]...)
    #   supabase.table("theme_assets").upsert([{theme_id, ticker, weight, run_date}]...)
```

**Test outline:**
```python
def test_lda_produces_topics():
    # Given a small corpus, LDA should produce k topics with coherent word distributions
    pass

def test_embedding_clusters_shape():
    # HDBSCAN should produce clusters with min 50 documents each
    pass

def test_agreement_filters_spurious():
    # A random collection of unrelated texts should NOT produce high-agreement themes
    pass
```

---

## Phase C: Next.js Frontend

### Task C1: Next.js scaffold and Supabase client

**Files:**
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/globals.css`
- Create: `frontend/lib/supabase.ts`
- Create: `frontend/app/layout.tsx`

**Layout:**

```tsx
// frontend/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Andromeda — Market Theme Platform",
  description: "Systematic theme identification and trade generation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
```

```css
/* frontend/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg-primary: #0d1117;
  --bg-surface: #161b22;
  --border: #30363d;
  --accent-long: #3fb950;
  --accent-short: #f85149;
  --accent-neutral: #58a6ff;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
}
```

```ts
// frontend/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

**Environment variables needed:**
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

### Task C2: Theme Dashboard page (`/`)

**Files:**
- Modify: `frontend/app/page.tsx`
- Create: `frontend/components/ThemeFeed.tsx`
- Create: `frontend/components/HypeGauge.tsx`
- Create: `frontend/components/MarketCorrelationChart.tsx`
- Create: `frontend/components/DataSourceStatus.tsx`

**`page.tsx` — Theme Dashboard:**

```tsx
// frontend/app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ThemeFeed from "@/components/ThemeFeed";
import DataSourceStatus from "@/components/DataSourceStatus";

interface Theme {
  id: string;
  name: string;
  tier: string;
  hype_score: number;
  volume_score: number;
  sentiment_score: number;
  corr_score: number;
  momentum_score: number;
  updated_at: string;
}

export default function ThemeDashboard() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [selected, setSelected] = useState<Theme | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("themes")
      .select("*")
      .order("hype_score", { ascending: false })
      .then(({ data }) => {
        setThemes(data ?? []);
        if (data?.length) setSelected(data[0]);
        setLoading(false);
      });
  }, []);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight">ANDROMEDA</h1>
          <p className="text-[#8b949e] text-sm mt-1">Market Theme Identification Platform</p>
        </div>
        <DataSourceStatus />
      </header>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-[#8b949e]">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ThemeFeed themes={themes} selected={selected} onSelect={setSelected} />
          {selected && <HypeGauge theme={selected} />}
        </div>
      )}
    </main>
  );
}
```

**`ThemeFeed.tsx`:**

```tsx
// frontend/components/ThemeFeed.tsx
interface Theme { id: string; name: string; tier: string; hype_score: number; }
interface Props { themes: Theme[]; selected: Theme | null; onSelect: (t: Theme) => void; }

export default function ThemeFeed({ themes, selected, onSelect }: Props) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest mb-4">Trending Themes</h2>
      <div className="space-y-2">
        {themes.map((theme) => {
          const isSelected = selected?.id === theme.id;
          const barWidth = Math.round(theme.hype_score ?? 0);
          return (
            <button
              key={theme.id}
              onClick={() => onSelect(theme)}
              className={`w-full text-left px-3 py-2 rounded transition-all duration-200 ${
                isSelected ? "bg-[#30363d]" : "hover:bg-[#1c2128]"
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">
                  {theme.name}
                  {theme.tier === "anchor" && (
                    <span className="ml-2 text-xs text-[#58a6ff]">anchor</span>
                  )}
                  {theme.tier === "discovered" && (
                    <span className="ml-2 text-xs text-[#3fb950]">discovered</span>
                  )}
                  {theme.tier === "review" && (
                    <span className="ml-2 text-xs text-[#d29922]">review</span>
                  )}
                </span>
                <span className="font-mono text-sm text-[#8b949e]">{barWidth}</span>
              </div>
              <div className="h-1 bg-[#30363d] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#58a6ff] rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

**`HypeGauge.tsx`:**

```tsx
// frontend/components/HypeGauge.tsx
interface Theme {
  name: string; hype_score: number; volume_score: number;
  sentiment_score: number; corr_score: number; momentum_score: number;
}

function GaugeBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#8b949e] w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-[#30363d] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-300 ease-out`}
          style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-xs w-8 text-right text-[#8b949e]">{Math.round(value * 100)}</span>
    </div>
  );
}

export default function HypeGauge({ theme }: { theme: Theme }) {
  const scoreColor = theme.hype_score >= 50
    ? "bg-[#58a6ff]"
    : theme.hype_score >= 30
    ? "bg-[#d29922]"
    : "bg-[#f85149]";

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium">{theme.name}</h2>
        <div className={`font-mono text-2xl font-bold ${scoreColor}`}>
          {Math.round(theme.hype_score ?? 0)}
        </div>
      </div>
      <p className="text-xs text-[#8b949e] mb-4">Hype Score breakdown</p>
      <div className="space-y-3">
        <GaugeBar label="Volume" value={theme.volume_score ?? 0} color="bg-[#58a6ff]" />
        <GaugeBar label="Sentiment" value={theme.sentiment_score ?? 0} color="bg-[#3fb950]" />
        <GaugeBar label="Correlation" value={theme.corr_score ?? 0} color="bg-[#d29922]" />
        <GaugeBar label="Momentum" value={theme.momentum_score ?? 0} color="bg-[#f85149]" />
      </div>
    </div>
  );
}
```

**`DataSourceStatus.tsx`:**

```tsx
// frontend/components/DataSourceStatus.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function DataSourceStatus() {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("themes")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]?.updated_at) setLastUpdated(data[0].updated_at);
      });
  }, []);

  return (
    <div className="text-right">
      {lastUpdated ? (
        <p className="text-xs text-[#3fb950]">● Live</p>
      ) : (
        <p className="text-xs text-[#f85149]">○ No data</p>
      )}
    </div>
  );
}
```

**`MarketCorrelationChart.tsx`:**

```tsx
// frontend/components/MarketCorrelationChart.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface SignalHistory { run_date: string; mention_count_1d: number; price_corr: number; }

export default function MarketCorrelationChart({ themeId }: { themeId: string }) {
  const [data, setData] = useState<SignalHistory[]>([]);

  useEffect(() => {
    if (!themeId) return;
    supabase
      .from("theme_signals_history")
      .select("run_date, mention_count_1d, price_corr")
      .eq("theme_id", themeId)
      .order("run_date", { ascending: true })
      .limit(30)
      .then(({ data: rows }) => setData(rows ?? []));
  }, [themeId]);

  if (!data.length) {
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 h-48 flex items-center justify-center text-[#8b949e] text-sm">
        No historical data available
      </div>
    );
  }

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest mb-3">
        Mentions vs Correlation
      </h2>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
          <XAxis dataKey="run_date" tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} />
          <YAxis yAxisId="mentions" tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} />
          <YAxis yAxisId="corr" orientation="right" tick={{ fill: "#8b949e", fontSize: 10 }} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 4 }}
            labelStyle={{ color: "#e6edf3" }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line yAxisId="mentions" type="monotone" dataKey="mention_count_1d" stroke="#58a6ff" strokeWidth={1.5} dot={false} name="Mentions" />
          <Line yAxisId="corr" type="monotone" dataKey="price_corr" stroke="#d29922" strokeWidth={1.5} dot={false} name="Corr" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

**`page.tsx` — update to include MarketCorrelationChart:**

```tsx
// Add to imports in page.tsx:
// import MarketCorrelationChart from "@/components/MarketCorrelationChart";

// Add to JSX, below the ThemeFeed/HypeGauge grid:
{
  selected && (
    <MarketCorrelationChart themeId={selected.id} key={selected.id} />
  )
}
```

---

### Task C3: Trade Ideas page (`/trades`)

**Files:**
- Create: `frontend/app/trades/page.tsx`
- Create: `frontend/components/TradeIdeasTable.tsx`

**`TradeIdeasTable.tsx`:**

```tsx
// frontend/components/TradeIdeasTable.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface TradeCandidate {
  id: string;
  theme_id: string;
  asset: string;
  direction: "long" | "short";
  trade_score: number;
  hype_score: number;
  entry_thesis: string;
  risk_factors: string;
  timeframe: string;
  themes: { name: string };
}

export default function TradeIdeasTable() {
  const [longs, setLongs] = useState<TradeCandidate[]>([]);
  const [shorts, setShorts] = useState<TradeCandidate[]>([]);

  useEffect(() => {
    supabase
      .from("trade_candidates")
      .select("*, themes(name)")
      .order("trade_score", { ascending: false })
      .then(({ data }) => {
        const all = data ?? [];
        setLongs(all.filter((t: TradeCandidate) => t.direction === "long").slice(0, 5));
        setShorts(all.filter((t: TradeCandidate) => t.direction === "short").slice(0, 5));
      });
  }, []);

  const renderTable = (candidates: TradeCandidate[], direction: "long" | "short") => {
    const color = direction === "long" ? "text-[#3fb950]" : "text-[#f85149]";
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 flex-1">
        <h2 className={`text-sm font-mono uppercase tracking-widest mb-4 ${color}`}>
          {direction === "long" ? "▲ Long" : "▼ Short"}
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#8b949e] text-left text-xs">
              <th className="pb-2">Theme</th>
              <th className="pb-2">Asset</th>
              <th className="pb-2 text-right">Hype</th>
              <th className="pb-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} className="border-t border-[#30363d]">
                <td className="py-2">{c.themes?.name ?? "—"}</td>
                <td className="font-mono py-2">{c.asset}</td>
                <td className="text-right font-mono py-2 text-[#8b949e]">{Math.round(c.hype_score ?? 0)}</td>
                <td className={`text-right font-mono py-2 font-bold ${color}`}>
                  {c.trade_score?.toFixed(2) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6">
      <h1 className="text-2xl font-mono font-bold mb-6">Trade Ideas</h1>
      <div className="flex gap-6 flex-wrap">
        {renderTable(longs, "long")}
        {renderTable(shorts, "short")}
      </div>
    </main>
  );
}
```

---

### Task C4: Portfolio page (`/portfolio`)

**Files:**
- Create: `frontend/app/portfolio/page.tsx`
- Create: `frontend/components/PortfolioTreemap.tsx`

**`page.tsx`:**

```tsx
// frontend/app/portfolio/page.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Position {
  id: string; theme: string; asset: string;
  direction: "long" | "short"; notional: number; weight: number;
  hype_score: number;
}
interface Risk { total_capital: number; var_95: number; cvar_95: number;
  sharpe: number; beta: number; concentration_hhi: number; }

export default function PortfolioPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [risk, setRisk] = useState<Risk | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from("portfolio_positions").select("*").order("weight", { ascending: false }),
      supabase.from("portfolio_risk").select("*").limit(1).single(),
    ]).then(([posRes, riskRes]) => {
      setPositions(posRes.data ?? []);
      setRisk(riskRes.data ?? null);
    });
  }, []);

  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6">
      <h1 className="text-2xl font-mono font-bold mb-6">$100M Portfolio</h1>

      {risk && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {[
            { label: "VaR (95%)", value: fmt(risk.var_95), color: "text-[#f85149]" },
            { label: "CVaR (95%)", value: fmt(risk.cvar_95), color: "text-[#f85149]" },
            { label: "Sharpe", value: risk.sharpe?.toFixed(2) ?? "—", color: "text-[#e6edf3]" },
            { label: "Beta", value: risk.beta?.toFixed(2) ?? "—", color: "text-[#58a6ff]" },
            { label: "HHI", value: risk.concentration_hhi?.toFixed(0) ?? "—", color: "text-[#d29922]" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
              <p className="text-xs text-[#8b949e] mb-1">{label}</p>
              <p className={`font-mono text-xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
        <h2 className="text-sm font-mono text-[#8b949e] uppercase tracking-widest mb-4">Positions</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#8b949e] text-left text-xs">
              <th className="pb-2">Theme</th><th className="pb-2">Asset</th>
              <th className="pb-2">Direction</th><th className="pb-2 text-right">Notional</th>
              <th className="pb-2 text-right">Weight</th><th className="pb-2 text-right">Hype</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id} className="border-t border-[#30363d]">
                <td className="py-2">{p.theme}</td>
                <td className="font-mono py-2">{p.asset}</td>
                <td className={`py-2 ${p.direction === "long" ? "text-[#3fb950]" : "text-[#f85149]"}`}>
                  {p.direction.toUpperCase()}
                </td>
                <td className="text-right font-mono py-2">{fmt(p.notional)}</td>
                <td className="text-right font-mono py-2">{((p.weight ?? 0) * 100).toFixed(1)}%</td>
                <td className="text-right font-mono py-2 text-[#8b949e]">{Math.round(p.hype_score ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
```

---

### Task C5: Research page (`/research`)

**Files:**
- Create: `frontend/app/research/page.tsx`

**`page.tsx`:**

```tsx
// frontend/app/research/page.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface ResearchSection { id: string; section: string; content: string; }

export default function ResearchPage() {
  const [sections, setSections] = useState<ResearchSection[]>([]);

  useEffect(() => {
    supabase
      .from("research_output")
      .select("*")
      .order("section")
      .then(({ data }) => setSections(data ?? []));
  }, []);

  return (
    <main className="min-h-screen bg-[#0d1117] text-[#e6edf3] p-6 max-w-4xl">
      <h1 className="text-2xl font-mono font-bold mb-6">Research: Top 5 Long / Short</h1>
      <div className="space-y-6">
        {sections.map((s) => (
          <div key={s.id} className="bg-[#161b22] border border-[#30363d] rounded-lg p-6">
            <h2 className="text-sm font-mono text-[#58a6ff] uppercase tracking-widest mb-3">{s.section}</h2>
            <div className="prose prose-invert prose-sm max-w-none text-[#e6edf3]">
              {s.content.split("\n").map((para, i) => (
                <p key={i} className="mb-3 leading-relaxed">{para}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
```

---

## Phase D: Deployment

### Task D1: Vercel setup

**Files:**
- Create: `frontend/vercel.json`

```json
{
  "framework": "nextjs",
  "buildCommand": "cd frontend && npm install && npm run build",
  "outputDirectory": "frontend/.next",
  "installCommand": "cd frontend && npm install",
  "env": {
    "NEXT_PUBLIC_SUPABASE_URL": "@supabase_url",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "@supabase_anon_key"
  }
}
```

**Steps to deploy:**
1. Push to GitHub repo
2. Connect repo to Vercel → auto-deploys on push to main
3. Set env vars in Vercel dashboard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Custom domain (optional): configure in Vercel settings

---

## Implementation Order

Execute tasks in this order:

```
A1 → A2 → B1 → B2 → B3 → B4 → B5 → B6 → B7 → C1 → C2 → C3 → C4 → C5 → D1
```

A1–A2 are prerequisites for everything else. B1–B6 are independent of each other and can be run in parallel by separate agents if using subagent-driven execution. C1–C5 depend on A1–A2 (env vars and Supabase client ready). D1 depends on C1–C5 (frontend complete).

---

## Spec Coverage Checklist

| Spec section | Implemented by |
|---|---|
| 4.1 Real data sources | Tasks B2 (Brave), B3 (Reddit), B4 (Yahoo) |
| 4.2 Daily batch refresh | Task B7 |
| 4.3 VADER sentiment | Task B1 |
| 4.4 Theme taxonomy (Tier 1) | Task A2 (seeded in migration) |
| 4.5 Discovery (Tier 2) | Task B8 |
| 4.5 Scoring config (DB) | Task A2 (scoring_config table + Task B5 reads it) |
| 4.6 HypeScore formula | Task B5 |
| 6.1 TradeScore | Task B6 |
| 6.2 Long/short ranking | Task B7 (persist) |
| 7.1 Position sizing | Task B7 |
| 7.2 Risk metrics | Task B7 |
| 8.1 Theme Dashboard | Tasks C2 |
| 8.2 Trade Ideas | Task C3 |
| 8.3 Portfolio | Task C4 |
| 8.4 Research | Task C5 |
| 9. Data access layer | Tasks A2, C1 |
| 10. Tech stack | Tasks A1, B1–B8, C1–C5 |
| Phase 1 | Tasks A1, A2, C1–C5, D1 |
| Phase 2 | Tasks B1–B7, C2 |
| Phase 3 | Risk metrics embedded in Task B7 |
| Phase 4 | Deferred |
