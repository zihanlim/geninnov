# Build Progress

_Last updated: 2026-07-21 (late evening — Q1 thesis layer documented across all surfaces)_

## Current status

**Phase 1–5 implemented.** Theme detection, trade ranking, position sizing, daily P&L, risk metrics, and the **Q1 reasoning pipeline** (L0–L6) are all wired into `scripts/daily_refresh.py`. The L5 agent (`backend/services/q1_agent.py`) produces a structured $100M long-short book with per-trade thesis, factor tilts, scenario analysis, and citation-verified numeric claims. The Q1 thesis renders on the `/research` page with inline citation footnotes. See "Pending" below for what's left to actually run against the deployed environment.

## Project structure

```
.github/workflows/ci.yml       ← GitHub Actions CI
CLAUDE.md                       ← AI/project onboarding (read this first)
PROGRESS.md                     ← this file
docs/
├── adrs/                      ← Architecture Decision Records (im-Jarvis format)
│   ├── README.md               ← index
│   ├── 0001-supabase-over-postgres.md
│   ├── 0002-vercel-for-frontend.md
│   ├── 0003-daily-cron-over-fastapi.md
│   ├── 0004-no-redis-in-phase1.md
│   ├── 0005-vader-over-paid-sentiment.md
│   ├── 0006-minmax-over-zscore-hypescore.md
│   ├── 0007-two-method-theme-discovery.md
│   └── 0008-tier1-macro-anchors-practitioner.md
└── superpowers/
    ├── specs/
    │   └── 2026-07-21-andromeda-market-theme-platform-design.md
    └── plans/
        └── 2026-07-21-andromeda-implementation-plan.md
```

## Completed

