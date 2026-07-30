# ADR-0191: Phrases belong to the board, themes belong to the funnel

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0146](0146-a-detector-and-a-comparison-are-different-charts.md), [ADR-0162](0162-a-mark-you-can-see-but-cannot-name.md), [ADR-0175](0175-a-detector-can-carry-trend-context-without-becoming-one.md), [ADR-0184](0184-a-column-with-no-ceiling-eventually-finds-one.md)

## Context

`/#narratives` and `/#funnel` are one grid row: `NarrativeTrends` (the detection
plane, a six-column phrase table, an emerging shortlist) beside
`AttentionFunnel` (the observed → committed counts, the attribution split).

Applying ADR-0162 to the funnel card produced a defect the ADR itself would have
caught. That card's headline figure is **"6 watched by nothing"** — the one
number on it that identifies a *gap* — and it named no phrase. The fix was to
list the six with their share and velocity, on the argument that four of them
(`us`, `asian`, `fed leaves`, `kevin warsh`) appeared in no text anywhere on the
page, and that `asian` running at the +4.00 velocity cap with nothing watching
it is precisely the alarm the board exists to raise.

The list was correct, and it made the row unreadable. The owner's question was
"what is the difference of both these tables?" — which is the whole finding.
Beside `SeriesTable` there were now two lists of phrases on one screen:

| | `SeriesTable` (board) | the funnel's list |
|---|---|---|
| rows | the 5 loudest, of 11 | all 6 with no anchor |
| columns | phrase, share, velocity, status, anchor, found by | phrase, share, velocity |
| overlap | `closes sharply lower`, `global` | the same two |

Three columns that are a strict **subset** of six, two rows identical in both,
and no stated relationship. Every number agreed — both render the same
`useNarrativeSeries` rows, which is what that hook exists for — so nothing was
*wrong*. A reader still cannot answer why `global` appears twice and `us` once,
and the only honest answer is "one list is capped at five and the other is
filtered by anchor", which is a fact about the code.

Design goal 7's 2026-07-30 narrowing is the rule that settles it: *the remedy
for a page with too much on it is first to check whether its content belongs
there.* Asked that way, the answer is not "shrink the second list" or "mark the
overlap". It is that phrase-level rows already have a home.

Why the board's table was capped at five is the accident underneath all of this.
`top = topSeries(series, SERIES_COLORS.length)` is five because the **trend
plot** has five palette slots. `SeriesTable series={top}` inherited that number
by sharing the variable. The table has no palette, and no width dependence on
its row count — every column is `min-content` over its values (ADR-0184) — so
the cap bought the table nothing and cost it the rows the board exists to
surface.

The committed half of the funnel card had the same ADR-0162 defect, unfixed and
worse: nine pips, no names. The observed half at least reaches a table one
column left; `themes` is rendered as a list **nowhere else on this page**.

## Decision

**One table of phrases, one list of themes. The board owns phrase rows; the
funnel counts, attributes and names themes.**

1. `SeriesTable` renders `top` **∪ every phrase with `covered_by === null`**,
   share-descending — nine rows today, all six columns. The cap follows the
   palette only where a palette exists, which is the trend plot. Quiet is not a
   reason to drop the payload.
2. The funnel's phrase list is removed. Its bar's two segments remain the key,
   and each segment's members live where that side is decomposed: unwatched
   phrases in the board's table, attributed ones in the per-anchor bars below.
3. The funnel's committed half names its nine themes with their
   `promotion_basis`, sorted strongest-claim-first (`measured_discovery` →
   `operator_directed` → `practitioner_prior`, alphabetical within a basis) so
   the list's order is the pips' order. The counts are **derived from those
   rows**, so the pips and the list cannot disagree about how many there are.

The division is the durable part. A card that counts a set may name that set —
but where the members are already tabulated, it points rather than repeats, and
the two cards do not both own the same noun.

## Consequences

- Every unwatched phrase is named exactly once on the page, with six columns
  rather than three: `status` and `found by` travel with it, which the funnel's
  list could not carry at 437px.
- The nine anchor themes are readable for the first time. A universe a reader
  cannot enumerate is a universe they cannot check, and `promotion_basis` is
  the field ADR-0128's whole argument turns on.
- The table's row count is now driven by data, not by a constant. On the
  `archive` corpus that is 5 + 4; on a denser corpus the unwatched set is larger
  and this table grows with it. The `figures`-gate width is unaffected (columns
  are `min-content`), but the right column's HEIGHT is not bounded any more, and
  a corpus with dozens of unwatched phrases would need a cap argued on its own
  terms rather than inherited from a palette again.
- `AttentionFunnel` now selects `name` from `themes`. Same query, one more
  column; no new read.
- The funnel card's white space, which prompted this sequence, is filled by its
  own subject rather than by the board's.
- One cross-reference had to move with the content: the emerging shortlist
  pointed at the funnel for velocities that are now in the table above it. That
  is the standing cost of prose that names a neighbour.

## Alternatives considered

- **Keep both lists and mark the overlap.** Adds a third encoding to explain a
  duplication instead of removing it, and leaves two tables of the same shape on
  one screen.
- **Show, in the funnel, only the unwatched phrases the board's table does not.**
  Zero duplication and cheap — but the membership rule becomes "unwatched, minus
  whatever the other card happened to show", a rule about the UI rather than the
  data, and the card's count (6) and its list (4) would disagree. A card that
  cannot name its own count is where this started.
- **Differentiate by column instead** — give the funnel's list `days_observed` /
  `first_seen`, which the board's table lacks. The two would stop overlapping
  numerically, and the alarm (velocity) would disappear from the place that
  raises it.
- **Show all tracked phrases in the table**, dropping the top-5 notion. Simplest
  possible rule, but it discards the loudness ranking the plot's palette and the
  card's caption both use, and on a dense corpus it is unbounded with no
  argument at all.
