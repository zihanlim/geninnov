# ADR-0165: A layout gate belongs to the thing it gates

**Status:** Accepted
**Date:** 2026-07-29
**Related:** [ADR-0084](0084-method-splits-by-reader-question-not-by-copy.md), [ADR-0086](0086-a-labelled-rail-that-collapses-rather-than-a-glyph-rail.md), [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0146](0146-a-detector-and-a-comparison-are-different-charts.md), [ADR-0162](0162-a-mark-you-can-see-but-cannot-name.md)

## Context

Both attention boards on `/` — `NarrativeTrends` (the ADR-0146 detection plane)
and `ThemeTrends` (the anchor themes' `TrendPlot`) — are built as a plot beside
its figures table: `grid-cols-[minmax(0,2fr)_minmax(0,1fr)]`, plot left, table
right. That layout was written, committed, and never seen.

Both were gated at `wide` (1424px). `wide` is not a general "desktop" gate. It
is derived, twice over, from things that have nothing to do with these cards:
ADR-0084 derived it from `BOOK_ROW_MIN_W` (the width below which a position
row's seven columns collide) and ADR-0086 kept it at 1424 rather than 1440 so
the **SideRail** would clear a Windows scrollbar. It is a nav-and-book gate.
Borrowing it for the trends boards priced their split at a rail's breakpoint
rather than at their own table's width.

The cost was that the split effectively did not ship. A 1920×1200 screen — the
machine this repo is developed on — at Windows 11's default 150% display
scaling reports **1280 CSS px**, and once Chrome's classic space-taking
scrollbar is subtracted, **~1265**. Every one of those is below 1424, so both
boards stacked full-width on the majority desktop case. The owner asked for the
table to be on the right third and the plot on the left two-thirds; it already
was, at a width almost nobody has.

The obvious repair — retarget at `lg` (1024px) — is wrong, and measuring says
so. `NarrativeTrends`' figures table is **seven columns** (Narrative, Trend,
Share, Velocity, Status, Already watched by, Found by). At `lg` the figures
column is **297px** against a table that wants **388px**: a 91px horizontal
scroller, and a scroller is how a column stops being read. The original `wide`
comment named this risk correctly; it just answered it with someone else's
constant.

`xl` (1280px) is wrong for the reason ADR-0086 already wrote down and this
change nearly walked past a second time: a CSS media query matches the viewport
**excluding** a classic scrollbar, so the maximised 1280-logical window that
motivated the whole change reports 1265 and an `xl` gate would be dead on the
exact machine it was built for.

`ThemeTrends`' own stated reason for `wide` was a different error worth
recording: *"the 2fr column is too narrow for the end labels to sit beside the
lines rather than on top of them."* That misreads the geometry. `TrendPlot` is
a `viewBox`, so narrowing the column scales labels and lines by the **same**
factor — they cannot collide at any width. What narrowing costs is label
**size**, not overlap, and 10px of a 720-unit box renders ~11px at the column
this gate produces.

## Decision

**A layout gate is derived from the content it gates, and measured, not
estimated.**

1. **A second breakpoint, `figures: 1248px`**, beside `wide: 1424px`. This is a
   deliberate departure from ADR-0086's *"one gate, one derivation, no second
   constant to drift"*. That rule was written to stop a **second gate for the
   same concern** (the rail) from drifting against the first. These are two
   different concerns with two different derivations, and collapsing them is
   what caused this bug: one constant serving both meant the trends split
   inherited a rail's arithmetic. The cure for drift here is that each gate
   states what it is derived from, in the config, next to the number.

2. **Derived from the measured min-content of the binding table.**
   `NarrativeTrends`' seven-column table is the constraint; `ThemeTrends`' four
   columns want only 249px. Measured in the browser (set the wrapper to 1px,
   read `scrollWidth`), not estimated:

   | | measured |
   |---|---|
   | narrative table min-content, `pr-3` gutters | 388px |
   | narrative table min-content, `pr-2` gutters | **364px** |
   | figures column at viewport 1248 | 371.7px (7.7px headroom) |
   | figures column at viewport 1265 | 377px |
   | theme table min-content | 249px |

3. **`pr-3` → `pr-2` on the narrative figures table only.** Seven columns pay
   the gutter six times, so 4px buys back 24px and drops the table under the
   column. The gutter was the only slack available: every column width is
   min-content over a real value (`established`, `AI Capex`, `not measurable`),
   so the next 4px would truncate a reading rather than tighten a rule.
   `ThemeTrendsTable` keeps `pr-3` — it is not near its limit and matching for
   symmetry would spend density it does not owe.

4. **Do not re-derive the gate as `(viewport − gutter − gap) / 3`.** That
   shorthand was tried and overstates the column by ~17px, because the chain
   from viewport to column runs through the `lg` gutter, the `TerminalPane`, the
   card's own `p-4` and the 20px grid gap. It predicted 394px where the browser
   reports 377px — enough to place the gate where the table still scrolls. The
   config says this out loud, because the next person to tidy it will reach for
   the arithmetic first.

5. **1248, not 1280**, so the gate clears the scrollbar. Verified at the
   boundary: **1248 splits, 1247 stacks**, and 1265 — the owner's actual
   viewport — splits with no scroller in either table.

## Consequences

- The split ships. At 1265 both boards render 754.7px plot ‖ 377.3px table,
  page and tables free of horizontal overflow.
- Below 1248 both boards stack exactly as they did. That remains the right
  answer for a seven-column table, and it is now the answer for a stated reason
  rather than by inheritance.
- The repo now has **two** breakpoints. `wide` (1424) = the SideRail and the
  two-pane book row. `figures` (1248) = a plot beside its figures table. Adding
  a column to `SeriesTable` changes the gate, and the comment in `SeriesTable`
  says so at the site where such a column would be added.
- `wide` is unchanged, so ADR-0084 and ADR-0086's arithmetic still holds and
  nothing on `/book`, `/ask`, `TopBar` or `SideRail` moves.
- ADR-0126's relief for the two low-contrast palette slots (a figures table
  carrying every number the chart encodes) is now actually visible beside the
  chart at ordinary widths, rather than a screen-height below it.
- **Not adopted:** a container query. It is the theoretically correct tool —
  the constraint is the card's width, not the viewport's — but this codebase
  gates layout with Tailwind screens everywhere, and introducing a second
  mechanism for one card pays a consistency cost larger than the precision it
  buys. If a third card ever needs this, revisit.
- **Not adopted:** dropping columns from the narrative table at narrow widths.
  Every column is a reading the board is obliged to carry (ADR-0126: a tooltip
  is never the only copy of a number), and hiding `Already watched by` in
  particular would remove the field that separates "Fed Policy is working" from
  "nothing is watching this" (ADR-0128).
- **Not adopted:** shrinking the `w-[84px]` sparkline column. Measured, it is
  not binding — the browser compresses it to 42px before the table reaches
  min-content, so the change would have bought nothing.
