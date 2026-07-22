# Baseline access record — MCP attempts log

This file records the actual tool calls made this session against the MCP
servers listed in `CLAUDE.md`. Verbatim responses are quoted in fenced code
blocks; each section ends with a verdict ("reachable" / "reachable-with-finding"
/ "not reachable").

---

## Vercel MCP

Tool: `mcp__vercel__list_teams`

```json
{
  "teams": [
    {
      "name": "zihanlim's projects",
      "slug": "zihanlims-projects",
      "id": "team_UJvZ97xqD6F37xUGqCryIkJP",
      "saml": {}
    }
  ]
}
```

Verdict: **reachable**. Used for downstream project/deployment reads.

Tool: `mcp__vercel__list_projects` (with `teamId="team_UJvZ97xqD6F37xUGqCryIkJP"`)

Project `andromeda` resolved to id `prj_5oQlzURARjE1POssnJr3zAkLXe1y`.

Tool: `mcp__vercel__list_deployments` (with `projectId="prj_5oQlzURARjE1POssnJr3zAkLXe1y"`)

Returned a paginated list of 20 deployments. The newest entry (production, READY):

```json
{
  "id": "dpl_HSTbZAfzEc5tMoM8afRNux2wkWBv",
  "url": "andromeda-2dxnh76c2-zihanlims-projects.vercel.app",
  "created": 1784689451130,
  "state": "READY",
  "target": "production",
  "meta": {
    "githubCommitSha": "0f4230677d28e3f5651ec2397b56fc0a2836b890",
    "githubCommitMessage": "chore: remove tracked __pycache__ + gitignore debug scripts\n..."
  }
}
```

Tool: `mcp__vercel__get_project` (with same IDs)

```json
{
  "id": "prj_5oQlzURARjE1POssnJr3zAkLXe1y",
  "name": "andromeda",
  "framework": "nextjs",
  "nodeVersion": "24.x",
  "live": false,
  "latestDeployment": {
    "id": "dpl_HSTbZAfzEc5tMoM8afRNux2wkWBv",
    "url": "andromeda-2dxnh76c2-zihanlims-projects.vercel.app",
    "createdAt": 1784689451130,
    "readyState": "READY",
    "target": "production"
  },
  "domains": [
    "andromeda-analytics.vercel.app",
    "andromeda-zihanlims-projects.vercel.app",
    "andromeda-git-main-zihanlims-projects.vercel.app"
  ]
}
```

Verdict: **reachable**. Full metadata captured in `frontend-routes.md`.

Note: `latestDeployment` field shows `state=READY`, but Vercel side-channels and
later deployments contained `state=ERROR` rows on `167bdd7` and other SHAs before
`3366c34`. The current production alias points at `0f42306` (READY), so the
errors above are historical rebuild noise and not the live state. Independent
HTTP fetch via Playwright (see Playwright section below) confirms the page
returns `Page Title: Andromeda — Quantitative Macro Research`.

---

## Supabase MCP

Tool: `mcp__plugin_supabase_supabase__list_projects`

```json
{
  "projects": [
    {"id":"eonesficmbnlcrrbcvrr","name":"ai-phi-x","region":"ap-south-1","status":"INACTIVE", ...},
    {"id":"xrvwyubzraxzqiizicsg","name":"andromeda","region":"ap-northeast-2","status":"ACTIVE_HEALTHY","database":{"host":"db.xrvwyubzraxzqiizicsg.supabase.co","version":"17.6.1.147"}, "created_at":"2026-07-20T17:53:47.292407Z"}
  ]
}
```

The active Andromeda project is `xrvwyubzraxzqiizicsg` (`ACTIVE_HEALTHY`).

Tool: `mcp__plugin_supabase_supabase__list_tables` (with `project_id="xrvwyubzraxzqiizicsg"`, `schemas=["public"]`, `verbose=true`)

Returned 17 tables in the `public` schema. Verbatim table list (truncated
column detail; full output was used to populate `schema.md`):

- themes (8 rows)
- theme_assets (29 rows)
- theme_signals_history (16 rows)
- trade_candidates (10 rows)
- portfolio_positions (10 rows)
- portfolio_risk (1 row)
- portfolio_returns (5 rows)
- scoring_config (13 rows)
- backtest_results (0 rows)
- research_output (3 rows)
- macro_indicators (12 rows)
- macro_daily_history (2,540 rows)
- factor_exposures (11 rows)
- regime_classifications (1 row)
- research_recommendations (1 row)
- research_agent_runs (7 rows)

Two migration tables are **absent** from this list:

- `market_assets` — defined in `supabase/migrations/010_market_assets.sql`, not deployed
- `prediction_markets` — defined in `supabase/migrations/011_prediction_markets.sql`, not deployed

Verdict: **reachable**. Two tables from migrations 010/011 are missing in the
remote `public` schema. This is corroborated by live 404s on
`/rest/v1/market_assets` observed during Playwright capture (see
`frontend-routes.md`).

No `apply_migration`, `execute_sql`, or other mutating tools were invoked.

---

## Playwright MCP

Tools exercised: `mcp__plugin_playwright_playwright__browser_resize`,
`browser_navigate`, `browser_wait_for`, `browser_take_screenshot`,
`browser_snapshot`, `browser_console_messages`, `browser_network_requests`,
`browser_close`.

All four routes (`/`, `/trades`, `/research`, `/portfolio`) loaded with status
200 and rendered DOM content. Console errors observed across all routes include
React hydration mismatches (minified errors #425/#418/#423) and 4xx responses
on Supabase REST calls. Details per route are recorded in
`docs/baseline/frontend-routes.md`.

Verdict: **reachable-with-finding**. All pages render, but each exhibits
4xx Supabase REST calls (`market_assets` 404, `portfolio_risk` 400,
`regime_classifications` 400 on `/research`, `research_recommendations` 400 on
`/research`) and React hydration errors. Screenshots, snapshots, and console
messages captured to `docs/baseline/screenshots/`.

---

## Summary

- Vercel MCP: reachable.
- Supabase MCP: reachable; 010 and 011 not applied remotely.
- Playwright MCP: reachable; full route captures on disk.
- No mutating tools invoked across any provider.
