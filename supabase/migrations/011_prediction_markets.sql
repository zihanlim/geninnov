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
