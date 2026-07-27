# ADR-0123: A group cap is projected onto, not declared close enough

**Status:** Accepted
**Date:** 2026-07-27
**Closes:** the defect logged as open in [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md) and again in [ADR-0118](0118-a-complex-is-capped-in-risk-because-capital-is-not-neutral.md)
**Related:** [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md), [ADR-0068](0068-a-cap-breach-must-not-be-decided-by-float-error.md), [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md)

## Context

`_round_weights` **floors** each magnitude toward zero rather than rounding it, so a stored weight never exceeds the solved one. That was written for a single name and works: it absorbs the ~1e-8 a convex solver leaves behind.

It cannot fix a **group**. Flooring three weights removes at most 3e-8, while the solver satisfies a *summed* constraint to its own feasibility tolerance. Measured on the 2026-07-27 run:

```
complex total: 0.20000334   against a 0.20 cap
```

**3.3e-6 over** — three hundred times what flooring can reach, and three orders of magnitude above `book_metrics.CAP_EPSILON` (1e-9), which is what `exceeds_cap` uses to decide whether a limit has been breached. So `/risk` could report a governance violation on a book the optimizer had solved correctly, which is precisely what [ADR-0068](0068-a-cap-breach-must-not-be-decided-by-float-error.md) exists to forbid.

It was logged as open twice — in [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md) and again in [ADR-0118](0118-a-complex-is-capped-in-risk-because-capital-is-not-neutral.md) — without being fixed, because it looked cosmetic next to whatever else was being built. It is not cosmetic: it is a published risk limit disagreeing with the published book.

## Decision

**Project the weights onto the cap after solving.** `_project_group_caps` scales any group whose total overshoots back onto its limit, for all three groupings (sector, geography, correlation complex).

**Loosening `CAP_EPSILON` to swallow it was rejected.** Its own comment says it is "a representation-error guard, NOT an economic tolerance … deliberately unlike a fitted threshold, which ADR-0047 warns is a statement about the day's numbers rather than about the rule." Widening it from 1e-9 to something that absorbs 3.3e-6 would make it exactly the fitted thing it disclaims — and would silently permit a real 3bp breach on a book where the solver happened to be exact. **The book should satisfy the limit, not be declared close enough to it.**

**Each name takes the strictest scale any of its groups demands, in one pass.** Scaling down can only reduce every other group's total, so a single pass is sufficient and conservative: it may land a little *under* a cap, never over. Magnitudes only shrink, so the single-name caps and the gross budget stay satisfied without re-checking, and no sign moves.

**Re-floored afterwards.** The multiply reintroduces digits past the 8dp the stored book carries.

**It reports itself** in `warnings`, naming the group, the pre-projection total at full precision, and the cap. A silent rescale would be the renormalisation [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md) forbids wearing a different hat.

## Consequences

**A compliant group is bit-identical.** No rescale, no rounding drift, nothing to explain — `test_a_compliant_group_is_bit_identical` pins that, because a projection that perturbed a book already inside its limits would be a worse defect than the one it fixes.

**The end-to-end test now asserts at `CAP_EPSILON`, not at 1e-4.** The existing complex-cap tests used a 1e-4 tolerance, which is a hundred times looser than the breach and would never have caught it. A test whose tolerance exceeds the defect it is meant to detect is decorative.

**Stored weights are now the solver's output projected, not the solver's output.** They differ by at most the overshoot, and only when there was one. Worth stating because [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md) says the optimizer's answer is the book — that remains true up to a projection which can only tighten.

**What it does not fix.** The *risk* cap ([ADR-0118](0118-a-complex-is-capped-in-risk-because-capital-is-not-neutral.md)) is a second-order cone, not a linear sum, so it cannot be projected by scaling a group — the standalone-vol constraint is checked at 1e-4 in `binding_constraints` and is not re-projected here. It has not been observed to overshoot; if it does, the same reasoning applies and the arithmetic is different.

**The lesson worth keeping.** Twice this was written down as known and left, because it was three decimal places small next to the feature being built. The size of a number is not the size of the defect: a published book breaching a published limit is a governance claim, at any magnitude.
