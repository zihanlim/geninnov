# Task 1 report

Status: DONE_WITH_CONCERNS

Captured Gate 0 baseline artifacts in `docs/baseline/` and committed them. Local migration-derived schema and import graph are recorded. Tracked-secret check confirmed only `.env.example`; `.env.vercel` remains untracked. Vercel and Supabase remote state were not verified in this session, and Playwright browser capture was skipped because `npx --no-install playwright --version` failed due to the package being unavailable. No production systems were mutated and no prohibited source files were changed.

## T1 Fixes

Reviewed baseline capture from prior agent identified that the previous
run had not actually attempted the MCP servers (`mcp__vercel__*`,
`mcp__plugin_supabase_supabase__*`, `mcp__plugin_playwright_playwright__*`).
This session re-attempted each of them and used real outputs to populate
the missing artifacts.

### Files touched

- `docs/baseline/access.md` (rewritten with verbatim MCP call logs)
- `docs/baseline/frontend-routes.md` (Vercel metadata + screenshots +
  snapshots table; corrupted dash character replaced with ASCII `-`)
- `docs/baseline/screenshots/` (created; 8 PNG + 3 YAML snapshots)
  - `home-desktop.png`, `home-mobile.png`
  - `trades-desktop.png`, `trades-mobile.png`
  - `research-desktop.png`, `research-mobile.png`
  - `portfolio-desktop.png`, `portfolio-mobile.png`
  - `home-desktop.yml`, `trades-desktop.yml`, `research-desktop.yml`,
    `portfolio-desktop.yml`
- `docs/baseline/schema.md` (now uses status vocabulary `applied`/`missing`/
  `present`, populated with Supabase MCP `list_tables` evidence)
- `docs/baseline/schema.sql` (regenerated as full migration-derived DDL;
  575 lines, all 11 migrations concatenated)
- `docs/baseline/pipeline-graph.md` (now includes the cited grep command +
  literal output)
- `docs/baseline/README.md` (tracked-secrets command + verbatim output;
  remote-state summary)
- `.superpowers/sdd/task-1-report.md` (this section)

No files in `scripts/`, `backend/`, `frontend/`, `supabase/`, or `tests/`
were modified.

### Vercel MCP outputs (verbatim, abridged)

Tool: `mcp__vercel__list_teams`

```json
{"teams":[{"name":"zihanlim's projects","slug":"zihanlims-projects","id":"team_UJvZ97xqD6F37xUGqCryIkJP","saml":{}}]}
```

Tool: `mcp__vercel__get_project` (projectId=prj_5oQlzURARjE1POssnJr3zAkLXe1y,
teamId=team_UJvZ97xqD6F37xUGqCryIkJP)

```json
{"id":"prj_5oQlzURARjE1POssnJr3zAkLXe1y","name":"andromeda","framework":"nextjs",
 "latestDeployment":{"id":"dpl_HSTbZAfzEc5tMoM8afRNux2wkWBv",
   "url":"andromeda-2dxnh76c2-zihanlims-projects.vercel.app",
   "createdAt":1784689451130,"readyState":"READY","target":"production"},
 "domains":["andromeda-analytics.vercel.app","andromeda-zihanlims-projects.vercel.app",
            "andromeda-git-main-zihanlims-projects.vercel.app"]}
```

Tool: `mcp__vercel__list_deployments` (same IDs) — newest production
deployment at index 0 is `dpl_HSTbZAfzEc5tMoM8afRNux2wkWBv`, state READY,
created `2026-07-22T04:24:11Z`, commit SHA
`0f4230677d28e3f5651ec2397b56fc0a2836b890`.

### Supabase MCP outputs

Tool: `mcp__plugin_supabase_supabase__list_projects`

The `list_projects` response contained the user's full project inventory; the
following is the **summary** (the unrelated first project is shown abridged;
the active Andromeda project is shown in full):

```json
{"projects":[
  {"id":"eonesficmbnlcrrbcvrr","name":"ai-phi-x","status":"INACTIVE", "<other-fields-abridged>"},
  {"id":"xrvwyubzraxzqiizicsg","name":"andromeda","status":"ACTIVE_HEALTHY",
   "region":"ap-northeast-2","created_at":"2026-07-20T17:53:47.292407Z",
   "database":{"host":"db.xrvwyubzraxzqiizicsg.supabase.co","version":"17.6.1.147"}
  }
]}
```

Tool: `mcp__plugin_supabase_supabase__list_tables` (project_id=xrvwyubzraxzqiizicsg,
schemas=["public"], verbose=true) — 16 tables returned: `themes`,
`theme_assets`, `theme_signals_history`, `trade_candidates`,
`portfolio_positions`, `portfolio_risk`, `portfolio_returns`,
`scoring_config`, `backtest_results`, `research_output`,
`macro_indicators`, `macro_daily_history`, `factor_exposures`,
`regime_classifications`, `research_recommendations`,
`research_agent_runs`. The `public.market_assets` and
`public.prediction_markets` tables are absent (migrations 010 and 011 not
applied remotely).

### Playwright MCP outputs (verbatim, abridged)

Tool: `mcp__plugin_playwright_playwright__browser_navigate`
url=https://andromeda-analytics.vercel.app/

```
Page URL: https://andromeda-analytics.vercel.app/
Page Title: Andromeda - Quantitative Macro Research
Console: 7 errors, 0 warnings
```

Notable per-route REST errors observed via `browser_network_requests`
and `browser_console_messages level=error`:

- `/`: `portfolio_factor_exposure` 404, `market_assets` 404, `favicon.ico` 404.
- `/research`: `research_recommendations?select=...book_metrics_summary,scenario_table`
  400, `regime_classifications?select=...,narrative` 400.
- `/portfolio`: `portfolio_factor_exposure` 404, `portfolio_risk?select=*` 400.
- `/trades`: no 4xx; all expected Supabase REST calls 200.

React hydration errors `#425`, `#418`, `#423` were observed on every route
in the minified client bundle.

### Verdicts

- Vercel MCP: reachable.
- Supabase MCP: reachable. Two local migrations (`010_market_assets.sql`,
  `011_prediction_markets.sql`) are NOT deployed remotely.
- Playwright MCP: reachable-with-finding (4xx REST calls and React
  hydration warnings present in production).

No mutating tool was invoked across any provider.

