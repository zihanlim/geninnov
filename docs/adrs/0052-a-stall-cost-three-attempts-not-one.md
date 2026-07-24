# ADR-0052 — A stall cost three attempts, not one — correcting ADR-0051

**Date:** 2026-07-25
**Status:** Accepted
**Corrects:** [0051](0051-llm-timeout-bounded-silence-not-the-call.md)
**Evidence strength: an inference from n=1.** The `3 x 900s = 2700s` arithmetic
matches the single 45-minute observation exactly, which is what identified the
retry loop — but an exact match on one sample is still one sample. The retry
loop's existence and its `except Exception` are read directly from the code and
pinned by tests; the claim that it *caused* the observed duration is not
replicated.
**Relates to:** [0012](0012-citation-guardrail-llm-defense.md), [0050](0050-separate-agent-churn-from-market-churn.md)

## Context

[ADR-0051](0051-llm-timeout-bounded-silence-not-the-call.md), written one iteration
ago, observed that L5 calls ran **23 minutes** and **45 minutes** against a nominal
900s `LLM_TIMEOUT_SECONDS`, and concluded the cause was `requests`' timeout semantics:
a scalar `timeout=` bounds the connect and the gap *between bytes*, not total
duration, so a single call could run unbounded.

**That mechanism is real, and the wall-clock wrapper it added is still correct.** But
it was not what produced those numbers, and the ADR presented it as though it were.

`reason_picks` has its own retry loop — `max_retries = 2`, so three attempts — and a
broad `except Exception` that caught the new `TimeoutError` exactly like any other
failure. A stalled provider therefore consumed **every attempt**:

```
3 attempts x 900s = 2700s = 45 minutes
```

Forty-five minutes is not approximately the observed figure; it *is* the observed
figure. The 23-minute run fits the same shape — one timeout at 900s plus a second
attempt that succeeded in ~480s. The unbounded-single-call story predicted no
particular duration; the retry story predicts these exactly, and that is what
distinguishes them.

The error was one this project keeps writing down and then repeating: a mechanism that
*could* explain an observation was treated as the mechanism that *did*, without
checking whether the arithmetic landed on the number.

## Decision

**Do not retry a timeout.** `reason_picks` now catches `TimeoutError` ahead of the
broad handler and goes straight to the deterministic fallback.

The distinction it draws is the point:

- **A JSON decode failure is worth retrying.** The model emitted malformed output, the
  retry feeds the error back (the branch above does exactly that), and a second attempt
  can genuinely fix it.
- **A timeout is not.** The provider is demonstrably slow; asking a temperature-0 model
  the identical question again pays another full deadline to learn nothing. Two tests
  pin both halves — a timeout makes exactly one call, a decode failure still uses all
  three.

ADR-0051's wall-clock wrapper stays. Without it each of those three attempts could
*itself* be unbounded, which is a worse failure than three bounded ones. The two
changes compose: the wrapper bounds one attempt, this bounds how many attempts a stall
can trigger.

## Consequences

- Worst case for `reason_picks` against a stalled provider drops from
  **3 × `LLM_TIMEOUT_SECONDS`** to **1 ×** — at the 900s default, 45 minutes to 15.
  In `daily-refresh.yml` that is the difference between a run that overshoots its
  window and one that produces a fallback book on time.
- The retry budget is now spent only where retrying can help. That is what
  [ADR-0012](0012-citation-guardrail-llm-defense.md)'s loop was designed for and what
  the "feed the rejection back into the prompt" work assumed.
- **ADR-0051's evidence section is wrong and should be read with this ADR.** Its
  decision was right for a reason it did not establish. Both are kept: deleting the
  earlier record would hide that the first diagnosis was accepted on plausibility
  rather than arithmetic, and that is the part most worth remembering.
- Neither change makes the model faster. If stalls become routine the answer is a
  smaller `max_tokens` or a different provider — and the pipeline will now say so in
  minutes instead of three-quarters of an hour.
