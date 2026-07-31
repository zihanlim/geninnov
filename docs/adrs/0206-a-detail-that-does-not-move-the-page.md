# ADR-0206 — A detail that does not move the page, and can be linked to

**Date:** 2026-07-31
**Status:** Accepted
**Supersedes:** the inline-expansion half of [ADR-0204](0204-the-lineage-belongs-to-the-position-not-to-a-panel.md)
**Relates to:** [0081](0081-a-worked-example-lineage-panel-on-book-additive-only.md), [0197](0197-a-lens-control-belongs-where-every-figure-can-follow-it.md), [0199](0199-the-step-that-removed-a-position-is-the-answer.md), design-goals.md §1, §7

## Context

ADR-0204 moved each position's derivation into its own row expander. That fixed the
duplication — nine lineages instead of one panel — and introduced a different problem
the owner named immediately: **opening a position rearranged the page.**

Measured at 1440:

| | width | height |
|---|---:|---:|
| expanded panel, inline in a half-width table | 658px | 1484px |
| after `wide:col-span-2` on the open section | 1342px | 1209px |

The first is cramped, because every paired card inside it (thesis / counter-thesis,
EdgeScore / sizing, catalysts / factor exposure) has to stack in half the canvas. The
second fixes the width and is *worse* to use: the section holding the open row spans
both columns, so the OTHER side's table jumps to a new row. A reader clicks one ticker
and the whole page rearranges under them.

Both are the same underlying fact: a ~1200px detail panel cannot live in the document
flow of a two-column table without moving everything around it.

## Decision

The detail renders in a **fixed right-hand drawer**. `position: fixed`, so nothing in
the flow moves — measured: `document.body.scrollHeight` is 5611 before the click and
5611 after.

**One component, two variants.** `PositionRow` takes `variant: "both" | "row" |
"detail"`. The table renders `row` (the collapsed 7-column line, still marked open in
its own direction's colour); the drawer renders `detail`. Not two components: the
twelve collapsed values and the dozen expanded ones are derived from the same props by
the same code, and splitting the file would fork those derivations the first time one
changed. `both` remains the default so `book-row-field-coverage.test.tsx` keeps
rendering a single tree containing every field.

**A drawer, not a centred modal.** Both avoid the reflow; only the drawer leaves the
book on screen. Reading one position against the row above it is the comparison
`/book` is for, and a centred box over the table removes it.

**The open position lives in the URL.** `?position=TICKER`, so
`/book?lens=credit&position=EMB` opens that book *and* that position. This is the
property that makes a drawer worth having over an inline panel — inline expansion kept
the open row in component state, so it could never be sent to anyone. `router.replace`,
never `push`: nine clicks through nine positions must not become nine back-button steps.

## Consequences

- **The write must not outrun the read**, and the first version got this wrong. Both
  effects run after mount; the URL writer went first, saw no open position because the
  book had not loaded, and **deleted the `?position=` the reader had just arrived on**.
  Measured: `/book?position=SMH` opened nothing. The writer is now gated behind a
  `honouredPosition` ref that the reader sets once the picks exist — whether or not the
  ticker matched, because "not in this book" is also an answer.
- **The click no longer scrolls.** It used to, because the detail rendered inline and
  the reader had to be taken to it. A fixed overlay appears in the same place every
  time, so scrolling would be movement for its own sake — the thing this ADR exists to
  remove. The row keeps its `id` for deep links, not for scrolling.
- **No body-scroll lock.** Locking collapses the scrollbar and shifts the page beneath
  by its width, which is exactly the movement being avoided. The page behind stays
  scrollable and is not marked inert, so Ctrl-F still reaches the table.
- `aria-modal="false"` with focus moved to the close button, Escape to close, and focus
  restored **only if it is still inside the drawer** — a reader who has clicked
  elsewhere should not be yanked back.
- The `wide:col-span-2` experiment is reverted. It is recorded here rather than deleted
  silently because it looked like the fix and measured better on both dimensions, and
  was still wrong on the one that mattered.
