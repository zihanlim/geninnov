# Residual risk + deferred work

> Living inventory of risks that remain in production-grade code paths after the
> T1–T27 remediation pass, plus work that was intentionally deferred. Owner of
> this file: future operators. Source of truth: T1 baseline capture
> (`docs/baseline/`), T28 review of pending tasks, and recent `main` history.

Last reviewed: 2026-07-23.

## Known residual risks

| # | Risk | Impact | Where | Status | Mitigation / next step |
|---|---|---|---|---|---|
| **R0** | **Production `portfolio_risk` and `portfolio_returns` contain fabricated seed data, not pipeline output** | **Every investor-facing number on `/portfolio` — VaR, CVaR, Sharpe, beta, HHI, daily return, cumulative return, portfolio value — is invented. `concentration_hhi=1850` is hardcoded where the genuine computed value is `1000.12`. The L5 agent consumed these as `input_snapshot.risk_metrics`, so the Q1 thesis reasoned over fabricated risk inputs.** | Written by `tests/backend/seed_realistic_data.py` (gitignored, local-only) using `SUPABASE_SERVICE_KEY`; it deletes all real `portfolio_risk` rows (line 41) before inserting hardcoded ones (lines 42–50) and fabricates a 5-day return series (lines 55–62) | **Open — highest severity** | Requires user authorization to fix: (1) run a real `daily_refresh.py` to overwrite the seeded rows, (2) confirm no operator re-runs the seed script against production. Cannot be guarded in-repo because the script is gitignored. Until then, treat `/portfolio` as unverified. See `docs/baseline/prod-recon-2026-07-21.md` finding 5 |
| R1 | SPY 65/35 used as a proxy for SPX constituent breadth | Breadth signal under-represents sector dispersion; downstream risk + factor tilts inherit the proxy | `backend/data/macro_fetcher.py` (breadth derivation) | Accepted | Replace with true SPX constituent breadth once `market_assets` table (migration 010) is deployed |
| R2 | yfinance availability for missing tickers | Pipeline raises on missing price (T8); no graceful degradation | `scripts/daily_refresh.py` + `backend/data/*_client.py` | Accepted | Document in runbook; consider per-ticker skip-list with explicit warning |
| R3 | Heuristic fallbacks retained internally but not rendered to UI | `numeric_derivations` may carry `status="heuristic_fallback"` rows that the strict-unavailable policy hides from investors | `backend/derivations/numeric.py`, `frontend/components/status/*` | Accepted | Surface in an internal-only diagnostics page; not part of investor-facing contract |
| R4 | Cron externally owned (cron-job.org); not auditable from this repo | Silent failure of `daily_refresh.py` only visible via Vercel function logs / Supabase last-row timestamps | ops (cron-job.org dashboard) | Accepted | T10 `pipeline_runs` records stage-level success/failure; operators must check that table daily |
| R5 | Theme discovery is shadow-mode-only until manual approval | `theme_discovery.py` output is not promoted into `themes` until reviewed | `scripts/theme_discovery.py` + ops | Accepted | Activation policy documented; no auto-promotion path implemented |
| R6 | Migrations 010 (`market_assets`) + 011 (`prediction_markets`) not applied to production | `/` and `/research` pages 404 on `/rest/v1/market_assets` and `/rest/v1/prediction_markets` | Supabase `public` schema (deployed) | Open | T19/T28 decision: apply with user authorization OR remove the calling frontend code |
| R7 | 2 **flaky** (not deterministic) test failures in `tests/backend/test_brave_client.py` | CI signal noise; not introduced by T1–T27 work | `tests/backend/test_brave_client.py` | Accepted | **Revised 2026-07-23:** previously recorded as a deterministic Windows cp1252 encoding failure. A later full-suite run passed 215/215 with no code change to that module, so the tests are network-dependent flakes against the live Brave API (the fetcher can return a relative date like "2 days ago" instead of ISO). Fix by stubbing the HTTP layer so the suite does not depend on live Brave responses |

## Deferred work

| # | Item | Rationale for deferral | Status |
|---|---|---|---|
| D1 | On-the-fly backfill UI | Out of scope for the T1–T27 review-and-remediation plan; backfills are an operator runbook today | Deferred — re-evaluate when investor self-service becomes a requirement |
| D2 | Additional lens classes (vol, ESG, thematic, etc.) | Lens mode landed with six asset-class lenses (ADR-0015); vol/ESG need their own ADR + scoring reformulation | Deferred — track as a future ADR |
| D3 | Multi-currency normalization | Today all portfolio math is USD; FX lens surfaces `fx` themes but does not normalize P&L across currencies | Deferred — depends on broker-side base-currency support |
| D4 | Pipeline-run timeout / retry policy | T10 records stage runs (`pipeline_runs` table) but does not enforce a deadline or auto-retry | Deferred — manual operator response today; consider a Vercel Cron-with-deadline pattern |
| D5 | Frontend Playwright run against production | T26 ran Playwright against the dev server only (`PLAYWRIGHT_BASE_URL=http://localhost:3000`); production URL `https://andromeda-analytics.vercel.app` was not exercised | Deferred — flip `PLAYWRIGHT_BASE_URL` and re-run when a CI environment is available |

## How to update this file

- New residual risk → add a row to the first table; bump the "Last reviewed" date.
- Risk closed (mitigation shipped, migration applied, etc.) → move the row to a
  short "Closed since last review" section below the tables, then delete after
  one release cycle.
- New deferred item → add a row to the second table; cite the ADR or brief that
  scoped the deferral.

## Cross-references

- T1 baseline: `docs/baseline/STATUS.md`, `docs/baseline/schema.md`
- T10 pipeline runs: `backend/services/pipeline_runs.py`,
  `supabase/migrations/012_pipeline_runs.sql`
- T18 strict-citation policy: `docs/adrs/0012-citation-guardrail-llm-defense.md`
- Lens ADR: `docs/adrs/0015-lens-mode-asset-class.md`
