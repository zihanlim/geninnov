# Residual risk + deferred work

> Living inventory of risks that remain in production-grade code paths after the
> T1–T27 remediation pass, plus work that was intentionally deferred. Owner of
> this file: future operators. Source of truth: T1 baseline capture
> (`docs/baseline/`), T28 review of pending tasks, and recent `main` history.

Last reviewed: 2026-07-23.

## Known residual risks

| # | Risk | Impact | Where | Status | Mitigation / next step |
|---|---|---|---|---|---|
| **R0** | ~~Production `portfolio_risk` and `portfolio_returns` contain fabricated seed data~~ **RESOLVED 2026-07-23** — rows deleted (snapshot at `docs/baseline/snapshots/pre-remediation-2026-07-23.json`) and a real pipeline run executed. Both tables are now empty rather than fabricated; the run produced no positions because all themes score 25.3–45.7 against a threshold of 50, which is the honest outcome. Original description follows | **Production `portfolio_risk` and `portfolio_returns` contain fabricated seed data, not pipeline output** | **Every investor-facing number on `/portfolio` — VaR, CVaR, Sharpe, beta, HHI, daily return, cumulative return, portfolio value — is invented. `concentration_hhi=1850` is hardcoded where the genuine computed value is `1000.12`. The L5 agent consumed these as `input_snapshot.risk_metrics`, so the Q1 thesis reasoned over fabricated risk inputs.** | Written by `tests/backend/seed_realistic_data.py` (gitignored, local-only) using `SUPABASE_SERVICE_KEY`; it deletes all real `portfolio_risk` rows (line 41) before inserting hardcoded ones (lines 42–50) and fabricates a 5-day return series (lines 55–62) | **Open — highest severity** | Requires user authorization to fix: (1) run a real `daily_refresh.py` to overwrite the seeded rows, (2) confirm no operator re-runs the seed script against production. Cannot be guarded in-repo because the script is gitignored. Until then, treat `/portfolio` as unverified. See `docs/baseline/prod-recon-2026-07-21.md` finding 5 |
| **R0b** | **Reddit credentials are empty, so the social half of the attention signal is synthetic** | `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` are present in `backend/.env` but set to empty strings, so `fetch_posts_for_theme` silently falls back to `_mock_posts`, which returns exactly one invented post per theme (`"Discussion: {theme} and what it means for markets"`, hardcoded `score: 100`). That fabricated post feeds both the mention-volume signal and the VADER sentiment term of HypeScore, which in turn drives TradeScore, `trade_candidates`, `portfolio_positions` and the L5 picks | `backend/data/reddit_client.py:25-30`, `_mock_posts` at `:61-64` | **Open** | Supply real PRAW credentials and re-run, or make the fallback explicit rather than silent — under the provenance policy a mock source should mark the derived value `estimated`, not blend invisibly into an otherwise-real score. Brave News and FRED **are** configured, so news and macro inputs are genuine; this contaminates the social component only |
| R1 | SPY 65/35 used as a proxy for SPX constituent breadth | Breadth signal under-represents sector dispersion; downstream risk + factor tilts inherit the proxy | `backend/data/macro_fetcher.py` (breadth derivation) | Accepted | Replace with true SPX constituent breadth once `market_assets` table (migration 010) is deployed |
| R2 | yfinance availability for missing tickers | Pipeline raises on missing price (T8); no graceful degradation | `scripts/daily_refresh.py` + `backend/data/*_client.py` | Accepted | Document in runbook; consider per-ticker skip-list with explicit warning |
| R3 | Heuristic fallbacks retained internally but not rendered to UI | `numeric_derivations` may carry `status="heuristic_fallback"` rows that the strict-unavailable policy hides from investors | `backend/derivations/numeric.py`, `frontend/components/status/*` | Accepted | Surface in an internal-only diagnostics page; not part of investor-facing contract |
| R4 | Cron externally owned (cron-job.org); not auditable from this repo | Silent failure of `daily_refresh.py` only visible via Vercel function logs / Supabase last-row timestamps | ops (cron-job.org dashboard) | Accepted | T10 `pipeline_runs` records stage-level success/failure; operators must check that table daily |
| R5 | Theme discovery is shadow-mode-only until manual approval | `theme_discovery.py` output is not promoted into `themes` until reviewed | `scripts/theme_discovery.py` + ops | Accepted | Activation policy documented; no auto-promotion path implemented |
| R6 | Migrations 010 (`market_assets`) + 011 (`prediction_markets`) not applied to production | `/` and `/research` pages 404 on `/rest/v1/market_assets` and `/rest/v1/prediction_markets` | Supabase `public` schema (deployed) | Open | T19/T28 decision: apply with user authorization OR remove the calling frontend code |
| R7 | 2 **flaky** (not deterministic) test failures in `tests/backend/test_brave_client.py` | CI signal noise; not introduced by T1–T27 work | `tests/backend/test_brave_client.py` | Accepted | **Revised 2026-07-23:** previously recorded as a deterministic Windows cp1252 encoding failure. A later full-suite run passed 215/215 with no code change to that module, so the tests are network-dependent flakes against the live Brave API (the fetcher can return a relative date like "2 days ago" instead of ISO). Fix by stubbing the HTTP layer so the suite does not depend on live Brave responses |

