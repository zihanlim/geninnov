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
