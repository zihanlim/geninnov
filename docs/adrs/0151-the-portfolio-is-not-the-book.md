# ADR-0151: The portfolio is not the book

**Status:** Accepted
**Date:** 2026-07-29
**Reverses:** the `/portfolio` retirement in [ADR-0025](0025-book-centric-information-architecture.md) and [ADR-0054](0054-a-daily-publication-not-a-scanner.md)

## Context

[ADR-0150](0150-a-recommendation-has-no-pnl.md) introduced a book that is **held** —
carried across runs, moved toward each published recommendation, charged for the
move, with a NAV that compounds. It was built, backfilled, wired into the nightly
run, and then rendered as **one panel low on `/risk`**, under a heading about
realised performance.

Meanwhile `/portfolio` — the URL a person types when they want to know what is held —
was still `redirect("/book")`.

So the product had a portfolio and no way to find it, and the one obvious address for
it sent you somewhere else. Asked plainly — *"where is the portfolio?"* — the honest
answer was "buried in the risk page, and the URL you'd guess redirects away from it."

### Why it was retired, and why that no longer holds

ADR-0025 retired `/portfolio` for a specific and correct reason. It was one of three
pages — `/trades`, `/portfolio`, `/research` — rendering **the same ten positions**
from three tables with no cross-links, so *"why am I short KWEB at 8%?"* could not be
answered from any single page. ADR-0054 then removed the nav entries once everything
landed on `/book`, because the header was offering four items that all went to the
same place.

The premise of both was **duplication**. That premise is now false:

| | `/book` | `/portfolio` |
|---|---|---|
| What it is | what the research recommends today | what a portfolio following it owns |
| Source | `research_recommendations.picks` | `book_holdings` |
| Returns | none of its own | `book_holdings_performance`, net of costs |
| Cost of trading | not represented | charged every run |

On the live history the two disagree **by more than the return**: the published series
reads +0.76% and the held book −0.72%. Two pages that disagree about what you own are
not duplicates of each other, and collapsing them hides the disagreement — which is
the single most important thing this product has to say about itself.

## Decision

**Un-retire `/portfolio` as the held book, and put it in the nav.**

It renders NAV and since-inception return net of costs, the held positions, a
**held-against-recommended** table, and the cost comparison — the last by mounting the
same `CostDrag` component `/risk` mounts, never a copy of it (the `AskConsole`
precedent: one component, two mounts).

### On the nav count

`docs/design-goals.md` lists "Four top-bar *destinations*" under non-goals, and its own
text resolves this:

> The objection here is to the unlabelled glyph rail, which trades clarity for the
> appearance of scale; **it was never a count of URLs.**

A fifth **labelled** destination for a genuinely distinct object is not what that
non-goal protects against. The widening is recorded in `design-goals.md` rather than
absorbed silently.

The nav comment in `TopBar.tsx` described the order as *"what's moving → what we hold
→ what could go wrong → how it was derived"*, with `/book` as "what we hold". `/book`
is not what we hold; it is what is recommended, and nobody has paid to put it on. That
slip in a code comment is the whole reason this route came back.

## Consequences

**A reader can find the portfolio.** That is the entire point.

**The two return series sit on separate pages and are cross-linked**, so neither can
be read without the other being one click away. `/risk` keeps `CostDrag` beside the
gross curve it corrects; `/portfolio` mounts it as the portfolio's own performance.

**Bookmarks to `/portfolio` now land somewhere different from before.** They used to
redirect to `/book`; they now resolve to a page about a different object. That is a
real change in behaviour for an existing URL, and it is the intended one — but it is
worth stating rather than discovering.

**Two bugs surfaced while building it**, both of which the page made visible and
neither of which any test caught:

1. **`extend_held_book` upserted holdings without deleting.** A name that left the
   book kept its row, so a date accumulated the **union** of every book ever published
   for it. Caught live: the pipeline re-ran on 2026-07-28, dropped four names and
   added three, and `book_holdings` went to **13 rows for a 9-name portfolio**. Both
   writers now clear the run_date before inserting, mirroring what the pipeline
   already does for `portfolio_positions`.

2. **A drift threshold of `1e-9` against a `REAL` column.** `signed_weight` is
   float32, so a target of `0.05740866` reads back as `0.0574087` — ~4e-8 of pure
   storage error on every row, which reported a fully-rebalanced portfolio as having
   drifted on all nine names. Now `1e-6`, matching `optimizer.WEIGHT_DUST` and its
   existing justification: on $100M that is $100. This is
   [ADR-0068](0068-a-cap-breach-is-not-decided-by-float-error.md)'s lesson recurring
   in a second place — a divergence must not be decided by floating-point storage.

**`/trades` and `/research` stay redirects.** Nothing has changed about them: they
were and remain duplicate views of the book. This ADR reverses one retirement on its
specific merits, not the consolidation.

## Alternatives considered

**Fold it into `/workbench`.** One destination for "the portfolio as an object you
work with", no route reversal, no ADR. Rejected because it conflates what IS held
with what a reader is hypothetically editing, and those must not blur — the workbench
is explicitly a scratch copy that changes nothing, and the portfolio is the record of
what was actually owned.

**Promote it within `/risk`.** Cheapest, and no routing or nav change. Rejected
because it leaves the portfolio framed as a risk metric. It is not a risk metric; it
is the thing the risk metrics are about.

**Leave it where it was.** Rejected on the evidence: the question "where is the
portfolio?" had no good answer.
