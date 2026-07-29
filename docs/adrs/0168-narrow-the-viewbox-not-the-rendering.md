# ADR-0168: Narrow the viewBox, not the rendering

**Status:** Accepted
**Date:** 2026-07-29
**Related:** [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0146](0146-a-detector-and-a-comparison-are-different-charts.md), [ADR-0153](0153-two-corpora-two-series-never-merged.md), [ADR-0159](0159-the-plane-read-one-day-and-it-was-the-wrong-one.md), [ADR-0163](0163-a-comparison-surface-over-one-fetch.md), [ADR-0165](0165-a-layout-gate-belongs-to-the-thing-it-gates.md), [ADR-0167](0167-a-card-in-a-column-cannot-be-gated-by-the-viewport.md)

## Context

After ADR-0167 the narratives section was a 2fr board beside a 1fr funnel, at
**829px against 393px**. ADR-0167 recorded that the board's plot ‖ figures split
could not be restored inside a 780px card, and backed it with a measurement:
forcing `2fr 1fr` rendered the plot at 484px, and since the plane's viewBox is
720 wide that is a **0.672× scale**, putting the 9px axis labels at **6.0px**.
It concluded *"no split ratio rescues it — the binding constraint is the plot"*.

That conclusion was right about the ratio and **wrong about the constraint**,
and the error is worth naming because it is easy to repeat: it treated the
plot's width as a fixed quantity that layout could only scale. It is not. An SVG
with a viewBox has *two* widths — the coordinate space it draws in, and the CSS
box it renders into — and only their **ratio** sets the type size:

- Keep viewBox 720, render at 386px → scale 0.54, labels 4.9px. Unreadable.
- Set viewBox 380, render at 386px → scale **1.016**, labels **9.1px**. Correct.

Same column, same marks, legible type. What changes is which quantity gives:
scaling down shrinks the **type**; narrowing the viewBox spends the saving on
**data space** instead. The plane holds the same marks over fewer horizontal
units — tighter, and readable — rather than the same units drawn smaller.

## Decision

**A chart that must fit a narrower column gets a narrower coordinate space, not
a smaller rendering.**

1. **The detection plane draws in its own geometry.** `S_WIDTH = 380`,
   `S_PLOT_LEFT = 40`, `S_PLOT_RIGHT = 92`. `TrendPlot` keeps `WIDTH = 720` — it
   is rendered by `ThemeTrends`, which is still full width — and the two no
   longer share a horizontal scale. The right gutter is smaller than TrendPlot's
   148 because these are labels hanging off dots, not end-labels for lines
   running the full width.
2. **`S_WIDTH` is set near the NARROWEST column the card will offer**, so the
   plot scales up from 1.0 and never down. Below 1.0 labels shrink; above it they
   grow. Only one of those is recoverable, so the design point sits at the floor.
3. **`max-w-[520px]` on the plane bounds the scale.** A plain `w-full` renders it
   at full card width whenever the columns stack (below the `figures` gate the
   card is ~1134px) — **2.98×**, with the 9px labels at 27px, reading as a
   blown-up detail crop. The cap holds it at ~1.37× (12.3px), and the plane
   simply stops growing and sits left in a wider column.
4. **The figures column is FIXED at 340px, not a fraction.** It has a hard
   minimum (319px min-content, measured) and no use for more, so a fraction would
   starve it when narrow and waste width when wide. Fixing it hands every
   remaining pixel to the plane, which is the element that can use them.
5. **`SeriesTable` keeps the sparkline column dropped.** That was done to fit a
   390px card and is retained here for the headroom: 358px → **319px** measured,
   leaving 21px in a 340px track. ADR-0146's own-scale trajectory is the loss;
   the plane beside it encodes velocity as an axis and `Velocity` remains a
   column, so what goes is the *shape* of the path, not its direction or
   magnitude.
6. **One reading of the series, in `lib/useNarrativeSeries.ts`.** The corpus
   (`archive`, ADR-0153), the day rule (last measured day, ADR-0159) and the
   `asOfFallback` disclosure move out of the two components into a hook they both
   call. This was the day's other bug: the funnel defaulted to
   `corpus: "combined"` while the board passed `"archive"`, so a strip reading
   *"193 tracked, velocity not measurable"* sat beneath a chart reading *76
   tracked, velocities to +2.27*. That was repaired by aligning the two call
   sites **by hand**, which is not a fix but a coincidence maintained by
   vigilance — ADR-0163's argument about routes, one level down.

## Consequences

- Measured at viewport 1265: card **780px**, columns **386px ‖ 340px**, plot
  scale **1.016×** (labels 9.1px), table 21px headroom and no overflow. Card
  height **829px → 560px** against the funnel's 393px; the gap goes 436 → 167.
- **The figures are back inside the board's card, on the right** — the original
  request, and the arrangement ADR-0167 declared impossible. It was impossible
  under that ADR's assumption, not in general.
- **ADR-0167's "no split ratio rescues it" is superseded.** Its measurement
  stands and its layout reasoning stands; the claim that followed from them does
  not, because it quantified over ratios with the viewBox held fixed.
- **A real cost:** `S_PLOT_WIDTH` falls from 528 units to 248, so the marks pack
  into under half the horizontal space. In-plane labels collide more often and
  lean harder on ADR-0162's anti-collision pass and leader lines. Verified
  legible on the live board; if the tracked set grows much denser this is the
  thing that will break first, and the fix then is fewer labelled marks, not a
  wider viewBox.
- **`ThemeTrends` is untouched.** It renders `TrendPlot` at 720 in a full-width
  card, which is why the geometries had to split rather than move.
- **Not adopted:** lifting the figures into their own card in the 1fr column.
  Built and measured first — 565px ‖ 675px, near parity, table with 37px
  headroom — and discarded on the owner's direction that the table belongs in
  the same card. It would also have put ADR-0126's relief outside the chart's own
  card boundary, which is defensible but weaker.
- **Not adopted:** a container query. Unchanged from ADR-0167 — the `max-w-[1400px]`
  cap still makes the bounds provable, and the `max-w` on the plane covers the
  one case where the column width genuinely varies.
