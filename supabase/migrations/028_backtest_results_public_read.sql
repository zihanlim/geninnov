-- 028_backtest_results_public_read.sql
--
-- Grant the frontend anon key read-only access to backtest_results so /method can
-- show the honest signal-validation status (HypeScore IC / decay, EdgeScore IC).
--
-- Same gap as scoring_config (ADR-0034): the table is written by the backtest
-- harnesses via the service_role key, but had no anon SELECT policy, so under RLS
-- default-deny the frontend read it as an empty set. Validation results are not
-- secrets — surfacing them is the whole point (the platform should say plainly
-- what is validated vs merely asserted). Read-only for anon; writes stay
-- service_role-only (the harnesses).

ALTER TABLE backtest_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON backtest_results;
CREATE POLICY "Public read" ON backtest_results FOR SELECT TO anon USING (true);