## Defects found by running the pipeline against production (2026-07-23)

Each of these was invisible to the test suite and surfaced only from a real
run. Recorded because the *class* of gap matters more than the individual bugs:
every one sat behind a silent fallback, an unexercised code path, or an
assertion no test made.

| # | Defect | Why it stayed hidden | Status |
|---|---|---|---|
| P1 | `daily_refresh.py` put `backend/` on `sys.path`, so `backend` was unimportable and the pipeline died at first import | The repo-root `conftest.py` puts the repo root on the path, so the suite never exercised the script's own bootstrapping. 221 tests passed against a pipeline that could not start | Fixed (`a8e97a01`); `test_entrypoint_imports.py` now imports each entry point in a clean subprocess |
| P2 | L4 crashed on `TypeError: float - NoneType` | `dict.get(key, default)` returns a stored `None` rather than the default; rows predating migration 003 have NULL `hype_score` | Fixed (`53b3bcac`) at both call site and function boundary |
| P3 | `market_assets` writes always failed with an APIError | The upsert hand-rebuilt its payload and dropped `name`, which migration 010 declares `NOT NULL`. The failure was logged and skipped, so the homepage bar just stayed empty | Fixed (`53b3bcac`); payload assertion added |
| P4 | TradeScore's momentum term had **never** worked in production | `persist()` never wrote `hype_score`/`trade_score` to `theme_signals_history`, so `hype_yesterday` was always NULL and the 0.55-weighted momentum term was permanently zero — TradeScore was silently `0.45 × sentiment` | Fixed (`5069f9be`); effect appears from the next run, once a prior row exists |
| P5 | Stale `trade_candidates` / `portfolio_positions` served as the current book | Neither table had a `run_date`; a run yielding no candidates wrote nothing and left the prior run's rows in place, indistinguishable from fresh | Fixed (migration 017 + writers stamp `run_date`); stale rows deleted |
| P6 | Every `pipeline_runs` stage stuck at `partial` | `started_at` is `NOT NULL` with no default, so the terminal upsert was rejected — and all eight call sites used `except Exception: pass` | Fixed (migration 017 default + handlers now log) |
| P7 | The L2 factor layer had **never** produced a real beta | The Ken French URLs 404 (the library serves `.zip`), so the parser returned empty and `compute_exposures` returned `{}`. `fetch_umd_factors` was additionally dead code (`if False else pd.DataFrame()`). Every row came from the seeding script — SPY was recorded at `beta_mkt=1.0, r_squared=1.0`, which no real regression yields. This module had zero tests | Fixed (`24054f5b`); switched to daily archives, 25 real exposures computed |

**The pattern worth keeping:** in every case the system degraded silently into
plausible-looking output instead of failing loudly. That is the same failure
mode as the original fabricated data, and it is the thing to design against —
prefer a loud failure over a quiet fallback wherever an investor-facing number
is involved.

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
