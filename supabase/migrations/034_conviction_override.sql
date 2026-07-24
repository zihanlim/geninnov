-- 034_conviction_override.sql — ADR-0046
--
-- The attention gate (HypeScore >= hype_score_threshold) was deciding what is
-- TRADABLE, not just what is interesting. Measured on 2026-07-24: four of eight
-- themes cleared the gate and the other four were never expanded into candidates
-- at all — including China Growth at theme edge -0.264, the most negative signal
-- on the board and the only decisively short THEME in the system, excluded for
-- being 3.3 HypeScore points quiet. The book's three shorts were all taken out of
-- themes whose own edge is POSITIVE, while the actual short theme was invisible.
--
-- edge_conviction_override is the |asset EdgeScore| at which a theme below the
-- attention gate is expanded anyway. It is STRICTLY ABOVE edge_abstain_threshold
-- (0.15) by design — this is a second, stricter door, not a relaxed first one. A
-- name has to be decisive to earn a look its theme's attention did not, and every
-- admitted candidate still has to clear the abstention band on its own edge.
--
-- Set to 0 to disable the override and restore pre-ADR-0046 behaviour.

-- scoring_config is (param_name, value text) only — no description column, so the
-- rationale lives here and in the ADR rather than in the row.
INSERT INTO scoring_config (param_name, value)
VALUES ('edge_conviction_override', '0.25')
ON CONFLICT (param_name) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();

-- Which door a candidate came through. Persisted rather than recomputed because
-- the frontend reads trade_candidates directly and cannot re-derive scope, and
-- because "arrived on attention" and "arrived on conviction" are different claims
-- that should not render identically.
ALTER TABLE trade_candidates
  ADD COLUMN IF NOT EXISTS via_conviction boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN trade_candidates.via_conviction IS
  'ADR-0046: true when this candidate''s theme sits below the attention gate and was expanded only because this asset''s own |EdgeScore| >= edge_conviction_override.';
