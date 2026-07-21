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
| [0009](0009-research-first-design-philosophy.md) | Research-first design philosophy (vs Bloomberg-terminal aesthetic) | accepted | 2026-07-21 |
| [0010](0010-citation-footnotes-everywhere.md) | Citation footnotes on every numeric claim | accepted | 2026-07-21 |
| [0011](0011-theme-derivation-drawer.md) | Theme Derivation Drawer (raw signals → normalized → weighted → final) | accepted | 2026-07-21 |
| [0012](0012-citation-guardrail-llm-defense.md) | Citation guardrail as the primary LLM defense in the Q1 pipeline | accepted | 2026-07-21 |
| [0013](0013-deterministic-stochastic-split.md) | Deterministic L0–L4 / stochastic L5 only (constrained-reasoning pattern) | accepted | 2026-07-21 |
| [0014](0014-candidate-set-hard-filter.md) | Q1 picks hard-filtered to the L5 candidate set (LLM cannot pick outside data) | accepted | 2026-07-21 |

## When to write an ADR

- Any architectural choice you'd struggle to explain six months from now
- Any deviation from the active plan or spec
- Locking in a tooling choice with meaningful alternatives

## How to write one

1. Copy this index entry format and create a new `NNNN-short-kebab-case-title.md` file
2. Fill in every section of the im-Jarvis template (Context, Decision, Consequences, Alternatives considered)
3. Status starts `proposed`; flip to `accepted` after sign-off
4. Add entry to this index

## Q1 reasoning pipeline ADRs (group)

ADRs 0012–0014 form a coherent design group for the L5 Q1 reasoning agent. They should be read together:

- **[0012](0012-citation-guardrail-llm-defense.md)** — the *what*: every numeric claim in the LLM output must cite a key in the L0–L4 input snapshot; un-cited or unresolved claims → retry → fallback.
- **[0013](0013-deterministic-stochastic-split.md)** — the *where*: the LLM is invoked only at L5. Layers L0–L4 are pure functions; the LLM is a constrained synthesizer, not an agent.
- **[0014](0014-candidate-set-hard-filter.md)** — the *which*: the LLM can only pick names that survived `screen_candidates`. It cannot invent tickers or break theme-asset coherence.

Together: the L5 agent is auditable (L0–L4 are pure), constrained (candidate filter), and self-checking (citation guardrail). See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the data flow and [spec §14](../superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md) for the full design.
