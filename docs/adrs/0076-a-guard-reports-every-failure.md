# ADR-0076 — A guard reports every failure, not the first one

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0075](0075-per-pick-betas-are-joined-not-authored.md), [0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md), [0071](0071-pool-metrics-are-not-book-metrics.md), [0023](0023-data-provenance-and-fabrication-guard.md)

## Context

`check_data_integrity.main()` ran its book checks as a chain of early returns: each check
printed its verdict and `return 1` on failure. That is the obvious shape, and it quietly
set the pace of three consecutive iterations of work.

| iteration | found | ADR |
|---|---|---|
| 72 | a cap breach the book does not have | [0071](0071-pool-metrics-are-not-book-metrics.md) |
| 73 | a factor tilt restated from the pre-selection pool | [0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md) |
| 74 | *"an inverted curve"* against a +34bps slope | [0075](0075-per-pick-betas-are-joined-not-authored.md) |

**All three were in the same published thesis, on the same day.** They arrived one per run
because nothing looked past the first failure — each fix did not *reveal* the next defect
so much as *stop hiding* it.

The cost is not only pace. A reader of the guard's output cannot distinguish **"this book
has one defect"** from **"this book has one defect that we know of"**, and those justify
very different responses. That is the wrong thing for a guard to be ambiguous about: its
entire job is to say what is true about the data.

The shape had a second symptom. Each new check had been added by appending another
Supabase query, so the same row was fetched five times — `rec_rows`, `book_row`,
`cap_row`, `tilt_row`, `pick_row` — each selecting an overlapping column subset.

## Decision

**Run every book check, collect every failure, decide the exit code at the end.**

`run_book_checks(rec, candidates, regime)` returns a list of
`(headline, flags, ok_message)` — one entry per check, all of them evaluated. `main()`
prints each verdict in turn and returns 1 if *any* flagged.

- **Order is narrative, not priority** — broadest claim first, arithmetic last. Nothing
  short-circuits, so order carries no meaning beyond readability.
- **One query for the row.** The five overlapping selects collapse into one that names
  every column the checks need.
- **Extracted as a pure function**, which is what makes the property testable: the live
  three-defect row now asserts **three failures in one pass**. No test could express that
  while the behaviour lived inline in `main()` behind a Supabase client — the reason the
  early-return shape survived as long as it did.

## Consequences

- **A failing run now costs one iteration instead of three.** The next book with several
  defects reports them together.
- **The exit code is unchanged** — 1 if anything failed — so `daily-refresh.yml` and CI
  need no change.
- **A slower failing path**, deliberately: every check runs even when the first has already
  doomed the exit code. These are in-memory checks over one row; the cost is nil against
  knowing the whole verdict.
- **This does not make the checks complete.** It makes their output honest about what was
  *examined*. A defect no check looks for is still invisible, and the recurring lesson of
  this project is that those are found by reading rendered output and cross-checking two
  numbers — not by the guard.
