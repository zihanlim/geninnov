# ADR-0116: The optimizer chooses the instrument; the thesis argues the idea

**Status:** Accepted
**Date:** 2026-07-27
**Supersedes:** the "let the covariance decide the split" claim in [ADR-0115](0115-a-complex-is-one-idea.md) — its cap stands, its mechanism did not work
**Related:** [ADR-0048](0048-count-independent-ideas-not-candidates.md), [ADR-0053](0053-the-published-book-was-sized-by-hype.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md), [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md), [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md), [ADR-0111](0111-mu-is-the-return-input-and-here-is-what-it-is-not.md)

## Context

[ADR-0115](0115-a-complex-is-one-idea.md) capped a correlation complex at one name's worth of capital and said: *"the covariance decides the split."* That was written without measuring it. It is wrong.

`mu` is `sign x |EdgeScore| x sigma` ([ADR-0111](0111-mu-is-the-return-input-and-here-is-what-it-is-not.md)). Inside a complex the covariance is near-singular by construction — members are correlated at or above 0.70, and on the live book at 0.99, condition number 322. With a near-singular quadratic term, the linear term decides, and the linear term is EdgeScore. Measured on three names correlated at 0.989:

| mu difference | split |
|---|---|
| equal | 33 / 33 / 33 |
| **5%** | **100 / 0 / 0** |
| 20% | 100 / 0 / 0 |

**A five percent difference in mu produces a corner solution.** So the cap bounded the exposure, but the *choice of instrument* was still `max(members, key=|EdgeScore|)` — the same criterion `independent_ideas.strongest` used, relocated into the solver where it is invisible. ADR-0115 claimed to have removed a choice it had only hidden.

The obvious next move — hand the optimizer every instrument that expresses the idea, not just the ones L5 named — makes it **worse**. Measured over a five-name menu with mu from EdgeScore, the book still funds one name at 100%, and it is the same name. A wider menu is a wider field over which one weak signal selects: Michaud's estimation-error maximisation, operating one level down.

## Decision

**Two changes that only work together.** Either alone is a regression; `test_widening_alone_still_corners` exists to keep that finding from being re-forgotten.

### 1. One idea, one expected return

`equalise_within_complexes` replaces every member's mu with the complex's mean. With a common mu the objective's linear term depends only on the complex's **total** weight, which the cap already bounds — so the split falls entirely to the quadratic term. The optimizer holds the exposure through whichever member carries it at least variance.

Measured, on the same names: SVXY goes to **0%**, and the book carries long equity beta through SPY and QQQ. Not because anyone encoded a judgement about inverse-VIX products, but because it costs 56% vol to express a bet SPY expresses at 15%. ADR-0115 wanted exactly this outcome and [explicitly declined to hardcode it](0115-a-complex-is-one-idea.md#consequences); it falls out of the covariance once mu stops fighting it.

Kept out of `build_mu`, which is Grinold-Kahn and nothing else. This is a separate assertion about what a complex means, and composing them lets each be tested for what it claims.

### 2. The whole complex is on the menu

`_complex_expressions` offers the optimizer every pool member of a complex a pick bought into. Admitted only if the name is in this run's candidate pool (so it carries an L1 edge and vol), on the same side, and taxonomy-mappable. **A complex no pick bought into stays out**: this widens *how* an idea is expressed, never *which* ideas the book holds.

### 3. The thesis argues the idea, so a substituted instrument is not orphaned

L5 now writes an `exposure` per pick — what the trade is a bet ON, as distinct from the ticker. The prompt says the sizer may hold the idea through a correlated instrument, and instructs that a case depending on something only *that* instrument does must say so in the thesis, because that is what marks it as not substitutable.

A funded expression becomes a real position carrying a deterministic sentence naming what it is and where its argument lives. It does **not** restate the parent's prose: copying a paragraph arguing SVXY onto a row holding SPY is the precise failure this exists to remove. It inherits **no citations** — `verify_citations` adjudicated those numerals against prose this row did not write, and inheriting them would launder a verified claim onto unverified text. Its own prose contains no numerals, which is why it needs none.

### 4. The idea has a name, and the same one everywhere

`binding_constraints` reported `long::0 at correlation complex cap` — an internal index naming nothing a reader can act on. `complex_labels` carries L5's `exposure` into the optimizer's output, falling back to the member list. The book, the binding constraints and `/ask` all use that one label.

## Consequences

**mu equalisation is right while the gross constraint is SLACK, and only then.** The live book runs near 58% of a 100% budget. A levered member delivers the same exposure per unit of gross at higher vol, so with gross not binding that leverage buys nothing and its vol is pure cost. If gross ever binds, capital efficiency becomes real and a common mu would wrongly penalise the levered member. Revisit the day the budget binds — not before, and not silently.

**The two sizers now differ in membership, not just in weights.** The conviction sizer has no covariance, so it cannot rank members by cost of expression; handed a wider menu it would size correlated names by `|EdgeScore|/vol` and **concentrate** the exposure this spreads. So the fallback book holds exactly the names L5 listed. [ADR-0053](0053-the-published-book-was-sized-by-hype.md) is why that divergence is stated in `optimizer_result.complex_expression` rather than left for a reader to find.

**The mean, and what it is not.** A complex's mu is the simple mean of its members'. They differ only through `sigma`, so this is implicitly a mean-sigma reference. Using the named pick's own mu was the alternative and was rejected: it reintroduces a dependence on which member L5 happened to name, which is the dependence this removes.

**"Basket" was the wrong mental model, and ADR-0115 used it.** That ADR said the cap would "diversify away specific risk." It does not: with equalised mu and unequal vols the split is 75/25, not even — it is **minimum variance**. At rho 0.99 the diversification benefit is negligible and the vol saving is large, so concentrating in the cleanest instrument is the better outcome. The right description is *cheapest clean expression of the exposure*, not *basket*.

**What still selects on EdgeScore.** `independent_ideas.strongest` and `fallback_picks._diversify` are unchanged. ADR-0115 called the latter "redundant rather than wrong"; with the wider menu it is now the only remaining place a member is dropped for being less strong, and it governs the fallback path alone. Removing it is a separate change needing its own evidence.

**Substitutability is still an assumption, and it is now load-bearing.** ADR-0115 stated it; this ADR acts on it. Rho at or above 0.70 is not interchangeable — EEM and QQQ move together in a risk-on tape and violently apart in a China-specific event. The defence is that the substitution happens only inside a *measured* complex, and that L5 is instructed to flag a thesis that depends on one instrument's specifics. If those residual differences matter more often than not, the thing to argue about is the clustering threshold, not this decision.

**No migration.** `picks` is JSONB on `research_recommendations`, so `exposure`, `idea_id`, `named_by_llm` and `expresses_pick` travel without a schema change.

**A defect in ADR-0115's implementation, fixed here.** The optimizer warned `no correlation complex mapping` for every name absent from a sparse map — one line per standalone name, burying the real taxonomy gaps the sector and geo warnings exist to surface. `trade_ranker._apply_group_cap` already carried this distinction; the optimizer needed it for the same reason.
