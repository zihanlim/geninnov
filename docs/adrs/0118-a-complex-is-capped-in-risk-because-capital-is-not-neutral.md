# ADR-0118: A complex is capped in risk, because a capital cap is not neutral between instruments

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md), [ADR-0048](0048-count-independent-ideas-not-candidates.md), [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md), [ADR-0110](0110-crowding-caps-what-it-can-see.md), [ADR-0111](0111-mu-is-the-return-input-and-here-is-what-it-is-not.md), [ADR-0115](0115-a-complex-is-one-idea.md), [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md) (reverted)

## Context

[ADR-0115](0115-a-complex-is-one-idea.md) capped a correlation complex at one name's worth of **capital** and said the covariance would split it. [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md) tried to make that true by adjusting `mu`, shipped, and was reverted the same day. Both failed the same way, and the third attempt is only worth making because the second one's failure identified *why*.

`mu = IC × σ × z` ([ADR-0111](0111-mu-is-the-return-input-and-here-is-what-it-is-not.md)). Under a cap denominated in **capital**, there are only two things to do with the members' `mu`, and both produce a corner:

| adjustment | who wins | measured |
|---|---|---|
| average `mu` | the **lowest**-vol member — it gets a high-vol member's return at its own risk, a Sharpe no instrument has | live book gross 58.4% → **98.8%**, three substitutes pinned to the single-name cap |
| average the signal `z` | the **highest**-vol member — at equal Sharpe it delivers the most return per unit of *capital* | SVXY took **0.19999988**, the entire complex |

Neither is the covariance "deciding" anything. **Both are artifacts of what the cap constrains.** A capital cap asks "how many dollars may this idea hold?", and the answer is not invariant to how volatile the instrument holding them is.

## Decision

**Cap the complex's standalone risk, in addition to its capital.**

```
|| Σ_C^½ · w_C ||₂  ≤  B
```

A second-order cone, so mean-variance stays a QCQP and the two scenario LPs become SOCPs — cvxpy solves both. Deliberately **not** an Euler contribution, which divides by the whole book's σ and is not convex.

**Why this is neutral where capital is not.** Holding member *i* alone at budget *B* takes weight `B/σᵢ` and returns `(IC·σᵢ·z̄)·(B/σᵢ) = IC·z̄·B` — the **same for every member**. No member can dominate on cost of expression, because there is no longer a cost of expression to dominate on. The optimizer is genuinely indifferent, which is the truth: they are the same bet.

**And then the residual correlation decides, in the right direction.** Spreading across two members returns `2B/√(2+2ρ)` against `B` for one, so spreading strictly wins, and wins by more the *less* correlated the members are:

| ρ | one name | split across two |
|---|---|---|
| 0.99 | 1.0000·B | 1.0025·B |
| 0.90 | 1.0000·B | 1.0260·B |
| 0.70 | 1.0000·B | **1.0847·B** |

That is the basket [ADR-0115](0115-a-complex-is-one-idea.md) wanted, arrived at without a hardcoded table of which instruments are sound.

**Added, never substituted.** The capital cap stays. A very low-vol complex would otherwise satisfy a risk budget at an enormous weight — `B/σ` is large when σ is small. Both must hold, so this can only ever *tighten*, which is [ADR-0110](0110-crowding-caps-what-it-can-see.md)'s rule.

**The budget scales with the BOOK's median vol, not the complex's own.** Scaling it with the complex's members would hand a complex of levered instruments a *bigger* risk budget for being volatile, which is precisely backwards. `max_complex_risk_mult` defaults to `MAX_SINGLE_NAME_WEIGHT`, so the sentence it encodes is "one idea may take the risk one typical position may."

**Signal equalisation ships with it and only with it.** `equalise_signal_within_complexes` divides σ out of `mu`, averages, and multiplies it back, so every member sits on one Sharpe. Without it the optimizer ranks members on EdgeScore, which at ρ 0.99 is noise. Without the *risk* cap it favours the levered member. `test_a_capital_cap_alone_would_favour_the_levered_member` pins that half so the pairing cannot be quietly broken.

**A one-member complex is exempt.** It is already governed by the single-name cap, and a risk cap would tighten a standalone name for the accident of being clustered with nothing.

## Consequences

**Verified on the live book before commit, which is the process change.** [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md) was committed on unit tests and a plausible argument, and a read-only dry run against the published picks found it moved gross by 40 points. That dry run now runs first. Under this ADR, on the 2026-07-27 picks: gross 58.4% → **54.7%**, no position moves more than **1.5pp**, nothing dropped, nothing added, and the only binding constraint is the US geo cap.

**On today's book the risk cap does not bind, and that is the honest result.** L5 holds one member per complex, so no complex is risk-concentrated. The constraint is latent — it binds the day a complex becomes concentrated, which is the day it is wanted. A cap that binds on nothing today is not evidence that it does nothing.

**It reports itself.** A bound risk budget shows the complex sitting visibly *below* its capital cap, which a reader would otherwise read as slack. `binding_constraints` names it with both numbers: the standalone vol and the budget.

**`_psd_sqrt` uses `eigh`, not Cholesky.** A complex is near-singular *by construction* — members correlated at 0.70 or above, on the live book 0.99 — which is exactly the input Cholesky raises on. `test_survives_the_singular_matrix_it_is_always_given` asserts Cholesky fails on that matrix and this does not.

**Solves are ~3× slower** (backend suite 55s → 268s). The SOC constraints are the cost. Acceptable for a once-daily job; it would not be for a request-time path.

**What this does NOT restore.** [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md)'s other half — offering the optimizer every pool member of a complex rather than only the names L5 listed — stays reverted. The risk cap is what would make that widening *safe*, and the two tests here show the mechanism now behaves. But re-landing it changes which instruments appear in the published book, and it needs its own dry run against its own numbers. This ADR buys the precondition, not the feature.

**The cap-breach defect logged in ADR-0116 is still open.** `_round_weights` floors single-name magnitudes; nothing floors a GROUP sum, and a complex total was measured 3.3e-6 over its cap, past `CAP_EPSILON`. Unrelated to the risk cap and not fixed here.
