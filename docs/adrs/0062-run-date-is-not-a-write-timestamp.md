# ADR-0062 — A run's date is its run_date, not the timestamp a row was written

**Date:** 2026-07-25
**Status:** Accepted (the FIX stands; the **forward-dating description is corrected by [0070](0070-forward-dating-was-never-implemented.md)** — run_date is the UTC date of the run and was never forward-dated)
**Relates to:** [0040](0040-published-book-is-the-book-of-record.md), [0041](0041-regime-as-a-dial-not-a-cliff.md)

## Context

The landing page — **"What we're watching"**, the first screen a reviewer sees and the
Q2 showcase — carried a wrong date. Its header read **RUN DATE 2026-07-24** and **LAST
PIPELINE RUN 2026-07-24** above theme data that was in fact the **2026-07-25** run:
US Election HypeScore **60.1** is the 07-25 value (07-24 was 58.4). Three lines below,
the same page's status bar correctly read **"Last run 2026-07-25"**. The landing header
contradicted its own page — and `/method` and `/book`, which both date the run
2026-07-25.

The cause is a confusion between two dates that this pipeline deliberately keeps
distinct:

- **`run_date`** — the market/trading date the run is *for*. It is **forward-dated**:
  the job that runs on the evening of 2026-07-24 (UTC) produces the book *for*
  2026-07-25. This is the canonical run identifier, and it is what the status bar,
  `/method`, and `/book` all display.
- **write timestamps** (`themes.updated_at`, `pipeline_runs.finished_at`) — the
  wall-clock instant a row was written, e.g. `2026-07-24T20:13Z`. Hours earlier, and
  on the previous calendar day.

The landing header sourced **RUN DATE** from `themes.updated_at` and **LAST PIPELINE
RUN** from `finished_at` — both write timestamps — so it rendered 07-24 while the data
it labelled was the 07-25 run. `themes.updated_at` compounded it: the row held the
07-25 hype scores yet its `updated_at` still read 07-24T20:13, so it was not even a
reliable write time.

## Decision

**Label a run by its `run_date`; measure its freshness by a write timestamp.** These
are two questions — *what date is this data for?* and *how long ago was it written?* —
and they need two different fields.

- **RUN DATE** and **LAST PIPELINE RUN** now display `pipeline_runs.run_date`
  (2026-07-25), the same canonical identifier every other surface uses.
- **"Updated N ago"** freshness is measured from `pipeline_runs.finished_at`, the real
  execution instant.

The split is not cosmetic. `run_date` is a bare date with no time, so `new
Date("2026-07-25")` resolves to midnight UTC — which is in the *future* relative to a
20:13Z finish. Measuring age from it clamps to 0 and reads **"just now"** over data
that is hours old. Freshness must come from a timestamp; the date must come from
`run_date`. Both decisions live in `frontend/lib/homeFreshness.ts` as pure functions,
unit-tested including that exact clamp trap.

## Consequences

- The landing page now agrees with itself and with the rest of the site: RUN DATE,
  LAST PIPELINE RUN and the status bar all read the same canonical run_date, and the
  freshness label still reports real recency.
- The generalisable rule, and why this is an ADR: **a `run_date` and a write timestamp
  are not interchangeable, and a forward-dated run_date makes substituting one for the
  other visibly wrong.** Anywhere a surface needs "the date of this run", it must read
  `run_date`, never `updated_at`/`finished_at`. Anywhere it needs "how stale is this",
  it must read a timestamp, never `run_date`.
- `themes.updated_at` lagging its own `hype_score` is a separate, smaller data-writing
  wrinkle (the row's score is refreshed without bumping `updated_at`). It no longer
  affects any displayed date, so it is left as a note rather than chased here.
