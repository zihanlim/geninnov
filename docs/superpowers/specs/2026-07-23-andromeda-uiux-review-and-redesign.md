# Andromeda — UI/UX Review & Redesign Spec

**Date:** 2026-07-23
**Scope:** Can a portfolio manager use the Andromeda frontend to answer `task.md`?
**Verdict:** No. The compute layer is largely there; the presentation layer is not.

---

## Context

`task.md` asks two questions:

1. **Q1** — "You have $100M to invest long and short across any asset class. What are your top five long and short trades, and why?"
2. **Q2** — "Design a daily process that identifies which themes are trending and quantifies how much attention/hype each is attracting, so the output supports both idea generation *and risk monitoring*. Explain data gathering → processing → quantification framework. A prototype would be a plus."

The backend can substantially answer both. The frontend can currently answer **neither**, for three separate classes of reason:

| Class | Summary |
|---|---|
| **A. Broken plumbing** | The page that answers Q1 (`/research`) issues a query for columns that do not exist and therefore renders its empty state permanently. |
| **B. Computed-then-discarded** | The most decision-relevant quant output — 4-scenario stress P&L, book factor tilts, sector/geo cap utilisation, the 252d correlation matrix — is computed every run, formatted into a string for the LLM prompt, and then **thrown away**. It is never persisted and never rendered. |
| **C. No decision surface** | Even where data exists, the UI presents scalars without the decomposition a PM needs: no risk contribution per position, no cap utilisation, no stress results, no hype time series, no sizing rationale, no "what changed since yesterday". |

A fourth issue cuts across all of them and is the most damaging in a hedge-fund context:

| **D. Fabricated content** | Multiple surfaces present invented numbers and invented prose as if they were pipeline output — hardcoded investment theses, a "synthetic but stable" sub-score attribution, a Kelly-fraction sizing formula that exists nowhere in the backend, fabricated source counts, a permanently-green "Pipeline healthy" indicator. |

The visual design system is genuinely good — dark Bloomberg-adjacent palette, tabular monospace numerals, semantic long/short colour, consistent card grammar. **The problem is not aesthetics. It is that the UI looks like a quant tool without functioning as one.** That gap is worse than an ugly tool that works, because it invites trust it has not earned.

---

## Part A — Scorecard against `task.md`

### Q1: "Top five long and short trades, and why"

| What a PM needs | Backend has it | Frontend shows it |
|---|---|---|
| 5 longs + 5 shorts | ✅ `q1_agent.reason_picks` | ❌ `/research` is dead (see A1) |
| Per-trade thesis | ✅ `picks[].thesis` | ❌ same |
| Counter-thesis w/ measurable disqualifier | ✅ `picks[].counter_thesis` (prompt mandates a level) | ❌ same |
| Catalysts + time horizon | ✅ `picks[].catalysts`, `time_horizon` | ❌ same |
| Position size + why that size | ✅ `allocate_portfolio` (cap-enforced) | ⚠️ `/portfolio` shows the size; the "why" panel shows **invented math** |
| Factor tilt per trade | ✅ `picks[].factor_tilts` | ❌ not rendered |
| Book-level exposure (gross/net/sector/geo) | ✅ `book_metrics.compute_book_metrics` | ❌ **discarded, never persisted** |
| Entry/exit/stop levels, target, risk-reward | ❌ not computed anywhere | ❌ |

### Q2: "Systematic daily process + hype quantification + risk monitoring"

| What a reviewer needs | Backend has it | Frontend shows it |
|---|---|---|
| Which themes are trending | ✅ `themes.hype_score` | ✅ heatmap + cards (best-working surface in the app) |
| How much attention each attracts | ✅ HypeScore + 4 sub-scores | ✅ heatmap; ⚠️ derivation drawer contains fabrications |
| **Trend over time** | ✅ `theme_signals_history` (daily rows) | ❌ **no time series anywhere.** `Sparkline` exists; `theme.history` is never populated |
| Mentions vs price overlay | ✅ inputs exist | ❌ never built (spec §8.1 `MarketCorrelation`) |
| Crowding / percentile vs own history | ✅ data exists | ❌ `ConvictionCard` has a `crowding` field, always `—` |
| The process explained | ✅ in `docs/` | ❌ nothing in the product |
| Pipeline health / data freshness | ✅ `pipeline_runs` table (T10) | ❌ **never queried.** `LiveFeed` hardcodes "Pipeline healthy" |
| Risk monitoring | ✅ VaR/CVaR/Sharpe/β/HHI + 4 stress scenarios + correlation matrix | ⚠️ 5 scalars only; stress + correlation discarded |

---

## Part B — Service → surface matrix

Everything the backend computes, and whether a PM can see it.

