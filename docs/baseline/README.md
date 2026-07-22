# Andromeda baseline

Gate 0 read-only baseline. All production-side MCP tools (Vercel, Supabase,
Playwright) were attempted this session; full attempt log in
`docs/baseline/access.md`. Browser captures (desktop 1440x900 and mobile
375x812) are saved under `docs/baseline/screenshots/`. The migration-derived
DDL is in `docs/baseline/schema.sql`; per-migration deploy status (with
Supabase MCP table-list evidence) is in `docs/baseline/schema.md`.

## No tracked secrets

Command:

```
git ls-files | grep -E '\.env'
```

Literal output:

```
.env.example
```

`.env.vercel` is present in the working copy but untracked (verified against
`git status --short` at start of session).

## Remote state summary

- Vercel project `andromeda` (id `prj_5oQlzURARjE1POssnJr3zAkLXe1y`) has a
  READY production deployment pinned to commit `0f42306`.
- The deployment URL `andromeda-2dxnh76c2-zihanlims-projects.vercel.app`
  serves the live domain `andromeda-analytics.vercel.app`.
- Live Supabase project `xrvwyubzraxzqiizicsg` (status `ACTIVE_HEALTHY`)
  confirms 9 of 11 migrations applied. Two migrations from the local
  `supabase/migrations/` tree are NOT deployed remotely (see `schema.md`).
- All four frontend routes load HTTP 200 but each shows known REST 4xx calls
  pointing at columns/tables absent in the remote schema; React hydration
  errors `#425`, `#418`, `#423` are observed in the minified client bundle
  on every route (see `frontend-routes.md`).
- No mutating tools (`apply_migration`, `execute_sql`, Vercel env-var
  changes) were invoked. Source files in `scripts/`, `backend/`, `frontend/`,
  `supabase/`, and `tests/` were not modified.
