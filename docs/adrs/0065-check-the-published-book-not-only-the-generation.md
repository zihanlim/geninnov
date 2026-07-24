# ADR-0065 — Check the published book, not only the generation that produced it

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0040](0040-published-book-is-the-book-of-record.md), [0061](0061-a-false-excuse-is-worse-than-none.md), [0049](0049-the-guardrail-does-not-read-the-prose.md), [0064](0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md)

## Context

The thesis guardrails — the restated idea count ([ADR-0049](0049-the-guardrail-does-not-read-the-prose.md))
and the availability excuse ([ADR-0061](0061-a-false-excuse-is-worse-than-none.md)) —
run inside `verify_citations`, during generation. They block a bad book from being
written. That leaves two paths by which an unchecked thesis reaches the page anyway:

**1. The fallback is terminal.** When the retries are spent, `reason_picks` returns
`fallback_picks(state)`, and that templated thesis is persisted without going back
through `verify_citations`. Nothing re-reads it.

**2. A row published by older code stays live.** This one is not hypothetical — it is
the ARKK incident. The 2026-07-25 book carried

> *"The fifth independent short idea per POOL DEPTH, ARKK, is not present in the
> tradable candidate pool…"*

which is false — ARKK was the eleventh of twelve short candidates. ADR-0061 added the
check that rejects it, **but only on the next generation.** The wrong sentence stayed on
the live page until a human happened to read it, and the only reason it was caught at all
is that someone was reading the thesis closely that afternoon.

Both are the shape [ADR-0040](0040-published-book-is-the-book-of-record.md) exists to
prevent: **the published book is the book of record, so check the published book — do not
infer its correctness from the process that was supposed to produce it.** `/risk` already
learned this in iteration 32, when it started comparing its positions against the
published picks rather than trusting a pipeline status flag. A status field says what the
telemetry believes; reading the row says what is actually on the page.

## Decision

**The daily guard re-runs the exact-match prose checks against the persisted
`book_view`.**

`check_published_book_claims(rec_row, candidates)` reads the latest
`research_recommendations` row and applies `check_availability_claims` and
`check_idea_count_claims` to what is actually stored, against the `trade_candidates` for
that same run. It runs in `scripts/check_data_integrity.py`, which
`daily-refresh.yml` already executes after every pipeline run, and exits non-zero on a
contradicted claim.

- **It reuses `q1_agent`'s functions rather than reimplementing them.** A second copy of
  a guardrail is a second thing to drift, which is precisely what
  [ADR-0064](0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md) was: a
  display surface reimplementing a backend rule and getting it wrong. Imported lazily so
  the guard module stays importable without the agent's dependencies.
- **Only exact, falsifiable claim classes are checked** — a name's membership in the
  screened pool, and a restated count against the measurement. Nothing here judges
  whether a *reason* is good; that remains out of reach and
  [ADR-0045](0045-turnover-on-names-without-a-verdict.md)'s refusal to publish an
  unfalsifiable verdict still stands.
- **It fails the run rather than annotating the page**, because by the time this fires
  the claim is already published. The remedy in the message is the honest one: re-run L5
  so a corrected thesis replaces it.

## Consequences

- **The window between "a guardrail is written" and "the page stops lying" closes to one
  daily run.** Previously a new check only affected future generations, so a live wrong
  claim could persist indefinitely — which is exactly what happened with ARKK.
- **A fallback book is now checked.** Its templated thesis is unlikely to contain either
  claim class, and that is fine: the guard is silent when there is nothing to say. What
  changed is that silence is now *measured* rather than assumed.
- **Verified against production on the day it was written**, not merely unit-tested:
  *"Published thesis for 2026-07-25 makes no contradicted claim (checked against 40
  screened candidates)"*, exit 0. The negative control is a unit test carrying the exact
  false sentence that was live, which this check flags.
- **Recorded limitation:** the guard reads the *latest* row only. A wrong claim in an
  older published book is history and is left alone, the same scoping the edge-score
  reconciliation check uses. If the site ever renders a past run, that decision needs
  revisiting.
- **This was built under a deploy freeze** (`api-deployments-free-per-day` exhausted).
  That is worth noting as a design input rather than an excuse: with the frontend
  unverifiable, the work went to a layer that could be run against production and shown
  to work. A guardrail nobody can see is still a guardrail.