| Layer / service | Produces | Persisted | Rendered | Gap |
|---|---|---|---|---|
| L0 `macro_fetcher` | FRED series, `macro_daily_history`, `market_assets` | ✅ | ⚠️ | `MarketBar` + `RegimeInputsPanel` only. No macro time series, no "what moved today" |
| L1 `build_theme_signals` | mentions 1d/7d, VADER, `price_corr`, momentum z | ✅ | ⚠️ | Point-in-time only; the history table is never charted |
| L2 `factor_fetcher` | FF5+UMD betas + R² per asset | ✅ **36 rows / 25 assets** | ❌ | Data is *there*; the UI reads a table that doesn't exist (D3/D4) |
| L3 `regime_classifier` | cycle × sentiment + 6 inputs | ✅ | ✅ | Best-plumbed layer. Missing: regime history / transition log |
| L4 `risk_engine.compute_risk` | VaR, CVaR, Sharpe, β, HHI + `NumericDerivation` | ✅ | ⚠️ | 5 flat cards. No decomposition, no limits, no history, no per-position contribution |
| `book_metrics.compute_book_metrics` | book factor tilts, gross/net, long/short weight, **sector & geo weights**, **cap violations** | ❌ | ❌ | **Computed → stringified for the prompt → discarded** |
| `book_metrics.compute_correlation_matrix` | 252d pairwise Pearson, high-corr pairs | ❌ | ❌ | **Same.** This is the single most useful un-surfaced risk artefact |
| `scenario_analysis.run_scenario_analysis` | 4 stress scenarios: book return, $ P&L, per-position contribution, severity | ❌ | ❌ | **Same.** This is the answer to "what are the risks" |
| `trade_ranker.allocate_portfolio` | cap-enforced weights (20/30/35) | ✅ | ⚠️ | Weights shown; cap *utilisation* invisible |
| L5 `q1_agent` picks | thesis, counter-thesis, catalysts, horizon, factor tilts, citations | ✅ | ❌ | `/research` is dead (A1) |
| L5 citation guardrail | `citations`, `verified`, `retries` | ✅ | ⚠️ | `CitationList` exists but only renders on the dead page |
| `pipeline_runs` (T10) | per-stage status, duration, source freshness | ✅ | ❌ | **Never queried by any component** |
| `portfolio_cumulative_return` | since-inception compounded | ✅ | ✅ | Fine |
| `polymarket_fetcher` | prediction market odds | ⚠️ | ⚠️ | Migration 011 not deployed → 404 in prod |
| `theme_discovery` | candidate new themes | ❌ | ❌ | Shadow mode, no UI (accepted, R5) |

**Headline:** the three richest quant artefacts in the codebase — stress scenarios, book metrics, and the correlation matrix — exist only as transient strings inside an LLM prompt.

---

## Part C — Trust defects (fix before anything else)

In a risk tool, an invented number is worse than a missing one. Each of these presents fabricated content in the visual grammar of pipeline output.

| # | Location | Defect |
|---|---|---|
| C1 | `frontend/app/page.tsx:41-57` | `deriveThesis()` — a hardcoded map of investment theses per theme name ("Powell signals September cut conditional on disinflation…"). Rendered on the hero cards as analysis. |
| C2 | `frontend/app/page.tsx:62-80` | `splitDelta()` — the comment says *"Synthetic but stable per-theme attribution"*. Fabricated sub-score attribution feeding `ScoreDeltaBadge` tooltips. |
| C3 | `frontend/app/page.tsx:177-185` | Watchlist `delta = hype_score − momentum_score × 0.1`. Not a quantity that means anything. |
| C4 | `frontend/components/TradeIdeasTable.tsx:31-42` | `FALLBACK_THESIS` — hardcoded per-ticker theses (NVDA, VST, RHM.DE…) shown when the real one is absent. |
| C5 | `frontend/components/TradeDerivationDrawer.tsx:98-99` | Claims to show "TradeScore math · 0.55 × momentum + 0.45 × sentiment" but computes `momentumComp = ts × 0.85`, `sentComp = ts × 0.15`. **The displayed derivation contradicts its own stated formula and the backend** (`trade_generator.py:56-59`). |
| C6 | `frontend/components/TradeDerivationDrawer.tsx:106,230` | "Kelly fraction (\|trade_score\| × 0.30, capped 0.50)". **There is no Kelly sizing anywhere in the backend.** Invented. |
| C7 | `frontend/components/TradeDerivationDrawer.tsx:222-227` | Sizing shown as `hype / (hype × n)` — not the real formula (`allocate_portfolio` normalises `hype/100` across the candidate set then applies three caps). |
| C8 | `frontend/components/ThemeDerivationDrawer.tsx:171-176` | `sourceCounts = mention_count × {0.62, 0.30, 0.08}` rendered as "Brave News 14 · Reddit 7 · yfinance 2". Fabricated source attribution — and directly contradicted by risk **R0b** (Reddit credentials are empty; the social signal is one mock post per theme). |
| C9 | `frontend/app/research/page.tsx:112` | `Conviction: <span className="text-long">HIGH</span>` — hardcoded HIGH for every pick. |
| C10 | `frontend/app/research/page.tsx:309` | `PROMPT v q1-agent-v2.0.0` hardcoded; actual is `v2.1.0` (`q1_agent.py:73`). |
| C11 | `frontend/components/LiveFeed.tsx:47,51` | Always-visible footer says **"Pipeline healthy"** (never checks `pipeline_runs`) and **"Next refresh: 2026-07-22 16:30 ET"** — a hardcoded date now in the past. |
| C12 | `frontend/app/trades/page.tsx:37`, `ThemeHeatmap.tsx:72,93`, `ThemeDerivationDrawer.tsx:278,291` | "12 themes · 32 tickers", "Normalized across 12 themes" — hardcoded counts. |
| C13 | `frontend/app/page.tsx:33-38` | `nextRefreshDate()` always returns "tomorrow 16:30 ET" regardless of whether the cron exists (R4: it is externally owned and unverified). |

