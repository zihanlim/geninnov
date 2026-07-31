# ADR-0210: A book published when the market was shut still has an entry price

**Status:** Accepted
**Date:** 2026-08-01
**Related:** [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0209](0209-a-run-that-drifts-past-midnight-still-belongs-to-the-session-it-priced.md), [ADR-0205](0205-a-claim-is-resolved-from-the-record-not-from-what-is-still-published.md), [ADR-0203](0203-a-replaced-book-does-not-un-publish-its-picks.md), [ADR-0117](0117-a-falsifiability-guarantee-that-lives-in-a-yaml-step-is-not-a-guarantee.md), [ADR-0066](0066-not-computable-must-persist-as-null.md)

## Context

[ADR-0205](0205-a-claim-is-resolved-from-the-record-not-from-what-is-still-published.md)
made every recorded claim reachable by a resolve pass. Reading the table afterwards to
confirm it, the verdict distribution was **70 pending, 10 void, 0 resolved** — and all ten
voids were one `run_date` with one reason:

```
2026-07-25  ARKK BABA GDX NOC NUE PDD SHY SVXY UNH XLE
            verdict=void   void_reason='no close on run_date 2026-07-25'
```

**2026-07-25 is a Saturday.** Those are ten of the most liquid instruments on the US tape,
and every one of them has a Friday 2026-07-24 close (verified against the price series:
bars exist for 07-20 through 07-24 and 07-27 onward, and none for 07-25, exactly as a
weekend should have none). Nothing was wrong with the prices. The book was published on a
day the market never opened, and `resolve_pick` looked for a bar stamped with that date:

```python
entry = next(((d, p) for d, p in series if d == run_date), None)   # the defect
```

So **an eighth of the forward record was void for a calendar reason**, on the table whose
ADR is titled *"a published pick must be falsifiable"* — and `void` is terminal, so it
would have stayed that way.

### The rule was never "the close on run_date"

ADR-0090 and the module docstring both write it as *"the close on run_date — the last
price observable when the book was published, and therefore the only honest entry."*
[ADR-0209](0209-a-run-that-drifts-past-midnight-still-belongs-to-the-session-it-priced.md)
quotes the same rule as *"the close on run_date, the last price it could have acted on"*.
The clause after the dash is the rule; the phrase before it was a description of the
ordinary case, in which `run_date` is a trading day and the two coincide.

On a Saturday they diverge, and the clause is unambiguous about which one wins: the last
price a Saturday book could have acted on is **Friday's close**. The implementation was
therefore wrong against its own stated rationale, not faithful to a rule we are now
changing. That distinction decides the `SPEC_VERSION` question below.

### Why this recurs, and on the automated path

A Saturday `run_date` needs no mistake to arise. `CLAUDE.md` documents manual runs against
production, `workflow_dispatch` is enabled, and
[ADR-0117](0117-a-falsifiability-guarantee-that-lives-in-a-yaml-step-is-not-a-guarantee.md) makes a manual
`python -m scripts.daily_refresh` a first-class publication — deliberately, so that no
book can be run unrecorded. 2026-07-25 is simply what a weekend run looks like.

The **scheduled** path walks into it too, and worse. The cron is `30 21 * * 1-5`, and
**GitHub cron has no market calendar**: it fires on Thanksgiving Thursday, on Christmas Day
and Independence Day when they fall midweek, on Labor Day Monday. Each of those would have
voided that day's entire claim set.
[ADR-0209](0209-a-run-that-drifts-past-midnight-still-belongs-to-the-session-it-priced.md)
saw this and explicitly declined to fix it there — *"holidays are NOT handled, so a
Thanksgiving run stamps Thanksgiving, unchanged but now stated."* That was the right call
at that layer, and it is what makes this the right layer: `run_date` should keep honestly
recording **when the book was published**, and the market calendar belongs to the question
**what price the book could have acted on**. The two facts are different and now live in
different places.

## Decision

**The entry is the last close at or before `run_date`, reaching back at most
`ENTRY_LOOKBACK_DAYS = 4`.**

```python
floor = run_date - timedelta(days=ENTRY_LOOKBACK_DAYS)
entry = next(((d, p) for d, p in reversed(series) if floor <= d <= run_date), None)
```

