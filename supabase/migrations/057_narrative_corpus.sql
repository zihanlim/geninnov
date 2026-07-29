-- 057: two corpora, two series, never merged.
--
-- WHY
-- ---
-- `narrative_signals` answers two questions that have DIFFERENT validity
-- conditions, and it was trying to answer both from one series:
--
--   "What is the news about today?"      a SNAPSHOT.  Needs density. Nothing is
--                                        compared across days, so it does not care
--                                        whether the corpus is defined the same way
--                                        tomorrow.
--   "What is accelerating that nothing   a SERIES.    Needs comparability. Density
--    watches?"                           matters less than counting today's share
--                                        out of the same kind of corpus as
--                                        yesterday's.
--
-- Measured 2026-07-29, those requirements point at different providers:
--
--   Brave   87-94 docs/day after 2026-07-21, and ZERO before it (8-day window)
--   GDELT   ~11 docs/day, but 41 distinct days back to 2026-06-14
--
-- A single combined series is dense today and has a 5-10x corpus discontinuity at
-- 2026-07-21, so every phrase's share jumps there for reasons that have nothing to
-- do with attention. That is ADR-0141's finding one level deeper: share of voice
-- over a corpus whose composition changes measures the composition change. A single
-- archive-only series is comparable but counts ~11 documents a day, at which
-- MIN_DOC_COUNT = 3 demands a phrase appear in 27% of the day before it registers —
-- which is why the survivors are `prices`, `us`, `global`, `nifty`. Register, not
-- narrative (ADR-0142).
--
-- Neither is wrong. They are answers to different questions, so both are computed
-- and each is labelled with the corpus it was counted out of. This is the same
-- pattern the repo already uses for instruments that must not be conflated: the
-- four VaRs each carry method, horizon AND basis (ADR-0082); `weights_backtest`,
-- `pick_outcomes` and `portfolio_returns` are three accountability instruments in
-- three columns, compared and never merged (ADR-0112).
--
-- WHAT THIS IS NOT
-- ----------------
-- It is NOT one row with a dense `share` and an archive-derived `velocity`. That
-- would be a number whose velocity is not the velocity OF that share, and a reader
-- would reasonably assume otherwise. Each row is internally consistent: its share,
-- its velocity and its status all come from the same corpus.
--
-- THE HANDOVER THIS SETS UP
-- -------------------------
-- `archive` has history NOW (backfilled to 2026-06-14) and can compute velocity
-- today. `combined` has none before 2026-07-29 and gains valid velocity about four
-- runs later, at which point it is the better instrument — denser, and still
-- self-consistent because its composition stops changing once both providers are
-- steady. The archive series bootstraps a capability the combined series inherits.
--
-- See ADR-0153.

ALTER TABLE narrative_signals
    ADD COLUMN IF NOT EXISTS corpus TEXT NOT NULL DEFAULT 'combined'
    CHECK (corpus IN ('combined', 'archive'));

COMMENT ON COLUMN narrative_signals.corpus IS
    'Which corpus this row was counted out of. combined = every un-themed source '
    '(dense, but its composition changes as providers come and go, so shares are '
    'only comparable across days where the mix is stable). archive = GDELT alone '
    '(sparse at ~11 docs/day, but one definition all the way back, which is what '
    'makes velocity mean anything). NEVER mix the two in one comparison.';

-- Existing rows were written from the combined corpus, which the DEFAULT already
-- records correctly. No backfill of this column is needed.

-- One row per phrase per day PER CORPUS. Without widening this, writing the second
-- series would silently overwrite the first — the two would fight over one row and
-- the winner would depend on write order.
ALTER TABLE narrative_signals DROP CONSTRAINT IF EXISTS narrative_signals_run_date_phrase_key;
ALTER TABLE narrative_signals
    ADD CONSTRAINT narrative_signals_run_date_phrase_corpus_key
    UNIQUE (run_date, phrase, corpus);

-- The trends chart and the emerging shortlist both now filter by corpus first.
CREATE INDEX IF NOT EXISTS narrative_signals_corpus_date_idx
    ON narrative_signals (corpus, run_date DESC);
CREATE INDEX IF NOT EXISTS narrative_signals_corpus_phrase_date_idx
    ON narrative_signals (corpus, phrase, run_date DESC);
