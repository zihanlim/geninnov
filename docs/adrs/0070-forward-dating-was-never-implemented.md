# ADR-0070 — Forward-dating was never implemented; the convention was inferred from a bug

**Date:** 2026-07-25
**Status:** Accepted — **corrects the convention described in [0062](0062-run-date-is-not-a-write-timestamp.md)**
**Relates to:** [0062](0062-run-date-is-not-a-write-timestamp.md), [0069](0069-run-date-is-utc-not-the-local-clock.md), [0040](0040-published-book-is-the-book-of-record.md)

## Context

[ADR-0062](0062-run-date-is-not-a-write-timestamp.md) states the pipeline's dating
convention:

> **`run_date`** — the market/trading date the run is *for*. It is **forward-dated**:
> the job that runs on the evening of 2026-07-24 (UTC) produces the book *for*
> 2026-07-25.

[ADR-0069](0069-run-date-is-utc-not-the-local-clock.md) then changed `main()` from
`date.today()` to the UTC date, to stop ad-hoc local runs disagreeing with the scheduled
job. **That change contradicts the sentence above**, and the contradiction was not noticed
when it was made — which is reason enough to check which one the code has actually been
doing.

Every `L0` run on record, against the UTC date of its own start:

| started (UTC) | UTC date | `run_date` | |
|---|---|---|---|
| 2026-07-23T22:30:15 | 2026-07-23 | **2026-07-23** | == UTC date |
| 2026-07-24T21:43:05 | 2026-07-24 | **2026-07-25** | forward +1 |
| 2026-07-24T22:34:08 | 2026-07-24 | **2026-07-24** | == UTC date |

**The only forward-dated run in the entire history is the middle one — an ad-hoc local
run from a UTC+8 machine**, where `date.today()` had already rolled over. The scheduled
job, running on a UTC runner, has always stamped its own UTC date. `date.today()` on a
UTC runner *is* the UTC date; there was never any code that added a day.

**So the convention in ADR-0062 was inferred from a bug.** That ADR was written on
2026-07-25, while the artifact rows my local runs had just created were the freshest data
in the table. Seeing `run_date` 2026-07-25 on data written at 2026-07-24T20:13Z is exactly
what forward-dating would look like — and it is also exactly what a UTC+8 machine calling
`date.today()` looks like. The reading was reasonable and wrong.

## Decision

**`run_date` is the UTC date of the run. It is not forward-dated, and never was.**
[ADR-0069](0069-run-date-is-utc-not-the-local-clock.md)'s change stands, and its rationale
is strengthened rather than weakened by this: it makes every machine agree with what the
scheduled job has done since the beginning.

**ADR-0062's *fix* is untouched and remains correct.** Sourcing the landing header from
`pipeline_runs.run_date` rather than `themes.updated_at` was right for reasons that have
nothing to do with forward-dating: a write timestamp is not a run identifier. Only the
*description* of what `run_date` means is corrected here. Its status line is annotated to
point at this ADR rather than being rewritten, following the precedent of
[ADR-0052](0052-a-stall-cost-three-attempts-not-one.md) correcting 0051.

**Nothing is renamed and no rows are rewritten.** The single forward-dated artifact
(`run_date` 2026-07-25, written 2026-07-24) stays until the scheduled run of 2026-07-25
overwrites it by upsert. Deleting a real book to tidy an identifier would be the larger
error.

## Consequences

- **If forward-dating is ever actually wanted, it now has to be built and argued for.**
  There is a case for it — the evening job produces a book you would trade the next
  session — but it would be a deliberate `+1 business day`, not an accident of the
  writer's timezone, and it would need to handle weekends and holidays. Recorded as an
  option, not a plan.
- **A one-day window remains** in which the artifact row at 2026-07-25 outranks correctly
  dated 2026-07-24 rows in every `order("run_date", desc=True)` query. `/risk`'s ADR-0040
  reconciliation covers the page in the meantime, which is exactly the case it was built
  for.
- **The general lesson is the sharp one: a convention read off live data is only as
  trustworthy as the data.** Two agents working the same repo produced an artifact, and
  the artifact was then written down as intent in an accepted ADR. The check that caught
  it was comparing every historical `run_date` against the UTC clock of its own run —
  three rows, one query, and the story reversed. **Derive a convention from the code and
  its history, not from the newest row.**
