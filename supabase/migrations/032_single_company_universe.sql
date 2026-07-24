-- 032_single_company_universe.sql
--
-- Add SINGLE COMPANIES to the tradeable universe.
--
-- task.md asks for trades "across any asset class and/or single companies", and the
-- universe had none — it was 37 ETFs and futures proxies. Until ADR-0038 that gap
-- did not matter much, because direction was a THEME property and every asset in a
-- theme inherited it: a single name added to a rising theme would have been marked
-- long regardless of its own signal, exactly like the extra ETFs before it.
--
-- Direction is now per-asset (ADR-0038) and scope is chosen by attention rather than
-- by the theme's average edge (ADR-0039), so a company can genuinely oppose its own
-- theme. That is what makes single names worth adding, and it is why this migration
-- comes now rather than earlier.
--
-- It matters for the SHORT side specifically. On 2026-07-24 the L1 pool held 14 long
-- and only 4 SHORT candidates, so L5 filled its long side to the cap (5 of 5) and
-- could only find 2 shorts. Macro ETFs in one regime are directionally correlated by
-- construction; single names carry idiosyncratic dispersion. The 6-month returns of
-- the names below range from NEM -21.8% to CAT-like +34%, and they disagree INSIDE a
-- theme — the three defence primes span LMT -3.1%, RTX +7.3%, NOC -19.8%.
--
-- Every ticker here was checked for ~251 daily closes before being added; an asset
-- with no price history scores Trend 0 and enters the book on a silent zero, which
-- is how DXY got in (migration 031). Each is also present in SECTOR_MAP, GEO_MAP and
-- _ASSET_CLASS_MAP, or is_classified drops it without a word.
--
-- Names are mapped to the theme they genuinely express, NOT chosen to manufacture
-- shorts. Whether any of them ends up short is the signal's decision.

BEGIN;

INSERT INTO theme_assets (theme_id, ticker, weight, run_date)
SELECT t.id, v.ticker, 1.0, CURRENT_DATE
FROM (VALUES
    ('Fed Policy', 'JPM'),
    ('Fed Policy', 'GS'),
    ('Energy Prices', 'XOM'),
    ('Energy Prices', 'CVX'),
    ('Energy Prices', 'SLB'),
    ('US Election', 'UNH'),
    ('Geopolitical Risk', 'LMT'),
    ('Geopolitical Risk', 'NOC'),
    ('Geopolitical Risk', 'RTX'),
    ('Corporate Credit', 'F'),
    ('China Growth', 'JD'),
    ('China Growth', 'PDD'),
    ('Inflation', 'FCX'),
    ('Inflation', 'NEM'),
    ('Inflation', 'NUE')
) AS v(theme_name, ticker)
JOIN themes t ON t.name = v.theme_name
WHERE NOT EXISTS (
    SELECT 1 FROM theme_assets x WHERE x.theme_id = t.id AND x.ticker = v.ticker
);

COMMIT;
