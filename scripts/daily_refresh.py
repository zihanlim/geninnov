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

# Windows consoles default to cp1252, which can't encode the arrows/box glyphs
# used in status prints (→, ═). Force UTF-8 so a purely cosmetic print can never
# crash the pipeline — a stray "→" print killed a full run right before L5.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

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
    volume_subscore,
    corr_subscore,
    momentum_subscore,
    crowding_label,
    robust_momentum,
    volume_base,
)
from backend.services.trade_generator import trade_score
from backend.services.trade_ranker import (
    rank_trade_candidates,
    allocate_portfolio,
    TradeCandidate,
    classify,
    is_classified,
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
from backend.services.regime_classifier import RegimeClassifier, risk_appetite
from backend.services.edge_signals import (
    theme_trend,
    theme_regime_bias,
    regime_direction_bias,
    carry_signal,
    value_signal,
    sentiment_signal,
    compute_edge_score,
)
from statistics import fmean, pstdev
from backend.services.pipeline_runs import run_id_for, record_pipeline_run

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # service role key for writes

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# EdgeScore Stage-1 trend window (calendar days ≈ 6 months / ~126 trading days).
EDGE_TREND_WINDOW_DAYS = 180


# ─── Step 1: Load config from Supabase ───────────────────────────────────────
def load_config() -> ScoringConfig:
    rows = supabase.table("scoring_config").select("*").execute().data
    return ScoringConfig.from_db_rows(rows)


# ─── Step 2: Load all themes ───────────────────────────────────────────────────
def load_themes():
    return supabase.table("themes").select("*").execute().data


def _classify_data_source(headlines: list[dict]) -> str:
    """Provenance of a theme's collected text.

    'real'  — every item came from a live feed (source not prefixed 'mock_'),
    'mock'  — every item came from the fallback,
    'mixed' — some of each,
    'none'  — nothing collected.

    Surfaced so a HypeScore computed off mock data is never mistaken for a
    genuine one (RESIDUAL R0b).
    """
    if not headlines:
        return "none"
    real = sum(1 for h in headlines if not str(h.get("source", "")).startswith("mock"))
    mock = len(headlines) - real
    if mock == 0:
        return "real"
    if real == 0:
        return "mock"
    return "mixed"


# Attention window for the theme↔price CORRELATION. A 7-day mention series on
# sparse data is near-constant → degenerate (all-zero) corr (ADR-0028). 30 days
# gives the series enough spread to correlate. Momentum still uses the trailing 7.
CORR_WINDOW_DAYS = 30


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

    for idx, theme in enumerate(themes, 1):
        theme_name = theme["name"]
        # Per-theme progress on its own line (flushed) so a stall in the news or
        # price fetch is pinpointable in the logs rather than a silent hang.
        print(f"[build_theme_signals] {idx}/{len(themes)} {theme_name}: fetching…",
              flush=True)

        # Fetch news + Reddit over the correlation window (momentum uses the
        # trailing 7 days of it; the price correlation uses the full window).
        news = fetch_news_for_theme(theme_name, lookback_days=CORR_WINDOW_DAYS)
        posts = fetch_posts_for_theme(theme_name, lookback_days=CORR_WINDOW_DAYS)

        # Keep the raw items so the L5 agent can reason over the actual news
        # (persisted to theme_news by persist_theme_news → read by
        # q1_agent.aggregate_context). Each item is source-tagged; a "mock_"
        # prefix marks fallback data (see reddit_client / brave_client).
        headlines = [
            {"source": n.get("source", "brave"), "text": n["headline"], "date": n.get("date", "")}
            for n in news
        ] + [
            {"source": p.get("source", "reddit"), "text": p["title"], "date": p.get("date", "")}
            for p in posts
        ]

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

        # Per-day mention counts over the full correlation window. Momentum reads
        # the trailing 7; the price correlation reads all CORR_WINDOW_DAYS so the
        # series has enough spread to correlate (ADR-0028 root cause).
        daily_counts_full = []
        for i in range(CORR_WINDOW_DAYS):
            d = (run_date - timedelta(days=i)).isoformat()[:10]
            cnt = sum(1 for n in news if n.get("date", "")[:10] == d)
            cnt += sum(1 for p in posts if p.get("date", "")[:10] == d)
            daily_counts_full.append(cnt)
        daily_counts = daily_counts_full[:7]   # trailing 7 → momentum

        mention_count_7d_avg = float(pd.Series(daily_counts).mean())
        mention_count_7d_std = float(pd.Series(daily_counts).std()) if len(daily_counts) > 1 else 0.0
        # Robust median/MAD z-score instead of a raw mean/std z-score: a single
        # viral or quiet day shouldn't swing the momentum term (see ADR-0021).
        momentum_raw, momentum_degenerate = robust_momentum(mention_count_1d, daily_counts)
        if momentum_degenerate:
            print(f"[build_theme_signals] {theme_name}: flat 7-day mention window "
                  f"(no spread); momentum defaults to 0.")

        # Price correlation per mapped asset.
        # Prefer assets for today's run_date; fall back to the most recent
        # entry for this theme so bootstrap timing doesn't zero out CorrScore.
        assets = supabase.table("theme_assets").select("ticker").eq("theme_id", theme["id"]).eq("run_date", today_str).execute().data
        if not assets:
            assets = supabase.table("theme_assets").select("ticker").eq("theme_id", theme["id"]).order("run_date", desc=True).limit(20).execute().data
        tickers = [a["ticker"] for a in assets]
        price_df = fetch_price_data(tickers, lookback_days=CORR_WINDOW_DAYS + 10)

        # Build the mention series over the full correlation window (30d), not 7.
        mention_series = pd.Series({
            (run_date - timedelta(days=i)).isoformat()[:10]: daily_counts_full[i]
            for i in range(CORR_WINDOW_DAYS)
        })

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
            "headlines": headlines,
            "data_source": _classify_data_source(headlines),
        })

    return results


# ─── Step 4: Compute HypeScores ───────────────────────────────────────────────
def compute_hype_scores(raw_signals: list[dict], cfg: ScoringConfig) -> list[dict]:
    return services_hype_compute_hype_scores(raw_signals, cfg)


