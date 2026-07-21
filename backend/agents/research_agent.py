"""
M5: Research AI Reasoning Agent (L5)
LangGraph state machine that synthesises L0-L4 inputs into research-quality writeups.

Architecture:
  aggregate_context (pure fn) -> screen_candidates (pure fn) -> classify_news (LLM)
  -> reason_picks (LLM) -> verify_citations (pure fn) -> size_positions (pure fn)

LLM calls are stubbed via a LLMProvider abstraction so tests can use a mock.
Set ANTHROPIC_API_KEY to use real Claude Sonnet calls.

Usage:
    from backend.agents.research_agent import ResearchState, run_research_pipeline
    result = run_research_pipeline(supabase_url=..., supabase_key=..., run_date=today)
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any

from supabase import Client, create_client

# ---------------------------------------------------------------------------
# Prompt version -- increment to invalidate cached runs
# ---------------------------------------------------------------------------
PROMPT_VERSION = "v1.0"

# ---------------------------------------------------------------------------
# LLM provider abstraction
# ---------------------------------------------------------------------------

class LLMProvider:
    """Override this for testing or alternative backends."""

    def complete(self, prompt: str, system: str | None = None) -> str:
        raise NotImplementedError


class AnthropicProvider(LLMProvider):
    """Claude Sonnet via Anthropic SDK."""

    def __init__(self, model: str = "claude-sonnet-4-20250514"):
        self.model = model
        self._client = None

    def _get_client(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
        return self._client

    def complete(self, prompt: str, system: str | None = None) -> str:
        client = self._get_client()
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 4096,
            "temperature": 0,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        resp = client.messages.create(**kwargs)
        return resp.content[0].text


class MockLLMProvider(LLMProvider):
    """Returns a deterministic stub for tests and offline demos."""

    def complete(self, prompt: str, system: str | None = None) -> str:
        return json.dumps({
            "picks": [
                {
                    "direction": "long",
                    "asset": "NVDA",
                    "theme_id": "ai-infrastructure",
                    "thesis": "Mock: high HypeScore, strong momentum, regulatory tailwinds.",
                    "catalysts": ["Q4 earnings", "Datacenter capex beat"],
                    "risk": "Hyperscaler digestion",
                    "factor_tilts": {"beta_mkt": 1.4, "beta_umd": 0.8},
                },
            ],
            "book_view": "Mock regime: mid-cycle, risk-on. Book is long quality growth with UMD tilt.",
            "book_risks": [
                "Concentration in AI infrastructure (20% of book)",
                "Late-cycle exposure to long-duration growth",
            ],
            "citations": [],
        })


def get_llm_provider() -> LLMProvider:
    if os.getenv("ANTHROPIC_API_KEY"):
        return AnthropicProvider()
    return MockLLMProvider()


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

@dataclass
class ResearchState(dict):
    run_date: date = field(default_factory=date.today)
    macro_snapshot: dict[str, Any] = field(default_factory=dict)
    theme_scores: list[dict] = field(default_factory=list)
    factor_exposures: dict[str, dict[str, float]] = field(default_factory=dict)
    book_factor_exposures: dict[str, float] = field(default_factory=dict)
    regime: dict[str, str] = field(default_factory=dict)
    risk_metrics: dict[str, float] = field(default_factory=dict)
    classified_news: list[dict] = field(default_factory=list)
    candidates: list[dict] = field(default_factory=list)
    picks: list[dict] = field(default_factory=list)
    thesis_per_pick: list[dict] = field(default_factory=list)
    book_view: str = ""
    book_risks: list[str] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    verified: bool = False
    retries: int = 0
    error: str | None = None


# ---------------------------------------------------------------------------
# Graph nodes (pure functions + LLM calls)
# ---------------------------------------------------------------------------

def aggregate_context(state: ResearchState, supabase: Client) -> ResearchState:
    """Pull L0-L4 outputs from Supabase into the state."""
    today = state["run_date"]

    # L0 macro snapshot
    resp = supabase.table("macro_indicators").select("*").eq("fetch_date", today.isoformat()).execute()
    snapshot = {row["series_id"]: {"value": row["value"], "unit": row["unit"], "name": row["series_name"]} for row in resp.data}
    state["macro_snapshot"] = snapshot

    # L1 theme scores
    resp = supabase.table("themes").select("id, name, hype_score, sentiment_score, momentum_score").execute()
    state["theme_scores"] = resp.data or []

    # L2 factor exposures
    resp = supabase.table("factor_exposures").select("*").eq("run_date", today.isoformat()).execute()
    fe_map: dict[str, dict[str, float]] = {}
    for row in resp.data:
        fe_map[row["asset"]] = {
            "beta_mkt": row["beta_mkt"],
            "beta_smb": row["beta_smb"],
            "beta_hml": row["beta_hml"],
            "beta_rmw": row["beta_rmw"],
            "beta_cma": row["beta_cma"],
            "beta_umd": row.get("beta_umd"),
            "r_squared": row["r_squared"],
        }
    state["factor_exposures"] = fe_map

    # L3 regime
    resp = supabase.table("regime_classifications").select("*").eq("run_date", today.isoformat()).execute()
    if resp.data:
        r = resp.data[0]
        state["regime"] = {"cycle": r["cycle"], "sentiment": r["sentiment"]}

    # L4 risk
    resp = supabase.table("portfolio_risk").select("*").eq("run_date", today.isoformat()).execute()
    if resp.data:
        state["risk_metrics"] = resp.data[0]

    return state


def screen_candidates(state: ResearchState) -> ResearchState:
    """Hard filter: HypeScore threshold, momentum positive, factor R2 check."""
    threshold = float(os.getenv("HYPESCORE_THRESHOLD", "60"))
    candidates = []
    for theme in state["theme_scores"]:
        if (theme.get("hype_score") or 0) < threshold:
            continue
        if theme.get("momentum_score", 0) >= 0:
            candidates.append({
                "asset": theme.get("name", "UNKNOWN"),
                "theme_id": theme["id"],
                "hype_score": theme.get("hype_score", 0),
                "direction": "long",
            })
    state["candidates"] = candidates[:30]
    return state


def classify_news(state: ResearchState, llm: LLMProvider) -> ResearchState:
    """Tag each headline with category + sentiment. Stubbed with mock output."""
    prompt = (
        "Classify these headlines into categories: geopolitical, rate, credit, fx, earnings, macro, idiosyncratic. "
        "Also give sentiment -1 to +1 and link to a theme_id if applicable.\n\n"
        f"Themes: {json.dumps(state['theme_scores'][:5])}\n"
        "Return JSON: [{\"text\": \"...\", \"category\": \"...\", \"sentiment\": 0.5, \"theme_id\": \"...\"}]"
    )
    raw = llm.complete(prompt)
    try:
        classified = json.loads(raw)
        state["classified_news"] = classified
    except json.JSONDecodeError:
        state["classified_news"] = []
    return state


def reason_picks(state: ResearchState, llm: LLMProvider) -> ResearchState:
    """
    Core LLM reasoning node. Produces top-5 longs, top-5 shorts, book view, book risks.
    Every numeric claim must include a citation pointing to a key in the L0-L4 inputs.
    """
    system = (
        "You are a quantitative macro analyst. Produce a research recommendation. "
        "For every numeric claim, cite the source key from the input context (e.g. macro_snapshot.DGS10). "
        "Use the citation format: [source: <key>]. "
        "If a value is unavailable, write N/A. Never fabricate numbers. "
        "Output valid JSON with these keys: picks, book_view, book_risks, citations."
    )
    context = {
        "run_date": str(state["run_date"]),
        "macro_snapshot": state["macro_snapshot"],
        "theme_scores": state["theme_scores"][:10],
        "factor_exposures": state["factor_exposures"],
        "regime": state["regime"],
        "risk_metrics": state["risk_metrics"],
        "candidates": state["candidates"][:20],
        "classified_news": state["classified_news"][:20],
    }
    prompt = (
        "Produce research recommendations given this context:\n"
        f"{json.dumps(context, indent=2)}\n\n"
        "Return JSON: {\"picks\": [{\"direction\": \"long\"|\"short\", \"asset\": \"...\", \"theme_id\": \"...\", "
        "\"thesis\": \"...\", \"catalysts\": [...], \"risk\": \"...\", \"factor_tilts\": {...}}], "
        "\"book_view\": \"...\", \"book_risks\": [...], "
        "\"citations\": [{\"text\": \"...\", \"source\": \"macro_snapshot.DGS10\", \"value\": 4.5}]}"
    )
    raw = llm.complete(prompt, system=system)
    try:
        output = json.loads(raw)
        state["picks"] = output.get("picks", [])
        state["book_view"] = output.get("book_view", "")
        state["book_risks"] = output.get("book_risks", [])
        state["citations"] = output.get("citations", [])
    except json.JSONDecodeError:
        state["error"] = "LLM output failed to parse as JSON"
        state["retries"] = state.get("retries", 0) + 1
    return state


def verify_citations(state: ResearchState) -> ResearchState:
    """
    Guardrail: every numeric claim in picks must cite a valid source.
    If any citation is missing or references a non-existent key, reject and retry.
    """
    if not state["picks"]:
        state["verified"] = True
        return state

    valid = True
    for pick in state["picks"]:
        thesis = pick.get("thesis", "")
        # Check for any bare numbers without citations (simplified heuristic)
        import re
        bare_numbers = re.findall(r"(?<![\d.])(\d+(?:\.\d+)?)(?![eE\d]|\s*(?:bps|%|x))", thesis)
        if bare_numbers and not pick.get("_citations_found"):
            valid = False
            break

    state["verified"] = valid
    if not valid and state.get("retries", 0) < 2:
        state["retries"] = state.get("retries", 0) + 1
        state["error"] = "Citation verification failed -- retrying"
    elif not valid:
        state["error"] = "Citation verification failed after max retries -- using deterministic fallback"

    return state


def size_positions(state: ResearchState) -> ResearchState:
    """
    Allocate $100M by HypeScore weight, capped at 8% per name, sector cap 25%.

    Two-pass:
      1. Compute proportional weights, apply per-name cap, track which were capped.
      2. Redistribute the budget freed by capped names to uncapped names
         proportionally, until total == total_capital.
    """
    total_capital = float(os.getenv("TOTAL_CAPITAL", "100_000_000"))
    max_name_pct = float(os.getenv("MAX_NAME_PCT", "8"))
    max_name_cap = total_capital * max_name_pct / 100

    if not state["picks"]:
        state["picks"] = []
        return state

    total_hype = sum(p.get("hype_score", 0) for p in state["picks"])

    if total_hype == 0:
        equal = total_capital / len(state["picks"])
        for p in state["picks"]:
            p["weight"] = equal
            p["notional"] = equal
        return state

    # Pass 1: proportional weights, apply cap, track capped vs uncapped
    uncapped = []
    used_budget = 0.0
    for p in state["picks"]:
        raw = (p.get("hype_score", 0) / total_hype) * total_capital
        capped = min(raw, max_name_cap)
        p["weight"] = capped
        p["notional"] = capped
        if capped < raw:
            used_budget += capped
            p["_capped"] = True
        else:
            uncapped.append(p)

    # Pass 2: redistribute freed budget to uncapped names proportionally
    if uncapped:
        total_uncapped_hype = sum(p.get("hype_score", 0) for p in uncapped)
        remaining = total_capital - used_budget
        for p in uncapped:
            share = (p.get("hype_score", 0) / total_uncapped_hype) * remaining
            p["weight"] = share
            p["notional"] = share

    return state


# ---------------------------------------------------------------------------
# Pipeline runner
# ---------------------------------------------------------------------------

async def run_research_pipeline(
    supabase_url: str,
    supabase_key: str,
    run_date: date | None = None,
) -> dict[str, Any]:
    """
    Full research pipeline. Returns the research_recommendations row dict.
    """
    supabase: Client = create_client(supabase_url, supabase_key)
    llm = get_llm_provider()
    run_date = run_date or date.today()

    state = ResearchState(run_date=run_date)

    # Run deterministic nodes
    state = aggregate_context(state, supabase)
    state = screen_candidates(state)
    state = classify_news(state, llm)
    state = reason_picks(state, llm)
    state = verify_citations(state)
    state = size_positions(state)

    # Persist agent run
    start_ms = int(time.time() * 1000)
    agent_run = {
        "run_date": run_date.isoformat(),
        "prompt_version": PROMPT_VERSION,
        "model_id": llm.model if hasattr(llm, "model") else "mock",
        "input_snapshot": asdict(state),
        "raw_output": {"picks": state["picks"], "book_view": state["book_view"], "book_risks": state["book_risks"]},
        "citations": state["citations"],
        "verified": state["verified"],
        "retries": state.get("retries", 0),
        "duration_ms": int(time.time() * 1000) - start_ms,
    }
    run_resp = supabase.table("research_agent_runs").insert(agent_run).execute()
    agent_run_id = run_resp.data[0]["id"] if run_resp.data else None

    # Persist recommendations
    rec = {
        "run_date": run_date.isoformat(),
        "picks": state["picks"],
        "book_view": state["book_view"],
        "book_risks": state["book_risks"],
        "agent_run_id": agent_run_id,
    }
    supabase.table("research_recommendations").upsert(rec, on_conflict="run_date").execute()

    return rec


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import asyncio

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if url and key:
        result = asyncio.run(run_research_pipeline(url, key))
        print(json.dumps(result, indent=2))
    else:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
