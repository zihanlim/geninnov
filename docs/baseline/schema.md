# Schema migration status

`mcp__plugin_supabase_supabase__list_tables` was run this session against
`project_id=xrvwyubzraxzqiizicsg` (the active Supabase project returned by
`mcp__plugin_supabase_supabase__list_projects`). Live tables confirmed by that
tool are listed in the "deployed_state" column. No mutating Supabase tools
(`apply_migration`, `execute_sql` writes) were invoked.

**Status vocabulary** (per the brief):
- `applied` — verified by direct read-only tool output naming the migration's
  artifacts.
- `present` — the migration file exists locally; deployment cannot be confirmed
  from this session.
- `missing` — the migration file exists locally but the artifacts are not
  present in the live schema.

Indirect evidence (row counts, renamed table names) is recorded in the
`deployed_state` column but does not, on its own, mark a row `applied`.

| migration_file | purpose | local_state | deployed_state | status |
|---|---|---|---|---|
| `001_initial_schema.sql` | Initial public schema: themes, theme_assets, theme_signals_history, trade_candidates, portfolio_positions, portfolio_risk, portfolio_returns, scoring_config, backtest_results, research_output + RLS + anon read policies. | present | `list_tables` confirms themes, theme_assets, theme_signals_history, trade_candidates, portfolio_positions, portfolio_risk, portfolio_returns, scoring_config, backtest_results, research_output are present in `public`. | applied |
| `002_seed_sample_data.sql` | Sample seed rows for themes/trade_candidates/portfolio_positions/portfolio_risk (used to bootstrap empty environments). | present | `list_tables` does not report per-migration history; row counts are indirect evidence and recorded here without promoting the status. | present |
| `003_add_scores_to_signals_history.sql` | `ALTER TABLE theme_signals_history ADD COLUMN hype_score REAL, trade_score REAL`. | present | `list_tables verbose` reports `hype_score` (real) and `trade_score` (real) on `theme_signals_history`. | applied |
| `004_bootstrap_live.sql` | Backfill themes/themes_signals/trade_candidates with live (non-mock) data, idempotent re-seeds. | present | Live rows present in those tables (themes.hype_score columns populated; signals_history has 16 rows). | present |
| `005_macro_indicators.sql` | L0 macro snapshot + history: `macro_indicators`, `macro_daily_history`, plus RLS. | present | `list_tables` confirms both `macro_indicators` and `macro_daily_history` in `public`. | applied |
| `006_factor_exposures.sql` | L2 FF5+UMD factor betas plus L3 regime + L5 research tables: `factor_exposures`, `regime_classifications`, `research_recommendations`, `research_agent_runs` (plus RLS). | present | `list_tables` confirms `factor_exposures`, `regime_classifications`, `research_recommendations`, `research_agent_runs` in `public`. | applied |
| `007_seed_regime.sql` | Initial regime classification seed rows. | present | `regime_classifications` row count = 1 is indirect evidence of a seed; migration provenance is not directly observable. | present |
| `008_rename_q1_tables.sql` | Rename `q1_recommendations` -> `research_recommendations`, `q1_agent_runs` -> `research_agent_runs`. | present | Live names `research_recommendations` and `research_agent_runs` are present; old `q1_*` table names are absent from `INFORMATION_SCHEMA`. RENAME itself is not directly observable, but the post-rename names are. | applied |
| `009_asset_class_lens.sql` | Add `asset_class` text column on `theme_assets` with enum check + index. | present | `list_tables verbose` reports `asset_class` (text, nullable) on `theme_assets`. | applied |
| `010_market_assets.sql` | New `market_assets` table (ticker PK, name, current, prev_close, pct_change). | present | **Not deployed** — `list_tables` returned no `market_assets` table. Production code's `market_assets` REST call returns HTTP 404 on `/` and `/research` (see `frontend-routes.md`). | missing |
| `011_prediction_markets.sql` | New `prediction_markets` table (slug PK, top outcome, outcomes JSONB, volume, end_date). | present | **Not deployed** — `list_tables` returned no `prediction_markets` table. Wiring in `/research` is present in source but the table is absent remotely. | missing |

## Summary

- 6 of 11 migrations are confirmed **applied** via direct read-only Supabase
  output naming the migration's artifacts (001, 003, 005, 006, 008, 009).
- 3 migrations (002, 004, 007) are `present` locally but their execution
  cannot be confirmed from `list_tables` alone; recorded as `present`.
- 2 migrations (`010_market_assets.sql`, `011_prediction_markets.sql`) are
  confirmed `missing` in deployment: the migration files exist locally but
  neither the table nor any `CREATE` artifacts from those files are present
  in the live `public` schema. The deployed frontend hits 404s on
  `/rest/v1/market_assets`, which corroborates the gap.
- No Supabase mutating tools (`apply_migration`, `execute_sql` writes, etc.)
  were invoked during baseline capture; verification was strictly read-only.
