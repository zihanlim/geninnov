# scripts/daily_refresh.py
"""
Daily refresh script -- runs at market close (4:30pm ET) via cron-job.org.
Pulls Brave News + Reddit, computes sentiment + HypeScore + TradeScore,
writes results to Supabase. Also runs the trade ranking, position sizing,
daily P&L, and risk metric pipeline (Phase 3 of the spec).
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf
from supabase import create_client

# Add backend to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from tools.sentiment import batch_sentiment
from data.brave_client import fetch_news_for_theme
from data.reddit_client import fetch_posts_for_theme
from data.yahoo_client import fetch_price_data, correlation_with_mentions
from data.macro_fetcher import MacroFetcher
from data.polymarket_fetcher import PolymarketFetcher
from services.hype_calculator import hype_score, ScoringConfig, rescale_vader, minmax_norm
from services.trade_generator import trade_score
from services.trade_ranker import (
    rank_trade_candidates,
    allocate_portfolio,
    TradeCandidate,
    SECTOR_MAP,
    GEO_MAP,
)
from services.risk_engine import (
    compute_risk_metrics,
    portfolio_daily_return,
)
from services.regime_classifier import RegimeClassifier

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

        avg_sentiment = float(pd.Series(scores).mean()) if scores else 0.0

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

        mention_count_7d_avg = float(pd.Series(daily_counts).mean())
        mention_count_7d_std = float(pd.Series(daily_counts).std()) if len(daily_counts) > 1 else 0.0
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
                if not pd.isna(corr):
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

    # Get yesterday's scores for momentum. If the theme_signals_history table
    # doesn't have a hype_score column (migration 003 not yet applied), the
    # query raises a PostgREST APIError. We catch it and fall back to using
    # today's score as yesterday's, which collapses HypeMomentum to 0
    # (TradeScore becomes sentiment-only -- degraded but not broken).
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    try:
        yesterday_rows = (
            supabase.table("theme_signals_history")
            .select("theme_id, hype_score")
            .eq("run_date", yesterday)
            .execute()
            .data
        )
        hype_yesterday_map = {r["theme_id"]: r["hype_score"] for r in yesterday_rows}
    except Exception as exc:
        print(f"[compute_trade_scores] hype_score column unavailable ({exc.__class__.__name__}); "
              f"HypeMomentum will be 0. Apply migration 003 to enable.")
        hype_yesterday_map = {}

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


# ─── Step 6: Persist themes + signals history ─────────────────────────────────
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


# ─── Step 7 (Phase 3): Load theme_assets map for ranked themes ───────────────
def load_theme_assets_map(theme_ids: list[str], run_date: date) -> dict[str, list[str]]:
    """Load asset map for a set of themes. Most-recent run_date wins per theme."""
    today_str = run_date.isoformat()
    out: dict[str, list[str]] = {tid: [] for tid in theme_ids}
    if not theme_ids:
        return out
    rows = (
        supabase.table("theme_assets")
        .select("theme_id, ticker, run_date")
        .in_("theme_id", theme_ids)
        .execute()
        .data
    )
    by_theme: dict[str, list[dict]] = {}
    for r in rows:
        by_theme.setdefault(r["theme_id"], []).append(r)
    for tid, rs in by_theme.items():
        rs.sort(key=lambda r: r["run_date"], reverse=True)
        out[tid] = [r["ticker"] for r in rs[:20]]
    return out


# ─── Step 8 (Phase 3): Rank + persist trade candidates ────────────────────────
def rank_and_persist_trade_candidates(
    scored: list[dict],
    run_date: date,
    cfg: ScoringConfig,
) -> tuple[list[TradeCandidate], list[TradeCandidate]]:
    theme_ids = [s["theme_id"] for s in scored]
    theme_assets_map = load_theme_assets_map(theme_ids, run_date)

    longs, shorts = rank_trade_candidates(
        scored, theme_assets_map, cfg.hype_score_threshold, top_n=5
    )

    today_str = run_date.isoformat()
    for c in longs + shorts:
        supabase.table("trade_candidates").upsert(
            c.to_trade_candidate_row(today_str),
            on_conflict="theme_id,asset,direction",
        ).execute()

    print(f"[{today_str}] {len(longs)} long + {len(shorts)} short trade candidates persisted.")
    return longs, shorts


# ─── Step 9 (Phase 3): Allocate + persist portfolio positions ────────────────
def allocate_and_persist_portfolio(
    candidates: list[TradeCandidate],
    run_date: date,
    cfg: ScoringConfig,
) -> list[tuple[TradeCandidate, float, float]]:
    positioned = allocate_portfolio(
        candidates, cfg.total_capital,
        sector_map=SECTOR_MAP, geo_map=GEO_MAP
    )

    today_str = run_date.isoformat()
    for c, notional, weight in positioned:
        supabase.table("portfolio_positions").upsert(
            c.to_portfolio_position_row(notional, weight),
            on_conflict="theme_id,asset,direction",
        ).execute()

    print(f"[{today_str}] {len(positioned)} portfolio positions persisted (total capital ${cfg.total_capital:,.0f}).")
    return positioned


# ─── Step 10 (Phase 3): Compute + persist today's portfolio return ───────────
def compute_and_persist_daily_return(
    positioned: list[tuple[TradeCandidate, float, float]],
    run_date: date,
    total_capital: float,
) -> float:
    """Fetch today's prices for each held asset, compute weighted portfolio return, persist."""
    today_str = run_date.isoformat()
    tickers = list({c.asset for c, _, _ in positioned})
    if not tickers:
        return 0.0

    # 5 days of lookback is plenty for "today vs yesterday" return calculation
    price_df = fetch_price_data(tickers, lookback_days=5)
    if price_df.empty:
        return 0.0

    position_returns: dict[str, float] = {}
    for ticker in tickers:
        sub = price_df[price_df["ticker"] == ticker].sort_values("date")
        if len(sub) < 2:
            position_returns[ticker] = 0.0
        else:
            latest = sub.iloc[-1]["close"]
            prev = sub.iloc[-2]["close"]
            position_returns[ticker] = float(latest / prev - 1) if prev else 0.0

    position_dicts = [
        {"asset": c.asset, "weight": w, "direction": c.direction}
        for c, _, w in positioned
    ]
    daily = portfolio_daily_return(position_returns, position_dicts, total_capital)
    portfolio_value = total_capital * (1 + daily)

    supabase.table("portfolio_returns").upsert({
        "run_date": today_str,
        "daily_return": daily,
        "cumulative_return": daily,  # First day: same as daily. Recompute when history is sufficient.
        "portfolio_value": portfolio_value,
    }, on_conflict="run_date").execute()

    print(f"[{today_str}] Daily portfolio return: {daily:+.4%} (value ${portfolio_value:,.0f}).")
    return daily


