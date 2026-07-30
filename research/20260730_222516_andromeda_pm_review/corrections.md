# Corrections to `final_turn_001.md`

**The critique is not edited.** `final_turn_001.md` in this folder stays byte-identical to
what was produced on 2026-07-30 at 22:58:24. This file sits beside it and records what
survived verification and what did not, on the same append-only doctrine the ADR series and
`PROGRESS.md` follow: a written artifact that turned out to be wrong is more useful intact
with a correction attached than quietly repaired.

## Provenance

| | |
|---|---|
| Reviewed document | `research/20260730_222516_andromeda_pm_review/final_turn_001.md` (mtime 2026-07-30 22:58:24 +0800) |
| Verified against | working tree at commit `3fcc8f65`, and the live deployment |
| Live deployment drive | `https://andromeda-analytics.vercel.app/` and `/book`, 2026-07-30 ~15:19 UTC, via Playwright. 0 console errors |
| Method | two parallel fact-check agents over the repo (23 claims, `file:line` evidence required for each), plus a direct browser drive of the two pages the critique said were broken |
| Scope | the critique's *factual* claims. Its judgements of taste and emphasis are not adjudicated here, only its assertions about what the repo does and does not contain |

Roughly one third of the specific claims are false, stale, or cite documents that do not
exist. The central argument - that a credit shop is being shown an equity book - survives.

## Findings

Verdicts: **TRUE** (holds as written) / **FALSE** (contradicted by the repo) /
**PARTLY** (a true claim overstated or misattributed) / **STALE** (true when written, no
longer true).

