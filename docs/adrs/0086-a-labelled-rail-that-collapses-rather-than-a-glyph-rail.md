# ADR-0086 — A labelled rail that collapses, rather than a glyph rail

**Date:** 2026-07-26
**Status:** Accepted
**Amends:** [../design-goals.md](../design-goals.md) — the "sidebar icon rail" non-goal
**Relates to:** [0025](0025-book-centric-information-architecture.md), [0054](0054-header-items-that-all-land-on-one-page.md), [0084](0084-method-splits-by-reader-question-not-by-copy.md), [0085](0085-direction-cannot-be-carried-by-hue-alone.md)

## Context

The owner has asked five times for the product to look like the `stitch_remix`
comps, and clarified what that means: *"its not about color. its about cards,
layout, top ribbon, sidebar, layout, borders etc."*

The comps have a **shell**. Andromeda has a **document**. The single largest
structural difference is a persistent left rail.

`docs/design-goals.md` lists as a non-goal: *"A sidebar icon rail. Four pages. A
four-item top bar is the correct answer; unlabelled glyph rails trade clarity
for the appearance of scale."* Read precisely, that objects to **unlabelled
glyph rails**, not to a rail. A labelled rail is not what the sentence rejects.
Only the *width* it takes needs arguing.

### The arithmetic that constrains this

The two-pane layout on `/book` (ADR-0084) requires
`2 × BOOK_ROW_MIN_W + gap = 2 × 640 + 24 = 1304px` of content. A left rail
consumes viewport one-for-one:

| Rail width | Viewport needed for two panes |
|---|---|
| 0 (today) | 1,368px |
| **56px** | **1,424px** — the current `wide` gate |
| 64px | 1,432px |
| 72px (the comps' width) | 1,440px |
| 200px (labelled) | 1,568px |

The owner's machine is a 1440px window, which is **~1,425 CSS px** after
Windows Chrome's classic space-taking scrollbar (the reason `wide` is 1424 and
not 1440 — see `tailwind.config.ts`). So:

**Below ~1,570px viewport, a labelled rail and the two-pane position tables
cannot both exist.** Two panes are 91% of the screen. Reclaiming the left gutter
buys ~9px at a 64px rail, which is inside scrollbar variance. This is not a
matter of taste; it is `BOOK_ROW_MIN_W` against the display.

Lowering `BOOK_ROW_MIN_W` is not available: it is test-pinned with a documented
rationale about seven columns colliding, and shrinking it moves the failure
inside each row instead of removing it.

## Decision

**A labelled rail that is collapsed by default and expandable, with the
preference persisted.**

1. **Collapsed = 56px, and it is LABELLED.** Icon above a 10px label. This is
   the widest rail that preserves the shipped two-pane layout at 1,424px, and
   our destinations are short enough to fit where the comps' were not — theirs
   clipped to `ASHBOAR` and `NTELLIGENCE` because their words were `DASHBOARD`
   and `INTELLIGENCE`; ours are Themes, Book, Risk, Method. **The non-goal is
   not violated in this state at all** — it objects to unlabelled glyph rails.

2. **Expanded = 200px**, full labels beside icons. In this state two-pane
   requires a 1,568px viewport, so on a 1440px laptop `/book` returns to
   ~4,257px from 3,660px. That is the trade, and it is **the reader's to make,
   not ours** — which is the whole reason for the toggle. The expanded state is
   what this ADR argues the non-goal down for.

3. **Default collapsed.** The owner's opening complaint was scroll length. A
   default that silently costs 597px on the page they complained about would be
   answering a request by undoing its own fix.

4. **`wide` stays 1424px.** The gate is computed for the collapsed rail. When
   expanded, the two-pane grid is suppressed by the rail state rather than by a
   second breakpoint — one gate, one derivation, no second constant to drift.

## The non-goal, amended

> **A sidebar icon rail.** Four top-bar destinations. A rail is permitted when
> it is **labelled** and does not cost the layout: collapsed 56px is the default
> and preserves two-pane; expanded 200px is a reader's explicit choice that
> suppresses it. Unlabelled glyph rails remain refused — they trade clarity for
> the appearance of scale, which is what this non-goal was always about. See
> ADR-0086.

## Consequences

**Good**

- The shell the owner asked for, without spending the scroll win by default.
- The trade is exposed to the reader instead of being decided for them.
- Collapsed state needs no amendment — it satisfies the non-goal as written.

**Costs, named**

- **Complexity.** A persisted preference means `localStorage`, and reading it
  during render is a hydration mismatch — the same class of bug the comment at
  `TopBar.tsx:48-52` already documents for clock values. It must be read in an
  effect, with the collapsed state as the server-rendered default.
- **A four-destination app does not need a rail for navigation.** The top bar
  handles it, and this ADR does not pretend otherwise: the rail is adopted for
  the structural frame it provides, not because navigation was failing. If it
  is ever used to justify adding destinations, that is a separate argument and
  ADR-0084's stop rules still bind.
- **Expanded state costs `/book` ~597px** on any viewport under 1,568px.
- **Two nav surfaces can disagree about what is current.** The rail and the top
  bar must derive active state from the same `pathname`, and the rail must use
  `aria-current="page"` only if the top bar stops doing so — two elements
  claiming to be the current page is a lie to a screen reader (the same rule
  `SectionNav` follows with `aria-current="location"`).
- **Layout risk.** `app/layout.tsx` becomes a two-column grid. The existing
  `grid-cols-[minmax(0,1fr)]` track and the `min-w-0` item are both load-bearing
  — the comment at `layout.tsx:28-34` explains that removing either sends the
  640px position table into the body scroll instead of its own overflow wrapper.
  The rail column must be added *beside* that track, not in place of it.
