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
