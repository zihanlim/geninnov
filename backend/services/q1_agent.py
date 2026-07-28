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
    from backend.services.q1_agent import run_q1_agent
    result = run_q1_agent(run_date, supabase_url, supabase_key,
                          macro_snapshot, regime, candidates, risk_metrics, cfg)
"""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import asdict
from datetime import date, datetime, time, timezone
from typing import Any

from supabase import Client, create_client

from .hype_calculator import ScoringConfig
from .trade_ranker import TradeCandidate, allocate_portfolio
from .book_metrics import (
    compute_book_metrics,
    compute_correlation_matrix,
    format_book_metrics_summary,
    moving_average_context,
    book_metrics_to_dict,
    correlation_pairs_to_dict,
    correlation_summary,
    cap_utilisation,
    independent_ideas,
    MIN_ADV_Millions,
    MAX_SINGLE_NAME_WEIGHT,
    SECTOR_MAP,
    GEO_MAP,
)
from .scenario_analysis import (
    run_scenario_analysis,
    run_scenario_analysis_with_scenarios,
    format_scenario_table,
    scenario_results_to_dict,
)
from .expected_returns import (
    IcReading,
    annualised_vol,
    build_mu,
    composite_edge_ic,
    equalise_signal_within_complexes,
)
from .position_dossier import dossier_block
from .optimizer import (
    OptimizerConstraints,
    OptimizerInputs,
    covariance_from_returns,
    efficient_frontier,
    optimize,
    portfolio_point,
)
from .cost_model import estimate_portfolio_costs
from .monte_carlo import monte_carlo_var
from .var_forecast import compute_var_forecast

from ..derivations.advisory import (
    AdvisoryDerivation,
    AdvisoryStatus,
    CitationStatus,
    GeneratedBy,
    validate_advisory,
)

# ─────────────────────────────────────────────────────────────────────────────
# LLM client — MiniMax (preferred) → Anthropic Claude → Gemini (fallbacks)
# Priority: MINIMAX_API_KEY > ANTHROPIC_API_KEY > GEMINI_API_KEY
# ─────────────────────────────────────────────────────────────────────────────

MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_MODEL   = os.environ.get("MINIMAX_MODEL_ID", "MiniMax-M3")
MINIMAX_ENDPOINT = "https://api.minimax.io/v1/chat/completions"

# Read timeout for a reason_picks generation, seconds.
#
# This was hardcoded at 120s and was THE reason the Q1 book kept falling back. The
# request is a reasoning model asked for a ten-pick book where every pick carries a
# thesis, catalysts, a counter-thesis and citations — that routinely runs past two
# minutes, so requests raised ReadTimeout, reason_picks fell back, and the empty
# fallback citations got reported as "No citations provided". The tell was that the
# runs which DID verify carried only 1-2 picks (small, fast books), and widening the
# universe made the failure constant by enlarging the ask.
#
# Time spent thinking is not an error worth retrying — it is the model working. The
# retry loop made it worse: three attempts x 120s spent ~6 minutes to reach a
# guaranteed fallback.
#
# 420 was the first estimate, taken from a standalone probe that produced a full
# ten-pick book in 205s. The live pipeline then timed out at 420 on attempt 1 and
# succeeded on attempt 2, which says the real prompt is materially heavier than the
# probe's — it carries the full candidate list, macro snapshot, book metrics and
# scenario table — and that generation time varies run to run. Burning 7 minutes on
# a doomed first attempt is the same waste in a longer coat, so the ceiling is set
# well clear of the observed range rather than just above it.
#
# A daily batch job can afford to wait: this is the single most important artefact
# the pipeline produces and it runs once a day. The Actions job allows 60 minutes.
LLM_TIMEOUT_SECONDS = int(os.environ.get("LLM_TIMEOUT_SECONDS", "900"))

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
# Contingency provider only — this deployment ships no ANTHROPIC_API_KEY, so
# _select_provider never reaches this branch (MiniMax wins on priority). Kept
# current anyway: a dated model id rots silently, and the branch it sits in is
# exactly the one nobody exercises until the day MiniMax is down.
# claude-sonnet-4-20250514 retired 2026-06-15 and now 404s.
DEFAULT_MODEL     = os.environ.get("ANTHROPIC_MODEL_ID", "claude-sonnet-5")

# Google Gemini (final fallback) — see ADR-0026. Provider-agnostic per ADR-0013:
# the citation guardrail + candidate hard-filter constrain whichever LLM answers,
# so the provider is swappable without weakening the L5 contract.
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL    = os.environ.get("GEMINI_MODEL_ID", "gemini-flash-latest")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Explicit provider selector. Without it, auto-priority (MiniMax > Anthropic >
# Gemini) means a stray ANTHROPIC_API_KEY in the shell, or a MiniMax key in
# backend/.env, silently hijacks a run the operator intended for Gemini. Set
# LLM_PROVIDER=gemini|anthropic|minimax to pin it; "auto" keeps the old priority.
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "auto").strip().lower()

PROMPT_VERSION = "v2.1.0"          # v2.1: added lens mode (multi_asset | credit | rates | equity | fx | commodity)


def _select_provider() -> str:
    """Which LLM provider _llm_complete will use. An explicit LLM_PROVIDER wins
    when its key is set; otherwise fall back to priority order among the
    configured keys. Returns 'minimax' | 'anthropic' | 'gemini' | 'none'."""
    keyed = {
        "minimax": bool(MINIMAX_API_KEY),
        "anthropic": bool(ANTHROPIC_API_KEY),
        "gemini": bool(GEMINI_API_KEY),
    }
    if LLM_PROVIDER in keyed and keyed[LLM_PROVIDER]:
        return LLM_PROVIDER
    for name in ("minimax", "anthropic", "gemini"):
        if keyed[name]:
            return name
    return "none"


def _active_model_id() -> str:
    """The model id _llm_complete would use, for the audit log. Reflects the
    model that actually answered (was hardcoded to the Anthropic default)."""
    return {
        "minimax": MINIMAX_MODEL,
        "anthropic": DEFAULT_MODEL,
        "gemini": GEMINI_MODEL,
    }.get(_select_provider(), "none")

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
    # SVXY is NOT rates and NOT credit — it is short volatility, which behaves as a
    # levered long-equity risk premium (measured market beta +2.08). Listing it under
    # the rates and credit lenses put an instrument that loses 35% in a VIX spike into
    # the candidate pool of a duration book. See ADR-0119.
    "credit":    {"HYG", "LQD", "JNK", "BKLN", "ANGL", "EMB", "CDX", "HY",
                  "TLT", "IEF", "SHY", "TIPS", "AGG", "BIL"},
    "rates":     {"TLT", "IEF", "SHY", "TIPS", "AGG", "BIL"},
    "equity":    {"QQQ", "SPY", "IWM", "FXI", "MCHI", "BABA", "KWEB", "XLE", "XLF",
                  "XLV", "ARKK", "EWJ", "EWZ", "SVXY"},
    "fx":        {"UUP", "FXE"},   # DXY is an index, not an instrument (migration 031)
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


def _strip_reasoning_and_fences(text: str) -> str:
    """Clean an LLM completion for json.loads: drop MiniMax <think> blocks and
    markdown ```json fences. Handles an UNCLOSED opening fence (a truncated
    response) by stripping just the leading fence rather than failing to match
    and leaving a leading ``` that breaks json.loads.

    An UNCLOSED <think> is stripped too. It means the model was still reasoning when
    it hit the token ceiling, so there is no answer anywhere in the response — and
    leaving the fragment in produced a parse error that described the JSON rather
    than the budget."""
    import re
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"<think>.*\Z", "", text, flags=re.DOTALL)
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    text = re.sub(r"^\s*```(?:json)?\s*", "", text)   # unclosed / truncated fence
    text = re.sub(r"\s*```\s*$", "", text)
    return text.strip()


def _llm_complete(prompt: str, system: str = "", temperature: float = 0.0,
                  response_schema: dict | None = None) -> str:
    """Provider call under a WALL-CLOCK deadline.

    ``LLM_TIMEOUT_SECONDS`` was passed straight to ``requests.post(timeout=...)``,
    which does not mean what the name suggests: requests applies it to the connect
    and to the gap BETWEEN BYTES, and its own docs are explicit that it "is not a
    time limit on the entire response download". A provider that trickles data — or
    a reasoning model thinking slowly with the connection alive — never trips it.

    Observed rather than theorised: with the value set to 900s, one L5 call ran 23
    minutes and a later one passed 45 minutes still inside a single attempt. In the
    daily GitHub Actions job that is not a slow book, it is a hung workflow that
    produces nothing and holds the runner toward its 6-hour ceiling.

    So the deadline is enforced here, around whichever provider runs, and the
    per-request timeout is kept as the inner (inter-byte) guard it actually is. On
    expiry the worker is abandoned — it holds a socket, and this is a batch process —
    and TimeoutError propagates into the existing retry-then-fallback path, which is
    what should happen when a provider stalls.
    """
    from concurrent.futures import ThreadPoolExecutor
    from concurrent.futures import TimeoutError as _FTimeout

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        fut = pool.submit(
            _llm_complete_inner, prompt, system, temperature, response_schema
        )
        try:
            return fut.result(timeout=LLM_TIMEOUT_SECONDS)
        except _FTimeout:
            raise TimeoutError(
                f"LLM call exceeded {LLM_TIMEOUT_SECONDS}s wall clock "
                f"(provider={_select_provider()})"
            ) from None
    finally:
        # Never block on an abandoned worker on the way out.
        pool.shutdown(wait=False)


def _llm_complete_inner(prompt: str, system: str = "", temperature: float = 0.0,
                        response_schema: dict | None = None) -> str:
    """
    Route LLM call: MiniMax (preferred) → Anthropic Claude → Gemini (fallbacks).
    Raises ValueError if no provider is configured.
    Returns raw text response.

    ``response_schema`` (Gemini only): an OpenAPI-subset JSON schema that forces
    the model to emit structured JSON. Used by reason_picks to *require* the
    citations array — free-tier Gemini-flash otherwise omits it and the citation
    guardrail falls back. Ignored by MiniMax/Anthropic (they get JSON via prompt).
    """
    provider = _select_provider()

    # ── MiniMax (OpenAI-compatible) ──────────────────────────────────────────
    if provider == "minimax":
        import requests as _rq

        messages: list[dict[str, str]] = []
        if system:
            # MiniMax doesn't have a top-level system param — fold into first user msg
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload: dict[str, Any] = {
            "model": MINIMAX_MODEL,
            "messages": messages,
            # MiniMax-M3 is a reasoning model: internal reasoning eats the token
            # budget, so 8192 was consumed before any JSON `content` was emitted
            # (empty content → parse fail → fallback). Give generous headroom so
            # reasoning AND the full 10-pick book fit.
            # MiniMax-M2/M3 emit a <think> block BEFORE the answer and both come out
            # of the same budget, so reasoning that runs long leaves nothing for the
            # answer. That is not a hypothetical: on 2026-07-24 reason_picks logged
            #   JSON DECODE FAILED: Expecting value: line 1 column 1 | raw=0 chars
            # on consecutive attempts, and a direct probe reproduced it exactly —
            # HTTP 200, base_resp status 0 (success), content consisting of an
            # unterminated <think> block and no answer at all. Stripping the block
            # leaves the empty string, which then reads as a parse failure rather
            # than as "the model spent its budget thinking".
            #
            # 24000 was enough for most books and not for the largest, which is the
            # worst kind of limit: it fails intermittently and only on the hard runs.
            "max_tokens": int(os.environ.get("MINIMAX_MAX_TOKENS", "64000")),
            "temperature": temperature,
        }
        if response_schema is not None:
            # JSON mode: return a single JSON object (suppresses <think> / prose)
            # so the citations the model already writes inline become parseable.
            payload["response_format"] = {"type": "json_object"}

        resp = _rq.post(
            MINIMAX_ENDPOINT,
            headers={
                "Authorization": f"Bearer {MINIMAX_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=LLM_TIMEOUT_SECONDS,
        )
        if resp.status_code != 200:
            err = resp.json()
            raise ValueError(
                f"MiniMax API error {resp.status_code}: "
                f"{err.get('error', {}).get('message', resp.text[:200])}"
            )
        text = resp.json()["choices"][0]["message"]["content"]
        return _strip_reasoning_and_fences(text)

    # ── Anthropic Claude (fallback) ─────────────────────────────────────────
    if provider == "anthropic":
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        kwargs: dict[str, Any] = {
            "model": DEFAULT_MODEL,
            # 4096 could not hold a ten-pick book even before thinking existed: it
            # truncated the JSON mid-array, and reason_picks read that as
            # JSONDecodeError rather than as "the answer did not fit". The Claude 5
            # family also thinks adaptively by default and spends *this* budget
            # doing it — the same failure mode MINIMAX_MAX_TOKENS exists for.
            "max_tokens": int(os.environ.get("ANTHROPIC_MAX_TOKENS", "32000")),
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        # `temperature` is deliberately not forwarded. The Claude 5 family rejects
        # temperature/top_p/top_k with a 400; determinism here comes from the
        # candidate hard-filter and the citation guardrail, not a sampling knob.
        # The parameter still applies to MiniMax and Gemini above.
        with client.messages.stream(**kwargs) as stream:
            resp = stream.get_final_message()
        if resp.stop_reason == "refusal":
            raise ValueError("Anthropic declined the request (stop_reason=refusal)")
        # Adaptive thinking puts a thinking block first, so content[0] is not the
        # answer any more.
        text = "".join(b.text for b in resp.content if b.type == "text")
        if not text:
            raise ValueError(
                f"Anthropic returned no text block (stop_reason={resp.stop_reason})"
            )
        return _strip_reasoning_and_fences(text)

    # ── Google Gemini (fallback) ─────────────────────────────────────────────
    if provider == "gemini":
        import requests as _rq

        gen_cfg: dict[str, Any] = {"temperature": temperature, "maxOutputTokens": 4096}
        if response_schema is not None:
            # Structured output: force valid JSON matching the schema (so the
            # citations array is always present). Response comes back un-fenced.
            gen_cfg["responseMimeType"] = "application/json"
            gen_cfg["responseSchema"] = response_schema
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": gen_cfg,
        }
        if system:
            body["system_instruction"] = {"parts": [{"text": system}]}

        resp = _rq.post(
            GEMINI_ENDPOINT.format(model=GEMINI_MODEL),
            params={"key": GEMINI_API_KEY},
            headers={"Content-Type": "application/json"},
            json=body,
            timeout=LLM_TIMEOUT_SECONDS,
        )
        if resp.status_code != 200:
            err = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            raise ValueError(
                f"Gemini API error {resp.status_code}: "
                f"{err.get('error', {}).get('message', resp.text[:200])}"
            )
        data = resp.json()
        try:
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError) as exc:
            raise ValueError(f"Gemini returned no usable candidate: {str(data)[:200]}") from exc
        # Gemini can still wrap JSON in ```json ... ``` fences when not in
        # structured-output mode; strip them (robust to truncation) for json.loads.
        return _strip_reasoning_and_fences(text)

    # ── None configured ──────────────────────────────────────────────────────
    raise ValueError(
        "No LLM provider configured. Set MINIMAX_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY."
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

def _load_recent_headlines(sb: Client, run_date: str, lookback_days: int = 7) -> list[dict]:
    """
    Read last-N-days headlines from `theme_news` for classify_news / reason_picks.

    Returns [{text, date, theme_id, source}]. Returns [] — and the agent falls
    back to macro-only context — when the table is absent (migration 018 not
    applied) or empty. This is the read side of the news-wiring: previously
    aggregate_context hardcoded an empty list so the LLM never saw any news.
    """
    from datetime import date as _date, timedelta as _timedelta
    try:
        cutoff = (_date.fromisoformat(run_date) - _timedelta(days=lookback_days)).isoformat()
    except (TypeError, ValueError):
        cutoff = run_date
    try:
        rows = (
            sb.table("theme_news")
            .select("theme_id, headline, source, published_date, run_date")
            .gte("run_date", cutoff)
            .lte("run_date", run_date)
            .limit(500)
            .execute()
            .data
        )
    except Exception as exc:
        print(f"[aggregate_context] theme_news unavailable ({exc.__class__.__name__}); "
              f"L5 proceeds with macro-only context.")
        return []
    return [
        {
            "text": r.get("headline", ""),
            "date": r.get("published_date") or r.get("run_date"),
            "theme_id": r.get("theme_id"),
            "source": r.get("source"),
        }
        for r in (rows or [])
        if r.get("headline")
    ]


# Sentinel: "the key was never set", as distinct from "fetched and got None/{}". A plain
# `.get(key)` returning None cannot tell those apart, and they mean different things — the
# first should fetch, the second must not.
_COT_NOT_FETCHED = object()


def _fetch_cot_readings(picks_or_candidates: list[dict]) -> dict | None:
    """The run's ONE read of CFTC speculator positioning. Never raises.

    Fetched here, ahead of sizing, because `crowding_caps` now tightens a position's limit
    (ADR-0110) and `_positioning_row` explains it — and those two must be the same reading.
    Returns None on a wholesale failure, which persists as `fetched=False`: "we did not look"
    is a different claim from "nothing is crowded" (ADR-0097).
    """
    try:
        from ..data.cot_fetcher import fetch_readings
    except Exception as exc:  # noqa: BLE001 — an overlay must never cost the run
        print(f"[cot] fetcher unavailable ({exc.__class__.__name__}): {exc}")
        return None
    assets = [c.get("asset") for c in (picks_or_candidates or []) if c.get("asset")]
    if not assets:
        return None
    try:
        readings = fetch_readings(assets)
    except Exception as exc:  # noqa: BLE001
        print(f"[cot] fetch failed ({exc.__class__.__name__}): {exc}")
        return None
    print(f"[cot] {len(readings)} of {len(set(assets))} assets have a usable reading")
    return readings


def _load_edge_ic(sb: Client) -> tuple[IcReading | None, str | None]:
    """The most recent measured EdgeScore component ICs, blended into one number.

    `scripts/backtest_edge.py` writes one row per component per run, replacing rather
    than upserting, so the latest `end_date` holds the current reading. We take only
    that date's rows: blending an IC measured last month with one measured today
    would report a composite belonging to neither.

    Returns `(None, reason)` on any failure — no IC is a normal state (the panel is
    honest that none of the components has cleared significance), and it must never
    take down a book. The reason is persisted so `/book` can say which sizing ran.
    """
    try:
        rows = (
            sb.table("backtest_results")
            .select("metric_name, realized_value, end_date, notes")
            .eq("test_name", "edge_ic")
            .order("end_date", desc=True)
            .limit(40)
            .execute()
            .data
        ) or []
    except Exception as exc:
        return None, f"backtest_results unavailable ({exc.__class__.__name__})"

    if not rows:
        return None, "no EdgeScore IC has been measured yet"

    latest = max(str(r.get("end_date") or "") for r in rows)
    current = [r for r in rows if str(r.get("end_date") or "") == latest]
    reading, reason = composite_edge_ic(current)
    if reading is None:
        return None, reason
    print(
        f"[aggregate_context] EdgeScore IC {reading.raw:+.4f} raw, "
        f"{reading.value:+.4f} after {reading.shrinkage:.0%} shrinkage "
        f"({len(reading.components)} components, as of {reading.as_of})"
    )
    return reading, None


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

    # L1 news: collect last-7d raw headlines for classify_news / reason_picks.
    # Persisted by scripts/daily_refresh.persist_theme_news (migration 018).
    # If the table is absent, this returns [] and the agent reasons over the
    # macro snapshot alone — the prior behaviour, now an explicit fallback.
    news_headlines = _load_recent_headlines(sb, state["run_date"])

    # The measured EdgeScore IC, which `size_positions` needs to build expected
    # returns. Fetched HERE rather than in the sizing node so the sizing stays a pure
    # function of state — the same reason the L0-L4 snapshot is frozen at graph entry
    # (ADR-0013). A missing or unusable IC is not an error: it means the optimizer has
    # no return forecast to work from, and the run sizes by conviction instead. The
    # reason travels so the book can say which of the two sized it.
    state["edge_ic"], state["edge_ic_reason"] = _load_edge_ic(sb)

    # The run's one COT read, over the CANDIDATE pool — picks are a subset of it, so this
    # covers whatever L5 goes on to choose without needing to know the choice yet, and it
    # happens off the LLM's critical path. `size_positions` tightens caps from it and
    # `_positioning_row` explains those caps from the same object (ADR-0110).
    state["cot_readings"] = _fetch_cot_readings(state.get("candidates") or [])

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
        # The IC is an INPUT to sizing, so it belongs in the frozen snapshot: a
        # reviewer re-running the audit days later has to see the same number the
        # optimizer saw, not whatever the panel reads today.
        "edge_ic": state["edge_ic"].to_dict() if state["edge_ic"] else None,
        "edge_ic_reason": state["edge_ic_reason"],
    }

    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 2: screen_candidates  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

def screen_candidates(state: Q1State) -> Q1State:
    """
    Filter the L1 candidate pool down to the tradable set the LLM sees (ADR-0030).

    The pool is ``state["candidates"]`` — the candidates ``daily_refresh`` already
    ranked in ``rank_trade_candidates``: hype-gated (HypeScore >= threshold),
    directioned by sign(TradeScore), and made two-sided by the ADR-0029 backfill.
    Those decisions are INHERITED here, not re-derived. Before ADR-0030 this node
    rebuilt the pool from ``theme_scores`` with its own ``hype >= threshold AND
    sign`` logic and NO backfill — a second, divergent copy of the direction rule,
    so the L5 book could go one-sided even on a day the L1 book didn't.

    This node now applies only the L5-specific filters L1 doesn't:
      1. Lens filter — if state["lens"] != "multi_asset", keep only in-lens assets
      2. Factor R² >= 0.10 for equities (ETFs exempt — stable liquid histories)
      3. Dedupe (asset, direction), keep the highest-HypeScore entry
      4. Cap at 30 for the LLM context window
    """
    cfg: ScoringConfig = state["cfg"]
    factor_exp = state.get("factor_exposures") or {}
    if not factor_exp:
        print("[screen_candidates] No factor_exposures available — the R^2 "
              "liquidity filter is skipped; equities pass through unchecked.")
    lens: str = state.get("lens", "multi_asset")
    if lens not in VALID_LENSES:
        print(f"[screen_candidates] Unknown lens '{lens}' — defaulting to multi_asset")
        lens = "multi_asset"

    # The pool handed over by L1 (via run_q1_agent): each entry already carries a
    # direction from sign(TradeScore) and HypeScore >= threshold, and the pool is
    # two-sided by construction (ADR-0029 backfill). We inherit those decisions —
    # only the L5-specific filters below run here.
    l1_pool: list[dict] = state.get("candidates") or []
    name_by_id = {t["theme_id"]: t["name"] for t in (state.get("theme_scores") or [])}

    # Universe of liquid ETFs — always allowed (no R² check needed)
    LIQUID_ETF_UNIVERSE = set(SECTOR_MAP.keys())

    # Lens ticker set (fallback when theme_assets.asset_class is unavailable)
    lens_tickers: set[str] | None = None
    if lens != "multi_asset":
        lens_tickers = set(LENS_TICKER_FALLBACK.get(lens, set()))

    # Attrition tracking, persisted as research_recommendations.screening_funnel
    # and rendered on /book.
    l1_total = len(l1_pool)
    dropped_lens = 0
    dropped_r2 = 0
    eligible: list[dict] = []

    for c in l1_pool:
        asset = c["asset"]
        # Lens filter — drop assets outside the selected lens
        if lens_tickers is not None and asset not in lens_tickers:
            dropped_lens += 1
            continue

        is_etf = asset in LIQUID_ETF_UNIVERSE

        # Factor beta check: ETFs always pass; equities need R² >= 0.1
        if factor_exp:
            fe = factor_exp.get(asset, {})
            r2 = fe.get("r_squared", 0.0)
            if not is_etf and r2 < 0.10:
                dropped_r2 += 1
                continue   # insufficient history for this equity

        eligible.append({
            "asset": asset,
            "direction": c["direction"],
            "theme_id": c.get("theme_id"),
            # L1 leaves theme_name blank; backfill it from theme_scores so the
            # candidate table and /book provenance name the theme.
            "theme_name": c.get("theme_name") or name_by_id.get(c.get("theme_id"), ""),
            "hype_score": c.get("hype_score", 0.0),
            "trade_score": c.get("trade_score", 0.0),
            "avg_sentiment": c.get("avg_sentiment", 0.0),
            "via_conviction": bool(c.get("via_conviction")),
            # Carried so the cap-30 truncation can order by conviction. Without it
            # the sort falls back to hype and re-imposes the attention gate.
            "edge_score": c.get("edge_score", 0.0),
            # Carried so size_positions can weight by conviction (ADR-0053).
            "conviction": c.get("conviction", 0.0),
            "vol": c.get("vol", 0.0),
        })

    # Deduplicate: keep highest-hype entry per (asset, direction)
    seen: dict[tuple[str, str], dict] = {}
    for c in eligible:
        key = (c["asset"], c["direction"])
        if key not in seen or c["hype_score"] > seen[key]["hype_score"]:
            seen[key] = c

    candidate_pool = list(seen.values())
    # Order by CONVICTION, not attention (ADR-0046). This list is truncated to 30 for
    # the LLM context window, so whatever it is sorted by decides what gets thrown
    # away — and sorting by hype_score meant the cap re-imposed the attention gate one
    # layer below the gate itself. Measured on 2026-07-25, the first run after the
    # conviction override landed: the override admitted SLV -0.430, the single most
    # decisive name of the day either way, and the cap-30 truncation cut it straight
    # back out along with GDX -0.368, NEM -0.337, IAU -0.288, NUE +0.421 and CVX
    # +0.402 — every one of them dropped for belonging to a quiet theme.
    #
    # If names must be dropped, drop the least decisive, not the least loud. Ties and
    # missing edges fall back to hype so the ordering is still total.
    candidate_pool.sort(
        key=lambda x: (abs(x.get("edge_score") or 0.0), x.get("hype_score") or 0.0),
        reverse=True,
    )

    if len(candidate_pool) < 10 and lens != "multi_asset":
        # Lens filter too aggressive — fall back to multi-asset pool
        # rather than produce a 3-pick book. Log it; do not silently switch.
        print(f"[screen_candidates] Lens '{lens}' yielded {len(candidate_pool)} "
              f"candidates (< 10). Consider widening the lens.")

    state["candidates"] = candidate_pool[:30]   # cap at 30 for LLM context

    deduped = len(eligible) - len(candidate_pool)
    via_conviction_n = sum(1 for c in l1_pool if c.get("via_conviction"))
    state["screening_funnel"] = [
        {
            "stage": "L1 ranked candidates",
            "remaining": l1_total,
            "removed": 0,
            "reason": (
                "From rank_trade_candidates: HypeScore >= threshold, direction = "
                "sign(TradeScore), two-sided via backfill (ADR-0029/0030)."
            ),
        },
        {
            # Not an attrition stage — the only one that ADDS. Shown because a
            # funnel that only ever subtracts implies the pool started complete,
            # and until ADR-0046 it did not: the attention gate was silently
            # deciding tradability, not just priority.
            "stage": "conviction override (ADR-0046)",
            "remaining": l1_total,
            "removed": 0,
            "reason": (
                f"{via_conviction_n} of these {l1_total} candidates come from themes "
                "BELOW the attention gate, admitted because the name's own |EdgeScore| "
                "is decisive. Attention chooses what we look at; it does not decide "
                "what is tradable."
                if via_conviction_n
                else "No sub-attention theme held a decisive enough name to be admitted."
            ),
        },
        {
            "stage": f"lens = {lens}",
            "remaining": l1_total - dropped_lens,
            "removed": dropped_lens,
            "reason": (
                "Asset outside the selected asset-class lens."
                if lens != "multi_asset" else "No lens filter applied."
            ),
        },
        {
            "stage": "factor R^2 >= 0.10",
            "remaining": len(eligible),
            "removed": dropped_r2,
            "reason": "Insufficient regression history to trust the beta (ETFs exempt).",
        },
        {
            "stage": "dedupe (asset, direction)",
            "remaining": len(candidate_pool),
            "removed": deduped,
            "reason": "Same asset reached via multiple themes; highest HypeScore kept.",
        },
        {
            "stage": "candidate pool (cap 30)",
            "remaining": len(state["candidates"]),
            "removed": max(0, len(candidate_pool) - 30),
            "reason": (
                "Truncated to fit the LLM context window, keeping the highest "
                "|EdgeScore|. Ordered by conviction and NOT by attention: this cap "
                "decides what is discarded, and ranking it by HypeScore re-imposed "
                "the attention gate one layer below the gate itself (ADR-0046)."
            ),
        },
    ]

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

    # How many genuinely separate bets each side of the POOL contains (ADR-0048).
    # Q1 asks for five and five; the agent is told "fewer if the pool is thin", and
    # until now it had no way to know whether the pool was thin. Twelve short
    # candidates that collapse to three complexes IS thin; twelve that collapse to
    # five is not. Wrapped: an explanatory measurement must never fail the book.
    try:
        state["independent_ideas"] = independent_ideas(state.get("candidates") or [])
    except Exception as exc:   # pragma: no cover - network/data shape
        print(f"[compute_book_metrics] independent_ideas failed ({exc.__class__.__name__}): {exc}")
        state["independent_ideas"] = {}

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

    # Fetch the disruption reading ONCE per run and keep it on state, so node 5's prompt
    # table and the persisted analytics are stressed by the same signal. With no credential
    # `fetch_signal` makes no network call at all and returns the neutral 1.0 WITH a reason
    # (ADR-0095), which is what has to reach /risk — a bare 1.0 is indistinguishable from a
    # measurement of "no disruption".
    state["chokepoint_signal"] = _chokepoint_signal()

    results = run_scenario_analysis(
        picks=enriched_picks,
        book_metrics=bm,
        total_capital=total_capital,
        factor_exposures=state.get("factor_exposures") or {},
        chokepoint_signal=state["chokepoint_signal"],
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

# classify_news is a *nice-to-have* digest; reason_picks is the critical call.
# On a rate-limited free tier (Gemini: ~20 req/min) classifying all ~160 daily
# headlines in batches of 10 burned the whole quota before reason_picks ran →
# every book fell back. Cap the sample and use large batches so classify_news
# costs ≤2 calls and leaves quota for the picks. Tune via env if you have a
# higher tier.
CLASSIFY_MAX_HEADLINES = int(os.environ.get("CLASSIFY_MAX_HEADLINES", "40"))
CLASSIFY_BATCH_SIZE = int(os.environ.get("CLASSIFY_BATCH_SIZE", "20"))


def classify_news(state: Q1State) -> Q1State:
    """
    Batch LLM call: tag recent headlines with {category, sentiment, theme, summary}.
    Bounded to CLASSIFY_MAX_HEADLINES in batches of CLASSIFY_BATCH_SIZE so it never
    starves reason_picks of a rate-limited LLM quota. Results feed reason_picks.
    """
    headlines = state.get("news_headlines", [])[:CLASSIFY_MAX_HEADLINES]
    if not headlines:
        # No news collected — use macro snapshot keys as the news context
        state["classified_news"] = []
        return state

    classified: list[dict] = []
    batch_size = CLASSIFY_BATCH_SIZE

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

# Gemini structured-output schema (OpenAPI subset). Forces the model to emit the
# citations array — free-tier Gemini-flash otherwise omits it, so verify_citations
# rejects every run and the book silently degrades to the deterministic fallback.
# `minItems` on citations guarantees the array is non-empty.
_CITATION_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "source": {"type": "string"},
        "value": {"type": "number"},
    },
    "required": ["text", "source"],
}
REASON_PICKS_SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rank": {"type": "integer"},
                    "direction": {"type": "string", "enum": ["long", "short"]},
                    "asset": {"type": "string"},
                    "theme": {"type": "string"},
                    "hype_score": {"type": "number"},
                    "trade_score": {"type": "number"},
                    "time_horizon": {"type": "string"},
                    "thesis": {"type": "string"},
                    "counter_thesis": {"type": "string"},
                    "risk": {"type": "string"},
                    "citations": {"type": "array", "items": _CITATION_SCHEMA},
                },
                "required": ["direction", "asset", "theme", "thesis", "counter_thesis"],
            },
        },
        "book_view": {"type": "string"},
        "book_risks": {"type": "array", "items": {"type": "string"}},
        "citations": {"type": "array", "items": _CITATION_SCHEMA, "minItems": 2},
    },
    "required": ["picks", "book_view", "book_risks", "citations"],
}

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
  1. Select the best LONG and SHORT picks from the candidate pool — up to 5 each
  2. Ensure the resulting book has coherent factor tilts (avoid unintended crowded bets)
  3. Reference the pre-computed book_metrics and scenario analysis in your reasoning
  4. For each pick: specify a time horizon and a measurable counter-thesis

DO NOT state position sizes, weights, notionals, or the book's net/gross exposure.
You choose WHICH names and WHICH side; a later deterministic step decides HOW MUCH.
That step applies the 20% single-name / 30% sector / 35% geography limits and holds
whatever they refuse in CASH, so the book routinely deploys less than 100% of
capital — a three-name book deploys 60%. Any exposure figure you assert will be
contradicted by the sized book shown directly beneath your text. Write about
direction, rationale, catalysts and risk, and leave the arithmetic of size alone.

DO NOT restate the independent-idea counts from POOL DEPTH. Use them to DECIDE how
many picks to return; the page states the counts itself, directly beneath your text.
A count you retype is a number the guardrail cannot check — every small integer
grounds trivially against something in the inputs — so a miscount would reach the
reader wearing a VERIFIED badge. Name WHICH complexes you collapsed and why; leave
HOW MANY to the measurement.

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
- pick UP TO 5 longs and UP TO 5 shorts, drawn ONLY from the candidate pool; if the
  pool is thin, return FEWER picks — never invent tickers that aren't candidates
- every numeric value in thesis, catalysts, risk, counter_thesis, or book_view MUST cite a source
- time_horizon must be specific: "1-2 weeks" | "2-4 weeks" | "1-3 months" | "3-6 months"
- counter_thesis MUST include a measurable disqualifier: a specific price/yield/data level, not a vague concern
- do NOT emit factor_tilts. Each pick's FF5+UMD betas are joined from the L2
  factor_exposures table after you answer — they are measured per asset, and the
  book's are recomputed on your actual weights
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
  Yield curve slope (10y-2y): {yc_slope}
  HY credit OAS: {hy_oas}
  VIX: {vix}
  VIX term structure: {vix_term}
  Real rate: {real_rate}%
  SPX breadth: {breadth}%

=== THEME SCORES (L1, sorted by HypeScore) ===
{theme_table}

=== FACTOR EXPOSURES (L2, sample — FF5 + UMD) ===
{factor_table}

=== CANDIDATE-POOL METRICS — EQUAL-WEIGHTED, BEFORE YOUR SELECTION ===
These describe the SCREENED POOL you are choosing from, with every candidate weighted
equally. They are NOT the book's metrics. Your picks are a subset, conviction-weighted
and capped, so its sector, geography, exposure and cap figures WILL differ — the pool
has 30 names, the book will have ~10.
Use these to see which complexes are crowded and where a cap would bind. NEVER state
them as the book's own composition, and never claim a cap breach from them: the sizer
enforces every cap after you pick, and the page prints the book's real figures beside
your text.
DO NOT restate any factor tilt (Mkt, SMB, HML, RMW, CMA, UMD) as the book's, and do not
call the book market-neutral, net-long or net-short from these numbers. The book's tilts
are recomputed on your actual picks at their actual weights AFTER you answer, and they
differ: a pool tilt of Mkt -0.02 became a book tilt of -0.50 on 2026-07-25, so a thesis
calling that book "market-neutral" was wrong by 25x on its own headline risk claim.
Describe the DIRECTION of your tilt in words if it matters ("value-tilted", "short
duration"); the page prints the measured numbers beneath you.
{book_metrics_summary}

=== SCENARIO ANALYSIS ===
{scenario_table}

=== RISK METRICS (L4) ===
Portfolio VaR (95%): {var_95}
Portfolio CVaR (95%): {cvar_95}
Sharpe ratio: {sharpe}
Beta to SPX: {beta}
Concentration HHI: {hhi}

=== TRADABLE ASSETS (candidates, sorted by |EdgeScore| — most decisive first) ===
{candidate_table}

=== WHAT MOVES EACH NAME (assembled from this system's own records — do NOT add your own) ===
{position_dossiers}

=== RECENT NEWS (if any) ===
{news_summary}

=== POOL DEPTH (measured, not estimated) ===
{independent_ideas_summary}

=== INSTRUCTIONS ===
Select up to 5 LONG and up to 5 SHORT from the candidate pool (fewer if the pool is thin).
POOL DEPTH above says how thin it actually is: it counts INDEPENDENT ideas, having
already collapsed each group of mutually-correlated names into one. Returning fewer
picks than that count needs a reason stated in book_view; returning fewer than five
per side when five independent ideas exist is a choice, not a constraint.
If you take fewer than five on a side, book_view MUST NAME each independent idea you
declined — by its ticker, the one shown in POOL DEPTH — and say why in a clause each.
"Net bias is long given 5 long vs 4 short" restates the shortfall; it does not explain
it. A reason is specific: it would net against a position already on, its edge is too
close to the abstention band, it would breach a sector cap. This is checked against the
measurement after you answer, and an unnamed declined idea is reported on the page.
NEVER say a declined name was unavailable, absent, or not in the candidate pool. Every
name in POOL DEPTH came FROM that pool, so the claim is always false and is rejected
outright. If you have no better reason than "I chose not to", say exactly that — an
honest "no further conviction" is accepted; a fabricated availability excuse is not.
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


# A curve within this of flat is described as flat rather than given a direction —
# ±5bps is inside the daily noise of two separately-quoted constant-maturity yields.
FLAT_CURVE_BPS = 5.0


def _is_num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _describe_yield_curve(slope_pct: float | None) -> str:
    """Render the 10y-2y slope in bps **and say what shape that is**.

    `regime_classifications.yield_curve_slope` is stored in PERCENT (DGS10 − DGS2, both
    FRED percent series), so 2026-07-25's +34bps curve is persisted as `0.34`. The prompt
    printed the raw number under a header reading `bps` — telling the agent the curve was
    **0.34 basis points**, indistinguishable from flat. It duly opened the published
    thesis with *"an inverted curve"* while quoting levels that show an upward slope.
    That is the same percent-vs-bps mismatch that made the classifier's own thresholds
    unreachable (iteration 72), surviving in the one place it reaches a reader.

    Converting the unit is necessary but not sufficient: a *shape* is a characterisation
    the system can compute, and by the rule in [ADR-0049]/[ADR-0073] a fact the system can
    compute is not left for the model to infer. So the label is stated, not implied.
    """
    if not _is_num(slope_pct):
        return "N/A"
    bps = slope_pct * 100.0
    if abs(bps) < FLAT_CURVE_BPS:
        shape = "essentially FLAT — neither inverted nor meaningfully upward-sloping"
    elif bps > 0:
        shape = "upward-sloping — the curve is NOT inverted"
    else:
        shape = "INVERTED — 10y below 2y"
    return f"{bps:+.0f} bps ({shape})"


def _describe_vix_term(diff: float | None) -> str:
    """Render VIX − VIX3M with its regime named.

    The convention note *"positive = backwardation"* was correct for this quantity, and
    the model still got it backwards: handed `-1.93`, it wrote *"term structure already in
    backwardation (VIX3M-VIX = +1.93)"* — flipping the subtraction order, which is
    arithmetically fine, and then keeping the label that belonged to the other order. Under
    VIX3M − VIX = +1.93 the market is in **contango**, the calm state, and the thesis used
    the opposite to argue a VIX-spike risk was already underway.

    Naming the state removes the step where a convention has to be applied correctly.
    """
    if not _is_num(diff):
        return "N/A"
    if abs(diff) < 0.05:
        state = "flat"
    elif diff > 0:
        state = "BACKWARDATION — spot above 3-month, the stressed state"
    else:
        state = "CONTANGO — spot below 3-month, the calm/normal state"
    return f"VIX − VIX3M = {diff:+.2f} ({state})"


def _describe_bps(value_pct: float | None) -> str:
    """A FRED percent series rendered in bps, e.g. HY OAS 2.77 → `277 bps`.

    The prompt read `HY credit OAS: 2.77 bps` for a spread that is 277 — a credit market
    described as ~100x tighter than it is.
    """
    if not _is_num(value_pct):
        return "N/A"
    return f"{value_pct * 100:.0f} bps"


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


# A value no real score takes, so `_num(raw, _NUM_SENTINEL) == _NUM_SENTINEL`
# distinguishes "did not parse" from "parsed as 0.0".
_NUM_SENTINEL = -1.0e308


def _num(v, default: float = 0.0) -> float:
    """Coerce a possibly-NULL DB numeric to a float for formatting.

    dict.get(k, default) returns a *stored* None rather than the default, and
    real factor_exposures rows carry NULL betas / r_squared — `None:>7.2f` then
    raises `TypeError: unsupported format string passed to NoneType.__format__`
    and takes down the whole L5 run. Coerce None (and non-numeric) to default.
    """
    try:
        return float(v) if v is not None else default
    except (TypeError, ValueError):
        return default


def _make_factor_table(factor_exp: dict[str, dict]) -> str:
    if not factor_exp:
        return "(no factor exposure data)"
    header = "  asset | beta_mkt | beta_smb | beta_hml | beta_rmw | beta_cma | beta_umd | R2"
    rows = []
    for asset, vals in list(factor_exp.items())[:15]:
        rows.append(
            f"  {asset:<8} | {_num(vals.get('beta_mkt')):>8.2f} | {_num(vals.get('beta_smb')):>7.2f} | "
            f"{_num(vals.get('beta_hml')):>8.2f} | {_num(vals.get('beta_rmw')):>8.2f} | "
            f"{_num(vals.get('beta_cma')):>8.2f} | {_num(vals.get('beta_umd')):>7.2f} | {_num(vals.get('r_squared')):>4.2f}"
        )
    return header + "\n" + "\n".join(rows)


def _format_independent_ideas(idea_counts: dict) -> str:
    """State how many SEPARATE bets each side of the pool holds (ADR-0048).

    The agent is told "fewer if the pool is thin" and had no way to know whether it
    was. A candidate count cannot tell it: on 2026-07-25 the short side's twelve
    names were five ideas, because five of them are one precious-metals bet and four
    are one China-internet bet. Naming the complexes rather than only counting them
    lets the agent see WHICH names are interchangeable, so it can take the strongest
    of each rather than quietly dropping the whole group.
    """
    if not idea_counts:
        return "(pool depth unavailable — correlation history missing)"

    lines: list[str] = []
    for side in ("long", "short"):
        d = idea_counts.get(side) or {}
        count, names = d.get("count", 0), d.get("names", 0)
        reach = "reachable" if count >= 5 else "NOT reachable — take what exists"
        lines.append(
            f"{side.upper()}: {names} candidates -> {count} INDEPENDENT "
            f"idea{'' if count == 1 else 's'} (Q1 asks for 5; {reach})"
        )
        for cx in d.get("complexes", []):
            members = ", ".join(cx.get("members", []))
            lines.append(
                f"    ONE IDEA: {members} — take at most one; "
                f"strongest is {cx.get('strongest')}"
            )
        alone = d.get("standalone") or []
        if alone:
            lines.append(f"    independent on their own: {', '.join(alone)}")
    return "\n".join(lines)


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


def _backfill_pick_theme_ids(picks: list[dict], theme_scores: list[dict]) -> None:
    """
    Populate ``theme_id`` (and ``theme_name``) on each pick, in place.

    The LLM emits picks by theme NAME only (``theme``), and the deterministic
    fallback historically dropped the id it already had — so persisted picks
    carried ``theme_id: null``. That broke every downstream per-theme join: the
    /book focus deep-link had to fall back to matching on the display name, and
    any future theme→position analytics had no stable key. Resolve each pick's
    theme name against the scored roster so a stable id travels with the pick.
    Names that don't match a scored theme (e.g. the LLM's literal 'other') are
    left without an id rather than guessed.
    """
    id_by_name: dict[str, str] = {}
    name_by_id: dict[str, str] = {}
    for t in theme_scores:
        tid, nm = t.get("theme_id"), t.get("name")
        if tid and nm:
            id_by_name[nm.strip().lower()] = tid
            name_by_id[tid] = nm
    for p in picks:
        tid = p.get("theme_id")
        nm = p.get("theme") or p.get("theme_name")
        if not tid and nm:
            tid = id_by_name.get(str(nm).strip().lower())
        if tid:
            p["theme_id"] = tid
            if not p.get("theme_name"):
                p["theme_name"] = name_by_id.get(tid, nm)


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
        # These three arrive from FRED in PERCENT and used to be printed under a header
        # reading "bps". See _describe_yield_curve for what that cost.
        "yc_slope": _describe_yield_curve(regime.get("yield_curve_slope")),
        "hy_oas": _describe_bps(regime.get("hy_oas")),
        "vix": regime.get("vix_level", "N/A"),
        "vix_term": _describe_vix_term(regime.get("vix_term_diff")),
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
        # Bar 3: the prompt carried nothing about what matters for a SPECIFIC name.
        # This is not new knowledge — it is the per-name judgement the repo already
        # encodes (reviewed scenario shocks, the COT no-contract rationales, measured
        # factor loadings, sanctions channels) finally reaching the reasoner. Nothing
        # is generated: a prompt that invited the model to supply domain knowledge
        # would invite the fabrication the guardrail exists to catch (ADR-0114).
        "position_dossiers": dossier_block(
            [c.get("asset") for c in candidates if c.get("asset")],
            state.get("factor_exposures"),
        ),
        "independent_ideas_summary": _format_independent_ideas(
            state.get("independent_ideas") or {}
        ),
        "news_summary": news_summary,
    }

    prompt = REASON_PICKS_PROMPT_TEMPLATE.format(**prompt_vars)

    # Feed the previous rejection back into the prompt.
    #
    # ADR-0012 specifies that a failed guardrail check "re-invokes reason_picks
    # with explicit error feedback" — but run_q1_agent's retry loop simply called
    # this node again with a byte-identical prompt, and _llm_complete runs at
    # temperature=0. Asking a deterministic model the same question three times
    # returns the same rejected answer three times, which is precisely what the
    # 2026-07-24 run shows: "No citations provided — rejecting output" on all
    # three attempts, then the deterministic fallback. The retries were theatre;
    # this is the feedback they were documented to carry.
    prior_error = state.get("error")
    if prior_error:
        prompt += (
            "\n\n=== YOUR PREVIOUS ANSWER WAS REJECTED ===\n"
            f"Reason: {prior_error}\n\n"
            "Return the WHOLE JSON object again, with that defect fixed.\n"
            "Hard requirements:\n"
            "  • Every pick MUST carry a non-empty \"citations\" array.\n"
            "  • Every numeric claim you make in a thesis MUST appear as a citation.\n"
            "  • Each citation's \"source\" MUST be a key that appears verbatim in the\n"
            "    snapshot above — a FRED series id (e.g. BAMLH0A0HYM2, DGS10), a\n"
            "    ticker (e.g. CL=F, ^VIX), or theme:<uuid>:<field>.\n"
            "  • Each citation's \"value\" MUST equal the snapshot value, in the same\n"
            "    units the snapshot uses.\n"
            "  • A pick with no citation is invalid — drop the pick or cite it.\n"
            "Do not explain the fix; return only the JSON object.\n"
        )

    retries = 0
    max_retries = 2

    while retries <= max_retries:
        try:
            raw = _llm_complete(prompt, system=REASON_PICKS_SYSTEM,
                                response_schema=REASON_PICKS_SCHEMA)
            parsed = json.loads(raw)

            state["picks"] = parsed.get("picks", [])
            # The LLM names themes but doesn't know their ids — resolve them so a
            # stable theme_id travels with every pick (downstream joins, deep links).
            _backfill_pick_theme_ids(state["picks"], themes)
            state["book_view"] = parsed.get("book_view", "")
            state["book_risks"] = parsed.get("book_risks", [])
            citations = parsed.get("citations", []) or []
            if not citations:
                # Some models cite inside each pick but omit the top-level summary
                # array that verify_citations scans. Aggregate the per-pick
                # citations (deduped) so a well-cited book isn't rejected on a
                # formatting technicality.
                seen: set = set()
                for p in state["picks"]:
                    for c in (p.get("citations") or []):
                        key = (c.get("source"), c.get("text"))
                        if c.get("source") and key not in seen:
                            seen.add(key)
                            citations.append(c)
            # Diagnose an empty citation set AT THE POINT IT HAPPENS. When the
            # guardrail rejects a run, raw_output ends up holding the deterministic
            # fallback, so what the model actually returned is lost and the failure
            # cannot be diagnosed after the fact — on 2026-07-24 three runs failed
            # "No citations provided" with no way to tell whether the model returned
            # no picks, picks without citations, or a truncated body. Print the
            # shape (never the full text, which is large and may be noisy) so the
            # next failure is readable straight from the run log.
            if not citations:
                per_pick = sum(len(p.get("citations") or []) for p in state["picks"])
                print(
                    f"[reason_picks] EMPTY CITATIONS (attempt {retries + 1}): "
                    f"raw={len(raw)} chars, top-level keys={sorted(parsed.keys())}, "
                    f"picks={len(state['picks'])}, per-pick citations={per_pick}, "
                    f"book_view={len(parsed.get('book_view') or '')} chars"
                )
                if state["picks"]:
                    print(f"[reason_picks]   pick[0] keys={sorted(state['picks'][0].keys())}")

            state["citations"] = citations
            state["retries"] = retries
            # T18: LLM succeeded — the body is NOT a fallback synthesis.
            state["fallback_used"] = False
            # Clear the rejection we just fed back in, so a stale reason cannot
            # be persisted next to a run that went on to verify.
            state["error"] = None
            return state

        except json.JSONDecodeError as exc:
            # Log the SHAPE of what came back. This branch was invisible: on
            # failure it falls through to fallback_picks, which sets citations=[],
            # and verify_citations then reports the generic "No citations provided"
            # — describing the FALLBACK, not the model. Two iterations were spent
            # treating that symptom as if the model were omitting citations, when
            # the real failure is that its response never parsed. MiniMax-M3 is a
            # reasoning model whose internal reasoning has eaten the token budget
            # before, which truncates the JSON mid-object.
            head = (raw or "")[:300].replace("\n", "\\n")
            tail = (raw or "")[-200:].replace("\n", "\\n")
            print(
                f"[reason_picks] JSON DECODE FAILED (attempt {retries + 1}): "
                f"{exc.__class__.__name__}: {exc} | raw={len(raw or '')} chars"
            )
            print(f"[reason_picks]   head: {head}")
            print(f"[reason_picks]   tail: {tail}")
            retries += 1
            if retries > max_retries:
                state["error"] = (
                    f"JSON decode error after {max_retries} retries "
                    f"({exc.__class__.__name__}: {exc}; raw={len(raw or '')} chars) — using fallback"
                )
                return fallback_picks(state)
        except TimeoutError as exc:
            # A stall is NOT worth retrying, and retrying it was the real cost.
            #
            # This loop treated every exception alike, so a timeout consumed all
            # three attempts: 3 x LLM_TIMEOUT_SECONDS. At the 900s default that is
            # 2700s, and 45 minutes is exactly what a stalled run was measured at.
            # ADR-0052 corrects ADR-0051, which blamed one unbounded call for that
            # observation — the wall-clock wrapper was still needed, but it was not
            # what produced the number.
            #
            # Retrying a DECODE failure is sensible: the model can fix malformed
            # output, and the branch above feeds the error back so it can. Retrying
            # a timeout asks a deterministic model the same question again while the
            # provider is demonstrably slow, and pays another full deadline to learn
            # nothing.
            print(f"[reason_picks] LLM TIMED OUT (attempt {retries + 1}): {exc} — "
                  f"not retrying; a stall is not fixed by asking again.")
            state["error"] = f"LLM timeout: {exc} — using fallback"
            return fallback_picks(state)
        except Exception as exc:
            # Same masking problem as the decode branch above: this falls through
            # to a fallback whose empty citations get reported as "No citations
            # provided", hiding the real cause (auth, rate limit, HTTP error from
            # the provider).
            print(
                f"[reason_picks] LLM CALL FAILED (attempt {retries + 1}): "
                f"{exc.__class__.__name__}: {exc}"
            )
            retries += 1
            state["error"] = f"LLM error after {retries} retries: {exc.__class__.__name__}: {exc}"
            if retries > max_retries:
                return fallback_picks(state)

    return fallback_picks(state)


# ─────────────────────────────────────────────────────────────────────────────
# Node 5: verify_citations  (pure fn guardrail)
# ─────────────────────────────────────────────────────────────────────────────

# Citation value-reconciliation tolerance. A cited number is accepted when it is
# within max(CITATION_ABS_TOL, CITATION_REL_TOL * |actual|) of the source value.
# The snapshot is fed to the LLM *with units* (e.g. BAMLH0A0HYM2 = 320.0 in bps,
# DGS10 = 4.32 in pct), so a well-behaved citation reports the value in the same
# units as the source — no cross-unit conversion is needed here.
CITATION_REL_TOL = 0.02   # 2% relative band
CITATION_ABS_TOL = 0.01   # absolute floor (keeps small-magnitude scores checkable)


_NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}

# What Q1 asks for per side. Not a threshold to tune — it is the question, and it is
# the same 5 `PoolDepth.tsx` renders. Kept as a named constant so the backend check and
# the panel cannot drift to different definitions of "short of target".
Q1_TARGET_PER_SIDE = 5


def check_idea_count_claims(prose: str, idea_counts: dict) -> list[str]:
    """Reject a thesis that restates the independent-idea count and gets it wrong.

    The citation guardrail cannot catch this and no amount of grounding will fix it.
    Measured against the live 2026-07-25 inputs, EVERY integer from 0 to 9 grounds:
    each one sits within tolerance of some value among the 106 numbers the model was
    shown. So "four independent ideas" is indistinguishable from "five" to
    ``_value_is_grounded``, and the claim never appeared in the citation list at all
    — it was prose, and ``verify_citations`` only inspects citations.

    That is exactly what happened. The run published *"the SHORT pool yields only four
    independent ideas"* when the measurement said five (it forgot ARKK), while the
    Pool depth panel below it said five and the thesis carried a VERIFIED badge.

    The prompt now tells the model not to restate these counts. A prompt is not a
    guardrail, so this is the check: find a claim of the form "<n> independent ideas"
    near a side, in digits or in words, and compare it with what was measured.

    Returns a list of failure strings; empty means nothing to reject.
    """
    if not prose or not idea_counts:
        return []

    text = prose.lower()
    failures: list[str] = []
    # "four independent ideas", "5 independent ideas", "only four independent ideas"
    for m in re.finditer(
        r"(\d+|" + "|".join(_NUMBER_WORDS) + r")\s+(?:\w+\s+){0,3}?independent\s+idea",
        text,
    ):
        token = m.group(1)
        claimed = float(_NUMBER_WORDS.get(token, token)) if not token.isdigit() else float(token)
        # Which side is being talked about? Look back a short way for the word.
        window = text[max(0, m.start() - 120): m.start()]
        side = "short" if "short" in window else "long" if "long" in window else None
        candidates = (
            [idea_counts.get(side, {}).get("count")]
            if side
            else [d.get("count") for d in idea_counts.values() if isinstance(d, dict)]
        )
        actual = [c for c in candidates if isinstance(c, (int, float))]
        if actual and claimed not in actual:
            failures.append(
                f"thesis claims {int(claimed)} independent ideas"
                f"{f' on the {side} side' if side else ''}, "
                f"but the measurement is {', '.join(str(int(a)) for a in actual)}. "
                "Do not restate POOL DEPTH counts — the page states them."
            )
    return failures


_UNAVAILABLE_NEAR_POOL = re.compile(
    r"(?:\b(?:not\s+(?:present|available|included|tradable|in)|absent|unavailable|"
    r"missing|excluded|no\s+longer)\b[^.]{0,100}?"
    r"\b(?:pool|candidate|candidates|universe|screen|shortlist|list)\b)",
    re.IGNORECASE,
)


def check_availability_claims(prose: str, candidates: list[dict]) -> list[str]:
    """Reject a thesis that excuses a decline by saying the name was not available.

    ADR-0056 required the agent to name the independent ideas it declined, and
    [ADR-0058] confirmed the prompt achieves that. The very first book published under
    it named ARKK — and gave this reason:

        "The fifth independent short idea per POOL DEPTH, ARKK, is not present in the
         tradable candidate pool, so this book deploys four short picks rather than
         five."

    **ARKK was in the pool**: `trade_candidates` for that run holds it at
    ``edge_score -0.2658``, the eleventh of twelve short candidates, and POOL DEPTH
    counted it as an independent idea *because* it was there. The sentence is
    contradicted by the data the model was shown.

    That is the limitation ADR-0056 named — *the check proves a declined idea is
    mentioned, not that the reason is sound* — arriving immediately, and it is worse
    than the silence it replaced: naming ARKK set ``satisfied=True``, which flips
    `/book`'s panel from a true warning to crediting the thesis. **A false explanation
    that clears the check is more damaging than no explanation at all.**

    Judging whether a reason is *good* is out of reach. Judging whether it is
    *factually contradicted by our own pool* is not, and this is that check: an
    availability excuse about a name we screened is rejected exactly, with no
    grounding tolerance, for the same reason ADR-0049 rejects a restated count — the
    model is contradicting a fact the system computed and handed it.

    Deliberately narrow. It fires only on the availability CLASS of excuse
    ("not present in the pool", "absent from the candidates", "no longer in the
    universe"). *"ARKK would net against long SVXY"* is a claim about correlation, not
    about membership, and is left to the reader — inventing a verdict on reasoning
    quality is what ADR-0045 refused to do for turnover.

    Returns a list of failure strings; empty means nothing to reject.
    """
    if not prose or not candidates:
        return []

    pool = {c.get("asset") for c in candidates if c.get("asset")}
    failures: list[str] = []
    for ticker in sorted(pool):
        for m in re.finditer(rf"\b{re.escape(ticker)}\b", prose):
            # Look forward from the mention only. A negation BEFORE the ticker
            # usually belongs to the previous clause ("...not in the pool. ARKK is
            # held.") and reading backwards produced false positives on exactly that
            # shape.
            window = prose[m.end(): m.end() + 200]
            window = window.split(".")[0] + "." if "." in window else window
            if _UNAVAILABLE_NEAR_POOL.search(window):
                failures.append(
                    f"thesis says {ticker} was not in the candidate pool, but it is "
                    f"— {ticker} is one of the {len(pool)} screened candidates. "
                    "Give the real reason it was declined, or take the position."
                )
                break
    return failures


def shortfall_accounting(
    picks: list[dict],
    idea_counts: dict,
    prose: str,
    target: int = Q1_TARGET_PER_SIDE,
) -> dict:
    """Did the book fall short of Q1's five with ideas still on the table — and if so,
    did the thesis account for the ones it declined?

    The prompt has told the agent since ADR-0048 that *"returning fewer than five per
    side when five independent ideas exist is a choice, not a constraint"* and that the
    choice *"needs a reason stated in book_view"*. On the live 2026-07-25 run it
    returned four shorts against five independent short ideas and gave no reason: the
    published thesis never mentions ARKK, the one idea it passed over, and says only
    *"Net directional bias is long given 5 long picks vs 4 short picks"* — which
    restates the shortfall rather than explaining it.

    **An instruction with no check is not a guarantee.** That is ADR-0049's lesson
    generalised from a number to a piece of reasoning, and it matters more here because
    Q1 asks for five and five *"and why"*: the shortfall IS the question a reviewer
    asks first.

    It matters doubly because `/book`'s Pool depth panel tells the reader *"the agent's
    reasoning is in the thesis above"*. When the thesis is silent that pointer is false,
    and the one panel built to expose the shortfall sends the reader somewhere that does
    not answer it. This function is what lets the panel stop asserting that.

    A passed-over idea is named by its representative ticker: the strongest member of a
    correlated complex none of whose members are held, or a standalone candidate not
    held. Those are exactly the names the agent was shown in POOL DEPTH, so it is being
    asked about something it saw.

    **How many explanations are owed — corrected by measurement (ADR-0058).** The first
    version required EVERY declined idea to be named. Running the frozen-input harness
    showed why that is incoherent. A sample that held 3 longs against **10** independent
    long ideas was asked to account for **seven** names; the short side, holding 4
    against **5**, was asked for one. Both books were short by a comparable amount, and
    the burden differed sevenfold — because where ideas exceed the five slots, most
    declines are forced by arithmetic and mean nothing.

    The number owed is the number of **empty slots**: ``available - held``. Leave two
    slots unfilled, name at least two of the ideas that could have filled them. On a
    side where ideas exactly fill the book that reduces to the old rule, which is why
    the short side's behaviour is unchanged.

    Returns ``{side: {...}}`` containing only sides that ARE short, each with::

        held         positions taken on that side
        available    min(independent ideas, target) — what was reachable
        empty_slots  available - held — how many explanations are owed
        passed_over  representative ticker per declined idea (informational)
        named        those the thesis mentions
        unexplained  those it does not (informational)
        satisfied    len(named) >= empty_slots — the verdict the page branches on

    A side that met its target is omitted rather than reported as empty: silence means
    there was nothing to explain, which is different from an explanation of nothing.
    Silent too when there is no measurement or no prose — absence of evidence is not a
    finding, and inventing one would be the fabrication GOAL.md warns about.
    """
    if not idea_counts or not picks:
        return {}

    out: dict = {}
    for side in ("long", "short"):
        depth = idea_counts.get(side)
        if not isinstance(depth, dict):
            continue
        count = depth.get("count")
        if not isinstance(count, int) or count <= 0:
            continue

        held_assets = {
            p.get("asset") for p in picks if p.get("direction") == side and p.get("asset")
        }
        available = min(count, target)
        if len(held_assets) >= available:
            continue  # met what was reachable — nothing to account for

        passed_over: list[str] = []
        for cx in depth.get("complexes") or []:
            members = cx.get("members") or []
            # A complex is ONE idea. It is declined only if NOTHING in it is held —
            # holding the second-strongest still expresses the bet, so representing it
            # by `strongest` alone would report a phantom omission.
            if members and not (set(members) & held_assets):
                rep = cx.get("strongest") or members[0]
                passed_over.append(rep)
        for name in depth.get("standalone") or []:
            if name and name not in held_assets:
                passed_over.append(name)

        if not passed_over:
            continue

        text = prose or ""
        named = [t for t in passed_over if re.search(rf"\b{re.escape(t)}\b", text)]
        empty_slots = available - len(held_assets)
        out[side] = {
            "held": len(held_assets),
            "available": available,
            "empty_slots": empty_slots,
            "passed_over": passed_over,
            "named": named,
            "unexplained": [t for t in passed_over if t not in named],
            "satisfied": len(named) >= empty_slots,
        }
    return out


def _with_shortfall(state: dict) -> dict:
    """`independent_ideas` plus a per-side `shortfall` block, for persistence.

    Never lets an explanatory measurement break the book: on any failure the untouched
    pool-depth dict is returned, the same rule the candidate-correlation computation
    follows. A missing panel is a smaller problem than a lost run.
    """
    ideas = state.get("independent_ideas") or {}
    if not ideas:
        return {}
    try:
        gaps = shortfall_accounting(
            state.get("picks") or [], ideas, state.get("book_view") or ""
        )
    except Exception as exc:  # pragma: no cover — defensive
        print(f"[shortfall_accounting] skipped ({exc.__class__.__name__}): {exc}")
        return ideas
    if not gaps:
        return ideas
    merged = {k: (dict(v) if isinstance(v, dict) else v) for k, v in ideas.items()}
    for side, block in gaps.items():
        if isinstance(merged.get(side), dict):
            merged[side]["shortfall"] = block
    return merged


def _citation_claimed_value(cit: dict) -> float | None:
    """
    The number a citation asserts about its source.

    Prefer the explicit ``value`` field (the LLM's structured claim). If absent,
    fall back to the *sole* number in the citation text. Text with zero or
    multiple numbers is ambiguous — we can't reconcile it to a single source
    value, so we return None and let the source-key check stand on its own.
    """
    v = cit.get("value")
    if isinstance(v, (int, float)):
        return float(v)
    import re
    nums = re.findall(r"-?\d+\.?\d*", cit.get("text", "") or "")
    if len(nums) == 1:
        try:
            return float(nums[0])
        except ValueError:
            return None
    return None


def _citation_value_matches(claimed: float, actual) -> bool:
    """True when ``claimed`` is within tolerance of the numeric ``actual``."""
    if actual is None:
        return False
    try:
        actual_f = float(actual)
    except (TypeError, ValueError):
        return False
    tol = max(CITATION_ABS_TOL, CITATION_REL_TOL * abs(actual_f))
    return abs(claimed - actual_f) <= tol


def _collect_known_values(state: Q1State) -> list[float]:
    """Every numeric value the model was shown across the L0–L4 surfaces — the
    universe a cited number must be grounded in. Includes macro, theme scores,
    risk, regime, and the numbers embedded in the computed tables (book metrics,
    scenarios, factor/theme tables) that the prompt renders verbatim."""
    import re
    vals: list[float] = []

    def add(x):
        try:
            vals.append(float(x))
        except (TypeError, ValueError):
            pass

    for meta in (state.get("macro_snapshot") or {}).values():
        add(meta.get("value"))
    for t in (state.get("theme_scores") or []):
        add(t.get("hype_score")); add(t.get("trade_score")); add(t.get("avg_sentiment"))
    risk = state.get("risk_metrics") or {}
    for k in ("var_95", "cvar_95", "sharpe", "beta", "concentration_hhi"):
        add(risk.get(k))
    regime = state.get("regime") or {}
    for k in ("vix_level", "hy_oas", "yield_curve_slope", "real_rate", "spx_breadth", "vix_term_diff"):
        add(regime.get(k))

    # Standard derived macro metrics a PM routinely cites — deterministic
    # functions of grounded inputs, so they ARE grounded even though they aren't
    # raw series (VIX term structure, 2s10s slope in pct & bps, real rate).
    m = state.get("macro_snapshot") or {}

    def mv(k):
        try:
            return float(m[k]["value"])
        except (KeyError, TypeError, ValueError):
            return None

    vix, vix3m = mv("^VIX"), mv("^VIX3M")
    dgs10, dgs2, t10yie = mv("DGS10"), mv("DGS2"), mv("T10YIE")
    if vix is not None and vix3m is not None:
        add(vix - vix3m)
    if dgs10 is not None and dgs2 is not None:
        add(dgs10 - dgs2); add((dgs10 - dgs2) * 100)
    if dgs10 is not None and t10yie is not None:
        add(dgs10 - t10yie)

    blobs = [state.get("book_metrics_summary") or "", state.get("scenario_table") or ""]
    try:
        blobs.append(_make_theme_table(state.get("theme_scores") or []))
        blobs.append(_make_factor_table(state.get("factor_exposures") or {}))
    except Exception:
        pass
    for b in blobs:
        for n in re.findall(r"-?\d+\.?\d*", b):
            add(n)
    return vals


def _value_is_grounded(claimed: float, known: list[float]) -> bool:
    """True when ``claimed`` matches some value the model was shown (tight tol)."""
    for kv in known:
        if abs(claimed - kv) <= max(0.02, 0.01 * abs(kv)):
            return True
    return False


def _citation_numbers(cit: dict) -> list[float]:
    """Every number a citation references — the explicit value field plus every
    number in its text. Lets grounding accept a citation that quotes a derived
    metric (a VIX term structure) *alongside* its grounded components, while a
    citation whose only number is fabricated still has nothing grounded."""
    import re
    nums: list[float] = []
    v = cit.get("value")
    if isinstance(v, (int, float)):
        nums.append(float(v))
    for n in re.findall(r"-?\d+\.?\d*", cit.get("text", "") or ""):
        try:
            nums.append(float(n))
        except ValueError:
            pass
    return nums


def verify_citations(state: Q1State) -> Q1State:
    """
    Guardrail: every cited *number* must be grounded in the frozen L0–L4 inputs.

    A citation passes when either (1) its source key resolves in the snapshot and
    the value matches within tolerance (ADR-0019 exact reconciliation), or (2) its
    value is grounded — it matches some number the model was actually shown across
    macro / regime / theme / risk / book-metrics / scenario surfaces. Grounding
    (ADR-0027) accepts correctly-valued citations that use a human source *label*
    (e.g. "L3 regime classification") instead of the exact key, while still
    rejecting a number that appears nowhere in the inputs (a hallucination).
    Any failure → reject → retry reason_picks (max 2).
    """
    if not state.get("citations"):
        state["verified"] = False
        # Do NOT clobber a more specific upstream cause. reason_picks falls back on
        # a JSON-decode or LLM error, and fallback_picks sets citations=[] — so this
        # branch would overwrite "JSON decode error ..." with the generic
        # "No citations provided" and report a fallback's empty list as though the
        # MODEL had skipped the requirement. That masking sent two iterations
        # chasing citation formatting when the response was never parsing. Keep the
        # real reason and say the citations were empty as a consequence.
        prior = state.get("error")
        if prior and state.get("fallback_used"):
            state["error"] = f"{prior} (citations empty as a result)"
        else:
            state["error"] = "No citations provided — rejecting output"
        return state

    macro = state.get("macro_snapshot") or {}
    theme_scores = state.get("theme_scores") or []
    risk = state.get("risk_metrics") or {}
    regime = state.get("regime") or {}

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
    for k in ("vix_level", "hy_oas", "yield_curve_slope", "real_rate", "spx_breadth", "vix_term_diff"):
        if regime.get(k) is not None:
            source_map[f"regime:{k}"] = regime[k]

    known_values = _collect_known_values(state)

    checked = 0
    failures: list[str] = []
    for cit in state.get("citations", []):
        src = cit.get("source", "")
        text = cit.get("text", "")
        claimed = _citation_claimed_value(cit)
        nums = _citation_numbers(cit)
        if claimed is None and not nums:
            # Qualitative citation — no number to reconcile. Accept, don't count.
            continue

        checked += 1
        # (1) exact source-key value match (ADR-0019)
        if claimed is not None and src in source_map and _citation_value_matches(claimed, source_map[src]):
            continue
        # (2) value-grounding: any number in the citation is a real input value
        if any(_value_is_grounded(n, known_values) for n in nums):
            continue

        if src in source_map:
            failures.append(
                f"Cited value {claimed} does not match source '{src}'="
                f"{source_map[src]} and is not grounded: '{text}'"
            )
        else:
            failures.append(f"Cited value {claimed} (source '{src}') not grounded: '{text}'")

    # Verify when nearly all numeric citations ground. A derived metric the model
    # computed from grounded inputs (a term structure, a spread) is not a
    # hallucination, so a small ungrounded minority is tolerated; a book where a
    # large share of numbers appear nowhere in the inputs is rejected (ADR-0027).
    # A restated POOL DEPTH count is checked EXACTLY, and is NOT subject to the
    # tolerance below. Grounding cannot help here — every integer 0-9 matched
    # something among the 106 live inputs — and the claim lives in prose the
    # citation loop never inspects, so without this a miscount reaches the reader
    # wearing a VERIFIED badge (ADR-0049).
    count_failures = check_idea_count_claims(
        state.get("book_view") or "", state.get("independent_ideas") or {}
    )
    if count_failures:
        state["verified"] = False
        state["error"] = "Pool-depth claim wrong: " + "; ".join(count_failures[:3])
        return state

    # An availability excuse about a name we screened is checked EXACTLY, alongside
    # the count claim and for the same reason: the model is contradicting a fact the
    # system computed and handed it. Blocking is right here where it is not right for
    # a merely-missing explanation (ADR-0056) — an omission leaves the reader to ask,
    # a false reason answers them wrongly and clears the guardrail while doing it.
    availability_failures = check_availability_claims(
        state.get("book_view") or "", state.get("candidates") or []
    )
    if availability_failures:
        state["verified"] = False
        state["error"] = "Availability claim wrong: " + "; ".join(
            availability_failures[:3]
        )
        return state

    grounded_ratio = ((checked - len(failures)) / checked) if checked else 1.0
    if failures and grounded_ratio < 0.8:
        state["verified"] = False
        state["error"] = "Citation verification failed: " + "; ".join(failures[:8])
        return state

    if failures:
        print(f"[verify_citations] tolerated {len(failures)}/{checked} ungrounded "
              f"citations ({grounded_ratio:.0%} grounded, e.g. {failures[0][:100]})")

    # Does the prose describe a book we actually hold? (ADR-0135)
    #
    # Everything above verifies NUMBERS. It has no notion of a POSITION, so a
    # thesis can assert a trade the book does not contain and pass with every
    # figure correct. Live on 2026-07-28: VRT's thesis argued "the long VRT /
    # short MSFT structure below", and MSFT was not in the book — the agent
    # reasoned about a pair and published half of it.
    #
    # This WARNS rather than rejecting, deliberately. A citation failure means a
    # number is wrong and the book is unsafe; this means one sentence over-claims
    # while every figure is sound, and discarding a correct book over a clause
    # would be the disproportionate response. The caveat travels ON the pick, so
    # /book, /ask and MCP all read it from the same payload rather than from a
    # log line nobody sees.
    try:
        # Imported here, not at module scope: this is an advisory check inside a
        # try/except, and the shared import block above is edited concurrently.
        from .book_metrics import ASSETS as _ASSETS
        from .thesis_positions import apply_caveats

        stale_claims = apply_caveats(state.get("picks") or [], set(_ASSETS.keys()))
        if stale_claims:
            print(f"[verify_citations] {len(stale_claims)} thesis position claim(s) "
                  f"name assets not in the book "
                  f"({', '.join(sorted({f['references'] for f in stale_claims}))}); "
                  f"caveated on the pick, book NOT rejected (ADR-0135).")
    except Exception as exc:
        # Never let an advisory check cost a verified book.
        print(f"[verify_citations] thesis position audit skipped "
              f"({exc.__class__.__name__}: {exc}).")

    state["verified"] = True
    state["error"] = None
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 6: size_positions  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

FACTOR_BETA_KEYS = ("beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_umd")


def attach_asset_factor_tilts(
    picks: list[dict],
    factor_exposures: dict[str, dict] | None,
) -> list[dict]:
    """Join each pick's OWN FF5+UMD betas from L2, replacing the model's copy.

    `factor_tilts` is a **per-pick** field rendered per row on `/book`, but the prompt
    told the model *"use the pre-computed book_metrics if available"* — an aggregate. It
    complied exactly: on 2026-07-25 all **ten** positions carried byte-identical tilts,
    `beta_mkt -0.02` for every one of them, which is the candidate pool's equal-weighted
    average and belongs to no position in the book. SHY (1-3yr Treasuries) and ARKK
    (high-beta growth) were printed with the same market beta.

    The measured values were already in the table the prompt prints two sections earlier:
    **ARKK 1.49, BABA 1.25, SHY 0.015.** So this is [ADR-0049]/[ADR-0073] once more — a
    number the system computes is joined, never re-typed by the model — and it is also
    what `GOAL.md` asks of any per-row surface: *every scannable layer must differentiate*.

    `r_squared` rides along because these betas are not equally trustworthy: ARKK's fit is
    0.77, BABA's 0.14. A beta a reader cannot weight is a number with no unit.

    An unmeasured beta is **omitted**, not zeroed — `beta_umd` is null for every asset
    today, and 0.0 would assert no momentum exposure was found when none was measured
    ([ADR-0066]). A pick with no factor row at all gets `{}`.
    """
    exposures = factor_exposures or {}
    for p in picks:
        fe = exposures.get(p.get("asset") or "") or {}
        p["factor_tilts"] = {
            k: float(fe[k]) for k in FACTOR_BETA_KEYS if _is_num(fe.get(k))
        }
        p["factor_r_squared"] = float(fe["r_squared"]) if _is_num(fe.get("r_squared")) else None
    return picks


def _benchmark_series(state: Q1State) -> list[tuple[str, float]] | None:
    """A 252-day reference series for the fixed-weight backtest.

    `benchmark_returns` only covers the BOOK's inception window — three sessions — so it
    cannot answer "how did these weights behave against the market last year". This fetches
    the index over the backtest window instead.

    Deliberately a separate fetch rather than an extra column on the shared returns frame:
    that frame feeds the covariance, the correlation matrix and the Euler decomposition, and
    a benchmark column sitting in it is one careless `returns.columns` away from being
    treated as a position.

    Never raises — the backtest is still worth having without a comparison.
    """
    cached = state.get("benchmark_series")
    if cached is not None:
        return cached or None
    try:
        import yfinance as yf

        data = yf.download("^GSPC", period="2y", progress=False, auto_adjust=True)
        if data is None or data.empty:
            state["benchmark_series"] = []
            return None
        close = data["Close"]
        if hasattr(close, "columns"):
            close = close.iloc[:, 0]
        rets = close.pct_change().dropna()
        series = [
            (d.strftime("%Y-%m-%d"), float(v))
            for d, v in zip(rets.index, rets.values)
            if v == v
        ]
    except Exception as exc:                          # pragma: no cover - network
        print(f"[_benchmark_series] unavailable ({exc.__class__.__name__}): {exc}")
        state["benchmark_series"] = []
        return None
    state["benchmark_series"] = series
    return series or None


def _hoist_returns(state: Q1State, assets: list[str]):
    """Fetch ONE 252-day returns frame per run and cache it on state.

    Four consumers now need the same window — the optimizer's covariance, the Euler
    decomposition, the correlation matrix, and the Monte Carlo / VaR fan. Before the
    optimizer landed, `finalise_book_analytics` already hoisted a single frame for the
    correlation consumers precisely so a scraper hiccup could not cost the book three
    separate times. Adding a second fetch in the sizing node would have reintroduced
    exactly that, and worse: two frames pulled minutes apart can disagree, leaving the
    book sized on one covariance and reported on another.

    So the fetch moves here — the first node that needs it — and `finalise_book_analytics`
    reuses whatever this cached. The union of picks and candidates is fetched, because
    the candidate correlations need the pool and the fallback path may promote a
    candidate into the book.

    Returns None on any miss; every caller degrades rather than failing.
    """
    cached = state.get("shared_returns")
    if cached is not None:
        return cached

    from .book_metrics import fetch_pick_returns

    pool = [c.get("asset") for c in (state.get("candidates") or []) if c.get("asset")]
    wanted = sorted(set(a for a in assets if a) | set(pool))
    if not wanted:
        return None
    try:
        frame = fetch_pick_returns(wanted, lookback_days=252)
    except Exception as exc:                          # pragma: no cover - network
        print(f"[_hoist_returns] returns unavailable ({exc.__class__.__name__}): {exc}")
        return None
    if frame is None or frame.empty:
        return None
    state["shared_returns"] = frame
    return frame


def _complex_map(state: Q1State) -> dict[str, str]:
    """{asset: complex_id} from the clustering `compute_book_metrics_node` already ran.

    A "complex" is a connected component of names correlated at or above 0.70 — one idea
    expressed across several tickers. `independent_ideas` has always COUNTED them; nothing
    ever constrained them, so the single-name cap could be evaded by splitting a bet across
    correlated names, each reporting comfortable headroom.

    Ids are namespaced by side because the clustering is per-side: the same ticker could in
    principle appear in a long complex and a short one, and merging them would cap a bet
    against itself.

    Sparse on purpose. A name correlated with nothing is absent, and is then governed by
    the single-name cap alone.
    """
    ideas = state.get("independent_ideas") or {}
    out: dict[str, str] = {}
    for side in ("long", "short"):
        for index, complex_ in enumerate((ideas.get(side) or {}).get("complexes") or []):
            for asset in complex_.get("members") or []:
                if asset:
                    out[asset] = f"{side}::{index}"
    return out


def size_positions(state: Q1State) -> Q1State:
    """
    HypeScore-weighted allocation of $100M across the 10 picks, WITH the
    single-name / sector / geography caps enforced.

    This delegates to ``trade_ranker.allocate_portfolio`` rather than
    reimplementing the weighting. The previous implementation normalised by
    HypeScore alone and applied no caps at all, despite the module docstring and
    ARCHITECTURE.md both claiming cap enforcement — so a single dominant theme
    could take an unbounded share of the book. It also assigned *positive*
    weights to shorts, which made the resulting book report gross = 100% and
    net = 100%: arithmetically not a long-short book.

    Each pick is enriched with:
      weight         unsigned share of capital (what the caps are applied to)
      signed_weight  negative for shorts — the number book/risk math must use
      notional       weight * total_capital
    """
    picks = state.get("picks", [])
    if not picks:
        state["error"] = "No picks to size — using fallback"
        return fallback_picks(state)

    cfg = state.get("cfg")
    total_capital = cfg.total_capital if cfg else 100_000_000.0

    # allocate_portfolio operates on TradeCandidate; build them from the picks.
    # An unmapped ticker raises KeyError inside classify()/SECTOR_MAP by design
    # (no silent fallback), so drop unmappable picks loudly rather than crash the
    # whole run — the LLM is constrained to the candidate set, but a fallback
    # path or a hand-edited pick could still introduce one.
    # Conviction and vol come from the L1 CANDIDATE, not from the pick.
    #
    # state["picks"] are the model's own dicts — asset, direction, thesis, catalysts —
    # enriched downstream only with theme_id and citations. They have never carried
    # conviction or vol, so reading them off the pick yields None -> 0.0 and
    # allocate_portfolio falls back to HypeScore. That is how the published book came
    # to be hype-sized while every surface said conviction (ADR-0053), and threading
    # the fields into state["candidates"] alone did NOT fix it: the first attempt
    # passed its unit test only because the test hand-supplied conviction on the
    # picks, pinning this function's contract rather than its caller's reality.
    #
    # The candidate is authoritative: L1 computed conviction there from per-asset edge
    # and vol, and the LLM is constrained to that candidate set.
    edge_by_asset: dict[str, dict] = {}
    for c in (state.get("candidates") or []):
        a = c.get("asset")
        if a and a not in edge_by_asset:
            edge_by_asset[a] = c

    sizable: list[TradeCandidate] = []
    kept: list[dict] = []
    dropped: list[str] = []
    non_numeric: list[str] = []
    for p in picks:
        asset = p.get("asset", "")
        if asset not in SECTOR_MAP or asset not in GEO_MAP:
            dropped.append(asset or "<blank>")
            continue
        src = edge_by_asset.get(asset, {})
        # `_num`, not bare `float`. These fields come off the MODEL's pick objects,
        # and `x or 0.0` only guards FALSY values — None, "", 0 — not a non-empty
        # non-numeric string. On 2026-07-27 the model answered the trade_score field
        # with 'N/A - ARKK not mapped to L1 theme set', a truthy string that reached
        # float() and raised ValueError, so a run that had already produced a verified
        # thesis (90% of citations grounded) threw the whole book away at the sizing
        # step. _num's own docstring already says it exists for exactly this; this
        # path simply never used it.
        for field in ("trade_score", "hype_score", "avg_sentiment"):
            raw = p.get(field)
            if raw is not None and raw != "" and _num(raw, _NUM_SENTINEL) == _NUM_SENTINEL:
                non_numeric.append(f"{asset}.{field}={raw!r}")
        sizable.append(TradeCandidate(
            theme_id=p.get("theme_id") or "",
            asset=asset,
            direction=p.get("direction", "long"),
            trade_score=_num(p.get("trade_score")),
            hype_score=_num(p.get("hype_score")),
            avg_sentiment=_num(p.get("avg_sentiment")),
            # Candidate first, pick as a fallback. Without these the dataclass
            # defaults them to 0.0, allocate_portfolio sees no conviction anywhere,
            # and it falls back to HypeScore weighting — which is what the published
            # book was actually sized by. ADR-0053.
            edge_score=_num(src.get("edge_score") or p.get("edge_score")),
            vol=_num(src.get("vol") or p.get("vol")),
            conviction=_num(src.get("conviction") or p.get("conviction")),
        ))
        kept.append(p)

    if dropped:
        print(f"[size_positions] Dropped unmappable tickers (no sector/geo): {dropped}")

    if non_numeric:
        # Reported, not silent. Coercing to 0.0 matches what an ABSENT field already
        # did, and "N/A - not mapped to L1 theme set" is a statement of absence — but
        # the run should say which fields the model answered in prose, because a
        # silently-zeroed score still feeds the sizer.
        print(
            "[size_positions] Non-numeric score field(s) from the model, read as 0.0: "
            + ", ".join(non_numeric)
        )

    if not sizable:
        state["error"] = "No sizable picks after taxonomy check — using fallback"
        return fallback_picks(state)

    # ── Crowding as a per-name limit (ADR-0110) ──────────────────────────────────
    # Bar 1: sizing takes four inputs, not two. This is the third. It tightens the
    # single-name cap on positions sitting with an extreme speculator consensus, and it
    # returns a map containing ONLY those names — so a position COT cannot see keeps the
    # base cap and is sized bit-for-bit as it would have been. That neutrality is the
    # constraint GOAL.md imposes, and `test_crowding_is_neutral_where_unobservable` pins it.
    #
    # Computed ONCE and handed to whichever sizer runs. A crowding input the optimizer
    # respected and the fallback ignored would be ADR-0053 again: two sizing paths, one of
    # them quietly not doing what every surface says it does.
    crowding_caps_map: dict[str, float] = {}
    crowding_provenance: dict | None = None
    try:
        from .positioning_crowding import assess as assess_crowding, crowding_caps
        sized_picks = [
            {"asset": c.asset, "direction": c.direction, "weight": 1.0 / max(len(sizable), 1)}
            for c in sizable
        ]
        # Equal weights here on purpose: the caps must not depend on the sizes they are
        # about to constrain, or the input becomes circular. `crowding_caps` reads only
        # `agrees_with_crowd`, which is weight-independent; the weights exist so the
        # coverage share in the provenance is denominated in something real.
        assessment = assess_crowding(sized_picks, 1.0, state.get("cot_readings"))
        crowding_caps_map, crowding_provenance = crowding_caps(
            assessment, MAX_SINGLE_NAME_WEIGHT
        )
    except Exception as exc:                         # pragma: no cover - defensive
        print(f"[size_positions] crowding caps skipped ({exc.__class__.__name__}): {exc}")

    if crowding_caps_map:
        print(
            f"[size_positions] crowding tightened {len(crowding_caps_map)} cap(s): "
            + ", ".join(f"{a} -> {w:.1%}" for a, w in sorted(crowding_caps_map.items()))
        )

    # One idea may hold at most what one name may — see `_complex_map`.
    complex_map = _complex_map(state)
    if complex_map:
        print(f"[size_positions] {len(set(complex_map.values()))} correlation complex(es) capped")

    # ── The conviction book: always computed, for two reasons ────────────────────
    # It is the FALLBACK when the optimizer cannot run, and it is the BASELINE the
    # optimizer is measured against. size_by="conviction" is the documented Stage-4
    # model (ADR-0032); allocate_portfolio degrades to HypeScore on its own when no
    # candidate carries conviction, so a run with no edge data still sizes.
    positioned = allocate_portfolio(
        sizable,
        total_capital,
        sector_map=SECTOR_MAP,
        geo_map=GEO_MAP,
        size_by="conviction",
        max_single=crowding_caps_map or MAX_SINGLE_NAME_WEIGHT,
        default_single=MAX_SINGLE_NAME_WEIGHT,
        complex_map=complex_map,
    )
    heuristic: dict[str, float] = {}
    for pick, (_cand, _notional, weight) in zip(kept, positioned):
        sign = -1.0 if pick.get("direction") == "short" else 1.0
        heuristic[pick["asset"]] = sign * weight
    state["heuristic_weights"] = dict(heuristic)

    # ── The optimizer ────────────────────────────────────────────────────────────
    # Everything below can fail, and every failure lands on the conviction book with
    # a stated reason. The book is never left unsized: same contract as the L5 citation
    # fallback (ADR-0013 constraint 4).
    chosen: dict[str, float] | None = None
    method = "conviction"
    reason: str | None = None
    state["optimizer_result"] = None
    state["efficient_frontier"] = None
    state["rebalance_cost"] = None

    ic: IcReading | None = state.get("edge_ic")
    if ic is None:
        reason = state.get("edge_ic_reason") or "no measured EdgeScore IC"
    else:
        try:
            assets = [p["asset"] for p in kept]
            returns = _hoist_returns(state, assets)
            cov, priced, unpriced = covariance_from_returns(returns, assets)
            if cov is None:
                reason = (
                    "no covariance: fewer than two priced names or under 60 "
                    "overlapping sessions"
                )
            else:
                # mu is built over the PRICED names only — the same set the covariance
                # spans — so the optimizer never sees a name it has a return for but no
                # risk for, or vice versa.
                #
                # The edge comes from the CANDIDATE, never from the pick. `state["picks"]`
                # are the model's own dicts — asset, direction, thesis — and have never
                # carried `edge_score`. Reading it off them yields None -> 0.0 for every
                # name, which makes every expected return zero, which makes the optimal
                # book the EMPTY one: the optimizer correctly declines to deploy capital
                # for no expected return, and the book silently comes back at 0% gross.
                # This is ADR-0053's trap exactly — the same seam, one layer along — and
                # `sizable` already holds the candidate-first resolution, so use it.
                edge_by_sizable = {c.asset: c for c in sizable}
                priced_picks = [
                    {
                        "asset": p["asset"],
                        "direction": p.get("direction", "long"),
                        "edge_score": getattr(
                            edge_by_sizable.get(p["asset"]), "edge_score", 0.0
                        ),
                    }
                    for p in kept if p["asset"] in priced
                ]
                mu, mu_dropped = build_mu(priced_picks, returns, ic)
                # One idea, one signal. Without it the optimizer ranks members
                # of a complex on EdgeScore, which at rho 0.99 is noise; with it
                # every member sits on an identical Sharpe and the RISK cap in
                # the optimizer makes the choice between them genuinely neutral
                # (ADR-0118). Neither half works alone.
                mu, mu_complex_provenance = equalise_signal_within_complexes(
                    mu, complex_map, annualised_vol(returns)
                )
                if not mu:
                    reason = "expected returns could not be built for any held name"
                else:
                    inputs = OptimizerInputs(
                        assets=priced,
                        directions={p["asset"]: p.get("direction", "long")
                                    for p in priced_picks},
                        mu=mu,
                        cov=cov,
                        # The conviction book is the baseline, so `weight_delta` and the
                        # frontier's "you are here" both answer the question a reader
                        # actually has: what did the optimizer change, and what did it buy?
                        weights0={a: heuristic.get(a, 0.0) for a in priced},
                        complex_map=complex_map,
                    )
                    result = optimize(
                        inputs, "mean_variance",
                        OptimizerConstraints(
                            max_single=crowding_caps_map or MAX_SINGLE_NAME_WEIGHT,
                            default_single=MAX_SINGLE_NAME_WEIGHT,
                        ),
                    )
                    if not result.feasible:
                        reason = result.reason or f"optimizer returned {result.status}"
                    elif not any(result.signed_weights.values()):
                        # A solve that funds nothing is arithmetically valid and
                        # editorially useless: it publishes a $100M mandate holding
                        # cash. It also has one overwhelmingly likely cause — every
                        # expected return came back zero — so treat it as a failure of
                        # the inputs and say so, rather than publishing the empty book.
                        reason = (
                            "the optimal book funded no position, which means the "
                            "expected returns were all zero"
                        )
                    else:
                        chosen = dict(result.signed_weights)
                        method = "optimizer"
                        payload = result.to_dict()
                        payload["ic"] = ic.to_dict()
                        payload["unpriced_assets"] = sorted(set(unpriced) | set(mu_dropped))
                        payload["mu"] = mu
                        payload["baseline"] = "conviction (ADR-0032)"
                        # Coverage at the point of use. A reader must never see a position
                        # sized smaller without also seeing what fraction of the book the
                        # crowding check could reach — GOAL.md's constraint, and the reason
                        # this block leads with `coverage_share` rather than the verdict.
                        payload["crowding"] = crowding_provenance
                        # What the complex machinery did, both halves. The risk
                        # budget binds while the CAPITAL cap still shows headroom,
                        # so a reader seeing only the weight cap would read slack
                        # that is not there (ADR-0118).
                        payload["complex_sizing"] = {
                            "mu_signal_equalised": mu_complex_provenance,
                            "risk_cap_multiple_of_single_name": 1.0,
                        }
                        state["optimizer_result"] = payload
                        state["efficient_frontier"] = efficient_frontier(
                            # The SAME constraints the book was solved under, crowding caps
                            # included — a frontier drawn under looser limits would put the
                            # published book below a curve it was never allowed to reach.
                            inputs,
                            OptimizerConstraints(
                                max_single=crowding_caps_map or MAX_SINGLE_NAME_WEIGHT,
                                default_single=MAX_SINGLE_NAME_WEIGHT,
                            ),
                        ).to_dict()
                        # What the move from the conviction book to this one costs.
                        state["rebalance_cost"] = estimate_portfolio_costs(
                            result.weight_delta, total_capital
                        ).to_dict()
        except Exception as exc:                     # pragma: no cover - defensive
            reason = f"optimizer skipped ({exc.__class__.__name__}): {exc}"
            print(f"[size_positions] {reason}")

    if chosen is None:
        chosen = heuristic
        state["optimizer_result"] = {
            "feasible": False,
            "objective": "mean_variance",
            "status": "not_run",
            "reason": reason,
            # The fallback applies the same crowding caps, so the provenance travels on the
            # fallback path too. Omitting it here would make the sizing input look like an
            # optimizer-only feature when both paths honour it.
            "crowding": crowding_provenance,
        }

    state["sizing_method"] = method
    state["sizing_reason"] = reason
    print(
        f"[size_positions] sized by {method}"
        + (f" — {reason}" if reason else "")
        + f" | gross {sum(abs(v) for v in chosen.values()):.1%}"
    )

    # A pick the optimizer priced out is dropped from the book, not carried at zero.
    # A $0 position is not a position, and leaving it in would let it consume one of
    # Q1's five-a-side slots while holding nothing (ADR-0058 owes the reason, which
    # `optimizer_result.zeroed` carries).
    final: list[dict] = []
    for pick in kept:
        weight = chosen.get(pick["asset"], 0.0)
        if weight == 0.0:
            continue
        pick["weight"] = abs(weight)
        pick["signed_weight"] = weight
        pick["notional"] = abs(weight) * total_capital
        final.append(pick)

    if not final:
        state["error"] = "Sizing produced no funded positions — using fallback"
        return fallback_picks(state)

    # Overwrite whatever the model put in factor_tilts with the asset's measured betas.
    attach_asset_factor_tilts(final, state.get("factor_exposures"))

    state["picks"] = final
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Node 9: finalise_book_analytics  (pure fn)
# ─────────────────────────────────────────────────────────────────────────────

def finalise_book_analytics(state: Q1State) -> Q1State:
    """
    Recompute book metrics, correlations and stress scenarios against the FINAL
    SIZED book, and emit them as structured records for persistence.

    ``compute_book_metrics_node`` and ``run_scenario_analysis_node`` run *before*
    reason_picks, over the equal-weighted candidate pool, because the LLM needs
    them as prompt context. That makes them a description of a portfolio nobody
    holds: 30 candidates at 3.3% each, rather than 10 positions at their actual
    cap-enforced weights. Both were also discarded after prompt construction.

    This node closes both gaps. It runs last, on the real book, and writes
    machine-readable dicts that `_persist_to_supabase` stores and the /risk page
    renders.
    """
    picks = state.get("picks") or []
    cfg = state.get("cfg")
    total_capital = cfg.total_capital if cfg else 100_000_000.0

    if not picks:
        state["book_metrics_final"] = None
        state["scenario_results_final"] = []
        state["correlation_pairs_final"] = []
        state["candidate_correlations_final"] = {}
        state["cap_utilisation_final"] = None
        return state

    factor_exp = state.get("factor_exposures") or {}

    bm = compute_book_metrics(
        picks=picks,
        factor_exposures=factor_exp,
        total_capital=total_capital,
    )

    # Where each name sits against its 200-day MA. Six of ten counter-theses on the
    # 2026-07-25 book read "wrong if X breaks its 200-day MA" with no number attached, so
    # the reader could not tell how close the trade was to being disqualified. Wrapped:
    # explanatory context, so a failed fetch costs a panel rather than the run.
    try:
        ma_ctx = moving_average_context([p["asset"] for p in picks if p.get("asset")])
    except Exception as exc:            # pragma: no cover — defensive
        print(f"[finalise_book_analytics] MA context unavailable: {exc}")
        ma_ctx = {}
    for p in picks:
        ctx = ma_ctx.get(p.get("asset") or "")
        if ctx:
            p["ma_context"] = ctx

    # Hoist ONE 252-day returns frame for every correlation consumer below. This function
    # reached yfinance three separate times for the same window — the 0.70-threshold book
    # correlation, the 0.0-threshold summary, and the candidate correlation — three
    # independent chances to lose a book to a scraper hiccup. Pairwise .corr() is unaffected
    # by extra columns, so one shared frame gives identical correlations; it is also the
    # single frame the Euler risk decomposition reuses next
    # (docs/handoff-euler-risk-decomposition.md, step 1). MA context stays its own fetch — it
    # needs prices, not returns. fetch_pick_returns swallows its own errors to an empty frame,
    # so on any miss shared_returns is None and each consumer falls back to fetching its own.
    # `_hoist_returns` caches on state, so when `size_positions` already fetched this
    # window for the optimizer's covariance this is free — and, more importantly, it is
    # the SAME frame. The book must not be sized on one covariance and reported on
    # another pulled minutes later.
    shared_returns = _hoist_returns(state, [p["asset"] for p in picks if p.get("asset")])

    corr_pairs = compute_correlation_matrix(picks, lookback_days=252, returns=shared_returns)
    # `_with_scenarios` so the SAME objects that produced the P&L also supply the persisted
    # description. Resolving descriptions against the module constant instead would persist a
    # scaled figure beside the unscaled story — the number and its stated cause disagreeing on
    # the row /risk renders verbatim (ADR-0095).
    #
    # Reuses node 5's reading rather than fetching again: two calls in one run could return
    # two different disruption levels, and the book would be stressed by one while the page
    # explained the other.
    scenario_signal = state.get("chokepoint_signal") or _chokepoint_signal()
    scenarios, scenario_defs = run_scenario_analysis_with_scenarios(
        picks=picks,
        book_metrics=bm,
        total_capital=total_capital,
        factor_exposures=factor_exp,
        chokepoint_signal=scenario_signal,
    )

    state["book_metrics_final"] = book_metrics_to_dict(bm)
    state["scenario_results_final"] = scenario_results_to_dict(scenarios, scenario_defs)
    state["correlation_pairs_final"] = correlation_pairs_to_dict(corr_pairs)

    # The book's correlation STRUCTURE, not just its flagged tail (ADR-0072).
    #
    # `correlation_pairs` holds only pairs at or above rho 0.70, so on a well-diversified
    # book it is empty and every surface can say only "nothing crossed the flag" — an
    # absence indistinguishable from missing data (ADR-0067). It also left the agent with
    # no figure for a held pair below the flag: asked to justify BABA/PDD co-movement on
    # 2026-07-25 the thesis cited MCHI/KWEB at +0.92, two names it does not hold, when the
    # pair it was discussing is +0.4753.
    #
    # The data costs nothing — a 9-name book is 36 pairs and threshold=0.0 already
    # returns them; only the filter threw them away. Summarised into the book_metrics
    # dict rather than a new column, because they ARE book metrics and this needs no
    # migration. `correlation_pairs` is untouched, so every existing consumer keeps its
    # meaning.
    try:
        all_pairs = compute_correlation_matrix(
            picks, lookback_days=252, threshold=0.0, returns=shared_returns
        )
        state["book_metrics_final"]["correlation_summary"] = correlation_summary(all_pairs)
        state["book_metrics_final"]["correlation_matrix"] = correlation_pairs_to_dict(
            all_pairs, threshold=0.0
        )
    except Exception as exc:   # pragma: no cover - network/data
        # An explanatory measurement must never break the book — the rule
        # candidate_correlations already follows.
        print(f"[finalise_book_analytics] correlation summary skipped "
              f"({exc.__class__.__name__}): {exc}")

    # How correlated is each candidate we did NOT take with the closest thing we did?
    # /book answers "why isn't X in the book?" and had only theme overlap to answer
    # with — nearly worthless, since one theme routinely holds four positions across
    # four sectors and both directions. Correlation answers it directly.
    try:
        from .book_metrics import candidate_book_correlation
        held_assets = [p.get("asset") for p in picks if p.get("asset")]
        pool = state.get("candidates") or []
        cand_assets = [
            c.get("asset") for c in pool
            if c.get("asset") and c.get("asset") not in set(held_assets)
        ]
        state["candidate_correlations_final"] = candidate_book_correlation(
            cand_assets, held_assets, lookback_days=252, returns=shared_returns
        )
    except Exception as exc:
        # Never fail the book over an explanatory panel.
        print(f"[finalise] candidate correlation skipped "
              f"({exc.__class__.__name__}): {exc}")
        state["candidate_correlations_final"] = {}

    # Euler risk decomposition on the FINAL sized book (step 2 of the handoff): ex-ante
    # covariance volatility that decomposes by name, with Σ contribution_to_vol = portfolio_vol
    # exactly. Reuses the frame hoisted above — no new fetch (acceptance criterion #4). A
    # position that hedges the book shows a NEGATIVE contribution, which is the point; it must
    # never be rendered as a share-of-whole. This is ex-ante and NOT the realised
    # portfolio_risk.var_95 — separate column, separate label at render. A failed decomposition
    # costs a panel, not the run.
    try:
        from .risk_decomposition import decompose_risk
        signed_weights = {
            p["asset"]: (
                -abs(p.get("weight", 0.0)) if p.get("direction") == "short"
                else abs(p.get("weight", 0.0))
            )
            for p in picks if p.get("asset")
        }
        state["risk_decomposition_final"] = decompose_risk(
            signed_weights, shared_returns, confidence=0.95
        )
    except Exception as exc:
        print(f"[finalise_book_analytics] risk decomposition skipped "
              f"({exc.__class__.__name__}): {exc}")
        state["risk_decomposition_final"] = None

    # Two more ex-ante risk reads off the SAME covariance, so all three reconcile by
    # construction at t=1 rather than by coincidence:
    #   - the Monte Carlo, which is the only one with a fat tail, and
    #   - the VaR fan, whose 21-day point is the horizon a published pick is actually
    #     scored over (ADR-0090) and which nothing has carried until now.
    # Each is labelled with its own method at render. Three unlabelled VaRs on one page
    # is the regression PROGRESS records twice (ADR-0082).
    state["monte_carlo_var_final"] = None
    state["var_forecast_final"] = None
    try:
        signed = {
            p["asset"]: (
                -abs(p.get("weight", 0.0)) if p.get("direction") == "short"
                else abs(p.get("weight", 0.0))
            )
            for p in picks if p.get("asset")
        }
        cov, priced, _unpriced = covariance_from_returns(
            shared_returns, sorted(signed.keys())
        )
        if cov is not None:
            mc = monte_carlo_var(priced, signed, cov, horizon_days=21)
            state["monte_carlo_var_final"] = mc.to_dict() if mc else None
            fan = compute_var_forecast(priced, signed, cov)
            state["var_forecast_final"] = fan.to_dict() if fan else None
    except Exception as exc:
        print(f"[finalise_book_analytics] MC/VaR-fan skipped "
              f"({exc.__class__.__name__}): {exc}")

    # What these weights WOULD have done over the constituents' own year — the path
    # statistics (drawdown, downside asymmetry, capture) that ex-ante risk structurally
    # cannot produce and that a three-session book cannot either.
    #
    # Explicitly NOT a track record, and never written to `portfolio_returns`. See
    # ADR-0112; the caveats travel inside the payload rather than living on the page, so a
    # consumer reading the column through MCP gets them too.
    state["weights_backtest_final"] = None
    try:
        from .weights_backtest import backtest_weights
        signed = {
            p["asset"]: (
                -abs(p.get("weight", 0.0)) if p.get("direction") == "short"
                else abs(p.get("weight", 0.0))
            )
            for p in picks if p.get("asset")
        }
        # A DEDICATED, WIDER frame — not `shared_returns`.
        #
        # `fetch_pick_returns(lookback_days=252)` spans 252 + 30 CALENDAR days, which is
        # about 195 TRADING sessions. A 252-trading-day floor is therefore unreachable
        # from that frame, and the first live run duly returned "190 sessions against the
        # 252 a path statistic needs" — a capability that could never fire, which is the
        # failure ADR-0099 names.
        #
        # The covariance does not care (it needs 60), so widening the shared frame would
        # cost every other consumer a longer fetch for no benefit. This asks for ~500
        # calendar days, comfortably over a trading year, and falls back to the shared
        # frame so a failed fetch costs the backtest rather than the book.
        from .book_metrics import fetch_pick_returns
        try:
            wide = fetch_pick_returns(sorted(signed.keys()), lookback_days=470)
        except Exception:                            # pragma: no cover - network
            wide = None
        # Say which frame was used. Without this the payload reports "190 sessions"
        # identically whether the wide fetch was never attempted or attempted and
        # failed — and those need different fixes. Diagnosing the 2026-07-27 book
        # took a manual probe to tell them apart.
        wide_ok = wide is not None and not wide.empty
        frame = wide if wide_ok else shared_returns
        if not wide_ok:
            print("[finalise_book_analytics] weights backtest fell back to the shared "
                  "252-calendar-day frame; the wide fetch returned nothing, so the "
                  "252-session floor is unreachable this run.")
        state["weights_backtest_final"] = backtest_weights(
            signed, frame, benchmark=_benchmark_series(state),
        )
    except Exception as exc:
        print(f"[finalise_book_analytics] weights backtest skipped "
              f"({exc.__class__.__name__}): {exc}")

    state["cap_utilisation_final"] = cap_utilisation(bm, picks)

    # Guard against a None scenario return (a pick with no factor beta AND no
    # direct shock yields an unestimable scenario) — min() would otherwise return
    # None and the f"{worst:+.2%}" below crashes the whole L5 stage.
    worst = min(
        (s["estimated_book_return"] for s in state["scenario_results_final"]
         if s.get("estimated_book_return") is not None),
        default=0.0,
    )
    print(
        f"[finalise_book_analytics] {len(picks)} positions | "
        f"gross {bm.gross_exposure:.1%} net {bm.net_exposure:+.1%} | "
        f"worst scenario {worst:+.2%} | "
        f"{len(corr_pairs)} high-corr pairs | "
        f"{len(state['cap_utilisation_final']['violations'])} cap violations"
    )
    return state


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic fallback  (triggered after 2 LLM retries)
# ─────────────────────────────────────────────────────────────────────────────

def fallback_picks(state: Q1State) -> Q1State:
    """
    When LLM fails or citations don't verify after 2 retries, fall back to
    a deterministic ranking: top 5 longs + top 5 shorts by HypeScore.
    Thesis is templated. This never produces a blank output.

    Ranks the SAME screened L1 pool (state["candidates"]) the LLM would have
    seen — it does NOT rebuild a divergent universe from theme_scores (ADR-0030).
    An empty pool yields an empty book, not a fabricated one.
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

    if not candidates:
        # ADR-0030: the LLM-free fallback ranks the SAME screened L1 pool the LLM
        # would have seen. It does NOT rebuild a divergent universe from
        # theme_scores via the old hardcoded _theme_default_assets map — that path
        # had no ADR-0029 backfill and could fabricate a one-sided book, defeating
        # the whole point of unifying on the L1 pool. An empty pool means L1
        # produced no candidates this run, so we honestly emit no picks.
        print("[fallback_picks] No screened candidates — emitting an empty book "
              "(L1 produced no candidates this run).")

    longs = [c for c in candidates if c["direction"] == "long"]
    shorts = [c for c in candidates if c["direction"] == "short"]
    longs.sort(key=lambda x: x["hype_score"], reverse=True)
    shorts.sort(key=lambda x: x["hype_score"])

    # Diversify before taking the top 5: keep at most ONE name from each correlated complex.
    # On a day the LLM is down, raw `hype_score[:5]` took FIVE China shorts (BABA/KWEB/PDD/MCHI/
    # FXI — one complex, 6 high-corr pairs), the compounded correlation the LLM's one-per-complex
    # judgement exists to prevent (2026-07-25). `compute_book_metrics_node` already clustered the
    # candidates into `independent_ideas` using the SAME 0.70-threshold correlation /risk and the
    # LLM use, so the fallback reuses it — no extra fetch — and it catches a complex spread across
    # themes (the gold names sit in three sectors and two themes) that a per-theme cap cannot.
    # From each complex keep the best-ranked member (first in the fallback's own sort order); keep
    # every standalone name. Falls back to a per-theme cap of 2 only when the clustering is
    # unavailable. Diversity is a PREFERENCE — if it cannot reach five we fill by HypeScore rather
    # than drop below Q1's five a side (the pass reorders, it never shrinks the book).
    ideas = state.get("independent_ideas") or {}

    def _diversify(cands: list[dict], side: str, n: int = 5) -> list[dict]:
        complexes = (ideas.get(side) or {}).get("complexes") or []
        if complexes:
            drop: set = set()
            for cx in complexes:
                members = set(cx.get("members") or [])
                in_complex = [c for c in cands if c["asset"] in members]  # sort order preserved
                for c in in_complex[1:]:          # keep the best-ranked one, drop the rest
                    drop.add(c["asset"])
            out = [c for c in cands if c["asset"] not in drop]
        else:                                     # no clustering available — per-theme proxy
            out, seen = [], {}
            for c in cands:
                t = c.get("theme_id")
                if seen.get(t, 0) >= 2:
                    continue
                out.append(c)
                seen[t] = seen.get(t, 0) + 1
        out = out[:n]
        if len(out) < n:                          # fill to five by HypeScore
            taken = {c["asset"] for c in out}
            for c in cands:
                if c["asset"] not in taken:
                    out.append(c)
                    taken.add(c["asset"])
                    if len(out) >= n:
                        break
        return out

    picks = []
    for c in _diversify(longs, "long") + _diversify(shorts, "short"):
        theme_name = themes.get(c["theme_id"], c.get("theme_name", "Unknown"))
        picks.append({
            "rank": len(picks) + 1,
            "direction": c["direction"],
            "asset": c["asset"],
            "theme": theme_name,
            "theme_id": c.get("theme_id"),
            "theme_name": theme_name,
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

    # An empty citations array is itself a failure — silence is not compliance.
    # /method publishes exactly that contract, but nothing enforced it here: any
    # path that set state["verified"]=True produced citation_status="all_verified"
    # -> display_status="verified" -> a green VERIFIED chip on /book, even with
    # zero citations. research_agent_runs holds a live 2026-07-24 row with
    # verified=True and citations=[], i.e. a rule-built book presenting as
    # model-verified. Verification now requires evidence to exist.
    _citations = state.get("citations") or []
    has_citations = isinstance(_citations, list) and len(_citations) > 0

    if fallback_used:
        # Heuristic fallback path — citations were never attempted by an LLM
        citation_status = "not_attempted"
    elif state.get("verified") and has_citations:
        citation_status = "all_verified"
    elif state.get("verified") and not has_citations:
        # Claimed verified with nothing to verify against — treat as un-attempted
        # so display_status cannot reach "verified".
        citation_status = "not_attempted"
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

def _chokepoint_signal():
    """The run's maritime-disruption reading, or a neutral one carrying the reason why not.

    NEVER returns None and never raises. `scenarios_for_run(None)` means "do not scale and say
    nothing", which is the state that left S6's calibration silently unexplained on /risk for
    every run before this was wired. A neutral signal WITH a reason is a different thing: it
    tells a reader the battery ran on its documented calibration and why (ADR-0095).

    With no credential `fetch_signal` makes no network call at all, so the common path costs
    nothing.
    """
    from .chokepoint_signal import fetch_signal, neutral

    try:
        return fetch_signal()
    except Exception as exc:  # noqa: BLE001 — an overlay must never cost the run
        print(f"[q1_agent] chokepoint signal unavailable ({exc.__class__.__name__}): {exc}")
        return neutral(
            f"the disruption reading could not be retrieved ({exc.__class__.__name__}), "
            f"so S6 ran on its documented calibration"
        )


def _picks_and_gross(state: Q1State) -> tuple[list, float] | None:
    """The sized book and the gross both overlay analytics denominate against.

    Shared so the sanctions and positioning panels cannot disagree about what "the book" is
    or what its gross was — two readers of the same state that drift apart would put two
    different denominators on the same page.
    """
    picks = state.get("sized_picks") or state.get("picks") or []
    bm = state.get("book_metrics_final") or state.get("book_metrics")
    gross = getattr(bm, "gross_exposure", None)
    if gross is None and isinstance(bm, dict):
        gross = bm.get("gross_exposure")
    if not picks or not isinstance(gross, (int, float)) or isinstance(gross, bool):
        return None
    return list(picks), float(gross)


def _sanctions_row(state: Q1State) -> dict | None:
    """The book's sanctions exposure, or None when it cannot be assessed.

    None rather than an empty assessment: a run that could not classify must render
    "unavailable", not a shape the UI reads as "no exposure" (ADR-0066).
    """
    try:
        from .sanctions_exposure import assess, to_row
    except Exception:  # noqa: BLE001
        return None
    book = _picks_and_gross(state)
    if book is None:
        return None
    picks, gross = book
    try:
        return to_row(assess(picks, gross))
    except Exception as exc:  # noqa: BLE001 — an analytic must never cost the run
        print(f"[_persist_to_supabase] sanctions exposure skipped ({exc.__class__.__name__}): {exc}")
        return None


def _positioning_row(state: Q1State) -> dict | None:
    """External (CFTC) speculator positioning against the book, or None if unassessable.

    The only overlay here that touches the network. `fetch_readings` degrades per contract —
    a portal that does not answer yields a position marked UNOBSERVABLE with a reason, never
    one silently counted as uncrowded. If the fetch fails wholesale we still persist the
    assessment with `fetched=False`, because "we did not look" is a fact worth recording and
    is not the same claim as "nothing is crowded" (ADR-0097).
    """
    try:
        from ..data.cot_fetcher import fetch_readings
        from .positioning_crowding import assess, to_row
    except Exception:  # noqa: BLE001
        return None
    book = _picks_and_gross(state)
    if book is None:
        return None
    picks, gross = book
    # Reuse the reading `size_positions` sized on, never fetch a second one. Two fetches in
    # one run can return two different readings, and the book would then be SIZED by one and
    # EXPLAINED by the other — the exact defect the chokepoint signal had to be restructured
    # to avoid (ADR-0099). `state["cot_readings"]` is set once, before sizing.
    #
    # `_COT_NOT_FETCHED` distinguishes "we fetched and got nothing usable" (an empty dict,
    # which is a real finding) from "the key is not on state at all" — only the latter falls
    # through to a fetch here, and that path exists solely for callers that drive this node
    # directly, such as a backfill.
    readings = state.get("cot_readings", _COT_NOT_FETCHED)
    if readings is _COT_NOT_FETCHED:
        try:
            readings = fetch_readings(p.get("asset") for p in picks if p.get("asset"))
        except Exception as exc:  # noqa: BLE001
            print(f"[_persist_to_supabase] COT fetch failed ({exc.__class__.__name__}): {exc}")
            readings = None
    try:
        return to_row(assess(picks, gross, readings))
    except Exception as exc:  # noqa: BLE001 — an analytic must never cost the run
        print(f"[_persist_to_supabase] positioning crowding skipped ({exc.__class__.__name__}): {exc}")
        return None


def _record_book_revisions(sb, run_date: str, new_row: dict) -> None:
    """Log what an upsert is about to replace, per field.

    Reads the currently-published row for this run_date and diffs it against the row about
    to be written. A first publication produces nothing — a baseline is not a change, and
    logging it would put a row on every book ever published and bury the real ones.

    Imported lazily so the guard stays importable without this module's dependencies, the
    same convention `check_data_integrity` uses for its q1_agent import.
    """
    from .book_revisions import PIPELINE_RERUN, diff_books, summarise

    existing = (
        sb.table("research_recommendations")
        .select("picks, book_metrics, book_view, scenario_results")
        .eq("run_date", run_date)
        .limit(1)
        .execute()
        .data
    ) or []
    if not existing:
        return

    revisions = diff_books(run_date, existing[0], new_row, trigger_type=PIPELINE_RERUN,
                           actor="scripts/daily_refresh.py")
    print(f"[_persist_to_supabase] {summarise(revisions)}")
    if revisions:
        sb.table("book_revisions").insert([r.to_row() for r in revisions]).execute()


def _persist_to_supabase(state: Q1State) -> bool:
    """Write agent run + recommendations to Supabase. Returns True on success."""
    sb: Client = create_client(state["supabase_url"], state["supabase_key"])
    run_date = state["run_date"]
    agent_run_id = str(uuid.uuid4())

    # Build the AdvisoryDerivation bundle (T18) and stash in state for callers.
    try:
        advisory = _build_advisory_derivation(state)
        # Frozen dataclass → dict via asdict for JSONB persistence. asdict leaves
        # computed_at / as_of as datetime objects, which the PostgREST JSONB
        # encoder rejects (TypeError) — the whole persist then failed and
        # run_q1_agent returned None ("agent declined to produce output"). Round-
        # trip through json (default=str) so datetimes coerce to strings.
        state["advisory_derivation"] = json.loads(json.dumps(asdict(advisory), default=str))
    except ValueError as exc:
        # Validator rejected — refuse to persist an unverified row claiming verified.
        print(f"[_persist_to_supabase] AdvisoryDerivation validation failed: {exc}")
        return False

    try:
        sb.table("research_agent_runs").insert({
            "id": agent_run_id,
            "run_date": run_date,
            "prompt_version": PROMPT_VERSION,
            "model_id": _active_model_id(),
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

        base_row = {
            "run_date": run_date,
            "picks": state.get("picks", []),
            "book_view": state.get("book_view", "") if state["advisory_derivation"].get("body") is not None else "",
            "book_risks": state.get("book_risks", []),
            "agent_run_id": agent_run_id,
            "advisory_derivation": state["advisory_derivation"],
        }

        # Structured book analytics (migration 022). These are the artefacts the
        # agent has always computed and always thrown away: stress scenarios,
        # book factor tilts, the correlation matrix and cap headroom. They are
        # what /risk renders. Persist them alongside the picks so the numbers a
        # PM sees are the ones the agent actually reasoned over.
        analytics_row = {
            **base_row,
            "book_metrics": state.get("book_metrics_final"),
            "scenario_results": state.get("scenario_results_final") or [],
            "correlation_pairs": state.get("correlation_pairs_final") or [],
            "candidate_correlations": state.get("candidate_correlations_final") or {},
            "cap_utilisation": state.get("cap_utilisation_final"),
            # Euler ex-ante risk decomposition (migration 038). None when <60 overlapping
            # sessions or <2 priced names — the render says "unavailable", never zeros.
            "risk_decomposition": state.get("risk_decomposition_final"),
            "screening_funnel": state.get("screening_funnel") or [],
            # ADR-0048: the same pool-depth measurement the agent reasoned over, so
            # /book answers "why not five and five?" with that number rather than
            # re-deriving it and risking a different answer on the same day.
            #
            # Carries a `shortfall` key when a side came back under Q1's five with
            # ideas still available, recording which ones were declined and whether
            # the thesis names them. Computed HERE rather than in verify_citations
            # because that node returns early on failure, and a book that failed
            # verification is exactly the one whose reasoning gap matters most.
            "independent_ideas": _with_shortfall(state),
            "lens": state.get("lens", "multi_asset"),
            # Which held names sit in a sanctions-sensitive jurisdiction AND ON WHICH SIDE
            # (ADR-0096). Computed here rather than in the UI because the jurisdiction map is
            # a documented judgement, and two copies of a judgement drift into a confidently
            # wrong classification with no visible symptom.
            "sanctions_exposure": _sanctions_row(state),
            # Whether the book leans the way speculators already do, for the slice of it that
            # trades against a futures contract (ADR-0097). Stores COVERAGE first: only 2 of
            # 10 positions in the live book map at all, and a crowding verdict without that
            # denominator reads as though the whole book had been checked.
            "positioning_crowding": _positioning_row(state),
            # ── Sizing provenance (migration 047) ───────────────────────────────
            # WHICH sizing produced this book, and what the other one would have done.
            # `sizing_method` is the load-bearing field: ADR-0053 records a book that
            # every surface described as conviction-sized while it was in fact
            # hype-sized, because nothing persisted which path ran. Persisting the
            # method beside the weights makes that class of drift visible in the data
            # rather than only in a code review.
            "sizing_method": state.get("sizing_method") or "conviction",
            "sizing_reason": state.get("sizing_reason"),
            "optimizer_result": state.get("optimizer_result"),
            "efficient_frontier": state.get("efficient_frontier"),
            # The conviction book, kept whether or not it was the one published, so a
            # reader can see what the optimizer changed rather than being told.
            "heuristic_weights": state.get("heuristic_weights") or {},
            "rebalance_cost": state.get("rebalance_cost"),
            # Two further ex-ante risk reads off the same covariance as
            # risk_decomposition. Separate columns, separate method ids — never
            # merged with var_95, which is realised and parametric (ADR-0082).
            "monte_carlo_var": state.get("monte_carlo_var_final"),
            "var_forecast": state.get("var_forecast_final"),
            # A backtest of THESE weights, not a track record (ADR-0112). Its own column
            # so it can never be mistaken for `portfolio_returns`, and its caveats ride
            # inside the payload so an MCP consumer gets them with the numbers.
            "weights_backtest": state.get("weights_backtest_final"),
        }

        # Record WHAT this upsert is about to overwrite, before it overwrites it.
        #
        # The upsert below is `on_conflict="run_date"`, so a second run for the same date
        # replaces the published book in place and no prior version survives. On
        # 2026-07-26 `research_agent_runs` held 17 runs for run_date 2026-07-25 and 25 for
        # 2026-07-24 — every one that reached persist overwrote a published book with no
        # trace. Read-then-diff, so a reader who quoted a figure can find out it moved.
        #
        # Deliberately non-fatal and BEFORE the write: this reports on the book, it does
        # not produce one, and a logging failure must never cost a run that was otherwise
        # ready to publish. See ADR-0093.
        try:
            _record_book_revisions(sb, run_date, analytics_row)
        except Exception as exc:  # noqa: BLE001 — see above
            print(f"[_persist_to_supabase] revision log skipped ({exc.__class__.__name__}): {exc}")

        try:
            sb.table("research_recommendations").upsert(
                analytics_row, on_conflict="run_date"
            ).execute()
        except Exception as exc:
            # Migration 021 not applied yet — persist the legacy shape rather
            # than losing the run entirely. Loud, not silent: an operator needs
            # to know /risk will have nothing to render.
            print(
                f"[_persist_to_supabase] Book-analytics columns unavailable "
                f"({exc.__class__.__name__}): apply migration 022. "
                f"Falling back to legacy row — /risk will render unavailable."
            )
            sb.table("research_recommendations").upsert(
                base_row, on_conflict="run_date"
            ).execute()

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
            # ADR-0046: this name's theme is below the attention gate and was
            # expanded only because the name's own edge is decisive. Carried so the
            # funnel can count it and /book can say which door a candidate used.
            "via_conviction": getattr(c, "via_conviction", False),
            "edge_score": getattr(c, "edge_score", 0.0),
            # conviction + vol are what size_positions is SUPPOSED to weight by
            # (ADR-0032). They were never carried this far, so the sizer saw zeros
            # and silently fell back to HypeScore — ADR-0053.
            "conviction": getattr(c, "conviction", 0.0),
            "vol": getattr(c, "vol", 0.0),
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

    # Retry loop: if citations failed, re-call reason_picks (max 2 total)
    retry_count = 0
    while not state.get("verified") and retry_count < 2 and state.get("error"):
        print(f"[run_q1_agent] Citation verification failed: {state['error']}")
        print(f"[run_q1_agent] Retrying reason_picks (attempt {retry_count + 2}/3)...")
        state["retries"] += 1
        state = reason_picks(state)
        state = verify_citations(state)
        retry_count += 1

    # Size once, after the picks are final. Sizing before the retry loop meant a
    # retry re-picked without re-sizing, leaving weights that belonged to the
    # discarded pick set.
    state = size_positions(state)
    state = finalise_book_analytics(state)

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
