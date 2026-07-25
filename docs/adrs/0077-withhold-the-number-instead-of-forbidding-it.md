# ADR-0077 — Withhold the number instead of forbidding its use

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0071](0071-pool-metrics-are-not-book-metrics.md), [0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md), [0075](0075-per-pick-betas-are-joined-not-authored.md), [0049](0049-the-guardrail-does-not-read-the-prose.md)

## Context

Three ADRs have now been written about the same block of the `reason_picks` prompt:

- [ADR-0071](0071-pool-metrics-are-not-book-metrics.md) — the block was headed `=== BOOK
  METRICS ===` but computed on the equal-weighted pool before selection. Relabelled it, and
  forbade cap-breach claims drawn from it.
- [ADR-0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md) — the tilts were
  still being restated as the book's. Added a prohibition and a guard.
- [ADR-0075](0075-per-pick-betas-are-joined-not-authored.md) — the per-pick field was being
  filled from the same aggregate. Joined the real betas instead.

Reading `format_book_metrics_summary` explains why the first two did not hold. **The
function prepends its own header**, two lines below the one ADR-0071 rewrote:

```
=== CANDIDATE-POOL METRICS — EQUAL-WEIGHTED, BEFORE YOUR SELECTION ===
These describe the SCREENED POOL you are choosing from … They are NOT the book's metrics.
… NEVER state them as the book's own composition, and never claim a cap breach from them
=== BOOK METRICS (computed, not estimated) ===        ← this function
  Book factor tilts: Mkt=-0.02 SMB=+0.18 HML=+0.27 …  ← this function
  ⚠ CAP VIOLATIONS: US 66.67% — 31.67pp over its 35% cap
```

**The correction was contradicted inside the same block, by the string it was
correcting** — and the contradicting version was the one attached to the numbers. The model
was told these were the pool's in prose and the book's in a header, twice, and it believed
the header. That is the whole history of ADR-0071 and ADR-0073: the published thesis said
*"market-neutral (Mkt −0.02)"* for a book at **Mkt −0.50**, and *"US at 66.67% versus the
35% cap (31.67pp over)"* for a book with **no violations at all**. Both figures are printed
verbatim, under those labels, by this function.

## Decision

**Stop handing over the two numbers that have no legitimate use here.** A caveat competes
with a number, and the number wins.

| removed | why it is not a loss |
|---|---|
| the **factor-tilt row** | A pool-average tilt has no decision value for *choosing* picks — it is the average of the things the model is about to select among. Its only demonstrated use across three ADRs was being copied into the thesis as the book's. |
| the **`⚠ CAP VIOLATIONS` row** | Caps are enforced by the sizer *after* selection, so a breach computed on 30 equal-weighted candidates is not a fact about any book. What the model legitimately needs from it — which complexes are crowded — is the sector/geo share rows, which stay. |

What remains is renamed to say what it is at the point of use: `Pool gross`, `Pool sector
share`, `Pool geo share`, under `--- (pool, equal-weighted, pre-selection) ---`. The
correlation-pair warnings stay: those are computed on real tickers and are the model's
input for not doubling an idea ([ADR-0048](0048-count-independent-ideas-not-candidates.md)).

The prohibitions from ADR-0071 and ADR-0073 stay in the template. They now defend against
the model *aggregating* the per-asset L2 factor table itself, rather than against it copying
a row it was handed.

## Consequences

- **You cannot restate a number you were never given.** This is the structural version of
  what ADR-0071 and ADR-0073 attempted with instructions, and it is the reason to prefer it:
  two rounds of prohibition did not survive contact with a contradicting label sitting next
  to the number.
- **The guards stay.** `check_factor_tilt_claims` and `check_cap_breach_claims` still run —
  removing the input reduces the chance, and the check is what makes it a verdict. A model
  can still invent a tilt.
- **Slightly less context for the model.** A pool-level tilt could in principle inform a
  choice ("the pool is already value-heavy"). Measured against three published falsehoods
  traceable to that same row, the trade is worth making, and the per-asset factor table is
  still in the prompt if the model wants to reason about exposure.
- **The general lesson, which is the point of writing this down:** when a model misuses a
  figure, the first question is whether it needed the figure. Two ADRs went to relabelling
  and prohibiting before anyone asked.
- **Takes effect on the next run.** The book published before this change still carries the
  claims; the guard reports them until then.
