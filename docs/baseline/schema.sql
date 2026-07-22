-- Andromeda baseline schema capture
-- Remote INFORMATION_SCHEMA unavailable; migration-derived snapshot.
-- Deployed state not verified this session.

-- Source migration: 001_initial_schema.sql
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE theme_signals_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_risk ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_output ENABLE ROW LEVEL SECURITY;
CREATE TABLE themes (
CREATE TABLE theme_assets (
CREATE TABLE theme_signals_history (
CREATE TABLE trade_candidates (
CREATE TABLE portfolio_positions (
CREATE TABLE portfolio_risk (
CREATE TABLE portfolio_returns (
CREATE TABLE scoring_config (
CREATE TABLE backtest_results (
CREATE TABLE research_output (
CREATE INDEX idx_theme_signals_history_theme_date ON theme_signals_history(theme_id, run_date);
CREATE INDEX idx_theme_assets_theme_date ON theme_assets(theme_id, run_date);
CREATE INDEX idx_portfolio_returns_date ON portfolio_returns(run_date);

-- Source migration: 002_seed_sample_data.sql

-- Source migration: 003_add_scores_to_signals_history.sql
ALTER TABLE theme_signals_history
ADD COLUMN IF NOT EXISTS hype_score REAL,
ADD COLUMN IF NOT EXISTS trade_score REAL;

-- Source migration: 004_bootstrap_live.sql
ALTER TABLE theme_signals_history
ADD COLUMN IF NOT EXISTS hype_score REAL,
ADD COLUMN IF NOT EXISTS trade_score REAL;

-- Source migration: 005_macro_indicators.sql
CREATE TABLE IF NOT EXISTS macro_indicators (
ALTER TABLE macro_indicators ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS macro_daily_history (
ALTER TABLE macro_daily_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_macro_daily_series_date

-- Source migration: 006_factor_exposures.sql
CREATE TABLE IF NOT EXISTS factor_exposures (
ALTER TABLE factor_exposures ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS regime_classifications (
ALTER TABLE regime_classifications ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS research_recommendations (
ALTER TABLE research_recommendations ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS research_agent_runs (
ALTER TABLE research_agent_runs ENABLE ROW LEVEL SECURITY;

-- Source migration: 007_seed_regime.sql

-- Source migration: 008_rename_q1_tables.sql
ALTER TABLE q1_recommendations RENAME TO research_recommendations;
ALTER TABLE q1_agent_runs RENAME TO research_agent_runs;

-- Source migration: 009_asset_class_lens.sql
ALTER TABLE theme_assets
ADD COLUMN IF NOT EXISTS asset_class TEXT
CREATE INDEX IF NOT EXISTS idx_theme_assets_class

-- Source migration: 010_market_assets.sql
CREATE TABLE IF NOT EXISTS market_assets (
ALTER TABLE market_assets ENABLE ROW LEVEL SECURITY;

-- Source migration: 011_prediction_markets.sql
CREATE TABLE IF NOT EXISTS prediction_markets (
ALTER TABLE prediction_markets ENABLE ROW LEVEL SECURITY;

