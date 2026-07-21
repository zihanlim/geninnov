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
