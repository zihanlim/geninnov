# Andromeda Master Map — Every Part of the Research App Process

> **What this is:** the single index that stitches every part of the Andromeda research
> process into one map. Each section names the part, says what it does, and points to
> the exact doc(s) where it is recorded. If you want to see how one number is built
> end-to-end, start at §3 and follow the links.
>
> **How this differs from the other docs:** `ARCHITECTURE.md` is the wiring diagram,
> `theme-hype-methodology.md` is the Q2 answer, `PROGRESS.md` is the build log. This
> file is the *master map* — every part, in one place, with every link.
>
> **Doc-sync rule:** this file is an index, not a source of truth. If a fact here
> disagrees with `ARCHITECTURE.md` or an ADR, those win — and this file should be
> corrected, not the other way around.

---

## 0. The whole process in one picture

```
 ┌─ EXTERNAL WORLD ─────────────────────────────────────────────────────────────┐
 │  FRED · yfinance · Brave Search · GDELT · Reddit · Ken French · Polymarket ·  │
 │  CFTC · RSS ×14 · worldmonitor (gated) · CME FedWatch                         │
 └───────────────┬───────────────────────────────────────────────────────────────┘
                 │  nightly 21:30 UTC (GitHub Actions daily-refresh.yml)
                 ▼
 ┌─ BACKEND PIPELINE (scripts/daily_refresh.py) ────────────────────────────────┐
 │  L0  Macro ingestion         macro_fetcher.py                                 │
 │  L1  Theme detection         build_theme_signals → HypeScore + TradeScore     │
 │  L1b Narrative tracking      narrative_tracker.py (un-themed corpus, SHADOW)  │
 │  L2  Factor exposure         factor_fetcher.py (FF5 + UMD betas)              │
 │  L2b Credit & duration β     credit_rates_exposures.py (SHADOW → S7 only)     │
 │  L3  Regime classifier       regime_classifier.py (cycle × sentiment +        │
 │                              debasement + fed posture + computable macro)     │
 │  L4  Risk engine             risk_engine.py (VaR, CVaR, Sharpe, β, HHI)       │
 │  L5  Q1 reasoning agent      q1_agent.py — 8 nodes, runs TWICE (multi_asset   │
 │                              + credit lens); LLM only at classify_news +      │
 │                              reason_picks, bounded by citation guardrail      │
 │  L5+ Sizing & publication    optimizer (cvxpy) → book_signal → book_holdings  │
 │                              → research_recommendations → pick_outcomes       │
 └───────────────┬───────────────────────────────────────────────────────────────┘
                 │  writes to Supabase (RLS-gated, anon read)
                 ▼
 ┌─ SUPABASE (PostgreSQL) ───────────────────────────────────────────────────────┐
 │  themes · theme_signals · theme_news · market_news · narrative_signals ·      │
 │  macro_indicators · market_assets · factor_exposures · credit_rates_exposures │
 │  · regime_classifications · trade_candidates · portfolio_positions ·          │
 │  portfolio_risk · research_recommendations · book_signal · book_holdings ·    │
 │  pick_outcomes · book_revisions · editorial_vetoes · backtest_results ·       │
 │  pipeline_runs · chat_usage (sealed) …                                        │
 └───────────────┬───────────────────────────────────────────────────────────────┘
                 │  RLS anon reads
                 ▼
 ┌─ FRONTEND (Next.js 14 → Vercel) ─────────────────────────────────────────────┐
 │  L6  Pages: /book /risk /mandate /attribution /execution /method /ask        │
 │      /method/build /method/evidence — nav = six PM phases (phases.ts)        │
 │  L7  Provenance UI: drawers, citations, status read-models, lens selector    │
 │  L8  /ask agent (plan→execute→answer→verify) + MCP server + llms.txt         │
 └──────────────────────────────────────────────────────────────────────────────┘
```

**Recorded in:** `ARCHITECTURE.md` (canonical mermaid diagram + Layers table +
Data Flow + Supabase Tables), `docs/theme-hype-methodology.md` (§1 shape of the
process), `q2_submission.md` (§2 six-layer pipeline).

---

## 1. External data sources & ingestion

