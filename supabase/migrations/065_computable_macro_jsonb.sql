-- computable_macro: three derived metrics on regime_classifications.
--
-- ADR-0217 places the JPM-style ERP, equity-bond correlation, and NDX
-- seasonality analytics on regime_classifications rather than a new
-- table. The shape mirrors m052 (debasement, six columns) and m053
-- (fed posture, six columns) — a single computed reading with
-- provenance and a status (measured / insufficient_history / unknown,
-- per ADR-0098).
--
-- Why JSONB and not three flat columns: the three metrics are
-- independent (each has its own status), each has a different input
-- footprint (ERP needs an EPS, equity-bond needs SPX + DGS10 history,
-- NDX needs a multi-year monthly series), and a single JSONB column
-- keeps the L5 cite path uniform — `[regime_classifications:
-- computable_macro:<metric_key>]` for all three. A flat layout would
-- need three cite formats and a NULL pattern per metric, neither of
-- which is more readable.
--
-- The Python services in backend/services/{equity_risk_premium,
-- equity_bond_correlation, seasonality_analytics}.py are the source of
-- truth. A second SQL implementation of the math would silently drift
-- from the Python on the next threshold change; the migration
-- deliberately defines the column shape only. Backfill is
-- scripts/backfill_regime.py calling each service once per historical
-- run_date with the same as_of bound — same pattern as the existing
-- debasement and fed-posture backfills.

BEGIN;

ALTER TABLE regime_classifications
    ADD COLUMN IF NOT EXISTS computable_macro JSONB;

COMMENT ON COLUMN regime_classifications.computable_macro IS
    'Three derived macro analytics (ADR-0217): erp, equity_bond_corr,
    ndx_seasonality. Each entry is {value(s), status, reason, as_of}.
    Status follows ADR-0098: measured / insufficient_history / unknown.
    The Python services in backend/services/equity_risk_premium.py,
    equity_bond_correlation.py, seasonality_analytics.py are the source
    of truth — the column is populated by daily_refresh after L3.
    Citable as: [regime_classifications:computable_macro:<metric_key>]';

COMMIT;
