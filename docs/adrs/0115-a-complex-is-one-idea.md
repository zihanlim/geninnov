# ADR-0115: A correlation complex is one idea, so it gets one name's worth of capital

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md), [ADR-0048](0048-count-independent-ideas-not-candidates.md), [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md), [ADR-0110](0110-crowding-caps-what-it-can-see.md), [ADR-0053](0053-the-published-book-was-sized-by-hype.md)

## Context

[ADR-0048](0048-count-independent-ideas-not-candidates.md) built `independent_ideas`: names correlated at or above 0.70 form a "complex" — one idea expressed across several tickers. It has **counted** them ever since. Nothing has ever **constrained** them.

So the single-name cap was trivially evadable. Three names correlated at 0.9 could hold 60% of gross between them, each reporting comfortable headroom against its own 20% limit.

Measured on the live 2026-07-27 book, the long side clusters:

```
EEM, EWJ, IWM, QQQ, SVXY   ->  one idea
CVX, XLE, XOM              ->  one idea
OIH, SLB                   ->  one idea
```

Ten tickers, three ideas. The first complex spans **four different themes** — US Dollar, Geopolitical Risk, US Election, Fed Policy — so the taxonomy implied four independent exposures where the correlation matrix saw one bet on equity beta.

**This started from the question "which member do we choose?"** The existing answer, inside `independent_ideas`, is `max(members, key=|edge_score|)` — signal strength alone, with nothing about liquidity, instrument integrity, or tail behaviour. It selected **SVXY** to express long equity beta over QQQ and IWM: a −0.5× inverse-VIX product, daily-rebalanced with path-dependent decay, whose −1× sibling XIV terminated in February 2018. It was the book's second-largest position at 10.79%.

## Decision

**Do not choose. Cap the complex and let the optimizer allocate across it.**

If the members are one idea, "which one" has no good answer — every choice adds an unforced idiosyncratic bet on top of the exposure actually wanted. Splitting across the complex diversifies away specific risk nobody was paid to take, which is the logic the optimizer already applies at book level, applied one level down.

A complex is one idea, so it may hold at most what one name may: `max_complex = MAX_SINGLE_NAME_WEIGHT`. Named separately rather than aliased, so the two can diverge later with an argument rather than by accident.

**It reuses the existing group-cap machinery.** The optimizer already binds sector and geography on the group *total*; a complex is a third grouping in the same loop, inheriting the constraint construction, the binding-constraint reporting, and the linearity that keeps mean-variance a QP.

**Both sizers apply it.** [ADR-0053](0053-the-published-book-was-sized-by-hype.md) is what happens when a limit lives on one sizing path only; `allocate_portfolio` takes the same map.

**The map is sparse, and that needed an explicit branch.** A name correlated with nothing belongs to no complex and is governed by the single-name cap alone. `_apply_group_cap` hard-indexes its map for sector and geography — deliberately, because an unclassified ticker there *must* raise — so the sparse case required `.get()` with a skip rather than the same lookup. Absent means "ungrouped", not "unclassified".

**Ids are namespaced by side.** The clustering runs per side; merging a long complex with a short one would cap a bet against itself.

## Consequences

**This supersedes the framing, not just the answer.** An instrument-integrity screen was drafted first — prefer the highest-|edge| member that is not leveraged, decaying, or illiquid. Rejected: it makes the *choice* better instead of removing the need to choose, and it would have required a hardcoded quality judgement per name with no measurement behind it. The cap needs no such table.

**A complex now competes with itself for capital, which is correct.** Five names in one complex do not get five slots; they share one name's worth, and the covariance decides the split.

**What it does not do.** It does not stop L5 *selecting* correlated names — it stops them adding up. That is deliberate: selection is the agent's judgement, the limit is the risk policy. It also does not touch `fallback_picks._diversify`, which still drops all but the strongest member on the fallback path; with a cap in place that drop is now redundant rather than wrong, and removing it is a separate change needing its own evidence.

**The assumption it makes, stated plainly.** A basket asserts the members are substitutable. ρ ≥ 0.70 is not interchangeable — EEM and QQQ move together in a risk-on tape and violently apart in a China-specific event. If those residual differences matter, the names were not one idea, and the thing to argue about is the clustering threshold rather than this cap.

**On the live book it binds.** The largest long complex held SVXY at 10.79% plus whatever else L5 took from the same cluster. Under this cap that group is bounded at 20% in total and split by covariance, rather than concentrated in its most fragile member.
