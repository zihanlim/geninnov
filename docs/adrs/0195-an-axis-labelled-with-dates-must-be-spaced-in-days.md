# ADR-0195: An axis labelled with dates must be spaced in days

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0066](0066-not-computable-must-persist-as-null.md), [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md), [ADR-0144](0144-a-second-provider-that-is-an-archive.md), [ADR-0175](0175-a-detector-can-carry-trend-context-without-becoming-one.md)

## Context

`TrendPlot` renders two charts: **Share over time** on the narrative board
(ADR-0175) and **Theme trends** below it. Both label their x-axis with two
dates. Neither was spaced in dates.

```
const xIndex = new Map(dates.map((d, i) => [d, i]));
const x = (d) => plotLeft + ((xIndex.get(d) ?? 0) / (dates.length - 1)) * plotWidth;
```

Every run got an equal slice of the width regardless of when it happened. That
is a defensible convention for a series sampled on a regular grid — a
trading-day axis skipping weekends is the familiar case. **Neither series here
is on a regular grid.**

Measured on the live database, 2026-07-31:

| series | window | runs | calendar days | holes |
|---|---|---|---|---|
| `narrative_signals` (`archive`) | 2026-06-30 → 07-30 | 21 | 31 | 07-01…04, 07-12/13, 07-15…17, 07-25 |
| `theme_signals_history` | 2026-07-21 → 07-30 | 9 | 10 | 07-26 |

The archive corpus is GDELT, and ADR-0144 is explicit that it is an *archive*
with a publication lag — sparse days are the expected shape of the source, not
an incident. So the ordinal axis drew the **five-day hole at 2026-07-01..04 and
the overnight 07-29 → 07-30 step at exactly the same width.** A narrative that
did not move for five unmeasured days and a narrative that jumped overnight had
identical slopes.

This is the ADR-0126 failure in the other axis. That ADR's finding was that a
chart without a value axis is a shape rather than a measurement; here the value
axis was fine and the *time* axis was the shape. Worse than a missing axis,
because two date labels sat under it asserting otherwise — a reader has no way
to discover that the x they are reading is a rank.

`ThemeTrends`' own caption already said **"A missing day is a gap, never a
zero"** (ADR-0141). It was true of the data and false of the picture: the gap
existed in the table and was closed up in the chart.

## Decision

**x is calendar time.**

```
const asDay = (d) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const x = (d) => plotLeft + ((asDay(d) - day0) / daySpan) * plotWidth;
```

Parsed as UTC midnight explicitly. `Date.parse("2026-07-30")` is UTC by spec
while `new Date("2026-07-30T00:00:00")` is local; mixing them shifts a point by
a day for any reader west of Greenwich, on an axis whose entire job is now which
day a point sits on.

**A rug of ticks marks the days that have data**, drawn along the baseline.
Calendar spacing puts a gap in the right place; the rug is what says a gap is
there at all. Without it a reader sees a long straight segment and cannot
distinguish a narrative that held steady from days nobody sampled — a line chart
interpolates and has no vocabulary for *not sampled*.

**The rug is fed from a `runDates` prop, not from the plotted series.** The
per-point circles are per series, so a phrase that fell below the document floor
on a day the corpus ran is missing a circle on a day that was measured. The rug
is a claim about the RUN. On 2026-07-30 the plotted top-five's own union was
**14 days against the corpus's 20**, so taking the rug from the series would
have marked six measured days as missing — under a caption telling the reader
that a stretch without ticks is silence in the corpus. The prop falls back to
the series' union, which is correct wherever every series is present on every
run (`ThemeTrends`).

**The caption states both counts** — "20 of the 31 days shown" — because since
the axis became calendar time the runs and the days are different numbers, and
the difference is the thing worth knowing. Same in the `aria-label`, which is
the only copy of it for a reader who cannot see the plot.

## Consequences

- Every gradient on both charts now means what it appears to mean. The steepest
  segment is the fastest move, which was not previously true.
- `ThemeTrends`' caption stopped being aspirational: 2026-07-26 renders as a gap.
- Sampling density is now visible and unflattering — the archive's recent days
  are dense and its older ones are not, so the left of the narrative chart is
  sparse and the right is crowded. That is the data. The previous chart looked
  evenly sampled because it was drawn evenly sampled.
- A long interpolated segment across a hole is still drawn as a straight line.
  The rug marks its ends; the line is not broken. Breaking it would require
  knowing WHY a point is absent — a day the corpus never ran and a day the
  phrase fell below the document floor are different facts, and only the first
  justifies a break. `TrendSeries` carries neither, so the honest option was to
  mark the sampling and leave the interpolation visible rather than assert a
  cause the data does not hold.
- One test had to change with it. `narrative-trends.test.tsx` sliced the
  `<TrendPlot>` call site with `+ 320` characters, so adding a prop pushed the
  last assertion out of the window and failed a test about props that were all
  still present. It now slices to the element's own `/>`. A window that shrinks
  every time the thing it inspects grows tests the length of a call site rather
  than its contents.

## Alternatives considered

- **Keep ordinal spacing and label every point.** Honest about which run is
  which, and still wrong about duration — the reader would have to do the date
  arithmetic to see that two adjacent points are five days apart, on a chart
  whose only purpose is the shape of a trajectory.
- **Ordinal for `ThemeTrends`, calendar for the narrative board**, behind a
  prop defaulting to the existing behaviour. Considered because a weekday-only
  series is the classic case for a trading-day axis. Rejected on the data:
  `theme_signals_history` is missing 2026-07-26, a Sunday — but also runs on
  2026-07-25, a Saturday. It is not a weekday grid, it is "whenever the pipeline
  ran", which is exactly the case where ordinal lies. Defaulting to the old
  behaviour would also have preserved the defect in the chart that already had
  a caption denying it.
- **Break the polyline across gaps.** The most forceful rendering of absence,
  and it overstates: it would draw a break for a phrase below the document floor
  on a day that ran, which is a measurement, not a gap.
- **Interpolate the missing days.** Never seriously — ADR-0066 and ADR-0141 both
  forbid inventing a reading, and a chart is not an exception to them.
