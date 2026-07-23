-- 019_crowding_signal.sql
-- Preserve the SIGN of the theme↔market correlation and expose a crowding
-- label. HypeScore folds correlation via abs() (ADR-0006) because attention is
-- direction-agnostic — but the sign is the whole point for trade/risk use:
-- a high-attention theme co-moving positively with the market is a *crowded*
-- consensus (mean-reversion risk); an inverse mover is a natural hedge.
--
-- theme_signals_history already stores the raw signed price_corr; these columns
-- add the derived crowding read-model. Written by scripts/daily_refresh.persist
-- via backend.services.hype_calculator.crowding_label.

BEGIN;

ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS signed_corr REAL;

ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS crowding TEXT;   -- 'crowded' | 'hedge' | 'neutral'

COMMENT ON COLUMN theme_signals_history.signed_corr IS
    'Signed theme↔market correlation (crowding preserves the sign HypeScore '
    'folds via abs()). See hype_calculator.crowding_score.';
COMMENT ON COLUMN theme_signals_history.crowding IS
    'Crowding label: crowded (consensus co-move) / hedge (inverse) / neutral. '
    'See hype_calculator.crowding_label.';

COMMIT;
