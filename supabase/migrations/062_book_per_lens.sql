-- 062: let a CREDIT-lens book coexist with the MULTI-ASSET book on the same run_date.
--
-- WHY
-- ---
-- An external PM critique's surviving claim was that the tradeable universe cannot
-- express a credit book. The new L2b layer (ADR-0190/0193) now measures per-asset
-- credit betas WITH standard errors and gates on |beta/se| >= 2. Measured on the
-- 2026-07-30 rows: the CREDIT-lens candidate pool has 12 tickers in universe, 9 with
-- a believable credit beta (LQD t=8.25, SHY 7.28, JNK 3.84, IEF 3.70, ANGL 3.61,
-- AGG 3.15, HYG 3.15, EMB 2.55, BIL 2.06) — while the PUBLISHED multi-asset book
-- holds 9 names and only 1 clears the same bar (GEV t=2.33, quality leg only). The
-- engine CAN produce a book with real, measurable credit risk; the published book
-- does not, because it ran under the multi-asset lens. See ADR-0194.
--
-- THE BLOCKER
-- -----------
-- research_recommendations had UNIQUE (run_date) with lens as a plain nullable
-- column, and book_holdings had UNIQUE (run_date, asset) with NO lens column at
-- all. A second lens's run for the same run_date either violated the constraint or
-- silently REPLACED the published multi-asset book.
--
-- WHAT THIS DOES
-- --------------
-- Both tables become keyed by (run_date, lens, ...) so two lenses' books coexist on
-- one date and are independently readable.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
-- --------------------------------------
-- pick_outcomes, book_signal, book_holdings_performance, book_revisions get NO lens
-- column and NO schema change here. They are the multi-asset book's forward record
-- (ADR-0090's falsifiable track record, ADR-0093's revision log, ADR-0150's held-book
-- P&L) and must stay multi-asset-only — a second book writing picks for the same date
-- would corrupt a denominator that is supposed to precede the outcome. The boundary is
-- enforced in application code (backend/services/q1_agent.py, scripts/daily_refresh.py),
-- not by a constraint here, because these tables must not even ADMIT a lens dimension.
-- The credit book is published for INSPECTION; starting its own track record is a
-- separate, deliberate decision — see ADR-0194.

-- Backfill BEFORE the NOT NULL: a NOT NULL added over a NULL fails the ALTER and
-- leaves the migration half-applied. One row predates lens plumbing entirely
-- (2026-07-22, migration 022's documented case) and reads 'multi_asset' by the same
-- convention every other pre-lens row already does.
UPDATE research_recommendations SET lens = 'multi_asset' WHERE lens IS NULL;

ALTER TABLE research_recommendations
    ALTER COLUMN lens SET DEFAULT 'multi_asset',
    ALTER COLUMN lens SET NOT NULL;

ALTER TABLE research_recommendations
    DROP CONSTRAINT IF EXISTS q1_recommendations_run_date_key;

ALTER TABLE research_recommendations
    ADD CONSTRAINT research_recommendations_run_date_lens_key UNIQUE (run_date, lens);

ALTER TABLE book_holdings
    ADD COLUMN IF NOT EXISTS lens TEXT NOT NULL DEFAULT 'multi_asset';

ALTER TABLE book_holdings
    DROP CONSTRAINT IF EXISTS book_holdings_run_date_asset_key;

ALTER TABLE book_holdings
    ADD CONSTRAINT book_holdings_run_date_lens_asset_key UNIQUE (run_date, lens, asset);

COMMENT ON COLUMN research_recommendations.lens IS
    'Asset-class lens the book was constructed under (ADR-0015): multi_asset | credit | '
    'rates | equity | fx | commodity. NOT NULL, defaults multi_asset (migration 062). '
    'UNIQUE (run_date, lens) — a non-multi_asset lens run COEXISTS with the primary '
    'book on the same run_date rather than replacing it (ADR-0194).';

COMMENT ON COLUMN book_holdings.lens IS
    'Asset-class lens this holding was published under (ADR-0015). NOT NULL, defaults '
    'multi_asset (migration 062, backfilling every pre-existing row). UNIQUE '
    '(run_date, lens, asset) — see ADR-0194. book_holdings_performance is deliberately '
    'NOT given this column: it is the multi-asset held book''s turnover/cost/NAV series '
    'and stays multi_asset-only.';
