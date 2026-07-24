# ADR-0066 — "Not computable" must persist as NULL, not as 0.0

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0036](0036-carry-as-excess-yield-over-funding.md), [0064](0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md), [0038](0038-per-asset-direction.md), [0032](0032-edge-carry-value-abstention-sizing.md)

## Context

[ADR-0064](0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md) fixed
`/method`'s worked example, which summed `w × (v ?? 0)` instead of renormalising over the
components that exist. It applied the same fix to `/book`'s `EdgeBars`.

**`/book` still could not reconcile.** Expanding XLE on the live book:

```
Trend     +0.94   +0.189
Regime    +0.06   +0.015
Carry     +0.00   +0.000      ← not null. zero.
Value     +0.00   +0.000
Sentiment +0.06   +0.003
Persisted EdgeScore differs from the sum of shown components by +0.224
```

The renormalisation had nothing to renormalise over, because **the persisted components
say `0.0`, not `NULL`**. `/method` reads `theme_signals_history`, where carry and value
are genuinely `NULL` for three themes; `/book` reads the per-position columns, where they
are `0` for **every** position — including names whose theme *does* have both computable.

**The damage is exact and measurable.** Across the live 2026-07-25 book, **eight of nine
positions** satisfy

```
persisted_edge_score == naive_sum / 0.48
```

where `0.48 = w_trend + w_regime + w_sentiment`. The pipeline computed each score
**renormalised over the components that existed** — correctly, per ADR-0036 — and then
wrote carry and value as `0`. **The score is right and the components sitting beside it
contradict it.**

The cause is one coercion in `compute_edge_scores`:

```python
"carry_signal": a_carry if a_carry is not None else 0.0,
```

`compute_edge_score` is handed the real `None`s a line above and renormalises properly.
Only the persisted copy lies. And it lies in exactly the way ADR-0036's own docstring
warns against:

> Scoring a missing component as 0.0 is not neutral — it silently shrinks |EdgeScore|
> toward the abstention band … a theme whose asset classes happen to lack a carry or
> value proxy was being penalised for a gap in our data.

Here it does not shrink the score — the score was computed before the coercion — but it
destroys the information a reader needs to check the score, which is the same loss one
layer later.

`EdgeBars`' warning was therefore **right that the numbers differ and wrong about why**:
it says *"a component or weight changed since this book was sized"*, when nothing
changed and nothing was mis-weighted.

## Decision

**Persist `None` as `None`.** The four EdgeScore components on `trade_candidates` and
`portfolio_positions` carry `NULL` when the component was not computable for that asset.

- `TradeCandidate` types them `float | None` and stops defaulting them at construction.
  `.get(key, 0.0)` only fires on an **absent** key, so the default was never what
  coerced — but making it explicit stops the coercion being reintroduced by someone
  reading the annotation and "fixing" the type.
- **Safe by inspection, and that was checked rather than assumed:** nothing in
  `backend/` or `scripts/` performs arithmetic on these four fields. They are carried and
  persisted for display and reconciliation only, and the score itself is computed from
  the pre-coercion values, so **no position changes sign or size**. The columns are
  nullable `REAL` (migration 025) and the frontend types are already `number | null`.

## Consequences

- **`/book`'s per-position decomposition becomes reconcilable** for the first time. With
  `NULL`s present, `recomputeEdgeScore` (ADR-0064) divides by the weight actually
  present, and `EdgeBars` should stop reporting a difference. **Takes effect on the next
  pipeline run** — the columns are written at L1, so no existing row is retroactively
  corrected.
- **`/book` and `/method` finally describe the same quantity the same way.** They read
  different tables, and until now those tables disagreed about what "no carry proxy"
  looks like.
- **The general rule, and this is the third instance in two days:** a value that means
  *"we could not compute this"* must never be stored as a number that means *"we computed
  this and it was zero"*. [ADR-0060](0060-a-share-cannot-exceed-the-whole.md) withheld a
  share rather than print a meaningless one; ADR-0064 stopped a page inventing a total;
  this stops a row inventing a component. The recurring failure is not bad arithmetic —
  it is **encoding absence as a value**.
- **Left open, and named:** `SVXY` is the one position of nine whose persisted score
  equals its naive sum, so it was scored with all five components present while its
  persisted carry and value still read `0`. Whether that is a genuine zero carry or a
  different code path was not established here, and the next run under this change will
  say — a real zero stays `0.0`, a non-computable becomes `NULL`.