**Rule to adopt:** no investor-facing string may be authored in the frontend. Either it comes from the pipeline with a `NumericDerivation`/`AdvisoryDerivation`, or the surface renders an explicit unavailable state. The project already has exactly this machinery (`backend/derivations/`, `frontend/lib/derivations/`, `StatusBadge`) and ADR-0010/0012/0018 already argue for it — the fabrications above are violations of the project's own stated policy, not gaps in it.

---

## Part D — Blocking data-plumbing bugs

### D1 — `/research` is permanently dead *(severity: critical)*

`frontend/app/research/page.tsx:233` selects:

```
run_date, picks, book_view, book_risks, agent_run_id,
book_metrics_summary, scenario_table, advisory_derivation
```

`research_recommendations` (created `supabase/migrations/006_factor_exposures.sql:41-49`, extended only by `013_derivations.sql:18` with `advisory_derivation`) has **no `book_metrics_summary` and no `scenario_table` column**. PostgREST rejects unknown columns with `400`, so `recRes.data` is `null`, `rec` is `null`, and the page renders *"No Q1 recommendations yet"* — **unconditionally, forever, even on a perfect pipeline run.**

The single page that answers Question 1 of the assessment cannot render.

### D2 — Book metrics and scenario analysis are computed then discarded

`q1_agent.compute_book_metrics_node` (`:435-499`) and `run_scenario_analysis_node` (`:506-533`) write `state["book_metrics_summary"]`, `state["scenario_table"]`, `state["correlation_warnings"]`, `state["cap_violations"]`. `_persist_to_supabase` (`:1257-1264`) writes only `picks`, `book_view`, `book_risks`, `agent_run_id`, `advisory_derivation`.

Everything else is dropped on the floor. Worse, they are computed as **pre-formatted display strings** rather than structured data, so even persisting them yields text blobs rather than something chartable. They should be structured JSONB.

Additionally both nodes run on the **equal-weighted candidate pool**, not the final sized book — so the numbers describe a portfolio that is never actually held.

### D3 — L2 runs out-of-band, so the pipeline can't rely on it

**Correction to an earlier draft of this review:** `factor_exposures` *is* populated — 36 rows across 25 assets, `run_date` 07-22 and 07-23, `beta_mkt` non-null in 36/36. P7 in `RESIDUAL.md` was genuinely fixed.

The defect is narrower but still real: `scripts/daily_refresh.py` orchestrates L0, L1, L3, L4, L5 and **never imports `factor_fetcher`**. L2 is populated by ad-hoc invocation only, so within a single `daily_refresh` run there is no guarantee the betas are current. Confirmed by `pipeline_runs`, which for 2026-07-23 contains **only L0 and L3 rows** — no L2 stage is ever recorded because no L2 stage is ever run by the pipeline.

Downstream, when factor data happens to be stale or absent:

- `q1_agent.screen_candidates` R² ≥ 0.10 filter is inert (`:379` guards on `if factor_exp:`)
- `compute_book_metrics` returns all-zero tilts
- `scenario_analysis` falls through to `DEFAULT_TICKER_BETAS` (`scenario_analysis.py:37-66`) — hand-written approximations presented downstream as computed betas

### D4 — `portfolio_factor_exposure` does not exist *(so good L2 data is invisible)*

Queried by `frontend/app/page.tsx:118` and `frontend/app/portfolio/page.tsx:146`. Returns `404 PGRST205` in production; Supabase's own error hint is *"Perhaps you meant the table 'public.factor_exposures'"*.

