# Production reconciliation — run_date 2026-07-21

Hand reconciliation of investor-facing fields against the live Supabase database
for `project_id=xrvwyubzraxzqiizicsg`. Captured 2026-07-22 via read-only
`mcp__plugin_supabase_supabase__execute_sql` SELECTs only. No mutating tools
were invoked.

## Verdict summary

**9 PASS · 9 FAIL · 6 CANNOT_RECONCILE**

> **Revised 2026-07-23.** The first pass recorded 11 PASS / 7 FAIL / 5
> CANNOT_RECONCILE and attributed the HHI mismatch to "book_metrics vs
> risk_engine value drift." That was wrong. The actual cause is that
> production's `portfolio_risk` and `portfolio_returns` rows were written by
> the local operator script `tests/backend/seed_realistic_data.py`, which
> hardcodes risk metrics and a synthetic return series and deletes real rows
> before inserting. Two verdicts that depended on those values were false
> passes and are now FAIL. See corrected cross-cutting finding 5.
>
> **Consequence:** every investor-facing number on `/portfolio` in production
> is currently fabricated rather than computed. This is the exact failure mode
> the review was chartered to eliminate, so it is recorded here as the
> headline finding rather than a footnote.

## Run_date selection

`portfolio_returns` has 5 rows, the most recent being `2026-07-21` with a
non-empty `daily_return = 0.0015` (0.15%). Selected as the reconciliation
anchor. `portfolio_positions` does NOT carry a `run_date` column
(`docs/lineage/MATRIX.md` lists the freshness field as `run_date`, but
`list_tables verbose` confirms only `id, theme_id, asset, direction, notional,
weight, hype_score, trade_score, updated_at`). The 10 rows currently in the
table were last updated `2026-07-21 06:54:43..06:54:44`, so they align with the
chosen anchor.

## Production snapshots used

| table | row(s) used |
|---|---|
| `themes` | 8 rows; HypeScore 46.37..52.72 (all 8 themes populated) |
| `regime_classifications` | run_date=2026-07-21: cycle=mid, sentiment=neutral, yield_curve_slope=20, hy_oas=320, vix_level=18.5 |
| `portfolio_returns` | run_date=2026-07-21: daily_return=0.0015, cumulative_return=0.005, portfolio_value=100500000 — **all three fabricated by `seed_realistic_data.py:55-62`, not pipeline output** |
| `portfolio_positions` | 10 rows; sum(weights)=1.009 (gross >100% from leverage), all long, assets FXI/MCHI/BABA/KWEB/HYG/LQD/XLE/OIH/CL/UNG |
| `portfolio_risk` | 1 row: total_capital=100000000, var_95=2.5M, cvar_95=4.0M, sharpe=1.15, beta=0.65, concentration_hhi=1850 — **entire row fabricated by `seed_realistic_data.py:42-50`, which deletes real rows first** |
| `research_recommendations` | run_date=2026-07-22 (note: mismatches the chosen anchor — see below): 2 picks, fallback LLM, verified=false, agent_run_id present |
| `research_agent_runs` | 7 rows; latest `af903b69` for run_date=2026-07-22 with `verified=false, retries=5` |
| `trade_candidates` | 10 rows; identical assets to portfolio_positions; trade_score 0.07..0.122 |

## Table presence (production reality vs lineage matrix expectations)

| expected table | present in `public`? | impact |
|---|---|---|
| `market_assets` (migration 010) | NO | `market.index_change_pct` cannot be reconciled |
| `prediction_markets` (migration 011) | NO | `prediction.top_outcome_price` cannot be reconciled |
| `portfolio_factor_exposure` (used by `/`) | NO | page 404s (already in `frontend-routes.md`) |
| `portfolio_cumulative_return` (migration 014) | NO | `portfolio.cumulative_return`, `portfolio.inception_date` cannot be reconciled |
| `portfolio_risk.numeric_derivations` (migration 013) | column absent | risk.* fields persisted as raw floats; TS contract not bound |
| `research_recommendations.advisory_derivation` (migration 013) | column absent | `trade.thesis.body` is persisted as plain text inside `picks[].thesis`; fallback prose visible |

## Per-field reconciliation (lineage matrix vs production reality)

