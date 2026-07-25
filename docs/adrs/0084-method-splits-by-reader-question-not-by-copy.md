# ADR-0084 — /method splits by reader question, not by copy

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0025](0025-book-centric-information-architecture.md), [0040](0040-one-book-one-surface.md), [0054](0054-header-items-that-all-land-on-one-page.md), [0081](0081-step-numbered-lineage-panel-on-book.md), [../design-goals.md](../design-goals.md) §1, §7, §8

## Context

The owner reported the UI as "too difficult to use… not so UIUX friendly" and
"the scrolling page is too long". Measured on the live site at 1440×900:

| Route | Scroll | Screens | Full-width stacked blocks | Two-column rows | `<details>` |
|---|---|---|---|---|---|
| `/` Themes | 3,122px | 3.5 | 6 | **6** | 1 |
| `/book` | 4,459px | 5.0 | 24 | 3 | 2 |
| `/risk` | 5,590px | 6.2 | 27 | 2 | 3 |
| `/method` | **13,057px** | **14.5** | 21 | **0** | **0** |

29 screens across four pages. The correlation is almost clean: the page the
owner rated best (`/`) is the one already using two columns; `/method`, with
zero two-column rows and zero collapsibles, is the worst by a factor of four.
The content column is 1,256px inside a 1,320px canvas, so on three of four
routes the right half of the screen is empty for most of the scroll.

The prompt for this work was a set of outside design comps, and the owner's
instinct that they "feel so much more user friendly" was correct — but not for
the reason it appeared. A styling-only triage of those comps (the third pass on
the same archive; adoption counts across the three passes were 5 → 2 → 0)
returned **zero** adoptable styling changes: their surface ramp, hairlines, ink
and chip geometry all lose to what already ships, and both of their token sets
still colour `LONG` the same blue as a hyperlink. What the comps actually do
differently is **structural** — every one of them opens with a summary strip and
then splits into two panes. The felt improvement was layout, not paint.

`/method` is the extreme case, and it is extreme for a specific reason: it
answers two unrelated reader questions in one document.

| Section | px | Screens |
|---|---|---|
| `pipeline` | 908 | 1.0 |
| `hypescore` | 1,886 | 2.1 |
| `tradescore` | 1,268 | 1.4 |
| `edgescore` | 2,508 | 2.8 |
| `factors` | 699 | 0.8 |
| `sources` | 700 | 0.8 |
| `guardrails` | **3,868** | **4.3** |

`guardrails` alone is larger than the entire Themes page.

## Decision

**Split `/method` on the reader's question, and only on the reader's question.**

1. **Two chapters.**
   - `/method` — *"how is a number built?"* — `hypescore`, `tradescore`,
     `edgescore`, `factors`, `signal-validation`.
   - `/method/evidence` — *"did it run, and who checked it?"* — `pipeline`,
     `sources`, `guardrails`.

   The falsifier is stated so the split can be checked rather than admired:
   **"why is HypeScore 62 for theme X?" must be answerable from `/method`
   alone.** It is — the formula, the live weights, the terms table, the worked
   example, `SignalValidation` and the reconciliation all live in that chapter.

2. **One body, one fetch.** Both chapters render
   `components/method/MethodBody.tsx` — one `useEffect`, one set of twelve
   queries — filtered by `chapterOwns(chapter, id)`. This is load-bearing, not
   tidiness: two chapters with their own fetches are two chances to read
   different vintages of the same tables and disagree about what the pipeline
   did. That is the exact class of contradiction [ADR-0040](0040-one-book-one-surface.md)
   closed when `/trades`, `/portfolio` and `/research` were retired.

   **Knowingly accepted cost:** each chapter fires all twelve queries, including
   those whose sections it does not render. Per-chapter query subsets were
   rejected for the reason above. Revisit only behind a shared cache, never by
   splitting the fetch.

3. **The anchor map is data.** `lib/method/anchors.ts` holds
   `METHOD_ANCHORS`, and `<LegacyAnchorHop />` performs the hop client-side.
   **A URL fragment is never sent to the server** — the browser strips it — so
   `next.config` `redirects()`, middleware and a server `redirect()` all receive
   a bare `/method` and cannot know which section was requested. Any
   server-side mechanism here is wrong. `router.replace`, not `push`, so Back
   does not bounce the reader into a re-hop loop.

