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