| # | Source | What it provides | Client / file | Credentials | Status / quirks | Recorded in |
|---|---|---|---|---|---|---|
| 1 | **FRED** | Yield curve, HY OAS, CPI, DFF, DGS*, DFII10 | `backend/data/macro_fetcher.py` (L0) | `FRED_API_KEY` | Bonds tape = FRED constant-maturity yields | ARCHITECTURE.md L0 + Supabase Tables (`market_assets`) |
| 2 | **yfinance** | Prices, returns, vol for every mapped instrument | `macro_fetcher.py` (L0), L1 corr, L2 | none | Daily closes, never live quotes; tape `as_of` = session | ARCHITECTURE.md `market_assets` |
| 3 | **Brave Search MCP** | News headlines — the primary attention signal | L1 `build_theme_signals` + L1b un-themed corpus | `BRAVE_SEARCH_API_KEY` | Recency-ranked: 48% of 45-day window is last 7 days | ARCHITECTURE.md; methodology §2.3; ADR-0144 |
| 4 | **GDELT DOC 2.0** | News counts with real history — the ARCHIVE | `backend/data/gdelt_client.py` | none | 18% in last 7 days, 40/45 days populated; 1 req/5s; OR-terms need `()` | ADR-0144 |
| 5 | **RSS ×14** | News, pubDate REQUIRED by spec | `backend/data/rss_client.py` | none | **SHADOW** — no scored corpus reads it | ADR-0157 |
| 6 | **Reddit PRAW** | Retail attention | L1 | `REDDIT_*` | Configured, **not live** — declared, not silently counted | methodology §8 |
| 7 | **Ken French Library** | FF5 + UMD monthly factors | `backend/data/factor_fetcher.py` (L2) | none | Rolling regression, ONE OLS in the repo | ARCHITECTURE.md L2 |
| 8 | **Polymarket** | Prediction market odds | `backend/data/polymarket_fetcher.py` | none | Migration 011 `prediction_markets` **not deployed to live** | ARCHITECTURE.md; PROGRESS.md |
| 9 | **CFTC CoT** | Weekly spec positioning (Tue obs, Fri pub) | `backend/data/cot_fetcher.py` + `positioning_crowding.py` | none | Coverage-first: 2/10 positions map to a contract | ADR-0097, ADR-0110 |
| 10 | **worldmonitor MCP** | Chokepoint status → S6 multiplier | `backend/services/chokepoint_signal.py` | **gated** (Pro $39.99/mo; endpoint now 403s) | NEVER a bare 1.0 — every refusal returns neutral WITH reason | ADR-0095, ADR-0099 |
| 11 | **CME FedWatch** | Per-meeting rate-hike probabilities | `backend/data/fedwatch_fetcher.py` | none | Never raises; writes `FEDWATCH_MEETING_*` rows to macro_indicators | ADR-0219 |
| 12 | **LLM providers** | MiniMax-M3 (primary), Anthropic claude-sonnet-4, Gemini flash | L5 `classify_news`/`reason_picks` + L8 /ask | `MINIMAX_/ANTHROPIC_/GEMINI_API_KEY` | **Only LLM calls in the product** | ARCHITECTURE.md LLM subgraph; ADR-0026 |

**Recorded in:** `ARCHITECTURE.md` External World subgraph (lines 12–24) + env-var
section; `CLAUDE.md` Scheduled jobs + secrets table; `docs/theme-hype-methodology.md`
§2 (what is collected, two-corpora decision).

---

## 2. The pipeline layers (L0–L8)

