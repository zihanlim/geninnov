# Data Lineage Matrix - Investor-Facing Fields

This matrix traces every numeric and advisory field rendered on the investor-facing
routes (`/`, `/trades`, `/research`, `/portfolio`) back to the producing function and
source table. It is the canonical wiring view for the L6/L7 (frontend) layer of the
Q1 thesis pipeline.

When a field is currently reconstructed by the frontend from a partial record (the
value is not stored on disk but is recomputed at render time), it is flagged
`TODO: derivation`. The remediation tasks 13-15 consume this list.

## TS derivation contracts

The new T11 primitives live at:

- `frontend/lib/derivations/numeric.ts` - `NumericDerivation`, `NumericStatus`,
  `NumericUnit` types for every numeric field below.
- `frontend/lib/derivations/advisory.ts` - `AdvisoryDerivation`, `AdvisoryStatus`
  types for LLM-generated thesis / evidence fields.

References to "TS type" point to those files.

## Field matrix

| field | page | source table | producing function | unit | freshness field | missing-data behavior | UI label |
|---|---|---|---|---|---|---|---|
| `theme.hype_score` | `/` | `themes` | `backend/services/hype_calculator.hype_score()` via `scripts/daily_refresh.build_theme_signals` | score (0-100) | `themes.updated_at` | rendered `0` (ConvictionCard L94-95); sub-scores fall back to `0` | "HypeScore" |
| `theme.trade_score` | `/trades`, `/research` | `trade_candidates` | `backend/services/trade_ranker.py` (see `hype_calculator.trade_*` weights) | score (signed) | `trade_candidates.run_date` | `—` (TradeIdeasTable L192; PickCard L96-98) | "TradeScore" |
| `theme.corr_to_market` | `/` (ThemeDerivationDrawer) | `theme_signals_history.price_corr` | `scripts/daily_refresh.build_theme_signals` (stored as `corr_score` on `themes`) | correlation (-1..+1) | `theme_signals_history.run_date` | labelled as "correlation sub-score" in drawer (rho of mentions vs asset return 7d); the ThemeDerivationDrawer labels this as `corr_score` though the column is normalized `0..1`, **TODO: derivation** (mislabeled magnitude in drawer) | "Corr" / "Correlation sub-score" |
| `trade.thesis.body` | `/research` | `research_recommendations.picks[].thesis` (JSONB) | `backend/services/q1_agent.reason_picks` (LLM Claude Sonnet, `v2.1.0`) - protected by `verify_citations` retry/fallback | prose | `research_recommendations.run_date` | fallback thesis: deterministic top-5 by HypeScore; renders `pick.thesis` via `CitationList` | "Thesis" |
| `trade.evidence` | `/research` | `research_agent_runs.citations` (JSONB) joined to `research_recommendations.agent_run_id` | `backend/services/q1_agent.verify_citations` (ADR-0012) | list[Citation] | `research_agent_runs.created_at` | `citations` field absent → `CitationList` renders text verbatim with no superscripts | "(N sources)" / footnote list |
| `regime.classification` | `/` | `regime_classifications` | `backend/services/regime_classifier._classify_cycle` + `_classify_sentiment` (rule-based) | enum (cycle, sentiment) | `regime_classifications.run_date` | rendered `—` for both cycle and sentiment when row absent; headline/narrative fall back to placeholder strings (app/page.tsx L168-173) | "Macro Regime" badges (EARLY/MID/LATE/RECESSION, RISK-ON/NEUTRAL/RISK-OFF) |
| `macro.dgs10` | `/` (RegimeInputsPanel) | `regime_classifications.yield_curve_slope` (input) or `macro_indicators` DGS10 | `backend/data/macro_fetcher.MacroFetcher.fetch_fred_batch` (FRED DGS10); slope = DGS10-DGS2 in `regime_classifier.classify` | bp (slope shown as bp) | `macro_daily_history.trading_date` | `—` in RegimeInputsPanel | "10y-2y slope" |
| `macro.hy_oas` | `/` (RegimeInputsPanel) | `regime_classifications.hy_oas` | `backend/data/macro_fetcher` (FRED BAMLH0A0HYM2) consumed by `regime_classifier.classify` | bp | `regime_classifications.run_date` | `—` | "HY OAS" |
| `macro.vix` | `/` (RegimeInputsPanel) | `regime_classifications.vix_level` | `backend/data/macro_fetcher` (yfinance ^VIX) consumed by `regime_classifier.classify` | index | `regime_classifications.run_date` | `—` | "VIX spot" |
| `prediction.top_outcome_price` | `/research` | `prediction_markets.top_price` | `backend/data/polymarket_fetcher.py` via `scripts/daily_refresh` (migration 011 - currently `missing` per `docs/baseline/schema.md`) | probability (0-1) | `prediction_markets.fetched_at` | `PredictionMarkets` returns `null` (no UI shell) when empty - currently 404s on deployed prod (table not deployed); **TODO: derivation** for `prices` JSONB→stacked-bar widths | per-outcome percentage "(p*100).toFixed(0)%" |
| `market.index_change_pct` | `/` (MarketBar) | `market_assets.pct_change` | `backend/data/macro_fetcher.MacroFetcher.fetch_market_assets` (migration 010 - currently `missing` per `docs/baseline/schema.md`) | pct | `macro_daily_history.trading_date` (last 2 values) | `MarketBar` renders nothing (skips itself) when table 404s; **TODO: derivation** while 010 is un-deployed | "▲/▼ X.XX%" |
| `portfolio.daily_return` | `/portfolio` | `portfolio_returns` (L4 layer) - NOT yet wired to a risk-grid card on `/portfolio` | `backend/services/portfolio.compute_daily_return()` | decimal | `portfolio_returns.run_date` | `portfolio_risk` select fails 400 on prod (see `docs/baseline/frontend-routes.md`); UI shows nothing - **TODO: derivation** (no card renders this) | not currently surfaced |
| `portfolio.cumulative_return` | `/portfolio` | `portfolio_cumulative_return.cumulative_value` (migration 014) | `backend/services/portfolio.compute_cumulative_return()` called from `scripts/daily_refresh` | decimal (compounded) | `portfolio_cumulative_return.as_of` | `portfolio_cumulative_return` table not yet selected by `/portfolio/page.tsx`; **TODO: derivation** (data wired, no UI card yet) | not currently surfaced |
| `portfolio.inception_date` | `/portfolio` | `portfolio_cumulative_return.inception_date` (migration 014) | `scripts/daily_refresh.py` (writes the inception date on first run) | DATE | `portfolio_cumulative_return.computed_at` | not surfaced; **TODO: derivation** | not currently surfaced |
| `portfolio.gross_exposure` | `/portfolio` | `portfolio_positions` aggregated client-side; also `book_metrics.compute_book_metrics.gross_exposure` (derived, not stored) | `book_metrics.compute_book_metrics` (ADR-0101: `services/exposure.py` was deleted — never called, and it summed raw weights, which on unsigned-weight picks returns gross) | decimal (0-200%) | `portfolio_positions.run_date` | reconstructed from `positions` in `portfolio/page.tsx` L156-160 - **TODO: derivation** (no persisted column) | "Capital allocation · $X deployed" |
| `portfolio.net_exposure` | `/portfolio` | `portfolio_positions` aggregated client-side; also `book_metrics.compute_book_metrics.net_exposure` | `book_metrics.compute_book_metrics` (ADR-0101) | decimal (-100..+100%) | `portfolio_positions.run_date` | reconstructed client-side; **TODO: derivation** | "Net L/S" |
| `portfolio.leverage` | `/portfolio` | derived (gross / total_capital) | `book_metrics.compute_book_metrics` (ADR-0101) | ratio | `portfolio_positions.run_date` | reconstructed from gross / total_capital - **TODO: derivation** | implicit in "Gross X%" line |
| `portfolio.sector_concentration` | `/portfolio` | not persisted (only LLM prompt summary via `book_metrics.format_book_metrics_summary`) | `backend/services/book_metrics.compute_book_metrics` (`SECTOR_MAP`) | pct by sector | `book_metrics.computed_at` | **TODO: derivation** - dashboard does not surface per-sector breakdown | not surfaced |
| `portfolio.geo_concentration` | `/portfolio` | not persisted | `backend/services/book_metrics.compute_book_metrics` (`GEO_MAP`) | pct by geography | `book_metrics.computed_at` | **TODO: derivation** - dashboard does not surface per-geo breakdown | not surfaced |
| `risk.var_95` | `/portfolio` | `portfolio_risk.var_95` (legacy column) - new derivation shape from `risk_engine.compute_risk()` keyed by `var_95` | `backend/services/risk_engine.value_at_risk()` (parametric Gaussian) | USD | `portfolio_risk.run_date` | `—` when `risk.var_95` is null; `portfolio_risk?select=*` returns 400 on prod (RLS/ordering - see `frontend-routes.md`) - **TODO: derivation** (TS contract `risk.var_95` not yet bound to UI) | "VaR (95%)" |
| `risk.cvar_95` | `/portfolio` | `portfolio_risk.cvar_95` | `backend/services/risk_engine.conditional_value_at_risk()` | USD | `portfolio_risk.run_date` | 400 on prod; **TODO: derivation** | "CVaR (95%)" |
| `risk.sharpe` | `/portfolio` | `portfolio_risk.sharpe` | `backend/services/risk_engine.sharpe_ratio()` (annualized, 252d) | ratio | `portfolio_risk.run_date` | 400 on prod; **TODO: derivation** | "Sharpe (252d)" |
| `risk.beta` | `/portfolio` | `portfolio_risk.beta` | `backend/services/risk_engine.beta_to_spx()` (OLS vs SPX) | ratio | `portfolio_risk.run_date` | 400 on prod; **TODO: derivation** | "Beta (vs SPX)" |
| `risk.hhi` | `/portfolio` | `portfolio_risk.concentration_hhi` | `backend/services/risk_engine.concentration_hhi()` (weights squared × 10000) | ratio (0-10000) | `portfolio_risk.run_date` | 400 on prod; **TODO: derivation** | "HHI Concentration" |

