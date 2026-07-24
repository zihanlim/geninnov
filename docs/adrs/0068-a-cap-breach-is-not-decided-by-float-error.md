# ADR-0068 — A cap breach is not decided by floating-point error

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0037](0037-position-limits-bind-and-the-rest-is-cash.md), [0047](0047-conviction-needs-a-vol-floor.md), [0067](0067-a-column-must-name-the-subset-it-measures.md), [0060](0060-a-share-cannot-exceed-the-whole.md)

## Context

The live 2026-07-25 book reported a governance failure:

```
cap violations: ['US (35.0% > 35%)']
  BREACHED  geo  US   weight = 0.350000   cap = 0.350000   utilisation = 1.0000
```

**35.0% is not greater than 35%.** The message asserts a strict inequality that its own
printed numbers deny, and it is the first figure a reviewer would poke on a page whose
whole claim is that limits bind.

At full precision:

```
weight = 0.35000000000000003
cap    = 0.35
w - c  = 5.551115123125783e-17      # one ULP
```

**This is the cap working correctly, reported as a failure.**
[ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md) made the limits actually
bind: `allocate_portfolio` **clamps** a group to its cap and holds the remainder in cash.
So a fully-utilised book lands *exactly on* the limit by design — and summing the clamped
per-position floats reintroduces representation error, after which `w > cap` is true by
5.55e-17.

Iteration 21 saw the same boundary and left it, recording only that *"the `−0.0%`
headroom is an artefact worth tidying if that row is ever touched."* At that point it was
merely ugly. It is now emitting a false sentence about risk governance.

Two distinct defects sit on top of each other:

1. **The comparison** is decided by float representation error rather than by the rule.
2. **The message** prints the weight to one decimal against a whole-number cap, so any
   overshoot below 0.05pp renders as a strict inequality between two equal-looking
   numbers — the same class as
   [ADR-0067](0067-a-column-must-name-the-subset-it-measures.md), where a label claimed
   something the number could not support.

## Decision

**`exceeds_cap(weight, cap)` — over the cap by more than representation error.**

```python
CAP_EPSILON = 1e-9
def exceeds_cap(weight, cap, eps=CAP_EPSILON):
    return weight - cap > eps
```

- **`1e-9` is a representation-error guard, not an economic tolerance**, and the
  distinction is the point. It is nine orders of magnitude above the observed 5.55e-17
  error and seven *below* a single basis point, so it cannot mask a breach anyone could
  act on. [ADR-0047](0047-conviction-needs-a-vol-floor.md) warned that a *fitted*
  threshold is a statement about the day's numbers rather than about the rule; this one
  is a statement about IEEE-754.
- **Sitting exactly on a cap is compliance, not breach.** The allocator puts it there.
  Reporting the designed state as a violation is not conservatism, it is noise that
  trains a reader to ignore the alert.
- **`cap_utilisation`'s `breached` flag uses the same predicate**, so the row badge and
  the violation message cannot disagree — the drift
  [ADR-0058](0058-explanations-are-owed-per-empty-slot.md) hit when a verdict was
  re-derived at a second site.
- **The message states the excess** rather than a bare inequality:
  `US 36.12% — 1.12pp over its 35% cap`. The sentence is now checkable at the precision
  it is printed to, whatever the overshoot.

## Consequences

- **Verified against the exact live value**, not a fixture: applying the new predicate to
  the persisted `0.35000000000000003 / 0.35` clears the violation, and nothing else in
  the book is within 1e-9 of a cap, so no real breach is masked. The *persisted string*
  refreshes on the next pipeline run — this changes the computation, not history.
- **`/risk`'s limit board and `/book`'s cap panel both stop reporting a phantom breach**,
  and the count a reviewer reads goes from "1 cap violation" to zero on a book that never
  violated one.
- **The general rule, and it is the fourth instance this week:** a displayed claim must be
  supported by the numbers displayed beside it. ADR-0060 refused a share that exceeded its
  whole; ADR-0066 stopped a row encoding absence as a value; ADR-0067 stopped a column
  labelling a subset as the whole; this stops a message asserting an inequality its own
  figures contradict.
- **Left alone deliberately:** the `−0.0%` headroom display iteration 21 noticed. With the
  breach flag corrected it is a cosmetic negative zero on a row that now reads as
  compliant, and changing number formatting across the cap panels is a wider change than
  this one earns.
