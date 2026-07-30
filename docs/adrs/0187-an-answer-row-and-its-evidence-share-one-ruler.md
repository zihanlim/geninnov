---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0187 — An answer row and its evidence share one ruler

## Context

The owner reported that the first row of four answer cards does not line up with
the cards below it.

Measured at 1440, the two grids' column edges:

| | left / right, per column |
|---|---|
| `AnswerRow` | 76–403 · 415–742 · 754–1081 · 1093–1420 |
| The mandate row | 76–736 · 760–1078 · 1102–1420 |

Only the page gutters agreed. Every internal boundary was 6–9px out, because the
two grids were built to different geometry despite sitting one above the other in
the same container:

- **gap** — `gap-3` (12px) against the evidence row's `gap-6` (24px), which alone
  makes four equal columns land in different places.
- **breakpoint** — `wide:grid-cols-4` (1424) against `xl:grid-cols-4` (1280). So
  between 1280 and 1423 the page drew **four evidence columns under two answer
  columns**, which is not a misalignment so much as a different layout.

`AnswerRow` is shared by `/mandate`, `/risk` and `/attribution`, so this was
never specific to the mandate row — it is just that until ADR-0179 nothing below
an answer row had columns to disagree with.

## Decision

**`AnswerRow` adopts the evidence grid's geometry: `xl:grid-cols-4 gap-6`.**

Both halves are taken from the row below rather than chosen here. An answer row
sits directly above the cards that justify it; a reader tracing "5/11 sourced"
down to the limit board is following a column, and two rulers on one page break
that. The four-up count is unchanged and still justified in the component's own
comment — this changes where the columns fall, not how many there are.

`wide` (1424) was not a measured gate for this component the way it is in
`tailwind.config.ts` for the two-pane book row; the comment beside it justifies
**four cards**, not the breakpoint. `xl` is where the grid it must match turns
four-up.

## Consequences

Alignment is now exact at every width where both grids are four-up — verified at
1280, 1440 and 1500: answer column 2 ends where the mandate card ends, column 3
spans the risk-limit board exactly, column 4 spans cap utilisation exactly. Below
`xl` both stack the same way. `/risk` and `/attribution` keep identical answer
geometry. No overflow, no console errors, 982 frontend tests green, `tsc` clean.

**It also surfaced a live clipping bug, which is the more useful half.** The
answer card's source line is a bare `table.column` identifier with no spaces to
break on, and `.card` clips rather than scrolls:
`research_recommendations.book_metrics.gross_exposure` measured **312px inside a
288px body**, so its tail was cut with nothing on screen to say so — a source a
reader cannot finish reading is not a source (goal 1). It predates this change;
narrower columns only made it wider of the mark. Fixed with
`[overflow-wrap:anywhere]`, the same remedy `Ident` in `SectionGap.tsx` already
carries for the same reason, with the same measurement in its comment.

Costs:

- **Answer cards are 9px narrower at 1440 and 316px narrower at 1280**, where
  they were previously two-up at 602px. Four cards at 286px is tight; verified no
  element overflows at that width, but the headline numbers (`Turnover
  (day-over-day)`) now wrap to two lines there.
- **The wrapped source line breaks mid-token** — `...gross_expo / sure`. Ugly,
  and the established alternative in this tree, so consistency won over
  appearance. A `word-break` that respects `_` and `.` boundaries would be
  better and does not exist in CSS without hyphenation hints.
- **The alignment is not enforced.** Two components now have to keep the same two
  Tailwind classes in step, with a comment in each and no test. A drift test
  would have to parse both class strings, which is brittle in a different way.
- **`/attribution` still has two different rulers**, and correctly so: its answer
  row is four-up and the risk-metric strip below it is five-up. Four answers and
  five statistics are not the same thing, so nothing there is being traced down a
  column.

Rejected:

- **Narrow the evidence row to `gap-3`.** `gap-6` is the card-grid gap everywhere
  else in this tree; changing it would misalign the mandate row with every other
  paired grid to fix one row.
- **Move the evidence row's four-up gate to `wide`.** It would leave `/mandate`
  fully stacked from 1280 to 1423 — a common laptop width — to fix an alignment
  that only exists above it.
- **Leave it and accept 6–9px.** It is exactly the kind of near-miss that reads
  as sloppiness rather than as a choice, on a page whose entire argument is that
  its numbers are careful.
