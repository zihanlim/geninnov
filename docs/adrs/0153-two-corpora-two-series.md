# ADR-0153: Two corpora, two series, never merged

**Status:** Accepted
**Date:** 2026-07-29

## Context

The discovery layer could not fire and structurally never would have.
`narrative_signals` held **358 phrases, one `run_date`, and velocity on zero of
them**. Velocity is a phrase's share measured against its own history
(`MIN_DAYS_FOR_VELOCITY = 4`), so with a single day of signals nothing can ever be
classified `emerging` — and *"is anything accelerating that nothing watches?"* is the
only question this layer exists to answer.

**The history was already being collected and then thrown away.** `market_news` held
462 GDELT documents across 41 distinct days, because
[ADR-0144](0144-a-second-provider-that-is-an-archive.md) added GDELT precisely for
that archive property. The nightly job ran the frequency tracker over that corpus
**once**, for today, and discarded the other 40 days.

Replaying them raised the question this ADR is about.

### The two corpora fail differently

Measured 2026-07-29:

| | Brave | GDELT |
|---|---|---|
| docs/day after 2026-07-21 | **87–94** | ~11 |
| docs/day before 2026-07-21 | **0** (8-day window) | ~11 |
| distinct days | 8 | **41** |

A **combined** series is dense today and carries a 5–10× corpus discontinuity at
2026-07-21: every phrase's share jumps there because the denominator changed, not
because attention did. That is [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md)'s
finding one level deeper — share of voice over a corpus whose composition changes
measures the composition change.

An **archive-only** series is comparable end to end but counts ~11 documents a day,
at which `MIN_DOC_COUNT = 3` demands a phrase appear in 27% of the day before it
registers. The survivors are `prices`, `us`, `global`, `nifty`: register, not
narrative ([ADR-0142](0142-frequency-cannot-tell-a-narrative-from-a-register.md)).

I initially treated this as a choice and was going to take one. It is not a choice.

## Decision

**Compute both, label each with the corpus it was counted out of, and never let them
share a comparison.**

They answer different questions with different validity conditions:

| | `combined` | `archive` |
|---|---|---|
| Question | *what is the news about today?* | *what is accelerating?* |
| Kind | snapshot | series |
| Needs | density | comparability across days |
| Cares that yesterday's corpus matched? | **no** | **yes** |

A snapshot compares nothing across time, so a changing composition costs it nothing.
A velocity is nothing *but* a comparison across time, so a changing composition is
fatal to it. Dense-and-incomparable and sparse-but-comparable are different failures,
and neither dominates.

This is the pattern the repo already uses for instruments that must not be conflated:
four VaRs each carrying method, horizon **and** basis
([ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md)); `weights_backtest`,
`pick_outcomes` and `portfolio_returns` as three accountability instruments compared
and never merged ([ADR-0112](0112-a-backtest-of-these-weights-is-not-a-track-record.md)).

### What this is not

**Not one row with a dense `share` and an archive-derived `velocity`.** That would be
a number whose velocity is not the velocity *of* that share, and a reader would
reasonably assume otherwise. Each row is internally consistent: share, velocity and
status all come from one corpus.

### The filter is the whole decision

`load_history` filters by corpus, and `track_narratives` threads the label through
**both** the history read and the write. Without it, an archive share is compared
against a history of combined shares — GDELT's ~11 documents a day against a combined
~98 — and the difference between denominators is reported as a change in attention.

Nothing about the output would look wrong. Every velocity would simply be an
artefact. So `test_history_is_read_from_the_SAME_corpus_it_writes` asserts the filter
directly, and was verified to fail when it is removed.

## Consequences

**Velocity is computable for the first time.** Backfilled: 94 archive rows over 19
run dates back to 2026-06-14, **16 with velocity**, first measurable 2026-06-22 —
against zero before.

**The dense series is untouched.** 358 combined rows at 2026-07-28 remain, and the
backfill deletes and rebuilds by `(run_date, corpus)` so a replay cannot reach them.

**A handover is set up.** `archive` has history now and can measure velocity today.
`combined` has none before 2026-07-29 and gains valid velocity about four runs later
— at which point it is the better instrument, denser and self-consistent once both
providers are steady. The sparse series bootstraps a capability the dense one
inherits.

**The unique constraint widened** to `(run_date, phrase, corpus)`. Without it the
second write silently overwrites the first and the survivor depends on write order.

**Still zero emerging, and that is the honest state.** Velocity now exists; a
*finding* does not. At ~11 documents a day the archive surfaces register words, and
no phrase has cleared `VELOCITY_MATERIAL = 1.5` while young and uncovered. The
mechanism is unblocked; the corpus is still too thin to say anything. Those are
different claims and this ADR only earns the first.

## Alternatives considered

**Pick one corpus.** What I was about to do. Rejected once the requirements were
written down side by side: they are not competing answers to one question, they are
answers to two, and picking either silently drops a question the brief asks.

**Raise the GDELT fetch budget to densify the archive.** Tried, committed, and
reverted the same day. Measured: one query returns 232 articles, four return 462, and
ten return the same 462 — queries five through ten add nothing because the seed set
is broad market language and dedup collapses the overlap. The run also hits HTTP 429
at 6.5s pacing against a 5s limit. The budget was never the constraint; GDELT's
coverage of these terms is. ~11 docs/day is what the archive HAS.

**Lower `MIN_DOC_COUNT` for the sparse series.** Rejected: it lowers the bar for
noise rather than raising the corpus. On 11 documents, a 2-document threshold makes
an 18% share the entry price for "a narrative", which is a way of manufacturing
findings.

**Wait for organic history.** The status quo, and the reason the layer had produced
nothing since it shipped. The archive was already on disk; not replaying it was the
defect.
