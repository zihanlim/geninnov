# ADR-0121: The fix missed the map that mattered, and the new guard said clean

**Status:** Accepted
**Date:** 2026-07-27
**Corrects:** [ADR-0119](0119-svxy-is-equity-risk-and-the-taxonomy-said-haven.md) (incomplete fix), [ADR-0120](0120-the-guard-reads-the-taxonomy-not-just-the-book.md) (guard read the wrong map)
**Related:** [ADR-0064](0064-one-formula-one-place.md), [ADR-0015](0015-lens-mode-asset-class.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md)

## Context

[ADR-0119](0119-svxy-is-equity-risk-and-the-taxonomy-said-haven.md) diagnosed SVXY correctly: classified as a haven, measured beta +2.08, so EdgeScore's regime term favoured it in the tape that takes it to −35%. It then fixed **`SECTOR_MAP`** and **`theme_assets.asset_class`**.

Neither of those is what `regime_direction_bias` reads.

There are **two** asset-class maps, and they do different jobs:

| map | consumer |
|---|---|
| `trade_ranker._ASSET_CLASS_MAP` | what `classify()` returns → `daily_refresh` → `theme_regime_bias` → **EdgeScore** |
| `theme_assets.asset_class` (DB) | the lens filter ([ADR-0015](0015-lens-mode-asset-class.md)) |

`_ASSET_CLASS_MAP["SVXY"]` was still `"rates"`. So after a migration, a `SECTOR_MAP` edit, an ADR and a commit, `classify("SVXY")` still returned `asset_class: "rates"` and **the regime term was still inverted.**

[ADR-0120](0120-the-guard-reads-the-taxonomy-not-just-the-book.md) then built a guard for exactly this class of defect — and pointed it at `theme_assets.asset_class`, the map without the consequence. It reported **"every classified asset's beta agrees with its class"** while the defect it was written to catch was live.

**That is worse than not having built it.** An unknown is a prompt to look; a false assurance is a reason not to.

## Decision

**Fix the map with the consequence.** `_ASSET_CLASS_MAP`: SVXY `rates` → `equity`, EWZ `fx` → `equity`. Verified through the seam that matters rather than the table: `classify("SVXY")["asset_class"] == "equity"`, and `regime_direction_bias` in a risk-off tape now returns **−0.55** where it returned **+0.55**.

**Point the guard at the same seam.** `check_asset_class_matches_measured_beta` now runs against `_ASSET_CLASS_MAP` *and* the database column, labelling which map each flag came from. Coverage rose from 18 of 23 to **47 of 53** tickers, because the code map is much larger than the database's non-null set — so the original guard was also checking the smaller half.

**Add `check_asset_class_maps_agree`.** A divergence between the two maps is a defect regardless of which side is right, because every consumer gets whichever it happened to import. This is [ADR-0064](0064-one-formula-one-place.md)'s "one formula, one place" applied to a lookup table, and [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md)'s lesson one layer down: a guard that reads one of two sources guards one of two consumers.

**A ticker present in only one map is not flagged.** The code map covers 53 tickers and the DB column 23; absence is a coverage gap, not a contradiction, and conflating them would bury real divergences.

## Consequences

**Two tests now assert the seam, not the table.** `test_classify_is_what_reaches_the_regime_term` calls `classify()` and pushes the result through `regime_direction_bias`, requiring a risk-off tape to *fade* a levered equity proxy. A test asserting `_ASSET_CLASS_MAP["SVXY"] == "equity"` would have passed on ADR-0119's incomplete fix if the constant had been the thing edited; this one fails unless the whole path agrees.

**The published book was never wrong about this — the scoring was.** No republication is needed; the correction reaches the next run.

**The generalisable failure is "I fixed a name, not a path."** SVXY appears in `SECTOR_MAP`, `GEO_MAP`, `_ASSET_CLASS_MAP`, `theme_assets`, `LENS_TICKER_FALLBACK`, `DEFAULT_TICKER_BETAS`, `cot_fetcher.ContractMap` and `_theme_default_assets` — eight sites. ADR-0119 grepped, edited the ones it found, and did not trace which one the *stated* consequence flowed through. The check that would have caught it is the one now added: not "is this ticker right" but "do the places that claim to know this agree".

**Four SVXY defects in one day, and the taxonomy is the common thread.** Stress signs, market beta, classification, and now the classification *again* in a second map. The instrument is unusual; the repo's handling of unusual instruments is the actual issue, and it is a taxonomy with no volatility class and no single owner for a ticker's identity.
