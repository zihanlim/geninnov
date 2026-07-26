-- 043_pick_outcomes.sql
--
-- Makes a published pick FALSIFIABLE, and records the commitment before the
-- outcome is knowable.
--
-- WHY THIS TABLE EXISTS. Every validation surface in the repo today looks
-- BACKWARD at signals: `backtest_edge.py` and `backtest_hype.py` compute IC on
-- historical panels, `replication_test.py` measures agent churn on frozen
-- inputs, `run_eval.py` checks which model answered. Nothing scores the books
-- the platform actually published. For a product whose whole claim is that its
-- numbers are auditable, publishing a $100M long-short book daily and never
-- marking a single call right or wrong is the largest hole available.
--
-- THE REASON IT WAS MISSING is not neglect — it is that a pick carried no
-- testable claim. `picks[].time_horizon` exists, but it is free text authored by
-- L5, it takes two fuzzy values ("2-4 weeks", "1-3 months"), and it is not
-- stable: NOC short was "2-4 weeks" on 2026-07-24 and "1-3 months" on
-- 2026-07-25. A model choosing its own horizon is grading its own exam, and a
-- range is not a resolution date. So the spec lives HERE, assigned by the
-- pipeline, deterministic — the same L0-L4-deterministic / L5-stochastic split
-- the rest of the system uses.
--
-- NO BRIER SCORE, DELIBERATELY. A Brier score needs a calibrated probability.
-- Picks carry `conviction`, which is a sizing input (edge / vol), not a
-- probability that the call is right. Mapping one to the other would be a
-- modelling claim dressed as a metric, so this table records hit / miss / void
-- and a signed return, and the scorecard reports hit rate and mean signed
-- return. If a calibrated probability is ever produced, Brier becomes available
-- without changing this schema.
--
-- ROWS ARE WRITTEN AT PUBLICATION, NOT AT RESOLUTION. A pick gets a `pending`
-- row as soon as its book is published, so the DENOMINATOR is fixed before any
-- outcome exists and a call cannot be quietly dropped later for being wrong.
-- That property is the entire point; a table populated only on resolution would
-- let the set of scored picks be chosen after the fact.
--
-- WHY 21 TRADING DAYS. Not because L5 says "1-3 months" — because
-- `backtest_edge.py` already computes IC against FORWARD 1-MONTH RETURNS. If
-- /method reports signal IC on one window and the scorecard resolves on
-- another, the two instruments disagree about what "works" means. Keyed by
-- `horizon_days` so a 63-day companion is a row, not a migration.
--
-- WHEN THIS WAS FIXED, NOTHING HAD MATURED. The earliest published book is
-- 2026-07-22; at 21 trading days the first resolution lands around 2026-08-20.
-- The spec is therefore fixed while every outcome is still unknown, which is
-- the only condition under which "we chose the test in advance" is a claim
-- rather than an assertion.

CREATE TABLE IF NOT EXISTS pick_outcomes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The published claim being scored. (run_date, asset, direction) is the same
    -- key ADR-0040 matches picks back on.
    run_date        DATE NOT NULL,
    asset           TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('long', 'short')),

    -- The spec that resolves it. Both are part of the key so the same pick can
    -- carry a 21d and a 63d verdict without either overwriting the other, and so
    -- a future spec revision is additive rather than a rewrite of history.
    horizon_days    INTEGER NOT NULL CHECK (horizon_days > 0),
    spec_version    TEXT NOT NULL DEFAULT 'v1',

    -- Verdict. `pending` = not yet matured. `void` = matured but unresolvable
    -- (no price history, delisted, insufficient observations) and is NOT a miss.
    -- `flat` is kept distinct because a tie is not a hit, and scoring it as one
    -- would bias the hit rate upward.
    verdict         TEXT NOT NULL DEFAULT 'pending'
                    CHECK (verdict IN ('pending', 'hit', 'miss', 'flat', 'void')),

    -- A void must say why. This is design goal 2 ("absence is stated, never
    -- filled") enforced by the database rather than by convention, on the one
    -- table where a silent gap would directly flatter the track record.
    void_reason     TEXT,
    CONSTRAINT void_requires_reason
        CHECK (verdict <> 'void' OR void_reason IS NOT NULL),

    -- A resolved verdict must carry the arithmetic behind it, so no figure on
    -- the scorecard is a naked number (design goal 1).
    entry_price     NUMERIC,
    exit_price      NUMERIC,
    entry_date      DATE,
    exit_date       DATE,
    signed_return   NUMERIC,   -- direction-adjusted: short gains when price falls
    CONSTRAINT resolved_shows_its_work
        CHECK (
            verdict IN ('pending', 'void')
            OR (entry_price IS NOT NULL AND exit_price IS NOT NULL
                AND signed_return IS NOT NULL AND exit_date IS NOT NULL)
        ),

    -- Business-day arithmetic from run_date, ignoring market holidays: an
    -- ESTIMATE of when this becomes resolvable, for "first maturity" copy. The
    -- authoritative date is exit_date, set from the actual price series.
    expected_exit_date DATE,

    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (run_date, asset, direction, horizon_days, spec_version)
);

CREATE INDEX IF NOT EXISTS idx_pick_outcomes_run_date ON pick_outcomes (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_pick_outcomes_pending
    ON pick_outcomes (expected_exit_date) WHERE verdict = 'pending';

-- Same shape and same policy name as the other twenty-two tables, so a future
-- `grep "Public read"` finds a complete list rather than a partial one.
ALTER TABLE pick_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON pick_outcomes
    FOR SELECT TO anon USING (true);

COMMENT ON TABLE pick_outcomes IS
    'Forward track record: one row per (published pick x resolution horizon). Written by '
    'scripts/resolve_outcomes.py with the service key; rows are created `pending` at '
    'publication so the denominator is fixed before any outcome is known. RLS: anon may '
    'SELECT only. See ADR-0090.';
COMMENT ON COLUMN pick_outcomes.signed_return IS
    'Direction-adjusted simple return from entry_price to exit_price: +1 for long, -1 for '
    'short. A short that fell 3% scores +3%.';
COMMENT ON COLUMN pick_outcomes.void_reason IS
    'Required when verdict = void. A void is NOT a miss — it is a pick the spec could not '
    'score, and the scorecard reports the void rate alongside the hit rate for that reason.';
COMMENT ON COLUMN pick_outcomes.expected_exit_date IS
    'Business-day estimate from run_date, ignoring market holidays. Display only; exit_date '
    'is the authoritative resolution date taken from the price series.';
