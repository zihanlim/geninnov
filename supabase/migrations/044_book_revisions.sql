-- 044_book_revisions.sql
--
-- Records that a PUBLISHED book changed, and what it changed from.
--
-- WHY. `research_recommendations` is written with
-- `upsert(..., on_conflict="run_date")` (q1_agent._persist_to_supabase). A second run for
-- the same run_date therefore REPLACES the published book in place, and no prior version
-- survives anywhere. A dated publication whose numbers can change silently cannot be
-- cited: a reader who quoted yesterday's gross exposure has no way to tell whether the
-- figure they are looking at now is the one they read.
--
-- THIS IS NOT HYPOTHETICAL, and the scale is the argument. `research_agent_runs` retains
-- one row per agent invocation, and on 2026-07-26 it held **17 runs for run_date
-- 2026-07-25** spanning 16.7 hours, **25 for 2026-07-24**, and 70 across the four
-- published books. Every one of those that reached persist overwrote the book for its
-- run_date. Worse, the runs did not agree: the 04:24 run produced the published book
-- (ARKK/BABA/GDX/NOC/NUE/PDD/SHY/SVXY/UNH/XLE) while the LATEST run at 09:04 proposed a
-- materially different one (short FXI/KWEB/MCHI, long BIL/EWJ/TLT) and was correctly
-- refused by the citation guardrail with `verified = false`. The right book is live. What
-- is missing is any record that the choice was made.
--
-- WHAT THIS TABLE IS NOT. It is not a full version history — it does not snapshot the
-- whole prior book, because storing every superseded $100M book keyed by a date that gets
-- overwritten 17 times a day is a different and much larger decision. It records the
-- FACT of a change, per field, with the previous and new value of that field, so a reader
-- who quoted a figure can find out that it moved and by how much.
--
-- WHY `reason` IS NOT NULLABLE. A revision with no stated cause is the shape that lets a
-- silent overwrite look like an ordinary update — the same failure `pick_outcomes`
-- guards with `void_requires_reason` (ADR-0090) and `assessStaleness` guards with
-- `unjudgeableReason`. If the writer cannot say why the book changed, the honest entry is
-- "unattributed pipeline re-run", which is itself informative.

CREATE TABLE IF NOT EXISTS book_revisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The published book that changed. Not unique: one run_date accumulates one row per
    -- field per revision, which is the point.
    run_date        DATE NOT NULL,

    -- Dotted path within research_recommendations, e.g. `book_metrics.gross_exposure`,
    -- `picks[].asset`, `scenario_results`. The same `table.column` vocabulary every
    -- citation on the site already uses, so a reader can match a revision to the figure
    -- they quoted.
    field           TEXT NOT NULL,

    -- Rendered for a reader, not serialised for a machine: `previous_value` is what the
    -- page said before and `new_value` is what it says now. Text because a field may be a
    -- number, a ticker, a count, or a summary of a list.
    previous_value  TEXT,
    new_value       TEXT,

    -- Why the book changed.
    --   pipeline_rerun       — the daily job ran again for the same run_date and upserted.
    --   manual_correction    — a human or an agent changed a published value deliberately.
    --   backfill             — a field added to an already-published row (e.g. a new
    --                          analytic computed after the fact).
    trigger_type    TEXT NOT NULL
                    CHECK (trigger_type IN ('pipeline_rerun', 'manual_correction', 'backfill')),

    -- NOT NULL by design. See the header: an unexplained revision is indistinguishable
    -- from a silent overwrite, which is the thing this table exists to make impossible.
    reason          TEXT NOT NULL CHECK (length(trim(reason)) > 0),

    -- Where the justification lives: an ADR path, a commit sha, a run id. Free text
    -- because the useful pointer differs per revision, but stating one is the norm.
    evidence        TEXT,

    -- Who or what made the change (a script name, `manual`, an agent run id).
    actor           TEXT,

    revised_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_book_revisions_run_date ON book_revisions (run_date DESC, revised_at DESC);

-- Same shape and policy name as the other twenty-three tables, so a future
-- `grep "Public read"` finds a complete list. A correction log that only the operator can
-- read defeats its own purpose.
ALTER TABLE book_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON book_revisions
    FOR SELECT TO anon USING (true);

COMMENT ON TABLE book_revisions IS
    'Per-field record that a published book changed: run_date, field, previous/new value, trigger, reason (NOT NULL), evidence. Written by the pipeline on an overwrite and by hand for a deliberate correction. RLS: anon may SELECT only. See ADR-0093.';
COMMENT ON COLUMN book_revisions.reason IS
    'Required. An unexplained revision is indistinguishable from a silent overwrite, which is what this table exists to prevent. "unattributed pipeline re-run" is a valid and informative reason.';
COMMENT ON COLUMN book_revisions.field IS
    'Dotted path inside research_recommendations, in the same table.column vocabulary the citations use, so a reader can match a revision to a figure they quoted.';
