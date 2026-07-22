-- 015_risk_derivations.sql
-- Adds numeric_derivations JSONB column on portfolio_risk.
-- Stores the full NumericDerivation bundle (field_id / display_status / value /
-- unit / method_id / source_records / freshness / uncertainty) returned by
-- compute_risk() so the L6 frontend can surface provenance per metric.
-- T19 will rename this column to `risk_derivations` later; the task-9 fix
-- writes through the column name `numeric_derivations` to match the brief.

BEGIN;

ALTER TABLE portfolio_risk
    ADD COLUMN IF NOT EXISTS numeric_derivations JSONB;

COMMENT ON COLUMN portfolio_risk.numeric_derivations IS
    'Full L4 NumericDerivation bundle (var_95, cvar_95, sharpe, beta, hhi) — '
    'see backend.services.risk_engine.compute_risk().';

COMMIT;