So the situation is: **36 rows of real factor betas sit in the database while both factor panels render "Awaiting factor run…"** — the homepage hero tilt panel and the `/portfolio` "Factor exposure vs SPX" card. This is the cheapest high-value fix in the whole review: it needs a book-weighted aggregate view over `factor_exposures × portfolio_positions`, not new computation.

### D7 — `regime_classifications.narrative` does not exist

Selected on `/research` (`page.tsx:239`) → second `400 42703` on that page, and read as `regime?.narrative` on `/` (`page.tsx:189-192`).

The homepage consequence is the most visibly damaging bug in the product: because the headline is keyed off the missing `narrative` column, `/` renders

> **MACRO REGIME · LATE · RISK-ON** *(correct, live, real)*
> "Macro regime classification pending — pipeline needs one full run." *(directly beneath it)*

A self-contradicting regime panel, on the first screen, above the fold.

### D8 — Sub-score unit mismatch: 0–1 values rendered on a 0–100 scale

`persist()` writes `themes.volume_score`, `sentiment_score`, `corr_score`, `momentum_score` as **min-max normalised [0,1]** values (`daily_refresh.py:251-254`). `ThemeHeatmap` treats them as **0–100** (`cellColor` centres on 50, `Math.round(v)` for the label).

Result: every sub-score cell renders as `1` on a deep-red background, for every theme, in every column. Four of the six heatmap columns are visually meaningless.

Compounding it: `themes.volume_score` and `corr_score` are the **constant 0.5 across all 8 themes** — so two of HypeScore's four dimensions currently carry no information at all, and HypeScore is effectively `0.20 × sentiment + 0.20 × momentum + 0.60 × constant`. That is the real reason scores cluster in the 25–46 band described in E3, and it deserves a fix upstream of any UI work.

### D9 — No historical HypeScore, so every Δ is blank

`theme_signals_history.hype_score` is **NULL in 24 of 24 rows**, despite `themes.hype_score` being populated. P4 in `RESIDUAL.md` records the write path as fixed, but the persisted data does not yet reflect it.

Consequences: `Δ1D` renders `—` for all 8 themes on the heatmap and all 3 conviction cards; TradeScore's 0.55-weighted momentum term is still structurally zero; and the time-series work proposed in F.3 has no data to chart until this is backfilled.

### D5 — The lens control is a no-op on three of four pages

`LensSelector` is wired to `onChange={() => undefined}` at `app/page.tsx:248`, `app/trades/page.tsx:33`, and `app/research/page.tsx:299`. Clicking does nothing.

Where it *is* wired (`/portfolio`, `TradeIdeasTable`), it filters client-side by `asset_class`. But the backend `lens` parameter (ADR-0015) does something categorically different: it re-frames the LLM prompt and re-screens the candidate pool to produce a *credit book*. There are **no API routes in the app** (`frontend/app/` contains only pages), so the L5 lens can never be invoked from the UI. "Credit Lens" shows a filtered subset of a multi-asset book, labelled as though it were a credit book.

### D6 — L5 `size_positions` ignores the caps it documents

`q1_agent.size_positions` (`:962-989`) allocates purely by `hype_score / Σ hype_score`. No single-name, sector, or geo cap is applied — despite `ARCHITECTURE.md` and the module docstring both claiming "HypeScore-weighted $100M allocation + cap enforcement". It also assigns **positive** weights to shorts, so the resulting book reports gross = 100% and net = 100%, which is not a long-short book.

The cap-enforcing implementation exists and is correct (`trade_ranker.allocate_portfolio`) — L5 just doesn't call it.

---

---

## Part D.10 — Verified production state (2026-07-23)

Measured directly: read-only SQL against the live Supabase project, and Playwright against `https://andromeda-analytics.vercel.app`.

### Data

| Table | Rows | Note |
|---|---|---|
| `themes` | 8 | HypeScore 25.3–45.7. `volume_score` and `corr_score` = **0.5 for all 8** (D8) |
| `theme_signals_history` | 24 | `hype_score` **NULL in 24/24** (D9); `price_corr` = 0.0 wherever present |
| `theme_assets` | 29 | Populated, `asset_class` set |
| `factor_exposures` | **36** | Real, 25 assets — and completely invisible in the UI (D4) |
| `macro_indicators` / `macro_daily_history` | 28 / 3551 | Healthy. Live VIX 16.81, DGS10 4.60, DXY 101.14 |
| `regime_classifications` | 2 | Live row is real (late / risk-on). Seed row has `hy_oas=320` vs live `2.69` — **unit mismatch between seed and live** |
| `trade_candidates` | **0** | |
| `portfolio_positions` | **0** | |
| `portfolio_returns` | **0** | |
| `portfolio_risk` | **0** | |
| `portfolio_cumulative_return` | **0** | |
| `research_recommendations` | 1 | `run_date` 2026-07-22 (stale). `advisory_derivation` **NULL** |
| `research_agent_runs` | 7 | `citations` = `[]` in **all 7**. 3 runs hit `retries=5, verified=false` |
| `pipeline_runs` | 2 | **L0 and L3 only**, both `status='partial'`, `finished_at` NULL |
| `portfolio_factor_exposure` | **does not exist** | |
| `theme_signals` | **does not exist** | Referenced in code comments |