# ─── Step 5: Compute TradeScores ──────────────────────────────────────────────────────────────────
def compute_trade_scores(hyped: list[dict], run_date: date) -> list[dict]:
    cfg = load_config()

    # Most-recent prior snapshot per theme, in ONE round-trip, feeding BOTH
    # HypeMomentum (needs yesterday's hype_score) and elapsed_days (needs
    # yesterday's date). The original code looked for a row dated *exactly*
    # run_date - 1 day, so any gap in the cadence -- a weekend, a missed run, or
    # several runs on one calendar day -- left hype_yesterday empty and collapsed
    # the 0.55-weighted momentum term to 0. We now take the latest prior row per
    # theme, and for momentum the latest prior row that actually carries a
    # non-null hype_score (ADR-0029). Momentum stays 0 only when no prior run has
    # ever persisted a hype_score for that theme -- self-heals once the daily job
    # writes one, which persist() does.
    prior_hype: dict[str, float] = {}
    prior_run_dates: dict[str, date] = {}
    try:
        prior_rows = (
            supabase.table("theme_signals_history")
            .select("theme_id, run_date, hype_score")
            .lt("run_date", run_date.isoformat())
            .order("run_date", desc=True)
            .execute()
            .data
        )
        for r in prior_rows:
            tid = r["theme_id"]
            if tid not in prior_run_dates:
                prior_run_dates[tid] = date.fromisoformat(r["run_date"])
            if tid not in prior_hype and r.get("hype_score") is not None:
                prior_hype[tid] = r["hype_score"]
    except Exception as exc:
        print(f"[compute_trade_scores] prior-run lookup failed "
              f"({exc.__class__.__name__}): {exc}. HypeMomentum will be 0 and "
              f"elapsed_days default to 1. Apply migration 003 if hype_score is missing.")

    scored = []
    missing_prior = 0
    missing_hype = 0
    for r in hyped:
        theme_id = r["theme_id"]

        # Momentum baseline: the most recent prior hype_score. A theme with no
        # usable prior falls back to today's own score, which zeroes momentum
        # (TradeScore becomes sentiment-only) rather than crashing.
        hype_yest = prior_hype.get(theme_id)
        if hype_yest is None:
            hype_yest = r["hype_score"]
            missing_hype += 1

        pdate = prior_run_dates.get(theme_id)
        if pdate is None:
            elapsed_days = 1
            missing_prior += 1
        else:
            elapsed_days = max(1, (run_date - pdate).days)

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
    if missing_hype:
        print(f"[compute_trade_scores] NOTE: no prior hype_score for "
              f"{missing_hype}/{len(hyped)} themes; HypeMomentum=0 for those "
              f"until a prior run persists hype_score.")
    return scored


# Trailing window for the Value z-score, in observations. Must match
# scripts/backtest_edge.py::Z_WINDOW — that backtest is what set
# edge_value_weight (ADR-0033), so a production window of a different length
# means the weight was fitted on a signal the pipeline does not compute.
VALUE_Z_WINDOW = 252
# Below this the level is not z-scored at all (Value stays absent → 0) rather
# than scored against a window too short to define "normal".
VALUE_Z_MIN_OBS = 60


def _macro_zscores() -> dict[str, float]:
    """z-score of each macro series' latest level vs its trailing history
    (macro_daily_history, migration 005). Feeds the EdgeScore Value component.

    Queried PER SERIES. The previous single unpartitioned query
    (`.order(trading_date, desc).limit(5000)`) had two compounding defects:
    PostgREST silently caps a response at 1000 rows, so `.limit(5000)` returned
    1000; and because the ordering was global rather than per series, that budget
    was split across all 22 series at once. Each series therefore got
    1000/22 ≈ 50 observations instead of its full ~252 — a 2.5-month window
    masquerading as a one-year valuation anchor. The only guard (`>= 20`) passed
    trivially at 50, so it degraded silently: the live 2026-07-24
    `value_signal = -0.8085` matches the 54-observation z, not the 265-observation
    one. Value is 0.18 of EdgeScore and EdgeScore's sign picks the side, so the
    truncation moved real trade direction.
    """
    z: dict[str, float] = {}
    # Enumerate the series from macro_indicators (one row per series per fetch —
    # tens of rows), NOT from macro_daily_history. Selecting series_id off the
    # history table is itself truncated by the same 1000-row cap, and because rows
    # cluster by series physically it returned only ^DJI/^NDX/^RUT/^SPX — so the
    # two series Value actually consumes were silently never scored.
    try:
        ids = (
            supabase.table("macro_indicators")
            .select("series_id")
            .execute()
            .data
        ) or []
    except Exception as exc:
        print(f"[_macro_zscores] macro_indicators unavailable "
              f"({exc.__class__.__name__}): {exc}. EdgeScore Value component = 0.")
        return z

    series_ids = sorted({r["series_id"] for r in ids if r.get("series_id")})
    if not series_ids:
        print("[_macro_zscores] no series in macro_indicators — Value component = 0.")
        return z
    short: list[str] = []
    for sid in series_ids:
        try:
            rows = (
                supabase.table("macro_daily_history")
                .select("value, trading_date")
                .eq("series_id", sid)
                .order("trading_date", desc=True)
                .limit(VALUE_Z_WINDOW)
                .execute()
                .data
            ) or []
        except Exception as exc:
            print(f"[_macro_zscores] {sid}: read failed "
                  f"({exc.__class__.__name__}); skipped.")
            continue

        vals = [float(r["value"]) for r in rows if r.get("value") is not None]
        if len(vals) < VALUE_Z_MIN_OBS:
            short.append(f"{sid}({len(vals)})")
            continue
        latest = vals[0]                 # newest-first, so [0] is today's level
        # Population stdev over the window INCLUDING the latest point is fine at
        # n≈252; it would bias materially at n≈50, which is the window we just
        # stopped silently using.
        sd = pstdev(vals)
        if sd > 0:
            z[sid] = (latest - fmean(vals)) / sd

    if short:
        print(f"[_macro_zscores] skipped (< {VALUE_Z_MIN_OBS} obs): {', '.join(short)}")
    scored_n = len(z)
    print(f"[_macro_zscores] z-scored {scored_n}/{len(series_ids)} series "
          f"over a {VALUE_Z_WINDOW}-observation window.")
    return z


def _conviction(edge: float, vol: float, vol_floor: float) -> float:
    """Signal strength per unit of risk, with the risk floored (ADR-0047).

    conviction = |EdgeScore| / max(vol, floor), and the floor is the whole point.
    Unfloored, the ratio stops describing the idea and starts describing the
    denominator: on 2026-07-25 BIL — a 0-3 month T-bill ETF with 0.19% ANNUALISED
    realised vol — scored 2375x against a book median of 16x, 109x the next name,
    while SLV at 74.6% annualised scored 9.1x. That does not say BIL was 260x the
    better idea than SLV; it says BIL barely moves.

    It is not only a display artefact. allocate_portfolio(size_by="conviction")
    weights by this number, so a cash-like instrument absorbs the book until the
    single-name cap stops it — inverse-vol sizing pushed past the point where it
    scales risk and into simply seeking the least volatile thing available.

    The floor is ABSOLUTE, not a percentile of the day's names. A relative floor
    would make conviction a statement about the day's peer group rather than about
    the asset, which is exactly what ADR-0042 removed from HypeScore.

    A zero or missing vol falls back to |edge| / floor rather than to |edge| — the
    old fallback silently put an unpriceable name at the BOTTOM of the conviction
    ranking (|edge| <= 1 against a book of 9-30), which reads as low conviction
    when the truth is no measurement.
    """
    floor = max(vol_floor, 0.0)
    denom = max(vol, floor)
    if denom <= 0:
        return abs(edge)     # floor disabled AND no vol: nothing left to scale by
    return abs(edge) / denom


