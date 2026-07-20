# Andromeda

Systematic market theme identification and trade generation platform.

## What this is

Andromeda ingests news and social media daily, scores themes by "hype" (attention × sentiment × market correlation × momentum), generates ranked long/short trade ideas, and sizes them into a $100M portfolio with risk metrics.

## Architecture

- **Frontend**: Next.js 14 (TypeScript, Tailwind CSS) → Vercel
- **Database**: Supabase (PostgreSQL) — frontend reads directly via `@supabase/supabase-js`
- **Scoring pipeline**: Python `daily_refresh.py` script runs once/day at market close → writes to Supabase
- **Theme discovery**: `theme_discovery.py` runs at bootstrap and monthly
- **Cron**: cron-job.org (free) triggers `daily_refresh.py` daily

**No FastAPI, no Redis, no VPS for the backend** — see `ADR.md` for why.

## Key files

| Path | Purpose |
|------|---------|
| `scripts/daily_refresh.py` | Daily scoring pipeline |
| `scripts/theme_discovery.py` | Bootstrap + monthly theme discovery |
| `frontend/lib/supabase.ts` | Supabase client for frontend reads |
| `supabase/migrations/001_initial_schema.sql` | Full database schema |
| `docs/superpowers/specs/` | Design spec |
| `docs/superpowers/plans/` | Implementation plan |

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

## Scoring weights

All weights and lookbacks are stored in the `scoring_config` Supabase table — not hardcoded. To change how themes are scored, update the database, don't edit Python code.

## Design decisions

See `docs/superpowers/adrs/2026-07-21-architecture-decisions.md` for the reasoning behind all major choices.
