# ADR-0090 — A published pick must be falsifiable

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0022](0022-hypescore-ic-backtest.md), [0040](0040-published-book-is-the-book-of-record.md), [0066](0066-not-computable-must-persist-as-null.md), [0050](0050-separate-agent-churn-from-market-churn.md)

## Context

Every validation surface in the repo looks **backward at signals**. `backtest_edge.py`
and `backtest_hype.py` compute information coefficients on historical panels;
`replication_test.py` measures agent churn on frozen inputs; `run_eval.py` checks which
model answered. All of them ask "is the signal predictive in history". None of them asks
"was the book we published right".

For a platform whose entire claim is auditable numbers, publishing a $100M long-short
book every weekday and never marking a single call right or wrong is the largest hole
available. It is also the one an outside reader notices first.

**The reason it was missing is not neglect — a pick carried no testable claim.**
`picks[].time_horizon` exists and is populated, but:

- it is **free text authored by L5**, not a required field;
- it takes two fuzzy range values in practice — `"2-4 weeks"` and `"1-3 months"` — neither
  of which is a resolution date;
- it is **not stable for the same position**. `NOC` short read `"2-4 weeks"` on
  2026-07-24 and `"1-3 months"` on 2026-07-25. You cannot resolve a claim whose deadline
  moves every time it is restated.

A model that chooses its own horizon is grading its own exam. Nothing else about the
prose is load-bearing either: a thesis is an argument, not a criterion.

## Decision

Introduce `pick_outcomes` (migration 043) and a fixed resolution spec assigned by the
**pipeline**, not by L5 — the same deterministic/stochastic split the rest of the system
uses. `backend/services/pick_outcomes.py` holds the logic as pure functions;
`scripts/resolve_outcomes.py` runs it.

**Spec v1.** Entry is the close on `run_date` — the pipeline publishes at 21:30 UTC after
the US close, so that is the last price observable when the book existed, and scoring
against any later price would credit the book with a move it could not have acted on.
Exit is the close **21 trading observations** later. `signed_return = (exit/entry - 1) ×
(+1 long, −1 short)`. Verdict is `hit` / `miss` / `flat` / `void` / `pending`.

**Why 21.** Not because L5 says "1-3 months" — because `backtest_edge.py` already
computes IC against **forward one-month returns**. If `/method` reports signal IC on one
window and the scorecard resolves on another, the two instruments disagree about what
"works" means. The table is keyed by `horizon_days`, so a 63-day companion is a row, not
a migration.

**Rows are written at publication, not at resolution.** Every pick gets a `pending` row
as soon as its book exists, so the **denominator is fixed before any outcome is known**.
A scored set assembled after the fact can quietly omit the calls that went wrong; this
cannot. That property is the reason to build the instrument this way rather than as a
query over prices.

**No Brier score.** Adopting it faithfully needs a calibrated probability, and picks
carry `conviction`, which is a sizing input (edge / vol) — not a probability that the
call is right. Mapping one onto the other would be a modelling claim dressed as a
metric. The scorecard reports hit rate, mean signed return and void rate. If a
calibrated probability is ever produced, Brier becomes available with no schema change.

**`void` is not `miss`, and `pending` is not `void`.** A pick the spec could not score
(no close on `run_date`, delisted, unusable price) is `void` **with a required reason** —
enforced by a `CHECK` constraint, because this is the one table where a silent gap
directly flatters the record. A pick that has not matured is `pending`, and a later run
resolves it. A resolved verdict must carry `entry_price`, `exit_price`, `exit_date` and
`signed_return`, also by constraint, so no figure on the scorecard is a naked number.

## Consequences

- **The spec was fixed while every outcome was still unknown.** The earliest published
  book is 2026-07-22 and the horizon is 21 trading days, so the first resolution lands
  ~2026-08-20. On first run all **23 claims across 4 books came back `pending`**, hit
  rate `not yet answerable`. That is the only condition under which "we chose the test in
  advance" is a fact rather than an assertion, and it will not recur — so it is recorded
  here.
- `hit_rate` is `None` until something resolves, never `0.0`. Zero asserts that every
  call was wrong; the honest statement is that the question cannot be answered yet. This
  is design goal 2 on the metric that would most tempt a plausible-looking default.
- The void rate is denominated in **matured** picks, not all picks. Against the total it
  would drift toward zero as `pending` rows accumulate, understating how much of the
  record the spec could not score.
- Hit rate and mean signed return are **both** reported. A book can be right often and
  still lose money; neither number may stand in for the other. Split by direction too,
  because a book right only on its longs is a different book from one right on both.
- Resolution runs as a **non-fatal** step in `daily-refresh.yml` after the refresh, so
  today's book is logged the day it is published. It reports on the book, it does not
  produce one, and a yfinance hiccup must never fail a refresh that already persisted a
  book. The step is idempotent (upsert on
  `run_date, asset, direction, horizon_days, spec_version`), so the next run picks up
  whatever the last one missed.
- Prices are fetched with `auto_adjust=True`. An unadjusted series would score a
  dividend as a price fall and turn a flat long into a miss.
- `direction_sign` **raises** on an unrecognised direction rather than defaulting to
  long. Silently scoring a short as a long inverts its verdict, which is the most
  damaging error this module could make — the same failure ADR-0041 records.

## What this does not do yet

No UI. The instrument records and resolves; nothing on the site renders it, so today the
commitment is visible in the database and not to a reader. A `/method` scorecard section
is the next increment and needs no new logic — it is a render of
`pick_outcomes` plus `build_scorecard`, which is already tested. Until it ships, the
accountability this ADR creates is real but private.

Book-level accountability — what the portfolio actually earned given 50-77% turnover —
is a **different** instrument and deliberately out of scope. It overlaps
`portfolio_cumulative_return` and `DailyPLHistory`, and it measures execution and
turnover as much as idea quality. This ADR scores the *calls*.