### The one persisted book is a degenerate fallback

The single `research_recommendations` row contains **2 picks, both long, both from the same theme** (Corporate Credit → HYG, LQD), $50M each, zero shorts, `factor_tilts: {}`. Its `book_view` reads verbatim:

> *"This is a deterministic fallback — LLM synthesis unavailable."*

and its `book_risks` include *"Thesis is templated; not suitable for real investment decisions"*. The picks also cite **HypeScore 52.7** for Corporate Credit while the live `themes` row is **37.46** — the persisted thesis numbers no longer match the live scores.

Two UX consequences:

- Even after D1 is fixed, `/research` will render a 2-long, 0-short book as though it were the deliverable. **The UI has no state for "this is a fallback, not a book."** `advisory_derivation` is exactly the mechanism for that (`ThesisBlock` already gates on it) — it is NULL, so the gate never engages.
- Nothing anywhere reconciles a persisted thesis against current theme scores. A stale citation is indistinguishable from a live one.

### Page rendering

| Page | Populated | State |
|---|---|---|
| `/` | ~70% | Best surface. Market bar, heatmap, conviction cards all real — **but** self-contradicting regime panel (D7), all sub-score cells render `1` (D8), all Δ1d `—` (D9), factor tilt "Awaiting factor run…" (D4), `LONGS / SHORTS 0 / 0`, and three hardcoded mock theses rendered as analysis (C1) |
| `/trades` | ~0% | 629 bytes of body. "No candidates match." Header claims `12 themes · 32 tickers`; actual is 8 and 29 |
| `/portfolio` | ~0% | $0 deployed, no positions. **The entire VaR/CVaR/Sharpe/β/HHI grid is unmounted** — gated behind `{risk && …}` (`portfolio/page.tsx:285`) with zero rows, so it does not even render as `—`. Plus a layout bug: the capital-deployed block overlaps the subtitle and lens selector |
| `/research` | ~0% | 532 bytes. Renders "No Q1 recommendations yet" — **which is false**; a row exists and the query 400s (D1, D7) |

All four pages additionally throw **four React hydration errors** (`#425 ×2`, `#418`, `#423`) — minified hydration-mismatch/suspense errors, likely from `Date.now()`/locale formatting during SSR (`page.tsx:198`, `TopBar.tsx:39`, `LiveFeed.tsx`).

### Other data-quality items

- `research_output` (3 rows) is **stale seed data** citing HypeScores 82.1 / 78.4 / 72.3 that exist nowhere in the system. Unread by the frontend, but live in the database.
- `prediction_markets`: *"Next Prime Minister of Ethiopia?"* is categorised `Crypto` and is the **top row by volume ($226M)** — so it would headline the `PredictionMarkets` panel.
- `supabase/migrations/018_theme_news.sql` exists on disk but **is not applied** to the database.

---

## Part E — The structural UX problem

### E1 — Three pages are three partial views of one object

`/trades`, `/portfolio`, and `/research` all describe **the same ten positions**, each showing a different subset, sourced from a different table, with no cross-links:

| Page | Source table | Shows | Missing |
|---|---|---|---|
| `/trades` | `trade_candidates` | TradeScore, HypeScore, notional | thesis, risk, sizing rationale |
| `/portfolio` | `portfolio_positions` | notional, weight, risk scalars | why, thesis, stress |
| `/research` | `research_recommendations` | thesis, counter-thesis, catalysts | sizing, risk, exposure |

A PM asking "why am I short KWEB at 8%?" must visit three pages and can still not get the answer. This is the core information-architecture failure.

### E2 — `TradeIdeasTable` has three permanently-empty columns

`Asset Return`, `Contribution`, and (partly) `Signed Weight` render `—` for every row by construction (`TradeIdeasTable.tsx:260-275` marks asset return `unavailable` unconditionally). Three of the nine data columns in the flagship table are structurally empty. The honesty is commendable; the design is not — a column that can never populate should not be a column.

### E3 — There is no design for the state the product is actually in

Per **R0**, the last real pipeline run produced **zero positions**: every theme scored 25.3–45.7 against a `hype_score_threshold` of 50 (`migrations/001_initial_schema.sql:152`). So `trade_candidates` and `portfolio_positions` are empty, and every page renders a generic empty state:

> "No candidates match. Adjust filter or run the pipeline."
> "No positions. Run the daily pipeline to construct the book."

