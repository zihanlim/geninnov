---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0183 — A disclosure that buys no space

## Context

The owner asked for `Cap utilisation` to stop being collapsible.

It had been a `<details>` since it was written, which was correct while it was
the fourth card down a long scrolling page: closing it moved everything below it
up by ~1000px. Three changes on 2026-07-30 removed that property one step at a
time:

- **ADR-0179** put it in a quarter column of a single row.
- **ADR-0180** forced it `open` by default, because a card whose whole content
  sits behind a summary bar was spending a quarter of that row on 58px.
- **ADR-0181/0182** made it the sole occupant of that column, in a row whose
  height is set by the two cards beside it.

By the end of that sequence, collapsing it returned nothing. The row is 1588px
tall whether this card is 58px or 1131px, because `The mandate` and the
`Risk-limit board` are what set the height. So the disclosure had become a
control that hides content and frees no space — and it needed a whole apparatus
to avoid looking broken while doing it: `open:h-full` so a collapsed card
wouldn't stretch into a 1600px empty box, `open:flex`/`open:flex-col`, and an
`[&::details-content]` rule that existed only because Chrome wraps a
`<details>`'s non-summary content in a UA box a flex column cannot reach
through.

Design goal 7 says to collapse optional detail rather than delete it, and its
2026-07-30 narrowing explicitly said *"existing `<details>` are untouched"*. This
removes one, so per that file's own rule it needs an ADR to argue the goal down
first.

## Decision

**`CapUtilisation` becomes a plain `<section className="card">` with a normal
card header.** The `<summary>` becomes a `<div className="card-header">`, the
`DisclosureChevron` and its import go, and the count line (`19 limits monitored ·
0 breaches`) stays exactly where it was — the header is now identical in form to
the two cards beside it.

The narrowing to goal 7 is stated as a test rather than as an exception for this
component: **a disclosure that buys no space is not a disclosure.** Ask what
closing it gives back. Where the answer is "a screenful", the goal is unchanged
and every other `<details>` in the tree stays. Where the answer is "nothing,
because something else sets the height", it is a toggle for its own sake.

## Consequences

Verified at 1440 on the 2026-07-30 run: the three cards run **474 → 2062px**,
`SECTION` all three, and **zero `<details>` elements remain on `/mandate`**. The
card's closing note pins to 2047 — 15px above the card's bottom edge, the
card-body's own padding — with no browser-specific rule involved, because a
`<section>` flexes its own children. No overflow, no console errors, 975 frontend
tests green, `tsc --noEmit` clean.

What this deletes is the interesting part: `open:h-full`, `open:flex`,
`open:flex-col`, and all three `[&::details-content]` variants. Every one of them
existed to make a collapsible card behave inside a stretched grid cell. Removing
the collapse removed the reason for the whole class of workaround — including the
Chrome quirk ADR-0181 recorded, which no longer applies anywhere in this tree.

Costs:

- **19 cap bars are now unconditionally on screen.** That is ~1100px a reader
  cannot fold away. It costs nothing in page height today (the row is as tall as
  the mandate panel regardless) but it will if this card ever becomes the tallest
  in the row — at which point the answer is to shorten it, not to hide it.
- **The rule is now conditional, and conditional rules are harder to apply.**
  "Does closing it free space?" needs a judgement about layout that "collapse
  optional detail" did not. Written into `docs/design-goals.md` as a question to
  ask rather than a list of exempt components, so it can be applied to a card
  that does not exist yet.
- **A reader who wanted the board beside a quiet column loses that.** It was
  argued for in ADR-0180 and did work; it just cost more than it returned once
  the card owned its column.

Rejected:

- **Keep the `<details>` and drop only the `open` attribute's gating.** That is
  the state ADR-0180 shipped, and it is what produced the stretched-empty-box
  problem the `open:` variants exist to paper over.
- **Keep it collapsible and let a collapsed card sit short at the top of a
  stretched cell.** Honest, and it breaks the one-baseline alignment the owner
  asked for two messages earlier.
- **Make every card on the row collapsible for symmetry.** Three toggles that
  each free nothing.
