-- ============================================================
-- Andromeda baseline schema capture
-- ============================================================
-- Migration-derived; not a live schema dump; deployed state
-- verified separately in schema.md.
-- Source files: supabase/migrations/00*.sql (11 files, in order).
-- ============================================================

-- ============================================================
-- Source migration: 001_initial_schema.sql
-- ============================================================
-- Enable RLS on all tables
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_signals_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_risk ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_output ENABLE ROW LEVEL SECURITY;

-- Public read policies (frontend anon key reads here)
CREATE POLICY "Public read" ON themes FOR SELECT TO anon USING (true);
CREATE POLICY "Public read" ON theme_assets FOR SELECT TO anon USING (true);
CREATE POLICY "Public read" ON theme_signals_history FOR SELECT TO anon USING (true);
CREATE POLICY "Public read" ON trade_candidates FOR SELECT TO anon USING (true);
CREATE POLICY "Public read" ON portfolio_positions FOR SELECT TO anon USING (true);
CREATE POLICY "Public read" ON portfolio_risk FOR SELECT TO anon USING (true);
CREATE POLICY "Public read" ON research_output FOR SELECT TO anon USING (true);

-- themes
CREATE TABLE themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL CHECK (tier IN ('anchor', 'discovered', 'review')),
    source TEXT NOT NULL CHECK (source IN ('practitioner', 'lda', 'embedding', 'both_agreement')),
    hype_score REAL,
    volume_score REAL,
    sentiment_score REAL,
    corr_score REAL,
    momentum_score REAL,
    discovered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- theme_assets
CREATE TABLE theme_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    run_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, ticker, run_date)
);

-- theme_signals_history
CREATE TABLE theme_signals_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    run_date DATE NOT NULL,
    mention_count_1d INTEGER,
    mention_count_7d_avg REAL,
    mention_count_7d_std REAL,
    avg_sentiment REAL,
    price_corr REAL,
    momentum_raw REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, run_date)
);

-- trade_candidates
CREATE TABLE trade_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    trade_score REAL,
    hype_score REAL,
    entry_thesis TEXT,
    risk_factors TEXT,
    timeframe TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, asset, direction)
);

-- portfolio_positions
CREATE TABLE portfolio_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    notional REAL NOT NULL,
    weight REAL NOT NULL,
    hype_score REAL,
    trade_score REAL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, asset, direction)
);

-- portfolio_risk
CREATE TABLE portfolio_risk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    total_capital REAL NOT NULL DEFAULT 100000000,
    var_95 REAL,
    cvar_95 REAL,
    sharpe REAL,
    beta REAL,
    concentration_hhi REAL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- portfolio_returns
CREATE TABLE portfolio_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    daily_return REAL,
    cumulative_return REAL,
    portfolio_value REAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- scoring_config
CREATE TABLE scoring_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    param_name TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- backtest_results
CREATE TABLE backtest_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    metric_name TEXT NOT NULL,
    predicted_value REAL,
    realized_value REAL,
    pass BOOLEAN,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- research_output
