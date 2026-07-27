# ADR-0120: The guard reads the taxonomy, not just the book

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0036](0036-not-computable-is-not-zero.md), [ADR-0040](0040-check-the-published-book-do-not-assume-it.md), [ADR-0066](0066-not-computable-persists-as-null.md), [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md), [ADR-0119](0119-svxy-is-equity-risk-and-the-taxonomy-said-haven.md)

## Context

[ADR-0119](0119-svxy-is-equity-risk-and-the-taxonomy-said-haven.md) ended by naming the gap it had just walked into:

> The lesson is not "check SVXY." It is that a classification is an input, and this repo validates its computations far more carefully than its inputs — `check_data_integrity` has seven checks on the published book and none asserting that an asset's class is consistent with its own measured beta. That check is worth building and is not built here.

Three separate SVXY defects landed on 2026-07-27: the stress signs (`+0.20` → `−0.35`), the market beta (`−0.60` → `+2.08`), and the classification (`rates` → `equity`). All three were wrong **inputs** that every downstream computation then propagated faithfully. Every check in the guard reads the *output*.

## Decision

**Assert that an asset's declared class does not contradict its own measured market beta.**

`edge_signals.regime_direction_bias` multiplies `ASSET_CLASS_RISK_BETA[asset_class]` by the regime's risk appetite, so a class is a **directional claim**: `equity`/`credit` at `+1.0` say "this falls when equities fall"; `rates`/`fx` at `−1.0` say the opposite. `factor_exposures.beta_mkt` measures whether that is true. The check compares the sign of the claim against the sign of the measurement.

**Only when the beta is material** (`|β| ≥ 0.5`). TLT measures `+0.11` against a rates class expecting negative; a Treasury fund whose equity beta is slightly positive is not a misfiling, and a guard that flagged it would be ignored by the second week. EWZ at `+0.98` and SVXY at `+2.08` are a different claim.

**`commodity` is never flagged.** `ASSET_CLASS_RISK_BETA["commodity"]` is `0.0` — an honest absence of a directional claim, so there is nothing to contradict. That is [ADR-0036](0036-not-computable-is-not-zero.md)'s discipline, not an oversight.

**Coverage travels with the verdict.** It reports "18 of 23 classified tickers checkable" whether it passes or fails. A clean result over three names is not a clean taxonomy, and 30 tickers in `theme_assets` still carry a null `asset_class` — invisible to this check and to `regime_direction_bias` alike ([ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md)'s coverage-first rule).

**The message names the consequence, not the mismatch.** "EWZ is classified 'fx' … but beta_mkt measures +0.98" would read as a taxonomy nit. It says that the sign reaches EdgeScore through `regime_direction_bias` and inverts the regime term, because that is why it is worth a daily run.

## Consequences

**It found a second instance within minutes of being written.** On its first run against production: **EWZ, the iShares MSCI Brazil ETF, classified `fx` with a measured beta of +0.98.** `fx` carries the same `−1.0` haven risk beta that made SVXY's regime term inverted — so a Brazilian equity fund was being scored as something that rallies when risk is sold. Fixed in migration 050 and `SECTOR_MAP` (`FX-EM` → `EM Equities`).

**The code and the database already disagreed, and nothing compared them.** `LENS_TICKER_FALLBACK["equity"]` in `q1_agent.py` listed EWZ; `theme_assets.asset_class` said `fx`. Both were in the repo, neither was checked against the other. Two sources of the same truth with no reconciliation is the shape [ADR-0064](0064-one-formula-one-place.md) records at the display layer, here one layer down.

**Two regression tests carry the defects rather than the fix.** `test_would_have_caught_svxy` and `test_would_have_caught_ewz` pass the *pre-fix* classifications and require a flag. A test asserting the current state would pass forever after someone reintroduced the bug under a different ticker.

**A live guard, not a one-off audit.** It runs in `daily-refresh.yml` with the rest of `check_data_integrity`, so a ticker added next month with a mistaken class is caught on the first night it has 252 days of returns — not on the day someone happens to ask why the book keeps holding it.

**What it does not check.** It compares a *sign*, not a magnitude: an equity classified `equity` with beta 0.04 (XLE, live) passes, and should. It says nothing about sector or geography, both of which feed group caps and neither of which has a measurement to check against. And it cannot see the 30 null-class tickers at all — the honest reading is that this closes the checkable half.
