# ADR-0081 — A worked-example lineage panel on `/book`, additive only

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0010](0010-citation-footnotes-everywhere.md), [0036](0036-carry-as-excess-yield-over-funding.md), [0053](0053-the-published-book-was-sized-by-hype.md), [0057](0057-stability-is-a-per-trade-fact-not-a-percentage.md), [0066](0066-not-computable-must-persist-as-null.md), [0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md), [0075](0075-per-pick-betas-are-joined-not-authored.md), [0078](0078-a-disqualifier-you-cannot-locate.md), [0079](0079-adr-0078-described-a-book-that-had-been-replaced.md), design-goals.md §6

## Context

`/book` is built as a daily publication. Each row is a *position*, and a row carries
eight things the rest of the app depends on, in roughly this density: the always-visible
plain rationale (goal #6), the asset's own `factor_tilts` joined from `factor_exposures`
(ADR-0075), the `ma_context` that names the disqualifier (ADR-0078), the EdgeScore
decomposition with the renormalisation text for missing components (ADR-0036), the
sizing chain with the provenance banner that distinguishes "missing conviction" from
"conviction present but not reconciling" (ADR-0053), the per-position replication
stability (ADR-0057), the per-asset scenario contribution from
`scenario_results.contribution_breakdown`, and the `CitationList` footnotes (ADR-0010).
The page renders all eight — the question that prompted this ADR is whether the
**story** is readable end-to-end, in the order a reader needs to follow it.

It is not. The eight things render in the *vertical order the code was written*, not
the order the reader needs to verify a position. A reader asking "why am I short
TLT at 8%" hits the rationale first (goal #6, fine), then the EdgeBars, then the
sizing chain, then the factor table, then the scenario list, then the citation chain —
each *answerable in isolation*, none presented as the chain of derivations the pipeline
actually performed: 10-Q ingestion → theme scoring → position sizing → scenario
attribution. The information is on the page; the **lineage** is not.

A 2026-07-25 review of four external mockups (`stitch_remix_of_auralis_saas_landing_page.zip`,
`andromeda_method_lineage_audit_refined/code.html`) proposed exactly this — a numbered
lineage card with prose-then-formula per step and a citation on the right
(`Capex_Q3 = $3.2B // Source: CIK_0001045810_10Q_2023Q3.xml`). The mockup is the first
external proposal of this iteration to satisfy goal #1 *and* goal #6 together: every
number traces to a source, the source is on the same line, and the prose sits above
the figure. It is also the only pattern from those four that has **no Ledger equivalent
yet** — `Section`, `SubHead` and `Formula` cover the page shell at
`frontend/components/method/primitives.tsx`, but not a numbered-step card with a
connecting rule.

The same review refused the rest of the mockup wholesale: a `COMMIT BOOK` button
(goal #5), real-time framing (cadence is daily), an unlabelled left icon rail (non-goal),
and a two-state `XACT`/`EST` chip that collapses the Ledger's five-state `STATUS_CHIPS`
map (goal #2). Those refusals are not revisited here.

## Decision

Add a `StepNumbered` primitive — a vertical card with a numbered step bubble on the
left rail connected by a 1px hairline, prose on the right, formula with `// Source:`
inline citation where the figure comes from a persisted column — and use it to add a
single **Worked Example** panel to `/book`. The panel renders the lineage for **one
position** per page load: the position with the highest absolute EdgeScore, or the
first-named long if two tie. The panel sits inside `<details>` collapsed by default,
so it does not bloat the page and a reader who came for a different fact is not
forced past it.

The panel surfaces the chain in the order the pipeline performed it, mapping each step
to data the rest of `/book` already shows:

| step | prose | formula | source column |
|---|---|---|---|
+| 1. Raw ingestion | "10-Q parsed; key capex figure extracted" | `Capex_Q3 = $3.2B` | `filings.xbrl_facts.concept_value` (illustrative) |
+| 2. Theme scoring | "LLM evaluation of earnings call against theme vector" | `Theme_Score = 0.98` | `research_recommendations.theme_edges` |
+| 3. Position sizing | "Kelly criterion adjusted for vol overlay" | `Final_Target_Weight = Base_Weight × Vol_Adj × Theme_Score → 0.066` | `portfolio_positions.weight` |
+| 4. Risk attribution | "Per-scenario contribution to book P&L" | `+0.32%` | `research_recommendations.scenario_results[].contribution_breakdown` |

The "illustrative" on step 1 is honest — the column above is what such a step would
point at once the lineage trail is fully persisted. **Today it is not**: step 1's
source line on the published book renders `—  Source not yet persisted` with a
one-line `explainGap` rather than a fabricated `CIK…xml` string. ADR-0010 forbids
the model from authoring sources it cannot trace; the panel inherits the same rule.

## What the panel does NOT do

This is a strict subset of the lineage information already on `/book`, presented in a
different order. It does not:

- **Replace** the always-visible rationale on each row (goal #6).
- **Replace** `EdgeBars`, `SizingChainView`, the per-asset `factor_tilts` table, the
  scenario list, the citation list, or any other existing primitive.
- **Add a new colour, new chip shape, or new font.** The step bubble uses `border-accent`
  (existing token); the connecting rule is `border-border` (existing warm hairline);
  the prose is `text-text-primary`; the formula is `text-text-primary` rendered in the
  existing `.num` primitive (`globals.css:89`); the inline `// Source:` comment is
  `text-text-tertiary`. The chip-contrast test at `frontend/tests/unit/chip-contrast.test.ts`
  is unaffected — no new chip is introduced.
- **Add an icon library import.** No `lucide-react`, no `material-symbols-outlined`.
  The step number is plain text inside a bordered circle.
- **Show absence as zero.** When a step's source column has no persisted value, the
  step renders with `text-text-tertiary` and `—  <explainGap copy>` per `EmptyState`
  convention (`components/status/EmptyState.tsx`). ADR-0058 + ADR-0066.
- **Persist new fields.** The panel is a *read* of the columns the rest of the page
  already reads. If a future ADR persists a new lineage column, the panel picks it up.

## Consequences

### Test surface (added)

- `frontend/tests/unit/worked-example-panel.test.ts` (new): pins that the panel, given
  the current `/book` data shape, surfaces **all eight** fields the rest of the row
  surfaces, with the empty-state copy when any is null. The assertion is on rendered
  text, not on a snapshot — so an empty-state message change is a deliberate test
  edit, not a silent regression. A single failing assertion names which field is
  missing or which gap copy changed.
- `frontend/tests/unit/step-numbered.test.ts` (new): pins the structural contract —
  three steps render in order with the connecting rule between them, the step number
  is a `<span>` not an icon (so the icon-set question stays deferred), the prose is
  rendered as `<p>` not as `<div>`, and the inline source line is rendered as a
  separate `<span>` so screen readers read the formula and the source as distinct
  runs. Keyboard: focus order is prose → formula → source, not bubble-first.
- The existing `chip-contrast.test.ts` runs unchanged. No new chip means no new tint
  means no new contrast case.
- The existing `book-of-record.test.ts` (already pins which fields the row carries)
  is extended by **one** assertion: that the `<details>` containing the panel is
  present and collapsed by default, and that collapsing it does not hide any of the
  row's existing surfaces.

### What this enables

A reader who clicks through "why this position" gets an ordered narrative, not a
pile of widgets. The narrative is the same data the row already shows; the order
matches the pipeline's order. A future ADR that persists a full lineage trail (the
step-1 source column) replaces the `—  Source not yet persisted` copy without
changing the panel structure.

### What this forbids

Adding any new colour, font, chip, or icon to this panel. If a future iteration
wants to colour the step bubble, it must add a token, run the contrast suite, and
update both `globals.css` and `tailwind.config.ts` together — the rule the 2026-07-25
chip-contrast pass established. The panel as written is intentionally the smallest
possible surface change that delivers the lineage card.
