-- 045_sanctions_exposure.sql
--
-- Persists the book's sanctions exposure so a reader can see it, not just an ADR.
--
-- WHY A COLUMN AND NOT A FRONTEND COMPUTATION. The exposure needs a jurisdiction map
-- ("which places carry a sanctions channel, and by what mechanism"), and that map is a
-- JUDGEMENT, not a formula. `EXPOSURE_MECHANISM` in
-- `backend/services/sanctions_exposure.py` names the specific channel per jurisdiction —
-- HFCAA delisting, Entity List additions, outbound-investment restrictions — precisely so a
-- reader can disagree with something concrete. Two copies of a judgement drift in a way two
-- copies of a formula do not: a formula that drifts produces a visibly wrong number, whereas
-- a jurisdiction list that drifts produces a confidently wrong CLASSIFICATION with no
-- symptom. So the map has exactly one home, in Python, and the frontend renders what the
-- pipeline computed.
--
-- (Contrast `lib/method/trackRecord.ts`, which DOES re-implement its backend aggregate in
-- TS. That was justified because the backend aggregate is never persisted — only per-pick
-- rows are. Here the assessment is persisted, so there is nothing to re-derive.)
--
-- WHAT IT RECORDS. The 2026-07-25 book held short BABA 8.7% + short PDD 9.25%: 17.9
-- percentage points of book weight, which against 59.3% gross is 30.2% of GROSS EXPOSURE in
-- US-listed Chinese ADRs. Held short, sanctions escalation is a TAILWIND — the opposite of
-- what a China-heavy position list suggests at a glance. Neither the size nor the direction
-- was stated anywhere before this.
--
-- Nullable, like every other analytic added by 022/038: a run that predates the column, or
-- one where the assessment could not be computed, must render "unavailable" rather than a
-- shape the UI mistakes for "no exposure". See ADR-0096.

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS sanctions_exposure JSONB;

COMMENT ON COLUMN research_recommendations.sanctions_exposure IS
    'Written by q1_agent._persist_to_supabase. Source: sanctions_exposure.assess(). Which held names sit in a sanctions-sensitive jurisdiction AND ON WHICH SIDE — the 2026-07-25 book was net SHORT 30.2% of gross in Chinese ADRs, so escalation is a tailwind. The jurisdiction map is a documented judgement and lives only in Python (EXPOSURE_MECHANISM) so it cannot drift against a second copy. See ADR-0096.';
