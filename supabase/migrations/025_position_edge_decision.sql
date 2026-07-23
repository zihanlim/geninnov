-- 025_position_edge_decision.sql
-- Persist the EdgeScore DECISION BLOCK on positions + candidates so the frontend
-- can show the real 4-component direction (Trend/RegimeFit/Carry/Value) and the
-- conviction × inverse-vol sizing (ADR-0031/0032) — instead of the superseded
-- 2-component / HypeScore view it renders today. See:
--   docs/superpowers/specs/2026-07-23-andromeda-decision-cockpit-redesign.md

ALTER TABLE portfolio_positions
    ADD COLUMN IF NOT EXISTS edge_score   REAL,
    ADD COLUMN IF NOT EXISTS trend_signal REAL,
    ADD COLUMN IF NOT EXISTS regime_bias  REAL,
    ADD COLUMN IF NOT EXISTS carry_signal REAL,
    ADD COLUMN IF NOT EXISTS value_signal REAL,
    ADD COLUMN IF NOT EXISTS conviction   REAL,
    ADD COLUMN IF NOT EXISTS vol          REAL;

ALTER TABLE trade_candidates
    ADD COLUMN IF NOT EXISTS edge_score   REAL,
    ADD COLUMN IF NOT EXISTS trend_signal REAL,
    ADD COLUMN IF NOT EXISTS regime_bias  REAL,
    ADD COLUMN IF NOT EXISTS carry_signal REAL,
    ADD COLUMN IF NOT EXISTS value_signal REAL,
    ADD COLUMN IF NOT EXISTS conviction   REAL,
    ADD COLUMN IF NOT EXISTS vol          REAL;

-- vol completes the per-theme conviction story on the signal store (edge_score +
-- the 4 components + conviction already landed in migrations 023–024).
ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS vol REAL;
