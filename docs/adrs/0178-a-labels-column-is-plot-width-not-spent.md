---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0178 — A label column is plot width not spent, and one phrase is one colour

## Context

Two more requests followed ADR-0176/0177's width- and axis-matching work on
the narrative board's stacked "Share over time" / detection-plane pair:

1. **The trend line's end-labels were squeezing the plot.** `TrendPlot`'s
   default geometry reserves `PLOT_RIGHT = 148` units for direct end-labels
   sitting in a dedicated gutter to the right of the plotted data — sized for
   `ThemeTrends`' 720-wide box, where 148 of 720 units (20%) is a reasonable
   trade. At the narrative board's narrower `S_WIDTH = 430` (ADR-0176), the
   same 148-unit gutter consumed 34% of the box, leaving only 238 units for
   five lines across up to 30 days. The operator asked for the label text to
   move left, inside the x-axis's own width, rather than requiring a separate
   margin.
2. **The line colours didn't match the dot colours for the same phrase.**
   `TrendPlot` colours each line via `seriesColor(phrase, i)` — a rank-based
   rotation through `SERIES_COLORS`, with a phrase-text lookup against
   `IDENTITY_COLORS` that, for narrative phrases, never actually fires (no
   tracked phrase is literally the string `"AI Capex"`; the theme name lives
   at `covered_by`, not in the phrase itself). `DetectionScatter` colours its
   marks via a *different* function, `markColor`, checking `covered_by`
   directly — so "ai" (`covered_by: "AI Capex"`) got the theme's pink hue on
   its dot but a rank-rotation colour on its line, a latent inconsistency
   neither chart's own tests could catch because each only ever asserted
   against its own colouring rule.

## Decision

**Labels move inside the plot on a new `labelInside` flag; colours are
computed once, in the parent, and handed to both charts as an explicit map.**

### Labels

- `TrendPlot` gains `labelInside?: boolean` (default `false` — `ThemeTrends`
  is unaffected). When true, each label anchors at `x(lastDate) - 6` with
  `text-anchor="end"`, extending leftward from the line's own endpoint
  instead of starting `LABEL_X` units to the right of `plotLeft + plotWidth`.
- The narrative board's call site passes `plotRight={16}` alongside
  `labelInside` — collapsing the 148-unit gutter down to the few units
  needed for breathing room, since the label no longer lives out there.
  `plotWidth` grows from 238 to 370 units as a direct result — the fix to
  "the plot is being squeezed" is arithmetic, not cosmetic.
- The label anti-collision *stacking* logic (push overlapping labels apart
  top-to-bottom) is untouched — it never depended on which side of the plot
  the labels render on. Only the *connector* shape for a displaced label
  changes: a short vertical tie at the point's own x (the same shape
  `DetectionScatter` already uses for its own displaced labels) rather than
  the old rightward-then-diagonal polyline, since the label no longer sits
  off to one side needing a horizontal run to reach it.
- `ThemeTrends` passes neither `labelInside` nor a smaller `plotRight` and
  is provably unaffected (existing byte-identical-defaults test still
  passes).

### Colours

- `TrendPlot` and `DetectionScatter` both gain an optional
  `colors?: Map<string, string>` prop — a direct phrase→colour override,
  checked before either component's own resolution logic (`seriesColor` /
  `markColor`'s `covered_by` check).
- `NarrativeTrends` computes ONE map, `topColors`, from `top` — the only
  place that has both a phrase's RANK (what `seriesColor` needs) and its
  `covered_by` (what `markColor` needs, and what `seriesColor` never actually
  checks for a narrative phrase):

  ```ts
  const topColors = new Map(
    top.map((s, i) => [
      s.phrase,
      (s.latest.covered_by && IDENTITY_COLORS[s.latest.covered_by]) ||
        SERIES_COLORS[i % SERIES_COLORS.length],
    ]),
  );
  ```

  and passes it to both `<TrendPlot colors={topColors} ...>` and
  `<DetectionScatter colors={topColors} ...>`. This is also where "ai"'s
  latent bug is fixed: its colour is now resolved through `covered_by`
  once, correctly, and both charts read the same answer — not two
  independent lookups that happened to agree for some phrases and silently
  disagree for this one.
