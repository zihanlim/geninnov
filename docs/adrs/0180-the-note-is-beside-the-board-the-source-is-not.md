---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0180 — The note is beside the board; the source is not

## Context

Two follow-ups to ADR-0179, same day, both from the owner looking at the row it
produced:

1. **Cap utilisation opened collapsed.** It is a `<details>` with no `open`
   attribute, which was right while it was the fourth card down a scrolling
   page. As one of four cards in a single row it spent a whole quarter column on
   a 58px summary bar beside a 1604px mandate panel.
2. **The risk-limit board was too long.** ADR-0179's stacked list measured
   **2250px** — taller than the mandate panel it sits beside, and the tallest
   thing on the page.

Where the height actually went, measured in the browser rather than estimated
(11 rows, ~178px each):

| Part of a row | Height |
|---|---|
| prose `note` | 33px (2 lines), 66px for the long ones |
| Value / Limit / Headroom as a three-up `<dl>` (label above figure) | 30px |
| label + status badge | 21–23px |
| utilisation bar | 15px |
| `limit · scoring_config` line | 15px |
| padding and margins | **~55px** |

Two findings in that table. The margins were the single largest line item —
`py-3` plus three `mt-2`s plus an `mt-1`, 605px across the card for no
information at all. And the prose was the largest item that carried anything:
33–66px per row of "what this limit governs" — which is exactly the content
`MandatePanel` renders in its own "What it means" column, 24px to the left, for
every one of the eleven limits on this board.

The prose was not wrong. It was in the wrong card, and only because until
ADR-0179 the two cards were 1100px apart.

## Decision

**Cap utilisation opens `open`. The board keeps every figure, loses the prose,
and gains an explicit source field.**

### Cap utilisation

`<details open>`. The disclosure itself stays — a reader who wants the limit
board beside it without nineteen bars can still close it — but the default is
visible, which is design goal 7's own 2026-07-30 narrowing ("every card stays
visible on arrival") reaching an existing `<details>` rather than a new one
being added.

### The board

- **`LimitDef` gains `source: string`** — the `table.column` the observed value
  is read from (`optimizer_result.realised_turnover`,
  `portfolio_risk.var_95 / total_capital`, …), split out of the prose it used to
  be buried at the end of. It renders under every row beside where the *limit*
  came from: two different facts, so both are shown and neither stands in for
  the other.
- **The prose `note` moves to the row's `title`** and the card's intro links to
  `#mandate` for it. The field is unchanged and still the authoritative
  sentence; it is simply not the board's job to render it while the panel that
  explains limits is beside it.
- **`value / limit` and the headroom go on one line**, replacing the three-up
  `<dl>`. The pair reads as a pair because the card's intro says so — the same
  idiom, and the same justification, as the `15.92% / 20.00% (80%)` bars in
  CapUtilisation directly beside it. That is what makes it not three naked
  numbers (goal 1); the alternative was 30px of column headings per row for
  three figures.
- **Spacing tightened**: `py-3` → `py-2.5`, `mt-2` → `mt-1.5`, and the separate
  `limit · …` line merged into the source line.

## Consequences

Measured at 1440 on the 2026-07-30 run, before → after:

| | before | after |
|---|---|---|
| limit board | 2250px | **1531px** |
| cap utilisation | 58px (collapsed) | **1131px** (open) |
| mandate panel | 1604px | 1604px |
| page | 3026px | **2381px** |

The row now reads as three cards with content in all three, the board is shorter
than the panel beside it, and the page lost 645px despite one card going from
collapsed to open. No overflow on any card or the document, no console errors.

Costs:

- **The board no longer explains itself in isolation.** A reader who lands on
  `#limits` from a deep link, or copies the card into a screenshot, gets figures
  and sources but not meanings; the meaning is one card away and named, not
  gone. Five of eleven source lines wrap to two lines at 280px.
- **`title` is a weak home for the prose.** It is hover-only — no keyboard, no
  touch, not found by Ctrl+F. It is a convenience for a mouse, not the
  traceability path; the traceability path is the source line, which renders.
- **`LimitDef` now has two fields that must not drift.** `note` still contains
  the source in its own words ("From portfolio_risk.var_95 / total_capital") and
  `source` states it structurally. Nothing enforces that they agree, because
  nothing renders both at once — a latent inconsistency accepted, not closed.
- **Row density is now near its floor.** Four lines and ~105px per limit; the
  next reduction has to remove a figure, not whitespace.

Rejected:

- **Keep the prose and shorten it.** The board's note and the mandate panel's
  note would still be two sentences about one limit, 24px apart, and the shorter
  one would be the worse one.
- **Per-row `<details>` for the note.** Eleven disclosures on a card that is
  itself one of four in a row, against a standing direction that this page stops
  hiding things.
- **Drop the prose from `MandatePanel` instead and keep it here.** Backwards:
  that panel's entire job is what the mandate means; the board's is whether the
  book is inside it.
- **Drop the `limit · house default` line to save 15px.** It is the difference
  between a limit somebody chose and a limit nobody did — the fact ADR-0179's
  own answer card ("5/11 sourced") is counting.
