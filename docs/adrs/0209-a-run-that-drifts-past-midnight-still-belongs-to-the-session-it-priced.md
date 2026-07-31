# ADR-0209: A run that drifts past midnight still belongs to the session it priced

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0069](0069-run-date-is-utc-not-the-local-clock.md), [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0203](0203-a-replaced-book-does-not-un-publish-its-picks.md), [ADR-0205](0205-a-claim-is-resolved-from-the-record-not-from-what-is-still-published.md)

## Context

Asked whether the pipeline's schedule should move, given the operator works in SGT
(UTC+8). Investigating produced a different answer to a different question: **the schedule
is right and the date derivation is fragile.**

[ADR-0069](0069-run-date-is-utc-not-the-local-clock.md) made `run_date` the UTC date after
a live split — a local UTC+8 run wrote a 9-pick book at `2026-07-25` while the scheduled
run wrote 38 provisional positions at `2026-07-24`, and `/risk` computed every statistic on
positions from one date under a header naming the other. It justified UTC with:

> *21:30 UTC is 17:30 ET, the same calendar day in both zones.*

**That holds only for a run that fires on time.** GitHub cron does not guarantee it.
Measured starts:

| run_date | slot | actual start | drift |
|---|---|---|---|
| 2026-07-30 | 21:30 UTC | **22:35 UTC** | +65 min |
| 2026-07-29 | 21:30 UTC | **22:28 UTC** | +58 min |

So the job runs about an hour late as a matter of course, leaving roughly **90 minutes**
before 00:00 UTC. A run that used the rest of that headroom would stamp the **next** date
while pricing the **same** session's close — labelling Thursday's book Friday.

That is not a cosmetic mislabel. ADR-0090 anchors the forward record's entry to *"the close
on `run_date`… the last price it could have acted on"*. A book stamped Friday but built
from Thursday's data has its claims scored against a price it never saw — the same defect
that produced the 20 superseded claims of ADR-0203, arriving by a different route.

### Why the schedule itself should not move

The slot is bounded on both sides:

- **after 21:00 UTC** — the US close is 21:00 UTC under EST and 20:00 UTC under EDT, so
  anything earlier fires *before* the close for the four months of EST. (An earlier draft of
  this recommendation suggested 20:30 UTC to buy rollover headroom. It is wrong for exactly
  this reason and was withdrawn.)
- **before 00:00 UTC** — the date boundary above.

21:30 UTC sits near the middle of that window: 30 minutes of clearance on the winter close,
~90 on the rollover after observed drift.

And on the original question: **21:30 UTC is 05:30 SGT every day of the year**, because
neither zone observes DST. The operator's local time is fixed while the US close moves
under it (04:00 SGT in summer, 05:00 in winter) — which is the property you want, and the
opposite of what re-anchoring to SGT would give. Any SGT-morning slot is 00:00–04:00 UTC,
past the date boundary, so it would stamp the *following* date while pricing the previous
close: the very bug this ADR fixes, installed deliberately.

## Decision

**When the run is past UTC midnight but New York is still on the previous day and that
day's close has passed, the book belongs to the New York date. Otherwise the UTC date,
unchanged.**

`zoneinfo`, not a fixed offset — the close is 20:00 UTC under EDT and 21:00 under EST, and
only the tz database knows which applies on a given date. Tested across the 2026-03-08
boundary for that reason.

### Deliberately narrow

It corrects the drift case and nothing else. Three exclusions, each pinned by a test:

1. **An on-time scheduled run is byte-identical, both sides of DST.** 21:30 UTC is 17:30
   EDT / 16:30 EST — the same calendar day in both zones either way, so the correction
   never fires on the path that matters most.
2. **A mid-morning ad-hoc run still stamps today.** Under a fuller *"the trading date whose
   close has passed"* rule it would stamp **yesterday** — truthful about the price it is
   built from, but it would then **overwrite a settled, already-published book** whose
   claims may be resolving, deleting that day's `book_holdings` and rewriting
   `portfolio_positions`. Creating a premature row for *today* is the lesser harm, and
   ADR-0203/0205 already grade and disclose the superseded claims that result. Pinned so
   the "improvement" is not made accidentally later.
3. **Holidays are not handled.** There is no market calendar here, so a run on Thanksgiving
   stamps Thanksgiving. Unchanged from before, and now stated rather than implied.

### One redundant guard, kept on purpose

The `>= close` condition is provably true whenever the dates differ: New York is UTC−4/−5,
so a UTC date ahead of the NY date puts NY between 18:00 and 23:59. It is kept because it
states the **reason** — the session this run follows has closed — rather than leaning on an
offset that a tz-database change would silently invalidate.

## Consequences

**Good.** A drifted run can no longer mislabel a book, so ADR-0090's entry-price rationale
holds regardless of when the runner gets to the job. The schedule question is answered
without touching the schedule, and a future schedule change is safer because the date no
longer depends on when the job happens to start.

**A test was about to become time-of-day flaky, and that is worth recording.**
`test_run_date_is_utc_not_the_local_calendar_date` compared the helper against the live
clock. After this change that assertion holds *only* when CI runs outside 00:00–05:00 UTC —
it would have passed for months and then failed for reasons unrelated to any commit. It now
passes explicit instants, including 22:00 UTC on the 24th (= 06:00 SGT on the 25th), the
exact instant behind ADR-0069's split.

**Costs, stated.**

- **The window is still finite.** ~90 minutes of drift is corrected; a run delayed past the
  *next* close would still be wrong, and nothing detects that. Ordinary Actions queuing is
  minutes-to-an-hour, so this is a real but distant bound.
- **`utc_run_date` is now a slightly inaccurate name** — it returns the UTC date *except*
  in the drift window. Kept because the alternative (`market_run_date`) would imply a
  market-calendar semantics this explicitly does **not** have: no holidays, and daytime runs
  unchanged. An accurate-sounding name over an inaccurate implementation is the worse trade.
- **Two behaviours remain imperfect and are now documented rather than fixed**: the
  Thanksgiving case, and the mid-morning ad-hoc run.

**Rejected.** Moving the cron earlier (fires before the EST close); moving it to an
SGT-convenient hour (00:00–04:00 UTC — installs the bug deliberately); the fuller
close-has-passed rule (§Deliberately narrow, item 2); and deriving `run_date` from the cron
expression rather than the clock, which would be correct for the scheduled run and undefined
for every manual one — and ADR-0117 makes manual runs first-class publications.
