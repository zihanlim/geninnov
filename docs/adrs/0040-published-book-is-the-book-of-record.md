# 0040 — The published book is the book of record

- **Status:** accepted
- **Date:** 2026-07-24
- **Extends:** [ADR-0024](0024-persist-book-analytics-not-prompt-strings.md) — which
  already recomputes tilts, scenarios and correlation on the final sized book. This
  applies the same rule to positions, returns and risk.

## Context

The app was publishing **two different portfolios**, and had been since the L5 agent
was introduced.

`/book` renders `research_recommendations.picks` — what L5 selected and sized. But
`portfolio_positions`, the daily return, and every risk statistic were computed from
L1's *provisional* book, which L5 then re-picks a subset of. Nothing reconciled them.

Measured live on 2026-07-24:

| source | names | gross |
|---|---|---|
| `portfolio_positions` (drives `/risk` attribution, VaR, Sharpe, HHI, returns) | **12** | 92.2% |
| `research_recommendations.picks` (drives `/book`) | **6** | 98.9% |

**EFA, IWM, QQQ, SLV, SPY and XLV were being attributed risk on `/risk` while
appearing nowhere in the published book.** A reviewer asking "do I own QQQ?" got yes
on one page and no on the other.

This is worse than a display inconsistency. VaR, CVaR, Sharpe, Beta, HHI, the daily
return and the drawdown curve all described a portfolio nobody holds — and `/risk`
compounded it by reading cap utilisation and scenarios from L5's book while reading
per-position attribution from L1's, so the page contradicted *itself*.

`GOAL.md` has carried this since iteration 1 as "`/risk` mixes two books by
construction", with the fix stated as "either have `/risk` read one source, or have L5
size the L1 book rather than re-pick it."

## Decision

**The book L5 publishes is the book of record.** After L5 persists, `portfolio_positions`
is rewritten to its picks and the daily return, risk statistics and cumulative return
are recomputed on that book.

The ordering constraint is real and is why this cannot simply be moved earlier: L5
*consumes* the provisional risk metrics as reasoning input. So the sequence is
deliberately compute-twice — provisional book → provisional risk → L5 reasons → final
book → **final** return and risk. That is the same shape ADR-0024 already established
for tilts, scenarios and correlation.

Matching is on `(asset, direction)` against the candidates we already sized. L5 cannot
invent tickers ([ADR-0014](0014-candidate-set-hard-filter.md) hard-filters its picks to
the candidate set), so every pick maps back. We adopt L5's weights directly, which are
already cap-respecting because `size_positions` delegates to the same
`allocate_portfolio` ([ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md)).

**Two explicit refusals.** If L5 produced no usable picks, the L1 book stands unchanged
— a fallback day still has a real, coherent portfolio rather than an empty one. If a
pick somehow falls outside the candidate set, we log loudly and keep the L1 book rather
than publish a book that disagrees with its own risk.

## Consequences

**Every number on `/risk` now describes the portfolio on `/book`.** Attribution, VaR,
CVaR, Sharpe, Beta, HHI, the daily return and the drawdown curve are all computed on
the six names actually held. `/risk` also stops contradicting itself, since its
attribution and its cap/scenario blocks now read the same book.

**The daily return series changes meaning, for the better.** It was tracking the L1
book; it now tracks what was published. The historical series before this change was
computed on the provisional book — a discontinuity worth remembering when reading the
cumulative curve across this date.

**Risk is computed twice per run.** Once provisionally as an L5 input, once finally on
the published book. That is the honest cost of letting an agent reason about risk
before deciding the book, and it is cheap — both are pure functions over a handful of
positions.

**L1's book is now genuinely provisional**, and should be described that way wherever
it surfaces. It remains the candidate set L5 chooses from and is still the fallback
when L5 fails, but it is no longer "the portfolio".