| Date | Entry |
|---|---|
| 2026-07-21 | Project scaffolded: `CLAUDE.md`, `PROGRESS.md`, `ADR-0001–0008` (individual files, im-Jarvis format), design spec, implementation plan, GitHub Actions CI. |
| 2026-07-21 | Python pipeline complete: B1 VADER sentiment, B2 Brave News, B3 Reddit, B4 Yahoo Finance, B5 HypeScore, B6 TradeScore, B7 daily refresh, B8 theme discovery — 59 tests passing. |
| 2026-07-21 | Frontend complete: C1 layout+Supabase, C2 dashboard+ThemeFeed+HypeGauge+MarketCorrelationChart+DataSourceStatus, C3 trades page, C4 portfolio page, C5 research page, D1 vercel.json. Build passes. |
| 2026-07-21 | Deployed to Vercel + Supabase: schema applied, RLS configured, seed data loaded. Phase 1 live. |
| 2026-07-21 | Bug fix pass on Phase B pipeline: replaced `"NOW()"` string with real ISO timestamp, added asset-map fallback for bootstrap timing, rewrote `call_brave_mcp.js` to actually call the Brave News API, added the missing Tier 1 asset seed (`LATERAL VALUES` INSERT for 29 rows). 60 tests passing. |
| 2026-07-21 | Phase 3 implemented: `backend/services/trade_ranker.py` (rank top 5 longs/shorts + size $100M portfolio) + `backend/services/risk_engine.py` (VaR, CVaR, Sharpe, Beta, HHI, daily P&L). `scripts/daily_refresh.py` now persists to `trade_candidates`, `portfolio_positions`, `portfolio_risk`, `portfolio_returns`. 106 tests passing. |
| 2026-07-21 | Live bootstrap migration applied to live Supabase (`004_bootstrap_live.sql`): added `hype_score` + `trade_score` columns to `theme_signals_history`, seeded 29 Tier 1 asset mappings. `daily_refresh.py` made robust to the pre-migration state (catches `APIError` on missing column, falls back to sentiment-only `TradeScore`). `.env.example` template committed. First end-to-end live run succeeded: 10 longs persisted, $100M sized into 10 positions, +0.84% daily return, HHI=1000. 107 tests passing. |
| 2026-07-21 | Phase 5 built: M1 `macro_indicators` + `macro_daily_history` tables (migration 005), M1 FRED+yfinance fetcher (`backend/data/macro_fetcher.py`), M2 `factor_exposures` table (migration 006), M2 Ken French FF5+UMD fetcher + rolling regression (`backend/data/factor_fetcher.py`), M3 rule-based regime classifier (`backend/services/regime_classifier.py`), M5 LangGraph research agent skeleton (`backend/agents/research_agent.py`) with LLM stub provider (MockLLM), new research page reads from `research_recommendations` table (`frontend/app/research/page.tsx`), migrations 005+006+007 applied to live DB, regime seed row inserted, `backend/__init__.py` + `backend/services/__init__.py` added to fix package imports, `apply_migration.py` script added. 151 tests passing. |
| 2026-07-21 | Renamed Q1/Q2 test-naming off production tables: `q1_recommendations` → `research_recommendations`, `q1_agent_runs` → `research_agent_runs`. Migration 008 applied to live Supabase (renamed in place, RLS policies renamed). Renamed files: `backend/agents/q1_agent.py` → `backend/agents/research_agent.py`, `backend/services/q1_agent.py` (table refs + `run_q1_agent` → `run_research_agent` + print log messages), `scripts/daily_refresh.py` (import + log messages), `tests/backend/test_q1_agent.py` → `test_research_agent.py`. New `MockLLMProvider` tests added; `size_positions` tests aligned with the actual one-pass implementation. 198 tests passing. |
| 2026-07-21 | **Research-first frontend redesign.** Replaced the original Bloomberg-terminal dashboard with a conviction-first layout: macro regime hero, top 3 themes as cards with thesis+sparkline+sub-score bars+catalyst/crowding/Δ1d, watchlist with momentum, filterable Trade Ideas table with thesis column, allocation bar (not treemap), risk grid with units context, factor exposure panel. Global nav (was missing), live feed status bar. Old orphaned components removed (`HypeGauge`, `ThemeFeed`, `MarketCorrelationChart`, `PortfolioTreemap`, `DataSourceStatus`). New design tokens in `tailwind.config.ts` + `globals.css`. Build/typecheck/lint clean. Deployed to Vercel. |
| 2026-07-21 | **ADRs 0009–0011 (UX provenance layer).** Recognized that the platform's quantitative outputs (HypeScore, TradeScore, regime classification, factor betas) are difficult to audit in their current UI. Adopted Perplexity-Finance-style provenance patterns: research-first design philosophy (ADR-0009), citation footnotes on every numeric claim in the Q1 thesis (ADR-0010), per-theme derivation drawer showing raw signals → normalization → weights → final score (ADR-0011). Architecture updated to add L7 (UI derivation layer). |
| 2026-07-21 | **Q1 thesis layer documented across all surfaces.** Updated CLAUDE.md, PROGRESS.md, ARCHITECTURE.md, spec §1/§2/§14, and added ADRs 0012–0014 to reflect that the Q1 reasoning pipeline is implemented end-to-end: L0 macro ingest + L2 factor exposures + L3 regime + L4 risk feed the L5 reasoning agent (`run_q1_agent` with 8 nodes including `compute_book_metrics` and `run_scenario_analysis`), whose citation-guarded output renders on `/research`. The thesis layer was previously only in spec §14 — now it's visible at every doc surface. |

## Build tasks

| # | Task | Status |
|---|---|---|
| 1 | Project scaffolding: environment, schema, env vars | completed |
| 2 | Python scoring pipeline: sentiment, data fetchers, calculators | completed |
| 3 | Next.js frontend: all 4 pages and components | completed |
| 4 | Deploy to Vercel + Supabase | completed |
| 5 | Phase 1 complete: working frontend reading sample data | completed |
| 6 | Phase 2 complete: daily_refresh.py runs end-to-end via cron | pending (live run succeeded; cron trigger still to be set up) |
| 7 | Theme discovery bootstrap: run LDA + embedding clustering | pending |
| 8 | Phase 3: trade ranking + position sizing + risk engine + daily P&L | completed (2026-07-21) |
| 9 | Phase 4: real-time upgrade (FastAPI + Redis) | deferred |
| 10 | Phase 5: Q1 reasoning pipeline (L0-L6) | completed (L0–L4 + L5 8-node agent + L6 writeup) |
| 11 | Research-first frontend redesign (regime hero, conviction cards, alloc bar, factor panel) | completed (2026-07-21) |
| 12 | Provenance layer: citation footnotes + ThemeDerivationDrawer (L7) | in-progress (L7 components in flight; citation infrastructure done) |
