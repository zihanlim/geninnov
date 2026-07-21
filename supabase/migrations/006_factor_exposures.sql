-- Phase 5 M2: Factor exposures, regime classifications, Q1 tables
-- Rolling 252d FF5 + UMD betas per asset; L3 regime; Q1 recommendations

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

CREATE TABLE IF NOT EXISTS q1_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    picks JSONB,
    book_view TEXT,
    book_risks JSONB,
    agent_run_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE q1_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON q1_recommendations FOR SELECT TO anon USING (true);

CREATE TABLE IF NOT EXISTS q1_agent_runs (
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

ALTER TABLE q1_agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON q1_agent_runs FOR SELECT TO anon USING (true);

COMMENT ON TABLE factor_exposures IS 'Rolling 252d FF5+UMD betas per asset (L2)';
COMMENT ON TABLE regime_classifications IS 'L3 rule-based regime (cycle x sentiment)';
COMMENT ON TABLE q1_recommendations IS 'Q1 top-5 L/S picks with thesis (L6 output)';
COMMENT ON TABLE q1_agent_runs IS 'Q1 agent run audit log (L5)';
