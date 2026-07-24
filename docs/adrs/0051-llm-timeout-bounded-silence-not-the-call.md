# ADR-0051 — `LLM_TIMEOUT_SECONDS` bounded silence between bytes, not the call

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0012](0012-citation-guardrail-llm-defense.md), [0050](0050-separate-agent-churn-from-market-churn.md)

## Context

`LLM_TIMEOUT_SECONDS` has been treated throughout this project as *the* control on how
long the L5 reasoning step may take. It has been raised twice in response to observed
failures — 120s → 420s → 900s — each time on the reasoning that generation was simply
slower than the budget. That reasoning was wrong about what the setting does.

The value was passed straight to `requests.post(timeout=...)`. In `requests`, a scalar
timeout applies to the **connect** and to the **gap between bytes**; the library's own
documentation states it "is not a time limit on the entire response download." A
provider that trickles data — or a reasoning model that thinks slowly while the
connection stays alive — never trips it. The setting bounds silence, not duration.

Observed, not theorised. With the value at **900s**:

- one L5 call in the daily pipeline ran **23 minutes** and completed normally;
- a later call passed **45 minutes** still inside a single attempt, and was killed by
  hand.

The second is why [ADR-0050](0050-separate-agent-churn-from-market-churn.md)'s
replication measurement produced no number in the iteration that built it: the first
of four samples never returned.

The consequence that matters is not a slow local script. `daily-refresh.yml` runs this
step every weekday. A stalled provider call there is not a late book — it is a **hung
workflow that produces nothing and holds the runner toward its 6-hour ceiling**, with
no book written and the site's stale-book banner the only downstream sign that
anything happened. Every retry and fallback path in ADR-0012 is downstream of a call
that returns; none of it engages while a call simply never ends.

## Decision

Enforce a **wall-clock deadline** around the provider call, and keep the per-request
timeout as the inner inter-byte guard it actually is.

`_llm_complete` submits the real work — now `_llm_complete_inner`, unchanged — to a
single-worker `ThreadPoolExecutor` and takes `future.result(timeout=LLM_TIMEOUT_SECONDS)`.
On expiry it raises `TimeoutError` naming the elapsed budget and the provider.

- **The worker is abandoned, not awaited.** It holds a socket and this is a batch
  process that exits; blocking on it would reproduce the hang the change exists to
  remove.
- **`TimeoutError` propagates into the existing path** — retry `reason_picks` with
  feedback, then the deterministic fallback. That is what should happen when a
  provider stalls, and it is what could not happen before.
- **A fast provider error still surfaces as itself.** Flattening every failure into a
  timeout would destroy the retry feedback that ADR-0012's loop depends on; a test
  pins that a 429 arrives as a 429.

## Consequences

- The daily job now has an actual upper bound on its slowest stage. A stalled provider
  costs one timeout plus the fallback rather than the whole run.
- **Three earlier increases of this value were treating the wrong dial.** They were not
  wasted — generation genuinely was slower than 120s — but "raise the timeout" was
  never going to fix a stall, and the fact that raising it appeared to help each time
  is exactly why the misreading survived so long.
- The bound is on the *call*, not on the *node*: `reason_picks` may still take up to
  `LLM_TIMEOUT_SECONDS` per attempt and there are up to three attempts. That is
  intended and now finite, where before it was unbounded.
- Nothing here makes the model faster. If the provider is routinely slow the right
  response is a smaller `max_tokens` or a different model, and the timeout will now
  say so plainly instead of hiding it as a hang.