A PM cannot tell whether the pipeline is broken, the market is quiet, or the threshold is mis-set. **The empty state is the production state, and it explains nothing.**

The underlying cause is a scoring-design issue the UI should expose rather than hide: HypeScore min-max normalises each sub-score **across only ~12 themes on a single day** (`hype_calculator.compute_hype_scores:79-93`), so it is a *cross-sectional relative* measure, then it is gated by an *absolute* threshold of 50. With rescaled-VADER sentiment clustering near 0.5 and 7-point correlation estimates being noisy, scores structurally cluster below 50. The threshold will almost never be crossed.

### E4 — No time dimension anywhere

HypeScore is "attention". Attention is only interesting as a **rate of change and a percentile against its own history** — that is the entire premise of Q2. `theme_signals_history` stores exactly this, daily. Nothing charts it. `Sparkline.tsx` exists and is never fed (`ConvictionCard` takes `history?: number[]`; no caller supplies it). `crowding` is declared and always `—`.

---

## Part F — Recommended redesign

### F.1 Information architecture — 5 surfaces, not 4

| Route | Name | Answers | Replaces |
|---|---|---|---|
| `/` | **Morning Brief** | "What do I need to know in 30 seconds?" | current `/` |
| `/themes` | **Theme Radar** | Q2 — what's trending, how much attention, vs. history | current `/` heatmap, expanded |
| `/book` | **The $100M Book** | Q1 — the ten trades, why, and sized how | merges `/trades` + `/portfolio` + `/research` |
| `/risk` | **Risk & Stress** | "What kills this book, and where are my limits?" | **new** |
| `/method` | **Method & Lineage** | Q2 — the process, the formulas, the data health | **new** |

### F.2 `/` — Morning Brief

Purpose: the screen a PM opens at 7am. Everything is a delta or an exception.

- **Regime strip** — cycle × sentiment, plus the 6 classifier inputs inline with *distance to the next threshold* ("VIX 17.2 — 7.8 below risk-off trigger"). Reuse `RegimeInputsPanel`.
- **What changed** — top 5 hype movers (Δ1d and Δ5d, from `theme_signals_history`), regime transitions, candidates that entered/left the book.
- **Decision queue** — the only list that matters: *N* new candidates above threshold, *M* cap or risk-limit breaches, *K* counter-theses whose measurable trigger has been hit. This is the feature that turns the tool from a dashboard into a workflow.
- **Book line** — gross / net / day P&L / VaR utilisation, one row.
- **Data health** — real, from `pipeline_runs`: per-stage status + last success + source freshness. Replaces the hardcoded `LiveFeed`.

### F.3 `/themes` — Theme Radar (Q2)

- Ranked table: theme · HypeScore · **percentile vs own 90d history** · Δ1d · Δ5d · **30d sparkline** · sub-score bars · raw mentions · VADER · |ρ| · momentum z.
- **Hype time-series chart** — multi-theme overlay from `theme_signals_history`. The single highest-value missing chart in the app.
- **Mentions vs price overlay** — spec §8.1's `MarketCorrelation`, never built. It is the visual proof that the correlation sub-score is meaningful.
- **Attention decomposition drawer** — keep `ThemeDerivationDrawer`'s structure (it is good), delete C8's fabricated source counts, replace with real per-source counts (which requires the pipeline to persist them) or an explicit "source breakdown not persisted".
- **Threshold context** — show the candidate bar as a line on the distribution so E3's "nothing qualifies" is legible at a glance.

### F.4 `/book` — The $100M Book (Q1)

One page, one object. Header: gross · net · long · short · cash · positions · capital deployed.

Ten expandable rows. Collapsed: direction · ticker · theme · weight% · notional · HypeScore · TradeScore · stress-worst-case · status badge. Expanded, in this order:

1. **Thesis** with citation footnotes (`CitationList`, already built)
2. **Counter-thesis** with its measurable disqualifier, rendered as a *monitorable condition* — current value vs trigger level, not prose
3. **Catalysts + time horizon**
4. **Sizing derivation** — the real chain: `hype/100` → normalise across candidate set → single-name cap → sector cap → geo cap → final notional, showing **which cap bound**. Delete C5–C7 entirely.
5. **Factor tilts** for the position
6. **Risk contribution** — % of book VaR, and P&L under each of the 4 scenarios

Below the line: **the funnel**. How many (theme, asset) pairs entered `screen_candidates`, and how many were removed by each filter (hype threshold, direction, R², liquidity, lens, dedup). A PM's first question about any systematic book is "what did it reject and why".

### F.5 `/risk` — Risk & Stress (new)

Everything here already exists in Python and needs only persistence + rendering.

