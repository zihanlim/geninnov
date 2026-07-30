---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0181 — Three columns, one baseline

## Context

Two more directions on the `/mandate` row (ADR-0179, ADR-0180), taken together
because the second changes what the first has to mean:

1. **"The mandate", "Risk-limit board" and "Cap utilisation" should align top
   and bottom.** After ADR-0180 they measured 1604 / 1531 / 1131px from a shared
   top edge — three different bottom edges on one row.
2. **The five risk-metric tiles go under the cap-utilisation card, one below
   another.** They had been left full width beneath the row, on the reasoning
   that `md:grid-cols-5` across four 316px columns would wrap to one tile per
   line. Stacked deliberately in one column, that objection becomes the layout.

The second direction settles what "bottom aligned" can mean. If the last column
holds a card *and* a stack of five tiles, the caps card is not what aligns — the
**column** is. A card stretched to the row height there would push the tiles out
of the row entirely.

## Decision

**The grid stretches; each card fills the cell it was given; the last column is
a stack, and it is what the other two align to.**

- `items-start` comes off the row — the one paired grid on this page that does
  not use it. Cells now stretch to the tallest.
- **Each card carries its own `h-full`.** A stretched *wrapper* with a
  content-height card inside aligns nothing, which is what the first attempt
  produced.
- `MandatePanel` and `RiskLimitBoard` are `h-full flex flex-col` with their
  closing note at `mt-auto`, so the slack opens *above* the footer rather than
  below it: each card's closing line sits on the row's bottom edge.
- **`CapUtilisation` carries no `h-full`.** It shares its column rather than
  owning it: content-height at the top, the five tiles beneath it, and the
  column's own height is what meets the other two.
- `RiskMetricsGrid` becomes `grid-cols-2 md:grid-cols-5 xl:grid-cols-1` — two up
  on a phone, five across from `md`, and one per line from `xl`, which is
  exactly where the mandate row exists. Same DOM at every width, so no figure on
  this page is rendered twice. Its `mb-6` is dropped: spacing is the parent
  stack's `gap-6`, and a margin as well would double it.

## Consequences

Measured at 1440 on the 2026-07-30 run: mandate and board both **474 → 2379px**,
and the last column runs 474 → 1604 (caps) → 2379 (fifth tile) — one baseline,
three columns. Tiles are 318px wide stacked; 182px five-across at 1024; 173px
two-across at 390. No overflow on any card or the document, no console errors.
975 frontend tests green, `tsc --noEmit` clean.

Costs:

- **The row got taller** — 1905px against 1604 — because the tallest column now
  contains two things. The page is still 2483px against the 3026px ADR-0179
  inherited.
- **Two cards now have slack inside them.** The mandate has ~300px above its
  closing note and the board ~370px above its own. Pinned footers make that read
  as a deliberate bottom rule rather than a ragged edge, but the whitespace is
  real and it is the price of one baseline.
- **`h-full` is now load-bearing in three components** for a layout decision
  made in a fourth. Each carries a comment saying so; nothing enforces it, and a
  future card added to this row without `h-full` will silently not align.
- **A collapsed caps card no longer matters, but only by luck of ordering.** It
  sits above the tiles, so closing it shortens the column rather than leaving a
  hole. Had it been last, `open:h-full` would have been needed — the approach the
  first attempt took, and the reason the `[&::details-content]` quirk below was
  found.

Recorded because it cost an hour: **Chrome wraps a `<details>`'s non-summary
content in a UA `::details-content` box.** Setting `flex-col` on the element
makes *that box* the flex item, so a `flex-1` child inside it does not grow —
measured, the card body stopped at 1068px inside a 1546px slot. Firefox and
Safari flex the children directly. Not needed in the end (the caps card no
longer stretches), but the next person to reach for `flex` on a `<details>`
should not have to rediscover it.

Rejected:

- **Stretch the caps card and put the tiles below the row.** "Under it" meant in
  its column; below the row is where they already were.
- **Align only the two full-height cards and let the last column ragged-end.**
  It is the tallest column — the other two align to *it*, so there is nothing to
  ragged-end.
- **`items-stretch` without per-card `h-full`.** Measured as the first attempt:
  the cells stretched and the cards inside them did not, so nothing changed
  visually.
