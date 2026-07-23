-- 027_scoring_config_public_read.sql
--
-- Grant the frontend anon key read-only access to scoring_config.
--
-- 001_initial_schema enabled RLS and a "Public read" policy on the seven
-- display tables (themes, theme_assets, theme_signals_history, trade_candidates,
-- portfolio_positions, portfolio_risk, research_output) but never did the same
-- for scoring_config — even though it seeds the table and every later migration
-- (023/024/026) inserts weights into it. Under RLS default-deny the anon key
-- therefore reads scoring_config as an empty set, so the /method page's three
-- formula panels (HypeScore, TradeScore, EdgeScore) all render "NO ROWS —
-- scoring_config" instead of the live weights. The backend reads it fine because
-- it connects with the service_role key, which bypasses RLS.
--
-- Weights are configuration, not secrets (they are also documented in the ADRs
-- and mirrored as frontend defaults), so a public read policy is appropriate and
-- mirrors the 001 policies exactly: read-only, anon, USING (true). Writes remain
-- restricted to the service_role (migrations + the backend pipeline).

ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON scoring_config;
CREATE POLICY "Public read" ON scoring_config FOR SELECT TO anon USING (true);
