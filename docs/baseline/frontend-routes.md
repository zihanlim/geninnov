# Frontend route baseline

Captured by Playwright MCP at the production URL. Source data from
`mcp__vercel__get_project`; route-level telemetry from
`mcp__plugin_playwright_playwright__browser_*`.

## Vercel project & deployment metadata

| field | value |
|---|---|
| Vercel project id | `prj_5oQlzURARjE1POssnJr3zAkLXe1y` |
| Vercel project name | `andromeda` |
| Vercel framework | `nextjs` |
| Vercel nodeVersion | `24.x` |
| Production URL (live domain) | `https://andromeda-analytics.vercel.app` |
| Latest production commit SHA | `0f4230677d28e3f5651ec2397b56fc0a2836b890` |
| Latest production commit message | `chore: remove tracked __pycache__ + gitignore debug scripts` |
| Latest deployment id | `dpl_HSTbZAfzEc5tMoM8afRNux2wkWBv` |
| Latest deployment url | `andromeda-2dxnh76c2-zihanlims-projects.vercel.app` |
| Latest deployment readyState | `READY` |
| Last successful build time (ms epoch) | `1784689451130` (`2026-07-22T04:24:11Z`) |
| Domains | `andromeda-analytics.vercel.app`, `andromeda-zihanlims-projects.vercel.app`, `andromeda-git-main-zihanlims-projects.vercel.app` |

The Vercel latestDeployment row returned by `get_project` reports
`live: false` even though `readyState: READY`. This is a known Vercel-API
artifact and is unrelated to whether the deployment serves traffic; independent
HTTP+Playwright fetch of `https://andromeda-analytics.vercel.app` succeeded.

Historical ERROR deployments (e.g. `167bdd7`, `92034d8`) on production target
are present in `list_deployments`; these are superseded rebuilds and not the
currently-served commit.

## Route captures (Playwright MCP)

| Route | Source page | Screenshot (1440x900 full-page) | Screenshot (375x812 full-page) | Snapshot (.yml) | Data load state | Console / network findings |
|---|---|---|---|---|---|---|
| `/` | `frontend/app/page.tsx` | `docs/baseline/screenshots/home-desktop.png` | `docs/baseline/screenshots/home-mobile.png` | `docs/baseline/screenshots/home-desktop.yml` | Page title `Andromeda - Quantitative Macro Research`. Supabase REST 200s on `themes`, `trade_candidates`, `regime_classifications`. | 2 REST 404s: `portfolio_factor_exposure` (table absent), `market_assets` (migration 010 not deployed). `favicon.ico` 404. React hydration errors #425, #418, #423 observed in minified client bundle. |
| `/trades` | `frontend/app/trades/page.tsx` | `docs/baseline/screenshots/trades-desktop.png` | `docs/baseline/screenshots/trades-mobile.png` | `docs/baseline/screenshots/trades-desktop.yml` | Title set; `trade_candidates` 200 (joined with `themes(name)`). | React hydration errors #425/#418/#423; no 4xx REST observed on this route. |
| `/research` | `frontend/app/research/page.tsx` | `docs/baseline/screenshots/research-desktop.png` | `docs/baseline/screenshots/research-mobile.png` | `docs/baseline/screenshots/research-desktop.yml` | Page title set, but Q1 / RegimenInputs panels could not load data. | `research_recommendations?select=...book_metrics_summary,scenario_table` returns **400** (columns not present). `regime_classifications?select=...,narrative` returns **400** (`narrative` column absent). React hydration errors #425/#418/#423. |
| `/portfolio` | `frontend/app/portfolio/page.tsx` | `docs/baseline/screenshots/portfolio-desktop.png` | `docs/baseline/screenshots/portfolio-mobile.png` | `docs/baseline/screenshots/portfolio-desktop.yml` | Page title set; `portfolio_positions` 200. | `portfolio_risk?select=*` returns **400** (column not allowed by RLS / ordering issue). `portfolio_factor_exposure` returns **404** (table absent). React hydration errors #425/#418/#423. |

All routes loaded with HTTP 200; no 5xx observed. Supabase REST errors above
are 4xx originating on the frontend anon-key REST calls and are corroborated
by `list_tables` results (see `schema.md`).

### Per-route console output (verbatim, end errors only)

`/research` console errors (`browser_console_messages level=error`):

```
[ERROR] Failed to load resource: the server responded with a status of 400 () @ https://xrvwyubzraxzqiizicsg.supabase.co/rest/v1/research_recommendations?select=run_date%2Cpicks%2Cbook_view%2Cbook_risks%2Cagent_run_id%2Cbook_metrics_summary%2Cscenario_table&order=run_date.desc&limit=1:0
[ERROR] Failed to load resource: the server responded with a status of 400 () @ https://xrvwyubzraxzqiizicsg.supabase.co/rest/v1/regime_classifications?select=cycle%2Csentiment%2Cnarrative&order=run_date.desc&limit=1:0
Error: Minified React error #425 ... at sq ...
Error: Minified React error #425 ... at sq ...
Error: Minified React error #418 ...
Error: Minified React error #423 ...
```

`/portfolio` console errors:

```
[ERROR] Failed to load resource: the server responded with a status of 404 () @ https://xrvwyubzraxzqiizicsg.supabase.co/rest/v1/portfolio_factor_exposure?select=*&order=run_date.desc&limit=1:0
[ERROR] Failed to load resource: the server responded with a status of 400 () @ https://xrvwyubzraxzqiizicsg.supabase.co/rest/v1/portfolio_risk?select=*&order=run_date.desc&limit=1:0
Error: Minified React error #425 ... at sq ...
Error: Minified React error #425 ... at sq ...
Error: Minified React error #418 ...
Error: Minified React error #423 ...
```

### Per-route REST telemetry (excerpts from `browser_network_requests`)

- `/research` notable REST: `research_recommendations` 400, `regime_classifications` 400.
- `/portfolio` notable REST: `portfolio_factor_exposure` 404, `portfolio_risk` 400; `portfolio_positions` 200, `theme_assets` 200.
- `/` notable REST: `portfolio_factor_exposure` 404, `market_assets` 404; `themes` 200, `trade_candidates` 200.
- `/trades` notable REST: `trade_candidates?select=*%2Cthemes%28name%29` 200; `theme_assets?select=ticker%2Casset_class` 200; no 4xx.

---

ASCII-only formatting throughout. No Unicode replacement characters.
