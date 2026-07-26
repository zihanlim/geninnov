# ADR-0106 — The Themes page is a grid that scrolls

**Date:** 2026-07-26
**Status:** Accepted
**Reverses:** [0103](0103-the-themes-page-is-a-terminal.md) — the viewport lock and the per-pane scrollers. Restores [design goal 7](../design-goals.md) to its original absolute phrasing for `/`.
**Relates to:** [0104](0104-a-live-news-panel-that-cannot-be-cited-and-says-so.md), [0084](0084-method-splits-by-reader-question-not-by-copy.md)

## Context

[ADR-0103](0103-the-themes-page-is-a-terminal.md) made `/` a viewport-locked
terminal: `lg:h-[calc(100dvh-56px-var(--feed-h))]` with `lg:overflow-hidden` on
the shell, a `grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]` pane
grid, and `lg:overflow-y-auto overscroll-contain` on every pane. It argued goal
7 down explicitly and amended `design-goals.md` in the same change, which is the
correct process — this reversal is not a complaint about how that decision was
made.

It is a report of what the decision produced.

**Fractional grid rows divide a fixed height between panes, so every pane must
clip whatever does not fit.** Measured on the live page at 1920×1009:

| Symptom | Detail |
|---|---|
| Truncated heading | The regime pane rendered **"FACTOR TILT OF BOO"** |
| Destroyed figures | Its five factor betas printed as **"+0" / "-0"** — the real values are −0.50, +0.22, +0.32, +0.43, −0.38 |
| Two scrollbars in one card | The same pane carried a vertical **and** a horizontal scroller |
| Six scroll contexts | One screen, six panes, each with `overscroll-contain` so no scroll chained to the page |

The factor row is the clearest case. A book tilt of `-0.50 MKT-RF` rendered as
`-0` is not a compressed number, it is a **different number** — and goal 1 says
a figure a reader cannot trace is worse than none. The layout was destroying the
values it existed to present.

The demotion of the macro regime made this worse. ADR-0103 moved it from a
full-width banner into a grid cell on the reasoning that it is "context, not
chrome" and should "compete for a cell like everything else". But it is the
orientation every other number is read against — the regime is what decides
what a LONG on this page even means — and in a one-third cell it had neither
the width for its three columns nor the height for its narrative.

## Decision

**`/` is an ordinary scrolling page with a content-sized grid.**

1. **The shell does not lock.** `lg:h-[calc(...)]`, `lg:overflow-hidden` and the
   `lg:flex lg:flex-col` column are gone. The page scrolls, once.

2. **Grid rows are `auto`, not `minmax(0,Nfr)`**, with `items-start`. Each row is
   as tall as its tallest pane and a short pane does not stretch to match a
   neighbour. Nothing has to guess a height, so nothing clips.

3. **`TerminalPane` owns no scroller.** `lg:overflow-y-auto`, `min-h-0` and
   `overscroll-contain` are removed from both the bare and carded branches. A
   pane is a card that sizes to its content.

4. **The macro regime returns to a full-width banner at the top**, above the
   grid, where its three columns fit.

5. **Live news becomes a floating dock** toggled from an icon at the top right
   ([ADR-0104](0104-a-live-news-panel-that-cannot-be-cited-and-says-so.md)'s
   panel, relocated). A permanent grid cell asserted that the streams are one of
   the things this site publishes; they are explicitly not a source the book is
   built on. The dock renders nothing while closed, so a closed dock still makes
   no third-party request — the property ADR-0104 bought, kept.

**What ADR-0103 got right and is retained.** Panes keep their `id` and their
`aria-label`, so `#themes`, `#headlines`, `#crowd`, `#regime` and `#discovery`
remain deep-linkable and addressable. The pane vocabulary itself was never the
problem; only the height mechanism was.

## Consequences

**The page is taller than one screen and that is the point.** At 1920×1009 the
document is ~3,200px. A reader scrolls, Ctrl+F reaches every row, and a deep
link lands — the three things goal 7 named and the lock cost.

**`tests/unit/terminal-pane.test.tsx` is inverted, not deleted.** Three
assertions previously pinned the scroller (`lg:overflow-y-auto` present,
`min-h-0` at least twice). They now assert the opposite — no `overflow-y-auto`
in either mode, and no leftover `overscroll-contain` — so the mechanism cannot
return by accident. The tests that guard addressability and the bare-mode
double-header fix are untouched.

**`design-goals.md` must be amended again**, reverting goal 7's conditional
phrasing for `/` back to absolute. ADR-0103 correctly changed it when it took
the exemption; this change gives it back.

**The one place an inner scroller survives is the live-news dock**, and that is
correct rather than an inconsistency: a floating panel is bounded by the
viewport by definition, so `max-h` plus `overflow-y-auto` is the only way it can
hold a long channel list without running off the bottom of the screen. Goal 7 is
about trapping a PAGE, not about a popover.

**Two dev servers sharing one `.next` will corrupt the build** — unrelated to
this decision, but discovered during it, and the reason "missing required error
components" appeared. Noted so the next person does not diagnose it as a code
fault.
