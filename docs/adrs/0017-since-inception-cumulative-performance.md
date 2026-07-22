---
status: accepted
date: 2026-07-22
deciders: platform owner
---

# ADR-0017 — Since-inception cumulative performance is compounded daily

## Context

The platform tracks a single long/short book worth $100M nominal. The daily P&L lands in `portfolio_returns.daily_return`. The question of how to summarize *since-inception* performance has two plausible implementations:

1. **Compounded product** of daily returns: `value_t = product(1 + r_i) for i in 0..t`, starting from the first day the book had a non-zero position. This matches how a real trader thinks about book equity over time and how risk dashboards quote YTD / since-inception.
2. **Additive cumulative sum**: `value_t = sum(r_i) for i in 0..t`. Easy to compute but inaccurate — a +1% day followed by a −1% day compounds to ≈ 0, not 0, yet the additive method reports 0.

Until T14 there was no since-inception table at all; `/portfolio` showed only the day's P&L and a 5-day sparkline. A serious reviewer of the L5 thesis will ask "how has this book performed since you started running it?" Without a since-inception table, the answer is a manual re-aggregation from `portfolio_returns`.

T14 introduced `portfolio_cumulative_return` (migration 014), populated by `backend/services/portfolio.compute_cumulative_return`. The migration declares `compounded BOOLEAN NOT NULL DEFAULT TRUE` and `inception_date DATE NOT NULL`.

## Decision

`portfolio_cumulative_return.cumulative_value` is the **compounded product** of every `portfolio_returns.daily_return` row from the book's inception date to `as_of`:

```
cumulative_value(as_of) = ∏(1 + r_i)  for i ∈ {as_of(i) <= as_of, r_i != null}
```

- `compounded = TRUE` always (the column is a guardrail for future variants; if we ever add a non-compounded row, the flag tells the renderer).
- `daily_returns_count` is the number of `r_i` rows folded into the product.
- `source_first_run_id` / `source_last_run_id` cite the `pipeline_runs.run_id` for the recomputation lineage.
- `inception_date` is the earliest `run_date` with a non-zero position; it is fixed at first row and never advances.
- A sanity cap rejects any single daily return with `|r| > 1.0` (100% daily) as corrupt data.

## Consequences

Positive:
- The cum-return curve shown on `/portfolio`/`CumulativeReturn` is arithmetically correct and audit-grade.
- The compounded value matches the L4 `numeric_derivations.method_id = "compounded_product"`, giving the L7 UI one value to render.
- Cross-book comparison (e.g. credit lens vs equity lens) is trivial because every book is compounded from its own inception.

Negative / friction:
- A re-stated `inception_date` (e.g. after a strategy reset) requires a separate `portfolio_cumulative_return` row partition; the column cannot be back-patched without violating the PK `as_of` constraint.
- The compounded product is floating-point; over many years the cumulative drift vs the analytic value is non-trivial. Mitigation: use Python `decimal.Decimal` for the fold (precision = 28 digits), then cast to `NUMERIC` once.

Alternatives considered:
- **Additive sum**: rejected because two ±1% days are not "flat" — they are 0.01% net, and the additive method would misreport them as 0.
- **Per-lens inception**: rejected as scope creep; one book, one inception.