On a trading `run_date` this finds that day's own close and is identical to the equality
test it replaces. On a non-trading one it finds the prior session's.

### The bound is the point, and it is derived

An unbounded look-back would be a worse bug than the one it fixes. The two errors are
asymmetric, and only one of them is recoverable:

| | consequence |
|---|---|
| too **tight** | a long-weekend book voids its claim set for a calendar reason — this defect, narrower. Terminal, so unrecoverable. |
| too **loose** | a **delisted** name whose series stopped months ago is entered at whatever it last printed, and graded. That fabricates a hit or a miss. |

A fabricated verdict is strictly worse than a void: `void` is honest about not knowing,
a stale-price hit is a number that looks real and enters the published hit rate. So the
bound is the longest gap the calendar can put between `run_date` and the preceding
session, and no more. Enumerated over the NYSE calendar, the worst case is **3 calendar
days**:

| `run_date` | prior session | gap |
|---|---|---|
| Sat 2026-07-25 | Fri 07-24 | 1 |
| Thu 2026-11-26 (Thanksgiving) | Wed 11-25 | 1 |
| Sun 2026-07-26 | Fri 07-24 | 2 |
| Mon 2026-09-07 (Labor Day) | Fri 09-04 | 3 |
| Sun 2026-04-05 (after Good Friday) | Thu 04-02 | 3 |
| Sun 2026-12-27 (after Christmas Fri) | Thu 12-24 | 3 |

**4** is that maximum plus one day of margin. Past it, a missing bar is a data problem
rather than a calendar one, and `void` is the correct answer — which is what keeps the
delisted case working. Three parametrised cases pin the boundary at 3 / 4 / 5 days, and
the 5-day case asserts `entry_price is None` rather than merely a `void` verdict, because
the failure mode being excluded is a price sneaking in, not a verdict.

### The fetch window moves with it

`resolve_pass` downloaded prices from `earliest_run_date(...)`. A window starting **at**
the earliest `run_date` cannot contain the bar before it, so for a non-trading earliest
`run_date` the fix would find nothing to enter at. The download is padded by exactly
`ENTRY_LOOKBACK_DAYS`.

This half is invisible to a unit test, and that is worth stating plainly: a `resolve_pick`
test hands the function a series it constructed itself, so it is free of the download's
boundary and passes either way. Fixing only the lookup would have produced a green suite
and a still-voiding earliest book. It is pinned instead by a test that spies on the `start`
argument the resolver actually passes.

### `SPEC_VERSION` is NOT bumped

This is the consequential half of the decision, and the argument is the one from the
Context: the written spec has always been *"the last price it could have acted on"*, and
the equality test failed to implement it. **Repairing an implementation to match its
documented rule is not a change to the rule.**

The alternative was considered and is worse in a way that matters. `spec_version` is in
the conflict key, and
[ADR-0205](0205-a-claim-is-resolved-from-the-record-not-from-what-is-still-published.md)
made a resolver refuse to grade a foreign spec. So bumping to `v2` would:

- freeze the ten falsely-void `v1` rows permanently — they are terminal, and no `v2`
  resolver will look at them;
- leave the seventy pending `v1` rows to be graded by a `v1` resolver that no longer
  exists, i.e. never;
- **preserve the bug in the record as the record's own history** while claiming to have
  fixed it.

A bump is the honest move when the exam changes. Here the exam did not change; the marker
misread it.

### The ten rows are repaired separately, and deliberately not by the nightly path

