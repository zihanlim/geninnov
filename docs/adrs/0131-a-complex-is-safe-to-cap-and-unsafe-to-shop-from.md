# ADR-0131: A complex is safe to cap and unsafe to shop from

**Status:** Accepted — closes the menu-widening question left open by ADR-0118
**Date:** 2026-07-28
**Related:** [ADR-0048](0048-count-independent-ideas-not-candidates.md), [ADR-0115](0115-a-complex-is-one-idea.md), [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md) (reverted), [ADR-0118](0118-a-complex-is-capped-in-risk-because-capital-is-not-neutral.md), [ADR-0119](0119-svxy-is-equity-risk-and-the-taxonomy-said-haven.md)

## Context

[ADR-0118](0118-a-complex-is-capped-in-risk-because-capital-is-not-neutral.md) ended: *"This ADR buys the precondition, not the feature."* The feature was the menu widening — offer the optimizer every member of a complex a pick bought into, and let it choose the instrument. It was deferred twice: once because the sizing mechanism was wrong (ADR-0116, reverted same day), once to be judged *"against a correctly-scored book, which does not exist until the next run."*

That book now exists — the republished 2026-07-27 run, under the corrected taxonomy, the risk-denominated complex cap, and the four-component IC. Two facts from it decide the question.

**The motivating case dissolved.** The widening existed because SVXY — misclassified, mis-stressed, mis-betaed — was the book's second-largest position expressing long equity beta. Under the corrected pool the model did not pick SVXY at all. The pressure the feature was built to relieve is gone (not provably *because* of the fix — the LLM re-picks — but gone).

**And the current book's own complexes refute the premise, measured.** Four of eight picks sit in multi-member complexes. Pairwise correlation inside the two largest, 252-day window:

```
duration {AGG, IEF, SHY, TLT}          gold {GDX, GLD, IAU, NEM, SLV}
  AGG-IEF +0.972                         all 10 pairs >= +0.753
  AGG-SHY +0.851                         GLD-IAU +1.000
  IEF-TLT +0.905
  SHY-TLT +0.632   <-- BELOW 0.70
```

The duration complex is a **chain**, not a clique. SHY joins through AGG/IEF at 0.85+; SHY–TLT themselves sit at **0.632 — below the very threshold that defines the complex**. `correlation_clusters` builds connected components, and components are transitive where correlation is not. The book deliberately holds SHY (~1.9y duration). A widened sizer could have carried that "one idea" through TLT (~17y) — a 9× duration change between two names whose own pairwise correlation would never have flagged them as one idea.

## Decision

**The menu widening is closed, not completed.** Substitution requires clique-level interchangeability, and the grouping that exists is a component. They are different structures for different jobs:

- **Capping a component is safe by asymmetry.** If a chain over-merges, the cap binds a group that is looser than one idea — too *tight*, never wrong-direction. SHY and TLT sharing one capital and risk budget is conservative. Over-merge costs basis points of deployment; it cannot corrupt the book.
- **Shopping from a component is unsafe by the same measurement.** Substituting across a chain can silently swap the thesis — front-end for long-end duration — while every constraint reports satisfied. Over-merge here changes *what the book holds*.

So the capping machinery (ADR-0115's capital cap, ADR-0118's risk cap, signal equalisation) **stays exactly as built**, dormant while L5 holds one member per complex and binding the day it doesn't.

**The surviving sound case is named and deliberately not built.** GLD–IAU at 1.000 is genuine wrapper substitution — the same exposure in two tickers, the exact case the widening imagined. Building it would need a reason to prefer one wrapper, and the repo has none: `cost_model` carries no per-name spread or liquidity input, so the optimizer would be indifferent between wrappers on any measured ground. A feature whose only decision input is unmeasured is not built ([ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md)'s discipline from the other side). If per-name cost data ever lands, wrapper substitution over pairs at ρ ≥ 0.95 — *pairs*, not components — is the version to revisit.

## Consequences

**ADR-0118's open thread resolves as: precondition bought, feature declined, reasons measured.** The expression machinery from the reverted ADR-0116 (exposure labels, expression positions, the thesis-about-the-idea contract) stays reverted and is no longer pending — there is nothing left for it to serve.

**If the clustering is ever re-argued, argue two structures, not one threshold.** ADR-0115's escape hatch said "the thing to argue about is the clustering threshold." The measurement says otherwise: no single threshold fixes a chain, because the defect is transitivity, not the bar. Components (any-path, 0.70) are right for caps; cliques (all-pairs, higher bar) would be right for substitution. The repo needs only the first today.

**`independent_ideas.strongest` and `fallback_picks._diversify` remain the last selectors on EdgeScore**, fallback-path only, unchanged — still a separate cleanup with its own evidence bar.

**The count in `independent_ideas` inherits a caveat.** A chained component counts as one idea, so the published "3 long ideas" modestly *understates* independence when a chain spans genuinely distinct bets (SHY and TLT). Same asymmetry as the cap: the error is conservative — the pool reads thinner than it is, never deeper.
