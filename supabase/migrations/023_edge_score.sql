-- 023_edge_score.sql
-- EdgeScore — a rigorous long/short direction signal (Stages 1–2: Trend + RegimeFit).
-- Direction was decided by sign(TradeScore), which collapsed to the sign of
-- near-zero VADER sentiment. EdgeScore anchors direction to measurable
-- expected-return proxies. See:
--   docs/superpowers/specs/2026-07-23-edge-score-direction-redesign.md
--   docs/adrs/0031-edge-score-direction-signal.md

-- Component provenance on the canonical per-theme signal store (rendered on
-- /method and the derivation drawer). Nullable — backfilled going forward.
ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS edge_score   REAL,
    ADD COLUMN IF NOT EXISTS trend_signal REAL,
    ADD COLUMN IF NOT EXISTS regime_bias  REAL;

-- Direction weights + abstention band, editable without code (project rule:
-- all weights live in scoring_config, not hardcoded). edge_abstain_threshold=0.0
-- means no abstention for Stages 1–2; Stage 4 raises it.
INSERT INTO scoring_config (param_name, value) VALUES
    ('edge_trend_weight',      '0.6'),
    ('edge_regime_weight',     '0.4'),
    ('edge_abstain_threshold', '0.0')
ON CONFLICT (param_name) DO NOTHING;
