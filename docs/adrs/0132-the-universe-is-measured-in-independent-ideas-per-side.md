# ADR-0132: The universe is measured in independent ideas per side

**Status:** Accepted — supersedes the *framing* of [ADR-0043](0043-single-companies-enter-the-universe.md); its additions stand
**Date:** 2026-07-28
**Related:** [ADR-0043](0043-single-companies-enter-the-universe.md), [ADR-0046](0046-conviction-override.md), [ADR-0048](0048-count-independent-ideas-not-candidates.md), [ADR-0131](0131-a-complex-is-safe-to-cap-and-unsafe-to-shop-from.md)

## Context

The standing question was "should the universe widen?" — asked whenever the book comes back with fewer than five picks a side. [ADR-0043](0043-single-companies-enter-the-universe.md) answered it once by adding single companies from a list, judged by theme coverage. That framing measures the wrong thing.

Measured on the 2026-07-27 republished book's own `independent_ideas` (over the 30-name candidate set the agent actually saw — the pool caps at 30 for LLM context, so a name capped out cannot contribute an idea):

| side | names | independent ideas | asked for |
|---|---|---|---|
| long | 17 clustered | **11** (3 complexes + 8 standalone) | 5 |
| short | 13 clustered | **6** (2 complexes + 4 standalone) | 5 |

The long side runs at six ideas of slack; the short side at **one**. And the short side is not name-thin — thirteen names — it is *independence*-thin: **9 of its 13 names collapse into two complexes** (gold: GDX/GLD/IAU/NEM/SLV; China: BABA/FXI/KWEB/MCHI). That is structural, not accidental: natural short expressions share macro drivers, so shorts cluster harder than longs. Adding a tenth name to either cluster adds basket depth and zero breadth.

The published book delivered 4 long / 4 short against 5-and-5. The pool is no longer the excuse on the long side; on the short side, one idea of slack means a single theme rotating out takes the book below target.

## Decision

**A universe addition is judged by the independent ideas it adds to a side, and the acceptance test is the function that already exists.** Re-run `independent_ideas` with the candidate included: if the side's idea count rises, the addition adds breadth; if the name lands inside an existing complex, it adds depth the caps will bound and the book does not need. No new machinery, no judgement call — the same clustering, threshold and window the site already publishes ([ADR-0048](0048-count-independent-ideas-not-candidates.md)), so one number means one thing.

**The short side is where the test has room to pass.** Any widening effort starts there — the long side's six ideas of slack make additions nearly pointless today.

**This is a criterion, not a shopping list.** No tickers are proposed here. `theme_discovery` remains the source of candidates; this gates what a widening must demonstrate before a name enters `ASSETS` (and with it, per [ADR-0125](0125-one-ticker-one-record-the-maps-are-views.md), one record in one place).

## Consequences

**ADR-0043's additions stand; its framing retires.** The single companies it added are in the book doing work (NUE, UNH, JPM held on 2026-07-27). What retires is add-by-list judged by theme coverage — coverage of a theme whose assets all sit in one complex is coverage of one idea.

**Two honest caveats on the number itself.** First, the count is measured on the 30-cap agent pool, not the full candidate table (37 on 2026-07-27) — widening the cap is a different lever with its own LLM-context cost, and conflating the two would misattribute the constraint. Second, [ADR-0131](0131-a-complex-is-safe-to-cap-and-unsafe-to-shop-from.md)'s chain caveat cuts favourably here: a chained component undercounts ideas, so a side may be *less* thin than reported — the error direction flatters no one and never overstates readiness.

**The test is cheap enough to run before every addition, so run it before every addition.** A name that fails it is not rejected forever — correlation regimes move — but it enters as depth, knowingly, or waits.
