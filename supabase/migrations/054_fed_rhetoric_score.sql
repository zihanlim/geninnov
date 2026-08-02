-- 054_fed_rhetoric_score.sql
--
-- Adds the Fed rhetoric reading alongside posture (ADR-0141). Where
-- posture is the MARKET-IMPLIED posture (DFF + 2s10s, ADR-0140), rhetoric
-- is the FOMC's OWN self-reported lean, computed from the most recent
-- meeting's voting record.
--
-- Three columns: the numeric score (-10..+10), the band label (one of
-- five values), and the evidence JSONB. The label is a derived field of
-- the score; both are persisted so a card reader and a SQL auditor never
-- derive the same thing twice (ADR-0064).
--
-- SHADOW MODE: same 14-day schedule as ADR-0140/0139. The columns are
-- added but NOT included in the L5 snapshot — q1_agent reads the regime
-- row with select("*"), so without an explicit exclusion a published
-- thesis could cite a rhetoric the harness has not yet passed (ADR-0100).
-- After the shadow, lift is one coordinated change: snapshot exclusion
-- removed, one line added to the L5 prompt, verify_citations extended.

BEGIN;

-- ─── 1. The reading columns ────────────────────────────────────────────────

ALTER TABLE regime_classifications
    ADD COLUMN IF NOT EXISTS fed_rhetoric_score REAL
        CHECK (fed_rhetoric_score IS NULL
            OR (fed_rhetoric_score >= -10 AND fed_rhetoric_score <= 10)),
    ADD COLUMN IF NOT EXISTS fed_rhetoric_label TEXT
        CHECK (fed_rhetoric_label IS NULL
            OR fed_rhetoric_label IN
                ('strongly_dovish','dovish','neutral','hawkish','strongly_hawkish')),
    ADD COLUMN IF NOT EXISTS fed_rhetoric_evidence JSONB;

COMMENT ON COLUMN regime_classifications.fed_rhetoric_score IS
    'FOMC rhetoric score, -10 (strongly dovish) to +10 (strongly hawkish), '
    'from the most recent meeting''s voting record on or before run_date '
    '(ADR-0141). v1 source: FOMC press release, dissent count. Formula: '
    '(hawkish_dissents - dovish_dissents) * 10 / voting_members. NULL means '
    'no meeting on or before run_date, NOT a default of neutral (ADR-0091). '
    'The score is the FOMC''s self-reported lean; it is deliberately a '
    'different sensor from fed_posture, which is market-implied.';

COMMENT ON COLUMN regime_classifications.fed_rhetoric_label IS
    'Banded label derived from fed_rhetoric_score. Bands: '
    '<= -5 = strongly_dovish, -5..-2 (excl) = dovish, -2..+2 (incl) = neutral, '
    '+2..+5 (excl) = hawkish, >= +5 = strongly_hawkish. Same vocabulary as '
    'fed_posture on the card so a reader can compare at a glance; the '
    'thresholds live in fed_rhetoric_evidence for auditability.';

COMMENT ON COLUMN regime_classifications.fed_rhetoric_evidence IS
    'Full provenance for the rhetoric call: source, meeting date, vote '
    'counts, dissent list (with each dissenter''s direction and preferred '
    'action), and the scoring formula with its thresholds. Schema: '
    '{"source": "FOMC press release", "meeting_date": "YYYY-MM-DD", '
    '"as_of": "YYYY-MM-DD", "vote": {"for": int, "against": int, '
    '"voting_members": int}, "dissents": [{"voter": str, "direction": '
    '"hawkish"|"dovish", "preferred_action": str}, ...], "scoring": '
    '{"formula": str, "raw_score": float, "thresholds": dict}}. The dissent '
    'list is included so a reader can answer "who dissented, and in which '
    'direction" without a second round-trip to federalreserve.gov.';

-- ─── 2. Indexes ────────────────────────────────────────────────────────────
-- None. The rhetoric columns are read off the regime row by run_date, which
-- the existing regime_classifications indexes already cover. No new query
-- patterns are introduced.

-- ─── 3. Backfill historical rows ──────────────────────────────────────────
-- Same policy as migration 052/053: the classifier function is the source of
-- truth, and the backfill is scripts/backfill_regime.py calling classify()
-- once per historical run_date. v1 rhetoric is read from a hand-maintained
-- table of recent FOMC meetings until a federalreserve.gov fetcher lands
-- (ADR-0141 §3); historical runs that predate the table ingest will carry
-- NULL rhetoric, which is a documented absence ("no meeting on disk before
-- run_date"), not a default of neutral.

COMMIT;
