# ADR-0015 — Lens mode: triggerable asset-class filter on the L5 reasoning agent

- Status: accepted
- Date: 2026-07-21
- Tags: q1-pipeline, ai-safety, frontend, ux, constraint

## Context

The L5 reasoning agent (`backend/services/q1_agent.py`) operates on a candidate pool that spans all asset classes — equity ETFs, rates, credit, FX, commodities, and single-name equities. The LLM sees the full universe and picks top 5 long / top 5 short from whatever's in front of it.

In some contexts the user wants a **narrower book** than the full universe:

- **Firm-specific mandate.** Andromeda Capital Management runs a credit-and-rates focused macro L/S strategy, not a multi-asset book. The Q1 deliverable for the firm is more credible if the candidate pool is filtered to credit + rates (HYG, LQD, TLT, IEF, EMB, JNK, BKLN, ANGL) before the LLM sees it.
- **Risk-management isolation.** A portfolio manager might want to evaluate "what would our credit book look like separately" without conflating it with equity exposure.
- **Demoware / interview context.** Showing the same system producing both a multi-asset book and a credit-only book demonstrates that the agent is parameterized, not hard-coded to one mandate.

The naive solution — build a separate `q1_agent_credit.py` agent — duplicates the entire 8-node pipeline, the citation guardrail, the cap enforcement, the scenario analysis, and the LLM prompt harness. That's high maintenance cost and high divergence risk over time.

The right solution is a **triggerable lens parameter** that filters the candidate pool at a single node (`screen_candidates`) and injects a lens-specific framing instruction into the LLM prompt. Everything else (book metrics, scenario analysis, citation guardrail, position sizing, cap enforcement) is reused unchanged.

## Decision

Add a `lens` parameter to the L5 agent. The parameter accepts one of:
- `"multi_asset"` (default) — no filter; all asset classes allowed
- `"credit"` — only credit + rates instruments
- `"rates"` — only rates (TLT, IEF, TIPS, AGG, BIL, SHY, SVXY)
- `"equity"` — only equity ETFs
- `"fx"` — only FX instruments (UUP, FXE, DXY, EWZ)
- `"commodity"` — only commodities (GLD, SLV, UNG, OIH, CL)

The lens affects two places in the pipeline:

### 1. screen_candidates (data layer)

The `screen_candidates` node drops any candidate whose `asset_class` doesn't match the lens. The `asset_class` column comes from `theme_assets` (migration 009). Tickers not in `theme_assets` (rare) fall back to a hard-coded `LENS_TICKER_FALLBACK` map that mirrors the taxonomy.

```python
# From backend/services/q1_agent.py
def screen_candidates(state: Q1State) -> Q1State:
    lens = state.get("lens", "multi_asset")
    lens_tickers = LENS_TICKER_FALLBACK.get(lens, set()) if lens != "multi_asset" else None
    for t in state["theme_scores"]:
        # ...
        for asset in assets:
            if lens_tickers is not None and asset not in lens_tickers:
                continue   # ← lens filter
            # ...
```

The candidate pool is still capped at 30. If a lens yields < 10 candidates, the system **logs a warning** but does not silently fall back to multi_asset. The user is expected to widen the lens.

### 2. reason_picks (LLM prompt layer)

The LLM gets a lens-specific framing instruction prepended to its prompt. For example, the credit lens instructs the model to "frame every pick in terms of credit-market views: spreads, default risk, ratings, carry, roll-down."

```python
LENS_PROMPT_FRAMING = {
    "credit": "LENS: CREDIT — frame every pick in terms of credit-market views: spreads, "
              "default risk, ratings, carry, roll-down. The book is a credit long/short...",
    "rates": "LENS: RATES — frame every pick in terms of duration, curve shape, real vs nominal...",
    # ...
}
```

This does two things: (a) ensures the thesis is written in the right vocabulary ("HY OAS at 380bps" not "credit spread"); (b) prevents the model from over-reaching into other asset classes if a multi-asset candidate accidentally survives the filter.

### Frontend: <LensSelector>

A new `<LensSelector>` segmented control lives at the top of `/portfolio` and `/trades`. Clicking a lens re-filters the position list by `theme_assets.asset_class` (Supabase query). The portfolio numbers (VaR, CVaR, Beta, HHI) are recomputed client-side from the filtered set.

The frontend lens is a **filter on existing data**, not a separate backend run. The backend lens parameter is invoked when the L5 agent is run with a lens other than the default (see "How to invoke" below).