# ─── Step 6: Persist themes + signals history ─────────────────────────────────
def compute_edge_scores(
    scored: list[dict],
    theme_assets_map: dict[str, list[str]],
    regime,
    cfg: ScoringConfig,
    macro_snapshot: dict | None = None,
    asset_edges: dict | None = None,
) -> list[dict]:
    """Attach EdgeScore (direction signal) + conviction to each theme (ADR-0031/0032).

    If ``asset_edges`` is passed (a dict), it is populated with
    ``{(theme_id, asset): {edge_score, trend_signal, ...}}`` — the PER-ASSET score,
    which is what actually sets each position's side (ADR-0038).

    EdgeScore = w_trend·Trend + w_regime·RegimeFit + w_carry·Carry + w_value·Value,
    every component in [-1, 1]:
      Trend    — theme basket ~6-month price momentum      (Stage 1)
      RegimeFit— cycle×sentiment lean of the asset classes (Stage 2)
      Carry    — L0 yield/spread income (credit/rates/fx)  (Stage 3)
      Value    — z-score of L0 levels vs history, cheap=long (Stage 4)
    Direction = sign(EdgeScore), with abstention (|EdgeScore| < threshold) applied
    in rank_trade_candidates. `conviction` = |EdgeScore| / vol drives Stage-4
    sizing. Any unavailable component degrades to 0 (honest), never fabricated.
    """
    cycle = getattr(regime, "cycle", None)
    sentiment = getattr(regime, "sentiment", None)
    # Continuous risk appetite (ADR-0041) rather than the discrete label. The label
    # is a step function and EdgeScore multiplies it by each asset class's risk beta,
    # so a label change inverts the equity complex on its own.
    appetite = risk_appetite(
        getattr(regime, "vix_level", None),
        getattr(regime, "hy_oas", None),
        getattr(regime, "vix_term_diff", None),
        getattr(regime, "spx_breadth", None),
    )
    if appetite is not None:
        print(f"[compute_edge_scores] risk appetite {appetite:+.3f} "
              f"(label: {cycle}/{sentiment})")
    macro_z = _macro_zscores()
    if asset_edges is None:
        asset_edges = {}

    # One price pull for every asset (6-month window) → trailing basket return
    # (Trend) and daily-return vol (inverse-vol sizing).
    all_assets = sorted({a for assets in theme_assets_map.values() for a in assets})
    ret_by_asset: dict[str, float] = {}
    vol_by_asset: dict[str, float] = {}
    if all_assets:
        try:
            price_df = fetch_price_data(all_assets, lookback_days=EDGE_TREND_WINDOW_DAYS)
            for a in all_assets:
                closes = price_df[price_df["ticker"] == a].sort_values("date")["close"].astype(float)
                if len(closes) >= 2:
                    first, last = float(closes.iloc[0]), float(closes.iloc[-1])
                    if first > 0:
                        ret_by_asset[a] = last / first - 1.0
                    daily = closes.pct_change().dropna()
                    if len(daily) >= 2 and float(daily.std()) > 0:
                        vol_by_asset[a] = float(daily.std())
        except Exception as exc:
            print(f"[compute_edge_scores] price fetch failed ({exc.__class__.__name__}): "
                  f"{exc}. Trend/vol default to 0.")

    missing_trend = 0
    for r in scored:
        assets = theme_assets_map.get(r["theme_id"], [])
        returns = {a: ret_by_asset.get(a) for a in assets}
        if not any(v is not None for v in returns.values()):
            missing_trend += 1
        trend = theme_trend(returns)
        acs = [classify(a)["asset_class"] for a in assets if is_classified(a)]
        rbias = theme_regime_bias(acs, cycle, sentiment, appetite)
        # Average over the asset classes where the component is COMPUTABLE, and
        # stay None when it is computable for none of them. A theme spanning rates
        # and commodities (Inflation holds TIPS alongside GLD/SLV) gets its carry
        # from the rates leg only — averaging a real number against a placeholder
        # 0.0 for the commodity leg would halve a signal that is not actually
        # weaker, and then compare it to the same abstention band.
        carry_vals = [c for ac in acs if (c := carry_signal(ac, macro_snapshot)) is not None]
        value_vals = [v for ac in acs if (v := value_signal(ac, macro_z)) is not None]
        carry = fmean(carry_vals) if carry_vals else None
        value = fmean(value_vals) if value_vals else None
        sentiment_tilt = sentiment_signal(r.get("avg_sentiment"))
        edge = compute_edge_score(
            trend, rbias, carry, value, sentiment_tilt,
            w_trend=cfg.edge_trend_weight, w_regime=cfg.edge_regime_weight,
            w_carry=cfg.edge_carry_weight, w_value=cfg.edge_value_weight,
            w_sentiment=cfg.edge_sentiment_weight,
        )
        vols = [vol_by_asset[a] for a in assets if a in vol_by_asset]
        theme_vol = fmean(vols) if vols else 0.0

        r["trend_signal"] = trend
        r["regime_bias"] = rbias
        r["carry_signal"] = carry
        r["value_signal"] = value
        r["sentiment_signal"] = sentiment_tilt
        r["edge_score"] = edge
        r["vol"] = theme_vol
        # Conviction for Stage-4 sizing: signal strength scaled by inverse vol,
        # with vol floored (ADR-0047) so the ratio measures the idea, not the
        # denominator.
        r["conviction"] = _conviction(edge, theme_vol, cfg.conviction_vol_floor)

        # ── Per-asset EdgeScore (ADR-0038) ───────────────────────────────────────
        # Everything above is the THEME average. Four of the five components are
        # natively per-asset or per-asset-class — trend and vol come from each
        # ticker's own prices, and regime/carry/value from its own asset class — so
        # averaging them across a theme destroys real, tradeable dispersion before
        # anything gets to use it. Only sentiment is genuinely theme-wide.
        #
        # The cost was concrete: GLD was held LONG inside Fed Policy, Inflation, US
        # Dollar AND Geopolitical Risk simultaneously, because each of those themes
        # averaged to a positive edge — while GLD's own trend and regime scored it
        # -0.44. The book was long an asset every asset-level signal said to short.
        for a in assets:
            if not is_classified(a):
                continue
            ac = classify(a)["asset_class"]
            a_ret = ret_by_asset.get(a)
            # Same squash theme_trend applies, on this one asset instead of the
            # basket mean — a single-asset dict IS the per-asset case of it, so the
            # two can never drift apart.
            a_trend = None if a_ret is None else theme_trend({a: a_ret})
            a_carry = carry_signal(ac, macro_snapshot)
            a_value = value_signal(ac, macro_z)
            a_edge = compute_edge_score(
                a_trend,
                regime_direction_bias(ac, cycle, sentiment, appetite),
                a_carry,
                a_value,
                sentiment_tilt,      # theme-wide by construction — news is about the theme
                w_trend=cfg.edge_trend_weight, w_regime=cfg.edge_regime_weight,
                w_carry=cfg.edge_carry_weight, w_value=cfg.edge_value_weight,
                w_sentiment=cfg.edge_sentiment_weight,
            )
            a_vol = vol_by_asset.get(a, 0.0)
            # Persist None as None. `compute_edge_score` above is handed the real
            # values and renormalises over the ones that exist (ADR-0036) — but these
            # columns used to coerce None to 0.0, so the row said "zero tilt" where the
            # truth was "not computable". ADR-0036's own docstring calls that out:
            # scoring a missing component as 0 is not neutral.
            #
            # Measured on the live 2026-07-25 book, the damage is exact: eight of nine
            # positions satisfy persisted_edge == naive_sum / 0.48, because the score
            # was renormalised over trend+regime+sentiment while carry and value were
            # written as 0. The score is right and the components contradict it, so
            # /book's per-position decomposition cannot reconcile by construction and
            # EdgeBars reports "differs from the sum of shown components by +0.224" —
            # true that they differ, wrong about why (ADR-0066).
            #
            # Only display and reconciliation read these columns; the score itself is
            # computed from the values above, so nothing downstream changes sign or size.
            asset_edges[(r["theme_id"], a)] = {
                "edge_score": a_edge,
                "trend_signal": a_trend,
                "regime_bias": regime_direction_bias(ac, cycle, sentiment, appetite),
                "carry_signal": a_carry,
                "value_signal": a_value,
                "sentiment_signal": sentiment_tilt,
                "vol": a_vol,
                "conviction": _conviction(a_edge, a_vol, cfg.conviction_vol_floor),
            }

    if missing_trend:
        print(f"[compute_edge_scores] NOTE: no price data for "
              f"{missing_trend}/{len(scored)} themes; their Trend/vol are 0.")
    return scored


