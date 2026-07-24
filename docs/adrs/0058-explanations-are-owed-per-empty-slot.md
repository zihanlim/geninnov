# ADR-0058 — Explanations are owed per empty slot, not per declined idea — corrects 0056

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0056](0056-an-instruction-is-not-a-guardrail.md), [0048](0048-count-independent-ideas-not-candidates.md), [0050](0050-separate-agent-churn-from-market-churn.md)

## Context

[ADR-0056](0056-an-instruction-is-not-a-guardrail.md) shipped two things: a prompt
instruction requiring the agent to name each independent idea it declined, and
`shortfall_accounting` to check that it did. It closed with an honest admission — the
check "tells you the model failed but does not help it succeed" — and the prompt is what
was supposed to help. **Nothing had measured whether the prompt works.** The published
book predated the change, so the deployed page showed a failure caused by a prompt that
no longer existed.

`scripts/replication_test.py` is the right instrument and already existed: it builds the
L5 state once through the deterministic nodes and calls `reason_picks` N times on frozen
copies, so everything upstream of the LLM is identical by construction. Extending it to
also run `shortfall_accounting` per sample costs nothing — the draws are already being
taken — and measures the explanation rate over the same draws as the turnover, against
one identical pool.

**Three samples, frozen pool of 30 candidates / 10 long ideas / 5 short ideas:**

| sample | picks | short side | verdict under the old rule |
|---|---|---|---|
| 1 | 7 (3 long / 4 short) | declined ARKK, **named ARKK** | long side "unexplained" |
| 2 | 9 (5 long / 4 short) | declined ARKK, **named ARKK** | explained |
| 3 | 9 (5 long / 4 short) | declined ARKK, **named ARKK** | explained |

**The prompt works.** ARKK was named in **3 of 3** samples, against a published thesis
that never mentioned it. That is the answer ADR-0056 could not give about itself.

**And the same run disproved the check's calibration.** Sample 1 held **3 longs against
10 independent long ideas**. The old rule required *every* declined idea to be named, so
it demanded explanations for **seven** names — SHY, NUE, UNH, JPM, BIL, GS, JD — while
the short side, holding 4 against 5, was asked for **one**. Both books were short by a
comparable amount and the burden differed sevenfold.

The reason is arithmetic. Where independent ideas **exceed** the five slots Q1 asks for,
most declines are forced: a side with ten ideas must decline five however good the book
is, and those five carry no information. Demanding an explanation for each conflates *"I
had more ideas than slots"* — expected, meaningless — with *"I left slots empty"* — the
actual gap. On the short side, where five ideas exactly fill five slots, the two
coincide, which is why the defect was invisible there and why the live page's warning
was nevertheless correct.

Sample 1 did in fact name four of the ideas it passed on. It was marked a failure for
not naming three more that no book with five slots could have taken anyway.

## Decision

**The number of explanations owed is the number of empty slots: `available - held`.**

Leave two slots unfilled, name at least two of the ideas that could have filled them.
`shortfall_accounting` gains `empty_slots` and a `satisfied` verdict
(`len(named) >= empty_slots`), and the `/book` panel branches on `satisfied` rather than
re-deriving a verdict from `unexplained`.

Three properties matter:

- **On a side where ideas exactly fill the book, this reduces to the old rule.** Five
  ideas, five slots, four held → one empty slot, one name owed. The short side's
  behaviour, and the live warning about ARKK, are unchanged.
- **`passed_over` and `unexplained` survive as information, not as verdict.** A reader
  is still shown every idea the book did not take; what changed is that the page stops
  *scoring* the book against an impossible bar.
- **Rows written before this ADR carry no `satisfied`, and the panel falls back to the
  old all-or-nothing reading for them** rather than inventing a lenient verdict.
  Retroactively clearing warnings that were correct when written would be a silent
  rewrite of the record.

## Consequences

- **The explanation rate is now a reportable number**, printed by the harness beside
  turnover: *"2/3 of the samples that fell short"* under the old rule, **3/3** under the
  corrected one. Reported as a share of samples that *were* short, never of all samples
  — a draw that took everything reachable never faced the question, and counting it as
  a pass would inflate the rate with books that were never tested.
- **The measured turnover is worth recording alongside it:** 27% overall, **44% long,
  0% short** across the three samples. The short side — five ideas for five slots —
  returned an identical book every time; the long side, ten ideas for five slots, did
  not. That is exactly the pattern [ADR-0050](0050-separate-agent-churn-from-market-churn.md)
  predicted and declined to score, and it is the same arithmetic this ADR is about:
  where the pool over-fills the book, the agent chooses, and choice varies.
- **The limitation named in ADR-0056 is unchanged and still open.** The check verifies a
  declined idea is *mentioned*, not that the reason is *sound*. Loosening the count owed
  does not touch that, and the two should not be conflated.
- **This is the second time a measurement built for one purpose corrected the thing that
  built it** — the candidate-correlation table disproved the redundancy argument that
  motivated it (ADR-0045 era), and now the replication harness has disproved the
  calibration of the check it was extended to test. The pattern is worth keeping: **the
  instrument is what makes the earlier assertion checkable, and it keeps failing.**
