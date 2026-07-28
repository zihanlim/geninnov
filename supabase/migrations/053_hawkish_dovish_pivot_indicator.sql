-- 053_hawkish_dovish_pivot_indicator.sql
--
-- Adds the Fed posture and pivot reading to regime_classifications (ADR-0140).
-- Six columns: posture label (hawkish/neutral/dovish), pivot delta (-2..+2),
-- three provenance numerics, and one JSONB evidence blob.
--
-- SHADOW MODE: same 14-day schedule as ADR-0139 (migration 052), and the same
-- L5 snapshot exclusion -- q1_agent reads the regime row with select("*"), so
-- until the shadow lifts these columns are stripped from the snapshot, or a
-- published thesis could cite a posture the harness has not yet passed
-- (ADR-0100). The shadow validates shape, not signal quality.
--
-- The pivot is SIGNED. "Did posture change?" is half the question;
-- "from what to what?" is the other half. A boolean would force a reader to
-- look at two adjacent rows to recover it.

BEGIN;

-- ─── 1. The reading columns ────────────────────────────────────────────────

ALTER TABLE regime_classifications
    ADD COLUMN IF NOT EXISTS fed_posture TEXT
        CHECK (fed_posture IS NULL
            OR fed_posture IN ('hawkish', 'neutral', 'dovish')),
    ADD COLUMN IF NOT EXISTS fed_pivot_delta SMALLINT
        CHECK (fed_pivot_delta IS NULL
            OR (fed_pivot_delta >= -2 AND fed_pivot_delta <= 2)),
    ADD COLUMN IF NOT EXISTS fed_rate_change_13w_bps REAL,
    ADD COLUMN IF NOT EXISTS fed_curve_change_13w_bps REAL,
    ADD COLUMN IF NOT EXISTS fed_curve_steepness_bps REAL,
    ADD COLUMN IF NOT EXISTS fed_posture_evidence JSONB;

COMMENT ON COLUMN regime_classifications.fed_posture IS
    'Current Fed policy posture: hawkish / neutral / dovish (ADR-0140). '
    'Derived from DFF change over 13 weeks AND the 2s10s curve change over '
    'the same window: |rate change| > 25bps decides alone; otherwise curve '
    'steepening > +15bps reads DOVISH (market pricing cuts) and flattening '
    '< -15bps reads HAWKISH. See fed_posture_evidence for the inputs. '
    'NULL means NOT COMPUTABLE (DFF, DGS2, or DGS10 missing on run_date), '
    'NOT neutral. ADR-0091 -- a missing input is not a default.';

COMMENT ON COLUMN regime_classifications.fed_pivot_delta IS
    'Net posture change vs the row ~13 weeks prior: the most recent row '
    'dated on or before run_date - 13 weeks, NOT the previous day''s row. '
    'Encoded as sign(posture_t) - sign(posture_t13w) with sign(dovish)=+1, '
    'sign(neutral)=0, sign(hawkish)=-1 -- dovish is POSITIVE, matching the '
    'page''s directional ink, so +2 = hawkish -> dovish (textbook landing) '
    'and -2 = dovish -> hawkish (textbook tightening). NULL when either '
    'posture is NULL or no row that old exists.';

COMMENT ON COLUMN regime_classifications.fed_rate_change_13w_bps IS
    'DFF change over the 13-week window, in basis points '
    '(100 x (DFF_t - DFF_t13w)). The "is the Fed actively moving" '
    'component -- |value| > 25 decides the posture regardless of the curve. '
    'The inequality is strict: a single 25bp step over a window spanning '
    '~2 FOMC meetings lands ON the threshold and falls through to the curve '
    'test (ADR-0140). NULL when DFF was unavailable at either end of the '
    'window.';

COMMENT ON COLUMN regime_classifications.fed_curve_change_13w_bps IS
    'Change in 2s10s steepness over the 13-week window, in basis points. '
    'The "is the market repricing posture" component -- steepening '
    '(positive value) is the textbook "market expects cuts" signal and '
    'reads DOVISH; flattening reads HAWKISH. NULL when DGS2 or DGS10 was '
    'unavailable at either end.';

COMMENT ON COLUMN regime_classifications.fed_curve_steepness_bps IS
    'Current 2s10s steepness in basis points (100 x (DGS10 - DGS2)). '
    'A snapshot reading, not a delta. Distinct from '
    'regime_classifications.yield_curve_slope (which is 10y-2y in '
    'percentage points, ADR-0137) by UNIT -- this column is the same '
    'fact in bps so the pivot card does not have to convert at read '
    'time. NULL when either input is missing.';

COMMENT ON COLUMN regime_classifications.fed_posture_evidence IS
    'Full provenance for the posture call: the inputs, the components, the '
    'comparison posture (for pivot delta), and the thresholds that produced '
    'the label. Schema: '
    '{"inputs": {"dff_pct": ..., "dgs2_pct": ..., "dgs10_pct": ...}, '
    '"components": {"rate_change_13w_bps": ..., "curve_change_13w_bps": ..., '
    '"curve_steepness_bps": ...}, '
    '"prior_posture": "hawkish"|"neutral"|"dovish"|null, '
    '"thresholds": {"rate_threshold_bps": 25, "curve_threshold_bps": 15, '
    '"window_weeks": 13}}. All input LEVELS are in percent (dff_pct, not '
    'dff_bps -- levels are quoted in percent, spreads in bps, ADR-0137). '
    'Written so the page can render "Hawkish -> Dovish (curve steepened '
    '38bps, DFF -25bps)" without a second round-trip.';

-- ─── 2. Indexes ────────────────────────────────────────────────────────────
-- None. DFF, DGS2, DGS10 reads are covered by the existing
-- macro_daily_history (series_id, trading_date DESC) index from
-- 005_macro_indicators.sql.

-- ─── 3. Backfill historical rows ──────────────────────────────────────────
-- Same policy as migration 052: the classifier function is the source of
-- truth, and the backfill is scripts/backfill_regime.py calling classify()
-- once per historical run_date. One ordering subtlety: fed_pivot_delta
-- compares against the posture ~13 weeks prior, so the backfill MUST
-- proceed in chronological order -- a row's comparison posture must have
-- been computed (or be genuinely absent) before the delta that references
-- it is written. The first ~13 weeks of backfilled history carry a NULL
-- delta because no row that old exists -- which is "no prior posture",
-- not "no pivot", and the two absences are deliberately distinct
-- (ADR-0140).

COMMIT;
