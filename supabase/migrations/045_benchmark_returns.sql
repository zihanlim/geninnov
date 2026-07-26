-- 045_benchmark_returns.sql
--
-- A reference series to measure the book against.
--
-- Nothing on the site currently compares the book to anything. /risk draws a
-- cumulative-return curve and a drawdown, and a reader with the obvious next
-- question — "versus what?" — has nowhere to look. That is the largest
-- unanswered reader question on the page.
--
-- NO NEW FEED. `macro_daily_history` already stores `^SPX` as a daily LEVEL
-- (253 observations, 2025-07-23 → 2026-07-24) because the macro snapshot needs
-- it. This table is that column differenced into returns and compounded from
-- the book's own inception, so the comparison starts where the book starts.
-- `daily_refresh._load_spx_returns` separately downloads `^GSPC` at runtime for
-- the beta regression and discards it; that path is untouched here, and this
-- table deliberately does not depend on it — a persisted series should not be
-- hostage to whether a network call succeeded during tonight's run.
--
-- WHY A TABLE RATHER THAN DERIVING IT IN THE BROWSER. The frontend reads
-- Supabase directly with the anon key and has no compute step; differencing 253
-- levels and compounding them client-side would put a numeric method in the one
-- layer that cannot be tested against the pipeline, and goal 1 wants a figure to
-- trace to a persisted source rather than to arithmetic done on the way to the
-- screen. One row per (run_date, ticker), mirroring `portfolio_returns`.
--
-- `cumulative_return` is compounded from `inception_date`, which is the BOOK's
-- inception, not the series'. A benchmark measured over a different window than
-- the book is not a comparison, and storing it that way would let the chart
-- silently draw two curves that do not share an origin.
--
-- Written by scripts/daily_refresh.persist_benchmark_returns; read by
-- frontend/components/risk/DrawdownChart.tsx.
--
-- See docs/adrs/0094-a-benchmark-the-book-can-be-measured-against.md

BEGIN;

CREATE TABLE IF NOT EXISTS benchmark_returns (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date          DATE NOT NULL,
    ticker            TEXT NOT NULL,
    -- The level this row was derived from, kept so a reader can reconcile the
    -- return against macro_daily_history rather than taking it on faith.
    close_level       REAL,
    daily_return      REAL,
    -- Compounded from inception_date. NULL when it is not computable (the first
    -- observation has no prior close to difference against) — never 0, because
    -- "no return yet" and "a flat day" are different claims (ADR-0066).
    cumulative_return REAL,
    inception_date    DATE,
    observations      INT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (run_date, ticker)
);

CREATE INDEX IF NOT EXISTS benchmark_returns_run_date_idx
    ON benchmark_returns (run_date DESC);

COMMENT ON TABLE benchmark_returns IS
    'Reference series the book is measured against, derived from '
    'macro_daily_history levels rather than a new feed. cumulative_return is '
    'compounded from the BOOK''s inception so both curves share an origin.';

COMMENT ON COLUMN benchmark_returns.cumulative_return IS
    'Compounded from inception_date. NULL when not computable — never 0.';

ALTER TABLE benchmark_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read benchmark_returns" ON benchmark_returns;
CREATE POLICY "Public read benchmark_returns" ON benchmark_returns
    FOR SELECT TO anon USING (true);

COMMIT;
