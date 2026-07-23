-- 020_signal_provenance.sql
-- Record whether a theme's attention signal came from REAL data feeds or from
-- the mock fallback. Previously (RESIDUAL R0b) empty Reddit credentials made
-- fetch_posts_for_theme silently return an invented post that fed both the
-- mention-volume and VADER-sentiment terms of HypeScore — indistinguishable in
-- the schema from a genuine signal. This column makes the provenance explicit.
--
-- Written by scripts/daily_refresh.persist via _classify_data_source:
--   'real'  — all collected text came from live Brave/Reddit
--   'mock'  — all fallback
--   'mixed' — some of each
--   'none'  — nothing collected

BEGIN;

ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS data_source TEXT;

COMMENT ON COLUMN theme_signals_history.data_source IS
    'Provenance of the attention signal: real | mock | mixed | none. '
    'A mock/mixed HypeScore should be treated as estimated, not authoritative '
    '(see RESIDUAL R0b, daily_refresh._classify_data_source).';

COMMIT;
