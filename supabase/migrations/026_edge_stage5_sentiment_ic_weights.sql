-- 026_edge_stage5_sentiment_ic_weights.sql
-- EdgeScore Stage 5 (ADR-0033): sentiment demoted to a minor CONTRARIAN 5th
-- component, and the component weights set from a multi-component IC backtest
-- (scripts/backtest_edge.py) instead of assertion.
--   Carry earned a STRONG, significant IC (+0.277, t=2.77, p=0.007, 60.6% hit)
--   Trend a WEAK one (+0.033, p=0.30); Value modest (+0.094). Regime + Sentiment
--   are not IC-testable yet (thin per-theme history) and keep priors.
-- Weights are shrunk 50% toward priors so weak/thin IC cannot overfit.

ALTER TABLE theme_signals_history ADD COLUMN IF NOT EXISTS sentiment_signal REAL;
ALTER TABLE portfolio_positions   ADD COLUMN IF NOT EXISTS sentiment_signal REAL;
ALTER TABLE trade_candidates      ADD COLUMN IF NOT EXISTS sentiment_signal REAL;

INSERT INTO scoring_config (param_name, value) VALUES
    ('edge_trend_weight',     '0.20'),   -- was 0.35 (weak IC)
    ('edge_regime_weight',    '0.23'),   -- prior (not IC-testable yet)
    ('edge_carry_weight',     '0.34'),   -- was 0.20 (strong significant IC)
    ('edge_value_weight',     '0.18'),   -- was 0.20 (modest IC)
    ('edge_sentiment_weight', '0.05')    -- new: minor contrarian tilt
ON CONFLICT (param_name) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
