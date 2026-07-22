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

# Add the repo root to the path so `backend.*` resolves.
#
# This must be the repo root, NOT backend/. Modules inside backend/ import each
# other absolutely (`from backend.services...`), so putting backend/ on the path
# leaves `backend` itself unimportable and the pipeline dies on first import.
# Rooting here also avoids loading the same module under two names
# (`services.hype_calculator` and `backend.services.hype_calculator`), which
# would create two distinct ScoringConfig classes.
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.tools.sentiment import batch_sentiment
from backend.data.brave_client import fetch_news_for_theme
from backend.data.reddit_client import fetch_posts_for_theme
from backend.data.yahoo_client import fetch_price_data, correlation_with_mentions
from backend.data.macro_fetcher import MacroFetcher
from backend.data.polymarket_fetcher import PolymarketFetcher
from backend.services.hype_calculator import (
    hype_score,
    compute_hype_scores as services_hype_compute_hype_scores,
    ScoringConfig,
    rescale_vader,
    minmax_norm,
)
from backend.services.trade_generator import trade_score
from backend.services.trade_ranker import (
    rank_trade_candidates,
    allocate_portfolio,
    TradeCandidate,
    classify,
    SECTOR_MAP,
    GEO_MAP,
)
from backend.services.risk_engine import (
    compute_risk,
)
from backend.services.portfolio import (
    compute_daily_return,
    compute_cumulative_return,
    MissingReturnError,
)
from backend.services.regime_classifier import RegimeClassifier
from backend.services.pipeline_runs import run_id_for, record_pipeline_run

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
    return services_hype_compute_hype_scores(raw_signals, cfg)


