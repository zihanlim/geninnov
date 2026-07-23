---
status: accepted
date: 2026-07-23
deciders: platform owner
---

# ADR-0024 — Persist book analytics as structured records, not prompt strings

## Context

The L5 agent computes the three most decision-relevant quantitative artefacts in the system:

- **Book metrics** (`book_metrics.compute_book_metrics`) — value-weighted FF5+UMD tilts, gross/net exposure, sector and geography weights, cap violations.
- **Stress scenarios** (`scenario_analysis.run_scenario_analysis`) — book P&L under four calibrated shocks (VIX spike, +50bps rates, +5% DXY, +150bps HY OAS), with per-position contribution.
- **Correlation matrix** (`book_metrics.compute_correlation_matrix`) — 252-day pairwise Pearson, flagging pairs above `HIGH_CORR_THRESHOLD`.

All three were computed on every run, passed through `format_book_metrics_summary` / `format_scenario_table` into **preformatted strings**, injected into the `reason_picks` prompt, and then **discarded**. `_persist_to_supabase` wrote only `picks`, `book_view`, `book_risks`, `agent_run_id` and `advisory_derivation`.

Two consequences:

1. **The PM could not see them.** "What are the risks and how do I manage them" is one of the two questions this platform exists to answer, and the answer was computed and thrown away every day. There was no stress table, no correlation view and no cap monitor anywhere in the product.
2. **They were the wrong shape anyway.** A string like `"🔴 VIX Spike (>30): -8.42% ($-8.4M) [SEVERE]"` cannot be sorted, charted, coloured by severity, or filtered. Persisting the string would have moved the problem without solving it.

A third, subtler defect: both nodes ran against the **equal-weighted candidate pool** (30 candidates at 3.3% each), not the final sized book. That is correct for prompt context — the LLM has not picked yet — but it means the numbers described a portfolio nobody holds.

The frontend independently assumed the string form existed: `/research` selected `book_metrics_summary, scenario_table`, columns that had never been created. PostgREST rejects an unknown column with `400/42703` and drops the entire select, so the page rendered "No Q1 recommendations yet" unconditionally — even with a valid recommendation row present. The flagship page had been dark since it was written.

## Decision

**Persist the structured records, computed against the final sized book, in dedicated JSONB columns.**

1. **New serialisers** alongside the existing string formatters, not replacing them — the prompt still wants prose:
   - `book_metrics.book_metrics_to_dict(bm)`
   - `book_metrics.correlation_pairs_to_dict(pairs)`
   - `book_metrics.cap_utilisation(bm, picks)` — new; reports headroom (`weight / cap`), not just breaches
   - `scenario_analysis.scenario_results_to_dict(results)`

2. **A new terminal node**, `q1_agent.finalise_book_analytics`, runs after `size_positions` and recomputes all three against the real weights. The pre-pick nodes are untouched and keep feeding the prompt.

3. **Migration 022** adds `book_metrics`, `scenario_results`, `correlation_pairs`, `cap_utilisation`, `screening_funnel` and `lens` to `research_recommendations`, and creates the `portfolio_factor_exposure` view the frontend had always queried but which never existed.

4. **`screen_candidates` records its own attrition** into `screening_funnel` — remaining/removed/reason per filter. "What did the system reject and why" is the first question asked of any systematic book, and the answer previously existed only as `continue` statements.

5. **The persist path degrades loudly.** If the migration is unapplied, the write falls back to the legacy column set and logs that `/risk` will render unavailable. It does not silently drop the analytics.

## Consequences

Positive:
- `/risk` and `/book` render real stress, correlation, cap-headroom and factor-tilt data with no new computation — only persistence and rendering.
- Numbers shown to a PM are now the ones describing the book actually held, not an equal-weighted proxy.
- `cap_utilisation` converts an invisible constraint into a managed one: a position at 19.4% of a 20% cap is now visible *before* it binds.
- The funnel makes the empty-book case explicable rather than mysterious — which matters, because the empty book is the current production state.

Negative / friction:
- `finalise_book_analytics` re-runs `compute_correlation_matrix`, which hits yfinance a second time per run. Acceptable at ten tickers and one run per day; if the universe grows, cache the return frame across both call sites.
- Six more JSONB columns on `research_recommendations`. They are per-run snapshots, not normalised entities — deliberately, since they must remain immutable against the run that produced them.
- The string formatters and the dict serialisers can now drift. They are adjacent in the same modules to keep that obvious.

## Alternatives considered

**Persist the formatted strings.** One-line change, and it would have unblocked `/research` immediately. Rejected: the UI needs to sort scenarios by severity, colour cells by correlation sign and draw bars against caps. Reformatting prose into records in the browser would be parsing our own output.

**Recompute in the frontend from `picks` + `factor_exposures`.** Rejected: it duplicates the scenario calibration and correlation logic in TypeScript, so the numbers a PM sees would be a second implementation that can disagree with the one the LLM reasoned over. The whole point is that they are the same numbers.

**Add the two string columns the frontend asked for.** Rejected for the same reason as the first alternative, plus it would enshrine a schema shaped by a frontend bug.