| # | Claim | Verdict | Evidence | Consequence |
|---|---|---|---|---|
| 1 | Live site shows skeletons; "a reviewer clicking the live URL gets no data" | **STALE** | Fixed by `3fcc8f65` at 23:13:35, 15 min after the review was written. Live `/` and `/book` now render `6/6 succeeded / Last run 2026-07-30 (6h ago) / Themes 9 / Held tickers 9`, full position table, 0 console errors | Recommendation 1 is already done. See the staleness note below |
| 2 | The skeleton is "a Supabase anon-key or pipeline-run-id issue" | **FALSE** | Actual cause was `vercel.json` sitting outside `frontend/` (commit message of `3fcc8f65`) | The diagnosis was wrong even during the window in which the symptom was real |
| 3 | Pipeline "wired to fire at 4:30pm ET via `cron-job.org`" | **FALSE** | `.github/workflows/daily-refresh.yml:12`, GitHub Actions cron `30 21 * * 1-5`. `cron-job.org` survives only in ADR-0003, which was superseded | The most credibility-costly error: reads as a stale ADR taken for current state. Also GitHub cron ignores DST, so the run is 17:30 ET in summer, not 16:30 |
| 4 | "191 ADRs" | **PARTLY** | 191 directory entries including `README.md` = 190 ADR files; `0094` is used twice, so 189 unique numbers | Minor, but a provenance critique should count precisely |
| 5 | "39 ticker-mapped instruments" | **STALE** | True at migration 030; migration 050 adds 13 more for AI Capex, giving ~52 across 9 themes | Understates the universe by a quarter |
| 6 | Corporate Credit universe is HYG, LQD, JNK, BKLN, ANGL, EMB | **TRUE** | `009_asset_class_lens.sql:22` | - |
| 7 | No single-name bond, CDS, sovereign, convertible, or currency pair in the universe | **TRUE** | `asset_class` CHECK constraint (`009_asset_class_lens.sql:11`) admits only rates/credit/equity/fx/commodity/crypto/other; every credit instrument is an ETF | **The load-bearing claim, and it holds.** `CDX` and `HY` appear in `LENS_TICKER_FALLBACK` but exist in neither `theme_assets` nor `book_metrics.ASSETS` - placeholders with nothing behind them |
| 8 | "long HYG != long credit ... the app does not surface that explicitly" | **TRUE** | No proxy-basis disclosure anywhere in the book payload or pages | The sharpest cheap-to-fix gap in the document, in a tool whose identity is "no naked numbers" |
| 9 | USD proxied through UUP, FXE, EWZ | **PARTLY** | `LENS_TICKER_FALLBACK["fx"]` is `{UUP, FXE}` only; EWZ is classed `equity` (`009:24`); migration 030 also adds EEM and EMB to the US Dollar theme | - |
| 10 | `factor_fetcher.py` is FF5+UMD only, no credit or rates factor anywhere | **TRUE** | `factor_fetcher.py:50-51` fetches only FF5 and UMD. No spread beta, DTS, or duration factor exists in `backend/` | **The deepest structural gap, and the critique buries it in a sub-paragraph.** Every credit position enters risk, sizing, scenarios and attribution as an equity-beta object. No lens change produces a spread beta |
| 11 | `SECTOR_MAP` is keyed on equity sectors | **PARTLY** | Mostly GICS-like (`Tech Growth`, `Financials`, `Defense`) but mixed with `Credit`, `Rates`, `FX`, `Metals`, `Energy-NatGas` (`book_metrics.py:53-158`) | The caps are not purely equity-shaped; the mandate's *vocabulary* is (no rating, duration, or liquidity-tier buckets) |
| 12 | S4 "transmits through HYG as a market beta event" | **PARTLY** | `scenario_analysis.py:191-209` carries direct per-asset shocks (`HYG -10%`, commented as 150bp x 6yr duration; `LQD -5%`; `TLT +6%`) plus `hml -10%` | Not a beta pass-through. The defensible version of the point: a single index shock cannot express issuer dispersion |
| 13 | Benchmark is S&P 500 only; no CDX IG, CDX HY, iBoxx | **TRUE** | `BENCHMARK_TICKER = "^SPX"` (`daily_refresh.py:2077`); `045_benchmark_returns.sql` keys off it alone | - |
| 14 | `cot_fetcher.py` says credit positioning is "unobservable, not zero" | **TRUE** | `cot_fetcher.py:137-140`, quoted verbatim and correctly | - |
| 15 | Data feeds are FRED, yfinance, Brave, Reddit, GDELT, RSS, Polymarket, COT, Ken French | **PARTLY** | Undercounts: `defense_awards.py` / `award_flow.py` (DoD contract awards) are omitted | - |
| 16 | "The app does not even surface [execution cost]" | **FALSE** | `cost_model.py` prices the optimizer's signed `weight_delta`; live `/book` displays "Estimated cost of that move - $68,226" | Attacks the wrong version of a real gap. The narrow claim - no borrow cost, no market impact - is **TRUE**, and is already declared by the module's own `limitation` field |
| 17 | Phase 05 empty by design, citing ADR-0040 | **PARTLY** | Phase 5 is `coverage: "absent"` (`phases.ts:138-154`) and the note cites 0040, but the ADRs that actually argue it are **0170** and **0169**. ADR-0040 is about reconciling two books | Misattributed, though the underlying fact holds |
| 18 | Phase map is 01 Mandate / 02 Alpha / 03 Construction / 04 Risk / 05 Execution / 06 Attribution | **PARTLY** | Correct as `tab` labels. 03's full name is "Construction & sizing" (`short: "Sizing"`), 06's `short` is "Outcome" | - |
| 19 | No Brinson, no factor decomposition of realised P&L, no contribution-by-theme | **TRUE** | `grep brinson` = 0 hits; `risk_decomposition` is explicitly ex-ante from covariance, per ADR-0082 | Holds. Phase 06 is not *purely* realised P&L though - it also renders the ADR-0182 risk grid |
| 20 | ADR-0182 moved five risk tiles from `/mandate` to `/attribution` | **TRUE** | `0182-four-of-five-were-already-on-the-page.md:38` | - |
| 21 | Citations to `ADR-m038`, `ADR-m048`, `m056` | **FALSE** | No `m`-prefixed ADR exists. The convention is numeric `NNNN-`; migration numbers appear inside ADR bodies, never as ADR prefixes | **Three phantom citations in a document criticising another for provenance discipline** |
| 22 | No scenario builder; the 6 scenarios are fixed | **TRUE** | No `scenario_builder` / `custom_scenario` / `define_scenario` symbol anywhere in the repo | - |
| 23 | No >252d backtest; "what would the strategy have done over 3 years" is unanswerable | **TRUE** | `weights_backtest.py:57,60-61` pins `TRADING_DAYS = MIN_SESSIONS = 252`; ADR-0112 rejects longer windows as contaminated by construction | Holds, and ADR-0112 shows the limit is a decision rather than an omission |
| 24 | No drawdown-triggered de-grossing rule | **TRUE** | No matching logic in `backend/` | - |
| 25 | "982 frontend tests" | **TRUE** | `vitest run`: 76 files, 982 tests passed | - |