| Layer | What it does | Source | Output → table | Key ADRs | Doc home |
|---|---|---|---|---|---|
| **L0** Macro ingestion | FRED + yfinance snapshot | `backend/data/macro_fetcher.py` | `macro_indicators`, `macro_daily_history`, `market_assets` | ADR-0196 (tape as_of) | ARCHITECTURE.md §Layers |
| **L1** Theme detection | Brave+Reddit → VADER → cross-asset corr (per class, ADR-0127) + momentum → HypeScore, TradeScore | `scripts/daily_refresh.py::build_theme_signals` | `theme_signals`, `theme_signals_history`, `theme_news` | ADR-0035, 0042, 0127 | methodology §3–4; ARCHITECTURE.md L1 |
| **L1b** Narrative tracking | 1–3-gram doc frequency → share of voice + robust velocity → emerging/established/fading. **SHADOW, sizes nothing** | `backend/services/narrative_tracker.py` | `market_news`, `narrative_signals` | ADR-0128, 0129, 0133, 0143, 0145 | ARCHITECTURE.md L1b |
| **L2** Factor exposure | Rolling FF5+UMD regressions → β_mkt/smb/hml/rmw/cma/umd, R² | `backend/data/factor_fetcher.py` | `factor_exposures` | ADR-0190 (one OLS), 0075 | ARCHITECTURE.md L2 |
| **L2b** Credit & duration | DGS10 / IG OAS / HY−IG OAS legs; total + marginal betas (residualised on FF5+UMD). **Sizes nothing** — feeds S7_fallen_angel only, gated \|β/se\|≥2 | `backend/services/credit_rates_exposures.py` | `credit_rates_exposures` (m060+061) | ADR-0190, 0192, 0193 | ARCHITECTURE.md L2b |
| **L3** Regime classifier | Rule-based cycle × sentiment, + debasement_pressure (m052), fed_posture/pivot (m053), computable macro JSONB (ERP, equity-bond corr, NDX seasonality) | `backend/services/regime_classifier.py`, `equity_risk_premium.py`, etc. | `regime_classifications` | ADR-0091, 0139, 0140, 0217 | ARCHITECTURE.md L3 |
| **L4** Risk engine | VaR (param + historical), CVaR, Sharpe, β, HHI, Sortino, Calmar, max DD, TE/IR, up-down capture; derive-aware `NumericDerivation` | `backend/services/risk_engine.py` | `portfolio_risk` + `numeric_derivations` JSONB | ADR-0098, 0109 | ARCHITECTURE.md L4 |
| **L5** Q1 reasoning agent | 8 nodes: aggregate_context → screen_candidates → classify_news (LLM) → compute_book_metrics → run_scenario_analysis → reason_picks (LLM) → verify_citations (guardrail, max 2 retries → deterministic fallback) → size_positions; + finalise_book_analytics. **Runs twice nightly** (multi_asset + credit lens) | `backend/services/q1_agent.py`, `scripts/daily_refresh.py` | `research_recommendations`, `research_agent_runs` | ADR-0012, 0013, 0014, 0015, 0024, 0040, 0055, 0071–0080, 0093, 0194, 0220 | ARCHITECTURE.md L5 subgraph |
| **L6** Writeup | Six PM-phase pages: /mandate, / (themes), /book, /risk, /execution, /attribution + /method | `frontend/app/*`, `components/*`, `lib/method/phases.ts` | reads Supabase | ADR-0025, 0084, 0086, 0169, 0170, 0172 | ARCHITECTURE.md L6 subgraph |
| **L7** Provenance UI | Derivation drawers, citations, status/freshness/uncertainty read-models, lens selector | `frontend/components/*` | reads via `frontend/lib/derivations/*` | ADR-0009, 0010, 0011, 0018, 0197 | ARCHITECTURE.md L7 |
| **L8** /ask agent + MCP | Plan (LLM ≤4 tools) → execute (deterministic, reuses page modules) → answer (LLM) → verify (guardrail, in-place marking); same TOOLS registry exposed over `POST /api/mcp`; `llms.txt` generated | `frontend/app/api/chat/route.ts`, `api/mcp/route.ts`, `lib/chat/*` | read-only; `chat_usage` spend cap (fails closed) | ADR-0087, 0092 | ARCHITECTURE.md L8 |

**Recorded in:** `ARCHITECTURE.md` §Layers (the authoritative table), §Data Flow
(the L0→L8 chain with the "L5 is the only stochastic layer" note).

---

## 3. Calculations & scoring formulas

### 3.1 HypeScore (L1) — "how much attention"

```
HypeScore = 100 × [ 0.30·volume + 0.20·sentiment + 0.30·correlation + 0.20·momentum ]
```

| Component | Transform | Full credit at |
|---|---|---|
| Volume | `tanh(m/3.0)` on 7-day avg mentions | 3 mentions/day → 0.76 |
| Sentiment | VADER compound → `[0,1]` | sign preserved |
| Correlation | `\|corr\|` ÷ documented material level (per asset class, ADR-0127) | fixed anchor |
| Momentum | `tanh(z/k)` — median/MAD z (clipped ±4), centred 0.5 | 0.5 = no change |

Rules: **absolute sub-scores** (not min-max across themes — ADR-0042); a missing
component is **dropped and remainder renormalised** (never scored 0 — ADR-0036);
weights live in `scoring_config`, not code.

**Recorded in:** `docs/theme-hype-methodology.md` §4.1; ADR-0006 (superseded), 0028
(superseded), 0035, 0042; `ARCHITECTURE.md` Layers L1.

### 3.2 TradeScore (L1) — intra-side ranking

TradeScore = hype-based ranking of candidate trades within a side. Not direction —
direction is `sign(EdgeScore)`.

