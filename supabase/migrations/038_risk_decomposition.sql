-- 038_risk_decomposition.sql
--
-- Euler risk decomposition on the final sized book: ex-ante covariance volatility
-- and VaR that decompose by name (Σ contribution_to_vol = portfolio_vol, exactly).
-- Written by q1_agent.finalise_book_analytics -> _persist_to_supabase; source is
-- backend/services/risk_decomposition.decompose_risk. One JSONB column, not a table,
-- following 022_book_analytics_surface.sql — it is one more analytic on this row.
--
-- This is NOT the realised-series VaR in portfolio_risk.var_95. That one is built from
-- the book's own daily P&L; this one from 252 days of the constituents' covariance.
-- They answer different questions, disagree routinely, and must render with distinct
-- labels. See ADR (claimed at commit) and docs/handoff-euler-risk-decomposition.md.

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS risk_decomposition JSONB;

COMMENT ON COLUMN research_recommendations.risk_decomposition IS
    'Written by q1_agent._persist_to_supabase. Source: risk_decomposition.decompose_risk. '
    'Ex-ante covariance VaR — NOT the realised-series VaR in portfolio_risk.var_95.';
