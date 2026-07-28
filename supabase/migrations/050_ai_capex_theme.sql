-- 050_ai_capex_theme.sql
--
-- Promote AI Capex from a phrase the tracker can see to a theme the book can
-- trade (ADR-0129).
--
-- WHY NOW: ADR-0128 built the narrative tracker precisely so a narrative nobody
-- named in advance could be seen. Measured on the live 455-document corpus, AI
-- appears in exactly TWO documents — "Goldman Offers Way to Trade AI Junk Bonds
-- $250 Million at a Time" and "Bond market anxiety is growing over AI capex
-- budgets" — and BOTH arrived through the Corporate Credit keyword query rather
-- than on their own. That is the circularity ADR-0128 describes, caught in the
-- act: the largest capex cycle in the market was reaching this system only as a
-- side-effect of asking about junk bonds.
--
-- Seeing it was the tracker's job and it did it. Making it TRADEABLE needs mapped
-- instruments and that step is deliberately not automated (ADR-0128) — a phrase
-- has no asset class, no price history and no correlation. This migration is that
-- step, performed by hand and argued for in ADR-0129.
--
-- SAFETY, following migration 030's precedent exactly:
--   * every ticker below is already in `book_metrics.ASSETS`, so all three derived
--     taxonomy maps carry it (ADR-0125) and `is_classified` cannot silently drop it;
--   * every ticker was confirmed to have 275 daily closes on yfinance, so Trend,
--     vol and the per-class correlation are real rather than a silent 0;
--   * `asset_class` is set on every inserted row, or the lens filter (ADR-0015)
--     would exclude them all;
--   * the insert is idempotent — it never re-adds a (theme, ticker) pair that
--     exists at any run_date, because `load_theme_assets_map` unions across
--     run_dates and a duplicate would become a duplicate POSITION.

BEGIN;

-- ─── 1. The theme ────────────────────────────────────────────────────────────
-- tier 'anchor' / source 'practitioner': this is a hand-authored theme like the
-- other eight, NOT a promoted `discovered_themes` row. The tracker supplied the
-- evidence; a human supplied the instrument map, and the provenance should say
-- which of those happened rather than implying the pipeline promoted itself.
INSERT INTO themes (name, tier, source)
VALUES ('AI Capex', 'anchor', 'practitioner')
ON CONFLICT (name) DO NOTHING;

-- ─── 2. The instrument map ───────────────────────────────────────────────────
-- Deliberately spans FOUR asset classes. Since ADR-0127 the correlation
-- sub-score is the mean over measured asset classes, so a theme mapped only to
-- equities can score at most its equity leg — and more importantly, a theme that
-- only holds equities cannot express the transmission that makes AI capex a
-- market theme rather than a sector call:
--
--   equity    — the chain itself: compute, the spenders, power, electrical plant
--   credit    — how the buildout is FUNDED. This is what the live headlines are
--               actually about, and it is the leg Andromeda's mandate lens sees
--   rates     — capex funded by issuance is duration supply
--   commodity — natural gas is what the datacenters actually burn
--
-- FCX, JNK, IEF and UNG are ALREADY mapped to other themes and are re-used here
-- rather than duplicated in the taxonomy. That is intended: migration 030
-- records the rule — "a ticker MAY appear under several themes, since a theme is
-- a view, not an owner". Direction is decided per ASSET by EdgeScore (ADR-0038),
-- so the same instrument can be long under one theme and short under another.
INSERT INTO theme_assets (theme_id, ticker, weight, run_date, asset_class)
SELECT t.id, v.ticker, 1.0, CURRENT_DATE, v.asset_class
FROM themes t
CROSS JOIN LATERAL (VALUES
    -- Compute: what the money is spent ON.
    ('SMH',   'equity'),
    ('NVDA',  'equity'),
    -- Manufacture: where it is physically made. Its own geo bucket, so the
    -- concentration is visible to the geo cap instead of netting inside EM.
    ('TSM',   'equity'),
    -- The spenders: the capex budgets the bond market is anxious about.
    ('MSFT',  'equity'),
    ('GOOGL', 'equity'),
    -- Power: the binding physical constraint on the buildout.
    ('VST',   'equity'),
    ('XLU',   'equity'),
    -- Electrical plant: turbines, and the cooling/power distribution inside the
    -- datacenter.
    ('GEV',   'equity'),
    ('VRT',   'equity'),
    -- Copper: the grid and datacenter buildout is metal-intensive.
    ('FCX',   'equity'),
    -- Funding: "Goldman Offers Way to Trade AI Junk Bonds". The credit leg is
    -- not decoration here, it is where the live evidence came from.
    ('JNK',   'credit'),
    -- Duration: capex funded by issuance is supply into the belly.
    ('IEF',   'rates'),
    -- Natural gas: what the marginal datacenter megawatt actually burns.
    ('UNG',   'commodity')
) AS v(ticker, asset_class)
WHERE t.name = 'AI Capex'
  AND NOT EXISTS (
      SELECT 1 FROM theme_assets ta
      WHERE ta.theme_id = t.id AND ta.ticker = v.ticker
  );

-- ─── 3. Backfill asset_class for the new tickers on any other theme ─────────
-- Migration 009 backfilled `asset_class` from a fixed ticker list and every
-- ticker added since has had to set it explicitly. A NULL here is not cosmetic:
-- the lens filter (ADR-0015) selects ON this column, so a NULL row is invisible
-- to every lens including `multi_asset`.
UPDATE theme_assets SET asset_class = 'equity'
 WHERE ticker IN ('SMH','NVDA','TSM','MSFT','GOOGL','VST','XLU','GEV','VRT')
   AND asset_class IS DISTINCT FROM 'equity';

COMMIT;
