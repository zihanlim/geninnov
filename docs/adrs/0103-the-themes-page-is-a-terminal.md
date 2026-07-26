# ADR-0103 — The Themes page is a terminal: viewport-locked panes, not a scroll

**Date:** 2026-07-27
**Status:** Accepted
**Reverses:** [design goal 7](../design-goals.md) (the inner-scroller ban) and the *"Bloomberg terminal look"* non-goal from [0009](0009-frontend-stack.md)
**Does NOT reverse:** [0054](0054-a-daily-publication-not-a-scanner.md), [0084](0084-method-splits-by-reader-question-not-by-copy.md)
**Relates to:** [0086](0086-a-labelled-rail-that-collapses-rather-than-a-glyph-rail.md)

## Context

`/` was **4,186px — 4.7 screens at 1440×900**, measured on the live deployment. The
user's objection, raised more than once, is that it is too scroll-heavy. Measurement
says the objection is not about taste:

| Block | Height | What it is |
|---|---|---|
| Header, market strip, headline ticker | ~250px | orientation |
| Macro regime card | 239px | regime |
| Theme × sub-score heatmap | 450px | **the scores** |
| "Top 3 themes by attention" | 385px | **the scores again**, as cards |
| "Watchlist · theme momentum" | 362px | **the scores again**, as bars |
| "Headlines behind today's scores" | 1,036px | evidence |
| "What the crowd is pricing" | 576px | evidence |
| "What the engine is discovering" | 501px | evidence |

Two independent problems. **One dataset is rendered three times** (~1,200px), which
[ADR-0084](0084-method-splits-by-reader-question-not-by-copy.md)'s stop rule already
forbids in another context: *split by section, never by copy of the same data.* And
**2,113px of evidence is always-on**, on the only page in the app with no progressive
disclosure at all — `/book` has five collapsible sections, `/risk` has one, `/` has none.

Both are fixable inside the existing publication layout, and that was the recommended
option. **The user chose the terminal instead, with the trade-offs stated in advance.**
This ADR records what that costs, because the costs are real and were not discovered
afterwards.

The two references offered were `margin-stress-engine` (local) and World Monitor. Run
through `design-goals.md`'s own mockup triage, both fail step 4: margin-stress-engine is
`h-screen flex flex-col` + `overflow-hidden` with per-tab `overflow-y-auto`, on
`className="dark"` / `bg-[#0a0e17]`; World Monitor is a live global map with layer
toggles and a `timeRange` parameter. What survives triage step 5 is the **partitioning
idea** — panes that each own their scroll so the page itself does not grow — which is
severable from both the shell's palette and its live-tick cadence.

## Decision

**`/` becomes a viewport-locked terminal at `lg` and above.** A fixed-height shell, a
regime strip across the top, and a grid of panes that each scroll internally.

Four constraints keep this from becoming the thing the reversed goals were protecting
against:

1. **Desktop only.** The lock applies at `≥1024px`. Below it the page reverts to
   ordinary full-page scroll, because "mobile must work" remains a live requirement and
   a terminal at 375px is not a terminal, it is a stack of tiny scrollers.
2. **The redundancy dies first.** The two duplicate renderings of the theme scores are
   deleted, not relocated into panes. A terminal that shows the same numbers three times
   is a denser version of the same defect, and would spend its scarce viewport on it.
3. **Every pane is addressable.** Each carries a stable `id`, and the page honours a
   `#pane` hash by scrolling that pane into view inside its own scroller. Deep links are
   one of the two things goal 7 named; this is the mitigation, not a denial of the cost.
4. **The palette does not change here.** The Ledger identity (goal 4) stays. A dark `/`
   beside a warm `/book`, `/risk` and `/method` is less coherent than either uniform
   choice, the tokens live in two files that must change together, and the palette is
   not what cost 4.7 screens. Going dark is a separate decision with its own ADR.

**What is explicitly NOT decided here.** ADR-0054 is untouched and still governs: no
query composition, no filter panel, no saved screens, no polling, no `setInterval`, no
streaming quotes. The terminal is a *layout*, and this app still delivers a finished
book once a day rather than candidates on demand. If a filter box appears on `/`
because "terminals have them", that is ADR-0054 being violated, not this ADR being
applied.

## Consequences

**Accepted costs**, stated plainly:

- **Ctrl+F degrades.** Browser find cannot reach text scrolled out of an inner pane.
  This is the real cost and it has no full mitigation inside a locked shell. It is
  bounded by the fact that the long-form surfaces — `/book`, `/risk`, `/method` — keep
  full-page scroll and hold the same underlying data.
- **Long tables lose their natural home on this page.** Panes suit ranked rows; they do
  not suit a 30-row candidate table. Nothing of that shape lives on `/` today, and if
  something does later, it belongs on a scrolling page rather than in a pane.
- **Two layout modes to maintain and verify.** Every `/` change now needs checking at
  both `≥1024px` (locked) and below (scrolling). The verification pass covers both.
- **design-goals.md must be amended in the same change**, or it will keep stating a bar
  this decision no longer clears. Goal 7's absolute phrasing becomes conditional and the
  non-goal list drops "the Bloomberg terminal look".

**What improves:** the page answers its question — *which themes are trending, how hot,
and which way the book leans* — without scrolling at all, and the evidence is one pane
away rather than 3,000px away.

**The reversal is narrow.** Goal 7's other half — *"collapse optional detail, don't
delete it and don't make it always-on"* — survives and is in fact what the pane grid
implements. Goal 4, goal 8's contrast floor, goal 1's no-naked-numbers, goal 2's stated
absence and goal 5's affordance rule are all untouched and still bind every pane.
