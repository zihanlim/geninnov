---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0179 — A quarter column cannot hold an 820px table

## Context

The owner asked for `/mandate` to open as **one row**: "The mandate" card across
the left half, the "Risk-limit board" in the third quarter, "Cap utilisation" in
the last quarter.

The layout argument is sound and is the same one that put `MandatePanel` above
the board in the first place (ADR-0172): the board and the cap bars are both
*readings of* the mandate — "is the published book inside it?" — and until now a
reader had to hold the 20%/30%/35% caps in their head across ~1100px of scroll to
check one against the other. Side by side, the constraint and the reading of it
are on screen together.

What the row costs is **width**, and the two narrow cards were each built against
a width they no longer have:

- `RiskLimitBoard` rendered a six-column table — Limit / Value / Limit /
  Utilisation / Headroom / Status — with an explicit `min-w-[820px]` inside an
  `overflow-x-auto`.
- `CapUtilisation`'s bar row switched to a three-column form at `sm`
  (`minmax(96px,1fr) minmax(120px,3fr) auto` ≈ 350px minimum), on the assumption
  that anything above a phone gave it the full canvas.

The arithmetic of the requested row, measured rather than guessed: `main` is
`max-w-[1400px]` with the `lg` gutter, so content is 1336px; less 3×24px of gap,
divided by four, is **316px per column** — about 280px inside a card. An 820px
table in a 280px window is a 3× horizontal scroller, which `RiskBody`'s own
pairing notes already call goal 7's failure rather than a fix for it, and the
three-column cap row overflows 280px by ~70px into a `.card` that clips rather
than scrolls — the exact defect its own comment records having fixed once for
phones, arriving again from the other end.

So the layout could not be delivered by moving cards alone. One of the two had to
give: the row, or the table.

## Decision

**Take the row. The limit board stops being a table.**

### The row

`RiskBody` renders `mandate` + `limits` as one `xl:grid-cols-4` row:
`MandatePanel` at `xl:col-span-2`, `RiskLimitBoard` and `CapUtilisation` at one
column each. Below `xl` nothing changes — one column, full width, as before.

`RiskMetricsGrid` moves out of the row and stays full width beneath it: its five
headline tiles are a `md:grid-cols-5` line, and four 316px columns would wrap
them one per line, which is the opposite of what the grid is for.

Both cells stay gated on `shows()` and both ids belong to the `mandate` phase, so
the row is whole or absent — it is not a place a section can leak into another
phase (ADR-0170's property, preserved).

### The board

`RiskLimitBoard`'s table becomes a stacked list, one `<li>` per limit:

- label + status badge on the first line;
- **Value / Limit / Headroom as a three-up `<dl>`**, each figure under the word
  that names it;
- the utilisation bar and its percentage;
- the note (which carries the figure's source — `From portfolio_risk.var_95`)
  and the `limit · scoring_config` / `limit · house default` chip.

**Nothing was dropped.** Every column of the old table is still on screen. The
`<dl>` exists because a `<thead>` does not: a bare `62.4% 100.0% +37.6%` with no
heading above it is three naked numbers (goal 1), so each figure carries its own
label instead of inheriting one from a column.

It is **one rendering at every width**, not a table below `xl` and a list above
it. Two markups would put every figure on this card in the DOM twice — Ctrl+F
finds both, and a page whose numbers are duplicated for layout reasons is a page
whose numbers can disagree. The list also removes the 820px scroller on phones,
where the table was already scrolling.

### The cap bars

`CapUtilisation`'s bar row drops **back** to its two-column form at `xl` — the
same stacked form it already uses below `sm`, for the same reason at the other
end of the range. The gate is the layout's own breakpoint, not a guess: the card
is full width below `xl` and a quarter of it above, so each form is used exactly
where its width exists.

## Consequences

**Verified live** at 1440 against the 2026-07-30 run: the three cards measure
660 / 318 / 318 px on one row, `scrollWidth === clientWidth` on all three and on
the document (no overflow anywhere, expanded caps included), no console errors.
Stacked fallback checked at 1280, 1024 and 390. `tsc --noEmit` clean;
`risk-sections`, `chip-contrast`, `mandate-drift`, `risk-board-*`, `cap-breach`,
`section-nav` green. Captures in `docs/captures/2026-07-30/mandate-row-1440.png`,
`mandate-limit-board-column.png`, `mandate-caps-column.png`.

Costs, stated rather than discovered later:

- **The section nav degrades.** `#mandate` and `#limits` now start at the same
  `y`, and `SectionNav` picks the first *in document order* among those visible,
  so "Limits" will rarely win the active state. Both anchors still resolve and
  both tabs still jump; it is the highlight that stops being informative. Not
  fixed here — the fix is either fewer tabs on this phase or a nav that
  understands columns, and neither is this change.
- **The row is lopsided.** The board is the tallest card (2250px against the
  mandate's 1604 and a collapsed cap card's 58), so the last column is mostly
  empty and the row ends with a long thin column of limits. That is inherent to
  the requested allocation, not a defect in it.
- **Density is lost below `xl`**, where the board is full width and the list is
  airier than the table was. Mitigated with a `max-w-[520px]` on the `<dl>` so
  the three figures stay a cluster instead of spreading 320px apart, but a
  stacked row at 1200px is still less scannable than six aligned columns were.
- **The table is gone, so its scan is gone.** Reading utilisation *down* a column
  across eleven limits was what the table did best. The list preserves alignment
  within a row and the breached-first sort, which is most of it, but not all.

Rejected:

- **Keep the table and let it scroll.** A 3× horizontal scroller in a 280px card
  is the trade `RiskBody`'s pairing notes exist to refuse.
- **Table below `xl`, list above it, via `hidden`/`xl:block`.** Duplicates every
  figure on the card in the DOM.
- **Drop the note column to make the table narrower.** Measured: without the note
  the six columns still need ~718px. No arrangement of six columns fits 280px —
  the note was not what made it wide.
- **Give the board two columns and the caps none.** It fits the table, and it is
  not the layout that was asked for.
