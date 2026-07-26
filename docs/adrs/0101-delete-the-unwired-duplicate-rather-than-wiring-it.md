# ADR-0101: Delete the unwired duplicate rather than wiring it

**Status:** Accepted
**Date:** 2026-07-27
**Supersedes:** —
**Related:** [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md)

## Context

[ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md) established that a
capability with no caller is not implemented. It did not say what to do about one. There, the
answer was obvious — the chokepoint signal was the only implementation of a behaviour we
wanted, so it got wired.

The audit that followed found a second case with the opposite answer.
`backend/services/exposure.py` — `gross_exposure`, `net_exposure`, `leverage`,
`sector_concentration`, `geo_concentration` — was imported by nothing but its own test.

Three live documents said otherwise. `ARCHITECTURE.md` drew it as a node with an edge
`EX -. "exposure aggregation" .-> TG`, feeding the trade ranker. `docs/lineage/MATRIX.md`
named `exposure.gross_exposure()`, `exposure.net_exposure()` and `exposure.leverage()` as the
**producers** of three `/portfolio` figures.

Both claims were false, and one was doubly so: `/portfolio` has been a redirect to `/book`
since the decision triad consolidated.

Worse than dead, it was **wrong for the data this repo produces.** Its test fixtures are
`{"ticker", "weight", "sector", "geo"}` with signed weights. Real picks are
`{"asset", "direction", "weight"}` with **unsigned** weights and the side in a separate field.
So on a real book:

- `net_exposure` returns the **gross** — it sums `p["weight"]` and never reads `direction`,
  reporting a roughly market-neutral book as ~59% net long
- `sector_concentration` and `geo_concentration` raise `KeyError` — real picks carry neither key
- `leverage` divides gross by capital, but weights are already fractions of capital

Its five tests passed against a fixture shape modelling data the system does not produce: a
self-consistent fiction. Had anyone wired it as the diagram claimed was already done, the
first symptom would have been a badly wrong net exposure on a page whose entire subject is
exposure.

Meanwhile `book_metrics.compute_book_metrics` computes all five concepts, is on the live L5
path, and handles the signed/unsigned distinction explicitly — it carries a comment about
exactly that trap.

## Decision

**Delete it, with its test.**

Wiring it would have created a genuine duplicate of a live, correct, sign-aware
implementation. The choice is not between "dead code" and "working code"; it is between one
implementation and two, and two copies of an exposure calculation drift the way two copies of
any formula drift — except this one starts out already wrong.

The rule this settles, as the counterpart to ADR-0099: **wire an uncalled capability when it
is the only implementation of a behaviour you want; delete it when a live implementation
already exists.** The tie-breaker is not which code is nicer but which one the system's real
data flows through.

`ARCHITECTURE.md` loses the node, the edge and the class entry. `MATRIX.md`'s three producer
rows are corrected to name `book_metrics.compute_book_metrics`.

`docs/baseline/STATUS.md` and `.superpowers/sdd/task-7-*.md` keep their references
unchanged. They are historical records of what was built at a commit, not claims about what
runs today, and rewriting them would destroy the audit trail that makes this ADR checkable.

## Consequences

**Three documents stop lying**, one of which drew an edge into the trade ranker that never
existed.

**A latent trap is gone.** The failure was not that the code was unused; it is that it was
*available*, plausible, named exactly what a future author would search for, and would have
produced a confidently wrong number on first use.

**Test count drops by five, and that is the right direction.** They tested a data shape the
system does not produce. A passing test over a fiction is worse than no test: it reports
confidence about a path that cannot execute.

**A general observation from three audits in two days.** Each defect was invisible because
something adjacent to it was demonstrably working — the components passed their unit tests
(0099), the guard visibly suppressed the tile (0100), the module had five green tests
(0101). Local evidence of correctness is what made each one hard to see, which is an argument
for checking boundaries — caller, consumer, data shape — rather than adding depth to checks
that already pass.