**Recorded in:** ADR-0031; ARCHITECTURE.md `trade_candidates`; PROGRESS.md (EdgeScore
direction surfaced).

### 3.3 EdgeScore (L1) — direction + conviction

```
EdgeScore = 0.20·Trend + 0.23·RegimeFit + 0.34·Carry + 0.18·Value + 0.05·Sentiment(contrarian)
side      = sign(EdgeScore)          |EdgeScore| < 0.15 → abstain
conviction = |EdgeScore| / max(vol, floor)        # vol floor, ADR-0047
```

- **Carry** = excess yield over funding, two-sided (10y+OAS − DFF; negative on inversion) — ADR-0036
- **Value** / **Trend** per-asset; sentiment enters **contrarian**, smallest weight (ADR-0033)
- Weights are priors from weak positive ICs, deliberately NOT refit (ADR-0044: carry IC +0.128, N=94, p=0.221)
- **Scope by attention, abstain by asset** (ADR-0039); direction is a property of the **asset**, not the theme (ADR-0038)
- `conviction` = mandate-free handoff to sizing — ratio identical at $100M and $5bn

**Recorded in:** `docs/theme-hype-methodology.md` §6; ADR-0031, 0032, 0033, 0036,
0038, 0039, 0044, 0046, 0047, 0053 (scope correction).

### 3.4 Selection / screening (L5 node 2)

```
L1 pool (trade_candidates, ONE pool, no lens column)
  → lens filter (ADR-0015, 0194)
  → R² ≥ 0.10 (factor regression gate)
  → dedupe (one per correlated complex — ADR-0048 counts INDEPENDENT IDEAS not candidates)
  → cap (hype + direction + two-sided inherited from L1 — ADR-0030)
  → editorial veto applied (ADR-0171 — forward-acting, revoked never deleted)
  → per-filter attrition recorded in screening_funnel
```

**Recorded in:** ARCHITECTURE.md L5 node 2 + `screening_funnel`; ADR-0014, 0030,
0048, 0171, 0200, 0201; PROGRESS.md.

### 3.5 Sizing & the optimizer (L5 node 8 + quant layer)

- **Grinold–Kahn** μ = IC × σ × z — IC from `backtest_results`, shrunk 50%, **never defaulted** (ADR-0108)
- **cvxpy optimizer**: mean-variance / min-CVaR / MAD; 20% single-name / 30% sector / 35% geo caps as **solver constraints** on group totals; direction pinned; gross ≤ 1 → refused capacity stays **cash** (ADR-0037)
- One complex → one μ, covariance picks the instrument (ADR-0116)
- Fallback to conviction sizing (`allocate_portfolio`) WITH persisted reason; `sizing_method` says which ran
- Turnover cap `max_turnover = 0.60` binds against yesterday's **published** book, incl. forced exits of dropped names (ADR-0173, 0174)
- Crowding halves the single-name cap on names agreeing with speculator extremes (ADR-0110)
- `book_signal` captured **between** verify and size — the mandate-free claim, structurally no weight column (ADR-0148)
- Mandate = ONE object, read from `scoring_config` with per-field provenance (ADR-0147)

**Recorded in:** ARCHITECTURE.md Quant layer + Cap Enforcement; ADR-0037, 0053, 0107,
0108, 0110, 0116, 0147, 0148, 0149, 0173, 0174.

### 3.6 Risk & stress (L4 + L5 node 5/9)

- 7 stress scenarios: 4 risk-off (VIX/rates/USD/credit) + 1 melt-up (risk-on) + 1 supply shock (sector-transmitted, ADR-0088) + 1 fallen-angel (measured credit β, ADR-0192)
- Euler risk decomposition on the FINAL sized book (ADR-0082); correlation structure persisted (ADR-0072); MC VaR + √t VaR fan (21d matches ADR-0090 horizon)
- Every new estimate gated by minimum sessions (Sortino 60, Calmar 252, TE 60, hist VaR 100…)
- Weights backtest = path stats over 252d, **NOT a track record** (ADR-0112)

**Recorded in:** ARCHITECTURE.md L4 + Quant layer; ADR-0074, 0082, 0088, 0094, 0112,
0192, 0193; PROGRESS.md.

---

## 4. Publication, accounting & the forward record

