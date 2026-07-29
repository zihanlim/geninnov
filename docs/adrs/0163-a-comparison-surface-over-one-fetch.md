# ADR-0163: A comparison surface over one fetch, and two adoptions that did not survive contact

**Status:** Accepted
**Date:** 2026-07-29

## Context

The Stitch "Systematic Alabaster" archive was triaged twice. The first pass
([ADR-0161](0161-a-corpus-the-board-could-not-see.md)) read `docs/design-goals.md`
*before* the screens and sorted every element against it, which produced a long refusal
table and two adoptions that were not adoptions at all — they were bugs the comp
incidentally exposed. The owner's objection was that this is doctrine-first: it never
engages with what the design is good at.

The second pass read the **markup** — 3,214 lines across seven `code.html` files,
skipped entirely the first time — and the answer changed. Four ideas were selected for
adoption, and the owner asked for a **side-by-side comparison surface** rather than a
decision taken on argument, since `git stash` is forbidden in this worktree.

## Decision

**1. `/book2` renders `BookShell` with `variant="next"`. One fetch, two layouts.**

Two routes querying `research_recommendations` separately are two chances to describe
different vintages — the class [ADR-0040](0040-one-fetch-one-vintage.md) closed and the
reason `/method` and `/method/evidence` share one `MethodBody`
([ADR-0084](0084-method-splits-by-reader-question-not-by-copy.md)). `/book2` is not a
copy; it is the same component told which layout to draw.

The body moved to `components/book/BookBody.tsx` because **a Next.js route module may
only export `default` plus the framework's config names** — a named export from
`page.tsx` fails the generated route types with *"not assignable to type 'never'"*. The
plan proposed exporting from `app/book/page.tsx` to keep the diff small; that is not
legal, and the move is the same one `PositionRow` already made for the same reason.

`variant` is gated so `/book` is bit-identical while the comparison is open, and a test
asserts the default render equals the `current` render.

**2. Thesis beside counter-thesis (`/book2`).** The comp renders a claim next to its
offset (`CAPEX RISK` | `CYCLICAL BUFFER`). We persist both halves and place the
counter-thesis directly *below* the thesis, with `Sizing` beside it — so the argument
and its rebuttal are never read together. `/book2` swaps exactly two cards.

**3. Master-detail (`/book2`).** The list draws headers; the selected position's detail
is drawn once, below both tables. Beyond the comp's argument it fixes a real defect:
expanding inline pushes only ONE column down, desynchronising Longs and Shorts.

Implemented as one component with three `chrome` modes (`full` | `header` | `detail`)
rather than a separate detail component, which would have to recompute `sizingChain`,
`marginal`, `sibling`, the scenario lines and stability — sixty lines of derivation with
two places to fix every future change.

**Not** the comp's right-hand sidebar, and the reason is arithmetic: the comp affords a
1/3 sidebar because its list is one column. Ours is two, and a third column leaves each
table ~440px against `BOOK_ROW_MIN_W` of 640px — every row would open its own horizontal
scroller. Not sticky either; a full-width block below the content has nothing useful to
stick to, so there is no inner scroller and the page scrolls as one document.

## The two that did not survive, and why that is the finding

**4. Visible source tokens in cited prose — REJECTED, no data.** The comp puts `[FRED]`
inline. `CitationList` already renders inline anchors at the claim and already carries
the source as `title={cite.source}` — a tooltip, unreachable on touch — so this looked
like a small change. Built, then measured: **0 of 10 theses in the live book contain a
`{N}` marker.** The inline-citation mechanism ([ADR-0010](0010-citation-footnotes-everywhere.md))
has never been exercised; L5 does not emit anchors, so `CitationList` renders text
verbatim and the 42 citations are a flat footnote list while the model hand-writes source
IDs into the prose. The change rendered nothing and was reverted. Making it real is a
**backend** change — L5 must emit clause-level anchors and the guardrail must verify
them — not a frontend one.

**5. Source-activity sparkline — REJECTED, the trend was an artifact.** The comp's
data-health card carries a per-source bar strip, which answers *"is this degrading?"* —
the question a verdict cannot. Built against `market_news.published_date`, it rendered
`brave_market 61 → 9 docs/day`, an alarming decline.

It was not real. **PostgREST caps a response at 1000 rows regardless of `.limit(4000)`**,
and ordering by `published_date desc` returns the newest ~6 days — so the strip drew a
truncation window whose boundary days are partial, and the "decline" was the cut. Live
counts: gdelt **42** days, rss **84**, brave_market **9**; the strip claimed 6 for all
three. This is the same failure ADR-0155 (corpus volume), ADR-0158 (the date field) and
ADR-0159 (the view's anchor date) each record — a window boundary manufacturing a shape.
Reverted. A truthful version needs **server-side aggregation** (an RPC returning daily
counts per source), not a row-limited client fetch, and must handle GDELT's publication
lag making the newest day structurally thinnest.

## Consequences

- Two adoptions ship behind a variant; two are recorded as **specified follow-ups with
  their blocking reason**, which is more useful than either shipping them broken or
  refusing them on doctrine.
- `/book2`, `lib/book/variant.ts`, the `chrome` prop and every `variant === "next"`
  branch come out together when the comparison is decided. `ARCHITECTURE.md` carries the
  route with that removal condition attached.
- `book-row-grid.test.ts` asserted a path inside `app/book/page.tsx`; the move broke it
  and it was updated. A file-path assertion is the one kind of test a file move can
  invalidate silently.
- **A correction worth keeping.** The first reading of the expanded panel reported "two
  empty cells at r2c2/r3c2 and a stale comment", and a five-card reshuffle was built on
  it. Both were wrong: `Sizing` and `Factor exposure` carry no row/col and are placed by
  grid **auto-flow** into exactly those cells. The grid was always full and the comment
  was accurate. Grepping for explicit `row-start` classes cannot see auto-placement, and
  the reshuffle would have fought it. The behaviour is now documented in the component.

## Alternatives considered

- **`/book2`, `/risk2`, `/method2` as a full set**, as first suggested. `/risk` and
  `/method` receive no adoptions here, so those routes would be near-identical copies —
  the duplication ADR-0084 forbids, for no comparison value.
- **A `?variant=` search param, or a rewrite from `/book2` to `/book?variant=next`.**
  Cheapest, and it keeps one route. Rejected for consistency: the repo already solves
  "two routes, one body" with a shared component, and a routing trick in
  `next.config.js` is a second mechanism for the same job.
- **An in-page toggle.** Ships a control whose only purpose is evaluation, which is the
  affordance objection in goal 5 pointed at ourselves.
- **Keeping the sparkline with an honest "6 days shown" label.** Rejected: the label
  would be accurate about the drawing and misleading about the source, and the boundary
  days would still be partial. A chart that needs a caption explaining why its shape is
  not real should not be drawn.
