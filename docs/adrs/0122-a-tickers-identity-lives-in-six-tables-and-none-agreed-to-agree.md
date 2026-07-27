# ADR-0122: A ticker's identity lives in six tables, and none of them agreed to agree

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0015](0015-lens-mode-asset-class.md), [ADR-0064](0064-one-formula-one-place.md), [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0119](0119-svxy-is-equity-risk-and-the-taxonomy-said-haven.md), [ADR-0120](0120-the-guard-reads-the-taxonomy-not-just-the-book.md), [ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md)

## Context

[ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md) ended on the generalisable failure: *"I fixed a name, not a path."* SVXY's identity is asserted in eight places, and four of today's defects were two of those places disagreeing.

Two pairs were still unreconciled:

**`scenario_analysis.DEFAULT_TICKER_BETAS` against measured `factor_exposures.beta_mkt`.** It held `SVXY {"mkt": -0.60}` against a measured **+2.08** — wrong sign, 2.7 apart. It is the stress model's *fallback*, used only when live FF5 data is missing, which is precisely why it rotted: **the degraded path is never exercised on a good day**, so its assumptions are consulted only once everything else has already failed.

**`LENS_TICKER_FALLBACK` against `_ASSET_CLASS_MAP`.** These disagreed in *both* directions on the same day: SVXY was listed under the `rates` and `credit` lenses while measuring beta +2.08, and EWZ was listed under `equity` while the class map called it `fx`. The lens decides which candidates the book may hold; the class decides how the regime scores them. Nothing compared them.

## Decision

**Cross-check both pairs in the daily guard.**

`check_default_betas_match_measured` is **deliberately tolerant**. A fallback's job is to be a reasonable *prior*, not today's point estimate — syncing it to the current measurement would defeat its purpose, since if the measurement were available it would be used instead. Only two things are flagged:

- **signs disagree while both values are material** — a claim about direction, which a prior does not get to be wrong about;
- **the gap exceeds 1.0** — no longer a prior, just a wrong number.

Calibrated against the live table, where the largest legitimate gaps are SLV (+0.25 assumed vs +1.08 measured) and XLE (+0.80 vs +0.04). Both are same-sign and under 1.0, and **neither fires**; the pre-fix SVXY entry does. `test_the_live_table_is_clean` pins that calibration against the real constants.

`check_lens_membership_matches_asset_class` requires exact agreement, with **one documented widening**: the credit lens legitimately holds `rates`, by its own comment — *"a credit book includes duration exposure"*. Encoding the exception is what lets the rest be strict.

## Consequences

**SLV and XLE are left alone, on purpose.** SLV assumes +0.25 and measures +1.08; XLE assumes +0.80 and measures +0.04. Both are real divergences and neither is a defect: energy decoupling from the market over a year, and silver trading as a risk asset, are things a *prior* is entitled to be behind on. Changing them to today's numbers would make the fallback track the measurement it exists to substitute for — and would need re-tuning every time the regime turned.

**This closes the checkable cross-products, not the taxonomy.** A ticker's identity is asserted in `SECTOR_MAP`, `GEO_MAP`, `_ASSET_CLASS_MAP`, `theme_assets.asset_class`, `LENS_TICKER_FALLBACK`, `DEFAULT_TICKER_BETAS`, `cot_fetcher.ContractMap` and `_theme_default_assets`. Four pairs now have a check: class↔measured beta, code map↔database column ([ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md)), fallback beta↔measured beta, and lens↔class. `GEO_MAP` and `_theme_default_assets` still have none, because **neither has a measurement to check against** — a geography is a claim about domicile, and nothing in the pipeline measures domicile. Saying so is more useful than inventing a proxy.

**The real fix is structural and is not this.** Six tables keyed on ticker, each independently editable, is the problem; cross-checks are a way of living with it. One owning record per ticker — one row, one class, one sector, one geography, one prior beta — would make five of these checks unnecessary. That is a schema change with a migration path through every consumer, and it should be its own ADR rather than smuggled into a guard.

**995 backend tests.** The five regression tests carry the *defects*: pre-fix SVXY under `rates`, pre-fix EWZ under `equity`-while-`fx`, and the −0.60 beta. Asserting the current constants would pass forever once someone reintroduced the same mistake on a new ticker.