Pass 2 reads `verdict = 'pending'`, and that filter is load-bearing — it is what stops a
yfinance outage writing `pending` with NULL prices over a resolved `hit`
([ADR-0117](0117-a-falsifiability-guarantee-that-lives-in-a-yaml-step-is-not-a-guarantee.md)'s rule, applied to the
resolver's own upsert). Relaxing it so the nightly job re-visits terminal rows would
re-arm exactly that erasure to fix ten rows once.

So the repair is a **separate, narrowly-keyed, disclosed act**, not a general
re-grade-terminal-rows capability. It is keyed to the specific `void_reason` this defect
produced over a `run_date` with no session — a row that is *provably* a victim, and
nothing else is. It cannot touch a legitimately-void row (different reason text), cannot
touch a `hit`/`miss`/`flat`, and expires on its own: after this change no new row can be
written with that reason for a non-trading day.

### Addendum 2026-08-01 — the repair, as run

`scripts/repair_calendar_voids.py`, dry-run by default. Applied once, measured:

| | before | after |
|---|---|---|
| rows in `pick_outcomes` | 80 | **80** — the denominator did not move |
| verdicts | 70 pending, 10 void | **80 pending** |
| `void_rate` (published) | **1.0 — "the spec could not score any of what matured"** | n/a, nothing has matured |

All ten entered at the Friday 2026-07-24 close (UNH 420.74, XLE 59.62, NOC 542.24 — cross-checked
against an independent price pull), `void_reason` and `resolved_at` cleared. `pending` is the
correct destination: they mature 2026-08-24 and the nightly resolver grades them there, by
the ordinary path. Verified idempotent both ways afterwards — the resolver re-voids none of
them, and the repair itself finds nothing on a second run because its predicate is anchored
to a string the fixed code cannot emit.

## Consequences

- **An eighth of the forward record becomes gradeable.** The ten 07-25 claims mature
  2026-08-24 and will carry real verdicts. `void_rate` — denominated in matured picks —
  stops publishing *"the spec could not score a fifth of what matured"* about picks the
  spec scores perfectly well.
- **`void` now means what it says.** Before this, the modal void in the table was a
  calendar artefact, so the column could not be read as a data-quality signal at all.
- **A weekend or holiday book is graded against the prior session's close**, which is
  slightly *more* conservative than a same-day close would be: the book has been sized
  against information from that session and is entered at that session's price.
- **The horizon is unchanged.** The exit is still the 21st observation after `run_date`,
  not after the entry bar — provably the same set, since no bar can lie strictly between
  the last bar at or before `run_date` and `run_date` itself. A Saturday book is therefore
  not silently graded over a shorter window than a Friday one; a test pins the exit date.
- **A gap longer than 4 days still voids**, and the reason now names the window searched
  (`no close for X in D1..D2`) rather than a bare date. The old wording was true and
  useless: it read as a fact about the name when it was a fact about the calendar, which
  is why ten rows sat mislabelled for six days.
- **`ENTRY_LOOKBACK_DAYS` is US-calendar-specific.** It is derived from NYSE closures. A
  book that ever holds a non-US-listed instrument resolved on a foreign calendar would
  need this re-derived, and nothing detects that.
- **The publication path is untouched.** `commitment_rows` calls `resolve_pick` with an
  empty series and no clock and depends on receiving `pending`; an empty series finds
  nothing in the window either, so that is byte-identical. Pinned by a test, because it is
  the one path where a regression would silently stop recording commitments.

## Rejected

- **Refuse to publish on a non-trading `run_date`.** This reverses
  [ADR-0117](0117-a-falsifiability-guarantee-that-lives-in-a-yaml-step-is-not-a-guarantee.md), which makes manual runs
  first-class publications precisely so that no book runs unrecorded. Blocking a Saturday
  run creates an incentive to publish outside the recorded path, and the book itself is
  perfectly valid — it describes the market as of the last close.
- **Snap `run_date` back to the last trading day.** Considered and rejected for the reason
  [ADR-0209](0209-a-run-that-drifts-past-midnight-still-belongs-to-the-session-it-priced.md)
  gives for its own narrowness: rewriting `run_date` backward would **overwrite a settled
  published book** whose claims may already be resolving — deleting that day's
  `book_holdings` and rewriting `portfolio_positions`. `run_date` records when the book was
  published, and it should keep doing that honestly.
- **Void, but relabel the reason.** The reason string was the least of it. The claims are
  gradeable; a clearer explanation of why they were not would still be a false statement
  about the instrument's reach.
- **Look back an unbounded distance.** Fabricates verdicts for delisted names, as above.
- **Let the nightly resolver re-grade terminal rows.** Re-arms the `pending`-over-`hit`
  erasure to fix ten rows once.
