# ADR-0048 — Count independent ideas, not candidates

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0029](0029-two-sided-backfill.md), [0032](0032-edge-stage4-abstention-conviction.md), [0039](0039-scope-by-attention-abstain-by-asset.md), [0045](0045-turnover-on-names-without-a-verdict.md), [0046](0046-attention-chooses-what-we-look-at-not-what-is-tradable.md)

## Context

`task.md` asks for **five long and five short trades**. `GOAL.md` puts that first in
its priority order: *"The answer must exist and match the question."* The book has
answered with fewer for many iterations, and the explanation moved every time:

- The universe was eight themes of ETFs → widened with single names (ADR-0043).
- Redundancy capped the short side → **disproved** the next day when NOC, an
  independent short, was passed over anyway.
- The attention gate was discarding whole themes → **true**, and fixed (ADR-0046).
  The pool went from 23 names to 39.

Every one of those explanations was *argued* rather than measured, and each was
disproved by the next measurement. After ADR-0046 the pool holds 27 long and 12 short
candidates — and L5 still returns 4–5 long and 3 short, run after run. Its raw output
was checked: nothing is dropped downstream, the agent simply picks that many.

The obvious next inference — *"L5 is under-picking"* — is exactly the kind of claim
this project keeps getting wrong. So it was measured instead, using the clustering
already in the codebase (`correlation_clusters`, connected components over positively
correlated pairs) at the same ρ 0.70 `/risk` uses to flag redundancy inside the book:

```
LONG : 27 candidates -> 13 independent ideas
         ONE IDEA: AGG, EEM, EFA, EMB, EWJ, IEF, IWM, QQQ, SHY, SPY, SVXY, TLT
         ONE IDEA: CVX, XLE, XOM
         ONE IDEA: OIH, SLB
         + 10 standalone

SHORT: 12 candidates ->  5 independent ideas
         ONE IDEA: GDX, GLD, IAU, NEM, SLV   (precious metals)
         ONE IDEA: BABA, FXI, KWEB, MCHI     (China internet)
         + PDD, NOC, ARKK standalone
```

**Twelve short candidates were never twelve short ideas — but they are five, and five
is exactly what Q1 asks for.** The pool has stopped being the constraint on the short
side and was never the constraint on the long side. That is a genuinely new fact, and
it could not have been established by counting anything the site already displayed.

It also explains the agent's behaviour without accusing it of much: the prompt tells
it to *"select up to 5 LONG and up to 5 SHORT (fewer if the pool is thin)"* and, in the
next breath, *"do not add picks that compound existing high-correlation exposures."* An
agent obeying the second instruction correctly refuses to take a second metals short.
It had no way to know that four *other* independent short ideas existed — a candidate
count cannot tell it, and a candidate count was all it had.

## Decision

Compute **independent ideas per side** as a first-class measurement
(`book_metrics.independent_ideas`), persist it
(`research_recommendations.independent_ideas`, migration 036), and use it in two
places.

**1. Tell the agent.** A `POOL DEPTH (measured, not estimated)` block states the count
per side and *names each complex with its strongest member*, so the agent can take the
best of a group rather than skip the group. The instruction now reads: returning fewer
picks than that count needs a reason in `book_view`; returning fewer than five when
five independent ideas exist is a choice, not a constraint.

**2. Tell the reader.** `/book` gains a Pool depth panel: candidates → independent
ideas → held, per side. It **deliberately does not excuse the book** — when the count
is at or above five and fewer are held, it says in warning colour that the shortfall
is selection rather than constraint, and points at the thesis. That is the sentence
this project has repeatedly been unable to write, because until now nobody knew which
of the two it was.

Definitions, chosen so one number means one thing:

- A **complex** is a connected component of names correlated at or above
  `HIGH_CORR_THRESHOLD` (0.70) over 252 days — the same threshold and the same
  clustering `/risk` and `ClearedNotTaken` already use.
- The two sides are measured **separately**. A long and a short of correlated names
  are two bets, not one; folding them together would count a hedge as redundancy,
  the inversion [ADR-0045](0045-turnover-on-names-without-a-verdict.md) removed from
  the not-taken column.
- A name with **no usable return history counts as its own idea**. It cannot be
  clustered, and reporting it as standalone biases the count *up* — the safe
  direction for a number whose job is to say "you could have picked more".

## Consequences

- "Why isn't this five and five?" now has a checkable answer per side, and the answer
  can be *unflattering to the system*, which is the point. On the long side, 13 ideas
  against 4 held is not a universe problem.
- The measurement can move the book, so it is honest about what it is: a fact given to
  the agent, not a quota. Nothing forces five picks; abstention (ADR-0032) and the
  correlation guidance are untouched, and a genuinely thin side still produces fewer
  positions with the panel saying so.
- It costs one extra correlation matrix per run over the ≤30-name pool, wrapped so an
  explanatory measurement can never fail the book.
- **The count is a lower bound on redundancy, not a guarantee of independence.** ρ 0.70
  over 252 days will not catch two names that share a factor exposure while trading
  apart. Six tests pin the arithmetic; nothing yet pins the economics, and that is
  worth saying out loud rather than implying the number is stronger than it is.
