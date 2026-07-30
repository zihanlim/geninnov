---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0174 — A constraint cannot bind a variable it was never given

## Context

ADR-0173 landed the same day this ADR was written, and the first live nightly run
under it (`daily_refresh.py`, 2026-07-30) was the first real test of the fix. The
solver reported success: `optimizer_result.realised_turnover` came back
`0.59999997`, exactly at the new `turnover_cap` of `0.6`, with
`"turnover at cap"` in `binding_constraints`. The independently-measured
`book_holdings_performance.turnover` for the same run — computed by
`held_book.weight_delta`, a different function reading the same two published
books — was **0.944951**. A 34.5-point gap between "the cap held" and "what
actually happened."

The gap was not noise. Yesterday's published book (`book_holdings` for
2026-07-29) held nine names: TLT, VRT, NUE, GEV, GDX, BABA, MSFT, PDD, NOC.
Today's model picked a different nine: NUE, GEV, BABA, MSFT continued; ARKK,
GLD, JD, SMH, UNG are new; **TLT, VRT, GDX, PDD and NOC are gone** — not
reweighted to zero, simply absent from the day's candidate pool, because the L5
agent chose a different top-nine from a different screen. Summed, those five
exits equal **0.344951** — the entire gap, to five decimal places.

**Why the constraint could not see it.** `optimize()`'s turnover constraint is
built as `cp.norm1(w - w_held) <= max_turnover`, where `w` is a cvxpy `Variable`
of length `len(assets)` — `assets` being *today's* candidate list — and
`w_held = [weights_held.get(a, 0.0) for a in assets]`. A name held yesterday
that is not in today's `assets` never enters either vector. It is not a
decision the solver declined; it is not a term in the expression at all. The
same is true of the *reporting*: `realised_turnover` was computed by summing
`|weights[a] - w_held[i]|` over that same `assets` loop. Both the constraint and
its own audit trail iterate one side's keys — `previous ∩ today`, extended by
`today \ previous` (new entries, correctly counted because `w_held.get(a, 0.0)`
defaults to zero for them) — but never `previous \ today`. This is the exact
defect `held_book.weight_delta`'s own docstring names, one layer upstream:

> A name present in only one of the two books is a full entry or a full exit,
> and both are trades. Iterating one side's keys alone would price an entry and
> miss every exit — a book that sold everything would report no cost.

ADR-0173 fixed *which baseline* the constraint measured against
(`weights_held`, not `weights0`). It did not fix *which names* the constraint
could see, and on this run that second gap was larger than the entire budget
the first fix installed: 34.5 points of forced churn against a 60-point cap,
leaving only 25.5 points the constraint was actually able to govern before the
reported "at cap" claim already understated the true number by more than half
its own value.

The consequence was worse than the pre-ADR-0173 state, not merely as bad: a
reader of `/mandate` on 2026-07-30 saw "Turnover (day-over-day) — 60% —
config," a number that reads as *governed*. The true figure was 94.5% over a
60% cap — a breach, reported as compliance. A wrong number with no claim of
control is a gap; a wrong number that says "at cap" is a false assurance.

## Decision

**Forced exits are not a solver choice, so they are removed from the solver's
budget before the solver runs, not folded into a constraint it cannot express.**

A name held yesterday (`inputs.weights_held`) that is absent from today's
`assets` cannot be represented by `w` — there is no coefficient for it to have.
Treating its exit as free (the old behaviour) or attempting to add it as a term
in `cp.norm1(w - w_held)` (impossible — `w` has no entry for it) are both
wrong. The fix computes it as a **constant**, outside the solve:

```python
forced_exit_turnover = sum(
    abs(v) for a, v in weights_held.items() if a not in assets
)
remaining_budget = max(0.0, max_turnover - forced_exit_turnover)
cons.append(cp.norm1(w - w_held) <= remaining_budget)
```

The solver is left whatever budget survives the unavoidable exits, never a
negative one — `max(0.0, ...)` — because a negative bound is not a tighter
constraint, it is an infeasible one for a cost the solver had no way to avoid
in the first place.

`realised_turnover` is corrected to the same union: the solver-visible distance
over `assets`, plus `forced_exit_turnover`. This is now, by construction, the
same quantity `book_holdings_performance.turnover` measures independently — the
two readings of "what moved" cannot diverge on method, the same argument
ADR-0173 already made for reusing `held_book.step` between the nightly series
and its backfill.

**`forced_exit_turnover` is a new, named field** on `OptimizationResult` and
the persisted `optimizer_result` payload — not folded silently into
`realised_turnover`. On this run it was 34.5 of 94.5 points: more than a third
of total turnover, and larger than the entire post-fix budget. A number that
size deserves its own name, not just a bigger total (the same argument
`cov_shrinkage_intensity` and `IC_SHRINKAGE` already make for every other
number in this pipeline that would otherwise arrive unexplained).

