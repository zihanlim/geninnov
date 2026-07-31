# ADR-0198 — A source line is a claim about the schema, and three of four were false

**Date:** 2026-07-31
**Status:** Accepted
**Relates to:** [0010](0010-citation-footnotes-everywhere.md), [0036](0036-carry-as-excess-yield-over-funding.md), [0040](0040-published-book-is-the-book-of-record.md), [0053](0053-the-published-book-was-sized-by-hype.md), [0066](0066-not-computable-must-persist-as-null.md), [0078](0078-a-disqualifier-you-cannot-locate.md), [0081](0081-step-numbered-lineage-panel-on-book.md), [0083](0083-a-lineage-step-must-be-able-to-carry-its-own-proof.md), design-goals.md §1

## Context

The `Worked example lineage` panel on `/book` (ADR-0081) renders four steps, and each
step's whole reason for existing is the line under the figure naming the
`table.column` it traces to. The panel's own body copy makes that the promise:
*"Each step names the table.column the figure traces to."*

Three of the four named a table the figure was not read from. Two named a table that
does not exist in any migration.

| step | cited | actually read from |
|---|---|---|
| 1. Raw ingestion | `filings.xbrl_facts.concept_value` | `research_recommendations.picks[].ma_context` |
| 2. Theme scoring | `research_recommendations.theme_edges.score` | `theme_signals_history.edge_score` |
| 3. Position sizing | `portfolio_positions.weight` | `research_recommendations.picks[].notional` |
| 4. Risk attribution | `research_recommendations.scenario_results[].contribution_breakdown` | correct |

There is no `filings` table and no `xbrl_facts` column anywhere in
`supabase/migrations`, and there never will be: this pipeline ingests news headlines
and price/macro series, not filings. `research_recommendations.theme_edges` is in no
migration and no backend module. `portfolio_positions.weight` is a real column, but
it belongs to the HELD book, and the figure above it comes off the PUBLISHED one —
the distinction ADR-0040 exists to hold, pointing a reader at a table that can
legitimately disagree with the number they are looking at.

**Where they came from is the useful part.** All three are the external stitch comp's
invented schema (`docs/design/stitch-2026-07-27/andromeda_method_lineage_audit_refined/code.html`),
transcribed into the implementation along with the layout. ADR-0083 already caught
this import one field over: step 3's prose arrived as *"Kelly criterion adjusted for
vol overlay"* over `Final_Target_Weight = Base_Weight × Vol_Adj × Theme_Score`, a
sizing model this codebase does not use, and 0083 closed with **"Adopt an external
comp's shape; never adopt its numbers."** It fixed the prose and the formula in the
same file and left the `sourceColumn` beside them untouched — so the rule was right,
its application stopped one field short, and the field it stopped short of is the
only one presented to the reader as a citation.

Step 2 was wrong about the number as well as its address. Its prose read *"LLM
evaluation of the position filings against the theme vector, normalised to [0, 1]"*.
EdgeScore is a deterministic weighted mean of trend / regime / carry / value /
sentiment, renormalised over the components that exist (ADR-0036), and it is signed
on [-1, +1] — `edge_direction` reads its sign to choose long, short or abstain. No LLM
is involved at any point. On a page whose L5 section is careful to mark exactly which
figures an LLM touched, a deterministic score was labelled as one of them.

Two things let this survive since 2026-07-25:

1. **The test named itself after the property and then did not test it.**
   `worked-example.test.ts` had a block called *"no fabricated citations"* asserting
   `sourceColumn` matched neither `/l5_agent/` nor `/CIK_/` — the two inventions
   someone had already noticed. A denylist can only catch the fabrication you thought
   of first. Its sibling assertions pinned the fabricated strings as expected values
   (`toMatch(/^filings\.xbrl_facts/)`), so the suite was actively holding them in
   place.
2. **The component header cited ADR-0081 for the opposite of what ADR-0081 decided.**
   Commit `1bc0d879` opened the panel by default and rewrote the header to
   *"ADR-0081 - an open-by-default lineage panel... the complete five-step path"*.
   ADR-0081 decided `<details>` **collapsed** by default with a stated reason, and the
   panel has four steps, not five. A header that confidently mis-attributes its own
   layout is not read as a place to check the field below it.

