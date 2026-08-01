# ADR-0221 — A /facts page for the structured_facts layer

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0218](0218-structured-facts-layer.md), [0220](0220-l5-structured-facts-citation.md), design-goals.md §1, §7, §8

## Context

The `structured_facts` table (m066, ADR-0218) is the layer the L5 reasoning agent cites. It is hand-curated; it has 50 rows for the Q2 question. Without a UI surface, the table is invisible to a reader of the L5 thesis on `/research` or `/book` — the L5 cites `[structured_facts:MSFT:capex_fy26_bn]` and the reader has no way to look up the row, see the source, or check the confidence.

The `/facts` page is the read-side surface for that table. A reader of any L5 thesis can land here and see exactly which numbers the system can defend, with provenance. A fact NOT in this table is not citable; the page makes that explicit.

## Decision

**A new `/facts` route at `frontend/app/facts/page.tsx`** that:

1. Reads `structured_facts` from Supabase on mount, ordered by `as_of DESC`.
2. Renders four sections, one per category: `ai_capex`, `china_ai`, `macro`, `valuation`. Each section is a table with columns `(entity, metric, value, unit, as_of, source, confidence)`.
3. Renders a header summary with the per-category row count.
4. Renders a "How to read this" footer that names the cite token format (`[structured_facts:<entity>:<metric>]`) and the absence-is-data discipline.
5. Renders a "no facts loaded" empty state with the loader command when the table is empty.
6. Renders a `QueryErrorState` (the existing `components/status/EmptyState`) on a Supabase error, with the cause classified per the existing `classifyQueryFailure` helper.

**The page is read-only.** A `structured_facts` row's `source_url`, when present, is a clickable link. The page is not an admin UI; the loader script (`backend/data/structured_facts_loader.py`) is the write path. A future milestone can add a write surface, but the read surface is the first one to land.

**The page does not own its data shape.** The same `StructuredFact` interface would be reused by the `/ask` agent's "facts available" display, and the four categories are the same four the L5 prompt renders. A change in either layer's shape would surface in the other as a type error.

**The cite token is rendered in the page footer** as `[structured_facts:<entity>:<metric>]` so a reader who copy-pastes a cite from a thesis can verify it on this page. A "no such entity" search would not match a row, and a future filter-by-entity control is a small extension.

## Consequences

- **Positive**: the table is now visible. A reader of any L5 thesis can navigate from the thesis to `/facts` and see the source for every numeric claim. The discipline of "the L5 cites only what's in this table" is enforced by the page itself.
- **Positive**: the empty state is actionable. A reader of an empty `/facts` page sees the loader command, not a blank screen — they know the next step.
- **Positive**: the four-category structure mirrors the L5 prompt's four-category section, so a reader auditing the thesis and the page together sees the same groups in the same order.
- **Negative**: a 50-row table is small enough to render in full, but the page does not paginate. If the table grows past 200 rows, the page needs a virtualised list.
- **Negative**: the page is the read surface but not the write surface. Curators update the seed JSON and re-run the loader; a future admin UI is a separate piece of work.

## Refused alternatives

- **A `facts` panel embedded in `/research` or `/book`**: rejected. The thesis is a moving target (the L5 generates it nightly), and embedding facts in the thesis page makes the table look like part of the thesis. A standalone route is the right shape: a reader of the thesis navigates TO the facts, not the other way around.
- **A timeline of `as_of`**: rejected for this milestone. The trajectory view is the right next step but is out of scope; the page renders the most recent row per (entity, metric).
- **A search/filter control**: rejected for this milestone. 50 rows don't need a search; if the table grows past 200, this is a 2-line addition.