4. **One scroll-padding rule, not four scroll-margin classes.**
   `html { scroll-padding-top: 104px }` (TopBar 56 + SectionNav 44 + 4) in
   `@layer base` clears both sticky bars for *every* anchor on the site,
   including `CitationList`'s generated `#cite-N` footnotes that no per-site
   class covered. The four existing `scroll-mt-20` classes are **removed**, not
   raised — keeping both would stack to a 184px gap.

5. **The breakpoint is derived, not round.** `wide: 1440px` with a `1400px`
   canvas comes from `BOOK_ROW_MIN_W = 640px`:
   `1400 − 64 = 1336`, `(1336 − 24) / 2 = 656`, leaving 16px of headroom.
   At the previous 1320px canvas the panes were 616px and every paired position
   table would have opened its own horizontal scroller at every viewport,
   forever. **Do not "tidy" `wide` into `xl` (1280px)** — that reintroduces it
   silently.

6. **Stop rules**, or this becomes the glyph rail by increments:
   - A sub-route may only ever split a top-bar destination **by section, never
     by copy of the same data**.
   - **No sub-route ever appears in the top bar.**
   - At most one audit disclosure per reader-question group.

## On the "four pages" non-goal

`docs/design-goals.md` lists as a non-goal: *"A sidebar icon rail. Four pages. A
four-item top bar is the correct answer."* This ships five routes, so the goal
has to be argued down rather than quietly stepped over.

**First, the fact:** the repo already served **seven** URLs behind that
four-item bar. `/trades`, `/portfolio` and `/research` are live routes that
`redirect()` to `/book`; [ADR-0054](0054-header-items-that-all-land-on-one-page.md)
removed them from the header while keeping the routes so bookmarks resolve.
"Four pages" was never a claim about URL count — it is a claim about how many
primary destinations a reader chooses between, and that number stays four.

**Then the plain version:** the non-goal says "Four pages" and this ships five.
The remedy for one page answering two questions in 13,057px is a second page,
not a longer page. The objection the non-goal was written against is the
*unlabelled glyph rail* — trading clarity for the appearance of scale — and
nothing here adds a rail, a glyph, or a header item.

`design-goals.md` is amended in this same change, because an ADR that argues a
goal down while the goal file keeps asserting the opposite ships two documents
that disagree.

**This is not a reversal of ADR-0054.** That removed four header items that all
landed on one page. This adds one destination with disjoint content and adds
nothing to the header.

## Consequences

**Good**

- `/method` stops being a 14.5-screen document.
- Density and the two-pane gate apply site-wide: card header/body −8px each,
  45 table cells `py-2.5 → py-[7px]`, `.num`/`Th`/`Td` to `leading-[1.35]`.
- Two live bugs fixed on the way: `/book`'s `<main>` carried
  `overflow-x-hidden`, which computes `overflow-y` to `auto` and would have
  made any sticky nav pin to the page instead of the viewport; and `/`, `/risk`
  and `/method` used a bare `px-8`, burning 64px of a 375px phone.
- `CitationList` footnote anchors now clear the sticky bars for the first time.

**Costs, named**

- **Two stacked sticky bars cost 100px permanently** — 11% of a 900px viewport.
  Justified only if readers jump between sections; pure loss if they read
  linearly.
- **Below 1440px nothing pairs.** 1366×768 and 1280 windows get density and
  disclosure only. Lowering `BOOK_ROW_MIN_W` is the wrong fix — that constant is
  test-pinned with a documented rationale about seven columns colliding.
- **Longs ‖ Shorts recovers `min(A,B)`, not `max(A,B)`.** A 8-long/2-short book
  leaves a hole — and a lopsided book is exactly the state the page most needs
  to shout about.
- **`/method#guardrails` now costs a visible client-side hop.** The reader lands
  on `/method`, the component mounts, then `router.replace` fires. On a slow
  connection that is a flash of the wrong chapter. Unavoidable, per decision 3.
- **The guardrail audit is one click further from every entry point.** It is the
  strongest credibility artefact on the site. The chapter control and a static
  footer pointer mitigate; a reader who notices neither will not learn the page
  exists.
- **The canvas widening spends ~40px of cream margin per side** at a 1440
  window (84px → 44px). A real, if small, cost against design goal 4.
- **Density is measured in pixels, not comprehension.** Nobody has tested
  whether an eight-row limit board at `py-[7px]` is still scannable.
- **The projected 29 → ~21 screens is unverified.** There are no Supabase
  credentials in this environment, so the post-change scroll has not been
  re-measured against real data. The projection stands as arithmetic from the
  measured section sizes, not as an observation.
