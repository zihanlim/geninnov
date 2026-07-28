-- 055: the signal, persisted separately from the book it was sized into.
--
-- WHAT WAS WRONG
-- --------------
-- Andromeda publishes a book sized to $100M under a 20/30/35 cap set and a 100%
-- gross budget. Those constraints belong to ONE hypothetical fund. Every surface a
-- consumer can reach -- /book and all ten MCP tools -- emitted only the SIZED
-- output, so a portfolio-management app running its own capital base and its own
-- limits could not use any of it without reverse-engineering back to the research
-- underneath.
--
-- The number such a consumer actually needs is `conviction` = |EdgeScore| / vol. It
-- is a RATIO, so it is identical at $100M and at $5bn, and it is the input any
-- mandate's sizer wants. It was never a first-class output: it existed only as a
-- column inside a sizing derivation, denominated in weights that were not theirs.
--
-- WHAT THIS TABLE MAY NOT CONTAIN
-- -------------------------------
-- No weight. No signed_weight. No notional. No capital base. If a quantity cannot be
-- computed without knowing the mandate, it belongs in research_recommendations.picks
-- and not here. `backend/services/signal.py` enforces this in code against an
-- explicit FORBIDDEN_FIELDS list, and tests/backend/test_signal.py asserts it holds
-- even when a fully sized book is handed to the extractor -- because the guarantee
-- this table makes is an ABSENCE, and an absence is invisible in code review.
--
-- WHY A TABLE AND NOT A COLUMN ON research_recommendations
-- --------------------------------------------------------
-- One row per NAME, not one row per run. A consumer asking "what do you think about
-- VRT" should not have to fetch, parse and filter a book-shaped jsonb blob to find
-- out, and a signal should remain queryable when the book that quoted it has been
-- superseded. It also keeps the mandate-free claim structural: there is no column on
-- this table that could carry a weight.
--
-- See ADR-0148.

CREATE TABLE IF NOT EXISTS book_signal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    asset TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),

    -- Which theme argued for it. Nullable: L5 output does not always carry a
    -- theme_id, and a null id must not be confused with a name that belongs to no
    -- theme.
    theme TEXT,
    theme_id UUID REFERENCES themes(id) ON DELETE SET NULL,

    -- The scored quantities. All NULLABLE by intent (ADR-0066): a name the L1 pool
    -- never scored has no edge, and "no edge" is a different claim from "zero edge".
    -- A NOT NULL DEFAULT 0 here would silently convert the first into the second.
    edge_score REAL,
    -- |EdgeScore| / max(vol, floor). The mandate-free sizing input: a ratio, so it
    -- does not change with the capital base.
    conviction REAL,
    vol REAL,
    hype_score REAL,

    -- What the agent argued, verbatim from the pick the citation guardrail passed.
    thesis TEXT,
    catalysts JSONB,
    risk TEXT,
    counter_thesis TEXT,
    time_horizon TEXT,
    citations JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- One row per name per side per run. A rerun of the same date upserts rather
    -- than duplicating, matching how research_recommendations behaves on run_date.
    UNIQUE (run_date, asset, direction)
);

-- The two reads this table exists to serve: "today's signal" (the MCP `signal` tool
-- and the sizer that consumes it) and "this name's history" (a consumer tracking
-- whether a view persisted).
CREATE INDEX IF NOT EXISTS idx_book_signal_run_date ON book_signal (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_book_signal_asset ON book_signal (asset, run_date DESC);

COMMENT ON TABLE book_signal IS
    'The mandate-free research signal: names, sides, EdgeScore and conviction, with '
    'the thesis that argued each one. Contains NO weight, notional or capital base '
    'by design -- size these under your own mandate. conviction = |EdgeScore| / vol '
    'is a ratio and is identical at any capital base. Written before size_positions '
    'runs, so there is no sizing in scope to leak. See ADR-0148.';

COMMENT ON COLUMN book_signal.conviction IS
    '|EdgeScore| / max(vol, conviction_vol_floor). The mandate-free sizing input.';

COMMENT ON COLUMN book_signal.edge_score IS
    'NULL means the L1 pool did not score this name. It does NOT mean zero edge.';

-- Same posture as every other published table (cf. 043_pick_outcomes): the anon role
-- reads what the site already serves, and writes come from the service key the
-- pipeline holds.
ALTER TABLE book_signal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON book_signal
    FOR SELECT TO anon USING (true);
