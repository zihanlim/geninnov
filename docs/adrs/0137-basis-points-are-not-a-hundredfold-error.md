# ADR-0137: Basis points are not a hundredfold error

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0019](0019-citation-value-reconciliation.md), [ADR-0027](0027-citation-value-grounding.md), [ADR-0091](0091-breadth-must-be-a-share-of-something-named.md), [ADR-0098](0098-timestamp-roles.md)

## Context

The 2026-07-28 pipeline run logged:

```
[verify_citations] tolerated 2/42 ungrounded citations (95% grounded,
e.g. Cited value 279.0 does not match source 'BAMLH0A0HYM2'=2.79 ...)
```

**The model was right.** 279 basis points *is* the high-yield OAS; FRED serves `BAMLH0A0HYM2` in percentage points, so the same quantity is stored as `2.79`. The guardrail compared 279 against 2.79, found a hundredfold gap, and called it ungrounded.

Worse than a naive check: **the prompt asks for exactly the form the verifier rejects.** Its worked example is

```json
{"text": "HY OAS at 380bps", "source": "BAMLH0A0HYM2", "value": 380.0}
```

against a series that stores ~3.80. A model following the instruction precisely produces an ungrounded citation every time. The two survived only because they fell inside the 20% ungrounded allowance — which means the guardrail's tolerance budget was being spent on its own contradiction rather than on real model error.

The frontend has reconciled this since `formatSlopeBps`, whose comment already records that *"yield_curve_slope and hy_oas are persisted in PERCENTAGE POINTS... the curve is quoted in basis points"*. The backend never learned it. This is the same unit confusion [ADR-0091](0091-breadth-must-be-a-share-of-something-named.md) found in the regime classifier, in a different layer.

## Decision

**Accept a basis-point citation against a percentage-point source — for spreads only.**

`BPS_QUOTED_SOURCES` declares, per series, that bps is the market's quote convention:

| Source | Why |
|---|---|
| `BAMLH0A0HYM2` | high-yield OAS — a credit spread |
| `BAMLC0A0CM` | investment-grade OAS |
| `T10Y2Y`, `yield_curve_slope` | 10y−2y slope — a spread between two yields |
| `hy_oas` | the regime layer's label for the same series |

**The rule is spreads, not levels**, and that distinction is the entire safety argument. A spread is a difference between two yields and is universally quoted in bps — *"HY at 279 over"*. A yield **level** is quoted in percent — *"the ten-year at 4.69%"* — and nobody says "469bps". So `DGS10`, `DGS2`, `DFII10`, `T10YIE` and `VIXCLS` are deliberately absent, and for them a claim 100× the source still **fails**.

This matters because the obvious implementation is the wrong one. A blanket "also try ÷100" would accept a genuine order-of-magnitude error on **every** series in the snapshot — turning the guardrail that exists to catch fabricated magnitudes into one that waves them through. What is added here is not a wider tolerance; it is a **per-source declaration of a domain fact**, and each entry carries its reason so a careless addition has to argue for itself.

**The prompt is fixed too.** Leaving the check to absorb a contradiction the instruction creates would be treating the symptom: the model is now told the series are served in percentage points, that either form reconciles for a spread, and that a yield level must be cited as `4.69`, never `469`.

**A reconciliation is reported, not silent.** `verify_citations` collects every citation accepted only after conversion and prints them. An accepted conversion and an exact match are different events, and a wrong entry in `BPS_QUOTED_SOURCES` would otherwise be invisible.

## Consequences

- **Replayed against the live run: exactly the two tolerated citations now pass** — `BAMLH0A0HYM2` (279 vs 2.79) and `BAMLC0A0CM` (80 vs 0.8), both spreads. Source-key matches went 19 → 21 on that run's citations, and the ungrounded allowance is freed to catch real error.
- **The 20% tolerance was masking this.** Two of 42 is comfortably inside it, so the contradiction never failed a run and never got looked at — it surfaced only because a log line was read closely. A budget for tolerated failures hides small systematic ones by design; that is the cost of having one, and it is worth restating rather than removing.
- **The conversion is one-directional and narrow.** `2.79` cited against `BAMLH0A0HYM2` still passes as an exact match; `279` now also passes. Nothing else changed about how citations are checked.
- **`T10Y2Y` is declared but currently unexercised** — the snapshot carries `DGS10`/`DGS2` and the classifier computes the slope, so a citation keyed on `T10Y2Y` may not arise. Included because the slope is a spread and the alias `yield_curve_slope` does appear; listing it now is cheaper than diagnosing it later.
- **Not fixed: the stored unit itself.** These series remain in percentage points, which is what FRED serves and what every existing consumer expects. Normalising storage to bps would be a schema-wide change touching the regime classifier, the frontend formatters and every persisted derivation — larger than this defect warrants, and it would break the one place that already handles it correctly.
- **The prompt change is unverifiable until the next run**, like every instruction to a model. The reconciliation is what makes that acceptable: correct behaviour is now accepted whether the model quotes the spread in bps or in percent.