## Decision

**A `sourceColumn` names the table the value in that step was actually read from, and
that table exists in `supabase/migrations`.** Not the table it ought to come from,
not the one an upstream comp drew, not a sibling table holding a same-named column.

Applied:

- **Step 1** cites `research_recommendations.picks[].ma_context` and reports
  `sourcePersisted: true` when the position has one. It was previously hardcoded
  `false` — "the lineage trail is not yet persisted end-to-end", pending a filings
  column that is not coming — while rendering a persisted figure. Its prose now states
  what ingestion here is (news + price/macro series, no document-level trail) rather
  than promising one.
- **Step 2** cites `theme_signals_history.edge_score`, labels the figure `EdgeScore`
  rather than the comp's `Theme_Score`, and describes it as deterministic, signed, and
  renormalised over present components.
- **Step 3** cites `research_recommendations.picks[].notional`. That is what the step
  displays: `BookBody` hands over `chain.steps[chain.steps.length - 1]`, and
  `buildSizingChain` ends on the notional, not the weight. The prose now carries the
  chain through to that last line so figure, prose and citation describe one thing.
- **Step 4** is unchanged. It was right.

**The guard becomes an allowlist derived from the schema — table AND column.** The
test reads every `supabase/migrations/*.sql` and builds a column set per table from
`CREATE TABLE` bodies and `ADD COLUMN` runs, carrying columns across
`ALTER TABLE … RENAME TO` (migration 008 renamed the two L5 tables in place, so
without that step every L5 citation would fail). Each step's cited table must exist
and its first field must be a real column of that table, checked on both the populated
and the all-null path, since a step that cannot render its figure still prints its
source line. Anything deeper is a path inside a `jsonb` column
(`picks[].ma_context`) and is not verifiable from the DDL; the test says so rather
than skipping it silently. A companion assertion pins that the schema was actually
parsed, so a broken path cannot turn the check into a vacuous pass. Same move as
`risk-thresholds.test.ts` parsing `risk_engine.py`: derive the expectation from the
artefact rather than restating it in a list that itself needs maintaining.

**A table-only allowlist was written first, and it passed.** `theme_edges` is an
invented sub-object under `research_recommendations`, a table that does exist — so
checking the first segment alone reproduced the denylist's failure one level down, in
the very fix for it. It was caught by running the guard against the fabrication it
was written to catch, which is the only way that class of hole shows up: a guard that
has never failed has not been tested, it has been asserted.

**The panel stays open by default**, and this ADR is where that is recorded. It
arrived with the responsive grid that keeps four steps compact when open, which is a
real improvement over the stacked layout ADR-0081 was collapsing; the defect was
attributing it to an ADR that decided otherwise. The header comment now says four
steps, says the open state is deliberate, and points here.

## Consequences

### What this costs

Step 1 no longer describes a lineage trail arriving later, because it is not arriving:
naming a column that will never exist is a worse promise than admitting the panel's
first step is a price observation. A reader who wants document-level provenance now
learns from the step itself that this system has none.

### What this forbids

A `sourceColumn` for which no migration creates the table. The test fails by name and
prints the offending string, so the next person to transcribe a comp's schema learns
it at the point of the paste rather than four months later.

It does **not** forbid citing a column that is null for a given position — that is
ADR-0066's case, and `sourcePersisted: false` plus `sourceGap` remain the way to say
so. The distinction this ADR draws is between *"this table exists and this position
has no value in it"* and *"this table does not exist"*. Only the first is a gap; the
second is a fabricated citation with a gap notice attached, which reads as more
honest than saying nothing and is less.

### What it leaves open

`SizingFinalInput.display` is a pre-rendered string, so the lib cannot verify that the
caller handed it the notional line rather than the weight line — the citation is
correct for `BookBody`'s current call, and a second caller passing the weight would
make it wrong with nothing failing. Recorded in the interface's doc comment rather
than solved: threading the chain's step key through would widen a two-field input for
one call site.

The panel remains an end-to-end lineage spanning phases 2–4 sitting inside the
Holdings section of a page that is phase 3 (`Construction & sizing`), and its step 3
still restates what `SizingChainView` shows inside every position row. That placement
question is not settled here; only the citations are.
