# Andromeda

Systematic market theme identification and trade generation platform.

## 🚨 Doc Sync Rule — MANDATORY (read first, every session)

This project has **four living documents** that must stay in lockstep with the code. Before you finish any non-trivial change, walk this checklist. Skipping it is a bug.

| When you change... | Also update... |
|---|---|
| Any service, API, table, layer, LLM call, cron trigger, edge in the system | **`ARCHITECTURE.md`** — edit the [System Architecture Diagram](./ARCHITECTURE.md#system-architecture-diagram) mermaid block in the same change. Add/remove/move the node, edge, subgraph, or table. The diagram is the canonical wiring view; prose sections in this file or `PROGRESS.md` are not a substitute. |
| Any layer, scoring formula, data model, or new ADR-worthy decision | **`ARCHITECTURE.md`** — also update the `## Layers` table, `## Supabase Tables` table, and the `## Feature Checklist` at the bottom of that file. |
| Any non-trivial change worth remembering tomorrow | **`PROGRESS.md`** — append a dated row to the `## Completed` table and, if a build task flips state, the `## Build tasks` table. |
| Any architecturally significant decision (new service, technology swap, schema change, security/guardrail change, new layer) | **A new ADR** in `docs/adrs/` using the im-Jarvis format (Context / Decision / Consequences), with the next available `NNNN-` prefix, and add it to the index in `docs/adrs/README.md`. |
| The system architecture itself (you add a layer, rename a service, change the LLM provider, add a new external API) | **A new ADR** is non-negotiable. Architecture shifts without ADRs rot. |

**Quick rule of thumb:** if a future agent reading the repo in 6 months would look at the diagram and learn something wrong, the diagram is wrong. Fix it before you commit.

**The four doc surfaces, in priority order:**
1. `ARCHITECTURE.md` — system architecture (mermaid diagram + tables + checklist)
2. `PROGRESS.md` — what got built, when, and what's still pending
3. `docs/adrs/NNNN-*.md` — *why* a decision was made (immutable once written; new decisions get new ADRs)
4. `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` — the full design spec; update §s whose content you changed

**When in doubt, update the diagram first.** Everything else can be derived from it; the diagram cannot be derived from anything else.

## What this is

Andromeda ingests news and social media daily, scores themes by "hype" (attention × sentiment × market correlation × momentum), generates ranked long/short trade ideas, and sizes them into a $100M portfolio with risk metrics.

On top of the theme engine, an L5 AI reasoning agent synthesizes the L0–L4 deterministic inputs (macro regime, factor exposures, theme scores, risk) into a **$100M long-short book with a per-trade thesis** — the Q1 deliverable. Every numeric claim in the thesis is citation-verified against the L0–L4 inputs before it reaches the UI. See [§14 of the design spec](docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md) for the full Q1 reasoning pipeline, and [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the citation guardrail design.

The L5 agent supports a **`lens` parameter** that filters the candidate pool by asset class (e.g. `multi_asset`, `credit`, `rates`, `equity`, `fx`, `commodity`) and injects a lens-specific framing instruction into the LLM prompt. The frontend `/portfolio` and `/trades` pages expose this as a `<LensSelector>` segmented control. The credit lens is the natural fit for Andromeda Capital's mandate. See [ADR-0015](docs/adrs/0015-lens-mode-asset-class.md) for the design rationale.

## Architecture

- **Frontend**: Next.js 14 (TypeScript, Tailwind CSS) → Vercel (live at https://andromeda-analytics.vercel.app)
- **Database**: Supabase (PostgreSQL) — frontend reads directly via `@supabase/supabase-js`
- **Scoring pipeline**: Python `daily_refresh.py` script runs once/day at market close → writes to Supabase
- **Theme discovery**: `theme_discovery.py` runs at bootstrap and monthly
- **Scheduling**: **GitHub Actions**, not cron-job.org. The pipeline is a ~10-minute Python job (news fetch → scoring → LLM book), which no HTTP-ping cron or Vercel serverless function can host inside its timeout; Actions runs Python directly, holds the secrets, and keeps run logs.

**No FastAPI, no Redis, no VPS for the backend** — see ADRs for why.

### Scheduled jobs

| Workflow | Schedule | Runs |
|---|---|---|
| `.github/workflows/daily-refresh.yml` | `30 21 * * 1-5` (21:30 UTC weekdays, after the US close) | `daily_refresh.py` (L0–L5), then refreshes the HypeScore IC validation, then `resolve_outcomes.py` (forward track record — ADR-0090), then the data-integrity guard |
| `.github/workflows/theme-discovery.yml` | `0 6 1 * *` (1st of the month) | `theme_discovery.py` — LDA ∩ embedding candidates → `discovered_themes` (shadow) |
| `.github/workflows/ci.yml` | on push / PR | backend + frontend tests |

Both scheduled jobs need these **GitHub repo secrets** (Settings → Secrets and variables → Actions). Without `SUPABASE_*` the run fails fast at the guard step; the rest degrade with a warning rather than fabricating data:

| Secret | Required? | Without it |
|---|---|---|
| `SUPABASE_URL` | **yes** | run fails at the guard |
| `SUPABASE_SERVICE_KEY` | **yes** | run fails at the guard |
| `BRAVE_SEARCH_API_KEY` | strongly recommended | news is empty → mention counts 0 |
| `MINIMAX_API_KEY` | recommended | L5 falls back to the deterministic template book |
| `FRED_API_KEY` | recommended | macro series skipped |
| `GEMINI_API_KEY` | optional | third-choice L5 fallback |

Note `workflow_dispatch` is enabled on both, so either can be run on demand from the Actions tab. GitHub also **auto-disables scheduled workflows after 60 days of repo inactivity** — if the book goes stale, check that first.

## Project docs

All project documentation lives under `docs/`:

| Path | Purpose |
|------|---------|
| `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` | Full design spec — architecture, scoring formulas, data model, frontend pages |
| `docs/superpowers/plans/2026-07-21-andromeda-implementation-plan.md` | Implementation plan — task-by-task build guide |
| `docs/adrs/` | Architecture Decision Records in im-Jarvis format |
| `docs/design-goals.md` | **Read before evaluating any UI change or outside mockup.** Eight standing design goals, each with a test, plus the non-goals and a mockup-triage checklist. ADRs record decisions taken; this records the bar a proposal must clear |
| `docs/captures/YYYY-MM-DD/` | Playwright screenshots — **one folder per capture date**. See [Screenshot convention](#screenshot-convention). |
| `docs/baseline/screenshots/` | Frozen pre-refactor visual baselines. Read-only — never overwrite these with fresh captures |
| `.playwright-mcp/` | Playwright MCP scratch output (page `.yml` snapshots, console `.log` files). Gitignored, safe to delete |

## Key source files

| Path | Purpose |
|------|---------|
| `scripts/daily_refresh.py` | Daily scoring pipeline (L1–L4 + L5 Q1 agent) |
| `scripts/theme_discovery.py` | Bootstrap + monthly theme discovery |
| `scripts/backfill_regime.py` | Rebuilds L3 regime history from `macro_daily_history` (pure function, no API/LLM cost). Dry-run by default; `--apply` writes; never overwrites the published rows without `--overwrite`. **L1 HypeScore and the L5 book are deliberately NOT backfillable** — see the module docstring |
| `backend/data/macro_fetcher.py` | L0: FRED + yfinance macro snapshot |
| `backend/data/factor_fetcher.py` | L2: Ken French FF5 + UMD factor exposures |
| `backend/services/regime_classifier.py` | L3: Rule-based cycle × sentiment classifier |
| `backend/services/book_metrics.py` | L5: value-weighted FF5+UMD book tilts, sector/geo caps, correlation matrix |
| `backend/services/chokepoint_signal.py` | Maps a measured maritime-disruption reading to a multiplier on S6's calibration; every refusal returns the neutral 1.0 **with a reason**. Needs `WORLDMONITOR_API_KEY` (Pro tier); absent, S6 runs its documented ADR-0088 calibration ([ADR-0095](docs/adrs/0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md)) |
| `backend/services/scenario_analysis.py` | L5: 6-scenario stress test — 4 risk-off (VIX/rates/USD/credit) + 1 risk-on melt-up, so a net-short book is stressed on both tails (ADR-0074), + 1 supply shock that transmits through `SECTOR_MAP` instead of market beta and is inflationary, so a position the factor model cannot see is still stressed and duration stops hedging ([ADR-0088](docs/adrs/0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md)) |
| `backend/services/q1_agent.py` | L5: 8-node Q1 reasoning agent (`run_q1_agent`) |
| `backend/services/book_revisions.py` | Diffs a published book against the row about to replace it, so an upsert on `run_date` cannot change a published figure silently. `reason` is NOT NULL by constraint ([ADR-0093](docs/adrs/0093-a-published-book-that-changes-must-say-so.md)) |
| `backend/services/pick_outcomes.py` | The forward track record — resolves published picks against a **pipeline-assigned** 21-trading-day spec. Pure functions; `scripts/resolve_outcomes.py` runs it. Rows are `pending` at publication so the denominator precedes the outcome. No Brier score: `conviction` is a sizing input, not a probability ([ADR-0090](docs/adrs/0090-a-published-pick-must-be-falsifiable.md)) |
| `frontend/app/book/page.tsx` | L6: The $100M book — per-trade thesis, pool depth, turnover, replication. (`/research`, `/portfolio`, `/trades` are retired server redirects to it.) |
| `frontend/lib/themeProvenance.ts` | Provenance of the attention signal, incl. `sourceIndependence()` — HypeScore currently rests on **one provider** (Brave); Reddit is fetched but unconfigured ([ADR-0094](docs/adrs/0094-no-corroboration-gate-over-a-single-source.md)) |
| `frontend/lib/supabase.ts` | Supabase client for frontend reads |
| `frontend/app/ask/page.tsx` | L8: `/ask` — interrogate the published book. Reached from a TopBar control, **not** a fifth nav destination |
| `frontend/app/api/chat/route.ts` | L8: the repo's only route handler. Rate limit first, then spend |
| `frontend/lib/chat/agent.ts` | L8: plan → execute → answer → verify. Exactly two LLM calls per question |
| `frontend/app/api/mcp/route.ts` | L8: the book as an **MCP server** — Streamable HTTP, `2025-06-18`, stateless, POST-only, over the SAME `TOOLS` registry `/ask` uses. No LLM and no rate limit: the caller brings their own model ([ADR-0092](docs/adrs/0092-the-book-as-an-mcp-server-over-the-tools-that-already-exist.md)) |
| `frontend/app/llms.txt/route.ts` | Machine-readable site index; the tool list is generated from `TOOLS` so it cannot drift |
| `frontend/lib/chat/tools.ts` | L8: the read-only tools. They import the SAME modules the pages render — never a copy |
| `frontend/lib/chat/guardrail.ts` | L8: adjudicates every numeral as cited / quoted / unverified ([ADR-0087](docs/adrs/0087-a-chat-that-cannot-do-arithmetic.md)) |
| `supabase/migrations/039_chat_usage.sql` | L8 spend guard — sealed table + `chat_rate_limit()` RPC, service_role only |
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

# /ask (L8) — SERVER-ONLY, set on the FRONTEND deployment. Never NEXT_PUBLIC_.
MINIMAX_API_KEY=...            # required or /ask 503s. SHARED with the nightly book's quota
SUPABASE_SERVICE_KEY=...       # required in production: the spend-guard RPC is service_role only
CHAT_IP_SALT=...               # recommended — an unsalted hash of an IPv4 address is brute-forceable
CHAT_PER_IP_DAILY_CAP=15       # optional
CHAT_GLOBAL_DAILY_CAP=200      # optional — this is what protects tomorrow's book
```

**`/ask` shares the MiniMax quota with L5.** That is the reason it is capped at
all: an exhausted quota does not produce a broken chat, it produces tomorrow's
book as a deterministic template with no thesis. If the caps are raised, raise
them against that, not against the bill.

## MCP tools

Use these to interact with external services directly:

- **Supabase MCP** (`plugin:supabase:supabase`): For all Supabase work — running SQL queries, checking table data, applying migrations, verifying data was seeded correctly. Authenticate once via browser OAuth flow.
- **Vercel MCP** (`plugin:vercel`): For Vercel work — listing projects, setting env vars, checking deployments, fetching build logs, triggering redeploys. Requires `vercel login` in the terminal first.
- **Playwright MCP** (`plugin:playwright`): For frontend verification — navigate to a URL, take a screenshot, check the page snapshot, inspect console errors. Use this whenever the user asks to "check if it's working" or "see the frontend".

```bash
# Typical verification flow with Playwright MCP:
# 1. Navigate to the URL
mcp__playwright__browser_navigate({ url: "https://..." })
# 2. Take a screenshot — ALWAYS pass an absolute filename (see Screenshot convention)
mcp__playwright__browser_take_screenshot({
  type: "png",
  filename: "C:/Users/zihan/projects/andromeda/docs/captures/2026-07-24/home-desktop.png"
})
# 3. Get the page snapshot
mcp__playwright__browser_snapshot({})
# 4. Check for console errors
mcp__playwright__browser_console_messages({ level: "error" })
```

### Screenshot convention

**Every Playwright screenshot goes in `docs/captures/<YYYY-MM-DD>/`, one folder per capture date. Never the repo root.**

1. **Pass an absolute path** in `filename`. No Playwright MCP output directory is configured, so a bare relative name like `book-final.png` resolves against the repo root and dumps the file there. `/*.png` in `.gitignore` is a backstop that hides those strays — it is not permission to create them.
2. **Create the dated folder first** if today's doesn't exist: `mkdir -p docs/captures/$(date +%Y-%m-%d)`.
3. **Name by what it shows, not by attempt** — `book-positions-desktop.png`, not `book-final-2-fixed.png`. Overwrite the same name when re-capturing after a fix; the previous version is in git.
4. **`docs/baseline/screenshots/` is off-limits** for new captures. It holds frozen visual baselines referenced by `docs/baseline/frontend-routes.md`; overwriting one destroys the before-image of a regression.
5. Page snapshots and console logs land in `.playwright-mcp/` on their own. Leave them there — that folder is gitignored scratch. Only promote one into `docs/captures/` if a doc cites it.

## Scoring weights

All weights and lookbacks are stored in the `scoring_config` Supabase table — not hardcoded. To change how themes are scored, update the database, don't edit Python code.

## Q1 thesis pipeline (L0–L8)

The L5 agent (`backend/services/q1_agent.py`) is a deterministic-then-stochastic pipeline. Layers L0–L4 are pure functions — auditable, reproducible. Layer L5 is the only place an LLM is invoked — **MiniMax-M3** in this deployment. The provider is
chosen at import time by `_select_provider` (MiniMax → Anthropic → Gemini, first key present wins,
pinnable with `LLM_PROVIDER`), and per ADR-0013 the citation guardrail and candidate hard-filter
constrain whichever model answers, so the provider is swappable without weakening the L5 contract. Layers L6–L7 render the result with citation provenance, and L8 (`/ask`) lets a reader interrogate it at request time under the same citation contract — see [ADR-0087](docs/adrs/0087-a-chat-that-cannot-do-arithmetic.md).

| Layer | Source | What it does |
|-------|--------|--------------|
| L0 | `backend/data/macro_fetcher.py` | FRED + yfinance → `macro_indicators` table |
| L1 | `scripts/daily_refresh.py` → `build_theme_signals` | Brave News + Reddit → HypeScore per theme |
| L2 | `backend/data/factor_fetcher.py` | Ken French FF5 + UMD → per-asset betas in `factor_exposures` |
| L3 | `backend/services/regime_classifier.py` | Yield curve + HY OAS + VIX → cycle × sentiment |
| L4 | `scripts/daily_refresh.py` → `compute_and_persist_risk` | VaR, CVaR, Sharpe, Beta, HHI → `portfolio_risk` |
| **L5** | `backend/services/q1_agent.py` | 8-node pipeline: aggregate → screen → compute book metrics → scenario analysis → reason_picks (LLM) → verify_citations → size_positions → persist |
| L6 | `frontend/app/book/page.tsx` | Per-trade thesis + book view rendered on `/book` |
| L7 | `frontend/components/{CitationList,ThemeDerivationDrawer,RegimeInputs}.tsx` | Citation footnotes + derivation audit trail |
| **L8** | `frontend/app/api/chat/route.ts` + `frontend/lib/chat/` | `/ask` — the only **request-time** LLM call. Plan (LLM picks ≤4 tools) → execute (deterministic, reusing the pages' own functions) → answer (LLM, restricted to fetched facts) → verify (every numeral cited/quoted/unverified, one retry). Read-only; spend-capped; fails closed |

The citation guardrail (verify_citations → retry → fallback) is the primary defense against LLM hallucination of macro numbers. See [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the design rationale.