- **Scenario matrix** — 4 rows (VIX spike, rate shock, USD strength, credit widening) × book return % · $ P&L · severity, expandable to the per-position contribution breakdown that `estimate_scenario_pnl` already produces.
- **Correlation heatmap** — the 10 positions, 252d Pearson, with `HIGH_CORR_THRESHOLD` pairs flagged. Directly answers "am I accidentally doubling a bet?"
- **Cap utilisation** — single-name / sector / geo as progress bars against 20% / 30% / 35%. Turns an invisible constraint into a managed one.
- **Factor tilt** — book FF5+UMD betas (requires D3/D4 fixed).
- **Risk scalars with history** — VaR, CVaR, Sharpe, β, HHI as sparklines, not point values, with per-position VaR contribution.
- **Drawdown + daily P&L** — extend `DailyPLHistory` with a chart.

### F.6 `/method` — Method & Lineage (Q2's "explain how you would do this")

The assessment explicitly asks for the *process* to be explained. Put it in the product, driven by live data:

- The L0→L7 pipeline as a diagram, each stage annotated with last run status / duration / freshness from `pipeline_runs`.
- The HypeScore formula rendered with **today's actual weights** from `scoring_config` and a worked example using the current top theme.
- Data sources with real coverage counts **and explicit mock-fallback flags** — R0b (Reddit falling back to one synthetic post per theme) must be visible here, not buried in a docs file.
- Guardrail audit: citation verification rate, retries, whether the deterministic fallback fired.

### F.7 Cross-cutting principles

1. **No frontend-authored investor content.** Pipeline output with a derivation, or an explicit unavailable state. Nothing in between.
2. **Every empty state states its cause and its remedy.** Not "No positions" but "0 of 12 themes cleared the HypeScore 50 threshold. Highest: Fed Policy at 45.7 (4.3 short). Threshold is configurable in `scoring_config`."
3. **Percentiles over absolutes.** HypeScore is cross-sectional; frame it as rank and as percentile-vs-own-history, and reconsider the absolute gate (E3).
4. **Columns that can never populate are not columns** (E2).
5. **Controls that do nothing are removed.** Either wire the lens to a real re-run via an API route, or relabel it "Filter" and wire it consistently on all pages (D5).
6. **Time series by default.** Every headline scalar earns a sparkline.

---

## Part G — Prioritised roadmap

### P0 — Make it truthful and make it load *(nothing else matters first)*

Ordered by *cost-to-value*. G0 is a one-line class of fix that unblocks two dead pages.

| # | Task | Files |
|---|---|---|
| **G0** | **Fix the three schema/query mismatches killing live pages.** (a) drop `narrative` from both `regime_classifications` selects, or add the column; (b) add `portfolio_factor_exposure` as a **book-weighted view** over `factor_exposures × portfolio_positions`; (c) see G1 for `/research`. Fixes D4, D7 — and turns 36 rows of already-computed betas into two working panels | `app/page.tsx:118,189`, `app/portfolio/page.tsx:146`, `app/research/page.tsx:239`, new migration `019_*.sql` |
| G1 | Add `book_metrics`, `scenario_results`, `correlation_pairs`, `cap_utilisation` **JSONB** columns to `research_recommendations`; persist them from `_persist_to_supabase`. Fixes D1 **and** D2 together | migration `019_*.sql`, `backend/services/q1_agent.py:1257` |
| G2 | Run book metrics + scenarios on the **final sized book**, not the equal-weighted candidate pool | `q1_agent.py:435-533` |
| G3 | Delete every fabrication in Part C; replace with unavailable states | `app/page.tsx`, `TradeIdeasTable.tsx`, `TradeDerivationDrawer.tsx`, `ThemeDerivationDrawer.tsx`, `research/page.tsx`, `LiveFeed.tsx` |
| G4 | Wire L2 `factor_fetcher` into `daily_refresh.main()` with a `pipeline_runs` stage record, so L2 freshness is guaranteed and auditable | `scripts/daily_refresh.py` |
| G5 | Make `size_positions` call `allocate_portfolio` so L5 caps are actually enforced and shorts carry signed weight | `q1_agent.py:962` |
| G6 | Replace `LiveFeed`'s hardcoded health with a real `pipeline_runs` read | `components/LiveFeed.tsx` |
| **G6a** | **Fix the sub-score unit mismatch (D8)** — decide on one scale (recommend persisting 0–100 to match `hype_score`) and make `ThemeHeatmap` / `SubScoreBars` agree. Separately, investigate why `volume_score` and `corr_score` are constant 0.5 | `daily_refresh.py:251-254`, `ThemeHeatmap.tsx`, `SubScoreBars.tsx` |
| **G6b** | **Backfill `theme_signals_history.hype_score` (D9)** — without it there is no Δ, no momentum term, and nothing to chart in G9 | pipeline + one-off backfill |
| **G6c** | **Render the fallback state.** Populate `advisory_derivation` on every run and make `/research` say "deterministic fallback — not an investable book" rather than presenting 2 longs as the deliverable. Add a staleness check: flag when a persisted pick's cited HypeScore diverges from the live theme score | `q1_agent.py:1230`, `research/page.tsx`, `ThesisBlock.tsx` |
| **G6d** | Fix the four React hydration errors on every page (SSR/client `Date.now()` and locale-format mismatches) | `page.tsx:198`, `TopBar.tsx:39`, `LiveFeed.tsx` |

