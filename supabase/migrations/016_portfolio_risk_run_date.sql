-- 016_portfolio_risk_run_date.sql
--
-- `portfolio_risk` was created without a `run_date`, but the pipeline persists
-- it with `.upsert(row, on_conflict="run_date")`
-- (scripts/daily_refresh.py, compute_and_persist_risk). With no such column the
-- upsert raises, the except branch falls back to a plain INSERT, and every run
-- appends another row instead of replacing the day's row. Production reached
-- the point where the only row present was operator-seeded and no pipeline run
-- could displace it.
--
-- Adding run_date + a UNIQUE constraint makes the upsert path work as written
-- and gives one risk row per day, which is also what a historical risk series
-- needs.

ALTER TABLE portfolio_risk
    ADD COLUMN IF NOT EXISTS run_date DATE;

-- Backfill any pre-existing rows from updated_at so the NOT NULL/UNIQUE
-- constraints below can be applied without dropping data.
UPDATE portfolio_risk
SET run_date = COALESCE(run_date, (updated_at AT TIME ZONE 'UTC')::date)
WHERE run_date IS NULL;

-- Collapse any duplicate rows that the INSERT-fallback path may already have
-- created, keeping the most recently updated row per day.
DELETE FROM portfolio_risk a
USING portfolio_risk b
WHERE a.run_date = b.run_date
  AND a.updated_at < b.updated_at;

ALTER TABLE portfolio_risk
    ALTER COLUMN run_date SET DEFAULT CURRENT_DATE;

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_risk_run_date_key
    ON portfolio_risk (run_date);

COMMENT ON COLUMN portfolio_risk.run_date IS
    'Pipeline run date this risk snapshot belongs to. UNIQUE so daily_refresh can upsert one row per day.';
