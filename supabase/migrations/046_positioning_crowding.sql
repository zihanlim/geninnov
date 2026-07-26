-- 046_positioning_crowding.sql
--
-- Persists external (CFTC Commitments of Traders) positioning against the book, so a reader
-- can see whether we are leaning the way the speculative crowd already is.
--
-- WHY THIS IS EXTERNAL AND EVERYTHING ELSE WAS NOT. Every crowding measure the system had was
-- internal: HypeScore counts attention in a corpus we assemble, and AttentionCrowding ranks
-- our own themes against each other. Neither can say whether the MARKET is already positioned
-- our way. COT can, for the slice of the book that trades against a futures contract, and it
-- is free, official, keyless, and long enough to percentile against.
--
-- WHAT IT ACTUALLY RECORDS, AND WHY COVERAGE COMES FIRST. On the 2026-07-25 book exactly two
-- of ten positions map to a contract — SHY (UST 2Y) and SVXY (VIX) — which is 22% of gross.
-- A column that stored only a crowding verdict would let a page imply the whole book had been
-- checked when four fifths of it had not been. So `coverage_share` is stored alongside
-- `crowded_share`, `crowded_share <= coverage_share` holds by construction, and every
-- unmapped position is stored in `unobservable` WITH ITS REASON rather than omitted.
--
-- THE SIDE IS THE PART THAT CAN BE SILENTLY WRONG. SVXY is a -0.5x inverse VIX product, so
-- LONG SVXY is a SHORT volatility position. Comparing its stated direction to the VIX
-- speculator reading without the flip gives a verdict that is exactly backwards — and unlike
-- a wrong number, a wrong side has no symptom a reader could catch. The flip lives in
-- positioning_crowding.effective_side and is pinned by a test.
--
-- THE LAG IS STRUCTURAL. CFTC positions are as of TUESDAY and published the following FRIDAY.
-- `as_of` is therefore the OBSERVATION date, not the retrieval date, and it stores the
-- STALEST contract date across the book — a mixed-date panel is only as fresh as its oldest
-- input.
--
-- Nullable, like every other analytic added by 022/038/045: a run predating the column, or a
-- run where CFTC did not answer, must render "not retrieved" rather than a shape the UI reads
-- as "not crowded". Those are different claims. See ADR-0097.

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS positioning_crowding JSONB;

COMMENT ON COLUMN research_recommendations.positioning_crowding IS
    'Written by q1_agent._persist_to_supabase. Source: positioning_crowding.assess() over cot_fetcher.fetch_readings() (CFTC Socrata, no credential). External speculator positioning vs the book. COVERAGE IS THE HEADLINE: only 2 of 10 positions in the 2026-07-25 book map to a futures contract (22% of gross); unmapped positions are listed in `unobservable` with a reason, never omitted. `as_of` is the CFTC OBSERVATION Tuesday (stalest across contracts), not the retrieval date — the report publishes the following Friday. SVXY is inverse-mapped: long SVXY is short VIX. NULL means not retrieved, which is not "not crowded". See ADR-0097.';
