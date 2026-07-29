# ADR-0162: A mark you can see but cannot name is a mark you report as absent

**Status:** Accepted
**Date:** 2026-07-29
**Related:** [ADR-0066](0066-absent-is-not-zero.md), [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0146](0146-a-detector-and-a-comparison-are-different-charts.md), [ADR-0159](0159-the-plane-read-one-day-and-it-was-the-wrong-one.md)

## Context

ADR-0146 gave the narrative board a share × velocity detection plane with two
encodings: **filled** marks are the payload (nothing watches this phrase),
**hollow** marks are context (an anchor theme already does). It then added a
third distinction that was never argued for — *"Only uncovered marks get direct
labels"* — so the muted channel was also the anonymous one.

On the 2026-07-28 board that produced a specific failure. `ai` was the loudest
phrase of the day (15.6% of headlines, velocity +2.27), the **maximum of both
axes**, and therefore the mark that set the x-scale. It was `covered_by: "AI
Capex"` — correctly, since migration 050 made AI Capex the ninth anchor theme —
so it rendered as a 3px hollow ring with a grey stroke, sitting 15px below the
top of the plane and hard against the right gutter, with no text anywhere near
it. A reader looked at the board and asked **why `ai` was not on the scatter
plot.** It was on the scatter plot. It was in the alarm corner. It just could
not be told apart from a gridline artefact.

The same board had a second, quieter version of the defect. `chip` — 7.3% of
headlines, also AI Capex, first seen that day and so with no velocity — was a
tick in the "velocity not yet measurable" rug. The rug prints its **count**
("· 39") and never its **members**, and the figures table below shows the top 5
by share, where `chip` ranked 7th. The result: a phrase in the top decile of the
day's attention appeared in **no text anywhere on the board**, in any region, at
any zoom. The `<title>` tooltip was the only copy of its name, which is exactly
what ADR-0126 forbids for a *number* and had never been extended to an
*identity*.

Both are the same defect in two regions. A reader cannot distinguish "this mark
is context" from "this mark is noise" without a name, and cannot look up
something a chart refuses to name at all.

## Decision

**Every region of this chart names its loudest marks. Hollow/filled and
plane/rug are encodings; neither is also allowed to mean "anonymous".**

1. **Covered marks get direct labels too**, in `--text-tertiary` against the
   payload's `--text-secondary`. The covered/uncovered split still lands twice —
   in the fill and in the ink — so naming a context mark does not promote it to
   payload. Two caps, not one: `LABEL_CAP_UNCOVERED = 6` against
   `LABEL_CAP_COVERED = 4`, because the payload is what the board is *for* and
   should be named more deeply than the context.

2. **Both sets run through ONE collision pass.** Ranking and placing them
   separately would let a covered label overprint an uncovered one, costing the
   payload precisely the legibility the split exists to protect.

3. **Displaced labels get leader lines** — the rule `TrendPlot` already applies
   to its end labels, brought to the plane because it now carries up to ten
   labels instead of six. Measured on the live board, the anti-collision stack
   pushes `us` and `oil prices` 50–60px below the dots they name. An
   unconnected label that far from its mark is not a weaker label; it is a label
   pointing at the wrong mark. The leader carries the same payload/context ink
   as the mark it leaves, so following one never loses which encoding you are in.

4. **The rug names its loudest four in text beneath the strip**, with shares
   (`chip 7.3% · emerging 6.4% · keep 5.5% · boom 4.6%`). Rug marks are ticks on
   a single axis with no room for per-mark labels, so the line is the only place
   the names can go. The header keeps the count; the count says how many phrases
   the board is withholding a velocity for, and the line says which.

## Consequences

- **`ai` is now named on the plane and `chip` beneath the rug**, which is the
  whole of the reported defect. The 2026-07-28 board is captured at
  `docs/captures/2026-07-29/narrative-detection-plane.png`.
- **ADR-0146's third distinction is withdrawn; its first two stand.** Filled vs
  hollow and plane vs rug are unchanged and still carry the entire semantic
  load. Only "and the context is unlabelled" is reversed.
- **`chip` in the rug is correct behaviour, not a bug that this ADR papers
  over.** It has one row in `narrative_signals` (`first_seen: 2026-07-28`,
  `days_observed: 1`); `MIN_DAYS_FOR_VELOCITY = 4` means there is genuinely
  nothing to compare today's share against, and ADR-0066 forbids drawing it at
  y = 0. The defect was never that it sat in the rug. It was that the rug did
  not say so out loud.
- **The AI narrative is legibly split across both regions**, which is a true
  statement about a phrase-level detector and now a readable one: `ai` measured
  and breaking out in the plane, `chip` too new to measure in the strip below.
- **A denser plane will need a smaller cap, not a bigger one.** Ten labels fit
  152px of plot at 11px spacing with room to spare; twenty would not, and the
  right response then is to lower `LABEL_CAP_*`, never to drop the leaders.

## Alternatives considered

- **Leave the labels alone and rely on the tooltip.** Rejected — this is
  ADR-0126's rule ("a tooltip is never the only copy of a number") applied to
  identity instead of magnitude, and the reader who filed this had a mouse.
- **Enlarge the covered marks so they read as marks.** Rejected — size is not a
  free channel here; growing the hollow ring toward the filled dot's weight
  attacks the payload/context contrast that is the plane's main signal.
- **Widen the figures table until `chip` appears in it.** Rejected as the *only*
  fix — it would have named `chip` while leaving `ai` an anonymous ring, so it
  addresses the symptom in one region and not the defect in either. (The table's
  5-row cap is inherited from the retired line chart's palette-slot limit and no
  longer has a reason, since ADR-0146 moved identity to the row. That is worth
  revisiting on its own terms, not as a labelling fix.)
- **Label every measurable mark.** Rejected — 37 labels in a 152px plane is not
  a chart. The caps are what make the labels readable.
