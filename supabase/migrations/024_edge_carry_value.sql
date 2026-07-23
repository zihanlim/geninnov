-- 024_edge_carry_value.sql
-- EdgeScore Stages 3–4: Carry + Value + abstention + conviction sizing.
-- See docs/adrs/0032-edge-carry-value-abstention-sizing.md and
--     docs/superpowers/specs/2026-07-23-edge-score-direction-redesign.md

-- Component provenance for the two new signals + the conviction used for sizing.
ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS carry_signal REAL,
    ADD COLUMN IF NOT EXISTS value_signal REAL,
    ADD COLUMN IF NOT EXISTS conviction   REAL;

-- Rebalance the composite from 2 components (0.6/0.4) to 4, and turn ON the
-- abstention band (|EdgeScore| < 0.15 -> no position). UPSERT because 023 already
-- seeded the trend/regime/threshold rows.
INSERT INTO scoring_config (param_name, value) VALUES
    ('edge_trend_weight',      '0.35'),
    ('edge_regime_weight',     '0.25'),
    ('edge_carry_weight',      '0.20'),
    ('edge_value_weight',      '0.20'),
    ('edge_abstain_threshold', '0.15')
ON CONFLICT (param_name) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
