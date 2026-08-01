# ADR-0222: portfolio_positions is per-lens, so the held book follows the page

**Status:** Accepted
**Date:** 2026-08-02
**Related:** [ADR-0015](0015-lens-mode-asset-class.md), [ADR-0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md), [ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md), [ADR-0031](0031-…-edge-score.md), [ADR-0032](0032-…-conviction-sizing.md)

## Context

Migration 062 (ADR-0194) made the PUBLISHED book per-lens — `research_recommendations`
and `book_holdings` are keyed on `(run_date, lens, …)` so a credit-lens book coexists
with the multi-asset book on the same date. But the HELD book — `portfolio_positions`
— was left lens-less. That asymmetry is the root cause of the only lens-following
per-name panel that does not render under a non-default lens:

- The **Position risk versus conviction** scatter joins `portfolio_positions`
  (lens-less, the multi-asset held book) against
  `research_recommendations.risk_decomposition` (lens-following, migration 038 /
  ADR-0082). On `/risk?lens=credit` these join on asset name, and the multi-asset
  held book and the credit book's decomposition share zero names in practice
  (verified live 2026-07-30: held = {BABA, F, GEV, GLD, NOC, PDD, SMH, UNG, UNH},
  credit decomposition = {BIL, BKLN, EMB}). Empty intersection → fewer than
  `SCATTER_MIN_POINTS` → `PositionRiskScatter` returns `null` and the row collapses
  to the waterfall alone.

The lens-less held book is also the one place a reader can be misled under a lens:
every other lens-following figure on `/risk` is marked "still the multi-asset book"
when the active lens is not multi_asset, but the scatter's x-axis silently read
multi-asset conviction values the whole time.

## Decision

**`portfolio_positions` becomes per-lens.** Migration 068 adds a `lens` column,
`TEXT NOT NULL DEFAULT 'multi_asset'`, so every existing row is backfilled in place.
The old `UNIQUE (theme_id, asset, direction)` is replaced by
`UNIQUE (lens, theme_id, asset, direction)` so two lenses' held books coexist on one
date. A non-unique partial index on `(lens, conviction)` keeps the per-lens read cheap
once per-lens rows accumulate.

The frontend read site (`frontend/components/risk/RiskBody.tsx`) filters
`portfolio_positions` by the same `resolved` lens used to read
`research_recommendations` and `book_holdings`. On the default (multi_asset) page this
returns the same rows the lens-less read did — every backfilled row carries
`lens='multi_asset'` from the `NOT NULL DEFAULT`, so the change is a no-op for the
existing book and needs no data migration.

**What this deliberately does NOT do** — the held book is not a track record, and the
four track-record tables stay multi-asset-only exactly as ADR-0194 §"Consequences"
left them:

- `pick_outcomes` (ADR-0090), `book_signal` (ADR-0148),
  `book_holdings_performance` (ADR-0150), `book_revisions` (ADR-0093) get **no**
  `lens` column. A per-lens forward record is explicitly out of scope and would
  require re-deriving all four of ADR-0090's guarantees for a second concurrent
  denominator.
- **The credit held book is written per-lens.** `run_credit_lens_book` calls
  `reconcile_positions_to_published_book` under `lens='credit'` after L5b succeeds,
  so the credit book gets `portfolio_positions` rows carrying `lens='credit'`. Both
  `allocate_and_persist_portfolio` and `reconcile_positions_to_published_book` gain a
  `lens` param (default `'multi_asset'`), scope their deletes by lens, and upsert on
  `lens,theme_id,asset,direction` — the new UNIQUE after migration 068. This is also a
  required fix: the old `on_conflict='theme_id,asset,direction'` no longer matches any
  constraint, so the multi-asset nightly would have errored without it.

## Consequences

- **The schema is per-lens and the multi-asset page is provably unchanged.** The read
  filter is `.eq("lens", resolved)`; at multi_asset `resolved` is `'multi_asset'`, and
  every row's `lens` defaults to `'multi_asset'`. Verified by the unit test
  `test_portfolio_positions_lens` and by a live probe of `/risk` before/after.
- **The credit page renders the scatter.** With the credit held book written under
  `lens='credit'`, the existing chart code draws it — the chart itself needed no
  change, only the per-lens held book. Verified live for 2026-08-01: the credit book's
  decomposition is {JNK, BKLN, BIL}, which after the write joins its own
  `portfolio_positions` rows to 3 points, above `SCATTER_MIN_POINTS`.
- **The `(lens, conviction)` index stays small.** It is partial (`WHERE conviction
  IS NOT NULL`) so rows without a persisted conviction never enter it.
- **This is a debt, not a leak.** The held book is a per-day snapshot of target
  weights, not a return stream, and the credit book has no P&L series (ADR-0194
  deferred it). The scatter's x-axis reads the credit book's conviction, and the
  y-axis its decomposition — a genuine credit-book risk view, with no fabricated
  history.

## Alternatives considered

- **A new sibling `credit_portfolio_positions` table.** Rejected — it splits the read
  path in two, doubles the surface area for any future lens, and leaves a trap where
  someone adds a third lens and forgets the new table. A `lens` column on the existing
  table is the migration-062 pattern already used by `research_recommendations` and
  `book_holdings`.
- **Persist `conviction` as JSONB inside the existing row.** Rejected — `conviction`
  already exists as a top-level `REAL` column (migration 025), and the chart reads it
  directly. No shape change needed.
- **Make the scatter read conviction from the per-lens `picks` JSON instead of
  `portfolio_positions`.** Rejected for this change — it would require carrying
  conviction onto the persisted pick objects (a separate shape change) and would leave
  the held book lens-less, which is the underlying defect. The schema fix is the
  durable one.

## Links

- Migration: `supabase/migrations/068_per_lens_held_book.sql`
- Implementation: `frontend/components/risk/RiskBody.tsx` (held-book read filters by
  lens), `frontend/lib/risk/riskBoard.ts` (`PositionRow.lens`),
  `scripts/daily_refresh.py` (`allocate_and_persist_portfolio`,
  `reconcile_positions_to_published_book`, `run_credit_lens_book` — the credit
  held-book writer)
- Tests: `tests/backend/test_book_per_lens.py` (per-lens held-book writes),
  `frontend/tests/unit/risk-analytics-columns.test.ts` (held-book read filters by
  lens)