## TODO: derivation - remediation plan

The following gaps are documented above and will be addressed by tasks 13-15:

1. **`theme.corr_to_market`** - ThemeDerivationDrawer currently labels
   `corr_score` (0-1 normalized) as "ρ(mentions, asset return 7d)". The frontend
   draws the normalized sub-score, but the original `signal.price_corr` is
   what the math claims to show. TS contract `numeric.ts` should bind to the
   raw ρ field and the drawer text needs to be reconciled.
2. **`portfolio.daily_return`, `cumulative_return`, `inception_date`** - No
   `/portfolio` card currently renders these. The `portfolio_cumulative_return`
   table is wired in migration 014 but `portfolio/page.tsx` does not query it.
   T13 will add the cards and bind the TS derivations.
3. **`portfolio.{gross_exposure,net_exposure,leverage}`** - Currently
   reconstructed client-side from `portfolio_positions`. Should be bound to the
   `compute_book_metrics` output persisted by the Q1 pipeline, or moved to
   `portfolio_factor_exposure` (currently 404 on prod - see migration needed).
4. **`portfolio.{sector_concentration,geo_concentration}`** - Computed by
   `book_metrics.compute_book_metrics` but only emitted into the LLM prompt
   summary (`format_book_metrics_summary`); never persisted to a column and
   never rendered on `/portfolio`. T14 will add the breakdown UI.