- Only phrases in `top` (the same handful drawn as lines) are ever in the
  map. Every other mark on the scatter — the long tail beyond the top few,
  which the plane and rug exist specifically to triage — keeps its existing
  coverage-only scheme untouched, so ADR-0146's primary encoding (filled =
  payload, hollow = context) is not diluted for the marks it actually
  governs.
- **Label ink is explicitly NOT touched.** `DetectionScatter`'s direct-label
  text colour stays governed by coverage alone (`text-tertiary` for covered,
  `text-secondary` for uncovered) per ADR-0162's rule that naming a covered
  mark must not promote it to payload. Matching a mark's *hue* to its line is
  a different claim from matching its *label ink* to the payload's, and only
  the first was asked for.

## Consequences

Positive:
- Verified live on the 2026-07-30 run: the trend line's plotted area grew
  visibly (SVG measures 507px wide with zero elements overflowing it, up
  from a plot area that reserved over a third of the box for a label
  column), and the phrase "ai"'s line and dot both render in
  `var(--theme-ai-capex)` — confirmed via the actual rendered attributes,
  not just that both props are wired. "fed" (series-2), "oil" (series-5),
  and "global" (series-4) each match identically between their line and dot.
- 17 new tests: label position (inside vs. outside the plot's own width),
  the displaced-label connector's new vertical shape, `colors` overriding
  each component's own resolution independently, an end-to-end round-trip
  proving the SAME phrase gets the SAME colour on both charts (not just that
  the map is passed), and a dedicated 12-case viewBox-overflow sweep
  (1/3/5 series × 2/5/14/30 runs) at the EXACT production configuration
  (`width=430 height=225 plotRight=16 labelInside`) — distinct from
  ADR-0176's sweep, which used the old 148-unit gutter. 975 frontend green.

Negative / friction:
- **Labels now sit closer to, and can visually crowd, the plotted lines
  themselves** — the tradeoff `DetectionScatter` already accepts for its own
  in-plane labels, now paid by `TrendPlot` too when `labelInside` is set. On
  a day where several of the top-5 converge near the same share, the label
  cluster sits directly over the lines' own endpoints rather than in a clear
  margin; the collision-stacking pass keeps individual labels from
  overprinting each other, but does not move them away from the data.
- **A phrase's colour is now decided one level up the tree**, in
  `NarrativeTrends`, rather than by either chart independently. A future
  third caller of `TrendPlot` or `DetectionScatter` that wants its OWN
  colour scheme must either supply a full `colors` map or accept the
  existing per-component defaults — there is no partial-override path
  (matching some phrases, defaulting the rest, from two different sources).
- `markColor`'s signature changed from taking a loosely-typed
  `{covered_by}` object to explicit `(phrase, coveredBy)` arguments — a
  larger diff at each of its four call sites than a purely additive change
  would have been, in exchange for a signature that makes the `colors`
  lookup's dependency on `phrase` visible at every call site rather than
  buried in the closure.

## Alternatives considered

**Keep the label gutter but shrink `LABEL_X`/font size to fit more lines in
less width.** Rejected — the gutter's actual cost was structural (148 of 430
units, 34%), not a font-size tuning problem; shrinking a 10px label to fit a
148-unit column that is itself too wide for its box does not address why the
box needed the column at all.

**Give `DetectionScatter`'s marks the rank-rotation colour for every phrase,
not just the top 5 also drawn as lines.** Rejected — marks beyond rank 5
would then repeat `SERIES_COLORS`' five slots via `i % 5`, so a rank-6 and a
rank-1 phrase could render in the identical hue with no relationship between
them, which is a NEW kind of ambiguity `DetectionScatter`'s current uniform
`series-1`-for-everyone scheme does not have. Restricting the shared map to
`top` avoids introducing a collision class that did not exist before.

**Also match the direct-label text colour to the mark's hue.** Rejected —
that is the exact promotion ADR-0162 forbids ("naming a covered mark must
not promote it to payload"); the request was for the LINE and the DOT to
match, not for coverage's own ink rule to be re-litigated.
