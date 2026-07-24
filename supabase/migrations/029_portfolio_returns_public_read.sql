-- 029_portfolio_returns_public_read.sql
--
-- Grant the frontend anon key read-only access to portfolio_returns.
--
-- Found by the "dark machinery" audit: portfolio_returns is read by the Risk
-- page (drawdown + daily-P&L chart, DailyPLHistory) and CumulativeReturn, but had
-- no anon SELECT policy — so under RLS default-deny the frontend read it as an
-- empty set while its sibling tables (portfolio_risk, portfolio_positions,
-- portfolio_cumulative_return) are all anon-readable. The daily-P&L / drawdown
-- chart therefore showed no data even though the pipeline persists rows. Same
-- class of gap as scoring_config (ADR-0034) and backtest_results (migration 028).
-- Read-only for anon; writes stay service_role-only (the daily pipeline).

ALTER TABLE portfolio_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON portfolio_returns;
CREATE POLICY "Public read" ON portfolio_returns FOR SELECT TO anon USING (true);
