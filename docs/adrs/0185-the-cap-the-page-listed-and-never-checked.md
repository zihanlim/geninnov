---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0185 — The cap the page listed and never checked

## Context

The owner noticed white space at the bottom of `Cap utilisation` — the card is
1588px tall (the mandate row's shared baseline, ADR-0181) against ~1131px of
content — and asked whether there was more *relevant* information to put there.

The honest first step was an audit rather than a fill. `optimizer_result` carries
eight fields the caps card does not render. Seven of them are already rendered
somewhere:

| Field | Rendered where |
|---|---|
| `binding_constraints` | `/book` → `SizingProvenance` |
| `crowding` | `/book` → `SizingProvenance` (`describeCrowding`) |
| `zeroed`, `warnings`, `unpriced_assets`, `ic`, `turnover*` | `/book` → `SizingProvenance` |
| **`complex_sizing`** | **nowhere** |

Pulling the first six across to fill a gap would be exactly the duplication
ADR-0182 removed a few hours earlier, with less excuse: there the duplication was
accidental, here it would be deliberate and motivated by empty pixels.

`complex_sizing` is different, and the gap it represents is worse than
whitespace. `MandatePanel`, 660px to the left in the same row, lists
**Correlation complex — 20% — `max_complex_weight`** under *"Enforced — the sizer
cannot breach these"*. The limit board has no row for it. The caps card had no
group for it. So the page published an enforced constraint and checked it
nowhere, while `optimizer_result.complex_sizing` — where the pipeline records
exactly what that machinery did — reached no reader at all.

A second gap is derivable rather than persisted. Sector rows are built from
`book_metrics.SECTOR_MAP` and geography rows from `GEO_MAP`; a held ticker in
neither map lands in **no group**, so its weight is never counted toward any
sector or geography cap and that cap silently cannot bind on it. The bars are
equally reassuring whether they describe 100% of the book or 60% of it.

## Decision

**Add the two things nothing else says. Leave the rest of the whitespace.**

1. **A `Correlation complex` block**, rendering `complex_sizing`: how many
   complexes formed and their members, any groups deliberately skipped and why,
   and `risk_cap_multiple_of_single_name` — because ADR-0118's risk budget can
   bind while the capital bars above still show headroom, so slack in the bars is
   not slack in the constraint. When the column is absent entirely it says so,
   which is a different claim from "no complex formed".

2. **A coverage sentence** in the card's closing note, from a new tested
   `capCoverage()` in `lib/risk/capBreach.ts`: what each grouping's rows add up to
   against `book_metrics.gross_exposure`. `complete` is asserted only when every
   group reaches gross; a shortfall reports the share it did reach. One
   unmeasurable weight makes that group `null`, never `0` — a sum that quietly
   skips a row is a wrong number, not a partial one.

The whitespace is **not** the justification for either. Both would be worth
adding to a card with no space to spare, which is the test they had to pass.

## Consequences

Live at 1440 on the 2026-07-30 run: the card's content goes 1131 → **1313px** in
its 1588px cell, so ~275px of slack remains and that is fine. The complex block
reads *"No complex formed on this run: no held names were grouped above the 0.70
correlation threshold, so this cap constrained nothing. It is listed because the
mandate enforces it, not because it bound"*, plus *"A complex's RISK budget is ×1
one name's"*. Coverage reads *"Single name / sector / geography account for 100% /
100% / 100% of the book's 78.74% gross — every held dollar sits inside a mapped
group, so each cap can see the whole book"* — verified against the payload
directly: all three groupings sum to 0.7874 against a 0.7874 gross.

5 new tests on `capCoverage` (all-groups-complete, a grouping that sees less than
the others, float dust, an unmeasurable weight, absent gross); 980 frontend tests
green, `tsc --noEmit` clean, no console errors.

Costs:

- **The complex block will read "nothing formed" most days.** `complexes: []` is
  the common case; a block that usually says nothing trains a reader to skip it,
  and the day it does say something is the day that matters. Accepted because the
  alternative — showing it only when non-empty — is a cap that appears and
  disappears, which is worse: absence would then be indistinguishable from the
  feature not existing.
- **The 0.70 threshold is prose, not data.** It comes from ADR-0116 and is
  written into the component's copy; nothing reads it from the backend, so a
  change to the grouping threshold would leave this sentence wrong. The payload
  does not carry it. This is the same class of drift `mandate-drift.test.ts`
  closes for the limit values, and it is open here.
- **`capCoverage` is a browser-side check, not a pipeline artefact.** It detects
  the *effect* of a ticker missing from `SECTOR_MAP` — a grouping that no longer
  reaches gross — but names neither the ticker nor the map. A reader learns
  something is unmapped, not what.
- **`ComplexSizing` now lives in `lib/book/sizingProvenance.ts`** beside the rest
  of `OptimizerResult`, and a `/mandate` component imports from a `book/` module.
  Correct direction (the type belongs with the payload it describes) but it does
  cross a folder boundary that had been one-way.

Rejected:

- **Move `binding_constraints` or the crowding summary here.** Both are on
  `/book`. Same-payload, different-page duplication is still duplication, and
  ADR-0182's argument does not weaken because the destination has room.
- **Show `cash` (21.3% undeployed).** Already the `/mandate` answer card's
  headline, four cards up the same page.
- **Stretch the bars or pad the rows to fill the height.** Density that serves
  nothing (goal 7).
- **Leave the card as it was.** The complex cap would still be a published
  constraint with no measurement anywhere — which the whitespace question
  happened to surface, but which was true before it.
