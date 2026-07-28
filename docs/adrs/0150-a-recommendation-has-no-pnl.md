# ADR-0150: A recommendation has no P&L

**Status:** Accepted
**Date:** 2026-07-29

## Context

`/risk` publishes a cumulative return curve. `backend/services/portfolio.py`:

```python
def compute_daily_return(positions):
    return sum(compute_daily_contributions(positions).values())   # Σ weight × price return
```

No cost term. `compute_cumulative_return` chains those unmodified.

The published book **reconstitutes itself every run**. Measured over the live
history: mean one-way turnover of **95.1% per run**, and a full 200% replacement
between 2026-07-22 and 2026-07-23.

Priced with this repo's own `cost_model.py` — 10bps commission plus a 5bps
half-spread — that is not a rounding difference:

| | |
|---|---|
| published series, gross of costs | **+0.758%** (`as_of` 2026-07-27) |
| held book, net of costs | **−0.724%** |
| overstatement | **1.48pp** |
| total cost paid | **$855,975** on $100M |

**The sign flips.** At the measured 51% turnover between the last two runs the drag is
roughly 19%/yr; at the 77% upper end of the observed range, roughly 29%/yr. That
plausibly exceeds any alpha the book could carry.

> **Note on the figures.** An earlier draft of this ADR quoted the published series as
> +1.129% and the gap as 1.854pp. Those came from `MAX(cumulative_value)` over
> `portfolio_cumulative_return`, which returns the series' **historical peak**
> (2026-07-25) rather than its latest value. The correct comparison uses the latest
> row, which is what `/risk` renders. The conclusion is unchanged and the direction of
> the error was conservative — the real overstatement is smaller than first stated, and
> the sign still flips.

`rebalance_cost` already existed and looked like it covered this. It does not:
`frontend/lib/chat/tools.ts` defines it as *"the cost of moving from the conviction
book to the published one"* — the optimizer's adjustment **within a single run** — not
yesterday's book to today's. Nothing anywhere measured the cost of actually running
this thing.

### The framing that makes it obvious

A recommendation has no P&L. A **portfolio** has a P&L. The published book is a
recommendation that is reissued daily; attaching a compounding return series to it
asserts that someone held it, and held it for free.

## Decision

**Introduce a book that is HELD, and give the P&L to that.**

`book_holdings` carries signed weights forward across runs. Each run moves the held
book toward that day's recommendation, pays for the move, and compounds a NAV.
`book_holdings_performance` stores turnover, cost, gross return, net return, NAV and
tracking error per date.

### Order of operations is the decision

The return is earned on the book held **through** the period, and the cost is charged
for moving off it. Computing the return on the *new* book would hand it a day of
performance from positions it never held — the look-ahead that makes a rebalanced
strategy appear to time its own trades. Tested directly.

### Why tracking error is currently zero

The held book fully rebalances to the target. A turnover **budget** is a
portfolio-construction decision whose value would have to come from somewhere, and
`OptimizerConstraints` has carried a `max_turnover` field since ADR-0107 with
**nothing ever setting it** — there is no measured basis in this repo for any
particular number.

Choosing one to make the held book look more realistic would be fitting a parameter to
an aesthetic, which [ADR-0047](0047-conviction-needs-a-vol-floor.md) warns turns a
threshold into a statement about the day's numbers rather than about the rule.

So the defect that is real — a return series that pretends trading is free — is fixed,
and the modelling choice that needs its own argument is left as a parameter with no
invented value. `held_book.rebalance()` already accepts a budget when one is justified.
`tracking_error` is stored at zero anyway: a column that appears only when non-zero is
a column nobody knows to look for.

### It does not touch the existing series

`portfolio_returns` and `portfolio_cumulative_return` are left alone.
[ADR-0112](0112-a-backtest-of-these-weights-is-not-a-track-record.md) drew this line
for the weights backtest — *"a simulated series written into it would assert the book
earned returns it did not"* — and a reconstructed series is exactly that. New tables;
the two are compared, never merged.

## Consequences

**The realised curve on `/risk` now states that it is gross of costs**, names the
turnover as the reason it matters, and points at `pick_outcomes` as the forward record
that does not carry the assumption. That caveat also reaches `llms.txt`, so a machine
reader gets it with the number.

**A missing price yields `None`, not a flat day.** Substituting 0% for an absent price
understates realised volatility and would quietly flatter the series
([ADR-0066](0066-not-computable-must-persist-as-null.md)). NAV then carries rather
than resetting.

**NAV compounds.** `1.1³`, not `1 + 3(0.1)` — unlike `portfolio_returns.portfolio_value`,
which recomputes from the capital base each day.

**Weights are stored signed.** Turnover is computed by differencing them, and a
direction flip must read as the full distance travelled: +10% → −6% is 16% of
turnover, not 4%. Differencing unsigned weights would miss it — the trap
[ADR-0101](0101-delete-the-unwired-duplicate-rather-than-wiring-it.md) records.

**The backfill is legitimate.** `scripts/rebuild_held_book.py` is arithmetic over
already-persisted picks and adjusted closes; no LLM, no news window, no scoring
decision is re-made. That is the same rule `scripts/backfill_regime.py` states for
what may and may not be rebuilt. Dry-run by default.

**An uncomfortable result is now visible.** Over the published history the held book
is down net of costs while the published curve is up. That is the point of building
it.

## Alternatives considered

**Net the costs into `portfolio_returns` directly.** Rejected: it silently redefines a
published figure. ADR-0093 requires that a published figure which changes says so, and
the honest form of "this number was wrong" is a new series beside the old one, not a
quiet correction of it.

**Delete the return series and rely on `pick_outcomes`.** Tempting, and it was
considered seriously — `pick_outcomes` scores the calls and has no cost problem. But
it deliberately measures *idea quality at equal weight over a fixed horizon*
([ADR-0090](0090-a-published-pick-must-be-falsifiable.md)), which cannot answer "what
would running this have earned". Deleting the only instrument that asks that question
is worse than fixing it.

**Model market impact as well as spread and commission.** Rejected as out of scope
here. `cost_model.py` has no impact term and says so; adding one is a modelling
decision needing its own evidence, and its absence understates a large trade in a thin
name. The caveat travels with the figure.
