# ADR-0083 — A lineage step must be able to carry its own proof

**Date:** 2026-07-25
**Status:** Accepted
**Extends:** [0081](0081-step-numbered-lineage-panel-on-book.md)
**Relates to:** [0010](0010-citation-footnotes-everywhere.md), [0023](0023-data-provenance-and-fabrication-guard.md), [0053](0053-the-published-book-was-sized-by-hype.md), [0058](0058-explanations-are-owed-per-empty-slot.md), [0066](0066-not-computable-must-persist-as-null.md), [../design-goals.md](../design-goals.md) §1, §2, §8

## Context

[ADR-0081](0081-step-numbered-lineage-panel-on-book.md) added `StepNumbered` and the
`/book` Worked Example panel, and named the natural next step: reuse the same primitive
on `/method` so both pages carry one lineage card. Attempting that migration surfaced
three reasons it could not be done as scoped — each of which would have *removed*
information from the page whose entire job is proving the arithmetic.

**1. `/method`'s claim has a shape `StepNumbered` could not express.** `/method` renders
the Recomputed / Persisted / **Δ** triple twice — once for HypeScore (tolerance `0.05` on
a 0–100 scale) and once for EdgeScore (tolerance `0.005` on `[-1, 1]`); both sites now
read `<Reconciliation>` in `app/method/page.tsx` and are findable by grepping for it,
which is more durable than the line numbers this migration shifted. That triple *is*
the page: a `<Formula>` block
shows what the arithmetic yields, and the Δ proves the database agrees. `WorkedExampleStep`
carried a single `formula` string and no reconciliation field, so a step could show its
working but never show that its working matched what the product reads. Migrating would
have kept the formula and dropped the proof.

**2. `StepNumbered` collapsed multi-line derivations.** Its `formula` rendered inside a
plain `<div>`, while `/method`'s `Formula` primitive uses
`<pre class="whitespace-pre">` (`components/method/primitives.tsx:62`). `/method`'s
derivations are several aligned lines — a column of weighted terms, a `───` rule, then
the result. Moved in as-was, every newline collapses and the arithmetic arrives as one
unreadable run.

**3. `/method`'s blocks are not numbered steps.** They sit inside larger prose sections,
not in a four-stage pipeline trail. Wrapping them in a numbered bubble with a connecting
rule asserts a *sequence* that does not exist, which is a different kind of false claim
than a wrong number but a false claim nonetheless.

Underneath all three sat a duplication worth naming on its own: the same correctness
claim was implemented twice, each copy inlining its own tolerance literal, its own
`Math.abs(delta) < …` test, and its own verdict wording. Two renderings of one claim can
disagree about the claim. Worse, both lived inside a Next.js **route file**, which may
only export `default` and the framework's own names — so neither could be imported by a
test, and the product's central assertion was unverifiable by construction.

## Decision

**Share the claim, not the chrome.**

1. **The verdict becomes a pure function.** `frontend/lib/method/reconciliation.ts`
   exports `reconcile(recomputed, persisted, tolerance)` returning a
   `ReconciliationVerdict`, plus `deltaTone` and `deltaCaption`. Testable directly, and
   callable from any surface that needs the claim.

2. **The verdict is three-state, and callers must handle all three.**
   `reconciles: true | false | null`, where `null` means *the comparison could not be
   made*. This is the load-bearing decision. Collapsing "no persisted value yet" into
   `false` reports a reconciliation **failure** for a row that simply has not been
   scored — an accusation against the pipeline rather than a gap in the data.
   Collapsing it into `true` claims a proof that never ran. Both are worse than
   `— no persisted value to compare`. This is
   [ADR-0058](0058-explanations-are-owed-per-empty-slot.md) and
   [ADR-0066](0066-not-computable-must-persist-as-null.md) applied to a *verdict* rather
   than to a number: an empty slot owes an explanation, and a thing that could not be
   computed must not be reported as though it were. `NaN` and `Infinity` are treated as absent for the same
   reason: a `NaN` delta compares `false` against every threshold, so admitting it as a
   value renders a missing input as a failure.

3. **Tolerances are named constants, not literals.** `HYPE_TOLERANCE = 0.05` and
   `EDGE_TOLERANCE = 0.005` live beside `reconcile`. The tolerance is **scale-dependent**
   and has **no default** — HypeScore's 0–100 and EdgeScore's `[-1, 1]` differ by two
   orders of magnitude, and EdgeScore's *sign is the trade direction*, so a "small"
   absolute gap there is not small. Each verdict tile and its failure `<Note>` are
   separate pieces of markup that both test the threshold; two literals is precisely how
   they come to disagree about whether the book reconciles.

