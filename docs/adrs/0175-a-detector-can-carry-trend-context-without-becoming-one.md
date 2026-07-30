---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0175 — A detector can carry trend context without becoming one

## Context

ADR-0146 retired a top-5-loudest share-over-time line chart as the narrative
board's *primary* view. The reason was specific, not aesthetic: the board's
actual question — *"is anything accelerating that nothing watches?"* — is a
state question, and a top-5-by-share line chart answered a different one. On
the live corpus at the time, the top-5-by-share set was dominated by
financial-writing register (`earnings`, `price`, `q2`) rather than anything a
reader would call a narrative, so the trajectory chart implied meaning the
underlying phrases did not carry. `DetectionScatter` (share × velocity, with
the covered/uncovered and plane/rug encodings) replaced it as the sole view.

The operator asked for the line chart back — *"another plot of share against
date," placed above or below the velocity plot* — on the Alpha phase (`/`,
`components/NarrativeTrends.tsx`). This is not the same request ADR-0146
answered. That ADR judged the line chart as the board's *only* rendering of
attention; this asks for it as *additional* context alongside a
`DetectionScatter` that stays the primary, unchanged detector. The distinction
matters because the finding that motivated ADR-0146 — the top-5-by-share set
can be dominated by meaningless register words — does not stop being true
just because a second chart is added; it has to be carried into the new
chart's own copy rather than silently reintroduced.

`tests/unit/narrative-trends.test.tsx` had a pinned regression test asserting
`NarrativeTrends.tsx` does **not** contain `<TrendPlot series={top}}`, written
specifically to prevent this exact shape from reappearing without a decision
behind it. That test existing and firing on this change is the intended
outcome, not a defect to route around — it is what "documented, not
silent" looks like in this codebase.

## Decision

**Add `TrendPlot series={top}` back to `NarrativeTrends.tsx` as a labelled
"Share over time" section, positioned above `DetectionScatter`, carrying the
same honesty disclosure ADR-0146's Context section stated in prose.**

- **Same top-N set already on screen.** `top = topSeries(series,
  SERIES_COLORS.length)` — the identical five-loudest-by-share series
  `SeriesTable` already lists in the sidebar. No new phrase is exposed; this
  is a second view of data already rendered, not a new information surface.
- **The caption states the risk inline, rather than leaving it implicit.**
  *"Top 5 by today's share, not by whether they mean anything — the loudest
  phrase in a news corpus is routinely financial-writing register
  ('earnings', 'price', 'q2'), which is why the detection plane below judges
  by breakout, not by volume alone."* A reader gets the ADR-0146 finding in
  the one place it is load-bearing, instead of needing to have read the ADR.
- **Positioned above `DetectionScatter`, not replacing or competing with
  it.** The section reads as historical run-up, then the scatter as the
  current-state judgement — trend first, state second, matching how a reader
  actually reasons about a chart before an alarm.
- **Gated on `runs >= 2`.** `TrendPlot` itself renders nothing from a single
  point; the section's own heading is gated the same way so it never sits
  over an empty chart, mirroring `ThemeTrends`' `runs < 2` guard.
- **The pinned test is rewritten, not deleted.** It now asserts the scatter
  is still the primary/default detector (unchanged), plus two new
  assertions: the trend section renders with its honesty caption when two or
  more runs exist, and renders nothing from one run. The original test's
  job — catching an *undocumented* reappearance of this shape — is preserved;
  what changed is that this reappearance is now documented, here.

## Consequences

Positive:
- A reader asking "how has today's top few moved" gets an answer without
  leaving the card, instead of needing `/method` or a second day's run.
- The ADR-0146 finding travels with the chart it is about, in the one
  sentence a reader sees while looking at the thing that could mislead them —
  stronger than a comment only a repo-reader will find.
- 2 new tests, 1 rewritten; 940 frontend tests green, `tsc --noEmit` clean.
  Verified live: the section renders between the legend and the scatter,
  labelled lines with leader-line collision handling intact, on the actual
  2026-07-30 run.

Negative / friction:
- **The board is taller.** The section adds a chart's height to a card that
  ADR-0172 had already measured and moved content off of once this session.
  Not re-measured against that budget here, since this is a different phase
  (Alpha, not Mandate/Risk/Attribution) with no stated screen-height target.
- **Two charts, one dataset, on one card** is exactly the shape ADR-0064
  warns can drift — a fix to `topSeries`'s ranking or `TrendPlot`'s geometry
  now has two render sites on this one page (plus `ThemeTrends` elsewhere)
  instead of one. Mitigated, not eliminated: `TrendPlot` remains the single
  geometry implementation: both call sites import the same function, so a
  geometry fix still lands once.
- **A reader who skips the caption can still misread the line chart as
  ranking importance.** The caption is inline text, not a modal a reader must
  dismiss — consistent with this codebase's stated preference for visible
  disclosure over gated interaction, but it is not a guarantee the caption is
  read.

## Alternatives considered

**Refuse the request and point to ADR-0146.** Rejected — the operator's ask
is for additional context alongside the still-primary detector, which is a
materially different decision than the one ADR-0146 made, and the codebase's
own standing instruction is that the owner's direction overrides a prior
recommendation when they've weighed the tradeoff (as with ADR-0170
overriding ADR-0169's navigation conclusion). Silently complying without
naming the tension would have been worse than either refusing or complying
with the history stated.

**Filter the top-N set to exclude generic register words before charting
it.** Rejected for this change: that is a real, separate problem (a
stop-word or register-detection pass over `narrative_tracker.py`'s phrase
extraction), not a rendering decision, and conflating the two would make
this change larger and riskier than the operator asked for. The caption
names the risk explicitly instead of silently laundering it through a
filter with its own judgement calls.

**Delete the pinned test rather than rewrite it.** Rejected — the test's
value was never "this exact string must never appear," it was "this shape
must not reappear undocumented." Deleting it would remove the thing that
made this reappearance need an ADR in the first place.
