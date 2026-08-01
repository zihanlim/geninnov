-- 068: portfolio_positions is per-lens, so the /risk scatter can render under
-- every lens.
--
-- WHY
-- ---
-- Migration 062 made the PUBLISHED book per-lens (research_recommendations,
-- book_holdings keyed on (run_date, lens, ...)), but the HELD book
-- (portfolio_positions) was left lens-less. That split is the root cause
-- of the only lens-following panel that does not render on /risk?lens=credit:
-- the Position risk vs conviction scatter joins a lens-less
-- portfolio_positions against a lens-following risk_decomposition, and the
-- intersection is empty under any non-default lens (the multi-asset held
-- book and the credit book's decomposition share zero names today:
-- held = {BABA, F, GEV, GLD, NOC, PDD, SMH, UNG, UNH}, credit decomposition
-- = {BIL, BKLN, EMB} on the 2026-07-30 run). See ADR-0222.
--
-- THE BLOCKER
-- -----------
-- portfolio_positions had UNIQUE (theme_id, asset, direction) with NO lens
-- column. A credit run that wrote the same (theme_id, asset, direction)
-- would have violated the constraint — and a delete-then-upsert
-- reconciliation against today's date would have wiped the multi-asset
-- book to make room.
--
-- WHAT THIS DOES
-- --------------
-- portfolio_positions gains lens, NOT NULL DEFAULT 'multi_asset' so every
-- existing row is backfilled in place. UNIQUE (theme_id, asset, direction)
-- is dropped and replaced by UNIQUE (lens, theme_id, asset, direction) so
-- two lenses' held books coexist on the same date. A non-unique
-- (lens, conviction) partial index is added so the scatter's per-lens
-- lookback stays cheap once per-lens rows accumulate.
--
-- The four track-record tables named in migration 062 — pick_outcomes,
-- book_signal, book_holdings_performance, book_revisions — get NO lens
-- column here. They are the multi-asset book's forward record
-- (ADR-0090/0148/0150/0093), and a per-lens forward record is explicitly
-- out of scope (ADR-0194 §"Consequences"). The held book itself is NOT a
-- track record: it is a per-day snapshot of target weights, not a return
-- stream. The credit book gets its own per-day snapshot under
-- lens='credit', and that is the full extent of the change.

ALTER TABLE portfolio_positions
    ADD COLUMN IF NOT EXISTS lens TEXT NOT NULL DEFAULT 'multi_asset';

ALTER TABLE portfolio_positions
    DROP CONSTRAINT IF EXISTS portfolio_positions_theme_id_asset_direction_key;

ALTER TABLE portfolio_positions
    ADD CONSTRAINT portfolio_positions_lens_theme_id_asset_direction_key
        UNIQUE (lens, theme_id, asset, direction);

CREATE INDEX IF NOT EXISTS portfolio_positions_lens_conviction_idx
    ON portfolio_positions (lens, conviction)
    WHERE conviction IS NOT NULL;