### P1 — Build the missing decision surfaces

| # | Task |
|---|---|
| G7 | `/risk` page: scenario matrix, correlation heatmap, cap utilisation, VaR contribution |
| G8 | Consolidate `/trades` + `/portfolio` + `/research` into `/book` with expandable position rows and the sizing-derivation chain |
| G9 | Hype time series + percentile-vs-history on `/themes`; feed `Sparkline`; populate `crowding` |
| G10 | Informative empty states everywhere (F.7 #2), starting with the zero-candidate case |
| G11 | Screening funnel panel (how many candidates each filter removed) |

### P2 — Complete the story

| # | Task |
|---|---|
| G12 | `/method` page (answers Q2's "explain how you would do this") |
| G13 | Morning Brief redesign of `/` incl. decision queue and counter-thesis trigger monitoring |
| G14 | Lens: add an API route that runs L5 with a lens, or relabel as a filter and wire consistently |
| G15 | Mentions-vs-price overlay chart (spec §8.1) |
| G16 | Reconsider `hype_score_threshold` semantics — percentile gate rather than absolute (E3) |
| G17 | Data hygiene: delete the stale `research_output` seed rows (HypeScores 82.1/78.4/72.3 exist nowhere); fix `prediction_markets` categorisation (an Ethiopian PM market is tagged `Crypto` and tops the panel by volume); reconcile the `hy_oas` unit mismatch between the seed and live `regime_classifications` rows (320 vs 2.69) |

---

## Verification

1. **D1 fix** — `curl` the PostgREST endpoint with the exact `select` list from `research/page.tsx`; expect `200`, not `400`. Then Playwright `/research` and assert pick cards render.
2. **D2/G1 fix** — run `daily_refresh.py`, then query `research_recommendations` and assert `scenario_results` is a non-empty array of 4 objects and `correlation_pairs` is present.
3. **C-series fix** — grep the frontend for hardcoded prose: no thesis strings, no `0.85`/`0.15`, no `Kelly`, no `0.62`/`0.30`/`0.08`, no `"Pipeline healthy"`, no hardcoded dates or theme counts.
4. **D3/D4 fix** — assert `factor_exposures` has a row per book ticker with `r_squared` in `(0,1)` and `beta_mkt ≠ 1.0` exactly (P7 in `RESIDUAL.md` showed seeded rows had `beta_mkt=1.0, r_squared=1.0`, which no real regression yields); assert `/portfolio` factor card renders bars.
5. **E3** — with zero candidates, assert every page renders a cause-and-remedy empty state naming the actual top score and the threshold.
6. **D7/D8/D9** — assert `/` shows no "classification pending" text while a regime row exists; assert heatmap sub-score cells render values `> 1` on a 0–100 scale; assert `theme_signals_history.hype_score` is non-null for the latest run and that `Δ1d` renders a number.
7. **Console-clean gate** — Playwright assertion that all four pages produce **zero** console errors. Today every page throws four hydration errors and two of them throw Supabase 4xx; a green console is the cheapest regression guard available and would have caught D1, D4, and D7 on the day they shipped.
8. Extend `frontend/tests/e2e/*.spec.ts` with assertions for the new `/risk` and `/book` surfaces; the existing specs already cover derivation drawers and lens behaviour.

## Note on repo state

During the audit the working tree changed under us: `backend/services/q1_agent.py`, `scripts/daily_refresh.py`, `tests/backend/test_daily_refresh.py`, `tests/backend/test_q1_agent.py` became modified, and `scripts/backtest_hype.py`, `supabase/migrations/018_theme_news.sql`, `backend/data/factors_daily.csv`, `tests/backend/test_backtest_hype.py` appeared as untracked — none authored in this session. A concurrent session appears to be active on this repo. Line references above were taken against the session-start state and should be re-checked before editing.

## Doc sync

Per `CLAUDE.md`: `/risk`, `/book`, `/method`, the new `research_recommendations` columns, and the L2 wiring all change the system graph — `ARCHITECTURE.md`'s mermaid diagram, Layers table, Supabase Tables table, and Feature Checklist must be updated in the same change, and the IA consolidation plus the L5-calls-`allocate_portfolio` change each warrant an ADR.
