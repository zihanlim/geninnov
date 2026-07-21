# Andromeda

Systematic market theme identification and trade generation platform.

## What this is

Andromeda ingests news and social media daily, scores themes by "hype" (attention × sentiment × market correlation × momentum), generates ranked long/short trade ideas, and sizes them into a $100M portfolio with risk metrics.

On top of the theme engine, an L5 AI reasoning agent synthesizes the L0–L4 deterministic inputs (macro regime, factor exposures, theme scores, risk) into a **$100M long-short book with a per-trade thesis** — the Q1 deliverable. Every numeric claim in the thesis is citation-verified against the L0–L4 inputs before it reaches the UI. See [§14 of the design spec](docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md) for the full Q1 reasoning pipeline, and [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the citation guardrail design.

The L5 agent supports a **`lens` parameter** that filters the candidate pool by asset class (e.g. `multi_asset`, `credit`, `rates`, `equity`, `fx`, `commodity`) and injects a lens-specific framing instruction into the LLM prompt. The frontend `/portfolio` and `/trades` pages expose this as a `<LensSelector>` segmented control. The credit lens is the natural fit for Andromeda Capital's mandate. See [ADR-0015](docs/adrs/0015-lens-mode-asset-class.md) for the design rationale.

## Architecture

- **Frontend**: Next.js 14 (TypeScript, Tailwind CSS) → Vercel (live at https://andromeda-analytics.vercel.app)
- **Database**: Supabase (PostgreSQL) — frontend reads directly via `@supabase/supabase-js`
- **Scoring pipeline**: Python `daily_refresh.py` script runs once/day at market close → writes to Supabase
- **Theme discovery**: `theme_discovery.py` runs at bootstrap and monthly
- **Cron**: cron-job.org (free) triggers `daily_refresh.py` daily

**No FastAPI, no Redis, no VPS for the backend** — see ADRs for why.

## Project docs

All project documentation lives under `docs/`:

| Path | Purpose |
|------|---------|
| `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` | Full design spec — architecture, scoring formulas, data model, frontend pages |
| `docs/superpowers/plans/2026-07-21-andromeda-implementation-plan.md` | Implementation plan — task-by-task build guide |
| `docs/adrs/` | Architecture Decision Records in im-Jarvis format |
| `docs/captures/` | Playwright screenshots of live frontend deployments |
| `docs/playwright-mcp/` | Playwright browser snapshots and console logs |

## Key source files

| Path | Purpose |
|------|---------|
| `scripts/daily_refresh.py` | Daily scoring pipeline (L1–L4 + L5 Q1 agent) |
| `scripts/theme_discovery.py` | Bootstrap + monthly theme discovery |
| `backend/data/macro_fetcher.py` | L0: FRED + yfinance macro snapshot |
| `backend/data/factor_fetcher.py` | L2: Ken French FF5 + UMD factor exposures |
| `backend/services/regime_classifier.py` | L3: Rule-based cycle × sentiment classifier |
| `backend/services/book_metrics.py` | L5: value-weighted FF5+UMD book tilts, sector/geo caps, correlation matrix |
| `backend/services/scenario_analysis.py` | L5: 4-scenario stress test (VIX/rates/USD/credit) |
| `backend/services/q1_agent.py` | L5: 8-node Q1 reasoning agent (`run_q1_agent`) |
| `frontend/app/research/page.tsx` | L6: Per-trade thesis writeup rendered on `/research` |
| `frontend/lib/supabase.ts` | Supabase client for frontend reads |
| `supabase/migrations/001_initial_schema.sql` | Full database schema (L1–L4 tables) |
| `supabase/migrations/005_macro_indicators.sql` | L0 macro_indicators + macro_daily_history |
| `supabase/migrations/006_factor_exposures.sql` | L2 factor_exposures table |
| `supabase/migrations/009_asset_class_lens.sql` | L5 lens mode — `asset_class` column on `theme_assets` |
| `frontend/components/LensSelector.tsx` | Lens toggle (multi-asset / credit / rates / equity / fx / commodity) |

## Running locally

```bash
# Backend
cd backend && pip install -r requirements.txt
python -m scripts.daily_refresh   # requires SUPABASE_URL + SUPABASE_SERVICE_KEY

# Frontend
cd frontend && npm install
npm run dev
```

## Environment variables

```bash
# Supabase (required for both backend and frontend)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key   # backend writes
NEXT_PUBLIC_SUPABASE_URL=...                  # frontend reads (anon key)
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Brave Search MCP (optional — falls back to mock data)
BRAVE_SEARCH_API_KEY=...

# Reddit PRAW (optional — falls back to mock data)
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT=Andromeda/1.0
```

## MCP tools

Use these to interact with external services directly:

- **Supabase MCP** (`plugin:supabase:supabase`): For all Supabase work — running SQL queries, checking table data, applying migrations, verifying data was seeded correctly. Authenticate once via browser OAuth flow.
- **Vercel MCP** (`plugin:vercel`): For Vercel work — listing projects, setting env vars, checking deployments, fetching build logs, triggering redeploys. Requires `vercel login` in the terminal first.
- **Playwright MCP** (`plugin:playwright`): For frontend verification — navigate to a URL, take a screenshot, check the page snapshot, inspect console errors. Use this whenever the user asks to "check if it's working" or "see the frontend".

```bash
# Typical verification flow with Playwright MCP:
# 1. Navigate to the URL
mcp__playwright__browser_navigate({ url: "https://..." })
# 2. Take a screenshot
mcp__playwright__browser_take_screenshot({ type: "png" })
# 3. Get the page snapshot
mcp__playwright__browser_snapshot({})
# 4. Check for console errors
mcp__playwright__browser_console_messages({ level: "error" })
```

## Scoring weights

All weights and lookbacks are stored in the `scoring_config` Supabase table — not hardcoded. To change how themes are scored, update the database, don't edit Python code.

## Q1 thesis pipeline (L0–L6)

The L5 agent (`backend/services/q1_agent.py`) is a deterministic-then-stochastic pipeline. Layers L0–L4 are pure functions — auditable, reproducible. Layer L5 is the only place an LLM (Claude Sonnet) is invoked. Layers L6–L7 render the result with citation provenance.

| Layer | Source | What it does |
|-------|--------|--------------|
| L0 | `backend/data/macro_fetcher.py` | FRED + yfinance → `macro_indicators` table |
| L1 | `scripts/daily_refresh.py` → `build_theme_signals` | Brave News + Reddit → HypeScore per theme |
| L2 | `backend/data/factor_fetcher.py` | Ken French FF5 + UMD → per-asset betas in `factor_exposures` |
| L3 | `backend/services/regime_classifier.py` | Yield curve + HY OAS + VIX → cycle × sentiment |
| L4 | `scripts/daily_refresh.py` → `compute_and_persist_risk` | VaR, CVaR, Sharpe, Beta, HHI → `portfolio_risk` |
| **L5** | `backend/services/q1_agent.py` | 8-node pipeline: aggregate → screen → compute book metrics → scenario analysis → reason_picks (LLM) → verify_citations → size_positions → persist |
| L6 | `frontend/app/research/page.tsx` | Per-trade thesis + book view rendered on `/research` |
| L7 | `frontend/components/{CitationList,ThemeDerivationDrawer,RegimeInputs}.tsx` | Citation footnotes + derivation audit trail |

The citation guardrail (verify_citations → retry → fallback) is the primary defense against LLM hallucination of macro numbers. See [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the design rationale.
