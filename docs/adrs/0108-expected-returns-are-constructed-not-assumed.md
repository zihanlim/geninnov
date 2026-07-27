# ADR-0108: Expected returns are constructed from a measured IC, not assumed

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md), [ADR-0031](0031-edge-score-direction-signal.md), [ADR-0033](0033-edge-stage5-sentiment-ic-weights.md), [ADR-0036](0036-carry-as-excess-yield-over-funding.md), [ADR-0044](0044-carry-ic-was-measured-on-a-superseded-signal.md), [ADR-0066](0066-not-computable-must-persist-as-null.md)

## Context

A mean-variance optimizer needs an annualised expected-return vector μ. Andromeda does not have one and never has.

What it has is **EdgeScore ∈ [−1, 1]** — a weighted blend of trend, regime fit, carry, value and a contrarian sentiment tilt. That is a *ranking* signal. It says QQQ looks better than TLT. It does not say QQQ will return 8%.

Handing EdgeScore to the optimizer as μ is a units error, and a quiet one: the objective `max μ'w − (γ/2) w'Σw` would trade a dimensionless score against an annualised variance, the risk aversion γ would mean nothing, and the resulting weights would be wrong in a way no test on the optimizer itself could detect — because the optimizer would be solving its problem correctly.

im-Jarvis sources its μ from `scenario_service`. There is no equivalent here to read across. This is the one piece of the port that had to be designed rather than translated.

## Decision

**Grinold–Kahn, with the IC read from the table that measures it.**

```
μ_i = IC × σ_i × z_i
```

Each term does distinct work:

- **`IC`** is the *measured* rank correlation between the signal and forward returns, read from `backtest_results` where `scripts/backtest_edge.py` writes it. **It is never defaulted.** A book sized on an assumed IC is a book sized on a wish.
- **`σ_i`** is the asset's annualised realised vol, from the same 252-day frame the covariance and the Euler decomposition use. It converts the dimensionless score into return units, which is what makes the resulting weights inverse-vol-like rather than score-like.
- **`z_i`** is the cross-sectionally standardised EdgeScore.

Four decisions inside that formula matter more than the formula:

**1. The composite IC renormalises over the components that were measured.** EdgeScore has five components; on 2026-07-24 three were testable (trend +0.033 at n=975, carry +0.127 at n=94, value +0.094 at n=94) and two — regime and sentiment — were not. Scoring an unmeasured component as IC 0 is not neutral: it drags the composite toward zero in proportion to how much of our signal we have not yet been able to *test*, penalising the book for a gap in our validation rather than for a weakness in the signal. So the blend weights renormalise over the measured set, exactly as `compute_edge_score` handles a not-computable component ([ADR-0036](0036-carry-as-excess-yield-over-funding.md) / [ADR-0066](0066-not-computable-must-persist-as-null.md)). A test pins `EDGE_COMPONENT_WEIGHTS` against `compute_edge_score`'s own defaults so the composite cannot become a weighted average of the wrong thing.

**2. The IC is shrunk 50% toward zero.** [ADR-0033](0033-edge-stage5-sentiment-ic-weights.md) already shrinks IC-fitted weights toward their priors on thin evidence. The same discipline applies to the IC itself, and here the prior is explicit: an unvalidated signal has no alpha. Raw +0.0745 becomes +0.0373.

**3. z is scaled, not demeaned.** The textbook cross-sectional z-score subtracts the mean. That is right when the standardised score also *chooses the side*. Here it does not — L5 has already chosen each name's direction and the optimizer pins it ([ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md)). Demeaning would give a below-average long a **negative** μ, pushing the optimizer to zero a position for the crime of being less attractive than its book-mates rather than because the signal dislikes it. Dividing by the cross-sectional dispersion alone standardises the magnitudes and leaves every sign as L5 set it.

**4. A non-positive composite IC yields no μ at all.** Not a flipped one. A composite at or below zero means the signal has no demonstrated predictive power, so there is no return forecast to give: `build_mu` returns nothing, the reason is recorded, and sizing falls back to conviction. Reading a weak negative IC as "the signal works, backwards" is fitting the noise, and it would invert every direction L5 chose.

Direction also wins over the sign of the edge where the two disagree. They agree by construction — L5 is constrained to a candidate set whose direction is `sign(edge_score)` — but if a fallback or a hand-edit ever breaks that, the position about to be sized is the fact and the score is the commentary.

## Consequences

**A weak IC produces a smaller book, automatically.** μ is linear in the IC, so halving it halves every expected return while the risk term is unchanged — and the objective leans on variance reduction. The correct response to weak evidence happens by construction rather than by anyone's judgement. It is ADR-0033's instinct expressed in the sizing rather than in the weights.

**And the evidence here is weak.** None of the three measured components clears conventional significance: p = 0.30 (trend), 0.22 (carry), 0.37 (value). The published book will be sized on a signal that has not demonstrated significance, halved. That is honest and it is better than a hardcoded μ, but it is not validation, and `backtest_results` already says so on `/method`. The `IcReading` persisted inside `optimizer_result` carries the components, the renormalised weights, the raw and shrunk values, the smallest N, and the `as_of` — everything a reader needs to discount it.

**The IC is fetched in `aggregate_context`, not in the sizing node.** It is an input to sizing, so it belongs in the frozen `input_snapshot` alongside the rest of L0–L4: a reviewer re-running the audit days later must see the number the optimizer saw, not whatever the panel reads today. This also keeps `size_positions` a pure function of state.

**Only the latest `end_date`'s rows are blended.** `backtest_edge.py` replaces rather than upserts, so the newest date holds the current reading; mixing a component measured last month with one measured today would report a composite belonging to neither.

**Unpriced names are reported, never zeroed.** A held name with no return history is excluded from μ and named in `dropped`, because it still carries real risk and the caller has to be able to say so ([ADR-0023](0023-unavailable-is-not-zero.md)).

**Measured effect on the live book (2026-07-25):** μ ranges from −2.16% (GDX) to +1.27% (UNH) annualised, with SHY at +0.04% — small numbers, correctly so, and the reason the optimizer declines to fund SHY at all.
