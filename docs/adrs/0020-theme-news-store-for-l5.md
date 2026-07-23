# ADR-0020 — theme_news store feeds the L5 agent real news

- Status: accepted
- Date: 2026-07-23
- Tags: llm, data-model, pipeline

## Context

`q1_agent.aggregate_context` hardcoded `news_headlines = []`, so `classify_news` was a no-op and `reason_picks` reasoned only over the macro snapshot + the aggregated theme table. The pipeline *collected* Brave/Reddit headlines in `build_theme_signals` but discarded them, so the very news that produced the HypeScores never reached the reasoning step. The code even carried a comment admitting "in production this would be the collected news table".

## Decision

Persist the collected headlines to a `theme_news` table (migration 018) during `daily_refresh` (`persist_theme_news`), and read the last 7 days back in `q1_agent._load_recent_headlines` so `classify_news` + `reason_picks` operate on real news. If the table is absent the read returns `[]` and the agent falls back to macro-only context — the prior behaviour, now explicit rather than accidental.

## Consequences

### Positive
- The L5 agent reasons over the actual news behind each theme's HypeScore.
- `theme_news` is an auditable record of what the agent saw on a given day.
- Graceful degradation: an un-applied migration never breaks the pipeline.

### Negative
- Adds an LLM `classify_news` call cost when an LLM key is configured.
- Requires migration 018 deployed to be effective in production.

## Alternatives considered

- **Thread headlines in-process into `run_q1_agent`.** Rejected: `aggregate_context` re-reads L0–L4 from Supabase by design (reproducible input snapshot); a DB-backed news store fits that contract and is auditable.
- **Leave news out of L5.** Rejected: it defeats the theme-driven premise of the system.

## Links
- `backend/services/q1_agent.py` (`_load_recent_headlines`, `aggregate_context`), `scripts/daily_refresh.py` (`persist_theme_news`), `supabase/migrations/018_theme_news.sql`
