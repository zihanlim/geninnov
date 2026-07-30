---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0189 — One page header, and a strip that stopped repeating the answers

## Context

The owner asked why the Sizing page's top row — a rule separating the header text
from a band of stats — looks different from `/mandate`, `/`, `/risk`, and which
of the two should be standard.

There were **five hand-rolled headers in two treatments**:

| | Pages | Meta block | Lede |
|---|---|---|---|
| Rule + stack | `/book` | `sm:border-l`, then `RUN DATE` as a 10px uppercase micro-label **above** its value | 14.5px on `text-primary`, plus a 12px tertiary second line |
| Inline | `/mandate`, `/risk`, `/attribution`, `/` | `RUN DATE 2026-07-30` — label and value on one line at one size, no rule | 13px on `text-secondary`, one line |

Nobody decided this. `/` and `RiskBody` are near-identical markup written twice;
they did not differ from `/book` by choice, they differed because there were five
copies of one thing.

The strip is a separate question and had a written defence in the code: *"the
AnswerCards line says what the figure MEANS for the book, this strip says what
the figure IS."* But four of its six cells — **Gross, Net, Deployed, Worst
scenario** — were the same figures the answer row states 200px below.

## Decision

### One header, on `/book`'s treatment

A shared `components/PageHeader.tsx`: title, lede, optional fine print, and a
meta block of label/value pairs with the rule. All five pages use it.

The inline form was the majority — four to one — and it is the one that went. It
is the only place on this site where a label and its figure share a line at the
same size, which reads as a sentence fragment; every other labelled figure in the
tree (answer cards, this strip, the mandate panel's boxes) is a micro-label above
a `num` value. The rule does work too: it separates *when the data is from* from
the prose that reads it.

`PageHeader` **renders no figure of its own and takes no data.** Every value is
passed in already formatted by the page that read it, so it can never become a
second place a run date is derived. `/`'s freshness label and status badge pass
through as nodes rather than being special-cased.

### The strip reports the book's shape, not its answers

Owner's direction was to find other stats rather than delete the strip, which is
the better call — the six cells are the right instrument, they were pointed at
the wrong figures. Gross / Net / Deployed / Worst scenario are replaced by
**Themes · Sectors · Geographies · Largest position**; Positions and
Longs/Shorts stay.

That makes the strip the book's *shape* — how many bets, which way, across how
many ideas, spread over how many sectors and geographies, and how big the largest
single one is — which the answer row describes nowhere. Every cell derives from
`picks` and `book_metrics`, both already on state; no query moved.

"Same number, different framing" turned out to be a thinner distinction than it
read: a reader just told **78.7% gross** *with* its consequence does not need
78.7% gross *without* one 200px later.

## Consequences

Live at 1440: all five headers render one component, `/book`'s strip reads
`Positions 9 · Longs/Shorts 4/5 · Themes 5 · Sectors 7 · Geographies 3 · Largest
position 15.9% (JD)`, and no cell restates an answer card. 982 frontend tests
green, `tsc --noEmit` clean, no console errors, no overflow on any page.

`/`'s lede grew with the component (owner's direction, same message): eleven words
became a paragraph naming what a theme score is made of and what it does not
claim — *"a high score means a theme is loud, not that it is right — nothing on
this page is a position"* — plus a fine line stating that the narrative board
sizes nothing. Both facts existed only further down, inside the answer cards,
which is *after* the board they qualify.

Costs:

- **Four pages changed appearance without being asked to.** `/mandate`, `/risk`,
  `/attribution` and `/` gained a rule, a larger lede and stacked meta labels.
  That is what standardising on the minority treatment means, and it is a real
  visual change to pages the owner did not raise.
- **`/`'s h1 grew from 19px to 22px.** It was the one page with a smaller title;
  the component has one size. Its header block is now 148px tall against the
  ~70px it was.
- **`Largest position` restates a bar on `/mandate`'s caps card.** It is stated
  nowhere on `/book`, where the positions table below makes it derivable but
  never says it — so this is a cross-page repeat of one figure, accepted where
  four same-page repeats were not.
- **`Themes`, `Sectors` and `Geographies` are counts of groups, not of risk.**
  Seven sectors across nine names sounds diversified and is not necessarily:
  `book_metrics.SECTOR_MAP` decides what a sector is, and the HHI on `/mandate`
  is the figure that actually measures concentration.
- **The header no longer carries the page's own hand.** A page wanting something
  structurally different in that slot now has to widen `PageHeader` or opt out,
  and opting out is how five copies happened the first time.

Rejected:

- **Standardise on the inline form** (cheapest — one page changes). It reads as
  prose where every other figure on the site reads as a labelled figure.
- **Extract a component but keep the inline look.** Kills the drift risk without
  fixing the thing that made `/book` look better, which is what prompted the
  question.
- **Delete the strip.** The owner asked for other stats instead, and the
  instrument was never the problem.
- **Keep only the two non-duplicating cells.** A two-cell strip is a caption, and
  the four replacements are worth having on their own.
