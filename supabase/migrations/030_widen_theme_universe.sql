-- 030_widen_theme_universe.sql
--
-- Widen the tradeable universe from 24 tickers to 39 by giving each theme more
-- genuine expressions.
--
-- WHY: task.md Q1 asks for the "top five long and short trades". The book could
-- not reach five a side because the position count on a side is
-- (themes selected) x (that theme's mapped tickers), and most themes carried only
-- 2-4 expressions — so a side that selected one theme could only ever produce 2-4
-- names. This is the honest lever: it raises the ceiling without touching the
-- abstention band or the hype gate, so nothing enters the book that did not earn
-- its way in on conviction. (The alternative — letting sub-threshold themes fill
-- the book — was considered and rejected; see the note in trade_ranker._select.)
--
-- SAFETY: every ticker below is ALREADY present in all three classification maps
-- (SECTOR_MAP and GEO_MAP in backend/services/book_metrics.py, _ASSET_CLASS_MAP in
-- backend/services/trade_ranker.py). That matters: `is_classified` drops an
-- unmapped ticker silently, so adding a name the maps do not know would shrink the
-- book rather than grow it. All 15 were also confirmed to have ~251 daily closes
-- on yfinance, so Trend and vol are real rather than a silent 0.
--
-- No ticker is added to a theme that already carries it: load_theme_assets_map
-- unions across run_dates (newest first, capped at 20 per theme) and _expand emits
-- one candidate per (theme, ticker), so a duplicate would become a duplicate
-- position. A ticker MAY appear under several themes — GLD already does — since a
-- theme is a view, not an owner.

BEGIN;

INSERT INTO theme_assets (theme_id, ticker, weight, run_date)
SELECT t.id, v.ticker, 1.0, CURRENT_DATE
FROM themes t
CROSS JOIN LATERAL (VALUES
    -- Corporate Credit: 2 -> 6. Spread risk expressed across the credit stack —
    -- high yield, fallen angels, senior loans, EM sovereign.
    ('Corporate Credit',  'JNK'),
    ('Corporate Credit',  'ANGL'),
    ('Corporate Credit',  'BKLN'),
    ('Corporate Credit',  'EMB'),
    -- Fed Policy: 4 -> 8. The policy path is a curve view, so carry the belly,
    -- the front end, bills and the aggregate index alongside duration.
    ('Fed Policy',        'IEF'),
    ('Fed Policy',        'SHY'),
    ('Fed Policy',        'BIL'),
    ('Fed Policy',        'AGG'),
    -- Inflation: 3 -> 5. Real assets and the miners' operating leverage to them.
    ('Inflation',         'IAU'),
    ('Inflation',         'GDX'),
    -- Geopolitical Risk: 4 -> 6. Safe-haven metals plus DM ex-US equity beta.
    ('Geopolitical Risk', 'GDX'),
    ('Geopolitical Risk', 'EFA'),
    -- US Dollar: 4 -> 6. The dollar trades against EM assets most directly.
    ('US Dollar',         'EEM'),
    ('US Dollar',         'EMB'),
    -- US Election: 4 -> 6. Policy risk shows up in broad US beta and small caps.
    ('US Election',       'SPY'),
    ('US Election',       'IWM'),
    -- China Growth: 4 -> 5. China is the dominant weight in EM beta.
    ('China Growth',      'EEM')
) AS v(theme_name, ticker)
WHERE t.name = v.theme_name
  -- Idempotent: never re-add a (theme, ticker) that already exists at any run_date.
  AND NOT EXISTS (
      SELECT 1 FROM theme_assets ta
      WHERE ta.theme_id = t.id AND ta.ticker = v.ticker
  );

COMMIT;
