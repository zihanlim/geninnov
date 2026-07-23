-- 018_theme_news.sql
-- Persist the raw headlines/posts collected per theme per run so the L5 Q1
-- reasoning agent can reason over ACTUAL news. Previously
-- q1_agent.aggregate_context hardcoded news_headlines=[] and classify_news was
-- a no-op, so reason_picks only ever saw the macro snapshot + theme table.
--
-- One row per (theme, run_date, headline). Written by
-- scripts/daily_refresh.persist_theme_news; read by
-- backend.services.q1_agent._load_recent_headlines.

BEGIN;

CREATE TABLE IF NOT EXISTS theme_news (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    run_date DATE NOT NULL,
    source TEXT NOT NULL,            -- 'brave' | 'reddit' | 'mock_brave' | 'mock_reddit'
    headline TEXT NOT NULL,
    published_date DATE,
    sentiment REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (theme_id, run_date, headline)
);

CREATE INDEX IF NOT EXISTS theme_news_run_date_idx ON theme_news (run_date DESC);

ALTER TABLE theme_news ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read theme_news" ON theme_news;
CREATE POLICY "Public read theme_news" ON theme_news FOR SELECT TO anon USING (true);

COMMENT ON TABLE theme_news IS
    'Raw collected headlines/posts per theme per run. Feeds the L5 agent''s '
    'classify_news + reason_picks nodes (see q1_agent._load_recent_headlines).';

COMMIT;
