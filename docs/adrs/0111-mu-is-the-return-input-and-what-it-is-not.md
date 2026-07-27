# ADR-0111: μ is the return input, and here is plainly what it is not

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md), [ADR-0110](0110-crowding-caps-what-it-can-see.md), [ADR-0032](0032-edge-carry-value-abstention-sizing.md), [ADR-0066](0066-not-computable-must-persist-as-null.md), [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md)

## Context

Bar 1 in `docs/GOAL.md` names four sizing inputs — vol, conviction, crowding, **upside** — and says of the fourth: *"The fourth does not exist: `price_target`, `expected_return`, `upside_pct` appear nowhere in `backend/`, `frontend/lib/`, or `scripts/`."*

That was true when written. It is now half-true, and the half matters.

`expected_returns.build_mu` ([ADR-0108](0108-expected-returns-are-constructed-not-assumed.md)) produces `optimizer_result.mu` — **the only per-name number in this system denominated in expected return**. A grep for `expected_return` now hits, where it did not before.

The temptation is to declare bar 1's fourth input satisfied. It is not, and recording why is worth more than the claim would be.

## Decision

**μ is the book's return input. It is not an upside view, and every surface that names it says so.**

What μ is, exactly:

```
μᵢ = IC × σᵢ × zᵢ        z scaled, not demeaned
```

Its per-name cross-sectional content is `sign(direction) × |EdgeScore| × σᵢ`, scaled by one global scalar `IC`. So:

- It **is** denominated in annualised return, and it **is** what the optimizer trades off against variance. That is a real input, doing real work — a weak IC shrinks it toward zero and the book becomes closer to minimum-variance, which is the correct response to weak evidence arriving automatically.
- It **is not** a view about how far a name can travel. Two names with identical `|EdgeScore|` receive μ in proportion to their **volatility**, not to any assessment of their potential. It converts a rank into return units; it adds no information that was not already in "how strongly does EdgeScore like it" and "how volatile is it".

The practitioner's *upside* means: what is this worth if I am right? A price target, a fair value, an expected move specific to the name and independent of both its rank and its vol. **Andromeda has no source for that** — no fundamentals feed, no analyst estimates, no valuation anchor. `edge_signals.py` already says as much for the equity/FX/commodity legs of the Value component: *"valuation is not in the L0 snapshot."*

So: **bar 1's fourth input is satisfied in units and not in substance, and that stays on the register.**

## Why not fill it with a proxy

Three candidates were considered and rejected.

**Have L5 emit an expected move.** The citation guardrail exists precisely because model-authored numbers cannot be trusted ([ADR-0012](0012-citation-guardrail-llm-defense.md)), and the `reason_picks` prompt already forbids the model from stating sizes. A fabricated target that sized a real position is the worst version of the failure this repo is built to prevent. The guardrail could check a number against a source, but there is no source — so it would be checking a fabrication against nothing.

**Use the S5 melt-up scenario's per-position P&L.** `base_asset_shocks` carries hand-set magnitudes (ARKK +25%, SVXY +18%) that look like upside. They are authored constants conditional on one scenario, not measurements, and they are not probability-weighted. Sizing on them would give the appearance of a fourth input while adding only the scenario author's priors — and would quietly make a stress-test calibration into a return forecast.

**Use `ma_context.pct_from_ma`.** It is per-name, forward-facing and already computed, which makes it the most tempting. It is also **backwards** for this purpose: the module documents it as distance-to-disqualifier — *"NOC 1.2% above its MA is a trade about to be disqualified; ARKK 18% above is not."* A large value means far from being wrong, not far to run.

The pattern in all three is the same, and it is the failure [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md) names: **a proxy that makes a gap look closed is worse than the gap**, because the gap is visible and the proxy is not.

## Consequences

**`GOAL.md` bar 1 is updated rather than ticked.** The third input is wired ([ADR-0110](0110-crowding-caps-what-it-can-see.md)); the fourth is recorded as *addressed in units, absent in substance*, with the specific data that would close it named: a fundamentals or estimates feed carrying a per-name valuation anchor.

**The claim in bar 1 that `expected_return` appears nowhere is now stale**, and the ADR record should not pretend otherwise. It appears in `optimizer.py` as a book-level scalar and in `optimizer_result.mu` as a per-asset dict. Both are this construction, not a target.

**Nothing about how μ is built changes.** ADR-0108 stands: IC read from `backtest_results` and never defaulted, renormalised over the components actually testable, shrunk 50%, and a non-positive composite yields no μ at all rather than a flipped one.

**This is the cheapest of the four bars to answer honestly and the least satisfying to answer.** It closes with a documented absence rather than a feature, which is this repo's standing move ([ADR-0066](0066-not-computable-must-persist-as-null.md), ADR-0094, ADR-0097) and is the right one here: a reader who is told the book sizes on four inputs, one of which is a rank wearing return units, can price that. A reader told it sizes on four inputs cannot.
