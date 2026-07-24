# ADR-0069 — `run_date` is UTC, not the local clock

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0062](0062-run-date-is-not-a-write-timestamp.md), [0040](0040-published-book-is-the-book-of-record.md), [0037](0037-position-limits-bind-and-the-rest-is-cash.md)

## Context

Re-deriving the live state found `portfolio_positions` and
`research_recommendations` on **different run dates**:

| table | run_date | rows |
|---|---|---|
| `research_recommendations` | **2026-07-25** | 9 picks |
| `portfolio_positions` | **2026-07-24** | 38 |
| `portfolio_positions` | 2026-07-25 | **0** |

`/risk` therefore computed every statistic — VaR, beta, HHI, attribution, cap
utilisation — on 38 positions dated 07-24, beneath a header reading
**RUN DATE 2026-07-25**.

**The cause is that `main()` stamped `run_date = date.today()`, the LOCAL calendar
date.** The scheduled job (`daily-refresh.yml`, `30 21 * * 1-5`) runs on a **UTC**
runner, so it stamps the UTC date. A local run from a **UTC+8** machine at 06:00 is *the
same instant* as 22:00 UTC the previous day, and `date.today()` returns **tomorrow's**
date relative to the scheduled run:

```
utc_run_date() = 2026-07-24      # what the scheduled job stamps
date.today()   = 2026-07-25      # what a local SGT run stamped
utc now        = 2026-07-24T22:47
```

So the two writers disagreed by a day, and alternating between them left the book from
one date beside positions from the other. Every ad-hoc local run this session has been
stamping a date the scheduled job would never produce.

**This was caught by an existing check, not by a test.** Iteration 32's ADR-0040
reconciliation compares position *count* against the published picks, and the page said
*"THESE ARE PROVISIONAL POSITIONS, NOT THE PUBLISHED BOOK — 38 held · 9 published."* The
warning was right, and it was the only reason anyone looked. But it describes the
*symptom* — a count mismatch — and would have read identically if the pipeline had simply
been mid-run, which is the ordinary case it was built for. **The date disagreement
underneath it was invisible.**

## Decision

**`run_date` is the UTC date.** `utc_run_date()` returns
`datetime.now(timezone.utc).date()` and `main()` uses it.

- **This changes nothing about the scheduled run**, which already effectively used UTC.
  It brings ad-hoc local runs into line with it, from any machine in any zone.
- **UTC is also the right trading date**, not merely a convenient one: 21:30 UTC is
  17:30 ET, the same calendar day in both zones, so the run is stamped with the US
  session it follows. That keeps
  [ADR-0062](0062-run-date-is-not-a-write-timestamp.md)'s forward-dating intact — the
  evening job still produces the book *for* the next session — while removing the
  writer's own timezone from the identifier.
- **Scoped to the pipeline's run identifier.** Other `date.today()` uses — news
  look-back windows, backtest ranges, discovery cutoffs — are durations rather than
  keys, and a one-day shift in them is not a correctness problem. Changing them was
  considered and rejected as churn.

## Consequences

- **Two writers can no longer disagree about which day it is.** The split state that
  prompted this is not reachable from a timezone difference again; a count mismatch now
  means what it was built to mean — a run genuinely in progress.
- **Verified by running it**: `utc_run_date()` returns `2026-07-24` on a machine whose
  `date.today()` is `2026-07-25`, matching the scheduled job exactly.
- **The regression test asserts the source, not the value.** Comparing
  `utc_run_date()` against `date.today()` passes on any UTC runner — which is where CI
  runs — so it could never catch a reversion. The test reads the function body instead,
  and deliberately strips the docstring first, because the docstring *mentions*
  `date.today()` to explain the bug.
- **Left open and named:** the existing rows are not rewritten. `portfolio_positions`
  holds 07-24 and the published book 07-25 until the next run reconciles them, and the
  ADR-0040 warning correctly covers the page in the meantime. Backfilling a run identifier
  would be rewriting history to match a convention adopted after it.
