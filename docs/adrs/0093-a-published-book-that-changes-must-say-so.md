# ADR-0093 — A published book that changes must say so

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0040](0040-published-book-is-the-book-of-record.md), [0066](0066-not-computable-must-persist-as-null.md), [0050](0050-separate-agent-churn-from-market-churn.md), [0090](0090-a-published-pick-must-be-falsifiable.md)

## Context

`research_recommendations` is written with `upsert(..., on_conflict="run_date")`
(`q1_agent._persist_to_supabase`). That is the right shape — one book per day — but it
means a second run for the same date **replaces the published book in place**, and no
prior version survives anywhere. A reader who quoted yesterday's gross exposure has no way
to tell whether the figure on screen now is the one they read.

**The scale is the argument, not the theory.** `research_agent_runs` retains one row per
agent invocation. Measured on 2026-07-26:

| run_date | agent runs | span |
|---|---|---|
| 2026-07-25 | **17** | 16.7 hours |
| 2026-07-24 | **25** | 30 hours |
| 2026-07-23 | 21 | 18.8 hours |
| 2026-07-22 | 7 | 35 minutes |

Seventy runs across four published books. Every one that reached persist overwrote the
book for its run_date.

And the runs did not agree. For 2026-07-25 the 04:24 run produced the published book
(`ARKK/BABA/GDX/NOC/NUE/PDD/SHY/SVXY/UNH/XLE`), while the **latest** run at 09:04 proposed
a materially different one — short `FXI`/`KWEB`/`MCHI`, long `BIL`/`EWJ`/`TLT` — and was
correctly refused by the citation guardrail with `verified = false`. The right book is
live, and the guardrail did its job. What was missing is any record that a choice had been
made, or that a published figure had ever moved.

This is the gap the worldmonitor review logged as a corrections policy: their design
records a revision-log entry per correction carrying date, target, previous value, new
value, cited evidence and trigger type, surfaced both per-item and centrally.

## Decision

Add `book_revisions` (migration 044) and record, per field, that a published book changed.

**Read-then-diff, before the write.** `_persist_to_supabase` fetches the currently
published row for the run_date and diffs it against the row about to replace it. The hook
runs **before** the upsert and is **non-fatal**: it reports on the book, it does not
produce one, and a logging failure must never cost a run that was otherwise ready to
publish — the same standing rule as the IC and outcome-resolution steps.

**`reason` is `NOT NULL`, with a `length(trim(reason)) > 0` check.** An unexplained
revision reads exactly like the silent overwrite this table exists to prevent. When the
writer has nothing specific to say, the honest default is
*"Unattributed pipeline re-run: the daily job persisted a second book for this run_date,
replacing the one above"* — which is itself informative. Same rule as
`pick_outcomes.void_requires_reason` ([ADR-0090](0090-a-published-pick-must-be-falsifiable.md))
and `assessStaleness.unjudgeableReason`.

**Three triggers:** `pipeline_rerun`, `manual_correction`, `backfill`. The third exists
because [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md)
created exactly that case — S6 was appended to an already-published book.

**Materiality, deliberately economic.** `MATERIAL_EPSILON` is one basis point. Unlike the
`1e-9` representation guard in `book_metrics` (which exists so a clamped cap does not
report itself breached), the question here is "would a reader who quoted the old figure
notice?" A log that reports the sixteenth decimal place moving is a log nobody reads, which
is the failure mode that makes a corrections surface worthless. **Appearance and
disappearance are always material** regardless of magnitude, because `None → value` is the
difference between "not computable" and "computed"
([ADR-0066](0066-not-computable-must-persist-as-null.md)).

**Tracked fields are a list, not a recursive diff.** Diffing two book rows wholesale
reports the reordering of a correlation matrix and the re-rendering of a prompt string, and
buries the two numbers that actually moved. Recorded: position-set membership, per-name
weight changes, five book metrics, the thesis (as a supersession, not a prose diff), and the
scenario count.

**Position identity is `(asset, direction)`** — the key
[ADR-0040](0040-published-book-is-the-book-of-record.md) already matches picks back on.
Flipping a name long→short is a *different position*, not an edit to one; reporting it as a
weight change would hide a reversed bet.

## Consequences

- **A first publication records nothing.** A baseline is not a change, and logging it would
  put a row on every book ever published and bury the real ones.
- **The first entry is a real correction, not a seed row:** this session's S6 append to the
  live 2026-07-25 book, recorded as `backfill` with the ADR path and commit as evidence,
  and stating that the five existing scenarios were left byte-identical so no previously
  published figure changed.
- `/method/evidence#corrections` renders the log. **An empty table is a real state and says
  so** — "no corrections recorded" and "we do not track corrections" look identical to a
  reader, and the copy is explicit that the log cannot reconstruct what it was not running
  for. Books overwritten before today have no record and never will.
- A null `previous_value` renders as an em dash, never `0` — asserting the book previously
  held a value it never had would be the worst possible defect on the one surface whose job
  is to be trusted about what changed. Pinned by `revisionCell`.
- **This is not a full version history.** It records the *fact* of a change per field, not a
  snapshot of the prior book. Storing every superseded $100M book keyed by a date that gets
  overwritten seventeen times in a day is a different and much larger decision, and the
  reader's question — "did the figure I quoted move?" — is answered without it.
- 14 backend tests on the pure diff plus 5 on the panel. `book_revisions.py` uses relative
  sibling imports and the L5 chain was re-verified in a subprocess, per
  [ADR-0092](0092-the-book-as-an-mcp-server-over-the-tools-that-already-exist.md)'s lesson.

## What this does not answer

It records that the published book changed; it does not surface **which of the day's runs
won and why**. That history exists in `research_agent_runs.raw_output` and would answer a
sharper question — "your book was selected from 17 candidates, and the most recent was
rejected" — which is ADR-0050's agent-churn measurement applied to the published record
rather than to frozen inputs. Left for its own decision.
