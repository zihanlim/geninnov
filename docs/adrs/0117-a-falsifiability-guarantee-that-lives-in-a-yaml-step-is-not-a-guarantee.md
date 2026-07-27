# ADR-0117: A falsifiability guarantee that lives in a YAML step is not a guarantee

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0040](0040-check-the-published-book-do-not-assume-it.md), [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md)

## Context

[ADR-0090](0090-a-published-pick-must-be-falsifiable.md) gave every published pick a falsifiable claim, and its first job is the important one — stated in `resolve_outcomes.py`'s own docstring:

> **RECORD THE COMMITMENT.** Every published pick gets a row as soon as its book exists, so the denominator is fixed before any outcome is known. A scored set assembled after the fact can quietly omit the calls that went wrong; this cannot.

That is the property the whole track record rests on. **Nothing enforced it on the path that publishes.**

The only writer of `pick_outcomes` was `scripts/resolve_outcomes.py`, invoked as a **sibling step in `.github/workflows/daily-refresh.yml`**, after `daily_refresh.py`. So a book published any other way — a manual `python -m scripts.daily_refresh`, a `workflow_dispatch` that failed between the two steps — published claims that nothing ever recorded.

It had already happened. Measured on 2026-07-27:

```
book         published   recorded
2026-07-22       2           2
2026-07-23       2           2
2026-07-24       9           9
2026-07-25      10          10
2026-07-27       9           0     <-- today's book
```

**Nine of thirty-two published claims (28%) had no row and would never have been graded.** They were invisible in exactly the way that matters: the track-record panel counts what *is* recorded, so a missing claim does not appear as a gap — it appears as a smaller, tidier denominator.

The bar this sits under is GOAL.md's fourth, *"a bet the market grades must change something."* It was recorded as blocked until 2026-08-20, the first maturity date. That was the wrong reading. The **content** is blocked by the calendar; the **guarantee** was broken today, and would have quietly produced a track record covering four of five books on the day the calendar came good.

## Decision

**The path that publishes a claim records it.**

`pick_outcomes.commitment_rows` turns published picks into `pending` rows, and `daily_refresh` calls it immediately after the L5 book persists. `resolve_pick` on an empty price series already returns `pending`, so this needs **no network and no prices** — which is the point. Recording cannot fail for the reasons fetching prices can, so publication and commitment succeed or fail together.

**Insert-if-absent, never upsert.** `resolve_outcomes.py` upserts because its job is to turn a `pending` row into a verdict. This must do the opposite: re-running an older `run_date` would otherwise write `pending` over a resolved `hit` and destroy the outcome. `ignore_duplicates=True` makes "already recorded" a no-op — the only safe direction for a write that is not looking at prices. `test_a_pending_row_never_overwrites_a_verdict` pins the conflict key against a resolved row.

**It never raises.** A book published but unrecorded is bad; a book that fails to publish because its bookkeeping fell over is worse. The failure prints a repair command, and the guard below fails on it independently.

**And the guard checks it, because a guarantee nothing verifies is a hope.** `check_data_integrity.check_published_claims_are_on_the_record` compares the published book's picks against the rows that exist for that `run_date` and names the missing ones. This is [ADR-0040](0040-check-the-published-book-do-not-assume-it.md) applied to bookkeeping rather than to prose: *check the published book, do not assume it.* It also catches the subtler case the fix alone cannot — recording that runs but writes fewer rows than the book has picks.

**`resolve_outcomes.py` is unchanged** and remains the repair path and the resolver. Two writers is correct here: one records at publication, one grades at maturity, and they agree because they build rows through the same `resolve_pick`.

## Consequences

**The 2026-07-27 book was repaired**, using `commitment_rows` itself to generate the rows so the repair and the fix cannot diverge. All five books now reconcile: 32 published, 32 recorded, all `pending`, first maturity 2026-08-25 for today's book.

**Bar 4's remaining blocker is genuinely the calendar, and now only that.** The earliest book is 2026-07-22 and the horizon is 21 trading days, so nothing can resolve before 2026-08-20. There is no older history to backfill — a backfill was considered and is impossible, not merely unwise. What changed is that when that date arrives the denominator will be complete.

**Backfilling *pending* rows does not violate ADR-0090.** The principle is that the denominator precedes the *outcome*, not that the row precedes the *day*. Recording a claim whose horizon has not matured adds no information about how it did, so there is no selection freedom to abuse. Backfilling **resolved** rows would be a different act entirely and is not what happened here.

**This is the third instance of one failure shape**, and worth naming as such: [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md) (a computed signal nothing consumed), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md) (a guard that protected one of several readers), and now a guarantee that lived in a workflow step rather than in the code it guaranteed. The common tell is a property asserted in a docstring and enforced somewhere else. Grep for the assertion, then check who actually calls it.

**What it does not do.** It does not record claims for a book published by a path that bypasses `daily_refresh` entirely. Nothing does that today; if something ever does, the guard is what will say so.
