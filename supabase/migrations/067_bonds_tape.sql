-- 067_bonds_tape.sql
-- market_assets: seed the Bonds tape group (RIBBON_GROUPS."Bonds" in
-- backend/data/macro_fetcher.py) from the daily history the L0 fetcher already
-- writes.
--
-- The 11 points are all FRED series ids: DGS2/5/10/30 are part of FRED_SERIES
-- (the L0 macro set), DGS1MO/3MO/6MO/1/3/7/20 are BOND_SERIES (tape-only —
-- fetched daily, persisted to macro_daily_history, never written to
-- macro_indicators). Their rows in macro_daily_history exist whenever a
-- FRED_API_KEY is configured — the same dependency the yield-curve
-- classification already has. market_assets rows are what make a tab appear on
-- the homepage tape at all: without this seed the Bonds tab would render
-- nothing until the first nightly run after deploy; with it, the tab is live
-- immediately and `fetch_market_assets` upserts over these rows on the next run
-- like every other tape row.
--
-- Idempotent and guarded: ON CONFLICT (ticker) DO NOTHING, and a series with
-- fewer than two non-null closes contributes no row, so applying this against a
-- database without FRED history cannot fail a NOT NULL column — it simply seeds
-- nothing, and the tab appears once data flows.
--
-- macro_daily_history.value is real (float4), which has no round(real,
-- integer) — the ::numeric casts make the 2dp rounding and the pct_change
-- division exact where the column type would not (verified live 2026-08-01:
-- round(real, 2) raises "function round(real, integer) does not exist").

INSERT INTO market_assets (ticker, name, current, prev_close, pct_change, market_group, sort_order, as_of, updated_at)
SELECT
    ranked.series_id,
    curve.name,
    ROUND(MAX(CASE WHEN ranked.rn = 1 THEN ranked.value END), 2) AS current,
    ROUND(MAX(CASE WHEN ranked.rn = 2 THEN ranked.value END), 2) AS prev_close,
    ROUND(
        (MAX(CASE WHEN ranked.rn = 1 THEN ranked.value END)
         - MAX(CASE WHEN ranked.rn = 2 THEN ranked.value END))
        / NULLIF(MAX(CASE WHEN ranked.rn = 2 THEN ranked.value END), 0) * 100,
        2
    ) AS pct_change,
    'Bonds' AS market_group,
    curve.sort_order,
    MAX(CASE WHEN ranked.rn = 1 THEN ranked.trading_date END) AS as_of,
    NOW() AS updated_at
FROM (
    SELECT
        series_id,
        value::numeric AS value,
        trading_date,
        ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY trading_date DESC) AS rn
    FROM macro_daily_history
    WHERE series_id IN (
        'DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3',
        'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30'
    )
) ranked
JOIN (
    VALUES
        ('DGS1MO', 'US 1M', 0),
        ('DGS3MO', 'US 3M', 1),
        ('DGS6MO', 'US 6M', 2),
        ('DGS1',   'US 1Y', 3),
        ('DGS2',   'US 2Y', 4),
        ('DGS3',   'US 3Y', 5),
        ('DGS5',   'US 5Y', 6),
        ('DGS7',   'US 7Y', 7),
        ('DGS10',  'US 10Y', 8),
        ('DGS20',  'US 20Y', 9),
        ('DGS30',  'US 30Y', 10)
) AS curve(series_id, name, sort_order) ON curve.series_id = ranked.series_id
WHERE ranked.rn <= 2
GROUP BY ranked.series_id, curve.name, curve.sort_order
HAVING
    MAX(CASE WHEN ranked.rn = 1 THEN ranked.value END) IS NOT NULL
    AND MAX(CASE WHEN ranked.rn = 2 THEN ranked.value END) IS NOT NULL
ON CONFLICT (ticker) DO NOTHING;

COMMENT ON COLUMN market_assets.market_group IS
    'Tape group the ticker belongs to: US | Bonds | Europe | Asia | Currencies | Crypto | Futures. Written from RIBBON_GROUPS in backend/data/macro_fetcher.py, which is the single source of both membership and order.';
