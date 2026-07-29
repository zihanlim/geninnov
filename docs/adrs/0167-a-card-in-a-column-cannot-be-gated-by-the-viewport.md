# ADR-0167: A card in a column cannot be gated by the viewport

**Status:** Accepted
**Date:** 2026-07-29
**Supersedes part of:** [ADR-0165](0165-a-layout-gate-belongs-to-the-thing-it-gates.md)
**Related:** [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0146](0146-a-detector-and-a-comparison-are-different-charts.md), [ADR-0166](0166-an-arrow-between-two-counts-is-a-claim-of-nesting.md)

## Context

`AttentionFunnel` was a full-width band between the two attention boards. On the
owner's direction it moves **beside** `NarrativeTrends` — board at 2fr, funnel at
1fr, one row — with `ThemeTrends` staying full width below.

That is a better placement for what the strip is: since ADR-0166 it reads the
**same corpus, same day and same ADR-0159 fallback** as the board, so it is a
readout *on* that board rather than a stage between two of them. A margin note
belongs in the margin.

It also breaks ADR-0165, one hour after that ADR shipped.

ADR-0165 gave both boards a `figures` (1248px) viewport gate for their internal
plot ‖ figures split, derived from the measured 364px min-content of
`SeriesTable`. That derivation assumed each card was as wide as the section. Put
`NarrativeTrends` in a 2fr column and it no longer is — but a **viewport** gate
cannot see that. At viewport 1265 the gate still fires while the card behind it
has shrunk from 1132px to 780px, so the split would have run inside a card with
no room for it.

The arithmetic, and it is a bound rather than an estimate, because `main` is
capped at `max-w-[1400px]`:

| | widest possible |
|---|---|
| section content | 1400 − 64 (lg gutter) = 1336px |
| `NarrativeTrends` at 2fr | (1336 − 16 gap) × 2/3 ≈ **880px** |
| …inside its `p-4` | 848px |
| …split 2:1 with a 20px gap | figures column **276px** |
| `SeriesTable` min-content | **364px** |

It does not fit at any viewport. Fitting it would need ~1780px of section, which
the 1400px cap forbids. The same holds for the funnel's own two-column layout:
widest at 1fr is ≈440px, 408px inside, against a committed half budgeted 340px.

**Tried anyway, in the browser, because the arithmetic is easy to get wrong and
the owner asked to see it.** Forcing `grid-template-columns: 2fr 1fr` back onto
the live 780px card:

| | measured |
|---|---|
| plot render width | **484px** (viewBox 720 → scale 0.672) |
| smallest axis label | **6.0px** (`fontSize` 9 × 0.672) |
| in-plane mark labels | 6.4px |
| figures column | 242px |
| table min-content | 358px → **horizontal scroller** |

Both halves fail at once, and the capture shows it plainly: the tick labels and
the in-plane phrase labels (`trading`, `trade`, `rises`, `fed`, `global`, `us`)
collapse into an unreadable cluster, while the table truncates mid-word
(`establishe`) and loses the `Anchor` and `Found by` columns behind a scrollbar.
`docs/captures/2026-07-29/narrative-split-at-2of3-rejected.png`.

Note there is no split ratio that rescues it. The plot needs ~640px to hold its
smallest label at 8px; the table needs 358px; 640 + 20 + 358 = **1018px** inside
a card with 746px to give. The binding constraint is the **plot**, not the
table — trimming table columns further would not help.

So this is the case ADR-0165 anticipated and deferred — *"Not adopted: a
container query… If a third card ever needs this, revisit."* Two cards in one
section now need different answers at the same viewport, which is precisely what
a viewport breakpoint cannot express.

## Decision

**Where a card's width is set by its column rather than by the viewport, prove
the bound from the `max-w` cap and drop the gate — do not add a second
mechanism.**

1. **`NarrativeTrends` loses its internal gate entirely.** Its plot and figures
   table always stack. Not a preference: per the table above the split can never
   fit in a 2fr column, so any gate there is either a gate that never opens or —
   as `figures:` had become the moment the card moved — one that opens when it
   must not.
2. **`AttentionFunnel` likewise.** Its two halves always stack, on the same
   bound. Its divider turns from a vertical rule to a horizontal one: it
   separates the same two things in the same way, and only the axis changed. It
   is still **not an arrow** (ADR-0166).
3. **`ThemeTrends` keeps `figures:`.** It is still full width, its four-column
   table is 249px, and the gate's derivation still holds for it. Same section,
   two cards, two answers.
4. **No container query, again — but for a different reason than last time.**
   ADR-0165 declined it on consistency cost. Here it would be genuinely correct
   and is still declined, because the `max-w-[1400px]` cap makes the outcome
   *provable*: the split cannot fit, so there is no width at which a container
   query would decide anything. A mechanism whose every evaluation is known in
   advance is a constant with extra machinery. If the cap is ever raised, this
   reasoning expires and the container query becomes the right answer — which is
   why the arithmetic is written into both components rather than left here.

## Consequences

- **The narrative board's table moves back under its plot.** This is a real cost
  and it partly reverses what ADR-0165 delivered — that ADR's Consequences read
  *"at 1265 both boards render 754.7px plot ‖ 377.3px table"*, which is now true
  only of `ThemeTrends`. Recorded rather than quietly left stale.
- Measured at viewport 1265: board **780px**, funnel **390px**, same row, exact
  2:1; `ThemeTrends` **1186px** with its split intact; no table overflows and no
  page-level horizontal scroll.
- The funnel is much shorter than the board beside it, so the row has visible
  whitespace under it. `items-start` is deliberate — stretching a card to meet
  its neighbour's height is padding, and this section already refuses that.
- `figures` now has **one** consumer. A breakpoint with a single user is worth
  re-examining, but its derivation is unchanged and correct, and `ThemeTrends`
  genuinely needs it; collapsing it back into `wide` would reintroduce exactly
  the bug ADR-0165 fixed.
- **The standing trap:** moving a card into a narrower column silently
  invalidates any viewport gate inside it, with no error and no test failure —
  the layout simply renders wrong at widths nobody checks. Both components now
  carry the bound in a comment at the site of the removed gate, so the next
  person to add a `figures:` there has to argue past it.
- **Not adopted:** keeping the split and letting the table scroll. A horizontal
  scroller is how a column stops being read — the finding ADR-0165 is built on.
- **Not adopted:** dropping the funnel back below the board to preserve the
  board's split. The owner asked for the placement, and the funnel-as-margin-note
  reading is the better one now that it shares the board's corpus and day.