CREATE TABLE research_output (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_theme_signals_history_theme_date ON theme_signals_history(theme_id, run_date);
CREATE INDEX idx_theme_assets_theme_date ON theme_assets(theme_id, run_date);
CREATE INDEX idx_portfolio_returns_date ON portfolio_returns(run_date);

-- Insert default scoring_config
INSERT INTO scoring_config (param_name, value) VALUES
    ('hype_volume_weight', '0.30'),
    ('hype_sentiment_weight', '0.20'),
    ('hype_corr_weight', '0.30'),
    ('hype_momentum_weight', '0.20'),
    ('hype_score_threshold', '50'),
    ('lookback_momentum_1d', '1'),
    ('lookback_momentum_7d', '7'),
    ('sharpe_lookback', '252'),
    ('beta_lookback', '252'),
    ('var_confidence', '0.95'),
    ('trade_hype_weight', '0.55'),
    ('trade_sentiment_weight', '0.45'),
    ('total_capital', '100000000');

-- Insert Tier 1 macro anchors
INSERT INTO themes (name, tier, source) VALUES
    ('Fed Policy', 'anchor', 'practitioner'),
    ('Inflation', 'anchor', 'practitioner'),
    ('China Growth', 'anchor', 'practitioner'),
    ('US Dollar', 'anchor', 'practitioner'),
    ('Geopolitical Risk', 'anchor', 'practitioner'),
    ('Corporate Credit', 'anchor', 'practitioner'),
    ('Energy Prices', 'anchor', 'practitioner'),
    ('US Election', 'anchor', 'practitioner');

-- Insert Tier 1 asset mappings (practitioner-defined, versioned by run_date).
-- daily_refresh.py falls back to the most recent entry per theme if today's is empty.
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
ON t.name = v.theme_name
WHERE t.tier = 'anchor';

-- ============================================================
-- Source migration: 002_seed_sample_data.sql
-- ============================================================
-- Seed sample data for Phase 1: working frontend with sample data
-- Run this after 001_initial_schema.sql to populate the frontend with realistic-looking data.

-- Seed themes with sample scores (so the dashboard shows real numbers immediately)
UPDATE themes SET
  hype_score = CASE name
    WHEN 'Fed Policy'        THEN 72.3
    WHEN 'Inflation'         THEN 68.5
    WHEN 'China Growth'      THEN 55.1
    WHEN 'US Dollar'         THEN 61.8
    WHEN 'Geopolitical Risk' THEN 78.4
    WHEN 'Corporate Credit'  THEN 44.2
    WHEN 'Energy Prices'     THEN 59.7
    WHEN 'US Election'       THEN 82.1
  END,
  volume_score = 0.65,
  sentiment_score = 0.52,
  corr_score = 0.48,
  momentum_score = 0.55,
  updated_at = NOW()
WHERE tier = 'anchor';

-- Seed research_output with Q1 long/short rationale
INSERT INTO research_output (section, content) VALUES
('Framework', 'Systematic theme identification framework combining news sentiment, social media attention, and market correlation. Themes ranked by HypeScore (0-100). HypeScore = weighted composite of Volume (30%) + Sentiment (20%) + Market Correlation (30%) + Momentum (20%).')
ON CONFLICT (section) DO UPDATE SET content = EXCLUDED.content;

INSERT INTO research_output (section, content) VALUES
('Top 5 Long', E'1. US Election (82.1 HypeScore): Political uncertainty drives defensive positioning. ETFs: QQQ, XLV.\n2. Geopolitical Risk (78.4): Safe-haven demand for gold and long-duration Treasuries. ETFs: GLD, TLT.\n3. Fed Policy (72.3): Rate-cut expectations boosting rate-sensitive sectors. ETFs: TLT, GLD.\n4. Inflation (68.5): Persistent price pressures support real assets. ETFs: GLD, SLV, TIPS.\n5. China Growth (55.1): Policy stimulus expectations. ETFs: FXI, MCHI.')
ON CONFLICT (section) DO UPDATE SET content = EXCLUDED.content;

INSERT INTO research_output (section, content) VALUES
('Top 5 Short', E'1. Corporate Credit (44.2): Tight spreads signal crowded long positioning. ETFs: HYG, LQD.\n2. Energy Prices (59.7): OPEC+ supply management uncertain; momentum fading. ETFs: XLE, OIH.\n3. US Dollar (61.8): Fed pivot reducing dollar strength. ETFs: UUP, FXE.\n4. China Growth (55.1): Property crisis unresolved despite stimulus. ETFs: BABA, KWEB.\n5. Inflation (68.5): Long positioning crowded after CPI surprise. ETFs: TIPS, SLV.')
ON CONFLICT (section) DO UPDATE SET content = EXCLUDED.content;

-- ============================================================
-- Source migration: 003_add_scores_to_signals_history.sql
-- ============================================================
-- 003: add hype_score + trade_score to theme_signals_history
-- Required so daily_refresh.compute_trade_scores() can read yesterday's hype_score
-- for the HypeMomentum calculation: (Hype_today - Hype_yesterday) / Hype_yesterday.
--
-- Without these columns, HypeMomentum falls back to 0 (TradeScore becomes
-- sentiment-only, not full HypeMomentum + SentimentDirection).
--
-- Apply via Supabase dashboard SQL editor, or:
--   psql "postgresql://postgres:[PASSWORD]@db.xrvwyubzraxzqiizicsg.supabase.co:5432/postgres" -f 003_add_scores_to_signals_history.sql

ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS hype_score REAL,
    ADD COLUMN IF NOT EXISTS trade_score REAL;

-- ============================================================
-- Source migration: 004_bootstrap_live.sql
-- ============================================================
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

-- ============================================================
-- Source migration: 005_macro_indicators.sql
-- ============================================================
-- Phase 5 M1: L0 macro indicators table
-- Stores daily values of macroeconomic indicators ingested from FRED + yfinance

CREATE TABLE IF NOT EXISTS macro_indicators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id TEXT NOT NULL,
    series_name TEXT NOT NULL,
    value REAL,
    unit TEXT,
    fetch_date DATE NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(series_id, fetch_date)
);

