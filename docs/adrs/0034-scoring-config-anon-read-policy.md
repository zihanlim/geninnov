# ADR-0034 — Public read policy on scoring_config (frontend can see the live weights)

- Status: accepted
- Date: 2026-07-24
- Tags: security, rls, data-access, frontend-provenance
- Related: ADR-0031/0032/0033 (EdgeScore weights that live in `scoring_config`),
  migration `supabase/migrations/027_scoring_config_public_read.sql`,
  `frontend/app/method/page.tsx` (the formula panels this unblocks)

## Context

The whole platform's stated principle (CLAUDE.md, ADR-0006) is that **every scoring
weight and lookback lives in the `scoring_config` table, not in code** — so a PM can
audit and change the model without a deploy. The `/method` page exists to render
those live weights: HypeScore, TradeScore and EdgeScore each have a "LIVE WEIGHTS
FROM scoring_config" formula panel plus a worked example.

`001_initial_schema.sql` enabled row-level security and added a `"Public read"`
policy (`FOR SELECT TO anon USING (true)`) on the seven **display** tables
(`themes`, `theme_assets`, `theme_signals_history`, `trade_candidates`,
`portfolio_positions`, `portfolio_risk`, `research_output`) — but never did the
same for `scoring_config`, even though 001 seeds it and migrations 023/024/026
keep inserting weights into it.

Consequence: under RLS default-deny, the **frontend anon key read `scoring_config`
as an empty set**. All three `/method` formula panels rendered
"NO ROWS — scoring_config" instead of the 19 live weights. The backend pipeline
was unaffected because it connects with the `service_role` key, which bypasses RLS
— so this was invisible in every backend test and only showed on the live site.
It was found by driving the deployed page with Playwright and querying the REST API
directly with the anon key (0 rows) vs. the known-populated table.

## Decision

Add migration `027_scoring_config_public_read.sql`, applied to production:

```sql
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON scoring_config;
CREATE POLICY "Public read" ON scoring_config FOR SELECT TO anon USING (true);
```

This mirrors the 001 display-table policies exactly: **read-only, `anon`,
`USING (true)`**. Writes remain restricted to `service_role` (migrations + the
daily pipeline), so the frontend can display the weights but cannot mutate them.

The scoring weights are **configuration, not secrets** — they are documented in the
ADRs and mirrored as frontend fallback defaults (`DEFAULT_EDGE_WEIGHTS`), so
exposing them read-only to the anon role carries no additional disclosure risk.

## Consequences

- `/method` renders the real formulas and worked examples again; the provenance
  story ("these are the exact live weights") is true end-to-end rather than
  silently falling back to hardcoded frontend constants.
- Any future table the frontend must read needs the same `"Public read"` anon
  policy in the *same migration that creates it* — the failure mode is silent
  (empty set, not an error), so it does not surface in backend tests. A follow-up
  guard would be a test that asserts the anon key can read every table the
  frontend queries.
- No change to write security: `service_role` remains the only writer.

## Alternatives considered

- **Frontend fallback to documented defaults when the query is empty.** Rejected:
  it hides the RLS gap and makes the "live from the database" claim a fiction — the
  page would show plausible numbers that are not provably the ones the pipeline ran.
- **Serve the weights through an existing readable table or an RPC.** Rejected as
  indirection; the weights already live in `scoring_config` and the only thing
  missing was the read grant the sibling tables already have.
