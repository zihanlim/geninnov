-- 009_asset_class_lens.sql
-- Adds asset_class column to theme_assets and backfills the Tier 1 universe.
-- This powers the "lens mode" filter on the L5 reasoning agent and the
-- frontend <LensSelector> on /portfolio and /trades. See ADR-0015.

BEGIN;

-- 1. Add the column
ALTER TABLE theme_assets
    ADD COLUMN IF NOT EXISTS asset_class TEXT
    CHECK (asset_class IN ('rates', 'credit', 'equity', 'fx', 'commodity', 'crypto', 'other'));

CREATE INDEX IF NOT EXISTS idx_theme_assets_class
    ON theme_assets(asset_class);

-- 2. Backfill the Tier 1 universe (practitioner-defined asset mappings)
--    Credit and rates: HYG, LQD, JNK, BKLN, ANGL, CDX, EMB, TLT, IEF, SHY, TIPS, AGG, BIL
--    Equity: QQQ, SPY, IWM, FXI, MCHI, BABA, KWEB, XLE, XLF, XLV, ARKK
--    FX: UUP, FXE, EWZ, DXY
--    Commodity: GLD, SLV, UNG, OIH, CL
--    Vol: SVXY
UPDATE theme_assets SET asset_class = 'credit'   WHERE ticker IN ('HYG', 'LQD', 'JNK', 'BKLN', 'ANGL', 'EMB');
UPDATE theme_assets SET asset_class = 'rates'    WHERE ticker IN ('TLT', 'IEF', 'SHY', 'TIPS', 'AGG', 'BIL');
UPDATE theme_assets SET asset_class = 'equity'   WHERE ticker IN ('QQQ', 'SPY', 'IWM', 'FXI', 'MCHI', 'BABA', 'KWEB', 'XLE', 'XLF', 'XLV', 'ARKK', 'EWJ');
UPDATE theme_assets SET asset_class = 'fx'       WHERE ticker IN ('UUP', 'FXE', 'EWZ', 'DXY');
UPDATE theme_assets SET asset_class = 'commodity' WHERE ticker IN ('GLD', 'SLV', 'UNG', 'OIH', 'CL');
UPDATE theme_assets SET asset_class = 'rates'    WHERE ticker IN ('SVXY');
-- Anything still NULL falls into the 'other' bucket by the CHECK constraint default

COMMIT;