def persist(run_date: date, scored: list[dict]):
    today_str = run_date.isoformat()

    for r in scored:
        theme_id = r["theme_id"]
        # The four persisted sub-scores MUST be the exact values hype_score() was
        # computed from, or they cannot reproduce the persisted score and the
        # derivation drawer silently disagrees with itself. As of ADR-0042 all four
        # are ABSOLUTE — each a function of this theme's own signal against a
        # documented anchor — so they are computed with the same helpers
        # compute_hype_scores uses, not re-derived here.
        vol_norm = volume_subscore(volume_base(r))

        # Update themes table. The SIGN of correlation is preserved on the
        # history row below as signed_corr + crowding for the trade/risk layer.
        #
        corr_score = corr_subscore(r["price_corr"])
        supabase.table("themes").update({
            "hype_score": r["hype_score"],
            "volume_score": vol_norm,
            "sentiment_score": rescale_vader(r["avg_sentiment"]),
            "corr_score": corr_score,
            "momentum_score": momentum_subscore(r["momentum_raw"]),
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
        base_history = {
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
        }
        # signed_corr + crowding (migration 019) preserve the correlation sign
        # HypeScore folds. Fall back to the base row if the columns aren't
        # deployed yet, so an un-applied migration never breaks the pipeline.
        enriched_history = {
            **base_history,
            "signed_corr": r["price_corr"],
            "crowding": crowding_label(r["price_corr"], volume_norm=vol_norm),
            "data_source": r.get("data_source"),
            # EdgeScore direction signal + components (migrations 023–024).
            "edge_score": r.get("edge_score"),
            "trend_signal": r.get("trend_signal"),
            "regime_bias": r.get("regime_bias"),
            "carry_signal": r.get("carry_signal"),
            "value_signal": r.get("value_signal"),
            "sentiment_signal": r.get("sentiment_signal"),
            "conviction": r.get("conviction"),
            "vol": r.get("vol"),
        }
        try:
            supabase.table("theme_signals_history").upsert(
                enriched_history, on_conflict="theme_id,run_date"
            ).execute()
        except Exception as exc:
            print(f"[{today_str}] WARN: crowding columns unavailable "
                  f"({exc.__class__.__name__}); apply migration 019. "
                  f"Writing base signals row.")
            supabase.table("theme_signals_history").upsert(
                base_history, on_conflict="theme_id,run_date"
            ).execute()

    print(f"[{today_str}] Refresh complete. {len(scored)} themes updated.")


def _safe_iso_date(s: str | None) -> str | None:
    """Coerce a value to an ISO date string, or None. Guards theme_news writes
    against non-ISO dates (e.g. Brave's occasional relative "2 days ago")
    poisoning the whole batch upsert."""
    try:
        return date.fromisoformat((s or "")[:10]).isoformat()
    except (ValueError, TypeError):
        return None


def persist_theme_news(run_date: date, scored: list[dict]) -> int:
    """Upsert the raw collected headlines/posts into `theme_news` so the L5 agent
    can reason over actual news (see q1_agent._load_recent_headlines).

    Best-effort: if migration 018 has not been applied (table missing), log and
    continue — the rest of the pipeline, and the L5 agent's macro-only fallback,
    are unaffected. Returns the number of rows written.
    """
    today_str = run_date.isoformat()
    # ANDROMEDA_ALLOW_MOCK gates whether mock is GENERATED; this also gates
    # whether any mock_* headline is PERSISTED, so a synthetic row can never
    # reach the frontend when mock is disabled — even if some path produced one.
    allow_mock = os.environ.get("ANDROMEDA_ALLOW_MOCK", "0") not in ("0", "false", "False", "")
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    dropped_mock = 0
    for r in scored:
        theme_id = r["theme_id"]
        for h in r.get("headlines", []) or []:
            text = (h.get("text") or "").strip()
            if not text:
                continue
            source = h.get("source", "unknown")
            if not allow_mock and str(source).startswith("mock_"):
                dropped_mock += 1
                continue
            key = (str(theme_id), text[:1000])
            if key in seen:
                continue   # dedupe within the batch to respect the unique key
            seen.add(key)
            rows.append({
                "theme_id": theme_id,
                "run_date": today_str,
                "source": source,
                "headline": text[:1000],
                "published_date": _safe_iso_date(h.get("date")),
            })
    if dropped_mock:
        print(f"[{today_str}] persist_theme_news: dropped {dropped_mock} mock headline(s) "
              f"(ANDROMEDA_ALLOW_MOCK=0).")

    if not rows:
        return 0

    # Idempotent re-run: REPLACE this run's news rather than accumulate. Without
    # the prune, mock rows from an earlier mock-allowed run of the SAME day linger
    # (they don't collide on (theme_id,run_date,headline) with today's real
    # headlines) and surface as synthetic data on the frontend. Best-effort: a
    # prune failure must not skip the write.
    try:
        supabase.table("theme_news").delete().eq("run_date", today_str).execute()
    except Exception as exc:
        print(f"[{today_str}] persist_theme_news: prune of prior rows failed "
              f"({exc.__class__.__name__}); continuing to write.")

    try:
        supabase.table("theme_news").upsert(
            rows, on_conflict="theme_id,run_date,headline"
        ).execute()
    except Exception as exc:
        print(f"[{today_str}] WARN: theme_news upsert failed ({exc.__class__.__name__}); "
              f"L5 will fall back to macro-only context. Apply migration 018.")
        return 0

    print(f"[{today_str}] {len(rows)} headlines persisted to theme_news.")
    return len(rows)


# ─── Step 6b (L2): Refresh factor exposures for the tradable universe ────────
def refresh_factor_exposures(run_date: date, lookback_days: int = 252) -> int:
    """Recompute FF5+UMD betas for every ticker the book can hold.

    L2 was never part of this pipeline: `daily_refresh` orchestrated L0, L1, L3,
    L4 and L5 and never imported `factor_fetcher`, so `factor_exposures` was only
    ever populated by ad-hoc invocation. Nothing guaranteed the betas L5 reasons
    over were computed against the same run as everything else, and
    `pipeline_runs` had no L2 row to audit.

    Downstream consumers of a stale/absent beta all degrade silently:
    `screen_candidates` skips its R^2 gate, `compute_book_metrics` returns
    all-zero tilts, and `scenario_analysis` falls through to hand-written
    DEFAULT_TICKER_BETAS. Running it here makes the whole chain honest.

    Returns the number of exposures upserted.
    """
    from backend.data.factor_fetcher import FactorFetcher

    today_str = run_date.isoformat()
    universe = sorted(set(SECTOR_MAP.keys()))

    fetcher = FactorFetcher(
        SUPABASE_URL, SUPABASE_KEY,
        data_dir=str(Path(__file__).parent.parent / "backend" / "data"),
    )

    # One download for the whole universe; regressions need ~1.5y to fill a
    # 252-day window after non-trading days are dropped.
    price_df = fetch_price_data(universe, lookback_days=lookback_days * 2)
    if price_df.empty:
        print(f"[{today_str}] [L2] No price data for the universe; skipping factor refresh.")
        return 0

    exposures: list[dict] = []
    skipped: list[str] = []
    for ticker in universe:
        sub = price_df[price_df["ticker"] == ticker].sort_values("date")
        if len(sub) < lookback_days + 1:
            skipped.append(ticker)
            continue
        returns = pd.Series(
            sub["close"].pct_change().dropna().values,
            index=pd.to_datetime(sub["date"].iloc[1:].values),
        )
        try:
            row = fetcher.compute_exposures(ticker, returns, run_date, lookback_days)
        except Exception as exc:
            print(f"[{today_str}] [L2] {ticker}: regression failed ({exc.__class__.__name__}).")
            continue
        if row:
            exposures.append(row)
        else:
            skipped.append(ticker)

    written = fetcher.upsert_exposures(exposures)
    print(
        f"[{today_str}] [L2] {written} factor exposures upserted "
        f"({len(skipped)} skipped for insufficient history: {skipped[:8]}"
        f"{'...' if len(skipped) > 8 else ''})."
    )
    return written


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
    asset_edges: dict | None = None,
) -> tuple[list[TradeCandidate], list[TradeCandidate]]:
    theme_ids = [s["theme_id"] for s in scored]
    theme_assets_map = load_theme_assets_map(theme_ids, run_date)

    # min_side=1 guarantees the book is never one-sided while opposite-sign
    # signal exists: if every hype-eligible theme shares one direction, the thin
    # side is backfilled from the strongest sub-threshold theme (ADR-0029).
    # score_key="edge_score": direction + intra-side ranking use the EdgeScore
    # (trend + regime + carry + value), not sign(near-zero sentiment) (ADR-0031).
    # abstain_threshold: a theme with |EdgeScore| below it is dropped rather than
    # forced into a low-conviction position (Stage-4 abstention, ADR-0032).
    # asset_edges (ADR-0038): the theme still gates what is in scope, but each asset
    # takes the side its OWN EdgeScore implies. Without it every asset inherited the
    # theme's direction, which is how GLD came to be held long inside four separate
    # themes while its own trend and regime scored it -0.44.
    # conviction_override (ADR-0046): a theme below the attention gate is still
    # expanded when one of its assets carries a decisive edge. Attention decides
    # what we look at; it should not silently decide what is tradable.
    longs, shorts = rank_trade_candidates(
        scored, theme_assets_map, cfg.hype_score_threshold,
        top_n=5, min_side=1, score_key="edge_score",
        abstain_threshold=cfg.edge_abstain_threshold,
        asset_edges=asset_edges,
        conviction_override=(cfg.edge_conviction_override or None),
    )

    # Drop any candidate whose ticker isn't in all three taxonomy maps before it
    # reaches allocate_portfolio / compute_book_metrics, which hard-index the
    # maps. theme_discovery can surface a ticker nobody has mapped yet; letting
    # it through aborts the whole run, so we drop that one position and log it
    # loudly instead. The maps are kept co-extensive and enforced by a test, so
    # this only fires for a genuinely new ticker.
    def _keep_classified(cands: list[TradeCandidate]) -> list[TradeCandidate]:
        kept, dropped = [], []
        for c in cands:
            (kept if is_classified(c.asset) else dropped).append(c)
        if dropped:
            print(f"[{run_date.isoformat()}] WARNING dropped {len(dropped)} "
                  f"unclassified candidate(s): {sorted(c.asset for c in dropped)}. "
                  f"Add them to SECTOR_MAP/GEO_MAP/_ASSET_CLASS_MAP.")
        return kept

    longs = _keep_classified(longs)
    shorts = _keep_classified(shorts)

    today_str = run_date.isoformat()

    # Clear THIS run_date before writing, so a re-run REPLACES the day's candidate
    # set instead of unioning with it. The upsert keys on (theme_id, asset,
    # direction), so a second run that picks different names simply adds rows and
    # leaves the first run's behind: two runs on 2026-07-24 (Energy XLE/OIH/CL/UNG,
    # then Credit HYG/LQD) left all six live at once. Same prune-before-write shape
    # persist_theme_news already uses.
    try:
        supabase.table("trade_candidates").delete().eq("run_date", today_str).execute()
    except Exception as exc:
        print(f"[{today_str}] WARNING failed to clear trade_candidates for this run "
              f"({exc.__class__.__name__}): {exc}")

    # ONE request for the whole pool, the same shape persist_theme_news already
    # uses. This was a per-candidate loop: 39 sequential round-trips, none wrapped,
    # so any single transient failure aborted the entire daily pipeline. It did —
    # on 2026-07-25 a Supabase HTTP/2 ConnectionTerminated on one of the 39 killed
    # the run after L0-L1 had completed, with no book produced. Thirty-eight of
    # those requests bought nothing but thirty-eight more chances to fail.
    #
    # run_date is stamped on every row so readers can tell today's candidates from
    # a previous run's.
    rows = [
        {**c.to_trade_candidate_row(today_str), "run_date": today_str}
        for c in longs + shorts
    ]
    if rows:
        supabase.table("trade_candidates").upsert(
            rows, on_conflict="theme_id,asset,direction"
        ).execute()

    # Delete any candidate left over from an EARLIER DAY. A zero-candidate day
    # correctly empties the table.
    try:
        supabase.table("trade_candidates").delete().lt("run_date", today_str).execute()
    except Exception as exc:
        print(f"[{today_str}] WARNING failed to prune stale trade_candidates "
              f"({exc.__class__.__name__}): {exc}")

    print(f"[{today_str}] {len(longs)} long + {len(shorts)} short trade candidates persisted.")
    return longs, shorts


# ─── Step 9 (Phase 3): Allocate + persist portfolio positions ────────────────
def allocate_and_persist_portfolio(
    candidates: list[TradeCandidate],
    run_date: date,
    cfg: ScoringConfig,
) -> list[tuple[TradeCandidate, float, float]]:
    # size_by="conviction": weight ∝ |EdgeScore| / vol (conviction × inverse-vol),
    # not ∝ HypeScore — sizing follows edge strength and risk, not popularity
    # (Stage-4, ADR-0032). Falls back to hype weighting if no conviction is present.
    positioned = allocate_portfolio(
        candidates, cfg.total_capital,
        sector_map=SECTOR_MAP, geo_map=GEO_MAP,
        size_by="conviction",
    )

    today_str = run_date.isoformat()

    # Clear THIS run_date first — a re-run must REPLACE the day's book, not union
    # with it. Two runs on 2026-07-24 left six positions live (Energy at 25% each
    # PLUS Credit at 50% each), so the book read as 200% gross / $200M on $100M of
    # capital, and every /risk figure computed off it — gross, HHI, factor tilts,
    # per-position attribution, and a phantom "500% of the single-name cap" breach —
    # was measured against a portfolio that never existed.
    try:
        supabase.table("portfolio_positions").delete().eq("run_date", today_str).execute()
    except Exception as exc:
        print(f"[{today_str}] WARNING failed to clear portfolio_positions for this run "
              f"({exc.__class__.__name__}): {exc}")

    # One request, same reason as the candidate write above: a per-row loop is N
    # sequential chances for a transient connection drop to abort the daily run.
    # Without run_date a stale book is indistinguishable from the current one.
    rows = [
        {**c.to_portfolio_position_row(notional, weight), "run_date": today_str}
        for c, notional, weight in positioned
    ]
    if rows:
        supabase.table("portfolio_positions").upsert(
            rows, on_conflict="theme_id,asset,direction"
        ).execute()

    # Prune positions left over from an EARLIER DAY. A zero-position day empties
    # the table.
    try:
        supabase.table("portfolio_positions").delete().lt("run_date", today_str).execute()
    except Exception as exc:
        print(f"[{today_str}] WARNING failed to prune stale portfolio_positions "
              f"({exc.__class__.__name__}): {exc}")

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

    # A batch yfinance download silently drops tickers now and then. Retry just the
    # missing ones, individually, before treating the gap as real.
    #
    # On 2026-07-24 the whole run died on `missing prices for ['EMB']` — one of
    # eighteen positions, and a liquid ETF that fetched fine seconds later. The guard
    # below is right to refuse to invent a return, but aborting the pipeline over a
    # transient batch hiccup threw away L4 risk and the entire L5 book and thesis for
    # the day. For something billed as a DAILY process, losing a day to a dropped
    # quote is the more serious failure.
    #
    # This does not weaken the contract: a ticker that is still missing after its own
    # dedicated fetch aborts exactly as before. It only stops a batch artefact from
    # masquerading as absent data.
    stragglers = [t for t, (px, _) in price_lookup.items() if px is None]
    if stragglers:
        print(f"[{today_str}] price gap for {stragglers}; retrying individually...")
        for ticker in stragglers:
            try:
                retry = fetch_price_data([ticker], lookback_days=5)
            except Exception as exc:
                print(f"[{today_str}]   {ticker} retry failed "
                      f"({exc.__class__.__name__}): {exc}")
                continue
            sub = retry[retry["ticker"] == ticker].sort_values("date")
            if len(sub) >= 2:
                price_lookup[ticker] = (
                    float(sub.iloc[-1]["close"]),
                    float(sub.iloc[-2]["close"]),
                )
                print(f"[{today_str}]   {ticker} recovered on retry.")

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

    # Since-inception cumulative: compound EVERY prior daily return with today's.
    #
    # This column used to be written as `daily` with a "recompute when history is
    # sufficient" note that was never implemented — so `cumulative_return` was
    # ALWAYS just that day's return. The /risk drawdown chart reads this column as
    # its cumulative series, which meant the curve (and the max-drawdown computed
    # from it, and portfolio_value) were a daily-return series wearing a
    # cumulative label. Surfaced by reconciling against portfolio_cumulative_return,
    # which compounds correctly: +0.73% persisted vs -0.68% here on 2026-07-24.
    _prior_raw = (
        supabase.table("portfolio_returns")
        .select("run_date, daily_return")
        .lt("run_date", today_str)
        .order("run_date")
        .execute()
        .data
    )
    # Only treat the response as history when it really is a list of rows — a
    # failed/!=200 read can hand back None, and it keeps this honest under test doubles.
    prior_rows = _prior_raw if isinstance(_prior_raw, list) else []
    series = [
        float(r["daily_return"])
        for r in prior_rows
        if r.get("daily_return") is not None
    ]
    series.append(daily)
    inception = (
        date.fromisoformat(prior_rows[0]["run_date"]) if prior_rows else run_date
    )
    cumulative = float(compute_cumulative_return(series, inception=inception)["value"])

    # Book value follows the compounded path, not one day's move.
    portfolio_value = total_capital * (1 + cumulative)

    supabase.table("portfolio_returns").upsert({
        "run_date": today_str,
        "daily_return": daily,
        "cumulative_return": cumulative,
        "portfolio_value": portfolio_value,
    }, on_conflict="run_date").execute()

    print(f"[{today_str}] Daily portfolio return: {daily:+.4%} (value ${portfolio_value:,.0f}).")
    return daily


# ─── Step 11 (Phase 3): Compute + persist risk derivations ─────────────────────────
def _derivation_to_dict(d) -> dict:
    """Serialize a NumericDerivation dataclass to a JSON-safe dict.

    asdict() leaves datetime fields (computed_at, as_of, freshness timestamps) as
    datetime objects, which the PostgREST client cannot json-encode — the
    numeric_derivations JSONB write raised TypeError and silently degraded to
    scalar-only. Round-tripping through json with default=str coerces datetimes
    (and any other exotic type) to strings so the bundle actually persists.
    """
    from dataclasses import asdict
    import json
    return json.loads(json.dumps(asdict(d), default=str))


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
    # Keep the dates so compute_risk can align beta by date, not list position.
    history_dates = (
        [pd.Timestamp(d).strftime("%Y-%m-%d") for d in history_series.index]
        if len(history_series) else None
    )

    spx_series = _load_spx_returns(252)
    spx_returns = [float(x) for x in spx_series.tolist()] if spx_series is not None else []
    spx_dates = (
        [pd.Timestamp(d).strftime("%Y-%m-%d") for d in spx_series.index]
        if spx_series is not None else None
    )

    # Run date at UTC midnight - the "as_of" the snapshot was taken.
    as_of = datetime(run_date.year, run_date.month, run_date.day, tzinfo=timezone.utc)

    derivations = compute_risk(
        book=book,
        history=history,
        spx_returns=spx_returns,
        as_of=as_of,
        portfolio_value=total_capital,
        risk_free_annual=cfg.risk_free_annual,
        history_dates=history_dates,
        spx_dates=spx_dates,
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
        # numeric_derivations column missing, or a serialization issue - fall
        # back to scalar-only so the legacy contract still works. Must stay an
        # UPSERT: a plain insert violates the run_date unique key (migration 016)
        # on any same-day re-run and would abort the pipeline before L5.
        print(
            f"[{today_str}] WARN: numeric_derivations upsert failed ({exc.__class__.__name__}): "
            f"falling back to scalar-only upsert."
        )
        row.pop("numeric_derivations", None)
        supabase.table("portfolio_risk").upsert(row, on_conflict="run_date").execute()

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


# ─── Step 11b: Reconcile the book of record to what L5 actually published ────
def reconcile_positions_to_published_book(
    agent_result: dict | None,
    positioned: list[tuple[TradeCandidate, float, float]],
    run_date: date,
    cfg: ScoringConfig,
) -> list[tuple[TradeCandidate, float, float]] | None:
    """Rewrite `portfolio_positions` to the book L5 published, and return it.

    The app was publishing TWO different portfolios. `/book` shows L5's picks; the
    per-position attribution on `/risk`, the daily return and every risk statistic
    were computed from L1's provisional book, which L5 then re-picks a subset of.
    Observed 2026-07-24: `portfolio_positions` carried 12 names at 92.2% gross while
    the published book was 6 names at 98.9%, so **EFA, IWM, QQQ, SLV, SPY and XLV
    were being attributed risk on a page while appearing nowhere in the book**. A
    reviewer asking "do I own QQQ?" got yes on one page and no on the other.

    Worse than a display inconsistency: VaR, CVaR, Sharpe, Beta and HHI all described
    a portfolio nobody holds.

    L5 cannot invent tickers (ADR-0014 hard-filters its picks to the candidate set),
    so every published pick maps back to a candidate we already sized. We match on
    (asset, direction) and adopt L5's weights, which are already cap-respecting —
    `size_positions` delegates to the same `allocate_portfolio` (ADR-0037).

    This extends the ADR-0024 principle ("recompute analytics on the FINAL sized
    book") from tilts/scenarios/correlation to the positions, returns and risk. If
    L5 produced nothing usable, the L1 book stands and is returned unchanged — a
    fallback day still has a real, coherent portfolio.
    """
    picks = (agent_result or {}).get("picks") or []
    if not picks:
        return None

    by_key = {(c.asset, c.direction): c for c, _, _ in positioned}
    final: list[tuple[TradeCandidate, float, float]] = []
    unmatched: list[str] = []
    for p in picks:
        asset = p.get("asset")
        direction = p.get("direction")
        cand = by_key.get((asset, direction))
        if cand is None:
            unmatched.append(f"{direction} {asset}")
            continue
        weight = p.get("signed_weight")
        if weight is None:
            w = float(p.get("weight") or 0.0)
            weight = -w if direction == "short" else w
        notional = p.get("notional")
        if notional is None:
            notional = abs(float(weight)) * cfg.total_capital
        final.append((cand, float(notional), float(weight)))

    if unmatched:
        # Should be impossible under ADR-0014. Say so loudly rather than silently
        # publishing a book that disagrees with its own risk.
        print(f"[{run_date}] WARNING L5 published picks not in the candidate set: "
              f"{unmatched}. Book of record left as the L1 book.")
        return None
    if not final:
        return None

    today_str = run_date.isoformat()
    try:
        supabase.table("portfolio_positions").delete().eq("run_date", today_str).execute()
        # One request. Per-row here is worse than elsewhere: a drop midway leaves
        # the table holding PART of the published book with the rest deleted — a
        # portfolio that has never existed, presented as the book of record.
        supabase.table("portfolio_positions").upsert(
            [
                {**c.to_portfolio_position_row(notional, weight), "run_date": today_str}
                for c, notional, weight in final
            ],
            on_conflict="theme_id,asset,direction",
        ).execute()
    except Exception as exc:
        print(f"[{run_date}] WARNING failed to reconcile portfolio_positions to the "
              f"published book ({exc.__class__.__name__}): {exc}")
        return None

    print(f"[{run_date}] Book of record reconciled to L5: {len(final)} positions "
          f"(was {len(positioned)} from L1).")
    return final


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
            # Growth factor, not a return (ADR-0017). A fresh book has grown by
            # a factor of 1.0, i.e. 0%. Writing 0 here meant the reader rendered
            # a total loss of capital on day one.
            "cumulative_value": 1.0,
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
        # Growth factor per ADR-0017, NOT result["value"] (which is a return).
        "cumulative_value": result["growth_factor"],
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


def utc_run_date() -> date:
    """The run's date, in UTC — the same date the scheduled job would stamp.

    `date.today()` is the LOCAL calendar date, and the scheduled job
    (`daily-refresh.yml`, `30 21 * * 1-5`) runs on a UTC runner. A local run from a
    UTC+8 machine at 06:00 therefore stamps **tomorrow's** `run_date` relative to the
    same evening's scheduled run — 21:30 UTC on the 24th and 06:00 SGT on the 25th are
    the same instant, and produced `2026-07-24` and `2026-07-25` respectively.

    Observed live, not theorised: the scheduled run wrote 38 provisional positions at
    `run_date` 2026-07-24 while `research_recommendations` still held the 9-pick book a
    local run had published at 2026-07-25. `/risk` then computed every statistic on
    positions from one date beneath a header naming the other — caught only because
    iteration 32's ADR-0040 check compares position COUNT against the published picks
    and said *"38 held · 9 published"*.

    UTC also matches the trading date the book is for: 21:30 UTC is 17:30 ET, the same
    calendar day in both zones, so this changes nothing about the scheduled run and only
    brings ad-hoc local runs into line with it (ADR-0069).
    """
    return datetime.now(timezone.utc).date()


# ─── Main orchestration ──────────────────────────────────────────────────────
def main():
    run_date = utc_run_date()
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

    # Polymarket: forward macro odds for the homepage "what the crowd is pricing"
    # panel. Stored only for display context — NOT added to macro_snapshot, so the
    # L5 book neither reads nor cites them (the panel says as much).
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

    # ── Phase 5: L2 — Factor exposures ──────────────────────────────────────
    # Must run before L5: screen_candidates gates on R^2 and compute_book_metrics
    # weights by these betas. Previously absent from the pipeline entirely.
    print(f"[{run_date}] [L2] Refreshing FF5+UMD factor exposures...")
    l2_started = datetime.now(timezone.utc)
    l2_id = run_id_for(run_date, stage="L2")
    try:
        record_pipeline_run(supabase, l2_id, "started", run_date=run_date, stage="L2")
    except Exception as exc:
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
    try:
        n_exposures = refresh_factor_exposures(run_date)
        try:
            record_pipeline_run(
                supabase, l2_id, "success" if n_exposures else "partial",
                run_date=run_date, stage="L2",
                duration_s=(datetime.now(timezone.utc) - l2_started).total_seconds(),
            )
        except Exception as exc:
            print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
    except Exception as exc:
        # A failed factor refresh degrades L5 (zero tilts, default betas) but
        # must not stop the book being built. Recorded so it is visible.
        print(f"[{run_date}] [L2] Factor refresh failed ({exc.__class__.__name__}): {exc}")
        try:
            record_pipeline_run(
                supabase, l2_id, "failure", run_date=run_date, stage="L2",
                duration_s=(datetime.now(timezone.utc) - l2_started).total_seconds(),
                error=str(exc),
            )
        except Exception as exc2:
            print(f"[pipeline_runs] record failed ({exc2.__class__.__name__}): {exc2}")

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
    # L1 is instrumented like every other stage. It was not, and /method said so
    # honestly — "Last success: never — no row with status='success'" — while the
    # status bar next to it read "All stages complete · 4/4 succeeded", because 4/4
    # counted only the stages that report. Theme detection is the heart of Q2's
    # "daily process"; a process page that cannot say whether it ran is not
    # describing a process.
    l1_started = datetime.now(timezone.utc)
    l1_id = run_id_for(run_date, stage="L1")
    try:
        record_pipeline_run(supabase, l1_id, "started", run_date=run_date, stage="L1")
    except Exception as exc:
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")

    themes = load_themes()
    raw = build_theme_signals(themes, run_date)
    hyped = compute_hype_scores(raw, cfg)
    scored = compute_trade_scores(hyped, run_date)
    # EdgeScore direction signal (ADR-0031): price trend + regime fit. Computed
    # before persist/rank so the persisted signals AND the long/short direction
    # both use it, replacing sign(near-zero sentiment).
    theme_assets_map = load_theme_assets_map([s["theme_id"] for s in scored], run_date)
    # asset_edges is filled in place with the PER-ASSET EdgeScore (ADR-0038), which
    # is what sets each position's side. The theme-level score stays on `scored` for
    # the heatmap and the abstention roster.
    asset_edges: dict = {}
    scored = compute_edge_scores(scored, theme_assets_map, regime, cfg,
                                 macro_snapshot=macro_snapshot,
                                 asset_edges=asset_edges)
    persist(run_date, scored)
    persist_theme_news(run_date, scored)
    try:
        record_pipeline_run(
            supabase, l1_id, "success", run_date=run_date, stage="L1",
            duration_s=(datetime.now(timezone.utc) - l1_started).total_seconds(),
            # Freshness is the point of the stage: how many themes actually got
            # scored, not merely that the code returned.
            source_freshness={"themes_scored": len(scored)},
        )
    except Exception as exc:
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")

    # ── Phase 3: trade ranking + portfolio construction ─────────────────────
    longs, shorts = rank_and_persist_trade_candidates(scored, run_date, cfg,
                                                      asset_edges=asset_edges)
    candidates = longs + shorts
    if not candidates:
        print(f"[{run_date}] No qualifying trade candidates; skipping portfolio construction.")
        return

    positioned = allocate_and_persist_portfolio(candidates, run_date, cfg)

    # L4 (risk engine) was the other uninstrumented stage. It produces every number
    # on /risk, so "did it run today?" is exactly the question a reader needs
    # answered before trusting a VaR.
    l4_started = datetime.now(timezone.utc)
    l4_id = run_id_for(run_date, stage="L4")
    try:
        record_pipeline_run(supabase, l4_id, "started", run_date=run_date, stage="L4")
    except Exception as exc:
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")
    try:
        compute_and_persist_daily_return(positioned, run_date, cfg.total_capital)
        risk_metrics = compute_and_persist_risk(positioned, run_date, cfg)
        compute_and_persist_cumulative_return(run_date)
    except Exception as exc:
        try:
            record_pipeline_run(
                supabase, l4_id, "failure", run_date=run_date, stage="L4",
                duration_s=(datetime.now(timezone.utc) - l4_started).total_seconds(),
                error=str(exc),
            )
        except Exception as rec_exc:
            print(f"[pipeline_runs] record failed ({rec_exc.__class__.__name__}): {rec_exc}")
        raise
    try:
        record_pipeline_run(
            supabase, l4_id, "success", run_date=run_date, stage="L4",
            duration_s=(datetime.now(timezone.utc) - l4_started).total_seconds(),
            source_freshness={"positions_priced": len(positioned)},
        )
    except Exception as exc:
        print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")

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

        # The published book becomes the book of record, and the return and risk
        # statistics are recomputed on it. Until now they were computed on L1's
        # provisional book, which L5 re-picks a subset of — so /risk attributed risk
        # to names that appear nowhere in /book, and VaR/Sharpe/HHI described a
        # portfolio nobody holds. L5 still READS the provisional risk (it is an
        # input to its reasoning), so the recompute has to happen here, after.
        final_book = reconcile_positions_to_published_book(
            agent_result, positioned, run_date, cfg
        )
        if final_book:
            compute_and_persist_daily_return(final_book, run_date, cfg.total_capital)
            compute_and_persist_risk(final_book, run_date, cfg)
            compute_and_persist_cumulative_return(run_date)
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
        # Log the traceback, and persist the failing frame with the error. Without
        # this, an L5 failure recorded only "unsupported format string passed to
        # NoneType.__format__" in pipeline_runs — true, but not locatable, which
        # made a GitHub Action failure undiagnosable without local reproduction.
        import traceback as _tb
        _trace = _tb.format_exc()
        print(f"[{run_date}] [L5] Research agent failed ({exc.__class__.__name__}): skipping.")
        print(_trace)
        _frames = [ln.strip() for ln in _trace.splitlines() if ln.strip().startswith("File ")]
        _where = _frames[-1] if _frames else "unknown frame"
        try:
            record_pipeline_run(supabase, l5_id, "failure", run_date=run_date, stage="L5", duration_s=(datetime.now(timezone.utc)-l5_started).total_seconds(), error=f"{exc} @ {_where}")
        except Exception as exc:
            # Telemetry must never abort the pipeline, but a silent
            # swallow here left every stage stuck at 'partial' in
            # production with nothing to show why.
            print(f"[pipeline_runs] record failed ({exc.__class__.__name__}): {exc}")

    print(f"[{run_date}] Daily refresh complete.")


if __name__ == "__main__":
    main()
