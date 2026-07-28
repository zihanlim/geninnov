-- 052_dollar_debasement_indicator.sql
--
-- Adds the dollar-debasement pressure reading to regime_classifications
-- (ADR-0139). Six columns: one composite 0-100, four components bounded 0-1,
-- and the lookback window as a recorded fact so a reader can audit what the
-- composite was computed against.
--
-- SHADOW MODE: this migration lands BEFORE the MacroCrossCurrents component
-- on /book mounts, and BEFORE the columns are admitted into the L5 input
-- snapshot. The second gate is the one that matters: q1_agent reads the
-- regime row with select("*") and freezes the whole dict into the snapshot
-- the LLM reasons over, so without an explicit exclusion a thesis could cite
-- debasement_pressure before the shadow harness has passed it (ADR-0100: a
-- guard that lives in one component guards one consumer). The classifier
-- writes the columns for 14 days; the harness asserts shape, NULL semantics,
-- and that the composite equals the WEIGHTED sum of components within a
-- documented tolerance. The shadow validates shape, not signal quality.
--
-- The composite is a DIAL, not a flag. Threshold interpretation lives on the
-- page, not in the schema (ADR-0041 / ADR-0091): one number is a fact, several
-- numbers are a fact with evidence, and "what does it mean" is the page's job.

BEGIN;

-- ─── 1. The reading columns ────────────────────────────────────────────────
-- Composite is bounded 0-100 (NOT 0-1, because the 0-100 dial is the unit
-- the page already uses elsewhere on /book). Components are bounded 0-1 and
-- combine into the composite via the ADR-0139 weights (30/25/25/20).

ALTER TABLE regime_classifications
    ADD COLUMN IF NOT EXISTS debasement_pressure REAL
        CHECK (debasement_pressure IS NULL
            OR (debasement_pressure >= 0 AND debasement_pressure <= 100)),
    ADD COLUMN IF NOT EXISTS debasement_real_yield_comp REAL
        CHECK (debasement_real_yield_comp IS NULL
            OR (debasement_real_yield_comp >= 0 AND debasement_real_yield_comp <= 1)),
    ADD COLUMN IF NOT EXISTS debasement_dxy_decline_comp REAL
        CHECK (debasement_dxy_decline_comp IS NULL
            OR (debasement_dxy_decline_comp >= 0 AND debasement_dxy_decline_comp <= 1)),
    ADD COLUMN IF NOT EXISTS debasement_gold_rise_comp REAL
        CHECK (debasement_gold_rise_comp IS NULL
            OR (debasement_gold_rise_comp >= 0 AND debasement_gold_rise_comp <= 1)),
    ADD COLUMN IF NOT EXISTS debasement_comovement_comp REAL
        CHECK (debasement_comovement_comp IS NULL
            OR (debasement_comovement_comp >= 0 AND debasement_comovement_comp <= 1)),
    ADD COLUMN IF NOT EXISTS debasement_lookback_weeks INT NOT NULL DEFAULT 26;

COMMENT ON COLUMN regime_classifications.debasement_pressure IS
    'Composite dollar-debasement pressure reading, 0-100 (ADR-0139). '
    'NULL means NOT COMPUTABLE, not zero: at least one of DFII10, DX-Y.NYB, '
    'GC=F was unavailable on the run_date or within the lookback window. '
    'Built as 30*real_yield_comp + 25*dxy_decline_comp + 25*gold_rise_comp '
    '+ 20*comovement_comp, clipped to [0, 100]. The weights live in '
    'regime_classifier.classify_debasement() -- moving them is a code change.';

COMMENT ON COLUMN regime_classifications.debasement_real_yield_comp IS
    'Component: how negative the 10y real yield is vs the -2% anchor. '
    'clip(-DFII10_pct / 2.0, 0, 1), where DFII10_pct is the stored FRED value '
    'IN PERCENT (-2.0 means -2%; ADR-0137 -- units are declared, not assumed). '
    'Real yield at -2% or below => 1.0; at 0% or above => 0.0. One-sided: '
    'positive real yields are NOT debasement pressure (ADR-0139).';

COMMENT ON COLUMN regime_classifications.debasement_dxy_decline_comp IS
    'Component: DXY drawdown from its rolling 26-week peak, as a fraction. '
    'clip(((peak_26w - DXY_t) / peak_26w) / 0.05, 0, 1). Drawdown from the '
    'peak, NOT change vs t-26w -- a round trip that ends where it started is '
    'not sustained dollar weakness. One-sided: DXY at or above its 26w peak '
    '=> 0.0.';

COMMENT ON COLUMN regime_classifications.debasement_gold_rise_comp IS
    'Component: fractional gold return over the 26-week window. '
    'clip(gold_return_26w / 0.20, 0, 1). One-sided: gold flat or down => 0.0. '
    'Alone this is too noisy to read (a geopolitical spike moves gold 10% '
    'in a week) -- the comovement component exists to discount gold moves '
    'that are NOT being driven by real-yield collapse.';

COMMENT ON COLUMN regime_classifications.debasement_comovement_comp IS
    'Component: -corr(daily change in DFII10, daily change in gold) over the '
    '26w window, clipped to [0, 1] via /0.50. Computed on DAILY changes '
    '(~130 pairs); at weekly frequency (n~26) the 0.50 normaliser is '
    'reachable by noise alone. Fewer than 60 paired observations => NULL, '
    'and the composite is NULL with it. The debasement-specific diagnostic: '
    'gold rising BECAUSE real yields are falling. It does NOT remove the '
    'mechanical DXY/gold overlap -- those two components share 50 of the 100 '
    'points, accepted and disclosed in ADR-0139 -- it discounts gold moves '
    'that real yields are not driving.';

COMMENT ON COLUMN regime_classifications.debasement_lookback_weeks IS
    'Window the four components were computed over. Default 26 weeks -- one '
    'option cycle, one Fed meeting cadence, deliberate middle ground between '
    'L1 momentum (4w) and L3 breadth (200d MA). Changing this is a code '
    'change and a re-run of the shadow period (ADR-0139).';

-- ─── 2. Indexes ────────────────────────────────────────────────────────────
-- None. 005_macro_indicators.sql already indexes
-- macro_daily_history (series_id, trading_date DESC), which covers the
-- classifier's per-series as_of reads for DX-Y.NYB, GC=F and DFII10 alike.
-- (An earlier draft added two per-series partial indexes here; they were
-- redundant with the composite index and are not created.)

-- ─── 3. Backfill historical rows ──────────────────────────────────────────
-- Deliberately NOT done in SQL. The classifier function is the source of
-- truth; a second implementation of the formula here would silently drift
-- from the Python on the next threshold change. The backfill is
-- scripts/backfill_regime.py calling classify() once per historical
-- run_date with the same as_of bound (dry-run by default, --apply to
-- write). A reader scanning the regime row chronologically expects a
-- continuous series, so the backfill MUST run before the panel mounts --
-- but it runs through the classifier, not through this file.

COMMIT;
