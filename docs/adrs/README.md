# Architecture Decision Records

One ADR per file. Immutable once accepted — superseded ADRs are marked `superseded by ADR-NNNN` rather than rewritten.

## Index

| ID | Title | Status | Date |
|---|---|---|---|
| [0001](0001-supabase-over-postgres.md) | Supabase over self-hosted PostgreSQL | accepted | 2026-07-21 |
| [0002](0002-vercel-for-frontend.md) | Vercel for frontend hosting | accepted | 2026-07-21 |
| [0003](0003-daily-cron-over-fastapi.md) | Daily cron over real-time FastAPI backend | accepted | 2026-07-21 |
| [0004](0004-no-redis-in-phase1.md) | No Redis for caching | accepted | 2026-07-21 |
| [0005](0005-vader-over-paid-sentiment.md) | VADER over paid sentiment API | accepted | 2026-07-21 |
| [0006](0006-minmax-over-zscore-hypescore.md) | Min-max normalization over z-scores for HypeScore | accepted | 2026-07-21 |
| [0007](0007-two-method-theme-discovery.md) | Two-method theme discovery (LDA + embedding clustering) | accepted | 2026-07-21 |
| [0008](0008-tier1-macro-anchors-practitioner.md) | Tier 1 macro anchors defined by practitioner judgment | accepted | 2026-07-21 |

## When to write an ADR

- Any architectural choice you'd struggle to explain six months from now
- Any deviation from the active plan or spec
- Locking in a tooling choice with meaningful alternatives

## How to write one

1. Copy this index entry format and create a new `NNNN-short-kebab-case-title.md` file
2. Fill in every section of the im-Jarvis template (Context, Decision, Consequences, Alternatives considered)
3. Status starts `proposed`; flip to `accepted` after sign-off
4. Add entry to this index
