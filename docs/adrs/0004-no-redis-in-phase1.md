# ADR-0004 — No Redis for caching

- Status: accepted
- Date: 2026-07-21
- Tags: architecture, ops

## Context

A persistent backend with Redis would enable API rate-limit buffering — caching Brave Search and Reddit responses to avoid 429 errors. However, Phase 1–3 have no persistent backend; Redis would need to live on a VPS alongside the cron job, adding cost and complexity.

## Decision

Skip Redis entirely in Phase 1–3. Brave Search (20 req/query) and Reddit PRAW (60 req/min) limits are respected with one batch request per day — no caching needed.

## Consequences

### Positive
- No additional service to manage or pay for
- Simpler architecture for Phase 1–3

### Negative
- If cron runs overlap or retry, rate limits could be hit
- No distributed cache for multi-instance deployments

### Neutral
- Redis would be reconsidered in Phase 4 if FastAPI backend is added

## Alternatives considered

### Redis on VPS alongside cron script
What it was: Redis running on the same VPS as the cron job.
Why we ruled it out: No persistent backend means no natural home for Redis. Adding one adds cost and complexity for a problem that does not exist at daily-batch scale.

### Upstash (hosted Redis)
What it was: Managed Redis in the cloud.
Why we ruled it out: Adds a third-party service and cost. Unnecessary for daily batch.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md`
