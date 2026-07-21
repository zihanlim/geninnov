# ADR-0013 — Deterministic L0–L4, stochastic L5 only (constrained-reasoning pattern)

- Status: accepted
- Date: 2026-07-21
- Tags: architecture, ai-safety, q1-pipeline, reproducibility

## Context

A Q1-style "given $100M, what are your top 5 long/short, and why" deliverable requires both:
1. **Deterministic, auditable features** — factor exposures, regime classification, risk metrics, theme scores, HypeScore weights. The reviewer needs to verify these are real, computed correctly, and traceable to inputs.
2. **Creative synthesis** — the narrative that ties a theme to a specific instrument, the catalyst call, the counter-thesis. This is what a discretionary macro PM does that a pure quant screen doesn't.

A pure factor-investing answer ("long value, short growth") is technically correct but **not what Q1 is asking for** — the test is a discretionary macro/thematic exercise, not a quant screen. A pure discretionary answer ("I think NVDA is going up because AI is hot") is the right shape but **not rigorous enough** for a quant interview.

The naive architectures both fail:
- **Pure-LLM agent**: an agent that gets all inputs in its prompt and produces a thesis. Fast to build, but the reviewer cannot audit the LLM's reasoning. The candidate's quantitative work is invisible.
- **Pure quant**: factor tilts + screen + size. Auditable, but no thesis. The "why" in the question is unanswered.

A middle ground exists: **make L0–L4 a deterministic, auditable pipeline, and constrain the LLM to operate only at L5 as a synthesizer**. The LLM gets the pre-computed L0–L4 outputs as a structured input, produces a thesis, and is bounded by hard constraints (citation guardrail, candidate-set filter, cap enforcement). The LLM is treated as a *constrained synthesizer*, not a free agent.

## Decision

Andromeda's Q1 reasoning pipeline is structured as a **deterministic-then-stochastic pipeline** with a hard boundary at L5:

| Layer | Stochastic? | Reproducible? | Auditable? | Source |
|-------|-------------|---------------|------------|--------|
| L0 Macro ingest | No | Yes (FRED series IDs are stable) | Yes (each row in `macro_indicators`) | `backend/data/macro_fetcher.py` |
| L1 Theme detection | No | Yes (deterministic formulas + `scoring_config` weights) | Yes (`theme_signals_history` stores raw signals) | `scripts/daily_refresh.py` |
| L2 Factor exposures | No | Yes (Ken French CSV + rolling 252d regression) | Yes (`factor_exposures` per asset) | `backend/data/factor_fetcher.py` |
| L3 Regime classifier | No | Yes (rule-based thresholds) | Yes (6 inputs, explicit thresholds) | `backend/services/regime_classifier.py` |
| L4 Risk engine | No | Yes (closed-form formulas on stored returns) | Yes (raw returns in `portfolio_returns`) | `scripts/daily_refresh.py` |
| **L5 Reasoning** | **Yes** | **Mostly** (LLM at `reason_picks` only) | **Yes with guardrails** (citations verified, candidate set enforced) | `backend/services/q1_agent.py` |
| L6 Writeup | No | Yes (templated rendering of L5 structured output) | Yes (markdown rendered from JSON) | `frontend/app/research/` |
| L7 Provenance | No | Yes (read-only audit trail) | Yes (citation footnotes, derivation drawer) | `frontend/components/` |

The boundary is **L4 → L5**: every layer below is a pure function. The LLM is invoked **only at L5**, and only at the `reason_picks` node (1 LLM call per run, with up to 2 retries on citation failure).

### The frozen input snapshot

At the start of the L5 agent run, all L0–L4 outputs are **frozen into `q1_agent_runs.input_snapshot` JSONB**. The LLM sees a snapshot, not a live query. This means:
- The L5 run is reproducible: same snapshot + same prompt + `temperature=0` → same output
- The audit trail is durable: the snapshot is stored alongside the LLM's output, so a reviewer can re-run the verification check days later
- The LLM cannot be tricked by mid-run data drift: it sees what L0–L4 saw at run time

### LLM constraints (what the LLM cannot do)

Even though L5 is stochastic, the LLM is bounded by:

