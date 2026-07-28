-- 051_theme_promotion_basis.sql
--
-- Why each theme exists, recorded on the theme (ADR-0134).
--
-- THE GAP: all nine themes read `source = 'practitioner'` and
-- `discovered_at = NULL`. `AI Capex` — created on 2026-07-28 after a tracker
-- signal and an operator's instruction — is byte-identical in provenance to
-- `Fed Policy`, which is a line in migration 001 from a practitioner's opening
-- list. A reader cannot tell which themes were reasoned into existence and which
-- were assumed, and that difference is exactly what a reader should be able to
-- interrogate on a research publication.
--
-- `source` is NOT reused. Its CHECK is ('practitioner','lda','embedding',
-- 'both_agreement') — a taxonomy of WHICH METHOD named a theme — and it is
-- consumed elsewhere. The question here is different: not which method, but
-- whether a measurement preceded the decision. Overloading one column with two
-- questions is how `price_corr` came to mean two things (ADR-0127).

BEGIN;

ALTER TABLE themes
    ADD COLUMN IF NOT EXISTS promotion_basis TEXT
        CHECK (promotion_basis IN (
            'practitioner_prior',
            'operator_directed',
            'measured_discovery',
            'unrecorded'
        )),
    ADD COLUMN IF NOT EXISTS promoted_on DATE,
    ADD COLUMN IF NOT EXISTS promotion_evidence JSONB;

COMMENT ON COLUMN themes.promotion_basis IS
    'Whether a MEASUREMENT preceded this theme''s existence. Distinct from '
    '`source`, which records which METHOD named it. Four values, and the '
    'distinction between the first two is the point of the column: '
    '(1) practitioner_prior — a practitioner''s opening list. No measurement '
    'claimed and none needed; a prior is a legitimate way to start a universe, '
    'and NULL evidence here is correct rather than missing. '
    '(2) operator_directed — a human named it. Evidence may be attached, but it '
    'did NOT precede the decision. '
    '(3) measured_discovery — the pipeline surfaced it and the evidence came '
    'FIRST. This is the only value that claims the system found the theme. '
    '(4) unrecorded — predates this column (migration 051).';

COMMENT ON COLUMN themes.promoted_on IS
    'When this theme entered the live board. NULL for the migration-001 anchors, '
    'whose creation date is the repo''s first commit rather than a decision.';

COMMENT ON COLUMN themes.promotion_evidence IS
    'The measurement behind the promotion, where one exists. NULL on a '
    'practitioner_prior is CORRECT — a prior is not evidence-backed and must not '
    'be dressed as though it were. Where evidence exists it is dated, so a '
    'retrospective confirmation cannot be mistaken for a prospective one.';

-- ─── The eight original anchors ─────────────────────────────────────────────
-- practitioner_prior, evidence NULL, and that is the honest record. These were
-- chosen in migration 001 as a starting universe. They are not worse for lacking
-- a measurement; they are a different KIND of claim, and the column now says so
-- instead of leaving a reader to assume they were derived.
UPDATE themes
   SET promotion_basis = 'practitioner_prior'
 WHERE name IN ('Fed Policy', 'Inflation', 'China Growth', 'US Dollar',
                'Geopolitical Risk', 'Corporate Credit', 'Energy Prices',
                'US Election')
   AND promotion_basis IS NULL;

-- ─── AI Capex ────────────────────────────────────────────────────────────────
-- operator_directed, NOT measured_discovery. The ordering is the whole reason
-- this column exists, so recording it any other way would defeat it:
--
--   1. The tracker measured AI in 2 of 455 documents — a whisper.
--   2. The operator said AI is a theme.
--   3. The theme was created (migration 050).
--   4. ONLY THEN was the real measurement run: LDA over the 206-document
--      un-themed corpus put AI/capex in 4 of 8 topics.
--
-- Step 4 confirms the theme is findable. It does not make step 3 evidence-led,
-- and `at_promotion` vs `retrospective` in the payload keeps those apart.
UPDATE themes
   SET promotion_basis = 'operator_directed',
       promoted_on = DATE '2026-07-28',
       promotion_evidence = jsonb_build_object(
           'at_promotion', jsonb_build_object(
               'measured_on', '2026-07-28',
               'method', 'frequency',
               'doc_count', 2,
               'corpus_size', 455,
               'note', 'AI appeared in 2 of 455 documents, both arriving via the '
                       'Corporate Credit keyword query. Nothing in the pipeline '
                       'was looking for AI; this is the signal that prompted the '
                       'question, not evidence that justified the promotion.'
           ),
           'retrospective', jsonb_build_object(
               'measured_on', '2026-07-28',
               'method', 'lda',
               'corpus', 'market_news only (un-themed), 206 documents',
               'result', 'AI/capex in 4 of 8 LDA topics, including '
                         'alphabet / capex / fund / guidance / managers / meta',
               'note', 'Run AFTER the promotion, not before. Establishes that the '
                       'theme is findable by the discovery method once the '
                       'ADR-0128 tokenizer and corpus fixes are in place. Does '
                       'NOT make the promotion evidence-led.'
           ),
           'ordering_caveat', 'The measurement followed the decision. Recorded '
                              'so the sequence is legible rather than implied.'
       )
 WHERE name = 'AI Capex';

-- Anything created later without an explicit basis reads `unrecorded`, which is
-- an answer. NULL would read as "nobody has thought about this yet", which is
-- indistinguishable from "this column was never populated".
UPDATE themes SET promotion_basis = 'unrecorded' WHERE promotion_basis IS NULL;

COMMIT;