ALTER TABLE macro_indicators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON macro_indicators FOR SELECT TO anon USING (true);

CREATE TABLE IF NOT EXISTS macro_daily_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id TEXT NOT NULL,
    value REAL,
    unit TEXT,
    trading_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(series_id, trading_date)
);

ALTER TABLE macro_daily_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON macro_daily_history FOR SELECT TO anon USING (true);

CREATE INDEX IF NOT EXISTS idx_macro_daily_series_date
    ON macro_daily_history(series_id, trading_date DESC);

COMMENT ON TABLE macro_indicators IS 'Latest-value snapshot per series (L0 output)';
COMMENT ON TABLE macro_daily_history IS 'Daily time-series for regime classification and backfill';

-- ============================================================
-- Source migration: 006_factor_exposures.sql
-- ============================================================
-- Phase 5 M2: Factor exposures, regime classifications, research tables
-- Rolling 252d FF5 + UMD betas per asset; L3 regime; research recommendations

CREATE TABLE IF NOT EXISTS factor_exposures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset TEXT NOT NULL,
    run_date DATE NOT NULL,
    beta_mkt REAL,
    beta_smb REAL,
    beta_hml REAL,
    beta_rmw REAL,
    beta_cma REAL,
    beta_umd REAL,
    r_squared REAL,
    alpha REAL,
    lookback_days INT DEFAULT 252,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(asset, run_date, lookback_days)
);

ALTER TABLE factor_exposures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON factor_exposures FOR SELECT TO anon USING (true);

CREATE TABLE IF NOT EXISTS regime_classifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    cycle TEXT NOT NULL CHECK (cycle IN ('early', 'mid', 'late', 'recession')),
    sentiment TEXT NOT NULL CHECK (sentiment IN ('risk-on', 'neutral', 'risk-off')),
    yield_curve_slope REAL,
    hy_oas REAL,
    vix_level REAL,
    vix_term_diff REAL,
    real_rate REAL,
    spx_breadth REAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE regime_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON regime_classifications FOR SELECT TO anon USING (true);

CREATE TABLE IF NOT EXISTS research_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    picks JSONB,
    book_view TEXT,
    book_risks JSONB,
    agent_run_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE research_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON research_recommendations FOR SELECT TO anon USING (true);

CREATE TABLE IF NOT EXISTS research_agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    prompt_version TEXT NOT NULL,
    model_id TEXT NOT NULL,
    input_snapshot JSONB,
    raw_output JSONB,
    citations JSONB,
    verified BOOLEAN DEFAULT false,
    retries INT DEFAULT 0,
    duration_ms INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE research_agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON research_agent_runs FOR SELECT TO anon USING (true);

