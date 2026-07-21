"""Patch spec §14.8 with v2.0.0 implementation details."""
import re

SPEC = r"C:\Users\zihan\projects\andromeda\docs\superpowers\specs\2026-07-21-andromeda-market-theme-platform-design.md"

with open(SPEC, encoding="utf-8") as f:
    content = f.read()

# Find the section boundaries
marker_start = "### 14.8 L5"
marker_end = "### 14.9 L6"

start_idx = content.index(marker_start)
end_idx = content.index(marker_end)

print(f"Section 14.8 starts at {start_idx}, ends at {end_idx} (length: {end_idx - start_idx})")

new_section = """### 14.8 L5: AI Reasoning Agent  (v2.0.0 — implemented)

**Architecture:** Sequential node pipeline (8 pure-function nodes + 1 LLM call). Chosen for simplicity and auditability — the pipeline runs once daily, is purely sequential, and explicit Python functions with typed state are easier to test and reproduce than a state-machine graph. LangGraph would be over-engineered for this use case.

**State shape (`Q1State`, a TypedDict subclass persisted as a plain dict):**

```python
class Q1State(dict):
    run_date: str
    supabase_url: str
    supabase_key: str
    macro_snapshot: dict[str, dict]   # {series_id: {name, value, unit}} — L0
    theme_scores: list[dict]          # [{theme_id, name, hype_score, trade_score, avg_sentiment}] — L1
    factor_exposures: dict[str, dict] # {asset: {beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared}} — L2
    regime: dict                      # {cycle, sentiment, yield_curve_slope, hy_oas, vix_level, ...} — L3
    risk_metrics: dict[str, Any]     # {total_capital, var_95, sharpe, beta, cvar_95, concentration_hhi} — L4
    news_headlines: list[dict]       # raw L1 collected: [{text, date}]
    cfg: ScoringConfig                # weights + thresholds
    candidates: list[dict]            # screened candidates (after node 2)
    picks: list[dict]                 # final 10 picks from reason_picks
    book_view: str                    # 3-5 sentence macro view
    book_risks: list[str]             # cross-cutting risks
    citations: list[dict]              # [{text, source}] — every numeric claim
    verified: bool                    # passed citation check
    retries: int                      # re-pick attempts
    input_snapshot: dict               # frozen L0-L4 at run time (for audit)
    error: str | None
    # v2 additions (computed pre-pick, before reason_picks is called):
    book_metrics_summary: str          # value-weighted FF5+UMD tilts, net/gross exposure
    scenario_table: str                # formatted 4-scenario stress-test table
    correlation_warnings: list[str]    # high-corr pair warnings (ρ > 0.70)
    cap_violations: list[str]          # sector/geo/single-name violations in candidate book
```

**Graph nodes (9 total — v2 adds nodes 4 and 5):**

1. **`aggregate_context`** — Pure function. Pulls L0–L4 outputs from Supabase into Q1State. Also builds `input_snapshot` for the audit record. No LLM.
2. **`screen_candidates`** — Pure function. Applies hard filters to the ranked candidate set:
   - HypeScore ≥ `hype_score_threshold` (default 50)
   - `trade_score ≠ 0` (must have a directional signal)
   - Liquidity filter: equities require R² ≥ 0.10 vs theme's price signal; ETFs always pass
   - Deduplication: same `(asset, direction)` pair → keep highest HypeScore theme only
   - Caps at 30 candidates (max)
   - Output: list of `{asset, direction, theme_id, theme_name, hype_score, trade_score, avg_sentiment}`.
3. **`classify_news`** — Stub placeholder for future headline-tagging LLM call (not yet wired in the pipeline).
4. **`compute_book_metrics`** *(v2)* — Pure function. Computed over the candidate set BEFORE the LLM picks, so the agent has pre-computed factor context:
   - Value-weighted FF5 + UMD tilts per candidate (from `factor_exposures`, excluding assets with R² < 0.30)
   - Net exposure = Σ(long_weights) − Σ(short_weights), gross = Σ|weights|
   - Sector and geography aggregation via `SECTOR_MAP` / `GEO_MAP`
   - Violation detection: single-name > 20%, sector > 30%, geography > 35%
   - 252-day Pearson correlation matrix from yfinance; flags pairs with ρ > 0.70
   - Output: `book_metrics_summary`, `correlation_warnings`, `cap_violations` added to state.
5. **`run_scenario_analysis`** *(v2)* — Pure function. Runs 4 stress scenarios on the candidate book (pre-pick, so the LLM has scenario context when constructing the book):
   - S1 VIX spike: VIX > 30 → equity shock (β-based), flight-to-safety
   - S2 Rate shock: +50bps → duration assets hit hard, short-end sheltered
   - S3 USD surge: DXY +5% → EM/commodity FX hit
   - S4 Credit widening: HY OAS +150bps → spread products hit
   - Each pick gets: signed P&L estimate (direction-aware), severity classification (low/moderate/high/severe)
   - Worst scenario identified and surfaced; results sorted by severity
   - Output: `scenario_table` added to state for reference in `book_risks`.
6. **`reason_picks`** — Main LLM call (Anthropic Claude Sonnet). System prompt (`REASON_PICKS_SYSTEM`, version `v2.0.0`) contains:
   - Full macro snapshot (formatted key:value table)
   - Regime description (cycle + sentiment + key regime indicators)
   - Candidate list with hype/trade/sentiment scores
   - Book metrics summary (value-weighted tilts, sector/geo violations, correlation warnings)
   - Scenario analysis table (4 scenarios, severity, P&L estimates)
   - Instruction to avoid high-corr pairs and cap violations
   - Instruction that every numeric claim requires a citation
   - `counter_thesis` field per pick: measurable disqualifier (e.g., "FLIP if HY OAS breaks above 500bps")
   - `time_horizon` field per pick: "1-2 weeks" default
   - Output JSON schema: `{picks: [{direction, asset, theme_id, thesis, catalysts, risk, counter_thesis, time_horizon, factor_tilts}], book_view, book_risks, citations: [{text, source}]}`.
7. **`verify_citations`** — Guardrail. For each citation in LLM output, looks up the value in `macro_snapshot`. If cited value doesn't match, or a number lacks a citation → sets `verified=False`, increments `retries`, re-invokes `reason_picks` with explicit error feedback. Max 2 retries; third failure exits to `fallback_picks`.
8. **`size_positions`** — Pure function. Allocates $100M by HypeScore weight with hard cap enforcement:
   - Raw weight = `hype_score / Σ(hype_scores)` per candidate
   - Single-name cap (20%): cap dominated names, redistribute excess to uncapped names proportionally by original weight
   - Sector cap (30%): applied when sector has ≥ 3 members (avoids oscillation with 2-asset portfolios)
   - Geography cap (35%): applied when geo group has ≥ 3 members
   - Final normalization so weights sum exactly to 1.0
   - Output: each pick enriched with `notional` (dollar amount) and `weight` (fraction of book).
9. **`fallback_picks`** — Deterministic fallback. Triggered after 2 citation failures or empty picks. Produces 10 picks (5 long + 5 short) without any LLM: top 5 by HypeScore with positive trade score for longs; bottom 5 for shorts. Thesis is templated from regime and factor data. Always produces a valid output — never a blank slate.

**Citation guardrail (the most important guardrail):**

Every numeric claim in LLM output must cite a source key. The `verify_citations` node validates this. If a number is used without a citation, or the cited value doesn't match `macro_snapshot`, the output is rejected and `reason_picks` is re-invoked with explicit error feedback. Max 2 retries; then deterministic fallback. This is the primary defense against LLM hallucination of macro data.

**Reproducibility:** `temperature=0`, `max_tokens=4096`, prompt version (`PROMPT_VERSION = "v2.0.0"`) stored in `q1_agent_runs`. `input_snapshot` freezes all L0–L4 inputs at run time for full reproducibility.

**LLM choice:** Claude Sonnet via Anthropic messages API. `ANTHROPIC_API_KEY` env var. `DEFAULT_MODEL = "claude-sonnet-4-20250514"`. Falls back to `KeyError` if key not set (safe — deterministic fallback kicks in).

**Storage schema (`q1_agent_runs` and `q1_recommendations` tables):**

```sql
CREATE TABLE q1_agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    prompt_version TEXT NOT NULL DEFAULT 'v2.0.0',
    model_id TEXT NOT NULL,
    input_snapshot JSONB,         -- frozen L0-L4 inputs at run time
    raw_output JSONB,             -- raw LLM response
    citations JSONB,             -- [{text, source}]
    verified BOOLEAN,
    retries INT,
    duration_ms INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE q1_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    picks JSONB,                  -- [{direction, asset, theme_id, notional, weight,
                                    --  thesis, catalysts, risk, counter_thesis,
                                    --  time_horizon, factor_tilts}]
    book_view TEXT,                -- 3-5 sentence macro view
    book_risks JSONB,             -- list of risk strings
    book_metrics_summary TEXT,     -- v2: computed FF5+UMD tilts + violations
    scenario_table TEXT,           -- v2: 4-scenario stress table
    agent_run_id UUID REFERENCES q1_agent_runs(id)
);
```

"""

result = content[:start_idx] + new_section + content[end_idx:]
with open(SPEC, 'w', encoding='utf-8') as f:
    f.write(result)

print(f"Done! Replaced {end_idx - start_idx} chars with {len(new_section)} chars")