# ─── Step 11 (Phase 3): Compute + persist risk metrics ────────────────────────
def compute_and_persist_risk(
    positioned: list[tuple[TradeCandidate, float, float]],
    run_date: date,
    cfg: ScoringConfig,
) -> dict:
    """Compute risk metrics over available history and persist.

    HHI is always computable from current weights. VaR/CVaR/Sharpe/Beta
    need ~30-60 days of history; we return None until then.
    """
    total_capital = cfg.total_capital
    position_dicts = [
        {"asset": c.asset, "weight": w, "notional": n, "direction": c.direction}
        for c, n, w in positioned
    ]

    historical_returns = _load_historical_portfolio_returns(252)
    spx_returns = _load_spx_returns(252)

    metrics = compute_risk_metrics(
        position_dicts,
        historical_returns,
        spx_returns=spx_returns,
        risk_free_annual=cfg.risk_free_annual,
    )

    # portfolio_risk has no unique constraint; replace all rows with current state
    supabase.table("portfolio_risk").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    supabase.table("portfolio_risk").insert({
        "total_capital": metrics["total_capital"],
        "var_95": metrics["var_95"],
        "cvar_95": metrics["cvar_95"],
        "sharpe": metrics["sharpe"],
        "beta": metrics["beta"],
        "concentration_hhi": metrics["concentration_hhi"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    today_str = run_date.isoformat()
    hhi = metrics["concentration_hhi"]
    var_str = f"${metrics['var_95']:,.0f}" if metrics["var_95"] is not None else "n/a"
    print(f"[{today_str}] Risk metrics persisted. HHI={hhi:.0f}, VaR95={var_str}.")
    return metrics


def _load_historical_portfolio_returns(lookback_days: int) -> pd.Series:
    """Pull last N days of portfolio_returns from Supabase. Empty Series if <2 obs."""
    rows = (
        supabase.table("portfolio_returns")
        .select("run_date, daily_return")
        .order("run_date", desc=True)
        .limit(lookback_days)
        .execute()
        .data
    )
    if not rows or len(rows) < 2:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows)
    df["run_date"] = pd.to_datetime(df["run_date"])
    df = df.sort_values("run_date")
    return pd.Series(df["daily_return"].values, index=df["run_date"].values)


def _load_spx_returns(lookback_days: int) -> "pd.Series | None":
    """Fetch SPX (^GSPC) daily returns for beta. None if fetch fails."""
    end = date.today()
    start = end - timedelta(days=lookback_days + 10)
    try:
        data = yf.download("^GSPC", start=start, end=end, progress=False, auto_adjust=True)
    except Exception:
        return None
    if data.empty:
        return None
    close = data["Close"].dropna()
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    returns = close.pct_change().dropna()
    if returns.empty:
        return None
    return returns


# ─── Main orchestration ──────────────────────────────────────────────────────
def main():
    run_date = date.today()
    print(f"[{run_date}] Starting daily refresh...")

    cfg = load_config()

    # ── Phase 5: L0 — Macro data ingest ─────────────────────────────────────
    print(f"[{run_date}] [L0] Fetching macro data from FRED + yfinance...")
    macro_fetcher = MacroFetcher(SUPABASE_URL, SUPABASE_KEY)
    try:
        macro_snapshot = macro_fetcher.fetch_today()
        print(f"[{run_date}] [L0] Fetched {len(macro_snapshot)} macro series.")
        # Also compute equity index % changes for the market bar
        try:
            assets = macro_fetcher.fetch_market_assets()
            print(f"[{run_date}] [L0] Fetched {len(assets)} market assets with pct_change.")
        except Exception as e:
            print(f"[{run_date}] [L0] Market assets fetch failed ({e.__class__.__name__}): skipping.")
    except Exception as exc:
        print(f"[{run_date}] [L0] FRED/yfinance fetch failed ({exc.__class__.__name__}): continuing without macro data.")
        macro_snapshot = {}

    # Polymarket: prediction market odds for cited macro context
    try:
        poly_fetcher = PolymarketFetcher(SUPABASE_URL, SUPABASE_KEY)
        poly_markets = poly_fetcher.fetch_macro_markets()
        print(f"[{run_date}] [L0] Fetched {len(poly_markets)} prediction markets.")
    except Exception as e:
        print(f"[{run_date}] [L0] Polymarket fetch failed ({e.__class__.__name__}): skipping.")

    # ── Phase 5: L3 — Regime classification ─────────────────────────────────
    print(f"[{run_date}] [L3] Classifying macro regime...")
    regime_clf = RegimeClassifier(SUPABASE_URL, SUPABASE_KEY)
    try:
        regime = regime_clf.classify(run_date)
        print(f"[{run_date}] [L3] Regime: cycle={regime.cycle}, sentiment={regime.sentiment}")
    except Exception as exc:
        print(f"[{run_date}] [L3] Regime classification failed ({exc.__class__.__name__}): continuing without regime.")
        regime = None

    # ── Phase 1–4: Theme signals → HypeScore → TradeScore ──────────────────
    themes = load_themes()
    raw = build_theme_signals(themes, run_date)
    hyped = compute_hype_scores(raw, cfg)
    scored = compute_trade_scores(hyped)
    persist(run_date, scored)

    # ── Phase 3: trade ranking + portfolio construction ─────────────────────
    longs, shorts = rank_and_persist_trade_candidates(scored, run_date, cfg)
    candidates = longs + shorts
    if not candidates:
        print(f"[{run_date}] No qualifying trade candidates; skipping portfolio construction.")
        return

    positioned = allocate_and_persist_portfolio(candidates, run_date, cfg)
    compute_and_persist_daily_return(positioned, run_date, cfg.total_capital)
    risk_metrics = compute_and_persist_risk(positioned, run_date, cfg)

    # ── Phase 5: L5 — Q1 AI reasoning agent ──────────────────────────────────────
    # Lazy import to avoid requiring anthropic if not installed in unit-test envs
    try:
        from services.q1_agent import run_q1_agent
        print(f"[{run_date}] [L5] Running Q1 AI reasoning agent...")
        agent_result = run_q1_agent(
            run_date=run_date,
            supabase_url=SUPABASE_URL,
            supabase_key=SUPABASE_KEY,
            macro_snapshot=macro_snapshot,
            regime=regime,
            candidates=positioned,
            risk_metrics=risk_metrics,
            cfg=cfg,
        )
        if agent_result:
            print(f"[{run_date}] [L5] Q1 recommendations persisted.")
        else:
            print(f"[{run_date}] [L5] Q1 agent declined to produce output (fallback active).")
    except ImportError as exc:
        print(f"[{run_date}] [L5] langchain/langgraph not available ({exc}): skipping research agent.")
    except Exception as exc:
        print(f"[{run_date}] [L5] Research agent failed ({exc.__class__.__name__}): skipping. Run with langchain installed to enable.")

    print(f"[{run_date}] Daily refresh complete.")


if __name__ == "__main__":
    main()