COMMENT ON TABLE factor_exposures IS 'Rolling 252d FF5+UMD betas per asset (L2)';
COMMENT ON TABLE regime_classifications IS 'L3 rule-based regime (cycle x sentiment)';
COMMENT ON TABLE research_recommendations IS 'Top-5 L/S picks with thesis and risk (L6 output)';
COMMENT ON TABLE research_agent_runs IS 'Research agent run audit log (L5)';

-- ============================================================
-- Source migration: 007_seed_regime.sql
-- ============================================================
-- Seed regime classification for demo (today's date)
-- Will be overwritten by the live regime classifier on next pipeline run
INSERT INTO regime_classifications (
    run_date, cycle, sentiment,
    yield_curve_slope, hy_oas, vix_level, vix_term_diff, real_rate, spx_breadth
) VALUES (
    CURRENT_DATE,
    'mid',
    'neutral',
    20.0,
    320.0,
    18.5,
    -1.2,
    0.75,
    55.0
) ON CONFLICT (run_date) DO UPDATE SET
    cycle = EXCLUDED.cycle,
    sentiment = EXCLUDED.sentiment,
    yield_curve_slope = EXCLUDED.yield_curve_slope,
    hy_oas = EXCLUDED.hy_oas,
    vix_level = EXCLUDED.vix_level,
    vix_term_diff = EXCLUDED.vix_term_diff,
    real_rate = EXCLUDED.real_rate,
    spx_breadth = EXCLUDED.spx_breadth;

-- ============================================================
-- Source migration: 008_rename_q1_tables.sql
-- ============================================================
-- Rename Q1 tables to research_* to avoid @tasks test naming bleed
-- These tables were created in 006_factor_exposures.sql

ALTER TABLE q1_recommendations RENAME TO research_recommendations;
ALTER POLICY "Public read" ON research_recommendations RENAME TO "Public read research_recommendations";

ALTER TABLE q1_agent_runs RENAME TO research_agent_runs;
ALTER POLICY "Public read" ON research_agent_runs RENAME TO "Public read research_agent_runs";

-- ============================================================
-- Source migration: 009_asset_class_lens.sql
-- ============================================================
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

-- ============================================================
-- Source migration: 010_market_assets.sql
-- ============================================================
-- market_assets: latest equity index prices + % change for the homepage market bar
-- Updated daily by macro_fetcher.fetch_market_assets() in daily_refresh.py

CREATE TABLE IF NOT EXISTS market_assets (
    ticker     TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    current    REAL NOT NULL,
    prev_close REAL NOT NULL,
    pct_change REAL NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE market_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON market_assets FOR SELECT TO anon USING (true);

COMMENT ON TABLE market_assets IS
    'Latest equity index prices + daily % change for the homepage market bar.';

-- ============================================================
-- Source migration: 011_prediction_markets.sql
-- ============================================================
-- prediction_markets: top macro-relevant events from Polymarket
-- Updated daily by backend/data/polymarket_fetcher.py in daily_refresh.py

CREATE TABLE IF NOT EXISTS prediction_markets (
    slug         TEXT PRIMARY KEY,
    event_title  TEXT NOT NULL,
    category     TEXT NOT NULL,
    top_outcome  TEXT NOT NULL,
    top_price    REAL NOT NULL,
    outcomes     JSONB NOT NULL,
    prices       JSONB NOT NULL,
    volume       REAL NOT NULL,
    end_date     DATE,
    url          TEXT,
    fetched_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE prediction_markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON prediction_markets FOR SELECT TO anon USING (true);

COMMENT ON TABLE prediction_markets IS
    'Macro-relevant Polymarket events: Fed, rates, recession, oil, Bitcoin, geopolitics.';

