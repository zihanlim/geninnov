# ADR-0124: A comment doing a test's job is how the defect survived

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0066](0066-not-computable-persists-as-null.md), [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0114](0114-svxy-stress-signs.md), [ADR-0120](0120-the-guard-reads-the-taxonomy-not-just-the-book.md), [ADR-0122](0122-a-tickers-identity-lives-in-six-tables-and-none-agreed-to-agree.md)

## Context

Asked whether the taxonomy consolidation was the right fix for 2026-07-27's four SVXY defects, the honest audit said no: consolidation would have prevented **one** of the four (the developer missing a second edit site). The other three were *a single wrong value that nothing validated*. The highest-value move was therefore another validation, not the consolidation.

The corrected S1 entry for SVXY carries this comment:

> Measured beta_mkt is +2.08 (R2 0.68), and this scenario's own description is a −15 to −25% SPX drawdown, so the factor path implies about −37%; −0.35 is that, held slightly conservative.

That comment **does the arithmetic that would have caught the original defect** — `+0.20` stated against `2.08 × −0.18 ≈ −0.37` implied, opposite signs, 0.57 apart. It existed only as prose, written *after* the defect was found by hand. A scenario's `factor_shocks` and its `base_asset_shocks` are two statements the same module makes about the same event, and nothing compared them.

## Decision

**`check_scenario_overrides_reconcile`: a direct asset shock may not violently contradict the scenario's own factor path.**

It flags only when **the signs disagree AND the gap is ≥ 0.25**. Both conditions are load-bearing:

- **Same-sign gaps of any size are views.** Overrides exist to express what beta cannot see — QQQ hit harder than its beta implies, S6's sector-transmitted shocks dwarfing its small mkt shock ([ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md)). Magnitude is the override's job.
- **Small sign-crossing gaps are channels.** GLD catching a flight-to-quality bid in a selloff (implied −0.01, stated +0.05) and S2's XLE (rising rates alongside strong energy, gap 0.07) are the mechanism working. Forbidding them would forbid the feature.

What remains is the SVXY shape: the override asserting the book *gains* from the event its own beta says destroys it.

**The gap threshold is a judgement, calibrated against the known failures and said plainly.** Pre-fix entries sat at 0.57 (S1) and 0.32 (S4); the largest legitimate sign-crossing override is 0.07. 0.25 separates them with margin both ways, and a test pins values just under and just over so a re-tune shows in a diff. This is the third guard in two days calibrated this way, and the caveat travels with all of them: **tuned to catch what was already found is not the same as catching what is there.** The alternative — no guard — is worse, but the false-negative rate is unknown and this ADR says so rather than presenting the threshold as derived.

**A scenario with no `mkt` shock is exempt** — no factor path, nothing to reconcile. A ticker absent from `DEFAULT_TICKER_BETAS` is skipped, never assumed ([ADR-0066](0066-not-computable-persists-as-null.md)).

**CI is the primary enforcement; the nightly guard is the backstop.** Both sides are code constants, so the natural failure point is a PR, and `test_the_live_scenarios_are_clean` binds the real `SCENARIOS` against the real betas at test time. The guard runs the same function nightly for the edit that never ran the tests.

## Consequences

**Both pre-fix entries fire; the live tables are clean.** Verified under the production invocation, and the regression tests carry the defects — `+0.20` and `+0.15` — not the fix.

**The consolidation is deferred, and its precondition is now verified.** Nothing mutates `SECTOR_MAP`, `GEO_MAP` or `_ASSET_CLASS_MAP` at runtime (grepped for subscript-assignment, `update`, `pop`, `del` — zero hits outside tests), so deriving the three as views of one `AssetRecord` table is safe when it happens. It ranked below this check because it prevents one defect class (missed edit sites) while this prevents the class that produced three of four actual defects (a wrong value nothing validated).

**The self-consistency principle, stated once:** where one module makes two statements about the same event — a factor path and an override, a class and a beta, a lens and a class — the disagreement is checkable *without any new data*. Every guard added since [ADR-0120](0120-the-guard-reads-the-taxonomy-not-just-the-book.md) is this pattern. When a comment near a constant explains *why the number is what it is* by arithmetic, that arithmetic is a check waiting to be written, and leaving it as prose means the next wrong number gets a comment too.
