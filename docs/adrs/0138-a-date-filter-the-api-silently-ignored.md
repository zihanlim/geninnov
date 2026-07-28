# ADR-0138: A date filter the API silently ignored

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0023](0023-data-provenance-and-fabrication-guard.md), [ADR-0028](0028-minmax-correlation-consistency.md), [ADR-0066](0066-not-computable-must-persist-as-null.md), [ADR-0089](0089-a-citation-the-reader-can-follow.md), [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md)

## Context

A reader noticed 2025 headlines in the top ribbon. The database said it was worse: the 2026-07-28 run's `theme_news` held **386 rows, 43 of them published before 2026, the oldest from 2001-11-16** ("Rising Junk Bond Yields: Liquidity or Credit Concerns?", San Francisco Fed). Only 186 fell inside the intended lookback. The stale rows were all of one species -- evergreen explainers: "Junk Bonds - Econlib", the EIA's "What is OPEC+", NerdWallet on CPI.

The cause is a parameter that does not exist. `scripts/call_brave_mcp.js` sent the lookback as `from=<date>`; the Brave News API's date filter is **`freshness`** (range form `YYYY-MM-DDtoYYYY-MM-DD`), and Brave ignores unknown parameters **without erroring**. So every fetch since the script was written was an unfiltered, relevance-ranked search -- and relevance ranking loves the evergreen page that has been accumulating links since 2015. The window existed only in this codebase's intentions: computed in Python, passed to Node, appended to the URL, discarded by the API. Nothing downstream could catch it, because nothing downstream re-checked the dates -- `persist_theme_news` writes what the fetcher returns.

A second defect compounded it: items whose `page_age` did not parse were stamped with **today's** date. The ribbon sorts by `published_date desc`, so a page of *unknown* age was shown *first*, presented as today's news -- fabrication promoted to the top slot.

Blast radius beyond the ribbon: L1 mention counts are bucketed by day, so falsely-today-stamped items inflated `mention_count_1d`; and `fetch_market_news` shares the helper, so the L1b un-themed corpus (ADR-0128) carried the same pollution -- 120 of the run's 220 market rows predated their 7-day window.

## Decision

**Send the window as `freshness`, refuse to fabricate dates, and re-check the window in Python.**

1. **`freshness=<date_from>to<today>`** replaces `from=<date_from>` in `call_brave_mcp.js`. The param-building and result-mapping are extracted as exported pure functions (CLI under `require.main`), so `frontend/tests/unit/brave-freshness.test.ts` exercises the real script -- the same never-a-copy rule the chat tools follow.

2. **An unparseable `page_age` maps to `date: null`, never today.** ADR-0066's rule applied to timestamps: "we do not know when" must not render as "now". Null survives to `published_date` as NULL; the frontend orders `nullsFirst: false` so unknown-age items trail dated ones; and the mention bucketing in `build_theme_signals` counts them toward **no** day -- an item whose day is unknown cannot testify to any day's volume.

3. **`_within_lookback` in `brave_client.py` drops any item whose parseable date precedes the window**, in both `fetch_news_for_theme` and `fetch_market_news`. This is defense in depth, and the reason it earns the duplication is the failure mode just observed: the API-side filter failed *silently* for the script's whole life. If it regresses that way again, the Python-side drop contains it. Undated items are kept -- with `freshness` applied the feed cannot return anything older than the window, and "date unknown" is not "old".

The alternative -- filtering only in Python and leaving the API unfiltered -- was rejected: the 50-result page (ADR-0028's density argument) would then be *spent* on evergreen results before filtering, returning perhaps a dozen usable headlines from a page that could have held fifty fresh ones. The API must filter so the page is dense; Python must filter so the API's silence is never trusted twice.

The published run was repaired in place: 91 pre-window rows deleted from `theme_news` (30-day window) and 120 from `market_news` (7-day window) for `run_date = 2026-07-28`. History for earlier run_dates is left as collected -- those rows record what the scores of their day were computed from.

## Consequences

- The ribbon and feed show only in-window headlines; the repaired run spans 2026-06-29 to 2026-07-28.
- HypeScore volume/momentum inputs stop counting evergreen pages and stop crediting unknown-age items to today. Scores computed by earlier runs are not restated (L1 is deliberately not backfillable -- see `backfill_regime.py`'s docstring).
- The L1b corpus is bounded to its window, so share-of-voice measures this week's news rather than the accumulated back catalogue.
- `published_date` is now honestly nullable. Consumers must treat NULL as "unknown", not "recent"; `NewsRow` already did.
- A quota note: `freshness` narrows results, it does not add requests -- the fetch count per run is unchanged.
- What this does NOT fix: mention *quality* still rests on a single provider (ADR-0094), and a fresh-but-irrelevant headline still counts. The window is necessary, not sufficient.
