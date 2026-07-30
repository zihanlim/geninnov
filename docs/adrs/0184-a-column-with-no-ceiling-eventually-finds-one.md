---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0184 — A column with no ceiling eventually finds one

## Context

The narrative board's figures table (`SeriesTable`, in the 340px column
beside the detection plane) was horizontally scrolling — the operator asked
how to stop it. Measured live: the table's content was 347px wide against a
319px container (340px column minus the 21px its border-left + padding-left
consume), a 28px overflow.

The table uses the browser's default `table-layout: auto`: each column's
width is the min-content width of its widest cell, and the table's total
width is the sum of those — `w-full` sets a *target*, not a ceiling, so a
sufficiently wide cell simply grows the table past its container and
`overflow-x-auto` kicks in. Measured per-column on the live 2026-07-30 data,
the Velocity column alone was 78px — nearly the width of the Status column
(67.9px, holding values as long as `"established"`) — driven entirely by
one string: `"not measurable"`, rendered whenever `latest.velocity` is
`null`. Every other value in that column (`"+4.00"`, `"+1.63"`, ...) needs
roughly a third of that width. Removing just that one cell's contribution
would have closed the 28px gap with room to spare.

The component's own header comment already documented this table's min-
content width as a deliberate, load-bearing measurement (`"~308px"`,
including `"not measurable"` explicitly as one of the values setting it) —
written when the table apparently fit its then-340px column. Whether that
document was accurate when written or the container shrank since is not
resolvable from the code alone; what is certain is that it is 28px wrong
today, measured directly rather than inferred from the comment.

## Decision

**Shorten the one cell driving the overflow to match a vocabulary this file
already uses for the identical state, and keep the fuller explanation on
`title` rather than dropping it.**

- `SeriesTable`'s Velocity cell reads `"n/a"` for a `null` velocity, not
  `"not measurable"`. The `Emerging` block two sections down on the same
  card already renders `"n/a"` for this exact state
  (`s.latest.velocity === null ? "n/a" : ...`) — this is not new
  vocabulary, it is this table catching up to a precedent already set
  elsewhere in the same file.
- The cell keeps a `title="Velocity not yet measurable — needs more
  observed days"` attribute, so the fuller reason is not deleted, only
  moved off the always-visible copy — consistent with ADR-0126's rule that
  a tooltip must never be the *only* copy of something, which this satisfies
  by construction: the tooltip is additive detail on an already-meaningful
  `"n/a"`, not the sole bearer of the state.
- The header comment's now-stale claim (`"not measurable"` as one of three
  values establishing the table's min-content width) is corrected in place,
  and states plainly what this fix does and does not guarantee — see
  Consequences.

**Rejected for now: switching the table to `table-layout: fixed` with
explicit per-column width proportions**, which would make the table
structurally incapable of exceeding its container regardless of any future
cell's content (overflow becomes wrapping or truncation inside a fixed
column, never a wider table). This is the durable fix; it was not taken
today because it requires deciding a proportion for all six columns at once
(a materially bigger, riskier change touching every column's visual
behavior) versus a one-line content fix that resolves the measured, actual
overflow. If this table overflows again from a different cell, `table-
layout: fixed` is the fix to reach for rather than another one-off string
shortening.

## Consequences

Positive:
- Verified live: `scrollDiv.scrollWidth === scrollDiv.clientWidth` (319 =
  319) — the horizontal scrollbar is gone, and the `Found by` column, which
  was being clipped, now renders in full.
- 1 existing test updated (not net-new) to assert `"n/a"` renders, the old
  `"not measurable"` string does not, and the `title` attribute carries the
  fuller reason — a straight swap, not new coverage. 975 frontend tests
  green (unchanged count), `tsc --noEmit` clean.
- The abbreviation is not a new judgment call this file is making alone — it
  matches an existing sibling string in the same component, so a reader
  encountering `"n/a"` in the table has already seen the same word mean the
  same thing in the Emerging list above it.

Negative / friction:
- **This closes today's overflow, not the table's ceiling.** `table-layout:
  auto` still has no upper bound: a narrative corroborated by both the
  frequency tracker and the monthly discovery job renders `Found by` as
  `"frequency + lda + embedding"` (ADR-0133) — at ~27 characters, meaningfully
  wider than any value in that column today (`"frequency"`, 9 characters) —
  and could reopen the scrollbar on a day that happens. This fix has ~40px
  of margin against today's specific overflow, not a proof against every
  future one.
- **"n/a" is measurably less specific than "not measurable"** — a reader
  who does not hover loses the "why" a sighted, non-hovering pass through
  the table would have had. The `title` attribute recovers it, but only on
  interaction; a screen reader or a print of the page keeps only "n/a" with
  no cheap way to reach the fuller text. Accepted because the identical
  tradeoff already exists in the Emerging list this table now matches, so
  this is not a new class of loss, but it is a real one.
- Left unresolved: whether the ORIGINAL `"~308px"` min-content estimate in
  the header comment was ever accurate, or the container narrowed since it
  was written. Not investigated further because it does not change what to
  do today — the live measurement is authoritative regardless of which.

## Alternatives considered

**`table-layout: fixed` with explicit column-width percentages**, discussed
above as the durable fix. Deferred, not rejected outright — the right move
if this table overflows again, at which point the *pattern* (any long cell
can reopen this) will have repeated and justifies the larger change; a
single occurrence does not yet.

**Reduce the `pr-2` column gutters further (toward `pr-1`).** Rejected — the
component's own existing comment already reasoned through this tradeoff and
concluded the 4px of slack between `pr-2` and `pr-3` was real headroom, not
spare width to cut further, and nothing about today's fix changes that
argument; shortening the one oversized cell was sufficient without touching
gutters at all.

**A bare `"—"` (em dash) with the explanation only on `title`.** Rejected —
weaker than `"n/a"` for a sighted non-hovering reader (an em dash alone does
not distinguish "not yet measurable" from any other kind of missing value
elsewhere on this page), and `"n/a"` was already the established word for
this specific state two sections down; introducing a second symbol for the
same state would be the kind of drift ADR-0064 argues against.
