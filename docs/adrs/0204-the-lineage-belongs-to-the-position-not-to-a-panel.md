# ADR-0204 — The lineage belongs to the position, not to a panel

**Date:** 2026-07-31
**Status:** Accepted
**Supersedes:** the one-position-per-page-load decision in [ADR-0081](0081-a-worked-example-lineage-panel-on-book-additive-only.md)
**Relates to:** [0040](0040-the-published-book-is-a-recommendation.md), [0053](0053-the-published-book-was-sized-by-hype.md), [0198](0198-a-source-line-is-a-claim-about-the-schema.md), [0199](0199-the-step-that-removed-a-position-is-the-answer.md), design-goals.md §1, §6, §7

## Context

ADR-0081 built a **Worked Example** panel: the four steps the pipeline performed —
ingestion → theme scoring → sizing → risk attribution — for **one** position per page
load, the highest `|EdgeScore|`, in its own collapsed card. Its argument was that
`/book` had all eight instruments per position but showed them "in the vertical order
the code was written, not the order the reader needs". That argument was right, and the
ORDER is what it contributed.

The panel around the order was not right, and it took ADR-0199 to make it obvious.
Once `BookFunnel` drew the chain and its final node listed the nine held tickers, the
page had a control that selected a position and a panel that displayed one — so the
panel got a `selectedAsset` prop and the chips drove it. That worked, and it was still
the wrong shape. The evidence was on the same screen the whole time:

**The nine worked examples already existed, as row expanders.** The Longs (4) and
Shorts (5) tables sit directly above, and every row's `+` opens onto:

| Row expander, all 9 positions | Worked-example panel, 1 position |
|---|---|
| `ma_context` — last close vs 200-day MA | **1. Raw ingestion** |
| `EdgeBars` — EdgeScore decomposition | **2. Theme scoring** |
| `SizingChainView` — conviction → weight → notional | **3. Position sizing** |
| per-scenario contribution lines | **4. Risk attribution** |
| + factor betas, marginal risk, counter-thesis, citations | — |

ADR-0081 said so itself: *"a strict subset of the lineage information already on
`/book`, presented in a different order."* So the panel was a fifth rendering of data
every row already carried, below a table of nine rows that each expand — plus an
editorial choice ("which position is most interesting?" answered with "the largest
edge") that nothing on the page disclosed.

## Decision

**The four steps open the row.** Every held position has its own lineage, at the top of
its expander, above the instruments that restate parts of it in code order.

- `BookBody.lineageForAsset(asset)` builds the steps with the same
  `buildWorkedExample` the panel used. The lib is unchanged; only its caller moved.
- `PositionRow` takes `lineage` and renders it first, under **"How this position was
  derived"**.
- `BookFunnel`'s ticker chips write `openAsset` — **the same state the row's own `+`
  writes** — then scroll the row into view. One state, so the chip and the row cannot
  disagree about which position is expanded. An intermediate version held a separate
  `lineageAsset`, which is precisely the duplication this removes.
- `WorkedExamplePanel.tsx` is deleted.

**What ADR-0081's reasoning keeps.** Its page-weight concern — *"so it does not bloat
the page and a reader who came for a different fact is not forced past it"* — is
satisfied more strictly than before: rows are collapsed by default, so the steady state
renders **zero** lineages rather than one. Its ordering argument is kept intact and now
applies to all nine positions instead of to whichever had the largest edge.

## Consequences

- The `|EdgeScore|` default selection disappears with the panel. Nothing is chosen on
  the reader's behalf, so nothing has to be disclosed about the choosing.
- A row whose lineage cannot be built still renders every other instrument. Losing a
  whole position because one derivation threw would be the worse failure, so
  `lineageForAsset` returns null on throw and the section is simply absent.
- The anchor is `position-${asset}`, keyed on the ticker, not on the composite
  open-key (`${section}-${asset}-${index}`). An anchor carrying a rank would break the
  moment a position changed rank between runs.
- **Two columns, never four**, and this is measured rather than styled. The panel was
  full-page width, where four steps across worked. A row lives inside the Longs/Shorts
  pair, so each table is ~660px at 1440 and four steps across gave each ~150px — prose
  wrapping to two and three words a line. Two columns is ~320px a step.
- **`scrollIntoView({ block: "start" })`, with `scroll-mt-24` on the row.** `center`
  was tried first and put the reader in the middle of the EdgeScore bars with the four
  steps scrolled off the top — a chip that promised a derivation and delivered the
  middle of a different card. An opened row is ~900px; centring a tall element hides
  its head.
- `lib/book/workedExample.ts` and `StepNumbered` are untouched and still tested;
  `pickWorkedExamplePosition` is now unused by the app and kept only for its tests,
  which is worth revisiting when something else needs it or nothing does.
