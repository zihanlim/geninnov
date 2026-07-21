# scripts/daily_refresh.py
"""
Daily refresh script — runs at market close (4:30pm ET) via cron-job.org.
Pulls Brave News + Reddit, computes sentiment + HypeScore + TradeScore,
writes results to Supabase.
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone
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
    results = []
    today_str = run_date.isoformat()

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

        # Price correlation per mapped asset.
        # Prefer assets for today's run_date; fall back to the most recent
        # entry for this theme so bootstrap timing doesn't zero out CorrScore.
        assets = supabase.table("theme_assets").select("ticker").eq("theme_id", theme["id"]).eq("run_date", today_str).execute().data
        if not assets:
            assets = supabase.table("theme_assets").select("ticker").eq("theme_id", theme["id"]).order("run_date", desc=True).limit(20).execute().data
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
            "updated_at": datetime.now(timezone.utc).isoformat(),
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