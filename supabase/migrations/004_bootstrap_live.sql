-- 004: live-bootstrap migration (idempotent)
-- Combines the two schema fixes daily_refresh.py needs to function against the
-- deployed Supabase project. Both pieces were committed earlier but never
-- applied to the live DB, so the live run produces 0 trade candidates and
-- 0 portfolio rows.
--
-- Apply via one of:
--   A) Supabase dashboard > SQL Editor > paste & run (recommended)
--   B) psql "postgresql://postgres:[DB_PASSWORD]@db.xrvwyubzraxzqiizicsg.supabase.co:5432/postgres" -f 004_bootstrap_live.sql
--
-- Idempotent: safe to re-run.

-- ─── Fix 1: add hype_score + trade_score to theme_signals_history ────────────
ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS hype_score REAL,
    ADD COLUMN IF NOT EXISTS trade_score REAL;

-- ─── Fix 2: seed Tier 1 asset mappings (29 rows) ────────────────────────────
-- The implementation plan's A2 task included this seed; the migration file
-- 001_initial_schema.sql was missing it.
INSERT INTO theme_assets (theme_id, ticker, weight, run_date)
SELECT t.id, v.ticker, 1.0, CURRENT_DATE
FROM themes t
CROSS JOIN LATERAL (VALUES
    ('Fed Policy',        'TLT'),
    ('Fed Policy',        'GLD'),
    ('Fed Policy',        'SVXY'),
    ('Fed Policy',        'DXY'),
    ('Inflation',         'GLD'),
    ('Inflation',         'SLV'),
    ('Inflation',         'TIPS'),
    ('China Growth',      'FXI'),
    ('China Growth',      'MCHI'),
    ('China Growth',      'BABA'),
    ('China Growth',      'KWEB'),
    ('US Dollar',         'UUP'),
    ('US Dollar',         'FXE'),
    ('US Dollar',         'GLD'),
    ('US Dollar',         'EWZ'),
    ('Geopolitical Risk', 'GLD'),
    ('Geopolitical Risk', 'TLT'),
    ('Geopolitical Risk', 'SLV'),
    ('Geopolitical Risk', 'EWJ'),
    ('Corporate Credit',  'HYG'),
    ('Corporate Credit',  'LQD'),
    ('Energy Prices',     'XLE'),
    ('Energy Prices',     'OIH'),
    ('Energy Prices',     'CL'),
    ('Energy Prices',     'UNG'),
    ('US Election',       'QQQ'),
    ('US Election',       'XLV'),
    ('US Election',       'XLF'),
    ('US Election',       'ARKK')
) AS v(theme_name, ticker)
WHERE t.name = v.theme_name AND t.tier = 'anchor'
ON CONFLICT (theme_id, ticker, run_date) DO NOTHING;
