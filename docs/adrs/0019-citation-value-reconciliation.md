# ADR-0019 — Citation guardrail reconciles cited values, not just source keys

- Status: accepted
- Date: 2026-07-23
- Tags: llm, guardrail, security

## Context

The L5 citation guardrail (ADR-0012) is meant to stop the LLM inventing macro numbers. But `verify_citations` only checked that a citation's *source key* existed in the L0–L4 snapshot — it computed the source value and never compared it to the number the LLM cited. A claim like "HY OAS at 380bps" citing the valid FRED ID `BAMLH0A0HYM2` passed even when the real value was 320. The flagship anti-hallucination defense was, in effect, checking spelling, not facts.

## Decision

`verify_citations` now reconciles each cited value against the source value within tolerance `max(0.01, 2% × |actual|)`. The claimed value is the citation's explicit `value` field when present, else the sole number parsed from the citation text (ambiguous / value-less citations with a valid source are accepted). A recognised source key whose value is out of tolerance is rejected → retry `reason_picks` → deterministic fallback, exactly like an unrecognised key.

## Consequences

### Positive
- Value hallucinations on valid sources are now caught — the guardrail has teeth.
- The tolerance band absorbs benign reporting drift (e.g. 320 vs 324 bps).
- Deterministic (dict lookups + arithmetic); no LLM-in-the-loop cost, preserving ADR-0012's rationale.

### Negative / Limitations
- Scope is the top-level `citations` list (unchanged). Per-pick citations are still unverified — a follow-up.
- A citation that declares a value matching its source but whose *prose* describes a different quantity (a source-selection error) is not caught without semantic understanding — documented in the function.
- Derived-quantity citations must declare the raw source value (not the derived number) to pass.

## Alternatives considered

- **Strict text-number == source.** Rejects legitimate derived-quantity citations (e.g. "VIX term diff -2.1" citing the raw VIX3M level). Too brittle.
- **LLM-as-judge value check.** Doubles cost/latency for no gain over deterministic reconciliation — already rejected in ADR-0012.

## Links
- ADR-0012 (citation guardrail), `backend/services/q1_agent.py` (`verify_citations`, `_citation_claimed_value`)
