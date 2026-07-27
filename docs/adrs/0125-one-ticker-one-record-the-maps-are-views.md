# ADR-0125: One ticker, one record — the taxonomy maps are views

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0064](0064-one-formula-one-place.md), [ADR-0119](0119-svxy-is-equity-risk-and-the-taxonomy-said-haven.md), [ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md), [ADR-0122](0122-a-tickers-identity-lives-in-six-tables-and-none-agreed-to-agree.md), [ADR-0124](0124-a-comment-doing-a-tests-job-is-how-the-defect-survived.md)

## Context

2026-07-27's fourth SVXY defect ([ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md)) had a specific shape: a ticker's sector, geography and asset class lived in **three separately-editable dicts across two modules** — `SECTOR_MAP` and `GEO_MAP` in `book_metrics`, `_ASSET_CLASS_MAP` in `trade_ranker`. A fix landed in two of them and missed the third, and the third was the one with the consequence.

[ADR-0122](0122-a-tickers-identity-lives-in-six-tables-and-none-agreed-to-agree.md) added cross-checks and named them what they are: *a way of living with the problem, not fixing it*. [ADR-0124](0124-a-comment-doing-a-tests-job-is-how-the-defect-survived.md) then deferred this consolidation behind the scenario-override check on an honest audit — consolidation prevents the *missed-edit-site* class (one of the four defects), validation prevents the *wrong-value* class (three of four) — and verified its precondition: **nothing mutates the three maps at runtime** (grepped for subscript-assignment, `update`, `pop`, `setdefault`, `clear`, `del`; zero hits outside tests).

## Decision

**`ASSETS: dict[str, AssetRecord]` in `book_metrics` is the one owning record.** `AssetRecord(sector, geo, asset_class)` is frozen — a mutable record would reintroduce the half-edit one field at a time. The three maps become derived views:

```python
SECTOR_MAP        = {t: r.sector      for t, r in ASSETS.items()}
GEO_MAP           = {t: r.geo         for t, r in ASSETS.items()}
_ASSET_CLASS_MAP  = {t: r.asset_class for t, r in ASSETS.items()}   # in trade_ranker
```

Every consumer keeps its existing import, unchanged — zero call-site churn. Import direction already ran `trade_ranker → book_metrics`, so no cycle.

**The move changed zero values, provably.** The record literal was *generated from the live dicts* rather than transcribed, and the derived views were asserted equal to a pre-edit snapshot of all three maps — byte-for-byte — before anything else ran. Any actual reclassification is a separate commit with its own reasoning; this one is structure only.

**In code, not the database — deliberately.** A misclassification in code is a reviewable diff with an ADR trail; in a table it is an invisible `UPDATE`. Yesterday's SVXY bug was findable *because* the map was readable in the repo. `classify()` also sits in hot paths and must not need a round-trip. `theme_assets.asset_class` stays as the lens filter, cross-checked nightly and **deliberately not auto-synced** — a silent sync would erase the disagreements the check exists to surface.

**What deliberately does not live in the record:** `DEFAULT_TICKER_BETAS` (a prior estimate, not an identity), `cot_fetcher.ContractMap` (a futures mapping), theme membership, and `LENS_TICKER_FALLBACK`. The lens list contains tickers outside the 53-ticker universe (`CDX`, `HY` — index names, not instruments), so deriving it would silently shrink its membership — a value change, which this move is forbidden to make. Its [ADR-0122](0122-a-tickers-identity-lives-in-six-tables-and-none-agreed-to-agree.md) cross-check stays.

## Consequences

**The ADR-0121 failure is now unrepresentable, not merely detected.** `check_asset_class_maps_agree` (code map ↔ DB column) still runs; the code-side maps can no longer disagree with *each other* because there is nothing to disagree — they are three projections of one dict. The co-extensiveness test still passes, now trivially, and stays as a tripwire against someone re-introducing a literal beside the record.

**The concurrent session's same-object alias survives, and is now pinned.** `ASSET_CLASS_MAP is _ASSET_CLASS_MAP` was added (with a consumer in `daily_refresh.per_class_corr`) precisely so no consumer gets its own snapshot; the derivation preserves it and `test_the_public_alias_is_the_same_object` asserts it. **This commit necessarily includes that alias** — it is adjacent to the replaced literal and inseparable in the diff; the derivation was built to keep its contract. The session's unrelated in-flight work (`correlation_pairs_to_dict` threshold) is *not* staged here.

**Verified:** all three views equal the pre-edit snapshot; `classify("SVXY")` unchanged; 1035 backend tests green; the nightly guard clean under its production invocation (47/53 checkable, scenario overrides reconcile).

**What this does not solve.** Wrong *values* — three of yesterday's four defects. Those remain the guards' job ([ADR-0120](0120-the-guard-reads-the-taxonomy-not-just-the-book.md)/[0122](0122-a-tickers-identity-lives-in-six-tables-and-none-agreed-to-agree.md)/[0124](0124-a-comment-doing-a-tests-job-is-how-the-defect-survived.md)), and the record makes their coverage simpler, not unnecessary.
