# ADR-0057 — Stability is a per-trade fact, not a book-level percentage

**Date:** 2026-07-25
**Status:** Accepted — **implemented, NOT yet confirmed rendering live.** The
classifier is unit-tested and the deployed page fetches the right data (200,
`end_date` matches `run_date`, `samples` 3), but the marker renders zero times, so
`positionStability` is returning `unmeasured` for every row. One prop-chain bug was
found and fixed and was not the whole cause. See `docs/GOAL.md` for the next
debugging step. Nothing below should be read as describing what a reader sees today.
**Relates to:** [0045](0045-turnover-on-names-without-a-verdict.md), [0048](0048-count-independent-ideas-not-candidates.md), [0050](0050-separate-agent-churn-from-market-churn.md)

## Context

[ADR-0050](0050-separate-agent-churn-from-market-churn.md) built the frozen-input
replication harness and it finally produced a measurement: **25% turnover overall,
33% long, 13% short** across three genuine model samples.

That is the right experiment and the wrong shape for the question `task.md` asks. Q1
is *"what are your top five long and short trades, and why?"* — a question about
**these trades**. "A third of the long side is a coin flip" answers a different one.
It tells a reader the book is partly arbitrary without saying which part, so it
taints the names that were in fact unanimous while giving no warning about the ones
that were not. A reviewer reading 33% cannot act on it; a reviewer reading *"XLE
appeared in some of 3 reruns"* can.

The harness was already recording exactly what was needed. `stable_names` and
`unstable_names` sit in the persisted notes and were used only to print two lists at
the bottom of one panel. Joined to the book they classify every held position:

| | 2026-07-25 book |
|---|---|
| in all 3 reruns | JPM, NUE, SVXY (long); BABA, NOC, PDD, SLV (short) |
| in some of 3 reruns | **XLE, UNH** (long) |

Nine held names, nine classified, none unmeasured. The two coin flips are both longs,
which is the long side's 33% expressed as names rather than a rate — and it matches
the pool-depth story exactly: 10 independent long ideas competing for 5 slots.

## Decision

Classify each held position against the replication lists and mark it on its own row:
**in all N reruns** or **in some of N reruns**.

Three rules keep the label honest:

1. **The join is valid only within a run.** `positionStability` requires the
   replication's `end_date` to equal the book's `run_date`. A replication measured
   against a different candidate pool says nothing about today's names, so a mismatch
   yields `unmeasured` and the row stays silent — the same rule the not-taken
   correlation column follows with its em dash.
2. **One sample cannot establish stability**, because it agrees with itself trivially.
   Below two samples, everything is `unmeasured`.
3. **A name absent from both lists is `unmeasured`, not stable.** Absence is no
   information, and the safe reading of no information is silence.

**No verdict is attached**, following [ADR-0045](0045-turnover-on-names-without-a-verdict.md).
A coin flip is not a bad trade — it is one of several the agent rates equally, which
is precisely what a 10-ideas-for-5-slots side *should* look like. The marker states
what happened; the tooltip says what it means. Colouring the coin flips in warning
tone is a nudge to ask, not a claim that they are wrong.

The label keys on the **signed** name (`L:XLE`), not the ticker: a long and a short of
the same asset are different bets and cannot inherit each other's stability.

## Consequences

- Q1's "why these five" gains a per-trade answer that is neither the thesis (which the
  model writes) nor the EdgeScore (which ranks) — it is evidence about the *selection*
  itself, which nothing else on the page provides.
- It is as unflattering as the run deserves. On a book where the agent re-picks freely,
  most rows will carry the coin-flip marker, and that is the honest presentation of a
  book drawn from a pool with slack.
- The marker disappears whenever the replication is stale or absent, which will be
  most days: the harness is a deliberate run, not part of the daily job. Silence is
  correct there — the alternative is a label that quietly describes a different book.
- **The aggregate stays.** The Replication panel still reports the per-side rates with
  their idea counts, because "33% long against 10 ideas for 5 slots" explains *why*
  the individual markers look the way they do. The two views answer different
  questions and neither replaces the other.
