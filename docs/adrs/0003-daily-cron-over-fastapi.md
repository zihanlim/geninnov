# ADR-0003 — Daily cron over real-time FastAPI backend

- Status: accepted
- Date: 2026-07-21
- Tags: architecture, ops

## Context

The platform does not require real-time data. Daily refresh at market close is sufficient for identifying macro themes and generating trade ideas. Adding a persistent FastAPI backend on a VPS would add cost and complexity for a capability the use case does not need.

## Decision

No FastAPI, no persistent backend server. The `daily_refresh.py` Python script runs once/day at market close via cron-job.org, pulls fresh data, computes scores, and writes to Supabase. The frontend reads directly from Supabase.

## Consequences

### Positive
- Eliminates an entire service tier — no VPS cost, no server to manage
- cron-job.org is free
- Simple, batch-oriented architecture

### Negative
- Data is stale until the next cron run (not an issue for daily use case)
- Cannot support real-time user interactions without adding a backend

### Neutral
- Phase 4 (real-time upgrade) would reintroduce FastAPI + Redis on a VPS

## Alternatives considered

### FastAPI on VPS
What it was: A persistent FastAPI server running on a VPS.
Why we ruled it out: Adds $6–20/mo VPS cost and ongoing server management. Daily batch does not need a persistent server.

### Railway/Render for FastAPI
What it was: FastAPI deployed to a platform-managed container.
Why we ruled it out: Cold starts on the free tier break APScheduler. Paid plans required to run continuously. Unnecessary cost for a daily batch.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md`
- Superseded by: ADR-0009 (Phase 4 — adding FastAPI backend)
