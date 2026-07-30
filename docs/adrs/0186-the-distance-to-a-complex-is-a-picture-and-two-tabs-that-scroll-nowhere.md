---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0186 — The distance to a complex is a picture, and two tabs that scroll nowhere

## Context

Two things, from one message: make the Correlation complex block graphic, and —
is the `Mandate` / `Limits` tab strip at the top of the page now redundant?

**The complex block was prose in a card of bars.** ADR-0185 added it because the
mandate lists `max_complex_weight` as enforced and nothing measured it, but what
it rendered was a sentence: *"No complex formed on this run."* Sitting under
nineteen `weight / cap (util%)` bars, a paragraph reads as a footnote to them
rather than as the same kind of claim. It also could not answer the question a
reader actually has when told nothing formed — *how close was it?*

**The tab strip was measured redundant, not judged so.** `#mandate` and
`#limits` are the two columns of one row: both begin at y=474 and both end at
y=2062. Two tabs scrolling to the same pixel are two tabs a reader has to click
to discover are the same. Worse, `SectionNav` picks the first visible id in
document order, so with both entering the viewport simultaneously **"Limits"
could never win the active state** — ADR-0179 recorded that as a cost and left
it; it is not a cost, it is a control that cannot be right.

## Decision

### The distance to a complex, drawn

A `CorrelationMeter`: the book's most correlated held pair as a filled bar on a
0–1 correlation scale, the threshold at which names become one idea as a tick,
and the mean absolute correlation as a mark below the track. Every one of those
numbers is read from `book_metrics.correlation_summary` — `max_abs_pair`,
`flag_threshold`, `mean_abs_corr`, `pair_count`.

**`flag_threshold` closes the drift ADR-0185 left open.** That ADR listed "the
0.70 threshold is prose, not data" as an accepted cost, on the belief the payload
did not carry it. It does. The component no longer contains the number.

It is deliberately **not** a `CapBar`: the scale is a correlation, not a weight
against a cap. When a complex *does* form, that one is a `CapBar` — Σ member
weight against `complex_pct`, drawn exactly like the three groups above it,
because that is precisely what a complex is.

The prose that survives says what the picture cannot: on the live run the closest
pair sits **0.011 below the line**, and *"BABA + JD hold 30.00% between them,
which a crossing would measure against 20.00% instead of two separate single-name
caps."* Both figures are derived from rows already on the card.

### The tab strip

`PHASE_SECTION_NAV.mandate` becomes `[]`, and `SectionNav` renders nothing for an
empty list. The exemption is a named list — `PHASES_WITHOUT_SECTION_NAV` — not a
special case inside a component, so a phase that grows back to two screens has to
be taken off it deliberately.

**The section ids stay.** `/risk` still hops `#mandate` and `#limits` to this
phase as fragments, the limit board's own copy links to `#mandate`, and external
deep links resolve against them. The strip went; the anchors did not.

`risk-sections.test.ts` gains two tests rather than losing one: an exempt phase
must have an **empty** nav (half a strip says the sections it omits are
elsewhere), and must still render its sections with their ids gated in
`RiskBody`.

## Consequences

Live at 1440 on the 2026-07-30 run: the meter draws `BABA + JD 0.689 / 0.70` with
the mean mark at 0.222 across 36 pairs, the strip is gone, and the three cards run
**409 → 1997px** — one baseline, and 65px higher up the page than before. Page
2101px, against the 3026px this sequence started from. No overflow, no console
errors. 982 frontend tests green, `tsc --noEmit` clean.

Costs:

- **The meter is one pair, not the distribution.** A book with five pairs at 0.68
  and a book with one look identical here. `mean_abs_corr` is the only hedge, and
  a mean over 36 pairs is a weak one. The full matrix is on `/risk`, and
  reproducing it here is the duplication ADR-0182/0185 refused.
- **The "what a crossing would cost" sentence is a hypothetical.** It computes
  what the pair's combined weight would be measured against, not what the sizer
  would actually do — a real complex is a connected component and could pull in a
  third name, and the resulting book would be re-solved, not clipped. Framed as
  the cap that would apply, which is true; a reader could still take it as a
  prediction of the outcome.
- **The mean mark has no label at its position**, only in the legend below. At
  0.222 it sits near the left of the track where a floating label would collide
  with the axis start.
- **A phase with no jump strip has no in-page navigation at all.** Correct at
  1588px on one screen; wrong the moment something is added below the row, and
  nothing enforces the height — only the list, and the reason written beside it.

Rejected:

- **Draw the correlation matrix or the pair list here.** It is `/risk`'s
  `CorrelationMatrix`, and same-payload-different-page duplication is the thing
  two ADRs today have already refused. A single summary measure against the
  mandate's own threshold is a different claim from the heatmap.
- **Render the complex block only when a complex exists.** A cap that appears and
  disappears makes absence indistinguishable from the feature not existing —
  ADR-0185's argument, unchanged.
- **Keep one tab and drop the other.** `Mandate` alone would be a strip with a
  single destination, which is the same non-control with better odds.
- **Keep both tabs and fix `SectionNav` to tie-break by column.** A nav that
  needs to know about grid columns to say where you are is a nav solving the
  wrong problem; nothing here is out of reach.
