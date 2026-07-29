# ADR-0158: A day is when it was published, not when we fetched it

**Status:** Accepted
**Date:** 2026-07-29

## Context

After [ADR-0155](0155-a-share-is-only-comparable-to-a-share-of-the-same-corpus.md),
the archive narrative series was measuring again — 239 velocities across 31 days, 141
positive / 98 negative, 28 emerging. But the **live end of the series was blank**.
`2026-07-29` held 128 phrases and velocity on **zero** of them:

```
2026-07-05 .. 2026-07-24    corpus 21-63/day     median 55.5
2026-07-29                  corpus 1447          velocity on 0 of 128
```

1447 / 55.5 = 26×, so ADR-0155's guard withheld — correctly, given what it was
shown. The question is why one day held 1447 documents when its neighbours held 50.

### The two date fields

`market_news` carries both `run_date` (the day we fetched) and `published_date` (the
day the article is dated). They are deliberately distinct — that distinction is what
lets one fetch today deepen forty days of history.

The two consumers disagreed about which one defines a day:

| Path | Selects on | A "day" is |
|---|---|---|
| `backfill_narratives.load_corpus_by_day` | `published_date` | documents published that day |
| `daily_refresh.load_market_corpus` | `run_date` | documents **fetched** in the last 7 days |

One GDELT call returns 45 days of history, so all 1449 of its articles carry today's
`run_date`. Measured: the 1449 rows fetched on 2026-07-29 spanned **32 publication
days**, from 2026-06-14 to 2026-07-26.

So the live job compared a corpus of "everything fetched this week, published across
five weeks" against a history of "documents published on one day". Same phrase, same
provider, same fetch depth — and incomparable denominators.

This is ADR-0155's rule broken through a third door. ADR-0153 guarded the **provider
mix**, ADR-0155 guarded corpus **volume**, [ADR-0157](0157-a-corpus-is-defined-by-naming-its-providers.md)
guarded the **provider list**. None of them could catch this one, because neither the
provider, nor the depth, nor the list had changed. **The series was incomparable with
itself.**

### And underneath it, a starved live end

Fixing the bucketing exposed the real state of the archive. Replayed by publication
date, the most recent days hold **9–16 documents** against a median of 49 — so
ADR-0155's guard withholds them too, now for being too *small*.

[ADR-0154](0154-maxrecords-caps-a-response-not-a-query.md) ordered GDELT's windows
oldest-first, on an explicit premise:

> Windows run **oldest-first**. A fetch truncated by the time budget then loses its
> RECENT end, which the live Brave corpus already covers densely at 87–94 docs/day.

That premise does not hold for the consumer that needs it most. The archive series is
**GDELT-only by definition** (ADR-0153) — Brave contributes nothing to it — so its
recent end was never covered by anything. The 2026-07-29 run logged *"9 of 10 queries
not run to completion"*, and the days it failed to reach were precisely the ones the
daily job exists to add.

A daily job whose entire purpose is to extend a series was structurally unable to
extend it.

## Decision

**1. A day's corpus is the documents PUBLISHED that day, everywhere.** The nightly job
stops snapshotting `run_date` for the archive series and replays by `published_date`,
which is what its own backfill always did.

**2. One implementation, not two.** The replay moves into
`backfill_narratives.replay_archive`, and both the script and `daily_refresh` call it.
A backfill and a live extension that bucket by different date fields is exactly how a
series becomes incomparable with itself; keeping one function is the structural
guarantee that they cannot drift apart again.

**3. Replaying is not optional.** As later fetches fill in older publication dates,
those days' shares change. A forward-only snapshot can never incorporate them. The
replay is pure arithmetic over stored rows — no network, no LLM — so running it nightly
costs nothing but CPU.

**4. GDELT fetches the NEWEST window first, then the rest oldest-first.** This keeps
ADR-0154's protection while fixing its premise: truncation now costs **middle** days,
and a middle day is recoverable because GDELT is an archive. The live end is not
recoverable — tomorrow it is no longer the live end.

**The `combined` corpus keeps `run_date` bucketing, and that is correct.** ADR-0153
already states why: *"a snapshot compares nothing across time so composition drift
costs it nothing; a velocity is nothing BUT a comparison so drift is fatal."*
Combined is a snapshot answering "what is the news about today"; archive is a series.
Only the series needs stable bucketing.

## Consequences

**The replay is over publication days, so the series' dates now mean what they say.**
A row dated 2026-07-20 describes the news published on 2026-07-20, regardless of when
we collected it.

**The archive series is inherently lagged, and this makes that visible rather than
hiding it behind a fetch-date snapshot.** GDELT publishes with a delay, so the newest
publication days are always thin at the moment the job runs, and the guard will
withhold them until a later run fills them in. That is honest: those days genuinely do
not have a measurable share yet.

**Delete-then-insert per publication date, not upsert.** An upsert leaves behind
phrases persisted for a date and absent from the recomputed set, making the day a union
of two runs rather than that day's actual top-N — the defect ADR-0152 records.

**ADR-0154's oldest-first rationale is superseded, not wrong.** It was correct about
the combined corpus, where Brave does supply recency. It was applied to a client whose
output also feeds a GDELT-only series, and that is the part this changes.

**A test now pins the ordering**, because the property is invisible in the output: a
fetch that returns documents looks identical whether or not it reached the days that
matter.

## Alternatives considered

**Widen `MAX_CORPUS_SIZE_RATIO` so 26× passes.** Rejected — that guard was right. The
two numbers genuinely were not measuring the same thing, and loosening the detector to
admit a real defect is the wrong direction.

**Bucket the backfill by `run_date` instead, to match the live job.** Rejected: it
makes every historical day mean "whatever we happened to fetch that day", which is not
a property of the news and would change retroactively with every re-fetch.

**Keep the live snapshot and let the history catch up.** The median only moves once
more than half the history window is new-regime — roughly 15 more runs, during which
the board's most recent day is permanently blank. And it would converge on the *wrong*
definition.

**Fetch newest-first for everything, dropping ADR-0154's ordering entirely.** This is
what was implemented, with the remainder still oldest-first. A pure newest-first sweep
would, under sustained truncation, never reach the old end at all — which is the hole
ADR-0154 was protecting against and which remains a real risk.
