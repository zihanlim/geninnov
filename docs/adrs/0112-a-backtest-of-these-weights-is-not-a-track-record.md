# ADR-0112: A backtest of these weights is not a track record

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md), [ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md), [ADR-0109](0109-what-was-read-across-from-im-jarvis-and-what-was-not.md), [ADR-0023](0023-unavailable-is-not-zero.md)

## Context

The book is three sessions old. Every realised statistic on `/risk` is therefore withheld by `MIN_SESSIONS_BY_FIELD` — VaR needs 30 sessions, Sharpe 60, historical VaR 100, Calmar a full year — and the panels built over the last few iterations render mostly as stated absences.

The question raised was whether to **backfill the books** so those figures become computable.

`scripts/backfill_regime.py` has already answered the general form of that, and its reasoning holds:

> **L5's book.** Re-running the agent over reconstructed inputs produces a SIMULATED book; writing it into `research_recommendations` would assert the system published on days it did not. That is fabricating the audit trail of a product whose entire claim is an auditable trail.

It refuses L1 for a subtler reason worth preserving: HypeScore's `price_corr` and `momentum` *are* reconstructible from yfinance, but `mention_count` and sentiment come from Brave and Reddit, which are recency-biased. Backfilling the half that is available "would produce a number that is not HypeScore while being stored in the column that says it is."

**A correction to the premise that prompted this.** Backfilling would not buy ex-ante risk. The ex-ante figures — `risk_decomposition`, `monte_carlo_var`, `var_forecast` — borrow history from the **constituents**, not from the book, and are live today on a three-day-old book. What backfilling would buy is the *realised* statistics, which is a different and much more dangerous thing to manufacture.

But the ex-ante figures are all **distributional**. They say nothing about the *path*: drawdown depth, downside asymmetry, or behaviour specifically on the days the market falls. Those are real questions, they are the emptiest panels on the page, and no amount of covariance answers them.

## Decision

**Backtest one weight vector. Do not backfill any books.**

`weights_backtest.backtest_weights` holds the published weights **fixed** across 252 days of the constituents' returns — the same frame `decompose_risk` and the optimizer already use, so the backtest and the ex-ante figures describe one reading of history rather than two — and reads the path statistics off the resulting series.

Three consequences follow, and all three are enforced rather than described:

**1. It never touches `portfolio_returns`.** That table is the realised series `/risk` renders and `pick_outcomes` scores against. A simulated series written into it would assert the book earned returns it did not. Its own column, `research_recommendations.weights_backtest` (migration 048).

**2. The caveats live in the payload, not on the page.** `selection_caveat`, `method_caveat` and a literal `is_track_record: false` are **stored strings and a stored boolean**. This column is reachable through `/ask` and the MCP server, where page copy does not travel — the same reasoning that made `positioning_crowding.summary` a persisted sentence rather than UI text. A consumer should not have to infer from a column name that a Sharpe ratio is simulated.

**3. It is weaker evidence than it looks, and says so first.** The panel renders its caveats **above** the numbers. A drawdown and a Sortino look identical whether they came from a live book or a simulation; the only thing separating them is the sentence next to the number, and a sentence placed below a table is a sentence a reader has already skipped.

The two admissions that matter:

- **The weights were chosen knowing this window.** Several holdings entered the universe in migration 032 because they screened well recently. The window that scores them is the window that informed them — contaminated by construction.
- **Fixed weights: no rebalancing, no drift, no transaction costs.** A real book pays `cost_model` to stay at these weights. This is the frictionless version, and it flatters.

**Reuse, not reimplementation.** Sharpe, Sortino, Calmar, max drawdown and historical VaR/ES come from `risk_engine`'s own estimators, and the benchmark comparison from `benchmark_compare`. Two copies of a Sortino drift; the point of the ported quant layer ([ADR-0109](0109-what-was-read-across-from-im-jarvis-and-what-was-not.md)) is one implementation per statistic.

## Consequences

**A short window refuses rather than producing a confident drawdown.** Below 252 overlapping sessions it returns `computed: false` with a reason — *"a drawdown measured over less than a year describes the window, not the book"* — and **no statistics at all**, rather than nulls in a shape that reads as measured.

**An unpriced holding is excluded, not treated as flat.** A zero return would assert the position was flat *and* leave its weight diluting the total. `coverage_share` reports how much of book gross the frame could price, and a test asserts the resulting series is identical to one computed without the phantom holding — if a drop ever leaked in as a zero, the cumulative return would move.

**Non-finite statistics become `None`, never NaN.** NaN mangles differently in JSON and in a `REAL` column ([ADR-0066](0066-not-computable-must-persist-as-null.md)).

**This does not weaken `pick_outcomes`.** ADR-0090's forward record is the thing that can actually be wrong about the future: picks written as `pending` at publication, scored against a horizon fixed before the outcome was knowable. The backtest is retrospective and self-selected; it is offered as a description of a weight vector, and the panel points at `/method` for the record that is not.

**The honest summary a reviewer should get:** the ex-ante figures say what risk this book carries, the backtest says how this shape of book has behaved, and `pick_outcomes` says whether our picks have been right. Only the third is a track record, and today it has almost no data — which is the true state of a book published two days ago.
