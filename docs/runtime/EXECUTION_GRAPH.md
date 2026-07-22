# L5 Execution Graph & Orphan Verdict

**Task:** 16 — Confirm canonical L5 path and orphan `backend.agents.research_agent`
**Date:** 2026-07-22

## Verdict

> **Canonical L5:** `backend.services.q1_agent.run_q1_agent` (invoked by `scripts/daily_refresh.py:run_q1_agent`).
> **Orphan:** `backend/agents/research_agent.py` — no production caller; CLI-only; covered by `tests/backend/test_research_agent.py` for backward behavior.

## Import-graph evidence

### Step 1 — narrow grep for `q1_agent` / `research_agent` imports

Command:
```bash
git grep -nE "from backend\.services\.q1_agent|from backend\.agents\.research_agent|from services\.q1_agent" -- scripts/ backend/
```

Output:
```
Binary file backend/agents/__pycache__/research_agent.cpython-313.pyc matches
backend/agents/research_agent.py:13:    from backend.agents.research_agent import ResearchState, run_research_pipeline
backend/services/q1_agent.py:27:    from services.q1_agent import run_q1_agent
scripts/daily_refresh.py:517:        from services.q1_agent import run_q1_agent
```

Reading of the matches:

- `scripts/daily_refresh.py:517` — the production caller. This is the daily cron entrypoint that drives the L5 reasoning pipeline.
- `backend/services/q1_agent.py:27` — a self-reference (the module's own `__main__`/CLI guard). Not a production caller.
- `backend/agents/research_agent.py:13` — the orphan module imports its own symbols (self-reference). Not a production caller.

### Step 2 — broader grep for any `research_agent` reference

Command:
```bash
git grep -nE "research_agent" -- scripts/ backend/ frontend/ tests/ supabase/ .github/ docs/
```

Output (truncated to non-administrative matches):
```
Binary file backend/agents/__pycache__/research_agent.cpython-313.pyc matches
backend/agents/research_agent.py:13:    from backend.agents.research_agent import ResearchState, run_research_pipeline
backend/agents/research_agent.py:372:    run_resp = supabase.table("research_agent_runs").insert(agent_run).execute()
backend/services/q1_agent.py:1034:        sb.table("research_agent_runs").insert({
frontend/app/research/page.tsx:224:            .from("research_agent_runs")
supabase/migrations/006_factor_exposures.sql:54:CREATE TABLE IF NOT EXISTS research_agent_runs (
supabase/migrations/006_factor_exposures.sql:68:ALTER TABLE research_agent_runs ENABLE ROW LEVEL SECURITY;
supabase/migrations/006_factor_exposures.sql:69:CREATE POLICY "Public read" ON research_agent_runs FOR SELECT TO anon USING (true);
supabase/migrations/006_factor_exposures.sql:74:COMMENT ON TABLE research_agent_runs IS 'Research agent run audit log (L5)';
supabase/migrations/008_rename_q1_tables.sql:7:ALTER TABLE q1_agent_runs RENAME TO research_agent_runs;
supabase/migrations/008_rename_q1_tables.sql:8:ALTER POLICY "Public read" ON research_agent_runs RENAME TO "Public read research_agent_runs";
tests/backend/test_research_agent.py:5:Run with: pytest tests/backend/test_research_agent.py -v
tests/backend/test_research_agent.py:403:# ─── MockLLMProvider (from backend/agents/research_agent.py) ─────────────────
tests/backend/test_research_agent.py:408:    from backend.agents.research_agent import MockLLMProvider
tests/backend/test_research_agent.py:421:    from backend.agents.research_agent import MockLLMProvider
```

Reading of the matches:

- `scripts/`, `backend/` (production code), `frontend/`, `tests/`, `supabase/` — no production caller of `backend.agents.research_agent`. The only references are:
  - The module itself (`backend/agents/research_agent.py`).
  - `tests/backend/test_research_agent.py` — a test suite that exercises the orphan for backward behavior.
  - `supabase/migrations/` — schema artifacts (the `research_agent_runs` table that was renamed from `q1_agent_runs` in migration 008). The rename was a label-only change; the canonical L5 continues to write to this table via `backend/services/q1_agent.py`.
  - `frontend/app/research/page.tsx` — reads from `research_agent_runs` (the audit-log table), not from the agent module.
  - `backend/services/q1_agent.py:1034` — the canonical L5 also writes to `research_agent_runs`. So the surviving `research_agent_runs` table is the canonical L5's audit log; only the table name is legacy.
- `.github/`, `docs/` (excluding this file and the remediation plan) — no scheduler / cron / CI reference to `research_agent`.

### Step 3 — external scheduler check

No match for `research_agent` in `.github/`, `*.yml`, `*.yaml`, or `*.sh` outside the remediation plan, the ADR/history docs, and the orphan's own source. Confirmed: no external scheduler invokes `backend.agents.research_agent`.

## Conclusion

| Path | Role | Caller |
|------|------|--------|
| `backend.services.q1_agent.run_q1_agent` | **Canonical L5** | `scripts/daily_refresh.py` (production cron) |
| `backend/agents/research_agent.py` | **Orphan** | None (CLI-only); legacy test coverage in `tests/backend/test_research_agent.py` |

The canonical L5 reasoning agent is `backend.services.q1_agent.run_q1_agent`. The `backend.agents.research_agent` module has no production caller and is safe to consider for removal in Task 17.
