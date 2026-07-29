# ADR-0160: A stall is retried once, and the log says so

**Status:** Accepted
**Date:** 2026-07-29
**Amends:** [ADR-0052](0052-a-stall-cost-three-attempts-not-one.md)

## Context

The 2026-07-29 pipeline run took **22 minutes** in L5 against a median of 3.5. The
question "is that normal?" turned out to be unanswerable from anything the system
recorded, and answering it by hand surfaced two defects.

### 1. ADR-0052's guard was defeated one level up

`reason_picks` deliberately does not retry its own timeout. ADR-0052 established
this because a stall consumed all three attempts — 3 × `LLM_TIMEOUT_SECONDS` = 2700s,
and a 45-minute stalled run is exactly what was measured.

But a timeout sets `state["error"]`, and `run_q1_agent`'s retry loop retried on **any**
error:

```python
while not state.get("verified") and retry_count < 2 and state.get("error"):
```

So the run could still reach 3 × 900s. The live log printed both halves on
consecutive lines:

```
[reason_picks] LLM TIMED OUT (attempt 1): ... — not retrying; a stall is not fixed
               by asking again.
[run_q1_agent] Retrying reason_picks (attempt 2/3)...
```

Neither line is wrong about its own function. Together they describe a system doing
the opposite of what it says, and the 45-minute worst case ADR-0052 was written to
prevent was fully reachable.

**Nothing had ever driven that loop.** `run_q1_agent` takes ten arguments and
persists to Supabase, so no test exercised it — which is why a contradiction this
plain survived a green suite.

### 2. The stage's duration was the only thing recorded

`pipeline_runs` stores one duration for all of L5. Since no single call may exceed
`LLM_TIMEOUT_SECONDS`, a 21.6-minute stage *must* have spanned more than one — but
whether that was several legitimate calls or one burned deadline plus a retry was
not recoverable from anything stored. The two readings imply opposite fixes (leave it
alone vs. stop wasting 15 minutes a night), so the distinction has to be measured.

### 3. And the log was invisible while it mattered

Python block-buffers stdout when it is not a TTY — which is every way this runs:
`> pipeline.log`, and GitHub Actions. `build_theme_signals` passes `flush=True`;
nothing else does. A redirected run showed **21 lines for 45 minutes** while L0–L5
completed behind them. Locating the run required querying Supabase, and **a hung job
was indistinguishable from a slow one**.

## Decision

**1. A stall is retried exactly once.** `MAX_TIMEOUT_RETRIES = 1` against
`MAX_REASON_RETRIES = 2`. Worst case becomes 2 × `LLM_TIMEOUT_SECONDS`, not 3.

ADR-0052 was right about the cost and wrong about the remedy. The same shape has now
been observed at **two different ceilings**: the module comment records *"timed out at
420 on attempt 1 and succeeded on attempt 2"*, and 2026-07-29 timed out at 900 on
attempt 1 and succeeded on attempt 2 — producing a real ten-pick book with 45
citations, 93% grounded. Raising the ceiling did not stop attempt 1 stalling. **The
retry is what rescues the book**; without it that run publishes an empty-thesis
fallback.

A **citation** failure keeps its full budget. The model can produce better output for
the same prompt, which is the case retrying was designed for; ADR-0052's reasoning
only ever applied to stalls.

**2. The loop is extracted.** `reason_and_verify_with_retries(state, reason_fn,
verify_fn)` takes the two node callables, so the budget is testable without an L5
fixture. `run_q1_agent` calls it with the real nodes — one implementation, not a copy.

**3. Per-node timings are logged.** One line naming every node and its seconds, with
`reason_picks` appearing once per attempt, so the next "is this normal?" is read
rather than inferred.

**4. stdout and stderr are line-buffered** in `daily_refresh`. One `reconfigure` call
rather than auditing ~200 `print`s for `flush=True`, and it survives however the
module is invoked.

## Consequences

**The nightly job's worst case drops from 45 to 30 minutes** and, more importantly,
becomes bounded by a rule that is now tested rather than by two rules that disagreed.

**The tests bite.** Reverting `MAX_TIMEOUT_RETRIES` to 2 fails four of them, including
the one that counts actual deadlines. That was verified, not assumed.

**The timeout value itself is unchanged, deliberately.** Two data points say attempt 1
stalls regardless of the ceiling — 420 did not help, 900 did not help. Raising it a
third time would be the same inference [ADR-0154](0154-maxrecords-caps-a-response-not-a-query.md)
records making and reverting on the GDELT budget. The timings added here are what
would justify a change; guessing again is not.

**A hung run is now visibly hung.** The log reaches the file as it happens, so the
difference between "slow" and "stopped" is legible without a database query.

**This does not explain WHY attempt 1 stalls.** It bounds the cost and makes the
pattern measurable. If the timings show it recurring nightly, the next question is
whether the first request to a cold connection is being queued provider-side — which
is a different investigation and needs the data this change starts collecting.

## Alternatives considered

**Zero timeout retries, honouring ADR-0052 literally.** Rejected on evidence: twice
now the retry is what produced a real book. Enforcing ADR-0052 as written would have
published a fallback on 2026-07-29.

**Raise `LLM_TIMEOUT_SECONDS` again.** Rejected — see above. Two ceilings, same
failure.

**Shorten the FIRST attempt's timeout so a stall fails fast, then retry with the full
budget.** Genuinely attractive, and the timings may end up supporting it. Rejected for
now because it is calibrated on n=2 and would risk killing legitimately slow
generations, which is the exact mistake the 120s ceiling made.

**Keep the loop inline and test `run_q1_agent` end to end.** A ten-argument fixture
with Supabase persistence, to test nine lines of control flow. The extraction is
cheaper and the loop is the same object either way.
