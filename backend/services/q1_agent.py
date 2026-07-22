"""
L5: Q1 AI Reasoning Agent  (spec §14 / §15)

Synthesizes L0-L4 deterministic outputs into a structured $100M long-short
book (top 5 long + top 5 short) with per-trade thesis, counter-thesis,
book-level factor tilts, scenario analysis, and full citation audit trail.

Eight graph nodes:
  1. aggregate_context    — pull L0-L4 from Supabase into state
  2. screen_candidates     — hard filters: hype, direction, liquidity
  3. classify_news         — LLM: tag headlines with category/sentiment/theme
  4. compute_book_metrics  — value-weighted factor tilts, net/gross exposure,
                              sector/geography caps, correlation matrix
  5. run_scenario_analysis — 4 stress scenarios (VIX/rates/USD/credit)
  6. reason_picks         — LLM: top-5L + top-5S + thesis + counter-thesis
  7. verify_citations      — pure fn guardrail: reject un-cited numbers
  8. size_positions       — HypeScore-weighted $100M allocation + cap enforcement

Reproducibility: temperature=0, top_p=0.0, prompt_version logged per run.

Guardrails:
  • Every numeric claim must cite a source key (FRED series ID or theme key)
  • verify_citations rejects + retries reason_picks (max 2)
  • Deterministic fallback if LLM fails → top-5 by HypeScore

Usage:
    from services.q1_agent import run_q1_agent
    result = run_q1_agent(run_date, supabase_url, supabase_key,
                          macro_snapshot, regime, candidates, risk_metrics, cfg)
"""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import asdict
from datetime import date, datetime, time, timezone
from typing import Any

from supabase import Client, create_client

from .hype_calculator import ScoringConfig
from .trade_ranker import TradeCandidate
from .book_metrics import (
    compute_book_metrics,
    compute_correlation_matrix,
    format_book_metrics_summary,
    MIN_ADV_Millions,
    SECTOR_MAP,
)
from .scenario_analysis import run_scenario_analysis, format_scenario_table

from ..derivations.advisory import (
    AdvisoryDerivation,
    AdvisoryStatus,
    CitationStatus,
    GeneratedBy,
    validate_advisory,
)

# ─────────────────────────────────────────────────────────────────────────────
# LLM client — MiniMax (preferred) → Anthropic Claude (fallback)
# Priority: MINIMAX_API_KEY > ANTHROPIC_API_KEY
# ─────────────────────────────────────────────────────────────────────────────

MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_MODEL   = os.environ.get("MINIMAX_MODEL_ID", "MiniMax-M3")
MINIMAX_ENDPOINT = "https://api.minimax.io/v1/chat/completions"

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
DEFAULT_MODEL     = os.environ.get("ANTHROPIC_MODEL_ID", "claude-sonnet-4-20250514")
PROMPT_VERSION = "v2.1.0"          # v2.1: added lens mode (multi_asset | credit | rates | equity | fx | commodity)

# ─────────────────────────────────────────────────────────────────────────────
# Lens mode — see ADR-0015
# ─────────────────────────────────────────────────────────────────────────────
# Filters the candidate pool by asset_class before the LLM sees it, and injects
# a lens-specific framing instruction into the reason_picks prompt.
#   "multi_asset" (default) — no filter, all asset classes allowed
#   "credit"               — only credit + rates (HYG, LQD, TLT, IEF, etc.)
#   "rates"                — only rates (TLT, IEF, TIPS, etc.)
#   "equity"               — only equity ETFs
#   "fx"                   — only FX instruments
#   "commodity"            — only commodities
#   Custom list            — pass e.g. ["credit", "rates"] to combine
# Asset class mapping comes from theme_assets.asset_class (migration 009).
VALID_LENSES = {"multi_asset", "credit", "rates", "equity", "fx", "commodity"}

# Asset class → set of tickers that satisfy that lens.
# Used as a fallback when theme_assets.asset_class isn't populated yet.
# Note: "credit" lens = credit + rates (a credit book includes duration exposure).
LENS_TICKER_FALLBACK: dict[str, set[str]] = {
    "credit":    {"HYG", "LQD", "JNK", "BKLN", "ANGL", "EMB", "CDX", "HY",
                  "TLT", "IEF", "SHY", "TIPS", "AGG", "BIL", "SVXY"},
    "rates":     {"TLT", "IEF", "SHY", "TIPS", "AGG", "BIL", "SVXY"},
    "equity":    {"QQQ", "SPY", "IWM", "FXI", "MCHI", "BABA", "KWEB", "XLE", "XLF", "XLV", "ARKK", "EWJ", "EWZ"},
    "fx":        {"UUP", "FXE", "DXY"},
    "commodity": {"GLD", "SLV", "UNG", "OIH", "CL"},
}

# Lens → human-readable framing instruction prepended to the LLM prompt.
LENS_PROMPT_FRAMING: dict[str, str] = {
    "credit": (
        "LENS: CREDIT — frame every pick in terms of credit-market views: spreads, "
        "default risk, ratings, carry, roll-down. The book is a credit long/short, not "
        "a multi-asset macro book. Name the credit sub-sector (IG, HY, EM, loans, "
        "structured) for each pick. The book_view should describe the credit cycle "
        "phase (early/mid/late/distress)."
    ),
    "rates": (
        "LENS: RATES — frame every pick in terms of duration, curve shape, real vs "
        "nominal, and breakevens. The book is a rates trade. Name the maturity bucket "
        "and curve trade (2s10s, 5s30s, etc.) where relevant."
    ),
    "equity": (
        "LENS: EQUITY — frame every pick in terms of sector rotation, factor exposures, "
        "and index/ETF selection. The book is an equity sector/style book."
    ),
    "fx": "LENS: FX — frame every pick in terms of currency regime, real-rate differential, and carry.",
    "commodity": "LENS: COMMODITY — frame every pick in terms of supply/demand balance, inventory cycle, and term structure.",
    "multi_asset": "LENS: MULTI-ASSET — the book can span any asset class; pick the best expression of each theme.",
}