4. **One presentation, two modes.** `frontend/components/Reconciliation.tsx` draws the
   verdict as three `Stat` tiles (`/method`, visually unchanged) or as a compact
   three-row block (`compact`, for a lineage step, where a row of cards would dominate
   the step it belongs to).

5. **`StepNumbered` gains an optional slot.** `WorkedExampleStep.reconciliation?:
   { verdict, labels, format }`. A step that recomputes something persisted can now
   prove it; a step that merely reports a stored figure leaves the field undefined and
   renders no empty proof.

6. **`StepNumbered`'s formula preserves newlines** (`whitespace-pre-wrap`). Single-line
   formulas are unaffected.

7. **`/method` keeps its own structure.** It adopts `<Reconciliation>` in place of six
   hand-rolled `Stat` tiles and keeps its `Formula` blocks and section layout. It is
   *not* wrapped in `StepNumbered`, per context item 3.

The extracted comparison preserves `/method`'s existing **strict `<`**. Widening it to
`<=` would silently loosen every verdict in the product, so the boundary is pinned by
test rather than left to the next reader's judgement.

## What this corrects in ADR-0081

ADRs are immutable, so two drifts between ADR-0081's text and the shipped code are
recorded here instead. **In both cases the code is right and the ADR text is wrong.**

- **The sizing formula.** ADR-0081's step table gives step 3 as
  `Final_Target_Weight = Base_Weight × Vol_Adj × Theme_Score` with the prose "Kelly
  criterion adjusted for vol overlay". That is the **external mockup's invented
  formula**, carried into the ADR from
  `stitch_remix_of_auralis_saas_landing_page.zip`. Andromeda does not size by Kelly; it
  sizes by **conviction × inverse-vol**, normalised across the book and clamped to the
  caps ([ADR-0053](0053-the-published-book-was-sized-by-hype.md)). The implementation
  in `lib/book/workedExample.ts` correctly uses conviction and correctly falls back to
  the HypeScore-rank path with an explicit gap note. No Kelly criterion is or should be
  in this codebase.
- **Test filenames.** ADR-0081 names `worked-example-panel.test.ts` and
  `step-numbered.test.ts`; the shipped file is `frontend/tests/unit/worked-example.test.ts`.

The second is trivial. The first matters: an ADR asserting a sizing model the system
does not use is exactly the "future agent reads the repo and learns something wrong"
failure the doc-sync rule exists to prevent — and it entered the record because a
mockup's fabricated arithmetic was transcribed alongside its layout. **Adopt an external
comp's shape; never adopt its numbers.**

## Consequences

### Test surface (added)

- `frontend/tests/unit/reconciliation.test.ts` — the verdict as a pure function: the
  tolerance boundary either side and exactly on it (strict `<`), sign symmetry,
  scale-dependence (the same `0.01` gap passes HypeScore and fails EdgeScore), and every
  absent-input permutation returning `null` rather than `false`, including `NaN` and
  `Infinity`.
- `frontend/tests/unit/reconciliation-render.test.tsx` — all three values surfaced in
  both modes; the `null` path drawn muted with "no persisted value to compare" and
  **never** the failure ink; EdgeScore's sign preserved at 4dp; multi-line formulas
  preserved; a step with nothing to reconcile rendering no proof. Plus three
  source-level guards that `/method` still renders **both** reconciliations, has no
  hand-rolled `Δ` tile left behind, and tests the threshold through the constants rather
  than a literal.

Negative control run: deleting `/method`'s EdgeScore block fails exactly the
both-worked-examples assertion, and nothing else.

### What this enables

A lineage step can now make a falsifiable claim about its own arithmetic, which is what
[ADR-0081](0081-step-numbered-lineage-panel-on-book.md)'s step 3 wanted and could not
express. Any future surface needing "does this reproduce what we published" calls
`reconcile` rather than inventing a fourth copy of the comparison.

### What this forbids

- Inlining a tolerance literal. Add a named constant beside the existing two.
- Treating `reconciles === null` as a failure or as a pass. It is a third state and the
  UI must say so.
- Adopting an external mockup's formulas along with its layout. See the correction above.

### Known limitation

`/method` has not been verified against live Supabase data in this environment — the
browser available here cannot resolve the database, so both worked examples render
`Loading…`. The presentation is covered by render tests and by a visual check against
the shipping stylesheet
(`docs/captures/2026-07-25/method-book-shared-reconciliation.png`), but no one has yet
seen the migrated blocks filled with real numbers.
