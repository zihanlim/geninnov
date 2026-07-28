# ADR-0145: The theme trends board plots a share of something it names — attention among the anchors

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0064](0064-one-formula-one-place.md), [ADR-0066](0066-absent-is-not-zero.md), [ADR-0091](0091-breadth-must-be-a-share-of-something-named.md), [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md)

## Context

The operator asked for Google-Trends-style plots for the themes. The anchors
have had a daily time series since migration 001 — `theme_signals_history`
carries `mention_count_1d` per theme per `run_date`, seven runs deep at the
time of writing — but nothing plotted it. The only trends board on the page
(`NarrativeTrends`, ADR-0128) deliberately plots phrases *nobody named*; the
nine themes the pipeline actually scores and trades had sparklines of
same-day cross-sectional rank on their cards and no view of attention over
time.

Two prior decisions constrain what such a chart may claim:

- **ADR-0141**: theme news is fetched by *per-theme queries*
  (`THEME_KEYWORDS`), so any aggregate over it is self-selected. A "share of
  voice" over the theme corpus is a share of what we asked for.
- **ADR-0091**: a reading must be a share of something named — and the name
  must be honest about the denominator.

## Decision

**Plot each theme's `mention_count_1d` as a share of the day's total across
all themes, and say exactly what that is: relative attention AMONG the
anchors — not share of an unbiased corpus.**

The caption carries the disclaimer in so many words, and points at the
narrative board (whose ADR-0141 rebuild bought it an unbiased denominator)
as the place that stronger claim lives. The two boards side by side are the
point: one shows attention among the things we watch, the other shows what
the market talks about unprompted.

Mechanics:

- **The plot is `TrendPlot`, imported from `NarrativeTrends` — not copied.**
  One geometry implementation for both boards (ADR-0064 applied to chart
  code): the value axis, tick-step-derived precision, direct end-labels with
  collision push-down, and leader lines all land on both boards or neither.
  `TrendPlot`'s prop was widened to a minimal structural `TrendSeries`
  interface; `NarrativeSeries` satisfies it unchanged.
- **Five colour slots, fixed order, no sixth** — the validated `--series-1..5`
  palette, exported from `NarrativeTrends` rather than re-declared. Themes
  past the fifth-loudest live in the figures table with no dot: a sixth hue
  would be a generated colour the validation record does not cover.
- **A NULL `mention_count_1d` is a gap, never a zero** (ADR-0066): the point
  is omitted AND the day's denominator excludes it. A day whose reported
  total is zero yields no points at all — 0/0 is not a share, and a flat
  zero line reads as "nobody mentioned anything", which is a different claim
  from "the fetch returned nothing".
- **The figures table lists every theme** (share today, raw mentions, Δ vs
  prior run in points) — ADR-0126's relief for the two low-contrast palette
  slots, and the only place themes six-plus appear.

## Consequences

- **HypeScore-over-time was considered and rejected as the metric.**
  HypeScore is a same-day cross-sectional rank — the theme cards' sparklines
  already say so on their face. Plotting a rank as a Google-Trends line
  invites reading "the theme fell" when the truth may be "another theme
  rose"; mention share moves for the reason the line implies.
- **The denominator is honest but narrow.** Fed Policy at 50% means half of
  the day's *theme-query* mentions, not half of market conversation. The
  caption says so; the narrative board exists for the other claim.
- **Seven runs is a short series and the chart does not hide it** — the run
  count is printed in the card header, and with fewer than two plottable
  runs the board says the lines arrive with tomorrow's run instead of
  drawing a single point as a trend.
- **No backfill.** The same reasoning as the narrative series (ADR-0144's
  fabricated-density warning): Brave is a recency ranking, so a
  reconstructed history would be today's survivors wearing past dates. The
  series grows one honest run per day.

## Alternatives considered

- **Peak-normalised "interest" (Google's own 0–100).** Rejected — it hides
  the level. 100-at-peak makes every theme's line look equally important;
  share preserves that Fed Policy at 50% and Inflation at 4% are different
  magnitudes on the same axis.
- **Raw mention counts.** Rejected — collection volume swings with fetcher
  health (the narrative tracker documents 13-to-80 swings), so raw counts
  correlate with the news cycle's plumbing, not with attention. Same
  reasoning as the tracker's share basis.
- **One combined board for themes and narratives.** Rejected — the two
  series make different claims from differently-biased corpora (ADR-0141),
  and one chart with one axis would imply they share a denominator. Two
  boards, each naming its own.