| Step | What happens | Table | ADRs |
|---|---|---|---|
| Book published | `research_recommendations` upserted on `UNIQUE(run_date, lens)` — two books coexist (m062) | `research_recommendations` | ADR-0040, 0194, 0203 |
| Changes to a published book | recorded per-field with NOT NULL reason | `book_revisions` | ADR-0093 |
| Mandate-free signal | name, side, edge, conviction — no weight column | `book_signal` | ADR-0148 |
| Held book | cost-netted P&L, compounding NAV, turnover, TE | `book_holdings` + `_performance` | ADR-0150, 0112, 0222 |
| Forward record | rows created PENDING at publication; resolved at +21td | `pick_outcomes` | ADR-0090, 0205, 0209, 0210 |
| Sanctions / crowding | side-aware exposure; external spec positioning vs book | JSONB on `research_recommendations` | ADR-0096, 0097 |

**Recorded in:** ARCHITECTURE.md Supabase Tables; the ADRs above.

---

## 5. Frontend surfaces (what a user sees)

| Route | Phase | What it shows | Component / lib | Notes |
|---|---|---|---|---|
| `/` | 02 Alpha | Theme ranking, trend board, discovery, tape, regime hero | `app/page.tsx`, `ThemeTrends`, `MacroCrossCurrents` | |
| `/book` | 03 Construction | Positions + thesis + full sizing chain + screening funnel | `components/book/BookBody.tsx` | per-lens via `candidatePool.ts` (ADR-0200/0201) |
| `/mandate` | 01 Mandate | Mandate + limits board measuring against the panel | `app/mandate/page.tsx`, `RiskLimitBoard` | lens-aware rows (ADR-0211) |
| `/risk` | 04 Risk & Scenario | Stress FIRST, VaR by method, attribution, concentration | `components/risk/RiskBody.tsx` | one body, one fetch (ADR-0084); lensScope (ADR-0197) |
| `/attribution` | 06 Attribution | Realised drawdown + return path — only backward-looking surface | `app/attribution/page.tsx` | pinned multi_asset (ADR-0197) |
| `/execution` | 05 Execution | **EMPTY on purpose** — book is a recommendation (ADR-0040) | `app/execution/page.tsx` | boundary gets a destination |
| `/method` | — | Process map (six phases) — no query | `components/method/ProcessMap.tsx` | nav = process (ADR-0169/0170) |
| `/method/build` | — | How a number is built: HypeScore/TradeScore/EdgeScore/factors | `MethodBody` chapter one | |
| `/method/evidence` | — | Did it run: pipeline health, sources, guardrails, track record | `MethodBody` chapter two | |
| `/ask` + floating window | — | Interrogate the book; every numeral adjudicated | `AskConsole`, `VerifiedProse` | two mounts, one console (ADR-0087) |
| `POST /api/mcp` + `/llms.txt` | — | External agents read the book | `lib/chat/tools.ts` registry | same TOOLS, no LLM (ADR-0092) |

**Recorded in:** ARCHITECTURE.md L6/L7/L8 subgraphs; `docs/design-goals.md` (the bar
every surface must clear); ADR-0085, 0086, 0169, 0170, 0172, 0197, 0202, 0211, 0213.

---

## 6. Verification & QA (offline, deliberate — never in the daily job)

| Harness | What it verifies | Runs | Doc |
|---|---|---|---|
| **Acceptance battery** | 5 frozen L0–L4 fixtures, written-down right answer; structural checks GATE, directional REPORT | `scripts/run_eval.py` — CI `l5-eval` job (no `\|\| true`) + live `--provider` | ADR-0055; ARCHITECTURE.md VERIF subgraph |
| **Replication test** | reason_picks variance on ONE frozen state | `scripts/replication_test.py` | ADR-0050 |
| **IC backtests** | HypeScore IC (ADR-0022), EdgeScore IC (ADR-0044) | `scripts/backtest_hype.py`, `backtest_edge.py` | ADR-0022, 0044, 0059 |
| **Regime backfill** | rebuilds L3 history — pure function, no API/LLM cost | `scripts/backfill_regime.py` | PROGRESS.md |
| **Outcome resolution** | the ONLY forward check — scores published books at +21td | `scripts/resolve_outcomes.py` | ADR-0090, 0205, 0210 |
| **Integrity guard** | 8 checks against the PUBLISHED book (contradictions, false cap breaches, arithmetic…) | `scripts/check_data_integrity.py` | ADR-0023, 0076 |
| **Test suites** | backend pytest (300+) + frontend vitest (1200+) + Playwright e2e | CI | PROGRESS.md |
| **Lineage matrix** | every investor-facing field → producing function → source table | `docs/lineage/MATRIX.md` | T12 |
| **Verification matrix** | release gate — PASS only with automated evidence | `docs/verification/MATRIX.md` | T25 |
| **Residual risks** | live risk register | `docs/risks/RESIDUAL.md` | T28 |

