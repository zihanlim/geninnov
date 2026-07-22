-- 013_derivations.sql
-- Adds JSONB derivation columns for audit-grade provenance on the L5/L6
-- per-position and per-recommendation outputs.
--
-- Note: portfolio_risk.numeric_derivations is added by 015_risk_derivations.sql
-- (T9 fix). This migration intentionally does NOT add it again to avoid a
-- duplicate ALTER; see T19 brief.

BEGIN;

ALTER TABLE portfolio_positions
    ADD COLUMN IF NOT EXISTS numeric_derivations JSONB;

COMMENT ON COLUMN portfolio_positions.numeric_derivations IS
    'Per-position NumericDerivation bundle (weight, notional, beta, sector, '
    'geo, etc.) — see backend.services.book_metrics / risk_engine.';

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS advisory_derivation JSONB;

COMMENT ON COLUMN research_recommendations.advisory_derivation IS
    'Per-recommendation AdvisoryDerivation bundle produced by the L5 Q1 '
    'reasoning agent — see backend.services.q1_agent. T18 owns writes; '
    'T19 only creates the column.';

COMMIT;
