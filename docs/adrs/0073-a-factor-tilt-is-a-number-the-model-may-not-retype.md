# ADR-0073 — A factor tilt is a number the model may not re-type

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0071](0071-pool-metrics-are-not-book-metrics.md), [0049](0049-the-guardrail-does-not-read-the-prose.md), [0012](0012-citation-guardrail-llm-defense.md), [0066](0066-not-computable-must-persist-as-null.md)

## Context

[ADR-0071](0071-pool-metrics-are-not-book-metrics.md) established the ordering defect:
`compute_book_metrics_node` runs **before** `reason_picks`, over the **equal-weighted
screened pool**, so every figure in the prompt's metrics block describes a portfolio the
book is a subset of. It fixed the block's label and forbade *cap-breach* claims drawn from
it. The next run published a thesis with no false cap claim, and the guard went green.

**The same block was still being restated one field over.** The 2026-07-25 thesis closed:

> *"…factor tilts favoring value (**HML +0.27**) and quality (**RMW +0.35**) at
> **market-neutral (Mkt -0.02)**."*

Against the book's own persisted `book_metrics.factor_tilts`:

| stated | book | miss |
|---|---|---|
| HML +0.27 | **+0.3235** | 0.05 |
| RMW +0.35 | **+0.4252** | 0.08 |
| **Mkt −0.02** | **−0.5022** | **0.48** |

The first two are close enough to read as rounding. The third is not a rounding error and
is not a footnote: **the book's headline risk characterisation was wrong by 25x.** A book
at Mkt −0.50 is materially net-short the market — it makes money in a selloff and loses in
a melt-up — and the thesis told the reader it was market-neutral. Every number in the
sentence came from the pool block, correctly, and every one of them described a different
portfolio.

This is [ADR-0049](0049-the-guardrail-does-not-read-the-prose.md)'s rule arriving
at one more field: **a number the system computes should never be re-typed by the model.**
Sizes, weights, exposures and pool-depth counts are already on that list. Factor tilts were
not, purely because nobody had written a thesis that misstated one yet.

## Decision

**Factor tilts join the forbidden list, in the prompt and in the guard.**

1. **The prompt forbids the restatement, and says what it costs.** The pool block now
   carries an explicit prohibition on re-stating any of Mkt, SMB, HML, RMW, CMA, UMD as the
   book's, and on calling the book market-neutral / net-long / net-short from them, naming
   the live −0.02 → −0.50 miss as the reason. The model is told to describe the
   **direction** of its tilt in words ("value-tilted", "short duration") and that the page
   prints the measured numbers beneath it.

2. **`check_factor_tilt_claims` verifies it against the persisted book.** It scans
   `book_view` and `book_risks` for a factor name followed by a number, and compares each
   against `book_metrics.factor_tilts`. Tolerance is **0.05 in beta units** — deliberately
   loose, because the target is a figure describing a *different portfolio*, not a rounded
   one. The live miss was 0.48; on that tolerance the sentence flags Mkt, HML and RMW and
   the guard exits 1.

Four properties worth pinning:

- **The gap between name and number excludes digits**, so the scan cannot leap over an
  intervening figure and attribute a stranger's number to a factor.
- **One flag per factor**, however many ways the prose names it (`Mkt`, `market beta`).
- **A null tilt is never checked.** Absence is not a value
  ([ADR-0066](0066-not-computable-must-persist-as-null.md)) — an unmeasured factor cannot
  be contradicted.
- **Correct citation stays legal.** A thesis that says *"net short the market (Mkt −0.50)"*
  passes. The rule is against re-typing the *wrong* number, and the check must not push the
  agent into vagueness.

## Consequences

- **The guard fails on the current book, by design.** The 2026-07-25 thesis contains the
  claim, so `check_data_integrity` exits 1 until the next pipeline run publishes under the
  corrected prompt. That is the negative control ADR-0071's fix passed: a check that only
  ever passes has not been shown to detect anything.
- **The prohibition and the check are independent defences.** The prompt reduces the
  chance; the guard catches the case where it does not. Neither alone is sufficient —
  ADR-0071 had only the prompt, and the model complied with the letter of it while
  restating the adjacent field.
- **The ordering constraint is still open**, and this is now the second defect it has
  produced. `compute_book_metrics_node` runs before selection, so the agent has never
  seen its own book's metrics — it writes about a portfolio it cannot measure. Every fix
  so far has been a prohibition on describing the wrong portfolio rather than the ability
  to describe the right one. The structural repair is to recompute book metrics on the
  picks and give the agent a second pass; that is a larger change than a guard and is
  recorded here as the standing debt.
- **What a guard can and cannot check.** It verifies a stated tilt matches the measured
  one. It cannot tell whether the *characterisation* is apt — a thesis calling a book at
  Mkt −0.05 "market-neutral" states no number and passes.
