-- 031_replace_unpriceable_dxy.sql
--
-- Replace the untradeable, unpriceable ticker DXY with UUP in theme_assets.
--
-- DXY has been in the Fed Policy theme since the original bootstrap seed (004),
-- but it is not a valid yfinance symbol — it returns ZERO observations. The dollar
-- index trades as DX-Y.NYB (an index, not an instrument) and the tradeable proxy
-- is the UUP ETF. Every price fetch for DXY has therefore been failing quietly,
-- logging "$DXY: possibly delisted; no price data found" on every run, which meant
-- its Trend and vol were silently 0 — an EdgeScore component reading zero because
-- of a typo rather than because the market said so.
--
-- It stopped being quiet on 2026-07-24: once the universe widened (migration 030)
-- Fed Policy became the selected long theme, DXY entered the sized book, and
-- compute_and_persist_daily_return aborted the whole run rather than invent a
-- return for a position it could not price:
--   RuntimeError: daily return aborted for 2026-07-24: missing prices for ['DXY']
-- That guard did exactly the right thing — the fix belongs in the data, not the
-- guard.
--
-- UUP is already present in SECTOR_MAP, GEO_MAP and _ASSET_CLASS_MAP, so it
-- survives is_classified, and it carries a full price history. A dollar expression
-- is a legitimate way to hold a Fed-policy view, so the theme keeps its meaning.

BEGIN;

-- Only insert UUP where the theme does not already carry it (Fed Policy does not;
-- the US Dollar theme does, and must not gain a duplicate).
INSERT INTO theme_assets (theme_id, ticker, weight, run_date)
SELECT ta.theme_id, 'UUP', 1.0, CURRENT_DATE
FROM theme_assets ta
WHERE ta.ticker = 'DXY'
  AND NOT EXISTS (
      SELECT 1 FROM theme_assets x
      WHERE x.theme_id = ta.theme_id AND x.ticker = 'UUP'
  );

DELETE FROM theme_assets WHERE ticker = 'DXY';

COMMIT;
