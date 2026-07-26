# ADR-0098: An absence must say which kind of absence it is

**Status:** Accepted
**Date:** 2026-07-26
**Supersedes:** —
**Related:** [ADR-0066](0066-not-computable-must-persist-as-null.md), [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md), [ADR-0096](0096-the-book-is-net-short-sanctions-risk-and-never-said-so.md), [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md)

## Context

Design goal 2 says absence is stated, never filled. The codebase has honoured it case by case
— `null` not `0.0` for a share of an empty book, "not judged" not "no exposure" for a missing
column, "not retrieved" not "not crowded" for a portal that did not answer. Each was argued
in a docstring, and each argument was made again from scratch the next time.

`NumericDerivation` had one field for all of it: `display_status="unavailable"` plus a free-text
`unavailable_reason`. That single status was doing the work of at least three different
statements:

- **we tried to measure it and could not** — the source failed, the credential is missing
- **the question does not apply to this subject** — there is no answer to get
- **we never looked**

These demand different things of a reader. "Could not measure" means come back, retry, fix
the source. "Does not apply" means stop waiting: nothing is coming, ever, for this subject.
Rendering them identically tells a reader to wait for a number that does not exist.

The same week produced three instances in three different modules, each hand-argued:
`share_of_gross` on a book with no gross ([ADR-0066](0066-not-computable-must-persist-as-null.md)),
a COT reading for GDX where no futures contract exists
([ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md)), and a COT reading when
the CFTC portal does not answer. The first two are *not applicable*. The third is *unknown*.
Nothing in the type system knew the difference.

Separately, `as_of` was quietly serving as four different dates. ADR-0097 made this concrete:
CFTC positions are **observed** on Tuesday, **published** the following Friday, and
**retrieved** whenever the pipeline runs. Measuring freshness from retrieval reports a
five-day-old reading as two days old. Both are `datetime`, so nothing stopped it.

## Decision

### Two axes, because they answer different questions

`display_status` says how a figure should be **presented**. A new `epistemic` field says what
we **know** about it: `known | unknown | not_applicable`. They are independent — a `stale`
figure is `known` (we have last week's value, it is simply old), and an `estimated` figure is
`known` (uncertain in magnitude, not in existence).

`not_applicable` is **not a softer `unknown`**. Unknown says the answer exists and we failed
to get it. Not-applicable says the question does not apply to this subject.

### An absent value can never be `known`

`epistemic` defaults to `"known"`, which is safe **only** because `validate_numeric` rejects
`value=None, epistemic="known"`. An author who forgets the field and has a real value is
correct by default; one who forgets it and has an absence gets an error that names both
choices they skipped. That asymmetry is what makes the default ergonomic rather than a silent
mislabel — the common case costs nothing and the dangerous case is impossible.

Both absences require a reason. A present value may not claim to be unknown: whatever else is
uncertain about a number we have, we have it.

### Where the fallback lands, it lands on the weaker claim

`risk_engine._wrap` defaults to `known` with a value and `unknown` without one. `unknown` is
deliberately the weaker of the two absences: telling a reader to come back is harmless if it
turns out nothing was coming, whereas telling them to stop waiting is a claim that has to be
earned. A caller asserting `not_applicable` passes it explicitly.

The one existing absence in L4 — "insufficient history" for Sharpe and beta — is classified
**unknown**, not not-applicable. The statistic is genuinely undefined on a two-observation
series, but the shortfall is in the data rather than in the question: it resolves as history
accrues. `not_applicable` would tell a reader to stop waiting for a number that is on its
way. Its reason now names the threshold instead of saying "insufficient history".

### Timestamp roles are types, not field names

`Observed`, `Published`, `Retrieved` and `Effective` are four frozen wrapper types, and
`Timestamps` isinstance-checks them at construction. Passing a `Retrieved` where an `Observed`
belongs raises a `TypeError` — it is not merely discouraged by a type checker that does not
run in production, which is what "a serializer cannot substitute one for another" has to mean
to be worth anything.

Freshness is defined against **observation**. Where `Timestamps` is present, `as_of` must
equal `observed.at`; two disagreeing sources for that date would put a wrong age on screen.

Ordering is enforced where it is meaningful — the world is observed before a source can
publish it, and published before we can retrieve it. `Effective` is deliberately exempt: a
revision published today can be effective for last quarter, and constraining it would make
revisions unrepresentable.

`publication_lag_seconds` returns **None, not 0**, when publication is unrecorded. Zero would
assert instant publication, which is a measurement we did not make.

### The frontend mirror is enforced, not asserted

`lib/derivations/numeric.ts` has always carried the comment "mirrors
backend/derivations/numeric.py field-for-field". A comment is not a guarantee, and the drift
it invites fails silently in the worst way: the backend emits a field, the interface does not
declare it, and every read is `undefined` — which on a provenance page renders as "no data"
rather than as an error.

`derivation-parity.test.ts` now parses both files and compares field sets and union members.
It includes a non-vacuity check, because two empty lists compare equal and a regex that stops
matching after a refactor would turn the whole file green while checking nothing. It was
negative-tested by deleting a field.

`absenceCopy()` gives the two absences different words — "Does not apply here" versus "Not
measured" — and returns null for a present value. `RiskMetricsGrid` renders it, so the
distinction reaches a reader rather than living in a type.

## Consequences

**A rule that could not fire was removed rather than kept for symmetry.** The first draft
also validated "an unavailable derivation cannot be epistemically known". It is unreachable in
any state the other two rules permit — `unavailable` requires `value=None`, and an absent
value is already refused the `known` label — and it shadowed a more useful message with a
vaguer one. A test now asserts both routes into that contradiction are closed, so removing
either underlying rule fails loudly.

**`epistemic` and `timestamps` are additive.** Existing call sites keep working; `timestamps`
is optional and unset on every derivation that predates it.

**This is the type, not yet the sweep.** `NumericDerivation` and the L4 metrics are typed.
The absences elsewhere — the analytics overlay columns, the freshness verdict, the track
record — still express the distinction in prose and `null` rather than through this field.
They are correct today; they are not yet checkable. Converting them is mechanical and is left
as follow-on work rather than smuggled into this change.

**`AdvisoryDerivation` is untouched.** It carries claims, not numbers, and whether the same
three states fit a qualitative assertion is a genuinely open question that deserves its own
decision rather than an assumption made here.
