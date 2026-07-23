# ADR-0022 — HypeScore validation via Information-Coefficient backtest

- Status: accepted
- Date: 2026-07-23
- Tags: analytics, validation

## Context

Nothing in the platform tested whether HypeScore actually predicts returns. The sub-score weights (30/20/30/20) and the `hype ≥ 50` threshold were asserted, never measured against forward returns. Without validation, HypeScore is a heuristic labelled as a signal — the single biggest gap flagged in review.

## Decision

Add `scripts/backtest_hype.py`, an Information-Coefficient harness. For each historical run date it rank-correlates (Spearman) HypeScore against forward 1d/5d/20d asset returns, reports the cross-sectional IC (mean, std, information ratio, hit rate), a pooled IC (coarse fallback for the small 8-theme cross-section), and — via the horizon sweep — the signal-decay curve. Results optionally persist to the existing `backtest_results` table. The pure core (`spearman_ic`, `cross_sectional_ic`, `forward_return`, `build_panel`) is unit-tested with synthetic data.

A near-zero or negative IC is an **accepted, publishable result** — the point is to make the weights and threshold falsifiable, not to assume they work.

## Consequences

### Positive
- HypeScore's weights and threshold become empirically testable; a foundation for walk-forward weight optimisation later.
- Reusable, tested validation spine independent of live infrastructure.

### Negative
- Only meaningful once enough daily history has accrued; the 8-theme cross-section is small (pooled IC provided as a coarse alternative).
- No look-ahead by construction (entry close is the signal date; exit is strictly forward), but survivorship/asset-mapping caveats remain and are documented.

## Alternatives considered

- **Full event-study / factor regression backtest.** Heavier; IC is the standard first cut and is enough to falsify the current weights.
- **Trust the asserted weights.** That is the flaw being fixed.

## Links
- `scripts/backtest_hype.py`, `backtest_results` table, ADR-0006
