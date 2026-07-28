-- 049_narrative_tracking.sql
--
-- Three changes, one theme: the system can now see a narrative it was not told
-- about, and can say which asset classes a narrative actually moves.
--
--   1. theme_signals_history.corr_by_class / corr_classes_* — the CROSS-ASSET
--      correlation reading (ADR-0127). The correlation term used to be measured on
--      one arbitrary instrument per theme.
--   2. market_news — the un-themed corpus (ADR-0128). Headlines collected by
--      market-wide seed queries rather than by the eight anchor keyword lists, so
--      discovery over it is no longer circular.
--   3. narrative_signals — the daily share-of-voice series per phrase, with
--      velocity, first-seen and an emergence status (ADR-0128). This is the table
--      a trends chart reads.
--
-- SHADOW MODE, same footing as discovered_themes (RESIDUAL R5): nothing in
-- narrative_signals enters the live `themes` board, sizes a position, or reaches
-- the L5 agent. A phrase trending in the news is evidence a narrative exists, not
-- evidence it is tradeable — the tradeable claim needs mapped instruments and a
-- measured price link, which an anchor theme has and a fresh phrase does not.

BEGIN;

-- ─── 1. Cross-asset correlation detail (ADR-0127) ───────────────────────────

ALTER TABLE theme_signals_history
    ADD COLUMN IF NOT EXISTS corr_by_class JSONB,
    ADD COLUMN IF NOT EXISTS corr_classes_material SMALLINT,
    ADD COLUMN IF NOT EXISTS corr_classes_measured SMALLINT;

COMMENT ON COLUMN theme_signals_history.corr_by_class IS
    'Signed mention-vs-return correlation per ASSET CLASS, e.g. {"rates": -0.41, '
    '"commodity": 0.33}. One entry per class the theme could be MEASURED in, not '
    'per class it is mapped to — an unmeasurable class is absent, never 0 '
    '(ADR-0127). themes.corr_score is the mean of min(1, |c|/0.50) over these.';

COMMENT ON COLUMN theme_signals_history.corr_classes_material IS
    'How many measured asset classes moved materially (|corr| >= 0.25) with this '
    'theme''s attention. The literal cross-asset claim: "3 of 4 asset classes".';

COMMENT ON COLUMN theme_signals_history.corr_classes_measured IS
    'Denominator for corr_classes_material — asset classes with enough overlapping '
    'price history to measure at all.';

-- price_corr keeps its meaning but changes its derivation: it is now the
-- STRONGEST per-class correlation (sign preserved, for crowding) rather than
-- whichever mapped ticker Postgres returned first. It is also nullable now, and
-- NULL means "no mapped instrument was measurable" rather than "uncorrelated".
COMMENT ON COLUMN theme_signals_history.price_corr IS
    'Strongest signed per-class correlation for this theme (ADR-0127). NULL means '
    'NOT MEASURABLE, not uncorrelated — HypeScore renormalises over its other '
    'three components rather than scoring a data gap as zero.';

-- ─── 2. The un-themed corpus (ADR-0128) ─────────────────────────────────────
--
-- Deliberately NOT theme_news with a sentinel theme row. theme_news answers "what
-- was said about Fed Policy" and the L5 agent reads it per theme; this answers
-- "what was the news about" and belongs to no theme by construction. Merging them
-- would put un-themed headlines into the agent's per-theme reasoning context,
-- where they would read as evidence about a theme that did not collect them.

CREATE TABLE IF NOT EXISTS market_news (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    source TEXT NOT NULL,              -- 'brave_market'
    headline TEXT NOT NULL,
    published_date DATE,
    url TEXT,
    query TEXT,                        -- which seed query surfaced it
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (run_date, headline)
);

CREATE INDEX IF NOT EXISTS market_news_run_date_idx ON market_news (run_date DESC);

ALTER TABLE market_news ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read market_news" ON market_news;
CREATE POLICY "Public read market_news" ON market_news FOR SELECT TO anon USING (true);

COMMENT ON TABLE market_news IS
    'General market news collected by market-wide seed queries, NOT by the eight '
    'anchor themes'' keyword lists (ADR-0128). This is what makes narrative '
    'discovery non-circular: theme_news can only ever contain what the anchors '
    'asked for.';

-- ─── 3. The narrative series (ADR-0128) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS narrative_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    phrase TEXT NOT NULL,
    doc_count INTEGER NOT NULL,
    corpus_size INTEGER NOT NULL,
    -- doc_count / corpus_size. THIS is the comparable series, not doc_count: the
    -- daily corpus size swings with how many articles the fetch returned, so a raw
    -- count rises on a day the fetcher simply worked better.
    share REAL NOT NULL,
    -- Robust (median/MAD) z of today's share against this phrase's own history.
    -- NULL = too little history to say. Never 0.0, which would read as "flat".
    velocity REAL,
    days_observed INTEGER NOT NULL,
    first_seen DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'emerging', 'established', 'fading')),
    -- The anchor theme whose keywords already cover this phrase, or NULL if the
    -- narrative is genuinely outside the hard-coded eight. This is the field that
    -- makes the table answer the question: a surge in "fomc" is Fed Policy doing
    -- its job; a surge in "ai capex cycle" is a narrative nothing is watching.
    covered_by TEXT,
    methods JSONB DEFAULT '["frequency"]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (run_date, phrase)
);

CREATE INDEX IF NOT EXISTS narrative_signals_run_date_idx
    ON narrative_signals (run_date DESC);
-- The trends chart reads one phrase across many days; the emerging shortlist reads
-- one day across many phrases. Both need to be fast.
CREATE INDEX IF NOT EXISTS narrative_signals_phrase_date_idx
    ON narrative_signals (phrase, run_date DESC);
CREATE INDEX IF NOT EXISTS narrative_signals_status_idx
    ON narrative_signals (run_date DESC, status);

ALTER TABLE narrative_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read narrative_signals" ON narrative_signals;
CREATE POLICY "Public read narrative_signals" ON narrative_signals
    FOR SELECT TO anon USING (true);

COMMENT ON TABLE narrative_signals IS
    'Daily share-of-voice per narrative phrase, with velocity against its own '
    'history and an emergence status (ADR-0128). SHADOW: nothing here enters the '
    'live theme board or sizes a position without an operator promoting it.';

COMMIT;
