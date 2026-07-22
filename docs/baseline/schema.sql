-- ============================================================
-- Andromeda baseline schema capture
-- ============================================================
-- Migration-derived DDL only. Statements are extracted from
-- supabase/migrations/*.sql in order. This file contains the
-- structural schema statements (CREATE / ALTER / RENAME / RLS /
-- POLICY / COMMENT) only. It excludes seed DML (INSERT/UPDATE/
-- DELETE), transaction control (BEGIN/COMMIT/ROLLBACK), and
-- ad-hoc SELECT/EXPLAIN blocks. Read top-to-bottom for a
-- migration-ordered schema reference. Deployed-state evidence
-- is recorded in schema.md.
-- ============================================================


-- ============================================================
-- Source migration: 001_initial_schema.sql
-- ============================================================
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;

ALTER TABLE theme_assets ENABLE ROW LEVEL SECURITY;

ALTER TABLE theme_signals_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE trade_candidates ENABLE ROW LEVEL SECURITY;

ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;

ALTER TABLE portfolio_risk ENABLE ROW LEVEL SECURITY;

ALTER TABLE research_output ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON themes FOR SELECT TO anon USING (true);

CREATE POLICY "Public read" ON theme_assets FOR SELECT TO anon USING (true);

CREATE POLICY "Public read" ON theme_signals_history FOR SELECT TO anon USING (true);

CREATE POLICY "Public read" ON trade_candidates FOR SELECT TO anon USING (true);

CREATE POLICY "Public read" ON portfolio_positions FOR SELECT TO anon USING (true);

CREATE POLICY "Public read" ON portfolio_risk FOR SELECT TO anon USING (true);

CREATE POLICY "Public read" ON research_output FOR SELECT TO anon USING (true);

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

CREATE TABLE theme_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    run_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(theme_id, ticker, run_date)
);

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

CREATE TABLE portfolio_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    daily_return REAL,
    cumulative_return REAL,
    portfolio_value REAL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE scoring_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    param_name TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE research_output (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_theme_signals_history_theme_date ON theme_signals_history(theme_id, run_date);

CREATE INDEX idx_theme_assets_theme_date ON theme_assets(theme_id, run_date);

CREATE INDEX idx_portfolio_returns_date ON portfolio_returns(run_date);

-- (kept 27 DDL statement(s); dropped 3 DML, 0 control, 0 select, 0 other from 001_initial_schema.sql)

-- ============================================================
-- Source migration: 002_seed_sample_data.sql
-- ============================================================
-- (kept 0 DDL statement(s); dropped 4 DML, 0 control, 0 select, 0 other from 002_seed_sample_data.sql)

-- ============================================================
-- Source migration: 003_add_scores_to_signals_history.sql
-- ============================================================
ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS hype_score REAL,
    ADD COLUMN IF NOT EXISTS trade_score REAL;

-- (kept 1 DDL statement(s); dropped 0 DML, 0 control, 0 select, 0 other from 003_add_scores_to_signals_history.sql)

-- ============================================================
-- Source migration: 004_bootstrap_live.sql
-- ============================================================
ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS hype_score REAL,
    ADD COLUMN IF NOT EXISTS trade_score REAL;

-- (kept 1 DDL statement(s); dropped 1 DML, 0 control, 0 select, 0 other from 004_bootstrap_live.sql)

-- ============================================================
-- Source migration: 005_macro_indicators.sql
-- ============================================================
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

-- (kept 9 DDL statement(s); dropped 0 DML, 0 control, 0 select, 0 other from 005_macro_indicators.sql)

-- ============================================================
-- Source migration: 006_factor_exposures.sql
-- ============================================================
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

-- (kept 16 DDL statement(s); dropped 0 DML, 0 control, 0 select, 0 other from 006_factor_exposures.sql)

-- ============================================================
-- Source migration: 007_seed_regime.sql
-- ============================================================
-- (kept 0 DDL statement(s); dropped 1 DML, 0 control, 0 select, 0 other from 007_seed_regime.sql)

-- ============================================================
-- Source migration: 008_rename_q1_tables.sql
-- ============================================================
ALTER TABLE q1_recommendations RENAME TO research_recommendations;

ALTER TABLE q1_agent_runs RENAME TO research_agent_runs;

-- (kept 2 DDL statement(s); dropped 0 DML, 0 control, 0 select, 2 other from 008_rename_q1_tables.sql)

-- ============================================================
-- Source migration: 009_asset_class_lens.sql
-- ============================================================
ALTER TABLE theme_assets
    ADD COLUMN IF NOT EXISTS asset_class TEXT
    CHECK (asset_class IN ('rates', 'credit', 'equity', 'fx', 'commodity', 'crypto', 'other'));

CREATE INDEX IF NOT EXISTS idx_theme_assets_class
    ON theme_assets(asset_class);

-- (kept 2 DDL statement(s); dropped 6 DML, 2 control, 0 select, 0 other from 009_asset_class_lens.sql)

-- ============================================================
-- Source migration: 010_market_assets.sql
-- ============================================================
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

-- (kept 4 DDL statement(s); dropped 0 DML, 0 control, 0 select, 0 other from 010_market_assets.sql)

-- ============================================================
-- Source migration: 011_prediction_markets.sql
-- ============================================================
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

-- (kept 4 DDL statement(s); dropped 0 DML, 0 control, 0 select, 0 other from 011_prediction_markets.sql)
