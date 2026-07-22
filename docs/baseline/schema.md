# Schema migration status

`mcp__plugin_supabase_supabase__list_tables` was run this session against
`project_id=xrvwyubzraxzqiizicsg` (the active Supabase project returned by
`mcp__plugin_supabase_supabase__list_projects`). Live tables confirmed by that
tool are listed in the "deployed_state" column. No mutating Supabase tools
(`apply_migration`, `execute_sql` writes) were invoked.

| migration_file | purpose | local_state | deployed_state | status |
|---|---|---|---|---|
| `001_initial_schema.sql` | Initial public schema: themes, theme_assets, theme_signals_history, trade_candidates, portfolio_positions, portfolio_risk, portfolio_returns, scoring_config, backtest_results, research_output + RLS + anon read policies. | present | themes (8), theme_assets (29), theme_signals_history (16), trade_candidates (10), portfolio_positions (10), portfolio_risk (1), portfolio_returns (5), scoring_config (13), backtest_results (0), research_output (3) all present in `public`. | applied |
| `002_seed_sample_data.sql` | Sample seed rows for themes/trade_candidates/portfolio_positions/portfolio_risk (used to bootstrap empty environments). | present | Seed rows are reflected in row counts of 001 tables above (n>0 on themes/trade_candidates/portfolio_positions). | applied |
| `003_add_scores_to_signals_history.sql` | `ALTER TABLE theme_signals_history ADD COLUMN hype_score REAL, trade_score REAL`. | present | `theme_signals_history.hype_score` and `theme_signals_history.trade_score` columns present. | applied |
| `004_bootstrap_live.sql` | Backfill themes/themes_signals/trade_candidates with live (non-mock) data, idempotent re-seeds. | present | Live data present in those tables (themes.hype_score columns populated for 8 rows; signals_history has 16 rows). | applied |
| `005_macro_indicators.sql` | L0 macro snapshot + history: `macro_indicators`, `macro_daily_history`, plus RLS. | present | `macro_indicators` (12 rows) and `macro_daily_history` (2,540 rows) present. | applied |
| `006_factor_exposures.sql` | L2 FF5+UMD factor betas plus L3 regime + L5 research tables: `factor_exposures`, `regime_classifications`, `research_recommendations`, `research_agent_runs` (plus RLS). | present | `factor_exposures` (11), `regime_classifications` (1), `research_recommendations` (1), `research_agent_runs` (7) all present in `public`. | applied |
| `007_seed_regime.sql` | Initial regime classification seed rows. | present | `regime_classifications` row count = 1 confirms a seeded row exists. | applied |
| `008_rename_q1_tables.sql` | Rename `q1_recommendations` -> `research_recommendations`, `q1_agent_runs` -> `research_agent_runs`. | present | Live names: `research_recommendations`, `research_agent_runs`. The old `q1_*` table names are absent from `INFORMATION_SCHEMA`. | applied |
| `009_asset_class_lens.sql` | Add `asset_class` text column on `theme_assets` with enum check + index. | present | `theme_assets.asset_class` (text, nullable, enum check for rates/credit/equity/fx/commodity/crypto/other) present. | applied |
| `010_market_assets.sql` | New `market_assets` table (ticker PK, name, current, prev_close, pct_change). | present | **Not deployed** — `list_tables` returned no `market_assets` table. Production code's `market_assets` REST call returns HTTP 404 on `/` and `/research` (see `frontend-routes.md`). | missing |
| `011_prediction_markets.sql` | New `prediction_markets` table (slug PK, top outcome, outcomes JSONB, volume, end_date). | present | **Not deployed** — `list_tables` returned no `prediction_markets` table. Wiring in `/research` is present in source but the table is absent remotely. | missing |

## Summary

- 9 of 11 migrations are confirmed **applied** via the live Supabase `list_tables` snapshot.
- 2 migrations (`010_market_assets.sql`, `011_prediction_markets.sql`) are confirmed **missing** in deployment: the migration files exist locally but neither the table nor any `CREATE` artifacts from those files are present in the live `public` schema. The deployed frontend hits 404s on `/rest/v1/market_assets`, which corroborates the gap.
- No Supabase mutating tools (`apply_migration`, `execute_sql` writes, etc.) were invoked during baseline capture; verification was strictly read-only.