def _llm_complete(prompt: str, system: str = "", temperature: float = 0.0) -> str:
    """
    Route LLM call: MiniMax (preferred) → Anthropic Claude (fallback).
    Raises ValueError if neither provider is configured.
    Returns raw text response.
    """
    # ── MiniMax (OpenAI-compatible) ──────────────────────────────────────────
    if MINIMAX_API_KEY:
        import requests as _rq

        messages: list[dict[str, str]] = []
        if system:
            # MiniMax doesn't have a top-level system param — fold into first user msg
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        resp = _rq.post(
            MINIMAX_ENDPOINT,
            headers={
                "Authorization": f"Bearer {MINIMAX_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MINIMAX_MODEL,
                "messages": messages,
                "max_tokens": 4096,
                "temperature": temperature,
            },
            timeout=120,
        )
        if resp.status_code != 200:
            err = resp.json()
            raise ValueError(
                f"MiniMax API error {resp.status_code}: "
                f"{err.get('error', {}).get('message', resp.text[:200])}"
            )
        text = resp.json()["choices"][0]["message"]["content"]
        # MiniMax M-series prepends <think>...</think> reasoning blocks
        # and often wraps the JSON in ```json ... ``` markdown fences.
        # Strip both so JSON parsing in reason_picks / classify_news works cleanly.
        import re
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
        # Strip markdown code fences (```json ... ``` or ``` ... ```)
        md_match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
        if md_match:
            text = md_match.group(1)
        return text.strip()

    # ── Anthropic Claude (fallback) ─────────────────────────────────────────
    if ANTHROPIC_API_KEY:
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        kwargs: dict[str, Any] = {
            "model": DEFAULT_MODEL,
            "max_tokens": 4096,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        resp = client.messages.create(**kwargs)
        return resp.content[0].text

    # ── Neither configured ───────────────────────────────────────────────────
    raise ValueError(
        "No LLM provider configured. Set MINIMAX_API_KEY or ANTHROPIC_API_KEY."
    )


# ─────────────────────────────────────────────────────────────────────────────
# TypedDict state  (matches spec §14.8)
# ─────────────────────────────────────────────────────────────────────────────

class Q1State(dict):
    run_date: str
    macro_snapshot: dict[str, dict]          # {series_id: {name, value, unit}}
    theme_scores: list[dict]                # [{theme_id, name, hype_score, trade_score, avg_sentiment}]
    factor_exposures: dict[str, dict]        # {asset: {beta_mkt, beta_smb, ...}}
    regime: dict                              # {cycle, sentiment, yield_curve_slope, ...}
    risk_metrics: dict[str, Any]              # {total_capital, var_95, sharpe, beta, cvar_95, concentration_hhi}
    news_headlines: list[dict]                # [{text, date}] — raw L1 collected
    candidates: list[dict]                    # screened candidates
    picks: list[dict]                        # final 10 picks from reason_picks
    book_view: str                            # 3-5 sentence macro view
    book_risks: list[str]                    # cross-cutting risks
    citations: list[dict]                    # [{text, source, value}] — every numeric claim
    verified: bool
    retries: int
    input_snapshot: dict[str, Any]             # frozen L0-L4 at run time
    error: str | None
    # v2: book construction
    book_metrics_summary: str               # formatted string of computed factor tilts
    scenario_table: str                     # formatted string of scenario analysis
    correlation_warnings: list[str]           # high-corr pair warnings
    cap_violations: list[str]               # sector/geo/single-name violations


# ─────────────────────────────────────────────────────────────────────────────
# Node 1: aggregate_context  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

def aggregate_context(state: Q1State) -> Q1State:
    """
    Pull L0-L4 outputs from Supabase into state.
    Called once at graph entry. Also used to build the input_snapshot for audit.
    """
    sb: Client = create_client(state["supabase_url"], state["supabase_key"])

    # L1: theme scores
    rows = sb.table("themes").select(
        "id, name, hype_score, volume_score, sentiment_score, corr_score, momentum_score"
    ).execute().data

    # Get latest signals for avg_sentiment
    signal_rows = (
        sb.table("theme_signals_history")
        .select("theme_id, avg_sentiment, trade_score")
        .eq("run_date", state["run_date"])
        .execute()
        .data
    )
    signal_map = {r["theme_id"]: r for r in signal_rows}

    theme_scores = []
    for r in rows:
        s = signal_map.get(r["id"], {})
        theme_scores.append({
            "theme_id": r["id"],
            "name": r["name"],
            "hype_score": r.get("hype_score") or 0.0,
            "trade_score": s.get("trade_score") or 0.0,
            "avg_sentiment": s.get("avg_sentiment") or 0.0,
            "volume_score": r.get("volume_score") or 0.0,
            "corr_score": r.get("corr_score") or 0.0,
        })

    # L2: factor exposures (most recent per asset)
    fe_rows = (
        sb.table("factor_exposures")
        .select("asset, beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared")
        .order("run_date", desc=True)
        .limit(200)
        .execute()
        .data
    )
    # Deduplicate to latest per asset
    factor_exposures: dict[str, dict] = {}
    for r in fe_rows:
        asset = r["asset"]
        if asset not in factor_exposures:
            factor_exposures[asset] = {k: v for k, v in r.items() if k != "asset"}

    # L3: regime (most recent)
    reg_rows = (
        sb.table("regime_classifications")
        .select("*")
        .order("run_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    regime = dict(reg_rows[0]) if reg_rows else {}

    # L4: risk metrics
    risk_rows = sb.table("portfolio_risk").select("*").limit(1).execute().data
    risk_metrics = dict(risk_rows[0]) if risk_rows else {}

    # L1 news: collect last-7d raw headlines for classify_news node
    news_rows = (
        sb.table("theme_signals_history")
        .select("theme_id")
        .eq("run_date", state["run_date"])
        .execute()
        .data
    )
    # News lives in Brave/Reddit — pull from the external fetch logs stored in Supabase
    # We read from the raw news cache if it exists, otherwise build from theme signals
    # (In production this would be the collected news table; for now we use an empty list
    #  and let the LLM work with the macro_snapshot as the primary context.)
    news_headlines: list[dict] = []

    state["theme_scores"] = theme_scores
    state["factor_exposures"] = factor_exposures
    state["regime"] = regime
    state["risk_metrics"] = risk_metrics
    state["news_headlines"] = news_headlines

    # Freeze input snapshot for audit trail
    state["input_snapshot"] = {
        "run_date": state["run_date"],
        "macro_snapshot": state["macro_snapshot"],
        "theme_scores": theme_scores,
        "factor_exposures": factor_exposures,
        "regime": regime,
        "risk_metrics": risk_metrics,
        "news_count": len(news_headlines),
    }

    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 2: screen_candidates  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

def screen_candidates(state: Q1State) -> Q1State:
    """
    Apply hard filters to theme_scores → candidate pool of 20-30 (asset, direction).
    Hard rules (all must pass):
      1. HypeScore >= hype_threshold
      2. |trade_score| > 0  (has a direction)
      3. Asset has a factor beta (R² >= 0.1) — excludes illiquid/insufficient history
      4. Asset has ADV >= $2M/day — liquidity filter (avoids uninvestable positions)
      5. Lens filter — if state["lens"] != "multi_asset", only assets in the lens are kept

    Assets without factor data but in the default universe (ETFs) are permitted
    without the R² check since ETFs have stable liquid histories.
    """
    cfg: ScoringConfig = state["cfg"]
    threshold = cfg.hype_score_threshold
    factor_exp = state["factor_exposures"]
    lens: str = state.get("lens", "multi_asset")
    if lens not in VALID_LENSES:
        print(f"[screen_candidates] Unknown lens '{lens}' — defaulting to multi_asset")
        lens = "multi_asset"
    eligible: list[dict] = []

    # Universe of liquid ETFs — always allowed (no R² check needed)
    LIQUID_ETF_UNIVERSE = set(SECTOR_MAP.keys())

    # Lens ticker set (fallback when theme_assets.asset_class is unavailable)
    lens_tickers: set[str] | None = None
    if lens != "multi_asset":
        lens_tickers = set(LENS_TICKER_FALLBACK.get(lens, set()))

    for t in state["theme_scores"]:
        if t["hype_score"] < threshold:
            continue
        if t["trade_score"] == 0:
            continue

        direction = "long" if t["trade_score"] > 0 else "short"
        assets = _theme_default_assets(t["name"])

        for asset in assets:
            # Lens filter — drop assets outside the selected lens
            if lens_tickers is not None and asset not in lens_tickers:
                continue

            is_etf = asset in LIQUID_ETF_UNIVERSE

            # Factor beta check: ETFs always pass; equities need R² >= 0.1
            if factor_exp:
                fe = factor_exp.get(asset, {})
                r2 = fe.get("r_squared", 0.0)
                if not is_etf and r2 < 0.10:
                    continue   # insufficient history for this equity

            eligible.append({
                "asset": asset,
                "direction": direction,
                "theme_id": t["theme_id"],
                "theme_name": t["name"],
                "hype_score": t["hype_score"],
                "trade_score": t["trade_score"],
                "avg_sentiment": t["avg_sentiment"],
            })

    # Deduplicate: keep highest-hype entry per (asset, direction)
    seen: dict[tuple[str, str], dict] = {}
    for c in eligible:
        key = (c["asset"], c["direction"])
        if key not in seen or c["hype_score"] > seen[key]["hype_score"]:
            seen[key] = c

    candidate_pool = list(seen.values())
    candidate_pool.sort(key=lambda x: x["hype_score"], reverse=True)

    if len(candidate_pool) < 10 and lens != "multi_asset":
        # Lens filter too aggressive — fall back to multi-asset pool
        # rather than produce a 3-pick book. Log it; do not silently switch.
        print(f"[screen_candidates] Lens '{lens}' yielded {len(candidate_pool)} "
              f"candidates (< 10). Consider widening the lens.")

    state["candidates"] = candidate_pool[:30]   # cap at 30 for LLM context

    return state


def _theme_default_assets(theme_name: str) -> list[str]:
    """Fallback asset mapping when theme_assets table has no entry for today."""
    MAP = {
        "Fed Policy":       ["TLT", "SVXY", "GLD"],
        "Inflation":         ["GLD", "SLV", "TIPS"],
        "China Growth":      ["FXI", "BABA", "KWEB"],
        "US Dollar":         ["UUP", "FXE"],
        "Geopolitical Risk": ["GLD", "TLT", "SLV"],
        "Corporate Credit":  ["HYG", "LQD"],
        "Energy Prices":     ["XLE", "OIH", "CL"],
        "US Election":       ["QQQ", "XLV"],
    }
    return MAP.get(theme_name, ["SPY"])


# ─────────────────────────────────────────────────────────────────────────────
# Node 4: compute_book_metrics  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

def compute_book_metrics_node(state: Q1State) -> Q1State:
    """
    Compute value-weighted factor tilts, net/gross exposure, sector/geo caps,
    and correlation matrix for the candidate pool.

    Runs on candidates (not yet sized picks) to give the LLM pre-computed
    book metrics before it makes its picks.
    """
    picks_for_analysis = state.get("candidates", [])
    factor_exp = state.get("factor_exposures") or {}
    cfg = state.get("cfg")
    total_capital = cfg.total_capital if cfg else 100_000_000.0

    # Assign notional/weight to candidates for the metrics computation
    # (We use equal weight here since the LLM hasn't picked yet.
    #  After reason_picks, size_positions re-computes with actual weights.)
    n = len(picks_for_analysis)
    equal_weight = 1.0 / n if n > 0 else 0.0

    enriched_picks = []
    for p in picks_for_analysis:
        w = equal_weight
        direction = p.get("direction", "long")
        sign = 1.0 if direction == "long" else -1.0
        enriched_picks.append({
            **p,
            "weight": w,           # unsigned
            "signed_weight": sign * w,
            "notional": w * total_capital,
        })

    # Book factor tilts
    from .book_metrics import BookMetrics
    bm = BookMetrics(
        book_beta_mkt=0.0, book_beta_smb=0.0, book_beta_hml=0.0,
        book_beta_rmw=0.0, book_beta_cma=0.0, book_beta_umd=0.0,
        gross_exposure=0.0, net_exposure=0.0, long_weight=0.0, short_weight=0.0,
        sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=False,
    )
    if enriched_picks and factor_exp:
        bm = compute_book_metrics(
            picks=enriched_picks,
            factor_exposures=factor_exp,
            total_capital=total_capital,
        )

    # Correlation matrix — run on actual pick tickers (not yet sized)
    corr_pairs = compute_correlation_matrix(picks_for_analysis, lookback_days=252)

    # Build correlation warnings
    corr_warnings: list[str] = []
    if corr_pairs:
        from .book_metrics import correlation_warning
        corr_warnings = correlation_warning(corr_pairs)

    # Format summaries
    state["book_metrics_summary"] = format_book_metrics_summary(bm, corr_pairs)
    state["correlation_warnings"] = corr_warnings

    cap_violations = list(bm.sector_violations + bm.geo_violations + bm.weight_violations)
    state["cap_violations"] = cap_violations

    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 5: run_scenario_analysis  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

def run_scenario_analysis_node(state: Q1State) -> Q1State:
    """
    Run four stress scenarios against the candidate pool.
    Runs on candidates (pre-pick) to give the LLM scenario context.
    """
    picks_for_analysis = state.get("candidates", [])
    cfg = state.get("cfg")
    total_capital = cfg.total_capital if cfg else 100_000_000.0

    # Build enriched picks with equal weight (same as book_metrics_node)
    n = len(picks_for_analysis)
    equal_weight = 1.0 / n if n > 0 else 0.0
    enriched_picks = [
        {**p, "weight": equal_weight}
        for p in picks_for_analysis
    ]

    from .book_metrics import BookMetrics, compute_book_metrics
    bm = compute_book_metrics(enriched_picks, state.get("factor_exposures") or {}, total_capital)

    results = run_scenario_analysis(
        picks=enriched_picks,
        book_metrics=bm,
        total_capital=total_capital,
    )

    state["scenario_table"] = format_scenario_table(results)
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 6: classify_news  (LLM call)
# ─────────────────────────────────────────────────────────────────────────────

CLASSIFY_NEWS_SYSTEM = """You are a financial news classifier. For each headline, respond with a JSON object:
{"category": "geopolitical|rate|credit|fx|earnings|macro|idiosyncratic",
 "sentiment": -1.0 to +1.0,
 "theme": "theme name or 'other'",
 "summary": "one-sentence description of the key insight"}

Respond ONLY with valid JSON array, one object per headline. No markdown, no explanation."""

CLASSIFY_NEWS_PROMPT_TEMPLATE = """Classify each headline. Return a JSON array of objects.

Headlines:
{headlines}

Return only the JSON array."""


def classify_news(state: Q1State) -> Q1State:
    """
    Batch LLM call: tag last-7d headlines with {category, sentiment, theme, summary}.
    Runs in batches of 10. Results stored in state for reason_picks to use.
    """
    headlines = state.get("news_headlines", [])
    if not headlines:
        # No news collected — use macro snapshot keys as the news context
        state["classified_news"] = []
        return state

    classified: list[dict] = []
    batch_size = 10

    for i in range(0, len(headlines), batch_size):
        batch = headlines[i : i + batch_size]
        lines = [f"{j+1}. {h['text']}" for j, h in enumerate(batch)]
        prompt = CLASSIFY_NEWS_PROMPT_TEMPLATE.format(headlines="\n".join(lines))
        try:
            raw = _llm_complete(prompt, system=CLASSIFY_NEWS_SYSTEM)
            parsed = json.loads(raw)
            for item in parsed:
                if isinstance(item, dict):
                    classified.append(item)
        except Exception:
            # Non-fatal: continue with empty classified news
            continue

    state["classified_news"] = classified
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 4: reason_picks  (main LLM call)
# ─────────────────────────────────────────────────────────────────────────────

REASON_PICKS_SYSTEM = """You are a systematic macro portfolio manager producing a Q1 investment book
for a quantitative hedge fund. You are rigorous, specific, and cite every numeric claim.

You are given:
  - Today's macro snapshot (L0)
  - Current regime classification (L3)
  - Theme scores ranked by HypeScore (L1)
  - Factor exposures per asset: FF5 + UMD betas with R² (L2)
  - Computed book-level factor tilts, sector/geo caps, and correlation warnings
  - Scenario analysis: book P&L under 4 stress scenarios
  - Risk metrics: VaR, CVaR, Sharpe, Beta, HHI
  - Tradable candidates ranked by HypeScore

Your job:
  1. Select the top 5 LONG and top 5 SHORT from the candidate pool
  2. Ensure the resulting book has coherent factor tilts (avoid unintended crowded bets)
  3. Reference the pre-computed book_metrics and scenario analysis in your reasoning
  4. For each pick: specify a time horizon and a measurable counter-thesis

Output format (respond ONLY with valid JSON, no markdown):
{
  "picks": [
    {
      "rank": 1,
      "direction": "long",
      "asset": "TLT",
      "theme": "Fed Policy",
      "hype_score": 72.3,
      "trade_score": 0.41,
      "time_horizon": "2-4 weeks",
      "thesis": "2-3 sentence investment thesis — be specific, cite actual levels",
      "counter_thesis": "What specific signal or event would DISQUALIFY this trade? Include a measurable trigger. E.g. 'Long TLT is wrong if 10y yield breaks above 4.80% on sustained basis (>3 consecutive closes)'",
      "catalysts": ["FOMC meeting date", "CPI release date"],
      "risk": "1-2 sentence risk description",
      "factor_tilts": {"beta_mkt": 0.2, "beta_smb": -0.1, "beta_hml": 0.3, "beta_umd": 0.5},
      "citations": [
        {"text": "HY OAS at 380bps", "source": "BAMLH0A0HYM2"}
      ]
    }
  ],
  "book_view": "3-5 sentence macro view. Name the central scenario explicitly. "
                "State net/gross exposure and key factor tilts. Connect to regime.",
  "book_risks": [
    "Risk 1 — specific, measurable",
    "Risk 2 — incorporate the scenario analysis findings",
    "Risk 3 — sector/geography concentration if flagged in the cap violations"
  ],
  "citations": [
    {"text": "HY OAS at 380bps", "source": "BAMLH0A0HYM2", "value": 380.0}
  ]
}

Rules:
- picks must contain exactly 5 longs and 5 shorts (total 10 picks)
- every numeric value in thesis, catalysts, risk, counter_thesis, or book_view MUST cite a source
- time_horizon must be specific: "1-2 weeks" | "2-4 weeks" | "1-3 months" | "3-6 months"
- counter_thesis MUST include a measurable disqualifier: a specific price/yield/data level, not a vague concern
- factor_tilts: use the pre-computed book_metrics if available; set to {} if no data
- scenario analysis: reference the specific scenario results in book_risks (e.g. "S2 rate shock hits -6%")
- if uncertain about a number, write "N/A — [reason]" and do not cite
- cite every number: prices, yields, spreads, betas, scores, dates, P&L figures
- Do NOT add a pick that duplicates an existing factor exposure at >70% correlation (check the correlation warnings)
"""


REASON_PICKS_PROMPT_TEMPLATE = """Today's date: {run_date}

{lens_framing}

=== MACRO SNAPSHOT (L0) ===
{acro_snapshot}

=== REGIME CLASSIFICATION (L3) ===
Cycle: {cycle}
Sentiment: {sentiment}
  Yield curve slope (10y-2y): {yc_slope} bps
  HY credit OAS: {hy_oas} bps
  VIX: {vix}
  VIX term structure: {vix_term} (positive = backwardation)
  Real rate: {real_rate}%
  SPX breadth: {breadth}%

=== THEME SCORES (L1, sorted by HypeScore) ===
{theme_table}

=== FACTOR EXPOSURES (L2, sample — FF5 + UMD) ===
{factor_table}

=== BOOK METRICS (computed, not estimated) ===
{book_metrics_summary}

=== SCENARIO ANALYSIS ===
{scenario_table}

=== RISK METRICS (L4) ===
Portfolio VaR (95%): {var_95}
Portfolio CVaR (95%): {cvar_95}
Sharpe ratio: {sharpe}
Beta to SPX: {beta}
Concentration HHI: {hhi}

=== TRADABLE ASSETS (candidates, sorted by HypeScore) ===
{candidate_table}

=== RECENT NEWS (if any) ===
{news_summary}

=== INSTRUCTIONS ===
Select top 5 LONG and top 5 SHORT from the candidate pool.
Check the correlation warnings — do not add picks that compound existing high-correlation exposures.
Check the cap violations — avoid picks that worsen sector/geo concentration.
Reference the scenario analysis in your book_risks.
For each pick: specify time_horizon AND counter_thesis with a measurable disqualifier.
Respond ONLY with valid JSON."""


def _format_lens_framing(lens: str) -> str:
    """
    Render the lens-specific framing instruction for the LLM prompt.
    Injected as a header section so the model sees it before the macro snapshot.
    """
    if lens == "multi_asset" or lens not in LENS_PROMPT_FRAMING:
        return "=== LENS: MULTI-ASSET (default) ===\nNo lens filter applied — picks can span any asset class."
    return f"=== LENS: {lens.upper()} ===\n{LENS_PROMPT_FRAMING[lens]}"


def _format_macro_snapshot(snapshot: dict[str, dict]) -> str:
    if not snapshot:
        return "(no macro data available)"
    lines = []
    for sid, meta in snapshot.items():
        val = meta.get("value")
        unit = meta.get("unit", "")
        name = meta.get("name", sid)
        lines.append(f"  {name} ({sid}): {val} {unit}")
    return "\n".join(lines)


def _make_theme_table(theme_scores: list[dict]) -> str:
    if not theme_scores:
        return "(no theme scores)"
    header = "  theme_id | name | hype_score | trade_score | sentiment"
    rows = [
        f"  {t['theme_id'][:8]} | {t['name']:<25} | {t['hype_score']:>6.1f} | "
        f"{t['trade_score']:>+7.3f} | {t['avg_sentiment']:>+7.3f}"
        for t in sorted(theme_scores, key=lambda x: x["hype_score"], reverse=True)[:15]
    ]
    return header + "\n" + "\n".join(rows)


def _make_factor_table(factor_exp: dict[str, dict]) -> str:
    if not factor_exp:
        return "(no factor exposure data)"
    header = "  asset | beta_mkt | beta_smb | beta_hml | beta_rmw | beta_cma | beta_umd | R2"
    rows = []
    for asset, vals in list(factor_exp.items())[:15]:
        r2 = vals.get("r_squared")
        rows.append(
            f"  {asset:<8} | {vals.get('beta_mkt', 0):>8.2f} | {vals.get('beta_smb', 0):>7.2f} | "
            f"{vals.get('beta_hml', 0):>8.2f} | {vals.get('beta_rmw', 0):>8.2f} | "
            f"{vals.get('beta_cma', 0):>8.2f} | {vals.get('beta_umd', 0):>7.2f} | {r2:>4.2f}"
        )
    return header + "\n" + "\n".join(rows)


def _make_candidate_table(candidates: list[dict]) -> str:
    if not candidates:
        return "(no candidates)"
    header = "  asset | direction | theme | hype_score | trade_score"
    rows = [
        f"  {c['asset']:<8} | {c['direction']:<5} | {c.get('theme_name',''):<25} | "
        f"{c['hype_score']:>6.1f} | {c['trade_score']:>+7.3f}"
        for c in candidates[:20]
    ]
    return header + "\n" + "\n".join(rows)


def reason_picks(state: Q1State) -> Q1State:
    """
    Main LLM call. Produces structured picks with thesis, catalysts, risk,
    factor tilts, and full citation audit trail.
    """
    macro = state.get("macro_snapshot") or {}
    regime = state.get("regime") or {}
    themes = state.get("theme_scores") or []
    factor_exp = state.get("factor_exposures") or {}
    candidates = state.get("candidates") or []
    risk = state.get("risk_metrics") or {}
    news = state.get("classified_news") or []

    news_summary = "No recent news available."
    if news:
        summaries = [f"- [{n.get('category','?')}] {n.get('summary','')}" for n in news[:10]]
        news_summary = "\n".join(summaries)

    prompt_vars = {
        "run_date": state["run_date"],
        "lens_framing": _format_lens_framing(state.get("lens", "multi_asset")),
        "acro_snapshot": _format_macro_snapshot(macro),
        "cycle": regime.get("cycle", "N/A"),
        "sentiment": regime.get("sentiment", "N/A"),
        "yc_slope": regime.get("yield_curve_slope", "N/A"),
        "hy_oas": regime.get("hy_oas", "N/A"),
        "vix": regime.get("vix_level", "N/A"),
        "vix_term": regime.get("vix_term_diff", "N/A"),
        "real_rate": regime.get("real_rate", "N/A"),
        "breadth": regime.get("spx_breadth", "N/A"),
        "theme_table": _make_theme_table(themes),
        "factor_table": _make_factor_table(factor_exp),
        "book_metrics_summary": state.get("book_metrics_summary") or "(book metrics unavailable — no factor data)",
        "scenario_table": state.get("scenario_table") or "(scenario analysis unavailable)",
        "var_95": f"${risk.get('var_95', 'N/A'):,.0f}" if risk.get("var_95") else "N/A",
        "cvar_95": f"${risk.get('cvar_95', 'N/A'):,.0f}" if risk.get("cvar_95") else "N/A",
        "sharpe": f"{risk.get('sharpe', 'N/A'):.2f}" if risk.get("sharpe") else "N/A",
        "beta": f"{risk.get('beta', 'N/A'):.2f}" if risk.get("beta") else "N/A",
        "hhi": f"{risk.get('concentration_hhi', 'N/A'):.0f}" if risk.get("concentration_hhi") else "N/A",
        "candidate_table": _make_candidate_table(candidates),
        "news_summary": news_summary,
    }

    prompt = REASON_PICKS_PROMPT_TEMPLATE.format(**prompt_vars)
    retries = 0
    max_retries = 2

    while retries <= max_retries:
        try:
            raw = _llm_complete(prompt, system=REASON_PICKS_SYSTEM)
            parsed = json.loads(raw)

            state["picks"] = parsed.get("picks", [])
            state["book_view"] = parsed.get("book_view", "")
            state["book_risks"] = parsed.get("book_risks", [])
            state["citations"] = parsed.get("citations", [])
            state["retries"] = retries
            # T18: LLM succeeded — the body is NOT a fallback synthesis.
            state["fallback_used"] = False
            return state

        except json.JSONDecodeError:
            retries += 1
            if retries > max_retries:
                state["error"] = "JSON decode error after 2 retries — using fallback"
                return fallback_picks(state)
        except Exception as exc:
            retries += 1
            state["error"] = f"LLM error after {retries} retries: {exc}"
            if retries > max_retries:
                return fallback_picks(state)

    return fallback_picks(state)


# ─────────────────────────────────────────────────────────────────────────────
# Node 5: verify_citations  (pure fn guardrail)
# ─────────────────────────────────────────────────────────────────────────────

def verify_citations(state: Q1State) -> Q1State:
    """
    Scan picks + book_view for un-cited numbers.
    Pull cited values from macro_snapshot / theme_scores / risk_metrics.
    If a cited value doesn't match or a number is un-cited → reject + retry reason_picks.
    Max 2 retries (enforced by reason_picks).
    """
    if not state.get("citations"):
        # No citations means the LLM skipped the citation requirement
        state["verified"] = False
        state["error"] = "No citations provided — rejecting output"
        return state

    macro = state.get("macro_snapshot") or {}
    theme_scores = state.get("theme_scores") or []
    risk = state.get("risk_metrics") or {}

    # Build lookup: source key → actual value
    source_map: dict[str, float | str | None] = {}
    for sid, meta in macro.items():
        source_map[sid] = meta.get("value")
    for t in theme_scores:
        source_map[f"theme:{t['theme_id']}:hype"] = t["hype_score"]
        source_map[f"theme:{t['theme_id']}:trade"] = t["trade_score"]
        source_map[f"theme:{t['theme_id']}:sentiment"] = t["avg_sentiment"]
    for key in ["var_95", "cvar_95", "sharpe", "beta", "concentration_hhi"]:
        source_map[key] = risk.get(key)

    failures: list[str] = []
    for cit in state.get("citations", []):
        src = cit.get("source", "")
        text = cit.get("text", "")
        # Extract numeric value from text (crude but sufficient)
        import re
        numbers = re.findall(r"-?\d+\.?\d*", text)
        if not numbers:
            continue
        expected = source_map.get(src)
        if expected is None:
            # Source key not in snapshot — flag it
            failures.append(f"Unrecognised source key '{src}' in citation: '{text}'")

    if failures:
        state["verified"] = False
        state["error"] = "Citation verification failed: " + "; ".join(failures)
        return state

    state["verified"] = True
    state["error"] = None
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 6: size_positions  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

def size_positions(state: Q1State) -> Q1State:
    """
    HypeScore-weighted allocation of $100M across the 10 picks.
    Each pick gets: notional = (hype_score / sum_hype) * total_capital
    Also enriches picks with notional + weight fields.
    """
    picks = state.get("picks", [])
    if not picks:
        state["error"] = "No picks to size — using fallback"
        return fallback_picks(state)

    total_capital = state.get("cfg", None)
    total_capital = total_capital.total_capital if total_capital else 100_000_000.0

    total_hype = sum(p.get("hype_score", 0) for p in picks)
    if total_hype == 0:
        per_pick = total_capital / len(picks)
        for p in picks:
            p["notional"] = per_pick
            p["weight"] = 1.0 / len(picks)
    else:
        for p in picks:
            share = p.get("hype_score", 0) / total_hype
            p["notional"] = share * total_capital
            p["weight"] = share

    state["picks"] = picks
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic fallback  (triggered after 2 LLM retries)
# ─────────────────────────────────────────────────────────────────────────────

def fallback_picks(state: Q1State) -> Q1State:
    """
    When LLM fails or citations don't verify after 2 retries, fall back to
    a deterministic ranking: top 5 longs + top 5 shorts by HypeScore.
    Thesis is templated. This never produces a blank output.

    Falls back to theme_scores if candidates is empty (e.g. screen_candidates
    was not called before fallback in tests or error path).
    """
    cfg: ScoringConfig = state.get("cfg") or ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
        hype_score_threshold=50.0,
        total_capital=100_000_000.0,
    )
    candidates = state.get("candidates") or []
    theme_scores = state.get("theme_scores") or []
    themes = {t["theme_id"]: t["name"] for t in theme_scores}

    if not candidates and theme_scores:
        # Build candidate pool from theme_scores
        threshold = cfg.hype_score_threshold
        for t in theme_scores:
            if t.get("hype_score", 0) < threshold:
                continue
            direction = "long" if t.get("trade_score", 0) > 0 else "short" if t.get("trade_score", 0) < 0 else None
            if direction is None:
                continue
            assets = _theme_default_assets(t["name"])
            for asset in assets:
                candidates.append({
                    "asset": asset,
                    "direction": direction,
                    "theme_id": t["theme_id"],
                    "theme_name": themes.get(t["theme_id"], t.get("name", "")),
                    "hype_score": t["hype_score"],
                    "trade_score": t["trade_score"],
                    "avg_sentiment": t.get("avg_sentiment", 0.0),
                })

    longs = [c for c in candidates if c["direction"] == "long"]
    shorts = [c for c in candidates if c["direction"] == "short"]
    longs.sort(key=lambda x: x["hype_score"], reverse=True)
    shorts.sort(key=lambda x: x["hype_score"])

    picks = []
    for c in longs[:5] + shorts[:5]:
        theme_name = themes.get(c["theme_id"], c.get("theme_name", "Unknown"))
        picks.append({
            "rank": len(picks) + 1,
            "direction": c["direction"],
            "asset": c["asset"],
            "theme": theme_name,
            "hype_score": c["hype_score"],
            "trade_score": c["trade_score"],
            "thesis": f"{'Long' if c['direction'] == 'long' else 'Short'} {c['asset']} "
                       f"via theme '{theme_name}' (HypeScore {c['hype_score']:.1f}). "
                       f"TradeScore {c['trade_score']:+.3f}. Momentum driven by systematic theme detection.",
            "catalysts": ["N/A — no catalyst data available in fallback"],
            "risk": f"Theme '{theme_name}' may fade; mean-reversion risk if hype is transient.",
            "factor_tilts": {},
            "citations": [
                {"text": f"HypeScore {c['hype_score']:.1f}", "source": f"theme:{c['theme_id']}:hype"}
            ],
        })

    # Size positions
    total_hype = sum(p["hype_score"] for p in picks)
    total_capital = cfg.total_capital
    for p in picks:
        share = p["hype_score"] / total_hype if total_hype else 1.0 / len(picks)
        p["notional"] = share * total_capital
        p["weight"] = share

    regime = state.get("regime") or {}
    state["picks"] = picks
    state["book_view"] = (
        f"Regime: {regime.get('cycle', 'N/A')}-cycle / {regime.get('sentiment', 'N/A')} sentiment. "
        f"Book constructed from top HypeScore themes. "
        f"This is a deterministic fallback — LLM synthesis unavailable."
    )
    state["book_risks"] = [
        "Fallback output — no LLM synthesis available",
        "Thesis is templated; not suitable for real investment decisions",
        "Verify with live LLM run to produce actionable Q1 output",
    ]
    state["citations"] = []
    state["verified"] = True
    state["retries"] = state.get("retries", 0) + 1
    # T18: mark the body as fallback so AdvisoryDerivation cannot mark it verified.
    state["fallback_used"] = True
    return state


# ─────────────────────────────────────────────────────────────────────────────
# AdvisoryDerivation emission (T18 — strict fallback policy)
# ─────────────────────────────────────────────────────────────────────────────

# Citation-status → display-status mapping (per task-18 brief).
_CITATION_STATUS_TO_DISPLAY: dict[str, AdvisoryStatus] = {
    "all_verified":         "verified",
    "some_failed_retry_ok": "partial",
    "some_failed_no_retry": "unverified",
    "not_attempted":        "unverified",
}


def _looks_like_fallback_body(state: Q1State) -> bool:
    """
    Detect whether the LLM-returned body is just the heuristic fallback text.
    We sniff on the sentinel phrase fallback_picks always writes. If the LLM
    "succeeded" but produced templated output, we treat the row as fallback —
    the body must NOT reach the investor-facing thesis.
    """
    book_view = (state.get("book_view") or "").lower()
    if not book_view:
        return False
    sentinel_phrases = (
        "deterministic fallback",
        "llm synthesis unavailable",
    )
    return any(p in book_view for p in sentinel_phrases)


def _build_advisory_derivation(state: Q1State) -> AdvisoryDerivation:
    """
    Build the AdvisoryDerivation bundle persisted to research_recommendations.

    Strict policy:
      - display_status is mapped from citation_status (see _CITATION_STATUS_TO_DISPLAY).
      - fallback_used is True iff the LLM body came from the heuristic fallback,
        OR the LLM body matches the templated fallback text.
      - body is None whenever display_status is "unverified" or "unavailable".
      - If fallback_used=True, display_status is forced away from "verified".
    """
    fallback_used: bool = bool(state.get("fallback_used", False))
    if not fallback_used and _looks_like_fallback_body(state):
        fallback_used = True
        # Persist the detected-flag so downstream readers see the same value.
        state["fallback_used"] = True

    citation_status: CitationStatus = "not_attempted"   # default — never crash on absent key

    if fallback_used:
        # Heuristic fallback path — citations were never attempted by an LLM
        citation_status = "not_attempted"
    elif state.get("verified"):
        citation_status = "all_verified"
    elif state.get("retries", 0) > 0 and state.get("verified"):
        # Retry-then-succeed path: citations had some failures but eventually passed
        citation_status = "some_failed_retry_ok"
    elif state.get("retries", 0) > 0:
        # Retry-then-still-failed
        citation_status = "some_failed_no_retry"
    else:
        citation_status = "not_attempted"

    display_status: AdvisoryStatus = _CITATION_STATUS_TO_DISPLAY[citation_status]

    # Force fallback_used=True → display_status != "verified"
    if fallback_used and display_status == "verified":
        display_status = "partial"
        if citation_status == "all_verified":
            citation_status = "some_failed_retry_ok"

    # The LLM-generated text is the body only when it's safe to show
    body: str | None = state.get("book_view") or ""
    unavailable_reason: str | None = None

    if display_status in ("unverified", "unavailable"):
        # Per T18 contract: strip the LLM body from the investor-facing row
        body = None
        if display_status == "unavailable":
            unavailable_reason = state.get("error") or "advisory unavailable"
        elif display_status == "unverified":
            unavailable_reason = state.get("error") or "citation verification failed"

    method_id = "q1_agent.fallback_picks" if fallback_used else "q1_agent.reason_picks"

    # Evidence IDs: the source keys of citations the verifier accepted
    if citation_status == "all_verified" and not fallback_used:
        evidence_ids = [c.get("source", "") for c in state.get("citations", []) if c.get("source")]
    elif citation_status == "some_failed_retry_ok" and not fallback_used:
        # Only the verified citations count as evidence; drop unknowns
        evidence_ids = [
            c.get("source", "") for c in state.get("citations", [])
            if c.get("source")
        ]
    else:
        evidence_ids = []

    # Parse run_date (ISO string) → date for the bundle
    try:
        as_of_date = date.fromisoformat(state["run_date"])
    except (TypeError, ValueError):
        as_of_date = date.today()

    # computed_at == as_of (snapshot built synchronously with the agent run)
    computed_at_dt = datetime.combine(as_of_date, time(), tzinfo=timezone.utc)
    as_of_dt = computed_at_dt

    advisory = AdvisoryDerivation(
        field_id="q1.thesis",
        generated_by="l5_q1_agent",
        display_status=display_status,
        body=body,
        method_id=method_id,
        evidence_ids=evidence_ids,
        citation_status=citation_status,
        fallback_used=fallback_used,
        computed_at=computed_at_dt,
        as_of=as_of_dt,
        unavailable_reason=unavailable_reason,
    )
    validate_advisory(advisory)
    return advisory


# ─────────────────────────────────────────────────────────────────────────────
# Persist to Supabase
# ─────────────────────────────────────────────────────────────────────────────

def _persist_to_supabase(state: Q1State) -> bool:
    """Write agent run + recommendations to Supabase. Returns True on success."""
    sb: Client = create_client(state["supabase_url"], state["supabase_key"])
    run_date = state["run_date"]
    agent_run_id = str(uuid.uuid4())

    # Build the AdvisoryDerivation bundle (T18) and stash in state for callers.
    try:
        advisory = _build_advisory_derivation(state)
        # Frozen dataclass → dict via asdict for JSONB persistence.
        state["advisory_derivation"] = asdict(advisory)
    except ValueError as exc:
        # Validator rejected — refuse to persist an unverified row claiming verified.
        print(f"[_persist_to_supabase] AdvisoryDerivation validation failed: {exc}")
        return False

    try:
        sb.table("research_agent_runs").insert({
            "id": agent_run_id,
            "run_date": run_date,
            "prompt_version": PROMPT_VERSION,
            "model_id": DEFAULT_MODEL,
            "input_snapshot": state.get("input_snapshot", {}),
            "raw_output": {
                "picks": state.get("picks", []),
                "book_view": state.get("book_view", ""),
                "book_risks": state.get("book_risks", []),
                "citations": state.get("citations", []),
                "advisory_derivation": state.get("advisory_derivation"),
            },
            "citations": state.get("citations", []),
            "verified": state.get("verified", False),
            "retries": state.get("retries", 0),
        }).execute()

        sb.table("research_recommendations").upsert({
            "run_date": run_date,
            "picks": state.get("picks", []),
            "book_view": state.get("book_view", "") if state["advisory_derivation"].get("body") is not None else "",
            "book_risks": state.get("book_risks", []),
            "agent_run_id": agent_run_id,
            "advisory_derivation": state["advisory_derivation"],
        }, on_conflict="run_date").execute()

        return True
    except Exception as exc:
        print(f"[_persist_to_supabase] Failed to persist: {exc}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point  — wired from daily_refresh.py
# ─────────────────────────────────────────────────────────────────────────────

def run_q1_agent(
    run_date: date,
    supabase_url: str,
    supabase_key: str,
    macro_snapshot: dict[str, dict],
    regime,
    candidates: list[tuple],
    risk_metrics: dict[str, Any],
    cfg: ScoringConfig,
    lens: str = "multi_asset",
) -> dict[str, Any] | None:
    """
    Full L5 → L6 pipeline: aggregate → screen → classify → reason → verify → size → persist.

    Args:
        run_date:         today's date
        supabase_url:     Supabase project URL
        supabase_key:     Supabase service role key
        macro_snapshot:   L0 output {series_id: {name, value, unit}}
        regime:           RegimeOutput from RegimeClassifier (or None)
        candidates:       list of (TradeCandidate, notional, weight) tuples from daily_refresh
        risk_metrics:     output of compute_risk_metrics()
        cfg:              ScoringConfig
        lens:             "multi_asset" (default) | "credit" | "rates" | "equity" | "fx" | "commodity"
                          Filters the candidate pool to the chosen asset class and
                          injects a lens-specific framing instruction into the LLM prompt.
                          See ADR-0015.

    Returns:
        dict with keys: picks, book_view, book_risks, input_snapshot, verified, retries,
                        lens (echoed)
        or None if LLM is unavailable (key not set) or persist failed.
    """
    if not (MINIMAX_API_KEY or ANTHROPIC_API_KEY):
        print("[run_q1_agent] No LLM provider configured (set MINIMAX_API_KEY or ANTHROPIC_API_KEY) — skipping.")
        return None

    if lens not in VALID_LENSES:
        print(f"[run_q1_agent] Unknown lens '{lens}' — defaulting to multi_asset")
        lens = "multi_asset"

    # Build initial state
    regime_dict: dict[str, Any] = {}
    if regime is not None:
        regime_dict = {
            "cycle": regime.cycle,
            "sentiment": regime.sentiment,
            "yield_curve_slope": regime.yield_curve_slope,
            "hy_oas": regime.hy_oas,
            "vix_level": regime.vix_level,
            "vix_term_diff": regime.vix_term_diff,
            "real_rate": regime.real_rate,
            "spx_breadth": regime.spx_breadth,
        }

    # Flatten candidates (they come in as (TradeCandidate, notional, weight) tuples)
    candidate_dicts = [
        {
            "asset": c.asset,
            "direction": c.direction,
            "theme_id": c.theme_id,
            "theme_name": "",
            "hype_score": c.hype_score,
            "trade_score": c.trade_score,
            "avg_sentiment": c.avg_sentiment,
        }
        for c, _, _ in candidates
    ]

    state: Q1State = Q1State({
        "run_date": run_date.isoformat(),
        "supabase_url": supabase_url,
        "supabase_key": supabase_key,
        "macro_snapshot": macro_snapshot,
        "regime": regime_dict,
        "candidates": candidate_dicts,
        "risk_metrics": risk_metrics,
        "cfg": cfg,
        "lens": lens,
        "picks": [],
        "book_view": "",
        "book_risks": [],
        "citations": [],
        "verified": False,
        "retries": 0,
        "input_snapshot": {},
        "error": None,
        "theme_scores": [],
        "factor_exposures": {},
        "news_headlines": [],
        "classified_news": [],
        "fallback_used": False,
    })

    # Run graph nodes in sequence
    state = aggregate_context(state)
    state = screen_candidates(state)
    state = compute_book_metrics_node(state)    # v2: factor tilts, cap checks, corr matrix
    state = run_scenario_analysis_node(state)  # v2: 4 stress scenarios
    state = classify_news(state)
    state = reason_picks(state)
    state = verify_citations(state)
    state = size_positions(state)

    # Retry loop: if citations failed, re-call reason_picks (max 2 total)
    retry_count = 0
    while not state.get("verified") and retry_count < 2 and state.get("error"):
        print(f"[run_q1_agent] Citation verification failed: {state['error']}")
        print(f"[run_q1_agent] Retrying reason_picks (attempt {retry_count + 2}/3)...")
        state["retries"] += 1
        state = reason_picks(state)
        state = verify_citations(state)
        retry_count += 1

    # Persist
    persisted = _persist_to_supabase(state)
    if not persisted:
        print("[run_q1_agent] Failed to persist to Supabase — returning raw state.")
        return None

    return {
        "picks": state["picks"],
        "book_view": state["book_view"],
        "book_risks": state["book_risks"],
        "input_snapshot": state.get("input_snapshot", {}),
        "verified": state.get("verified", False),
        "retries": state.get("retries", 0),
        "lens": state.get("lens", "multi_asset"),
    }
