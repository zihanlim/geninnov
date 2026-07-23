# ADR-0027 — Citation guardrail grounds on value, not source-label exactness

- Status: accepted
- Date: 2026-07-23
- Tags: llm, guardrail

## Context

ADR-0012/0019 built the citation guardrail around **exact source keys**: a cited
number had to name a key in the frozen L0–L4 snapshot (`^VIX`, `BAMLH0A0HYM2`,
`theme:<id>:hype`, `var_95`) and match that key's value. In practice a strong,
correctly-reasoning model (MiniMax-M3) produced a full, well-cited 10-pick book
whose numbers were all **genuinely from the inputs** — VIX 16.64, HHI 2500,
scenario −12.33%, correlations +0.91 — but labelled the sources with human
category names (`"L3 regime classification"`, `"Scenario analysis"`, `"Cap
violations"`) instead of the exact keys. Every such citation was rejected as an
"unrecognised source key", so a fully-grounded book fell back to the
deterministic template on a pure formatting technicality.

The guardrail's real purpose (ADR-0012) is *no hallucinated numbers* — that
every figure is grounded in the L0–L4 inputs. Source-label exactness is a proxy
for that, and an over-strict one.

## Decision

`verify_citations` accepts a cited number when **either**:
1. its source key resolves in the snapshot and the value matches within
   tolerance (ADR-0019 exact reconciliation, unchanged); **or**
2. the value is **grounded** — it matches, within a tight tolerance, some number
   the model was actually shown across the macro / regime / theme / risk /
   book-metrics / scenario surfaces (`_collect_known_values`).

A number that appears **nowhere** in the inputs is still rejected — that is the
hallucination the guardrail exists to catch. Regime fields are also added as
explicit `regime:<field>` source keys.

## Consequences

### Positive
- A correctly-valued book is no longer rejected for using a descriptive source
  label. The guardrail now enforces its actual intent: numbers are grounded.
- Provider-robust — works for any model regardless of how precisely it echoes
  source keys.

### Negative
- Slightly weaker than exact key-matching: a number cited under the "wrong"
  label still passes if that number happens to be a real input value. The tight
  tolerance (±1%, min ±0.02) makes coincidental matches unlikely, and the
  anti-hallucination guarantee (value must exist in inputs) is preserved.

## Alternatives considered

- **Force exact keys via prompt / structured schema.** Fragile across models and
  still brittle; grounding is the more robust contract.
- **Accept any cited number.** Rejected — removes the anti-hallucination guarantee.

## Links
- `backend/services/q1_agent.py` (`verify_citations`, `_collect_known_values`,
  `_value_is_grounded`), ADR-0012, ADR-0019