**Recorded in:** ARCHITECTURE.md VERIF subgraph + Feature Checklist; PROGRESS.md.

---

## 7. Where every part is recorded — the inventory (direct answer)

| Document | What it records | When it must be updated |
|---|---|---|
| `ARCHITECTURE.md` | **Canonical wiring**: mermaid diagram, Layers, Data Flow, Supabase Tables, env vars, cap enforcement, feature checklist | Every service/API/table/layer/LLM call/cron/edge change (doc-sync rule, `CLAUDE.md`) |
| `PROGRESS.md` | **Build log**: dated rows, build-task state | Every non-trivial change worth remembering |
| `docs/adrs/NNNN-*.md` (220 files, 215 indexed) | **Why-decisions**, immutable; superseded marked not rewritten | Every architecturally significant decision |
| `docs/adrs/README.md` | ADR index | When a new ADR is written |
| `docs/theme-hype-methodology.md` | **The Q2 answer**: data gathering → processing → quantification → idea gen + risk monitoring, with live figures | When scoring/detection semantics change |
| `q2_submission.md` | **The submission**: six-property framework narrative + links | Before submission; it is the story told about the repo |
| `docs/design-goals.md` | The bar every UI change must clear | When a goal is amended (via ADR) |
| `docs/superpowers/specs/*` | Full design specs (platform, credit-rates, structured-facts…) | When spec'd behaviour changes |
| `docs/superpowers/plans/*` | Implementation plans | — (historical) |
| `.superpowers/sdd/task-*.md` (65 files) | Per-task briefs + reports (T1–T29, B1–B8, C1–C5) | — (historical) |
| `docs/lineage/MATRIX.md` | Field → function → table trace | When a rendered field's producer changes |
| `docs/verification/MATRIX.md` | Release gate invariants + evidence | At release gates |
| `docs/runtime/EXECUTION_GRAPH.md` | Canonical L5 path + orphan verdict | If L5 entrypoint changes |
| `docs/baseline/*` | Frozen pre-refactor snapshots (schema, routes, screenshots) | Never overwrite |
| `email/*` | Q1 answers, portfolio, deliverables, submission text | — (deliverables) |
| `docs/GOAL.md` + `docs/loop-log.md` | Standing brief + iteration history (to 111) | Every loop firing |
| `docs/handoff-*.md`, `docs/jarvis-transfer-*.md`, `docs/transcript-*.md` | Read-across / handoff records | — (historical) |

---

## 8. Known gaps — what is NOT recorded in MD

1. **Live run data** (actual scores, picks, positions per date) lives in **Supabase**,
   not in markdown. Docs record formulas and wiring; the data is the tables.
2. **The exact runtime order inside `scripts/daily_refresh.py`** is code, not prose —
   `EXECUTION_GRAPH.md` covers the L5 entrypoint only.
3. **5 ADR files exist but are not in the index** (files 0214–0218: `facts-page`,
   `structured-facts-layer`, `cme-fedwatch-fetcher`, `l5-structured-facts-citation`,
   `computable-macro-analytics` are in the file list; the README index rows stop short
   — index has 215 rows vs 220 files). **Fix opportunity:** re-index README.md.
4. **`docs/captures/YYYY-MM-DD/`** screenshot folders are referenced by CLAUDE.md but
   were not present in the tree at audit time.
5. **Reddit** is fetched but unconfigured; **RSS** is persisted but unread;
   **worldmonitor** is credential-gated — all three are disclosed in docs but not live.
6. **Migration 011 (`prediction_markets`)** is not deployed to live Supabase (flagged
   in PROGRESS.md + verification matrix FAIL row).
7. The **email/** deliverables (Q1 answer, portfolio) overlap with the repo but are
   submission copies — changes to the repo after 2026-07-31 may not be reflected there.

---

*Master map compiled 2026-08-02 from ARCHITECTURE.md, docs/theme-hype-methodology.md,
q2_submission.md, PROGRESS.md, CLAUDE.md, docs/adrs/ (220), docs/verification/MATRIX.md,
docs/lineage/MATRIX.md, docs/runtime/EXECUTION_GRAPH.md, docs/baseline/, and
.superpowers/sdd. Verify against ARCHITECTURE.md before trusting — it is the source of truth.*
