# ADR-0012 — Citation guardrail as the primary LLM defense in the Q1 pipeline

- Status: accepted
- Date: 2026-07-21
- Tags: ai-safety, llm, research, q1-pipeline

## Context

The L5 reasoning agent (`backend/services/q1_agent.py`) is the only stochastic layer in Andromeda. Everything from L0 to L4 is a deterministic pure function. L5 invokes an LLM (Claude Sonnet) at the `reason_picks` node to synthesize the L0–L4 inputs into a structured $100M long-short book with per-trade thesis.

The single most important failure mode for any LLM in a finance context is **numeric hallucination**: the model invents a macro figure ("HY OAS at 380bps", "Beta 0.42", "8% YTD") that the deterministic layer never produced. The reviewer of the Q1 deliverable sees a thesis paragraph and has no way to tell which numbers came from real data and which were fabricated. In a quant interview context, a hallucinated macro number is fatal — it signals the candidate doesn't actually know the data, and the LLM got away with it.

The naive defense ("just trust the LLM, it usually gets it right") is unacceptable. The reviewer's job is to grade the system, and any thesis with an un-cited or wrong number is unverifiable. A common alternative — "let the LLM cite its own sources in natural language" — is also insufficient because the LLM can fabricate the citation text as easily as the number.

The L5 agent sits at the boundary of "auditable quant" and "creative synthesis." The defense has to be auditable (deterministic check), reproducible (same input → same accept/reject decision), and low-friction (don't reject good theses just because they're chatty).

## Decision

Treat **citation enforcement** as the primary defense against numeric hallucination in the L5 agent. Every numeric claim in the LLM's output must resolve to a real key in the L0–L4 input snapshot. Un-cited or unresolved claims → reject the output and retry.

### The verify_citations contract

```
For each numeric claim n in the LLM output:
    If n has no citation key → reject
    If citation key k not in {macro_snapshot, theme_scores, factor_exposures, regime, risk_metrics}:
        → reject
    If cited value v != input_snapshot[k] (with tolerance):
        → reject
On reject:
    Increment retries; if retries < 2 → re-invoke reason_picks with explicit error feedback
    If retries >= 2 → invoke fallback_picks (deterministic, no LLM)
```

The cited value is compared against the frozen `input_snapshot` (a snapshot of L0–L4 at the start of the run, not the live database), so the check is reproducible.

### Why this works

- **Hallucination is structurally blocked.** The LLM can write any prose it wants, but every number must trace back to a real key with a real value. Fabricating a number forces fabricating a citation, which fails the key-existence check.
- **The check is deterministic and fast.** No LLM-in-the-loop verification — just dict lookups and value comparison. Runs in milliseconds.
- **The retry loop is self-correcting.** When reason_picks is re-invoked, the error feedback names the specific failed citation. The LLM learns (within a single run) what was wrong.
- **The fallback is the safety net.** After 2 failed retries, the system produces a valid output anyway — top-5 longs/shorts by HypeScore with templated thesis. The system never returns a blank slate.

### Why not other defenses

- **Don't constrain the LLM with examples alone.** Few-shot prompting reduces but doesn't eliminate hallucination. Hallucination is a property of sampling, not of prompt format.
- **Don't rely on the LLM to self-cite in natural language.** Self-citation is just hallucination with extra steps.
- **Don't add a second LLM to verify the first.** Doubles cost, doubles latency, and the verifier hallucinates too. A deterministic check is strictly better.
- **Don't use logprobs / token probabilities to detect hallucination.** Probabilities don't say "this number is wrong," they say "this number is plausible." A plausible-but-wrong macro number is exactly the failure mode we're guarding against.

### Storage

The guardrail's audit trail is persisted to `q1_agent_runs`:

```sql
q1_agent_runs (
    run_date, prompt_version, model_id,
    input_snapshot JSONB,    -- frozen L0-L4 inputs
    raw_output JSONB,        -- raw LLM response
    citations JSONB,         -- [{text, source, value}] — every claim
    verified BOOLEAN,        -- did the guardrail accept?
    retries INT,             -- how many retries before accept/fallback
    duration_ms INT
)
```

This is the data layer that powers the L7 provenance UI (see [ADR-0010](0010-citation-footnotes-everywhere.md)). The backend check and the UI rendering share the same `citations` table — the reviewer sees exactly what the guardrail saw.

## Consequences

### Positive
- Numeric hallucination in the Q1 thesis is structurally blocked
- The audit trail is reproducible — same input, same accept/reject decision, same fallback behavior
- The system never returns a blank slate — fallback ensures 10 picks are always produced
- The citation infrastructure (q1_agent_runs.citations) is shared with the L7 provenance UI, so backend and frontend speak the same language

### Negative
- The regex/value-comparison logic can false-positive on numeric-looking strings that aren't data (e.g., "Fed raised by 25 basis points" — "25" is a number but the citation can resolve). Mitigated by only enforcing citations for numbers in the thesis sentence structure, not free text.
- The 2-retry limit is conservative. A more aggressive agent might benefit from 3-5 retries. But too many retries = latency = risk that the cron job doesn't finish before market close.

### Neutral
- The citation format is LLM-friendly (`[source: macro_snapshot.DGS10]`) but a human could read it too. No proprietary syntax.
- The guardrail is part of the L5 agent, not a separate service. Single deploy unit.

## Alternatives considered

### Prompt-only defense ("just tell the LLM not to hallucinate")
What it was: a system prompt that says "Do not fabricate numbers. If you don't know, write N/A."
Why we rejected: doesn't work. The failure mode of an LLM is not knowing what it doesn't know. A prompt instruction is a prior, not a check.

### LLM-as-judge verification
What it was: a second LLM call that reads the thesis and flags un-cited numbers.
Why we rejected: 2× the cost, 2× the latency, and the judge hallucinates too. A deterministic check is strictly superior in cost, speed, and auditability.

### Allow numeric claims without citations, but log them for review
What it was: don't reject; just record un-cited numbers in a "needs review" field.
Why we rejected: shifts the audit burden to the human reviewer. The whole point of the guardrail is to make the system self-auditing.

### Compare the LLM's numbers against external data (Yahoo Finance, FRED API) at runtime
What it was: instead of comparing to the input snapshot, re-fetch the data and compare.
Why we rejected: introduces a non-determinism (data drift between the run and the verification) and a network dependency. The input snapshot is the source of truth; if the snapshot is wrong, the system has a bigger problem than a single LLM output.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §14.8 (verify_citations)
- Implementation: `backend/services/q1_agent.py` → `verify_citations` and `fallback_picks` nodes
- Storage: `q1_agent_runs.citations` JSONB column
- Related: [ADR-0010](0010-citation-footnotes-everywhere.md) (UI rendering), [ADR-0013](0013-deterministic-stochastic-split.md) (L0-L4/L5 split)
