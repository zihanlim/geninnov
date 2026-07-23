-- 021_discovered_themes.sql
-- Shadow store for two-method theme discovery (LDA ∩ embedding clustering).
-- theme_discovery.py previously only printed topic/cluster counts to stdout and
-- never persisted; the agreement step wasn't implemented. It now writes Tier 2
-- (both methods agree) and Tier 3 (single method) candidates here.
--
-- SHADOW MODE (RESIDUAL R5): candidates are NOT auto-promoted into the live
-- `themes` table. An operator reviews rows here and promotes by hand (status
-- shadow → promoted / rejected).

BEGIN;

CREATE TABLE IF NOT EXISTS discovered_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    label TEXT NOT NULL,
    terms JSONB,                       -- top terms that define the candidate
    tier SMALLINT NOT NULL CHECK (tier IN (2, 3)),
    methods JSONB,                     -- ['lda','embedding'] | ['lda'] | ['embedding']
    corpus_size INTEGER,
    status TEXT NOT NULL DEFAULT 'shadow' CHECK (status IN ('shadow', 'promoted', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (run_date, label)
);

CREATE INDEX IF NOT EXISTS discovered_themes_run_date_idx ON discovered_themes (run_date DESC);

ALTER TABLE discovered_themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read discovered_themes" ON discovered_themes;
CREATE POLICY "Public read discovered_themes" ON discovered_themes FOR SELECT TO anon USING (true);

COMMENT ON TABLE discovered_themes IS
    'Shadow-mode theme-discovery candidates (LDA ∩ embedding agreement). '
    'Not auto-promoted — see RESIDUAL R5 and scripts/theme_discovery.py.';

COMMIT;
