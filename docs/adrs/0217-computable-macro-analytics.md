# ADR-0217 — Computable macro analytics belong in regime_classifications, not a new table

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0098](0098-three-states-not-two.md), [0137](0137-units-are-declared-not-assumed.md), [0139](0139-dollar-debasement-pressure.md), [0140](0140-hawkish-dovish-pivot-indicator.md), design-goals.md §1, §3

## Context

Three new metrics are derivable from data the system already has on disk:

1. **JPM-style Equity Risk Premium** = `earnings_yield(SPX) − DGS10`. Needs SPX closes (in `macro_daily_history`), DGS10 (same), and a hand-curated trailing EPS that is not yet in the system (the input that Workstream B's `structured_facts` table will provide).
2. **Equity-bond correlation** = rolling 60d Pearson r of SPX returns and DGS10 changes. Surfaces the SocGen "10y > 4.5% AND corr < 0" hedge-flip rule as a single boolean.
3. **NDX seasonality** = per-month and midterm-year stats from `^NDX` monthly returns 1990+. The Q2 recap cited Aug +1.78%, Sep -2.11%, midterm-year Aug-Nov 0% median, peak-to-trough avg -17.3%, post-trough recovery +31.7%.

The current regime row already carries a body of derived state — `debasement_pressure` (m052, 6 columns), `fed_posture` (m053, 6 columns). Each is a numeric reading with provenance and a status (`measured` / `insufficient_history` / `unknown`). The three new metrics are the same shape, and the L5 reasoning agent already reads the whole regime row, freezing it into the snapshot it cites from.

**Two design questions to settle before any code lands:**

A. **Where do they live — a new table, or a JSONB column on `regime_classifications`?**
B. **How does the L5 cite them — by column name, or by JSON path?**

A new table would be over-engineered: a single computed reading with the same `(run_date, metric, value, status)` shape the regime row already carries. The existing JSONB precedent (`fed_posture_evidence` in m053) shows the same data can be carried as a column without a JOIN. JSONB on `regime_classifications` is the consistent choice.

For (B), the L5 currently cites `[regime_classifications:<colname>]`. A JSONB column would need a new cite format — `[regime_classifications:computable_macro:<metric_key>]` — but the citation guardrail can be extended to match it.

## Decision

**The three new metrics live as a single JSONB column on `regime_classifications` named `computable_macro`, populated by three pure-function service modules after L3.**

```
regime_classifications.computable_macro : JSONB
{
  "erp": {
    "erp_pct": 2.16,                # or null
    "earnings_yield_pct": 6.89,     # or null
    "spx_pe": 14.5,                 # or null
    "ust10_pct": 4.73,              # input, echoed
    "as_of": "2026-07-31",
    "eps_as_of": "2026-06-30",
    "status": "measured" | "insufficient_history" | "unknown",
    "reason": null | "<why>"
  },
  "equity_bond_corr": {
    "corr": -0.05,                  # or null
    "n_pairs": 60,
    "lookback_days": 60,
    "ust10_pct": 4.73,
    "socgen_flip_active": false,    # or null when status is not measured
    "as_of": "2026-07-31",
    "status": "measured" | "insufficient_history" | "unknown",
    "reason": null | "<why>"
  },
  "ndx_seasonality": {
    "current_month": 8,
    "current_month_label": "Aug",
    "per_month": [{month, label, n_years, mean_pct, median_pct, win_rate_pct, worst_month_pct}],
    "midterm": {n_midterm_years, aug_nov_median_pct, aug_nov_mean_pct, peak_to_trough_avg_pct, post_trough_recovery_avg_pct, midterm_years_observed},
    "window": {start_year: 1990, end_year: 2025},
    "n_observations": 432
  }
}
```

**Three service modules** are the source of truth — `backend/services/equity_risk_premium.py`, `equity_bond_correlation.py`, `seasonality_analytics.py`. Each is a pure function (no Supabase dependency), takes its inputs as parameters, and returns the dict above. The orchestration in `daily_refresh.py` is responsible for the DB reads and the JSONB write.

**Citation format** extends the existing convention: `[regime_classifications:computable_macro:<metric>]` where `<metric>` is one of `erp`, `equity_bond_corr`, `ndx_seasonality`. The `verify_citations` regex (Workstream D) gains three new allowed keys.

**Status semantics** follow ADR-0098 unchanged: `measured` / `insufficient_history` / `unknown`. Absence is data, not zero. The L5 cites the status alongside the value, so "ERP unknown" reads the same way as "debasement_pressure unknown."

**EPS input for ERP**: until Workstream B's `structured_facts` table lands, the trailing EPS is unavailable, ERP reports `status="unknown"`, and the L5 cites the absence. Once `structured_facts` is loaded, `daily_refresh` reads the EPS row and the function returns a real number. The same callable pattern that already powers `debasement_pressure` (DFII10 + DXY + GC=F) is the precedent.

**NDX seasonality fetch**: the long NDX history (1990+) is NOT in `macro_daily_history` (which holds 1 year). The service's live fetcher (`fetch_ndx_monthly_returns_from_yfinance`) is called by `daily_refresh` on a quarterly cadence, cached as parquet at `backend/data/cache/seasonality.parquet` (gitignored). A test-only path passes a synthetic frame.

**Midterm-year list** is hardcoded as `tuple(range(1974, 2027, 4))` = `(1974, 1978, ..., 2026)`. Hardcoded on purpose: the US Congress's schedule is a defined quantity, not a derived one. A function that auto-derived it would re-derive a fact, not use one.

**Backfill** is the same pattern as the debasement / fed-posture backfills: `scripts/backfill_regime.py` calling the new service once per historical `run_date` with the same `as_of` bound. The classifier remains the source of truth — no SQL implementations of the formulas.

## Consequences

- **Positive**: the L5 reasoning agent has a one-stop cite for the macro state, with provenance per metric. The `composite_macro` JSONB column mirrors the existing `fed_posture_evidence` JSONB (m053), so the schema is consistent.
- **Positive**: the three service modules are pure functions, so they are unit-testable without a Supabase client or network. The plan's acceptance criteria are testable in `tests/backend/test_equity_*.py` and `test_seasonality_analytics.py`.
- **Positive**: Workstream B's `structured_facts` table can be added without re-plumbing — the EPS is a `structured_facts` row the L5 calls, and the ERP service reads it from a parameter passed by `daily_refresh`. No new join, no new column.
- **Negative**: the L5 cite space grows. `verify_citations` must be extended (Workstream D), and a reader auditing a thesis must learn the new format.
- **Negative**: `regime_classifications` carries yet another JSONB. The discipline of *why* each lives in a JSONB vs a flat column has to be visible in the comment (see migration 063).
- **Negative**: a quarterly NDX refresh means a *delayed* signal in a regime where the same data could be fetched nightly. Accepted: per-month stats are a slow-moving target, and a quarterly refresh is well below the granularity a calendar-month return can change. A monthly refresh would be the next-step fix; quarterly is enough to ship.

## Refused alternatives

- **A new `computable_macro` table**: rejected. A single computed reading with `(run_date, metric, value, status)` is the shape `regime_classifications` already carries; a new table is over-engineered and would have to JOIN on every read.
- **Storing the inputs (SPX series, DGS10 series) alongside the output**: rejected. The inputs are already in `macro_daily_history` and `factor_exposures`. The output is the only thing the L5 cites, so the output is the only thing the table should hold.
- **Implementing the formulas in SQL**: rejected. A second implementation of the math would silently drift from the Python on the next threshold change. The pattern ADR-0139 / ADR-0140 set is "the Python is the source of truth; the migration is the column." Following it.