## The finding that was true for fifteen minutes

Claim 1 is the only one that was correct when written, and it is worth preserving for that
reason rather than deleting as obsolete.

```
22:58:24   final_turn_001.md written - "/ and /book show skeleton screens ...
           a reviewer clicking the live URL gets no data"
23:13:35   commit 3fcc8f65  fix(vercel): move vercel.json into frontend/ subdirectory
```

Fifteen minutes and eleven seconds. The critique led with this as the thing "a reviewer will
notice first" and put it at recommendation 1 with a 30-minute estimate; the fix was already
in flight as it was being written.

Two things follow. First, a review of a repo under active development decays on the scale of
a single commit, so a finding about *deployment state* has a materially shorter half-life
than a finding about *architecture* - claims 7, 10 and 13 will still be true next month.
Second, the critique's confident diagnosis (anon-key drift, RLS, a missed pipeline run) was
wrong about a symptom it could observe directly, which is a caution about inferring causes
from a rendered page without reading the deploy config.

## What survives

The central argument holds: **the tradeable universe cannot express a credit book.** No
issuer concept, no single-name bond, no CDS, no sovereign, no convertible, no currency pair.
Every credit instrument is an ETF, and the proxy relationship (long HYG is not long credit)
is nowhere disclosed.

Underneath it, the deeper and less-remarked gap: **there is no credit risk factor.** With
FF5+UMD only, a credit PM's first question about any position - what is its spread duration -
has no answer anywhere in the stack, and switching lens does not produce one. The critique
gives this one clause in its twelfth section. It deserves to be second.

Also surviving, in decreasing order of weight: `^SPX`-only benchmarking with no credit index;
no Brinson or realised-P&L factor attribution; no scenario builder; no backtest beyond 252
days; no drawdown-triggered de-grossing; no borrow cost or market-impact term in the cost
model.

## What the critique missed

**The `lens` parameter is not mentioned once.** `q1_agent.py:204` defines
`VALID_LENSES = {multi_asset, credit, rates, equity, fx, commodity}`;
`LENS_TICKER_FALLBACK["credit"]` lists 14 tickers (of which ~12 map to live instruments);
`LENS_PROMPT_FRAMING["credit"]` injects an instruction to frame every pick in spreads,
default risk, ratings, carry and roll-down, and to name the credit sub-sector and cycle
phase. `screen_candidates` enforces the filter. ADR-0015 records the rationale in as many
words: the credit lens is the natural fit for Andromeda Capital's mandate.

This does not refute the critique - 12 ETFs is still not a credit book, and none of the
structural gaps above are touched by a lens. But 150 lines are spent arguing for a capability
the repo already anticipated, and the remedy changes as a result: the useful move is to
**publish the credit-lens book** rather than, as recommendation 2 proposes, add a disclaimer
saying this is an equity book.

The critique's own evidence would have been stronger here. The live book - long SMH, GEV,
NUE, JD; short GLD, BABA, UNG, ARKK, MSFT - is an all-equity-and-commodity book produced
under the *multi-asset* lens. "The machinery can express credit and the published output does
not" is a harder claim than "the universe is equity", which is only partly true.

## Assessment of the recommendations

1. **Fix the live deployment** - done, 15 minutes after the review was written, by a
   different fix than the one proposed.
2. **Add an "this is an equity book" callout** - weak, and weaker still given the lens
   exists and the submission prose has not been written yet. Publishing the credit-lens book
   beside the multi-asset one is a better answer; if that book is thin, its thinness is the
   honest disclosure, with numbers.
3. **Add a fallen-angel scenario that transmits through `SECTOR_MAP` rather than beta** - the
   best recommendation in the document. Specific, cheap, uses machinery S6 already proves,
   and demonstrates the generalisation claim instead of asserting it.