**`binding_constraints` distinguishes an ordinary bind from a breach the
constraint had no power to prevent.** `"turnover at cap"` still fires when the
solver used its (possibly reduced) remaining budget exactly. A new, distinct
message — `"turnover cap breached by candidate exits alone (X% of a Y%
budget, before any solver choice)"` — fires when forced exits alone already
exceed the cap. Reporting the second case as merely "at cap" would repeat the
exact false-assurance failure this ADR exists to fix, just with smaller
numbers.

## Consequences

Positive:
- `optimizer_result.realised_turnover` and `book_holdings_performance.turnover`
  are now the same measurement by construction, not two functions that happen
  to agree when nothing has fallen out of the candidate screen.
- A day where the model's picks turn over heavily — which, empirically, is a
  *bigger* driver of real turnover than intra-candidate reweighting (51.1 points
  of entries + 34.5 of exits vs 8.9 of reweighting continuing names, on this
  run) — is now visible and, where the budget allows, actually constrained.
- 2 new adversarial backend tests:
  `test_forced_exit_of_a_dropped_candidate_still_counts_as_turnover` (a partial
  forced exit correctly reduces, not zeroes, the solver's remaining budget) and
  `test_forced_exits_alone_can_breach_the_cap_and_say_so` (forced exits alone
  exceeding the cap freezes every solver-visible name and reports a breach, not
  a bind). Both would have failed against the pre-fix code — the first because
  `forced_exit_turnover` did not exist, the second because
  `"turnover at cap"` would have fired on a genuine breach.

Negative / friction:
- **This does not make candidate churn cheaper, it only makes the cost
  visible and, within budget, resistible.** A cap cannot make the model stop
  swapping its top-nine; it can only refuse to fund the swap once the budget
  set aside for it is spent. If the model's picks genuinely change entirely
  every run, `forced_exit_turnover` alone will keep landing near the cap,
  leaving the solver with tiny or zero freedom to reweight the names it does
  keep — a real constraint on today's fix, not a bug in it.
- **The already-published 2026-07-30 book's `optimizer_result` still carries
  the wrong pre-fix numbers** (`realised_turnover: 0.6`, `"turnover at cap"`).
  The traded positions themselves are unaffected — this bug lived in the
  *reporting and the residual solver budget*, not in which names or sizes were
  chosen for names within `assets` — but the disclosed diagnostic is
  misleading until either the next scheduled run (2026-07-31, 21:30 UTC)
  republishes it correctly, or the row is corrected in place. Left as an open
  question for the operator rather than decided unilaterally here: correcting
  already-published diagnostic figures is a data-governance choice ADR-0093
  already established a pattern for (a `book_revisions` entry, reason
  required), and this ADR does not extend that pattern on its own authority.
- A day where forced exits alone exceed the cap now visibly freezes every
  solver-visible name (the zero-remaining-budget case) rather than solving
  around it. That is the documented, correct behaviour — the alternative is
  silently absorbing an unbudgeted cost — but it means a heavy-churn day can
  produce a book with almost no adaptation among the names the solver can see,
  which a reader needs the new breach message to understand rather than
  mistake for the solver declining to act.

## Alternatives considered

**Extend `w` to cover the union of today's and yesterday's assets, with the
exited names' weights pinned to zero as an explicit constraint.** Mathematically
equivalent to treating the exit as a fixed cost, but adds dead variables to
every solve (most runs have few or no forced exits) and complicates every other
constraint that iterates `assets` — the single-name cap, the group caps, the
correlation-complex risk budget — all of which would need to special-case
"pinned-zero" assets to avoid nonsensical results (a sector cap counting a
forced-zero exit toward its sector total, for instance). The constant-subtraction
approach keeps `w`'s dimensionality exactly what the solver actually decides.

**Leave forced exits uncounted and disclose the gap instead**, the way
ADR-0173 disclosed the covariance shrinkage before fixing it. Rejected: the
shrinkage disclosure was a stopgap for a fix that needed its own argument
(which intensity, which target). This fix needs neither — the constant-cost
treatment is the direct, correct translation of "a variable that does not
exist cannot be constrained" — so shipping the honest-but-wrong number and
promising a future fix would be choosing the weaker option with the stronger
one already in hand.

**Silently clamp `max_turnover` to never bind less than the forced-exit
floor** (i.e., raise the effective cap rather than reduce the solver's
remaining budget to zero). Rejected: the mandate's cap is an operator decision
about how much churn a $100M book should be allowed per day, in total. Quietly
enlarging it to accommodate whatever the candidate screen happened to drop
would make the cap a function of the day's candidate churn rather than a
statement about the mandate — the reverse of what a cap is for.
