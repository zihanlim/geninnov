---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0176 — Two plots, one column, one width

## Context

ADR-0175 added a "Share over time" `TrendPlot` above `DetectionScatter` on the
narrative board, as a standalone full-width block sitting above the existing
"plane ‖ figures" grid. The operator asked for the two plots to be the same
width, both occupying the left side of the card while the figures table stays
on the right — i.e., stacked inside the SAME column the scatter already
shares with the table, not sitting above the whole grid at full card width.

Two things had to be true at once for that to render correctly, and only one
of them is free:

1. **Same CSS width.** Free — both SVGs render `w-full`, so two elements
   stacked inside the same grid column resolve to the same pixel width by
   construction, regardless of their own viewBox numbers.
2. **Legible labels at that width.** Not free. `TrendPlot`'s only geometry
   was fixed at `WIDTH = 720`, sized for `ThemeTrends`' full-width column. An
   SVG with a `viewBox` and `w-full` scales UNIFORMLY: dropping a 720-wide
   viewBox into the ~400px column this layout requires would scale every
   font down by ~0.55×, the exact defect ADR-0168 measured and fixed for
   `DetectionScatter` — 9px labels rendering at ~5px, unreadable. Moving
   `TrendPlot` into the narrow column without addressing this would
   reintroduce ADR-0168's bug on the chart it was written to protect,
   applied to the second chart that now needs the same protection.

## Decision

**`TrendPlot` takes its geometry as optional props, defaulting to the current
720-wide box; the narrative board passes `DetectionScatter`'s own `S_WIDTH` /
`S_HEIGHT` so both plots share one geometry as well as one column.**

- `width`, `height`, `plotLeft`, `plotRight`, `plotTop`, `plotBottom` are now
  props on `TrendPlot`, each defaulting to the existing module constant
  (renamed `DEFAULT_WIDTH` etc.). `ThemeTrends`' call site passes none and
  reproduces today's rendering exactly — pinned by a new test that asserts
  the no-props render is byte-identical to explicitly passing the old
  defaults.
- `NarrativeTrends` calls `<TrendPlot series={top} width={S_WIDTH}
  height={S_HEIGHT} />` — the SAME constants `DetectionScatter` already
  uses, declared once and read by both, rather than a second narrow-geometry
  number this file would have to keep in agreement with the first (the
  ADR-0064 discipline: one constant, not two that happen to match today).
- Both plots now sit inside ONE wrapping `<div className="flex flex-col
  gap-4">` that is itself the grid's first column — `TrendPlot`'s section,
  then `DetectionScatter` — so the figures table remains the grid's second,
  340px-fixed column, beside the stacked PAIR rather than beside just the
  scatter.
- `plotLeft`/`plotRight`/`plotTop`/`plotBottom` are left at their existing
  absolute values (44/148/14/30) even at the narrower width, not scaled down
  proportionally. Those numbers represent the pixel space direct end-labels
  and their leader-line gutter need, which does not shrink just because the
  chart is narrower — the same reasoning `DetectionScatter`'s own `S_PLOT_LEFT`
  / `S_PLOT_RIGHT` already apply. Verified live: 430×225 leaves 238 units of
  plot area (down from 528), and no label overflows the viewBox on the real
  2026-07-30 run — a 21-character end-label ("closes sharply lower") fits
  inside the unchanged 148-unit right gutter.

## Consequences

Positive:
- Verified live via Playwright at 1500px: both SVGs measure identically
  (507×265px CSS, same left edge), and no `<text>` element's bounding box
  exceeds its own SVG's — the two plots are genuinely the same width, not
  coincidentally close.
- `ThemeTrends` is provably unaffected — a new parity test renders `TrendPlot`
  with no props and asserts it matches the explicit-old-defaults render
  byte-for-byte, so "the defaults are unchanged" is checked, not merely
  claimed in a comment.
- A new geometry sweep (`draws nothing outside a 430x225 viewBox at NxM`,
  mirroring the existing default-width sweep across 1/3/5 series and
  2/5/14/30 runs) proves the anti-collision math and viewBox bounds hold at
  the much smaller 238-unit plot area, not just at the 528-unit default this
  file's other geometry tests already covered.
- 5 new tests, 954 frontend green, `tsc --noEmit` clean.

Negative / friction:
- **Below the `figures` (1248px) breakpoint, the two-column grid collapses**
  and both plots stack full-width again, each re-inheriting whatever CSS
  width the single column resolves to at that viewport — still equal to each
  other (both still `w-full` in the same stacking context), but no longer
  narrowed to `S_WIDTH`'s geometry, so label scale drifts back toward 1.18×
  at very wide single-column widths and below 1.0× at narrow ones. This is
  the same responsive tradeoff `DetectionScatter` already accepts below the
  breakpoint; not a new cost, but now paid by two charts instead of one.
- **The date axis is more compressed.** 238 units of plot area over up to 30
  days is a tighter fit than the 528 units `ThemeTrends` gets for the same
  chart type — individual day-to-day moves are harder to distinguish by eye
  than on the wide board, though still within the bounds the new geometry
  sweep verifies.
- `TrendPlot` now has six optional numeric props instead of none — a larger
  surface for a caller to get wrong (e.g. passing `width` without `height`
  and ending up with a non-square-ish aspect no one intended). No caller does
  this today; worth a lint or a paired-prop validation if a third caller
  appears.

## Alternatives considered

**Keep `TrendPlot` fixed at 720 and let the browser scale it down via CSS
`max-width` inside the narrow column.** This is exactly what `w-full` on a
viewBox'd SVG already does with no code change — and is precisely the
illegible-label failure ADR-0168 measured and rejected for `DetectionScatter`.
Not a real alternative, just the bug restated.

**Give `NarrativeTrends` its own narrow-geometry constants, separate from
`DetectionScatter`'s `S_WIDTH`/`S_HEIGHT`.** Rejected — the two plots are
already required to share a column and therefore a CSS width; declaring two
numbers that both have to equal that same width is the ADR-0064 trap (one
fact, two homes) with the added risk that a future resize of one forgets the
other. Reusing `S_WIDTH`/`S_HEIGHT` directly makes that impossible by
construction.

**Full geometry override via a single `geometry` object prop instead of six
scalar props.** Marginally more compact at the call site, but every existing
prop-destructuring pattern in this file (`OptimizerConstraints`,
`OptimizerInputs`, etc. aside — this is frontend, but the same taste applies)
uses flat named props with defaults; an object prop would need its own
partial-merge-with-defaults logic for one caller that only ever overrides two
of six fields (`width`, `height` — `plotLeft` etc. stay at their defaults
here). Not worth the extra indirection for the one caller that needs it.
