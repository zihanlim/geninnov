# ADR-0166: An arrow between two counts is a claim of nesting

**Status:** Accepted
**Date:** 2026-07-29
**Related:** [ADR-0066](0066-not-computable-must-persist-as-null.md), [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0134](0134-why-each-theme-exists-recorded-on-the-theme.md), [ADR-0146](0146-a-detector-and-a-comparison-are-different-charts.md), [ADR-0165](0165-a-layout-gate-belongs-to-the-thing-it-gates.md)

## Context

`AttentionFunnel` is the strip between the two attention boards on `/`. It read
as one line of text:

> 193 phrases tracked → 170 watched by nothing → — emerging (velocity not
> measurable yet) → 9 anchor themes · 1 promoted from a signal
>
> *observation narrowing into commitment*

The owner asked for it to be "more graphical". The obvious execution — one
proportional funnel, each stage's bar width ∝ its count — would have been a
mistake, and working out why turned up a defect in what the strip was already
saying.

**A funnel's visual grammar is subset-of.** Four counts joined by `→`, each
smaller than the last, states that the survivors of stage N are stage N+1. The
first two stages genuinely are nested: `unwatched ⊆ tracked`, both computed from
the same `narrative_signals` rows in `attentionFunnel()`. The last one is not.

Migration 051 (ADR-0134) records `promotion_basis` per theme precisely so this
question can be asked. Queried live:

| `promotion_basis` | n | themes |
|---|---|---|
| `practitioner_prior` | **8** | China Growth, Corporate Credit, Energy Prices, Fed Policy, Geopolitical Risk, Inflation, US Dollar, US Election |
| `operator_directed` | **1** | AI Capex |
| `measured_discovery` | **0** | — |

Eight of the nine anchor themes are migration 001's opening list. They predate
the narrative tracker entirely and were never phrases in its corpus. The arrow
chain asserted that 9 themes survived from 193 phrases; the true number that
came through that path is **at most one**.

And `1 promoted from a signal` overstated even that one. Migration 051 is
explicit about the ordering: the tracker measured AI in **2 of 455 documents**,
*then* the operator named the theme, *then* the LDA confirmation ran. That is
why AI Capex is `operator_directed` and not `measured_discovery` — the column's
whole reason for existing is to keep those apart. "Promoted from a signal" reads
as evidence-led promotion. The signal prompted the question; it did not justify
the answer.

So the strip was already making a claim it could not support, in the direction
that flatters the pipeline, and rendering it as a proportional funnel would have
stated that claim **more** forcefully — a 9-wide bar under a 193-wide bar is a
much louder assertion of "these survived" than a `→` is.

A related question was asked at the same time: *given the funnel, should the
Narrative card come before all the Theme cards?* Same finding, same answer — no.
See Consequences.

## Decision

**Proportion is used only where the nesting is real. Everywhere else the strip
draws counts, and it states the break out loud.**

1. **Two halves, not one chain.** `Observed · narrative_signals` on the left,
   `Committed · themes` on the right, each labelled with the table it reads.
2. **Proportional bars inside the observed half only** — `tracked` and
   `unwatched` share one scale, because they are computed from the same rows and
   one is a filter of the other.
3. **The committed half is a count, on no shared scale.** Nine pips, one filled
   (`--accent`) for the theme a measurement touched at all, eight hollow. A pip
   row cannot be read as a fraction of 193, which is the point.
4. **A rule between them, never an arrow.** An arrow is the notation that caused
   this; replacing it with a divider is most of the fix.
5. **The break is stated in prose**, not left to be inferred from the layout:
   the anchor themes are not a surviving subset, 8 predate the tracker, the one
   link is AI Capex, and there the measurement followed the decision.
6. **The basis counts are rendered, not summarised.** `8 practitioner_prior · 1
   operator_directed · 0 measured_discovery`, naming the column values. The
   zero is the informative one — no theme on this board was found by the
   pipeline before a human named it — and it is now visible rather than implied
   by an absence.
7. **`practitioner_prior` is not framed as a deficiency.** Migration 051 already
   says a prior is a legitimate way to start a universe and that NULL evidence
   there is correct rather than missing; the copy carries that, so the strip
   reports a distinction instead of an indictment.
8. **ADR-0066 is unchanged and still binding.** With no measurable velocity the
   emerging stage renders `—` plus its cause and is drawn as a **dashed track
   with no width** — never a zero-length bar, which is what a bar chart's
   default rendering of a null looks like and is exactly the conflation ADR-0066
   forbids.
9. **Every number remains text** (ADR-0126). The bars and pips are
   `aria-hidden` reinforcement; no figure exists only as a shape.

## Consequences

- The strip is taller — ~40px to ~218px. It is now a graphic rather than a
  caption, which is what was asked for, and the added height buys the basis
  breakdown and the non-nesting statement that the one-liner had no room for.
- **The page order does not change, and this ADR is the reason.** The question
  was whether `NarrativeTrends` should precede all the Theme cards, since the
  funnel appears to run narrative → theme. It should not: the funnel does not
  describe how these nine themes came to exist. Reordering `/` to match a
  chronology that produced **one** of nine themes would encode a derivation that
  did not happen — the same false claim in layout form. The existing order is
  independently right for a second reason: the narrative board is shadow and
  sizes nothing (ADR-0128), so leading a daily publication with it, ahead of the
  themes that do size positions, would rank by pipeline chronology over reader
  value. Within the section that holds the funnel the order already is
  narrative → funnel → theme, which is locally honest.
- `AttentionFunnel` now reads `themes.promotion_basis` by value rather than
  testing membership of `['operator_directed','measured_discovery']` and
  reporting the total as "promoted". Those two values mean different things and
  the component now says which is which.
- A tenth theme promoted on measured evidence would show as a second filled pip
  and move the `measured_discovery` count off zero without any copy change.
- Uses the `figures` breakpoint from ADR-0165 for its own two-column split, so
  the strip and the two boards it sits between all reflow at one width.
- **Not adopted:** a single proportional funnel across all four stages — the
  subject of this ADR.
- **Not adopted:** drawing the 1 promoted theme as a sub-segment of the 9 bar.
  At 1/193 of a shared track it is ~3px, so it would encode the most important
  fact on the strip as its least visible mark.
- **Not adopted:** dropping the theme half and leaving only the detector's
  counts. That removes the claim by removing the comparison, and the comparison
  is worth making — *"nothing here has yet produced a theme"* is a real finding
  about a shadow signal, and it is only legible if both sides are shown.
