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
| [0015](0015-lens-mode-asset-class.md) | Lens mode: triggerable asset-class filter on the L5 reasoning agent | accepted | 2026-07-21 |
| [0016](0016-signed-weights-portfolio-accounting.md) | Signed-weights portfolio accounting convention (`direction` derived from sign) | accepted | 2026-07-22 |
| [0017](0017-since-inception-cumulative-performance.md) | Since-inception cumulative performance is compounded daily (`portfolio_cumulative_return`) | accepted | 2026-07-22 |
| [0018](0018-provenance-read-model-seam.md) | Provenance read-model seam between Python derivations and TypeScript status components | accepted | 2026-07-22 |
| [0019](0019-citation-value-reconciliation.md) | Citation guardrail reconciles cited values, not just source keys | accepted | 2026-07-23 |
| [0020](0020-theme-news-store-for-l5.md) | theme_news store feeds the L5 agent real news | accepted | 2026-07-23 |
| [0021](0021-signal-robustness-momentum-crowding.md) | Signal robustness: robust momentum + signed crowding | accepted | 2026-07-23 |
| [0022](0022-hypescore-ic-backtest.md) | HypeScore validation via Information-Coefficient backtest | accepted | 2026-07-23 |
| [0023](0023-data-provenance-and-fabrication-guard.md) | Data provenance labels + fabricated-data (R0) guard | accepted | 2026-07-23 |
| [0024](0024-persist-book-analytics-not-prompt-strings.md) | Persist book analytics as structured records, not prompt strings | accepted | 2026-07-23 |
| [0025](0025-book-centric-information-architecture.md) | Book-centric information architecture (`/book`, `/risk`, `/method`) | accepted | 2026-07-23 |
| [0026](0026-gemini-third-l5-provider.md) | Google Gemini as a third L5 LLM provider | accepted | 2026-07-23 |
| [0027](0027-citation-value-grounding.md) | Citation guardrail grounds on value, not source-label exactness | accepted | 2026-07-23 |
| [0028](0028-minmax-correlation-consistency.md) | Min-max \|corr\| across themes (supersedes T22 raw-abs) | accepted | 2026-07-23 |
| [0029](0029-two-sided-book-decouple-direction-revive-momentum.md) | Two-sided book: decouple direction from the hype gate + revive momentum | accepted | 2026-07-23 |
| [0030](0030-unify-l5-candidate-pool-with-l1.md) | Unify the L5 candidate pool with L1 (screen_candidates consumes rank_trade_candidates) | accepted | 2026-07-23 |
| [0031](0031-edge-score-direction-signal.md) | EdgeScore: anchor long/short direction to trend + regime, not sentiment | accepted | 2026-07-23 |
| [0032](0032-edge-carry-value-abstention-sizing.md) | EdgeScore Stages 3–4: Carry, Value, abstention, conviction sizing | accepted | 2026-07-23 |
| [0033](0033-edge-stage5-sentiment-ic-weights.md) | EdgeScore Stage 5: sentiment demotion + IC-fit weights | accepted | 2026-07-24 |
| [0034](0034-scoring-config-anon-read-policy.md) | Public read policy on scoring_config (frontend sees live weights) | accepted | 2026-07-24 |
| [0035](0035-volume-subscore-7day-average.md) | HypeScore Volume = 7-day average mentions, not the 1-day count | accepted | 2026-07-24 |
| [0036](0036-carry-as-excess-yield-over-funding.md) | Carry = excess yield over funding (two-sided); a missing component renormalises rather than scoring 0 | accepted | 2026-07-24 |

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

### Naming note — L5 storage tables (read before grepping the ADRs)

ADRs **0011, 0012, 0013 and 0015** were written before migration **008** and name the L5 storage tables by their **original** names. Those tables were renamed in place and are the authoritative names everywhere in the live schema and code today:

| As written in the ADRs (pre-008) | Current table (post-008, live) |
|---|---|
| `q1_agent_runs` | `research_agent_runs` |
| `q1_recommendations` | `research_recommendations` |

The rename (migration `008_rename_q1_tables.sql`, [PROGRESS 2026-07-21](../../PROGRESS.md)) was label-only — it changed no schema, guardrail, or decision, so the ADR bodies are left intact as the historical record. When a doc, query, or grep needs the live name, use the right-hand column. Only the **tables** were renamed; the L5 module and its entry point kept their names — `backend/services/q1_agent.py::run_q1_agent`.
