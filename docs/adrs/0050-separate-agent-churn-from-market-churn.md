# ADR-0050 — Measure agent churn separately from market churn

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0041](0041-regime-as-a-dial-not-a-cliff.md), [0042](0042-absolute-hype-subscores.md), [0045](0045-turnover-on-names-without-a-verdict.md), [0048](0048-count-independent-ideas-not-candidates.md)

## Context

[ADR-0045](0045-turnover-on-names-without-a-verdict.md) put a turnover panel on
`/book`: how much of the book changed since the previous run, measured on names, with
no verdict attached because *a regime turn should churn a book*. That is the right
framing for day-over-day change, and it is also its limit — day-over-day turnover
mixes two things that mean opposite things about the system:

- **the market moved**, so the signals moved, so the book moved — working as intended;
- **the agent changed its mind** on inputs that did not move — a credibility problem.

`GOAL.md` has carried the fix as an open item for many iterations, and stated the
method: *"run the pipeline twice on frozen inputs and diff the positions"*, with the
instruction *"do that before claiming the book is stable."* Nothing had done it.

The incidental evidence said it mattered. Four agent runs stamped `run_date`
2026-07-25, inside one hour:

| run | book | turnover vs previous |
|---|---|---|
| 16:56 | BIL, EEM, NUE, SVXY, UNH / GLD, KWEB, NOC | — |
| 17:10 | EEM, JPM, UNH, XLE / GLD, KWEB, NOC | 50% |
| 17:34 | BIL, NUE, SVXY, UNH, XLE / BABA, NOC, PDD, SLV | 77% |
| 17:57 | EEM, JPM, NUE, OIH, XLE / BABA, NOC, PDD, SLV | 50% |

**None of that is admissible.** Code and prompt changed between several of those runs
— that was the whole point of the session — and prices refresh on every pipeline
execution. It is suggestive, not evidence, which is precisely why a controlled version
was needed rather than more staring at incidental numbers.

One thing in it is worth noting, because it shaped the design: between 17:34 and 17:57
the **short side was identical** (SLV, BABA, PDD, NOC) while the **long side kept one
name of five**. Pool depth for that run was 4 short ideas and 10 long. Where the pool
exactly fills the book, the agent has no choice; where it over-fills, it chooses — and
apparently differently each time.

## Decision

Ship `scripts/replication_test.py`: build the L5 state **once** through the
deterministic nodes (`aggregate_context` → `screen_candidates` →
`compute_book_metrics_node` → `run_scenario_analysis_node`), then call `reason_picks`
**N times on independent deep copies of that identical state**.

Everything upstream of the LLM is frozen by construction — same candidates, same macro
snapshot, same regime, same book metrics, same scenarios, same prompt, same
temperature. Whatever differs between samples is the model. The candidate pool is
**read back from `trade_candidates`** rather than re-ranked, because re-running L1
would refetch prices and quietly reintroduce the confound being removed.

Reported per side, because the sides answer different questions:

- **Overall turnover** — the headline.
- **Long / short turnover separately**, each shown **beside its independent-idea
  count**. Ten ideas competing for five slots is a different situation from four ideas
  filling four slots, and averaging them hides exactly the thing that explains the
  number.
- **Which names appear in every sample** and which are coin flips.

Persisted to `backtest_results(test_name='book_replication')` and rendered on `/book`
immediately below the turnover panel, so the two churn figures are read together.

**No verdict is attached**, following ADR-0045. A book that varies when the pool
over-fills it is not obviously broken; a book that varies when the pool exactly fills
it would be. The panel shows which case the reader is in rather than scoring it.

## Consequences

- The question a reviewer asks first about a systematic book — *"would you get the
  same answer twice?"* — has a measured, per-side answer instead of a day-over-day
  number that cannot separate the market from the model.
- It is expensive: each sample is a full LLM reasoning call, minutes each, so this is
  a harness run deliberately rather than part of the daily job. That is why the result
  is persisted with its date and sample count and rendered as an as-of figure.
- It measures the **reasoning step only**. Everything L0–L4 is deterministic by
  construction and is not re-tested here; if that ever stops being true, this harness
  will not notice, and the claim it supports is scoped accordingly.
- **The result may be unflattering, and the panel is built to say so.** Naming the
  positions that survived every sample — and those that did not — puts the instability
  next to the book rather than in a footnote.