1. **Hard candidate-set filter** (see [ADR-0014](0014-candidate-set-hard-filter.md)): the LLM can only pick names that survived `screen_candidates` (HypeScore ≥ threshold, R² ≥ 0.10, deduped). The LLM cannot invent a ticker.
2. **Citation guardrail** (see [ADR-0012](0012-citation-guardrail-llm-defense.md)): every numeric claim must resolve to a key in the input snapshot. The LLM cannot fabricate a number.
3. **Cap enforcement** (in `size_positions`): single-name 20% / sector 30% / geo 35% caps. The LLM cannot size a position arbitrarily; the sizing is post-LLM.
4. **Deterministic fallback**: if 2 retries fail, `fallback_picks` runs with no LLM. The LLM cannot return a blank slate.
5. **Temperature=0**: `temperature=0, max_tokens=4096, prompt_version` stored per run. The LLM is configured for lowest variance.

### Why this is "constrained reasoning" not "agentic AI"

The LLM is not an agent. It is a function call:
- Input: structured L0–L4 snapshot + candidate set + scenario table
- Output: structured JSON with picks, thesis, citations
- Reproducibility: same input + same `temperature=0` → same output
- Constraints: 4 (candidate filter, citations, caps, fallback)

A "real" agent would have tools, memory, multi-step planning, and autonomy. The L5 node has none of these. The agentic framing is misleading and was deliberately avoided.

## Consequences

### Positive
- The L0–L4 layers are fully reproducible. A reviewer can re-run any of them and verify the output.
- The L5 run is reproducible enough to audit (input snapshot frozen, prompt versioned, `temperature=0`).
- The "why" in Q1 is answered — the LLM provides the thesis, catalysts, and counter-thesis that pure quant cannot.
- The "is this real" question is answered — the L0–L4 inputs are auditable, the LLM's numbers are citation-checked.
- The reviewer sees both the rigor (L0–L4) and the judgment (L5 thesis) without either being a black box.

### Negative
- Two layers to maintain: the deterministic pipeline AND the LLM harness. More code, more tests.
- The LLM's output is structurally constrained, which can make the thesis feel "templated" if the LLM is too cautious. Mitigated by allowing the LLM to vary the prose as long as the structure is preserved.
- Reproducibility is "mostly" — not bit-exact. The LLM can produce slightly different prose across runs at `temperature=0` due to internal sampling variations. Mitigated by versioning the prompt and storing the raw output.

### Neutral
- The L0–L4 / L5 split is the same pattern as "candidate set + ML filter" in classical quant. The novelty is applying it to LLM reasoning instead of model inference.
- The architecture is LLM-agnostic. Swap Claude Sonnet for GPT-4o or Gemini; the contract is the same (input snapshot, structured output, citations).

## Alternatives considered

### Pure LLM agent (autonomous reasoning)
What it was: give the LLM all the tools (FRED API, yfinance, Supabase queries) and let it decide what to look up.
Why we rejected: non-deterministic, non-auditable, slow, expensive. The reviewer cannot tell if the agent actually queried the data or hallucinated the query results. This is the failure mode that destroys trust in an interview context.

### Pure quant screen (no LLM)
What it was: factor tilts + screen + size, no thesis.
Why we rejected: doesn't answer Q1. The "why" is the deliverable. A factor screen is a sub-component of the answer, not the answer.

### LLM-first with post-hoc verification
What it was: LLM produces a thesis with no constraints, then a separate LLM-as-judge verifies it.
Why we rejected: 2× the cost, 2× the latency, and the judge hallucinates too. See [ADR-0012](0012-citation-guardrail-llm-defense.md) for the full reasoning.

### LLM with a small DSL (domain-specific language) for trade ideas
What it was: LLM emits trades in a formal language; a deterministic compiler validates and sizes them.
Why we rejected: over-engineered for a 5+5 trade book. The JSON schema + citation guardrail + cap enforcement already cover the constraint set without needing a custom DSL.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §14 (Q1 Reasoning Pipeline)
- Implementation: `backend/services/q1_agent.py` (8 nodes), `backend/services/book_metrics.py`, `backend/services/scenario_analysis.py`
- Reproducibility: `q1_agent_runs.input_snapshot` JSONB, `prompt_version` field
- Related: [ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0014](0014-candidate-set-hard-filter.md)
