-- 054: the mandate's limits become readable rows, not just Python constants.
--
-- WHAT WAS WRONG
-- --------------
-- `frontend/lib/risk/riskBoard.ts` has always looked up `max_single_name_weight`,
-- `max_sector_weight` and `max_geo_weight` in this table before falling back to a
-- hardcoded default. Those rows were never seeded. So every one of the ten limits
-- on the risk board resolved to `house_default` — a lookup that reads as live and
-- has never once returned a value.
--
-- The consequence is not cosmetic. A reader on /risk sees "US geography 35% — at
-- limit" with no way to learn who chose 35% or against what, which is design goal
-- 1's naked-number failure applied to the constraints the whole book is built
-- under. Seeding them gives the board a source to cite.
--
-- WHY THESE VALUES AND NOT OTHERS
-- -------------------------------
-- These are the limits the sizer ALREADY enforces, transcribed. Nothing here
-- changes how a book is built: `backend/services/mandate.py` carries the identical
-- numbers as its fallback, and `frontend/tests/unit/mandate-drift.test.ts` fails if
-- the two ever disagree. This migration moves them from implicit to stated.
--
-- ADR-0037 on why the values are a row and not a constant: "The limit *values* (20%
-- single name / 30% sector / 35% geography) are unchanged. They were never the
-- defect and re-specifying them is an operator decision, not an implementation
-- one." An operator decision belongs in a table an operator can change.
--
-- WHAT CHANGING ONE DOES
-- ----------------------
-- Nothing, until the next 21:30 UTC run. The pipeline reads `scoring_config` once
-- at the top of `daily_refresh.py` and sizes under whatever it finds. There is no
-- path from this table to a re-size of a published book, and design goal 5 forbids
-- the frontend acquiring one: the book is immutable once published.
--
-- NOT SEEDED HERE, DELIBERATELY
-- -----------------------------
--   * max_longs / max_shorts (5/5) — book SHAPE, enforced in q1_agent's selection
--     rather than in the sizer. Seeding it would imply the solver honours it.
--   * lens — a per-run argument, not a standing limit. ADR-0015.
--   * limit_var_95_pct, limit_net_exposure_pct, limit_beta_abs and the rest — these
--     are MONITORING thresholds that constrain nothing in the backend. Seeding them
--     beside the caps would assert the sizer honours a 30% net band and a 0.5 beta
--     ceiling. It does not. They stay `house_default`, which is the true answer, and
--     `frontend/lib/mandate.ts` keeps them in a separate type so the difference
--     survives a later edit.

INSERT INTO scoring_config (param_name, value) VALUES
    -- No single position may exceed 20% of the book.
    ('max_single_name_weight', '0.20'),
    -- No single sector may exceed 30%.
    ('max_sector_weight', '0.30'),
    -- No single geography may exceed 35%.
    ('max_geo_weight', '0.35'),
    -- Long + short <= 100%. NOT 200%: ADR-0037 holds whatever the position limits
    -- refuse as cash rather than renormalising the book back to full notional, so
    -- this is a ceiling the sizer approaches from below and never exceeds.
    ('max_gross', '1.0'),
    -- A correlation complex is ONE IDEA, so it may hold at most what one name may
    -- (ADR-0115). Named separately from the single-name cap so the two can diverge
    -- later with an argument rather than by accident.
    ('max_complex_weight', '0.20'),
    -- A crowded name's single-name cap is halved (ADR-0110). Every other name is
    -- absent from the crowding map and sized bit-identically. Only ever tightens.
    ('crowded_cap_multiplier', '0.5')
-- Idempotent: this migration states the values the code already enforces, so
-- re-running it must not overwrite an operator's deliberate change to one of them.
ON CONFLICT (param_name) DO NOTHING;

COMMENT ON TABLE scoring_config IS
    'Tunable scoring weights, lookbacks and MANDATE LIMITS. Read once per run by '
    'daily_refresh.py. The mandate rows (max_single_name_weight, max_sector_weight, '
    'max_geo_weight, max_gross, max_complex_weight, crowded_cap_multiplier) are '
    'mirrored by backend/services/mandate.py, which is the single source of truth '
    'for their fallbacks; mandate-drift.test.ts fails if the frontend disagrees. '
    'Changing one takes effect on the next 21:30 UTC run and never alters a book '
    'already published.';
