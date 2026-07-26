-- 040_rls_on_pipeline_runs_and_cumulative_return.sql
--
-- Closes the two tables that shipped without Row Level Security.
--
-- FOUND BY THE SUPABASE ADVISOR, not by reading the migrations — which is the
-- point worth recording. Twenty tables in this schema carry
-- `ENABLE ROW LEVEL SECURITY` plus a "Public read" policy, applied in the
-- migration that created them. These two did not: `pipeline_runs` (migration
-- 012) and `portfolio_cumulative_return` (migration 014) were both added
-- without either line, and nothing failed, because the anon role's default
-- grant already let the frontend read them. A missing security control does not
-- announce itself; it just works.
--
-- WHAT WAS ACTUALLY EXPOSED. The anon key is published in the client bundle by
-- design — it is meant to be public, with RLS as the thing that makes that safe.
-- With RLS off, that key was not read-only on these two tables: anyone could
-- INSERT, UPDATE or DELETE rows. Concretely, a stranger could have written a
-- fake `pipeline_runs` row and made the status ribbon and /method/evidence
-- report a green run that never happened, or rewritten
-- `portfolio_cumulative_return` and changed the since-inception performance
-- number on /risk. For a product whose entire claim is that its numbers are
-- auditable, a writable audit log is the worst-shaped hole available.
--
-- BOTH HALVES IN ONE MIGRATION, deliberately. `ENABLE ROW LEVEL SECURITY` with
-- no policy denies everything to anon — it does not "lock writes and keep
-- reads". Shipping the ALTER alone would black out the status ribbon on every
-- page, /method/evidence, and the /ask agent's pipeline_status tool, and the
-- cumulative-return panel on /risk. The advisor's remediation SQL is only the
-- first half for exactly this reason, and applying it on its own would trade a
-- security bug for an outage.
--
-- WRITES ARE UNAFFECTED. Every writer to these tables is the Python pipeline
-- (`backend/services/pipeline_runs.py::record_pipeline_run`,
-- `scripts/daily_refresh.py`), which authenticates with SUPABASE_SERVICE_KEY.
-- service_role bypasses RLS entirely, so the daily job neither knows nor cares
-- that this changed. The frontend has never written to either table.

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_cumulative_return ENABLE ROW LEVEL SECURITY;

-- Same shape and same name as the other twenty, so a future `grep "Public read"`
-- finds a complete list rather than a partial one.
CREATE POLICY "Public read" ON pipeline_runs
    FOR SELECT TO anon USING (true);
CREATE POLICY "Public read" ON portfolio_cumulative_return
    FOR SELECT TO anon USING (true);

COMMENT ON TABLE pipeline_runs IS
    'Per-stage pipeline execution audit (run_id, stage, status, duration_s, source_freshness). RLS: anon may SELECT only; the pipeline writes with the service key.';
COMMENT ON TABLE portfolio_cumulative_return IS
    'L4-derived cumulative portfolio return since inception, one row per as_of date. Upserted daily by scripts/daily_refresh.py with the service key. RLS: anon may SELECT only.';
