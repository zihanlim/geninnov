# ADR-0203: A replaced book does not un-publish its picks

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0093](0093-a-published-book-that-changes-must-say-so.md), [ADR-0040](0040-published-book-is-the-book-of-record.md), [ADR-0202](0202-a-claim-about-which-book-is-not-a-table-read.md), [ADR-0198](0198-a-source-line-is-a-claim-about-the-schema.md)

## Context

`/attribution` reads **"80 claims · 8 books"**. `/book` for 2026-07-30 shows **9** positions.
`pick_outcomes` for that run_date holds **13** rows. A reader trying to reconcile the
headline figure of the forward track record against the books it claims to score could not,
and nothing on the page explained the gap.

It is not a one-off:

| run_date | `pick_outcomes` rows | published picks | not in the published book |
|---|---:|---:|---:|
| 2026-07-30 | 13 | 9 | **4** — ARKK, JD, MSFT, NUE |
| 2026-07-29 | 15 | 9 | **6** |
| 2026-07-28 | 14 | 9 | **5** |
| 2026-07-27 | 15 | 10 | **5** |
| 2026-07-25 and earlier | 10, 9, 2, 2 | 10, 9, 2, 2 | 0 |

**20 of ~80 claims — a quarter of the denominator — belong to books that are not the book of
record for their own date**, and it starts abruptly on 07-27.

`book_revisions` says why, in its own words:

```
run_date 2026-07-30 · field picks[] · trigger_type pipeline_rerun
reason "Unattributed pipeline re-run: the daily job persisted a second book for
        this run_date, replacing the one above"
revised_at 2026-07-30 22:55:59
```

And the row timestamps corroborate it: `pick_outcomes` for 07-30 was written in two batches,
`08:43` and `22:56`. The pipeline runs twice on those dates. Each run writes its picks to
`pick_outcomes` at publication — which is ADR-0090's design, rows `pending` before any
outcome exists — while the second run's upsert **replaces** the book in
`research_recommendations` on `(run_date, lens)` and never touches the first run's outcome
rows. So `pick_outcomes` accumulates the *union* of every book ever published for a date,
and `research_recommendations` retains only the last.

ADR-0093 already built `book_revisions` to make exactly this visible, and it worked — the
revision is logged, with a reason, NOT NULL by constraint. What no surface did was connect it
to the track record whose denominator it moves.

## Decision

**Count the superseded claims and say so. Do not remove them.**

The obvious fix is to drop the four rows, and it is wrong for the reason ADR-0090 exists:

> *Rows are `pending` at publication so the denominator precedes the outcome.*

The point of that sequencing is that **a pick cannot leave the denominator once it looks
bad**. A rerun that silently removed picks would be precisely that hole, reached by a
different route — and it would be a hole with an innocent-looking cause, which is worse than
an obvious one. "The book was later replaced" is not a reason the claim was never published.
It *was* published; a reader could have acted on it; ADR-0040 makes the published book the
book of record and does not make it retroactively unpublished.

Deleting them would also make the record **flattering in a way nobody could audit**: the
picks a rerun drops are, on average, the ones the rerun thought worse.

So:

### 1. `superseded` is a counted, disclosed field — never a filter

`buildTrackRecord(rows, horizonDays, publishedByRunDate?)` gains
`superseded: number | null`. `total` is unchanged and still includes them. The header states
`80 claims · 8 books · incl. 20 from books later replaced`, with the full cause in its
`title`.

### 2. Null, not zero, when unknown

Three states, and only the first two were previously distinguishable anywhere:

- map supplied, asset absent from that run_date's book → **superseded**
- map supplied, asset present → **not superseded**
- **no map, or that run_date not in it → unknown**, contributes nothing

A run_date the map does not cover contributes **zero**, not all of its rows — counting an
unmapped date as wholly superseded would manufacture a large figure out of missing data. And
a failed read yields an **empty map** rather than a partial one, so the panel degrades to
"not stated" rather than to the much more confident "none superseded".

### 3. The published set comes from `book_holdings`

It needs the book for *every* run_date, and `book_holdings` is already one row per
`(run_date, lens, asset)`, so the answer is a two-column select. Pinned to `multi_asset` like
every other read on the phase (ADR-0194).

This is **the tree's first frontend read of `book_holdings`**, and it tripped
`lens-qualified-reads.test.ts`'s assertion that *"book_holdings has no direct frontend reader
today"*. That assertion's own comment specified the remedy — *"a NEW read of book_holdings was
added and must be lens-qualified"* — so it now pins the rule that always mattered instead of
the incidental count, plus a **non-vacuity assertion**, because a rule expressed as a `for`
loop over matches passes while asserting nothing when there are none. That is how the previous
version could have gone on passing after the reader landed, had it been written as the rule
rather than as the count.

## Consequences

**Good.**

- The headline figure is reconcilable against `/book` for the first time.
- The anti-cherry-picking property of ADR-0090 is preserved *and* now stated, rather than
  being quietly true and unexplained.
- ADR-0093's revision log is connected to the surface it affects.
- 7 tests over the real 2026-07-30 fixture, the decisive one being that `total` does **not**
  shrink.

**Costs, stated.**

- **The count is disclosed, the cause is not repaired.** The pipeline still writes outcome
  rows for a book it is about to replace. The durable fix belongs in
  `scripts/resolve_outcomes.py` or the persist path — either void the superseded rows with a
  `void_reason` (they have one: the schema already carries the column) or write outcomes only
  for the book that survives the run. Both are backend decisions with a track-record
  contract attached, and neither is a render fix.
- **`superseded` is derived at read time**, so it is a property of what `book_holdings`
  currently says, not a fact recorded when the supersession happened. If `book_holdings` were
  ever backfilled or repaired, the figure would move.
- The disclosure is in a card header's `title` for its detail. A reader who does not hover
  gets the count and the phrase, which is the actionable part, but not the mechanism.

**Rejected.**

- **Deleting the superseded rows.** The whole of §1.
- **Excluding them from `total` while keeping them in the table.** Same defect with extra
  steps: the denominator is the number that matters, and a table whose rows do not sum to its
  own headline is worse than either honest option.
- **Voiding them from the frontend.** `verdict`/`void_reason` are the pipeline's to write; a
  page that mutates the record it reports on is not a report.
- **Reading `research_recommendations.picks` per run_date instead.** It would need one row per
  date and a JSON walk to get the same set `book_holdings` stores relationally.

## Not settled here: two tables disagree about GLD

Found while fixing an unrelated label, and left open deliberately.

| source | GLD's theme |
|---|---|
| `research_recommendations.picks[]` (2026-07-30, multi_asset) | **Geopolitical Risk** |
| `portfolio_positions` (same run_date) | **Fed Policy** |

Every other name agrees. ADR-0040 makes the published picks the book of record, so anything
reader-facing should follow them — and the `not sized →` label added in the same commit does.
But `portfolio_positions.theme_id` is what `BookBody`'s `posEdgeByAsset` fallback reads, what
`AbstentionRoster` used before ADR-0039 moved it off, and what any positions→themes join
gets. One asset attributed to two themes by two tables written in the same run is a
**backend** inconsistency between L1 (which writes positions) and L5 (which writes picks),
and fixing it needs a decision about which layer owns the mapping. It is not a frontend edit
and is not made here.
