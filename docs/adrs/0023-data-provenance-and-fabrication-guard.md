# ADR-0023 — Data provenance labels + fabricated-data (R0) guard

- Status: accepted
- Date: 2026-07-23
- Tags: data-integrity, security, ops

## Context

Two data-integrity failures from the residual-risk register:

- **R0** — a gitignored local script (`tests/backend/seed_realistic_data.py`) once deleted the real `portfolio_risk` rows and inserted hardcoded metrics (`hhi=1850`, `var_95=2.5M`, …) plus a synthetic alternating `±0.0015/-0.0008` return series. Because the script is gitignored it can't be removed from the repo, and nothing detected its output.
- **R0b** — empty Reddit credentials made `fetch_posts_for_theme` silently return one invented post per theme, which fed the mention-volume and VADER-sentiment terms of HypeScore. A mock-derived score was indistinguishable in the schema from a real one.

## Decision

1. **Provenance labels.** Every collected item is source-tagged at the client (`brave` / `reddit` vs `mock_brave` / `mock_reddit`). `daily_refresh._classify_data_source` derives a per-theme `data_source` (`real` / `mock` / `mixed` / `none`) persisted to `theme_signals_history` (migration 020), so a mock-derived HypeScore can never be mistaken for a genuine one.
2. **Fabrication guard.** `scripts/check_data_integrity.py` is a pure, unit-tested detector of the seed fingerprint — flags when ≥3 of 5 risk sentinels match *or* the return series matches the alternating seed pattern (either phase) — and exits non-zero so it can run in CI / pre-deploy.

## Consequences

### Positive
- Provenance is explicit end-to-end; mock contamination (R0b) is queryable.
- The seed fingerprint (R0) is detectable even though the seed script is gitignored.

### Negative
- **Reverting the already-fabricated production rows still requires a real `daily_refresh` run with live credentials** — an operator action this repo can't perform. The guard *detects*; the fix is user-owned.

## Alternatives considered

- **Block mock data entirely.** Rejected — offline/dev needs a fallback; explicit labelling beats hard failure.
- **Trust operators not to reseed.** That is the status quo that produced R0.

## Links
- `scripts/check_data_integrity.py`, `scripts/daily_refresh.py` (`_classify_data_source`), `backend/data/{brave_client,reddit_client}.py`, `supabase/migrations/020_signal_provenance.sql`, RESIDUAL R0 / R0b
