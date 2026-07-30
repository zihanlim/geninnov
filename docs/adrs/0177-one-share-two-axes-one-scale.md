---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0177 — One share, two axes, one scale

## Context

ADR-0176 stacked `TrendPlot` ("Share over time") above `DetectionScatter` in
one column at one width. Both charts plot the same underlying quantity —
share of the day's headlines — but on perpendicular axes: `TrendPlot` puts
share on its Y-axis (against date on X), `DetectionScatter` puts share on its
X-axis (against velocity on Y). Each computed its own maximum independently:

- `TrendPlot`'s `yMax` = the largest share across every point of the top-5
  series it plots, padded ×1.1.
- `DetectionScatter`'s `xMax` = the largest *latest* share across every
  tracked phrase, padded ×1.08.

These are different data (historical top-5 vs. today's full set) with
different padding, so the two axes routinely landed on different maxima and
therefore different tick sets — a phrase sitting at 15% on the trend line
could read as roughly the same distance-from-edge as a phrase sitting at 8%
on the scatter, because "distance from the left edge" meant a different
percentage on each chart. The operator asked for the two axes to match, so a
reader can read a position on one chart directly against the other without
converting.

## Decision

**Compute one padded share maximum in `NarrativeTrends`, over the union of
what both charts actually plot, and pass it into both as an override.**

- `TrendPlot` gains an optional `yMax` prop; when supplied, it replaces the
  series' own computed max entirely — not a floor, a full override, since a
  shared axis means neither chart's local data may narrow the other back
  down.
- `DetectionScatter` gains the matching optional `xMax` prop, same contract.
- `NarrativeTrends` computes:

  ```ts
  const sharedShareMax = Math.max(
    0.01,
    ...series.map((s) => s.latest.share),               // what the scatter plots
    ...top.flatMap((s) => s.points.map((p) => p.share)), // what the trend plots
  ) * 1.1;
  ```

  over the UNION of both charts' own data — the scatter's today-only share
  across every tracked phrase, and the trend's historical share across just
  the top 5 — so neither chart's real data can be clipped by an axis sized
  only for the other's numbers.
- One padding factor (1.1), not two. The scatter's previous 1.08 and the
  trend's 1.1 existed only because each axis was computed alone; once they
  share a number, keeping two different pads for the same purpose would be
  arbitrary rather than a considered difference.
- `niceTicks(0, sharedShareMax, 4)` — already the SAME function both charts
  call — so passing the same input produces the same tick set on both
  automatically; no separate tick-matching logic was needed.

## Consequences

Positive:
- Verified live on the 2026-07-30 run: both charts render the identical tick
  set `0%, 5%, 10%, 15%, 20%, 25%, 30%` — a reader can now read a dot's
  horizontal position on the scatter directly against a line's height on the
  trend chart above it, on one shared scale.
- 4 new tests: `TrendPlot`'s `yMax` and `DetectionScatter`'s `xMax` each
  proven to override their own computation (not just accept the prop), plus
  an integration test proving the shared max reaches into a series'
  HISTORICAL peak even when that series' *today* value alone would compute a
  much smaller axis — the case a naive "share the smaller chart's own max"
  implementation would get wrong. 958 frontend green (954 prior + 4).
- Both override props default to `undefined`, so any other caller of either
  component (there are none for `DetectionScatter`; `ThemeTrends` calls
  `TrendPlot` with neither `yMax` nor the ADR-0176 geometry props) is
  unaffected.

Negative / friction:
- **The scatter's own padding changed** from ×1.08 to ×1.1 as a side effect
  of unifying the two — a ~2pp difference in headroom on the days this axis
  is NOT dominated by the trend chart's historical data. Not expected to be
  visible, not specifically tested for.
- **A third number now has to agree with two others.** `sharedShareMax` sits
  between `series`/`top` (the data) and two chart components; a future change
  to either chart's own internal share-reading logic (e.g., which field
  counts as "the" share) has to be mirrored in this computation too, or the
  three quietly diverge again. No test currently derives `sharedShareMax`
  from the charts' own internals the way `risk-thresholds.test.ts` derives a
  threshold from Python — a manual-agreement risk accepted here, not closed.
- **The override is all-or-nothing.** A component reading `yMax`/`xMax` as a
  prop cannot express "use my own number, but at least this large" — the
  caller must already know the final value. Fine for this one call site,
  which does exactly that; would need revisiting if a second caller wanted a
  floor instead of a fixed value.

## Alternatives considered

**Give each chart a `minShareMax` floor instead of a full override**, so each
still computes its own max but is raised to meet the other's if smaller.
Rejected — the two would then only agree when one chart's own number
happened to be the binding one, and could still diverge (e.g., if a future
change made `DetectionScatter`'s own default larger than the trend's, the
trend would still be showing an old cached max). A single shared value
computed once removes the possibility of the two drifting apart, not just
today.

**Round the shared max to a fixed "nice" percentage (e.g., always the next
5% or 10% boundary) rather than deriving it from `niceTicks`.** Rejected —
`niceTicks(0, sharedShareMax, 4)` already produces evenly-spaced, human-
readable ticks from any input; adding a second rounding pass before that
would be redundant machinery solving a problem the existing function already
solves.
