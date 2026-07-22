---
status: accepted
date: 2026-07-22
deciders: platform owner
---

# ADR-0016 — Signed-weights portfolio accounting convention

## Context

`scripts/daily_refresh.py` and the L5 `size_positions` step write per-position rows to `portfolio_positions`. The book is long/short, so a short position must contribute *negatively* to the book's net exposure and to the daily P&L rehydration. Two accounting conventions are common:

1. Store absolute weights and a `direction` flag; compute net contributions by multiplying by `direction` at read time.
2. Store weights as **signed** numbers: long = `+notional`, short = `-notional`. Direction is recovered from the sign at read time.

Until T5–T7 the codebase used a mix — some callers (`compute_daily_contributions`, `compute_daily_return` in `backend/services/portfolio.py`) expected signed weights, while the L5 `size_positions` step wrote positive numbers with a separate `direction` column. This produced silent sign-flips whenever a caller forgot to multiply.

T22 added `elapsed_days` to `compute_trade_scores` and T20 added the `classify(ticker)` taxonomy seam. Both changes increased the surface area for sign mistakes (e.g. a theme's per-asset momentum is `signed` per T22, but the long/short split is still per-position). With the new `portfolio_cumulative_return` table (`ADR-0020`) and `exposure.py` aggregation reading every row, the inconsistency needed to be closed.

The brainstorming record lives in `docs/superpowers/specs/2026-07-22-andromeda-full-system-review-and-remediation.md` under "signed weights convention."

## Decision

We adopt **signed weights** as the canonical convention at the storage / API boundary:

- `portfolio_positions.weight` and `portfolio_positions.notional` carry the sign: `+` for long, `−` for short. The `direction` column is retained for human readability and is **derived from** the sign; it is no longer the source of truth.
- All backend computations that consume positions (`compute_daily_contributions`, `compute_daily_return`, `compute_cumulative_return`, `exposure.py`, `book_metrics.py`) operate on signed weights without an additional direction multiplication.
- The L5 `size_positions` node is the single write point that enforces the sign from `direction` before persisting.
- The frontend (`/portfolio`) renders the absolute magnitude for the user-facing position card; signed values appear only in `CumulativeReturn`, `ExposureSummary`, and `DailyPLHistory`.

## Consequences

Positive:
- One source of truth for the sign (the row itself), eliminating an entire class of sign-flip bugs.
- `compute_cumulative_return` (T14, `ADR-0020`) and the `exposure.py` aggregations become single-line `sum(p.weight * return)`.
- Read-side components never need to consult the `direction` column at all.

Negative / friction:
- Any consumer that expected absolute weights (e.g. legacy UI tables) must call `abs(p.weight)` explicitly.
- The `direction` column becomes denormalized; a CHECK constraint guarding the sign direction will be added in a follow-up migration to keep it consistent.

Alternatives considered:
- **Absolute weights + direction flag** (status quo): rejected because the read path is correct *only* if every caller multiplies, which the new exposure / cumulative-return readers had already started violating.
- **Per-position notional table + a separate `signs` join**: rejected as overkill for a single-book system that will not split into sub-books in Phase 1.