# ─── Step 5: Compute TradeScores ──────────────────────────────────────────────────────────────────
def compute_trade_scores(hyped: list[dict], run_date: date) -> list[dict]:
    cfg = load_config()

    # Get yesterday's scores for momentum. If the theme_signals_history table
    # doesn't have a hype_score column (migration 003 not yet applied), the
    # query raises a PostgREST APIError. We catch it and fall back to using
    # today's score as yesterday's, which collapses HypeMomentum to 0
    # (TradeScore becomes sentiment-only -- degraded but not broken).
    yesterday = (run_date - timedelta(days=1)).isoformat()
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

    # T22: Per-theme prior-run lookup for elapsed_days. Without this the
    # HypeMomentum normalization always divides by 1 day, even after a
    # weekend or a missed run. Fetch the most recent prior run_date per
    # theme in one round-trip; themes with no prior row default to
    # elapsed_days=1 with a warning.
    prior_run_dates: dict[str, date] = {}
    try:
        prior_rows = (
            supabase.table("theme_signals_history")
            .select("theme_id, run_date")
            .lt("run_date", run_date.isoformat())
            .order("run_date", desc=True)
            .execute()
            .data
        )
        for r in prior_rows:
            tid = r["theme_id"]
            if tid not in prior_run_dates:
                prior_run_dates[tid] = date.fromisoformat(r["run_date"])
    except Exception as exc:
        print(f"[compute_trade_scores] prior-run lookup failed ({exc.__class__.__name__}); "
              f"defaulting elapsed_days to 1.")

    scored = []
    missing_prior = 0
    for r in hyped:
        theme_id = r["theme_id"]
        # .get(key, default) returns the stored value when the key exists, so a
        # row whose hype_score column is NULL yields None rather than the
        # default. Treat a missing value the same as a missing row.
        hype_yest = hype_yesterday_map.get(theme_id)
        if hype_yest is None:
            hype_yest = r["hype_score"]

        prior_date = prior_run_dates.get(theme_id)
        if prior_date is None:
            elapsed_days = 1
            missing_prior += 1
        else:
            elapsed_days = max(1, (run_date - prior_date).days)

        ts = trade_score(
            hype_today=r["hype_score"],
            hype_yesterday=hype_yest,
            sentiment=r["avg_sentiment"],
            cfg=cfg,
            elapsed_days=elapsed_days,
        )
        scored.append({**r, "trade_score": ts, "elapsed_days": elapsed_days})

    if missing_prior:
        print(f"[compute_trade_scores] WARN: no prior run_date found for "
              f"{missing_prior}/{len(hyped)} themes; defaulted elapsed_days=1.")
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

        # Insert signals history.
        #
        # hype_score and trade_score MUST be written here. Migration 003 added
        # them so tomorrow's run can read today's HypeScore and compute
        # HypeMomentum, but nothing ever populated them: every historical row
        # had a NULL hype_score, so hype_yesterday was always missing and the
        # 0.55-weighted momentum term of TradeScore was permanently zero.
        # TradeScore had silently collapsed to `trade_sentiment_weight *
        # sentiment` in production.
        supabase.table("theme_signals_history").upsert({
            "theme_id": theme_id,
            "run_date": today_str,
            "mention_count_1d": r["mention_count_1d"],
            "mention_count_7d_avg": r["mention_count_7d_avg"],
            "mention_count_7d_std": r["mention_count_7d_std"],
            "avg_sentiment": r["avg_sentiment"],
            "price_corr": r["price_corr"],
            "momentum_raw": r["momentum_raw"],
            "hype_score": r["hype_score"],
            "trade_score": r.get("trade_score"),
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
        # Stamp run_date so readers can tell today's candidates from a previous
        # run's. A run that yields no qualifying candidates writes nothing, and
        # without this the prior run's rows keep being served as current.
        supabase.table("trade_candidates").upsert(
            {**c.to_trade_candidate_row(today_str), "run_date": today_str},
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
        # See the note in rank_and_persist_trade_candidates: without run_date a
        # stale book is indistinguishable from the current one.
        supabase.table("portfolio_positions").upsert(
            {**c.to_portfolio_position_row(notional, weight), "run_date": today_str},
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

    # Expose the latest/prev close per ticker directly (not just the derived
    # return) so the signed-weights math in portfolio.compute_daily_return can
    # enforce the "no silent zeros" contract on missing prices.
    price_lookup: dict[str, tuple[float | None, float | None]] = {}
    for ticker in tickers:
        sub = price_df[price_df["ticker"] == ticker].sort_values("date")
        if len(sub) < 2:
            price_lookup[ticker] = (None, None)
        else:
            price_lookup[ticker] = (
                float(sub.iloc[-1]["close"]),
                float(sub.iloc[-2]["close"]),
            )

    # Signed weight: shorts flip sign so short P&L is the negative of the
    # asset's return. `weight` (3rd tuple element) is always a positive fraction
    # of capital.
    positions = [
        {
            "ticker": c.asset,
            "weight": (-w if c.direction == "short" else w),
            "price_today": price_lookup[c.asset][0],
            "price_yesterday": price_lookup[c.asset][1],
        }
        for c, _, w in positioned
    ]

    try:
        daily = compute_daily_return(positions)
    except MissingReturnError:
        missing = sorted(
            {c.asset for c, _, _ in positioned if price_lookup[c.asset][0] is None}
        )
        print(
            f"[{today_str}] ABORT: missing price data for {missing}; "
            f"cannot compute daily return (no silent zeros)."
        )
        raise RuntimeError(
            f"daily return aborted for {today_str}: missing prices for {missing}"
        ) from None

    portfolio_value = total_capital * (1 + daily)

    supabase.table("portfolio_returns").upsert({
        "run_date": today_str,
        "daily_return": daily,
        "cumulative_return": daily,  # First day: same as daily. Recompute when history is sufficient.
        "portfolio_value": portfolio_value,
    }, on_conflict="run_date").execute()

    print(f"[{today_str}] Daily portfolio return: {daily:+.4%} (value ${portfolio_value:,.0f}).")
    return daily


# ─── Step 11 (Phase 3): Compute + persist risk derivations ─────────────────────────
def _derivation_to_dict(d) -> dict:
    """Serialize a NumericDerivation dataclass to a JSON-safe dict."""
    from dataclasses import asdict
    return asdict(d)


def compute_and_persist_risk(
    positioned: list[tuple[TradeCandidate, float, float]],
    run_date: date,
    cfg: ScoringConfig,
) -> dict:
    """Compute risk metrics using the derivation-aware compute_risk API.

    Returns {var_95, cvar_95, sharpe, beta, hhi: NumericDerivation}. Each
    derivation carries provenance (status, method, uncertainty, freshness) so
    the L6 frontend can render audit-grade provenance on /portfolio.

    For back-compat with downstream callers (q1_agent reads risk_metrics
    flat scalars) we return a dict with both the scalar values and the full
    bundle. Both legacy scalar columns and the new numeric_derivations
    JSONB column (added in migration 015) are written.
    """
    total_capital = cfg.total_capital

    # Build the book: signed weight (shorts flip), full taxonomy per asset.
    book = [
        {
            "ticker": c.asset,
            "weight": (-w if c.direction == "short" else w),
            "sector": classify(c.asset)["sector"],
            "geo": classify(c.asset)["geo"],
            "direction": c.direction,
            "notional": n,
        }
        for c, n, w in positioned
    ]

    history_series = _load_historical_portfolio_returns(252)
    history = [float(x) for x in history_series.tolist()] if len(history_series) else []

    spx_series = _load_spx_returns(252)
    spx_returns = [float(x) for x in spx_series.tolist()] if spx_series is not None else []

    # Run date at UTC midnight - the "as_of" the snapshot was taken.
    as_of = datetime(run_date.year, run_date.month, run_date.day, tzinfo=timezone.utc)

    derivations = compute_risk(
        book=book,
        history=history,
        spx_returns=spx_returns,
        as_of=as_of,
        portfolio_value=total_capital,
        risk_free_annual=cfg.risk_free_annual,
    )

    # Pull scalar values for legacy columns and build the JSONB bundle.
    scalar = {key: d.value for key, d in derivations.items()}
    derivations_payload = {
        field_id: _derivation_to_dict(d) for field_id, d in derivations.items()
    }

    today_str = run_date.isoformat()
    row = {
        "run_date": today_str,
        "total_capital": total_capital,
        "var_95": scalar["var_95"],
        "cvar_95": scalar["cvar_95"],
        "sharpe": scalar["sharpe"],
        "beta": scalar["beta"],
        "concentration_hhi": scalar["hhi"],
        "numeric_derivations": derivations_payload,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Upsert with run_date as the conflict key. Migration 015 will eventually
    # attach a UNIQUE(run_date) constraint; upsert works regardless.
    try:
        supabase.table("portfolio_risk").upsert(row, on_conflict="run_date").execute()
    except Exception as exc:
        # Migration 015 not yet applied (column missing) - fall back to
        # scalar-only so the legacy contract still works.
        print(
            f"[{today_str}] WARN: numeric_derivations upsert failed ({exc.__class__.__name__}): "
            f"falling back to scalar-only insert."
        )
        row.pop("numeric_derivations", None)
        supabase.table("portfolio_risk").insert(row).execute()

    hhi = scalar["hhi"] or 0.0
    var_str = f"${scalar['var_95']:,.0f}" if scalar["var_95"] is not None else "n/a"
    print(f"[{today_str}] Risk derivations persisted (NumericDerivation bundle). HHI={hhi:.0f}, VaR95={var_str}.")
    return {
        "total_capital": total_capital,
        "var_95": scalar["var_95"],
        "cvar_95": scalar["cvar_95"],
        "sharpe": scalar["sharpe"],
        "beta": scalar["beta"],
        "concentration_hhi": scalar["hhi"],
        "numeric_derivations": derivations_payload,
    }


# ─── Step 12 (Phase 3): Compute + persist cumulative return ─────────────────
def compute_and_persist_cumulative_return(run_date: date) -> None:
    """Upsert a single `portfolio_cumulative_return` row for `as_of=run_date`.

    Pulls the full `portfolio_returns.daily_return` history sorted ascending by
    `run_date`, computes a compounded cumulative return via
    `backend.services.portfolio.compute_cumulative_return`, and upserts.

    If history is empty (first-ever run), writes a row with `cumulative_value=0`,
    `daily_returns_count=0`, and `inception_date = run_date` so the L6 frontend
    has a sentinel row to render "since inception".
    """
    today_str = run_date.isoformat()

    rows = (
        supabase.table("portfolio_returns")
        .select("run_date, daily_return")
        .order("run_date")
        .execute()
        .data
    )

    if not rows:
        # No history yet: write the sentinel row.
        supabase.table("portfolio_cumulative_return").upsert({
            "as_of": today_str,
            "inception_date": today_str,
            "cumulative_value": 0,
            "compounded": True,
            "daily_returns_count": 0,
            "source_first_run_id": None,
            "source_last_run_id": None,
        }, on_conflict="as_of").execute()
        print(f"[{today_str}] Cumulative return persisted (sentinel: no history yet).")
        return

    daily_returns = [float(r["daily_return"]) for r in rows]
    first_run_date = date.fromisoformat(rows[0]["run_date"])
    last_run_date = date.fromisoformat(rows[-1]["run_date"])

    result = compute_cumulative_return(daily_returns, inception=first_run_date)

    supabase.table("portfolio_cumulative_return").upsert({
        "as_of": result["as_of"].isoformat(),
        "inception_date": result["inception"].isoformat(),
        "cumulative_value": result["value"],
        "compounded": result["compounded"],
        "daily_returns_count": len(daily_returns),
        "source_first_run_id": rows[0].get("run_date"),
        "source_last_run_id": rows[-1].get("run_date"),
    }, on_conflict="as_of").execute()

    print(
        f"[{today_str}] Cumulative return persisted: "
        f"{result['value']:+.4%} over {len(daily_returns)} days "
        f"({result['inception']} → {result['as_of']})."
    )


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
    l0_started = datetime.now(timezone.utc)
    l0_id = run_id_for(run_date, stage="L0")
    try:
        record_pipeline_run(supabase, l0_id, "started", run_date=run_date, stage="L0")
    except Exception as exc:
        # Never abort the pipeline over telemetry, but never hide it
        # either: a silent swallow here left every stage stuck at
        # 'partial' in production and nobody noticed.
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
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
    try:
        record_pipeline_run(supabase, l0_id, "success", run_date=run_date, stage="L0", duration_s=(datetime.now(timezone.utc)-l0_started).total_seconds())
    except Exception as exc:
        # Telemetry must never abort the pipeline, but a silent
        # swallow here left every stage stuck at 'partial' in
        # production with nothing to show why.
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")

    # ── Phase 5: L3 — Regime classification ─────────────────────────────────
    print(f"[{run_date}] [L3] Classifying macro regime...")
    l3_started = datetime.now(timezone.utc)
    l3_id = run_id_for(run_date, stage="L3")
    try:
        record_pipeline_run(supabase, l3_id, "started", run_date=run_date, stage="L3")
    except Exception as exc:
        # Never abort the pipeline over telemetry, but never hide it
        # either: a silent swallow here left every stage stuck at
        # 'partial' in production and nobody noticed.
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
    regime_clf = RegimeClassifier(SUPABASE_URL, SUPABASE_KEY)
    try:
        regime = regime_clf.classify(run_date)
        print(f"[{run_date}] [L3] Regime: cycle={regime.cycle}, sentiment={regime.sentiment}")
        try:
            record_pipeline_run(supabase, l3_id, "success", run_date=run_date, stage="L3", duration_s=(datetime.now(timezone.utc)-l3_started).total_seconds())
        except Exception as exc:
            # Telemetry must never abort the pipeline, but a silent
            # swallow here left every stage stuck at 'partial' in
            # production with nothing to show why.
            print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
    except Exception as exc:
        print(f"[{run_date}] [L3] Regime classification failed ({exc.__class__.__name__}): continuing without regime.")
        regime = None
        try:
            record_pipeline_run(supabase, l3_id, "failure", run_date=run_date, stage="L3", duration_s=(datetime.now(timezone.utc)-l3_started).total_seconds(), error=str(exc))
        except Exception as exc:
            # Telemetry must never abort the pipeline, but a silent
            # swallow here left every stage stuck at 'partial' in
            # production with nothing to show why.
            print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")

    # ── Phase 1–4: Theme signals → HypeScore → TradeScore ──────────────────
    themes = load_themes()
    raw = build_theme_signals(themes, run_date)
    hyped = compute_hype_scores(raw, cfg)
    scored = compute_trade_scores(hyped, run_date)
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
    compute_and_persist_cumulative_return(run_date)

    # ── Phase 5: L5 — Q1 AI reasoning agent ──────────────────────────────────────
    # Lazy import to avoid requiring anthropic if not installed in unit-test envs
    l5_started = datetime.now(timezone.utc)
    l5_id = run_id_for(run_date, stage="L5")
    try:
        record_pipeline_run(supabase, l5_id, "started", run_date=run_date, stage="L5")
    except Exception as exc:
        # Never abort the pipeline over telemetry, but never hide it
        # either: a silent swallow here left every stage stuck at
        # 'partial' in production and nobody noticed.
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
    try:
        from backend.services.q1_agent import run_q1_agent
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
        try:
            record_pipeline_run(supabase, l5_id, "success", run_date=run_date, stage="L5", duration_s=(datetime.now(timezone.utc)-l5_started).total_seconds())
        except Exception as exc:
            # Telemetry must never abort the pipeline, but a silent
            # swallow here left every stage stuck at 'partial' in
            # production with nothing to show why.
            print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
    except ImportError as exc:
        print(f"[{run_date}] [L5] langchain/langgraph not available ({exc}): skipping research agent.")
    except Exception as exc:
        print(f"[{run_date}] [L5] Research agent failed ({exc.__class__.__name__}): skipping. Run with langchain installed to enable.")
        try:
            record_pipeline_run(supabase, l5_id, "failure", run_date=run_date, stage="L5", duration_s=(datetime.now(timezone.utc)-l5_started).total_seconds(), error=str(exc))
        except Exception as exc:
            # Telemetry must never abort the pipeline, but a silent
            # swallow here left every stage stuck at 'partial' in
            # production with nothing to show why.
            print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")

    print(f"[{run_date}] Daily refresh complete.")


if __name__ == "__main__":
    main()