Legend: PASS — production value present and consistent with the lineage spec;
FAIL — production value present but inconsistent with the lineage spec (e.g.
schema-level claim that doesn't match the deployed columns);
CANNOT_RECONCILE — the column/table required by the lineage spec is not
deployed.

| field | lineage spec | production value (2026-07-21) | verdict | reason |
|---|---|---|---|---|
| `theme.hype_score` | `themes.hype_score` (0-100), per row | 8 rows; 46.37..52.72 | PASS | column present and populated |
| `theme.trade_score` (via `trade_candidates`) | `trade_candidates.trade_score` signed | 10 rows; 0.0704..0.1223 (all long, all positive) | PASS | column present |
| `theme.corr_to_market` | `theme_signals_history.price_corr` (raw ρ) | `themes.corr_score=0.5` for all 8 themes (normalized, not raw ρ) | FAIL | matrix notes this as a mislabeling (`TODO: derivation`); production stores the normalized `corr_score`, not the raw `price_corr` |
| `trade.thesis.body` (L5 LLM, `/research`) | `research_recommendations.picks[].thesis` | present; verbatim `"Long HYG via theme 'Corporate Credit' (HypeScore 52.7). TradeScore +0.122. Momentum driven by systematic theme detection."` — deterministic fallback prose | FAIL | matrix expects LLM Claude Sonnet; production stored `verified=false, retries=5` fallback content. `agent_run_id` links to `research_agent_runs` row whose `raw_output` confirms "Fallback output — no LLM synthesis available" |
| `trade.evidence` (`/research`) | `research_agent_runs.citations` JSONB | `citations=[]` empty; `verified=false`; agent_run_id row's `input_snapshot` lacks citations | FAIL | production has zero verified citations; CitationList will render verbatim text without superscripts |
| `regime.classification` (`/`) | `regime_classifications` row | run_date=2026-07-21, cycle=mid, sentiment=neutral | PASS | row present |
| `macro.dgs10` (`/`, RegimeInputsPanel) | `macro_indicators.value` for DGS10 (or `regime_classifications.yield_curve_slope`) | `regime_classifications.yield_curve_slope=20` (already derived DGS10-DGS2); `macro_indicators` has 12 series | PASS | value present; lineagematrix note: "slope shown as bp" is 20bp |
| `macro.hy_oas` | `regime_classifications.hy_oas` | 320 bp | PASS | value present |
| `macro.vix` | `regime_classifications.vix_level` | 18.5 | PASS | value present; `macro_indicators.value for ^VIX=17.05` (small drift between L0 snapshot and L3 regime row) |
| `prediction.top_outcome_price` (`/research`) | `prediction_markets.top_price` | table absent (migration 011 not deployed) | CANNOT_RECONCILE | migration 011 not yet applied to production |
| `market.index_change_pct` (`/`, MarketBar) | `market_assets.pct_change` | table absent (migration 010 not deployed) | CANNOT_RECONCILE | migration 010 not yet applied to production |
| `portfolio.daily_return` (`/portfolio`) | `portfolio_returns.daily_return` | 0.0015 (15 bps) | FAIL | **Corrected from PASS.** The row is present but the value is fabricated: `seed_realistic_data.py:57` hardcodes `daily_ret = 0.0015 if i % 2 == 0 else -0.0008`. Not pipeline output — see cross-cutting finding 5 |
| `portfolio.cumulative_return` (`/portfolio`) | `portfolio_cumulative_return.cumulative_value` | table absent | CANNOT_RECONCILE | migration 014 not yet applied to production |
| `portfolio.inception_date` (`/portfolio`) | `portfolio_cumulative_return.inception_date` | table absent | CANNOT_RECONCILE | migration 014 not yet applied to production |
| `portfolio.gross_exposure` (`/portfolio`) | aggregated from `portfolio_positions` | sum(abs(weight)) over 10 rows = 1.009 (6 long at 0.100883 + 4 at 0.098676) | PASS | reconstructable client-side; no persisted column |
| `portfolio.net_exposure` (`/portfolio`) | aggregated from `portfolio_positions` | sum(weight) = 1.009 (all long, no shorts) | PASS | reconstructable; no persisted column |
| `portfolio.leverage` (`/portfolio`) | gross/total_capital | 1.009 (gross 100.9% / $100M) | PASS | reconstructable; matrix notes implicit |
| `portfolio.sector_concentration` (`/portfolio`) | per-sector breakdown | not persisted; matrix already flags TODO: derivation | CANNOT_RECONCILE | no persisted column; never surfaced by `/portfolio/page.tsx` |
| `portfolio.geo_concentration` (`/portfolio`) | per-geo breakdown | not persisted | CANNOT_RECONCILE | no persisted column; never surfaced by `/portfolio/page.tsx` |
| `risk.var_95` (`/portfolio`) | `portfolio_risk.var_95` (USD) | 2500000 (raw float, no `numeric_derivations` JSONB) | FAIL | raw value present; production lacks `numeric_derivations` JSONB (migration 013 not applied). Per-row method/freshness/uncertainty provenance is absent — this row does NOT satisfy the "VaR/CVaR/Sharpe/Beta/HHI are derivations, not raw numbers" invariant |
| `risk.cvar_95` (`/portfolio`) | `portfolio_risk.cvar_95` | 4000000 | FAIL | same as var_95 |
| `risk.sharpe` (`/portfolio`) | `portfolio_risk.sharpe` | 1.15 | FAIL | same as var_95 |
| `risk.beta` (`/portfolio`) | `portfolio_risk.beta` | 0.65 | FAIL | same as var_95 |
| `risk.hhi` (`/portfolio`) | `portfolio_risk.concentration_hhi` | 1850 | FAIL | same as var_95; additionally the value itself is fabricated — `seed_realistic_data.py:48` hardcodes `1850`, while the genuine computed figure is `1000.12` (`concentration_hhi()` = `sum(w²)×10000` over the real weights). See corrected cross-cutting finding 5 |

## Cross-cutting findings

1. **Mismatch between portfolio_returns.run_date (2026-07-21) and research_recommendations.run_date (2026-07-22).** The chosen anchor's research_recommendations row is one day newer than the portfolio row. L5 agent run_date on the linked agent_run_id is also 2026-07-22. The Q1 thesis therefore references a portfolio/risk/regime snapshot that is one day stale — relevant for any temporal coherence invariant.

2. **LLM fallback path on production.** All recent `research_agent_runs` rows have `verified=false, retries=5`, an empty `citations=[]`, and `raw_output` carrying the deterministic fallback prose ("Fallback output — no LLM synthesis available"). The deployed `/research` page therefore surfaces fallback content labelled as Q1 thesis — this is a known violation of the "L5 never marks a heuristic fallback as verified" invariant from `docs/verification/MATRIX.md`.

3. **Risk values are raw floats, not derivations.** `portfolio_risk` row has hardcoded var_95/cvar_95/sharpe/beta/concentration_hhi; migration 013's `numeric_derivations` JSONB column is not present. T9 (risk_engine refactor) and T19 (migration 013) have not landed.

4. **portfolio_risk REST 400 in production is reproducible here too.** Direct `execute_sql` returned the row, but per `docs/baseline/frontend-routes.md` the anon REST call returns 400; the deployed frontend uses anon key + RLS, so the deployed UI cannot read this row at all. The risk.* fields are effectively unreconcilable from the deployed frontend until the RLS/ordering issue is fixed.

5. **~~HHI disagreement between two layers.~~ CORRECTED — production `portfolio_risk` is fabricated seed data.** This was originally recorded as "book_metrics vs risk_engine value drift." That diagnosis was wrong. The real cause: the entire `portfolio_risk` row was written by the operator script `tests/backend/seed_realistic_data.py`, which hardcodes `var_95=2_500_000, cvar_95=4_000_000, sharpe=1.15, beta=0.65, concentration_hhi=1850` (lines 42–50) after **deleting every existing row** (line 41). None of these are computed values.

   `concentration_hhi()` in `backend/services/risk_engine.py:118` returns `sum(w²)×10000`; for the 10 near-equal production weights that is ≈1000, which is exactly the L5 agent's `1000.12`. So `1000.12` is the genuine computed figure and `1850` is invented. There is no disagreement between two code paths — there is one real value and one fabricated one.

   The same script also fabricates the `portfolio_returns` series (lines 55–62): `daily_return` alternates a hardcoded `0.0015 / -0.0008`, `cumulative_return = 0.0050 - (i × 0.001)`, and `portfolio_value = 100_000_000 × (1 + cum_ret)`. Those are precisely the values this reconciliation anchored on, which means several PASS verdicts below are **false passes** — the value is present and internally consistent, but it is not pipeline output. Corrected inline in the table.

   The script is gitignored (`.gitignore:45`, `tests/backend/seed_*.py`), so it is local-only and cannot be guarded in-repo. It authenticates with `SUPABASE_SERVICE_KEY`, bypassing RLS. Treat every `/portfolio` number in production as unverified until a real pipeline run overwrites it.

6. **All positions are long.** 10/10 positions are `direction=long`; there are no shorts in production. The "Signed long/short return attribution" invariant cannot be exercised against this anchor — there is no short leg to reconcile.

7. **Macro snapshot drift.** `regime_classifications.vix_level=18.5` for run_date=2026-07-21, but the L5 input snapshot (2026-07-22 02:12) cites `^VIX=17.05` from `macro_indicators`. The L5 agent feeds off L0 (macro_indicators), not L3 (regime_classifications), so the `macro.vix` value displayed on `/` from L3 disagrees with the value L5 actually used.

## Source tables used

- `themes`, `regime_classifications`, `portfolio_returns`, `portfolio_positions`,
  `portfolio_risk`, `research_recommendations`, `research_agent_runs`,
  `trade_candidates`
- `information_schema.tables` for table-existence checks on `market_assets`,
  `prediction_markets`, `portfolio_cumulative_return`, `portfolio_factor_exposure`