### How to invoke a non-default lens

The daily `scripts/daily_refresh.py` calls `run_q1_agent(..., lens="multi_asset")` by default. To produce a credit-lens book, call separately:

```python
from services.q1_agent import run_q1_agent

# Credit book
run_q1_agent(..., lens="credit")
```

The credit book is persisted to the same `q1_recommendations` table, with the `raw_output` JSONB including the lens name. Multiple lens runs can coexist on the same date — distinguished by the lens field in `raw_output` or a future `lens` column.

## Consequences

### Positive
- The L5 agent is parameterized, not hard-coded to one mandate. The same code produces a multi-asset book and a credit book.
- The lens filter is structural — the LLM cannot pick outside the filtered candidate set. Same hard guarantee as the existing candidate-set filter (ADR-0014).
- The thesis is lens-flavored without requiring a separate prompt harness. The framing instruction is one paragraph at the top of the prompt.
- The frontend toggle is a 1-line filter change — no schema migration needed if `asset_class` is already populated (migration 009).
- The credit-lens book is the **right answer for Andromeda Capital's mandate** without abandoning the platform's multi-asset capability.

### Negative
- The lens is a *coarse* filter, not a *fine* one. It cannot express "credit IG only, no HY" or "US equity ex-energy." For that granularity, the `asset_class` taxonomy would need a sub-class dimension (e.g., `credit_subclass: 'ig' | 'hy' | 'em' | 'loans' | 'structured'`). Defer.
- The hard-coded `LENS_TICKER_FALLBACK` map is a maintenance burden if tickers change. Mitigated by populating `theme_assets.asset_class` for all tickers via migration 009, which makes the fallback path the exception.
- The frontend lens toggle is a *display filter*, not a re-run. The numbers on the page are computed from the multi-asset book; the toggle just hides rows. This is a UX choice — see "Alternatives" below.

### Neutral
- The lens parameter is part of the L5 state (`Q1State["lens"]`). It's persisted in `q1_agent_runs.input_snapshot` for audit.
- The `_format_lens_framing` helper is a simple string lookup, not a templated prompt fragment.

## Alternatives considered

### Separate `q1_agent_credit.py` agent
What it was: a full duplicate of the 8-node pipeline, parameterized for credit only.
Why we rejected: duplicates the citation guardrail, the cap enforcement, the scenario analysis, the LLM harness. Over time the two agents diverge. Maintenance cost is high.

### Per-lens prompt templates
What it was: store each lens's prompt in a separate file (`prompts/credit.txt`, `prompts/rates.txt`, etc.).
Why we rejected: the framing instruction is one paragraph. A separate file is overkill. The framing is also tightly coupled to the LENS_TICKER_FALLBACK map — keeping them in the same module reduces drift.

### Frontend lens as a true re-run (call run_q1_agent with lens param)
What it was: clicking the lens in the UI would trigger a fresh L5 run, not just filter the existing data.
Why we rejected: too slow (LLM call takes 5-30s), too expensive (every click = API cost), and the user typically wants to *compare* lenses, not get a fresh result each time. The frontend filter on the persisted multi-asset book is the right default. A "Re-run with credit lens" button can be added later for the deep-compare case.

### Lens as a SQL view
What it was: create a Supabase view `vw_positions_credit` that filters by `asset_class IN ('credit', 'rates')`. The frontend just calls a different view per lens.
Why we rejected: overkill for a one-line filter. The view adds schema surface area; the filter at the application layer is one function call.

### No lens — just a Supabase query filter on the frontend
What it was: skip the backend lens param entirely; only do the frontend filter.
Why we rejected: leaves the L5 agent's output book at multi-asset regardless of what the user clicked. If the user wants a thesis *written in credit vocabulary* (the LLM's framing), the L5 has to know about the lens. The frontend filter alone doesn't change the LLM's output.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §14 (Q1 Reasoning Pipeline)
- Migration: `supabase/migrations/009_asset_class_lens.sql`
- Implementation: `backend/services/q1_agent.py` (`screen_candidates`, `_format_lens_framing`, `run_q1_agent`)
- Frontend: `frontend/components/LensSelector.tsx`
- Wired into: `frontend/app/portfolio/page.tsx`, `frontend/components/TradeIdeasTable.tsx`
- Tests: `tests/backend/test_research_agent.py` (lens mode section)
- Related: [ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0013](0013-deterministic-stochastic-split.md), [ADR-0014](0014-candidate-set-hard-filter.md)
