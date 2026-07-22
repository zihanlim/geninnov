-- 017_run_date_and_pipeline_defaults.sql
--
-- Two fixes found by running the pipeline against production.
--
-- (1) trade_candidates and portfolio_positions have no run_date, only
--     updated_at. When a run produces no qualifying candidates it writes
--     nothing, and the previous run's rows stay in place with no marker
--     saying which run produced them. The frontend cannot tell today's book
--     from a two-day-old one, so stale rows render as current. Production hit
--     exactly this: a run on 2026-07-23 produced zero candidates while ten
--     rows from 2026-07-21 kept being served.
--
-- (2) pipeline_runs.started_at is NOT NULL with no default. The terminal
--     status upsert sends only finished_at, so PostgREST rejects the payload
--     as an insert candidate and every stage stayed stuck at 'partial'. The
--     call site swallowed the error, making it invisible.

-- (1) run_date on the two book tables ---------------------------------------

ALTER TABLE trade_candidates
    ADD COLUMN IF NOT EXISTS run_date DATE;

ALTER TABLE portfolio_positions
    ADD COLUMN IF NOT EXISTS run_date DATE;

-- Backfill from updated_at so existing rows are attributable rather than null.
UPDATE trade_candidates
SET run_date = COALESCE(run_date, (updated_at AT TIME ZONE 'UTC')::date)
WHERE run_date IS NULL;

UPDATE portfolio_positions
SET run_date = COALESCE(run_date, (updated_at AT TIME ZONE 'UTC')::date)
WHERE run_date IS NULL;

ALTER TABLE trade_candidates
    ALTER COLUMN run_date SET DEFAULT CURRENT_DATE;

ALTER TABLE portfolio_positions
    ALTER COLUMN run_date SET DEFAULT CURRENT_DATE;

CREATE INDEX IF NOT EXISTS trade_candidates_run_date_idx
    ON trade_candidates (run_date DESC);

CREATE INDEX IF NOT EXISTS portfolio_positions_run_date_idx
    ON portfolio_positions (run_date DESC);

COMMENT ON COLUMN trade_candidates.run_date IS
    'Pipeline run that produced this candidate. Readers must filter on the latest run_date rather than assuming every row is current.';

COMMENT ON COLUMN portfolio_positions.run_date IS
    'Pipeline run that produced this position. Readers must filter on the latest run_date rather than assuming every row is current.';

-- (2) let the terminal pipeline_runs upsert validate ------------------------

ALTER TABLE pipeline_runs
    ALTER COLUMN started_at SET DEFAULT NOW();
