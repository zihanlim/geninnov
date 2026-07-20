# ADR-0001 — Supabase over self-hosted PostgreSQL

- Status: accepted
- Date: 2026-07-21
- Tags: data, ops

## Context

The platform requires a database that the Next.js frontend (hosted on Vercel) can read from directly without a custom API layer, and that can be operated without managing a server. Self-hosted PostgreSQL in Docker Compose on a VPS was the obvious starting point but adds operational overhead.

## Decision

Use Supabase (managed PostgreSQL) as the database. The frontend reads directly from it via `@supabase/supabase-js` — no custom API layer in Phase 1–3.

## Consequences

### Positive
- Zero database server operations: no backups, no updates, no server management
- Free tier (500MB, 1GB storage) is sufficient for MVP data volumes
- Supabase provides a JS client that works directly from the browser

### Negative
- Vendor lock-in — migrating away from Supabase requires a full DB migration
- Free tier caps limit growth

### Neutral
- PostgreSQL remains the underlying engine; SQL patterns are portable

## Alternatives considered

### Self-hosted PostgreSQL in Docker Compose
What it was: PostgreSQL running in a Docker container on a VPS.
Why we ruled it out: Adds a VPS cost and ongoing server management (updates, backups, security patching). Unnecessary complexity for a single-developer MVP.

### SQLite
What it was: File-based database.
Why we ruled it out: Does not support concurrent reads/writes from a remote frontend reliably. Not designed for networked access.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md`