5. **`risk.{var_95,cvar_95,sharpe,beta,hhi}`** - The `portfolio_risk` table
   is queried but currently returns 400 in production (see
   `docs/baseline/frontend-routes.md`). The new derivation shape from
   `risk_engine.compute_risk()` returns `NumericDerivation` objects keyed by
   the same names; the UI must consume those objects and TS type
   `NumericDerivation` (frontend/lib/derivations/numeric.ts) instead of raw
   floats.
6. **`prediction.top_outcome_price`** - Migration 011 (`prediction_markets`)
   is `missing` in the live database (see `docs/baseline/schema.md`); the
   `PredictionMarkets` component hits 404. Until deployed, the field is
   unrecoverable on production. T13 will gate the UI on a derivation status.
7. **`market.index_change_pct`** - Migration 010 (`market_assets`) is `missing`
   in the live database. `MarketBar` silently renders nothing. T13 will gate
   the UI on a derivation status.

## Files referenced

Frontend (L6/L7):

- `frontend/app/page.tsx`
- `frontend/app/trades/page.tsx`
- `frontend/app/research/page.tsx`
- `frontend/app/portfolio/page.tsx`
- `frontend/components/RegimeHero.tsx`
- `frontend/components/RegimeInputsPanel.tsx`
- `frontend/components/ConvictionCard.tsx`
- `frontend/components/TradeIdeasTable.tsx`
- `frontend/components/CitationList.tsx`
- `frontend/components/MarketBar.tsx`
- `frontend/components/PredictionMarkets.tsx`
- `frontend/components/ThemeDerivationDrawer.tsx`
- `frontend/components/ThemeHeatmap.tsx`
- `frontend/components/TradeDerivationDrawer.tsx`

Frontend derivation contracts (T11):

- `frontend/lib/derivations/numeric.ts`
- `frontend/lib/derivations/advisory.ts`

Backend services (L0-L5):

- `backend/data/macro_fetcher.py` (L0)
- `backend/data/factor_fetcher.py` (L2)
- `backend/services/hype_calculator.py` (L1)
- `backend/services/regime_classifier.py` (L3)
- `backend/services/risk_engine.py` (L4)
- `backend/services/book_metrics.py` (L5)
- `backend/services/portfolio.py` (L4)
- `backend/services/q1_agent.py` (L5)

Supabase migrations:

- `001_initial_schema.sql` (themes, trade_candidates, portfolio_positions, portfolio_risk, portfolio_returns)
- `005_macro_indicators.sql` (macro_indicators, macro_daily_history)
- `006_factor_exposures.sql` (regime_classifications)
- `008_rename_q1_tables.sql` (research_recommendations, research_agent_runs)
- `010_market_assets.sql` (currently `missing` per schema baseline)
- `011_prediction_markets.sql` (currently `missing` per schema baseline)
- `014_cumulative_return.sql` (portfolio_cumulative_return - new in this sprint)
