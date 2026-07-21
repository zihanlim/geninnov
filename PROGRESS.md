# Build Progress

_Last updated: 2026-07-21_

## Current status

**Project bootstrapped.** Andromeda is a greenfield project. See `ROADMAP.md` (future) for the forward plan.

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

## Build tasks

| # | Task | Status |
|---|---|---|
| 1 | Project scaffolding: environment, schema, env vars | completed |
| 2 | Python scoring pipeline: sentiment, data fetchers, calculators | completed |
| 3 | Next.js frontend: all 4 pages and components | completed |
| 4 | Deploy to Vercel + Supabase | completed |
| 5 | Phase 1 complete: working frontend reading sample data | completed |
| 6 | Phase 2 complete: daily_refresh.py runs end-to-end via cron | pending |
| 7 | Theme discovery bootstrap: run LDA + embedding clustering | pending |
