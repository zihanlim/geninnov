# ADR-0094 — A benchmark the book can be measured against

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0085](0085-direction-cannot-be-carried-by-hue-alone.md), [0066](0066-not-computable-must-persist-as-null.md), [0058](0058-explanations-are-owed-per-empty-slot.md), [0017](0017-cumulative-return-is-a-growth-factor.md)

## Context

`/risk` draws a cumulative-return curve and a drawdown. A reader's obvious next
question — *versus what?* — has no answer anywhere on the site. It is the
largest unanswered reader question we ship, and it is unanswered for a
mechanical reason rather than a considered one: no reference series was ever
persisted.

The data to fix it is already here. `macro_daily_history` stores `^SPX` as a
daily level — **253 observations, 2025-07-23 to 2026-07-24** — because the macro
snapshot needs it. Separately, `daily_refresh._load_spx_returns` downloads
`^GSPC` from yfinance on every run for the beta regression and then discards it.
So the pipeline has been paying for this series twice and keeping neither in a
shape the frontend can read.

The complication is sample size, and it is severe. The book has **3** daily
observations (`portfolio_cumulative_return.daily_returns_count`, inception
2026-07-23). A benchmark overlay across three points is two noise series drawn
on one axis, and it would look exactly like a track record.

## Decision

**Persist the series; gate the comparison.**

`benchmark_returns` (migration 045) stores one row per `(run_date, ticker)`,
derived by differencing the `^SPX` levels already in `macro_daily_history` and
compounding from the **book's** inception. Written in L4 by
`persist_benchmark_returns`.

Four constraints follow from goals we already hold:

1. **No new feed, and no dependency on the runtime fetch.** The series comes
   from persisted levels, not from `_load_spx_returns`. A stored series should
   not be hostage to whether a network call succeeded during one night's run,
   and the beta path stays untouched.

2. **The benchmark is compounded from the BOOK's inception, not the series'.**
   A reference measured over a different window is not a comparison. Storing it
   any other way would let the chart draw two curves that do not share an
   origin, which is worse than drawing none.

3. **A second series may not introduce a second hue.** [ADR-0085](0085-direction-cannot-be-carried-by-hue-alone.md)
   measured `--long` at 1.03:1 from `--accent`, and established that two inks
   both clearing AA sit at most ~3.3:1 apart — desaturated, they are the same
   grey. So the benchmark path is **dashed in the same ink** as the book's, and
   identity goes in a **pinned end-label** rather than a legend. A legend forces
   a colour lookup; a label at the end of the line is read where the line is.

4. **The overlay is gated on observation count, and the gate states itself.**
   Below the threshold the chart renders the book's curve as before plus a line
   naming the actual count and what it would need — [ADR-0058](0058-explanations-are-owed-per-empty-slot.md)
   applied to a comparison rather than to a cell.

**What is deliberately NOT gated: the whole realised section.** An earlier
framing of this change blanked `/risk`'s realised panels to an `EmptyState`
below the threshold. That is wrong on its own terms — the book's realised curve
is *its own* data, correctly labelled, and a caveat added on 2026-07-26 already
tells the reader it is three observations and not yet a track record. Deleting a
correct chart to avoid a comparison we declined to draw punishes the reader for
our caution. Only the comparison is withheld, and only the comparison explains
itself.

## Consequences

**The chart ships in its gated state and will stay there for roughly three
months.** At one observation per weekday, a 60-day threshold is reached around
late October 2026. This is the honest render, not a placeholder: the code path
that draws the overlay is real and tested, and what a reader sees today is an
accurate statement that the comparison is not yet meaningful. We are explicitly
choosing that over lowering the gate to make something appear on screen.

**`benchmark_returns` accumulates from today, and that is not backfilled.**
The levels exist for a year, so a backfill is *possible* — but the book does not
exist before 2026-07-23, and a benchmark compounded from before the book's
inception measures a window the book never traded. The table therefore starts
where the book starts.

**One more table the data-integrity guard should learn about.** It is not wired
into `check_data_integrity.py` here; a series that silently stops updating would
currently show as a frozen line rather than an error. Noted as owed.

**The beta path is now the odd one out.** `_load_spx_returns` still fetches
`^GSPC` at runtime while this table reads `^SPX` from storage, so the same
concept has two sources with two tickers. They do not have to agree — beta wants
a 252-day regression window and this wants the book's window — but a future
change should probably converge them, and doing it here would have widened a
display change into a risk-engine change.
