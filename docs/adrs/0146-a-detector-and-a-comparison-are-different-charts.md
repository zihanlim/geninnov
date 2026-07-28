# ADR-0146: A detector and a comparison are different charts

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0066](0066-absent-is-not-zero.md), [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md), [ADR-0143](0143-the-price-link-gate-and-what-it-refuses-to-say.md), [ADR-0145](0145-theme-trends-share-among-anchors.md)

## Context

After ADR-0145 the attention section held two boards rendered identically —
multi-line share-of-voice charts off one shared `TrendPlot`. The operator
asked whether themes and narratives are different things; they are (a theme
is a commitment with instruments and a book seat, a narrative is an
observation with neither), and the identical rendering quietly contradicted
that. Worse, the narrative board's form was answering the wrong question:
its top-5-loudest lines charted the trajectories of `earnings`, `price` and
`q2` — the register of financial writing (ADR-0142) — when the board exists
to answer *"is anything accelerating that nothing watches?"* That is a
state question, and lines are a trajectory form.

## Decision

**The theme board keeps its lines; the narrative board becomes a detection
plane; a funnel strip between them makes the lifecycle explicit.**

1. **Themes stay a comparison.** Fixed membership, named entities, "did
   attention rotate from Dollar to Geopolitics?" — the shared-axis line
   chart is exactly the right form and does not change (ADR-0145 stands).
   `TrendPlot` remains exported from `NarrativeTrends.tsx` and remains the
   one geometry implementation; the theme board is now its only renderer.

2. **Narratives become a share × velocity scatter** (`DetectionScatter`):
   - **x = loudness** (share of the day's headlines), **y = breakout**
     (velocity, the robust z against the phrase's own history). The alarm
     region is top-right, findable without reading.
   - **Covered phrases are hollow context; uncovered are the filled
     payload.** State — not identity — is the encoding, so the categorical
     palette is not spent here: one accent for the payload, muted ink for
     context, shape (hollow/filled) as the second channel. Only uncovered
     marks get direct labels.
   - **`emerging` marks get a ring, read from the backend's own status** —
     the frontend copies no threshold constant, so `VELOCITY_MATERIAL`
     cannot drift into a second home (the ADR-0064 discipline).
   - **A phrase with unmeasurable velocity is NEVER plotted at y = 0.** It
     sits in a labelled rug below the plane, positioned by the one thing
     that IS measured (its share), with the count printed
     ("not yet measurable · N", overflow counted, not hidden). Today the
     whole board is a rug and an empty plane with a sentence saying why —
     the chart itself shows the instrument's state (ADR-0066 drawn, not
     just written). Marks rise from strip to plane as history accrues.
   - Per-phrase trajectories move to own-scale sparklines in the figures
     table, where identity is the row and no colour slot is spent.

3. **An `AttentionFunnel` strip sits between the boards** — the lifecycle
   as counts: phrases tracked → watched by nothing → emerging → anchor
   themes (· promoted from a signal). While no velocity is measurable the
   emerging stage reads "—" with the reason, never "0": in that state zero
   means "cannot say". The counts come from one exported function
   (`attentionFunnel`) so the strip and its tests read the same arithmetic.

## Consequences

- **The two boards now look as different as they are.** Lines = watchlist
  comparison; plane + rug = blind-spot detector; the funnel names the
  promotion path that connects them (AI Capex being the one traversal so
  far).
- **The detector shows every phrase, not five.** The retired top-5 line
  view drew 5 of 324; the plane and rug place all of them (rug capped at 80
  marks for DOM sanity, overflow counted). The table still details the five
  loudest.
- **Today the plane is empty, and that is the honest render.** All 324
  phrases sit in the rug until velocities become measurable (~4 observed
  days post-rebuild). A reader watching the board over the next week sees
  the instrument come online — which is more informative than any
  placeholder.
- **ADR-0126's contract still holds** — value axes on both dimensions,
  tick values printed, direct labels, the table as relief — applied to a
  scatter instead of lines.

## Alternatives considered

- **Different colours / bar-vs-line on the same lines.** Rejected —
  cosmetic difference pretending to be semantic; the palette has five
  validated slots and no room for a second identity scheme anyway.
- **A velocity threshold guide-line in the plane.** Rejected — drawing it
  requires copying `VELOCITY_MATERIAL` into the frontend, a second home for
  a constant (ADR-0064). The backend's `status` already encodes the
  judgement; the ring renders it.
- **Plotting unmeasurable phrases at velocity 0.** Rejected outright —
  ADR-0066: a phrase that cannot be measured is not a phrase measured at
  zero, and a plane full of dots on the zero line would claim 324
  measurements that never happened.
- **A Sankey/flow diagram for the lifecycle.** Rejected — five numbers in
  a row say the same thing at a fraction of the ink; the funnel is a
  sentence, not a figure.
