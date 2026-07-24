# Andromeda Architecture

> **This file is the single source of truth for system architecture.** Whenever you add, remove, rename, or rewire a service, API, table, layer, LLM call, or cron trigger, you MUST update the [System Architecture Diagram](#system-architecture-diagram) in this file in the same change. See the **Doc Sync Rule** in `CLAUDE.md`.

## System Architecture Diagram

The full L0–L7 stack, from cron trigger to rendered frontend, in one diagram. Deterministic layers are white, the LLM is highlighted, the database is a cylinder, the frontend subtree is on the right.

```mermaid
flowchart TB
    %% ───────── External triggers & data sources ─────────
    subgraph EXT["External World"]
        CRON["cron-job.org<br/>(daily, 4:30pm ET)"]
        FRED["FRED API<br/>(yield curve, HY OAS, CPI, ...)"]
        YF["yfinance<br/>(prices, returns, vol)"]
        BRAVE["Brave Search MCP<br/>(news headlines)"]
        REDDIT["Reddit PRAW<br/>(social posts)"]
        KEN["Ken French Data Library<br/>(FF5 + UMD monthly)"]
        POLY["Polymarket<br/>(prediction market odds)"]
    end

    %% ───────── LLM providers ─────────
    subgraph LLM["LLM Provider (L5 only)"]
        MINIMAX["MiniMax API<br/>MINIMAX_API_KEY<br/>MiniMax-M3"]
        ANTHROPIC["Anthropic<br/>ANTHROPIC_API_KEY<br/>claude-sonnet-4"]
        GEMINI["Google Gemini<br/>GEMINI_API_KEY<br/>gemini-flash-latest (ADR-0026)"]
    end

    %% ───────── Backend Python pipeline ─────────
    subgraph BE["Backend Python Pipeline (scripts/daily_refresh.py)"]
        direction TB

        subgraph L0["L0 — Macro Ingestion<br/>backend/data/macro_fetcher.py"]
            MF["MacroFetcher<br/>fetch_fred() + fetch_yf()"]
        end

        subgraph L1["L1 — Theme Detection<br/>scripts/build_theme_signals()"]
            TS["Brave + Reddit → VADER<br/>+ price corr + momentum<br/>→ HypeScore, TradeScore"]
        end

        subgraph L2["L2 — Factor Exposure<br/>backend/data/factor_fetcher.py"]
            FF["rolling regression<br/>β_mkt, β_smb, β_hml,<br/>β_rmw, β_cma, β_umd, R²"]
        end

        subgraph L3["L3 — Regime Classifier<br/>backend/services/regime_classifier.py"]
            RC["rule-based<br/>cycle × sentiment<br/>(early/mid/late/recession) × (risk-on/off)"]
        end

        subgraph L4["L4 — Risk Engine<br/>backend/services/risk_engine.py"]
            RE["VaR, CVaR, Sharpe,<br/>β, HHI, daily P&L"]
        end

        subgraph L5["L5 — Q1 Reasoning Agent<br/>backend/services/q1_agent.py"]
            direction TB
            N1["1. aggregate_context<br/><i>pull L0–L4 from Supabase</i>"]
            N2["2. screen_candidates<br/><i>filter L1 pool: lens, R²≥0.10,<br/>dedupe, cap (hype + direction +<br/>two-sided inherited from L1, ADR-0030)</i>"]
            N3["3. classify_news<br/>🤖 <b>LLM</b> — tag headlines<br/>{category, sentiment, theme}"]
            N4["4. compute_book_metrics<br/><i>FF5+UMD tilts, caps,<br/>correlation matrix</i>"]
            N5["5. run_scenario_analysis<br/><i>4 stress: VIX / rates / USD / credit</i>"]
            N6["6. reason_picks<br/>🤖 <b>LLM</b> — top-5L + top-5S<br/>+ thesis + counter-thesis"]
            N7["7. verify_citations<br/><i>pure-fn guardrail,<br/>max 2 retries</i>"]
            N7F["7b. fallback_picks<br/><i>deterministic if retries exhaust</i>"]
            N8["8. size_positions<br/><i>delegates to allocate_portfolio:<br/>HypeScore-weighted $100M,<br/>20% / 30% / 35% caps ENFORCED</i>"]
            N9["9. finalise_book_analytics<br/><i>recompute tilts / scenarios / corr<br/>on the FINAL SIZED book (ADR-0024)</i>"]
            N8A["emit <b>AdvisoryDerivation</b><br/><i>T18 strict: fallback cannot be verified</i>"]

            N1 --> N2 --> N3 --> N4 --> N5 --> N6 --> N7
            N7 -- "unverified" --> N6
            N7 -- "verified ✓" --> N8
            N7 -. "retries exhausted" .-> N7F --> N8
            N8 --> N9 --> N8A
        end

        subgraph DRV["Derivations Module — backend/derivations/"]
            direction TB
            DNV["numeric.py<br/>NumericDerivation,<br/>SourceRecord, Freshness,<br/>Uncertainty, validate_numeric"]
            DAV["advisory.py<br/>AdvisoryDerivation,<br/>validate_advisory,<br/>fallback_used strictness (T18)"]
        end

        TG["backend/services/trade_ranker.py<br/>direction = sign(EdgeScore)<br/>(trend+regime+carry+value+sentiment,<br/>IC-weighted, abstain) size ∝ conviction<br/>carry = excess yield over funding (2-sided);<br/>None components renormalise the weights<br/>per-asset direction (ADR-0038)<br/>scope by attention, abstain by asset (ADR-0039)<br/>ADR-0031/0032/0033/0036/0038/0039"]
        POLYSVC["backend/data/polymarket_fetcher.py<br/>prediction market feed"]
        PIPE["backend/services/pipeline_runs.py<br/>record_pipeline_run,<br/>run_id_for(stage)"]
        PF["backend/services/portfolio.py<br/>compute_daily_return,<br/>compute_cumulative_return"]
        EX["backend/services/exposure.py<br/>net / gross / sector / geo<br/>exposure aggregation"]
        RR["backend/services/risk_engine.py<br/>returns NumericDerivation<br/>(T9 derive-aware compute_risk)"]
        HC["backend/services/hype_calculator.py<br/>abs(corr) (T22)"]
    end

    %% ───────── Supabase (PostgreSQL) ─────────
    subgraph DB[("Supabase — PostgreSQL")]
        direction TB
        T_THEMES["themes"]
        T_TA["theme_assets<br/>(+ asset_class)"]
        T_TS["theme_signals"]
        T_TSH["theme_signals_history"]
        T_TC["trade_candidates"]
        T_PP["portfolio_positions"]
        T_PR["portfolio_returns"]
        T_PRISK["portfolio_risk"]
        T_SC["scoring_config"]
        T_MACRO["macro_indicators<br/>+ macro_daily_history"]
        T_FE["factor_exposures"]
        T_REG["regime_classifications"]
        T_RUNS["research_agent_runs<br/>(citations, retries, verified)"]
        T_RECS["research_recommendations<br/>(picks, book_view,<br/>+ book_metrics, scenario_results,<br/>correlation_pairs, cap_utilisation,<br/>screening_funnel, lens — m022)"]
        V_PFE[["portfolio_factor_exposure<br/><i>VIEW</i> — book-weighted FF5+UMD<br/>over factor_exposures × positions"]]
        T_NEWS["theme_news<br/>(collected headlines → L5)"]
        T_DISC["discovered_themes<br/>(LDA∩embedding shadow tiers)"]
        T_PIPE["pipeline_runs<br/>(run_id, stage, status,<br/>duration_s, source_freshness)"]
        T_CUM["portfolio_cumulative_return<br/>(as_of, inception_date,<br/>compounded value)"]
    end

    %% ───────── Frontend (Next.js 14 → Vercel) ─────────
    subgraph FE["Frontend — Next.js 14 / Vercel<br/>andromeda-analytics.vercel.app"]
        direction TB

        subgraph L6["L6 — Writeup (per-page)"]
            PG_HOME["/ — Themes<br/>app/page.tsx"]
            PG_BOOK["<b>/book — The $100M Book</b><br/>app/book/page.tsx<br/><i>positions + thesis + sizing<br/>+ screening funnel</i>"]
            PG_RISK["<b>/risk — Risk &amp; Stress</b><br/>app/risk/page.tsx<br/><i>scenarios, correlation,<br/>cap headroom, drawdown</i>"]
            PG_METH["<b>/method — Method &amp; Lineage</b><br/>app/method/page.tsx<br/><i>live formulas + pipeline health</i>"]
            PG_TR["/trades — retired<br/>app/trades/page.tsx<br/><i>server redirect() → /book</i>"]
            PG_PF["/portfolio — retired<br/>app/portfolio/page.tsx<br/><i>server redirect() → /book</i>"]
            PG_RS["/research — retired<br/>app/research/page.tsx<br/><i>server redirect() → /book</i>"]
        end

        PG_TR -. "redirect()" .-> PG_BOOK
        PG_PF -. "redirect()" .-> PG_BOOK
        PG_RS -. "redirect()" .-> PG_BOOK

        subgraph L7["L7 — Provenance UI (components/)"]
            REGIME["RegimeHero + RegimeInputsPanel"]
            CONV["ConvictionCard"]
            WATCH["Watchlist + Sparkline"]
            TBL["TradeIdeasTable"]
            ALLOC["MarketBar (allocation)"]
            FEAT["SubScoreBars"]
            DERV["ThemeDerivationDrawer<br/>DerivationDrawer<br/>TradeDerivationDrawer"]
            CITE["CitationList"]
            LENS["LensSelector<br/>(multi-asset / credit /<br/>rates / equity / fx / commodity)"]
            FEED["LiveFeed"]
        end

        subgraph STATUS["L7 — Status & Portfolio read-models (components/)"]
            STATBAD["status/StatusBadge"]
            FRESH["status/FreshnessLabel"]
            UNC["status/UncertaintyBand"]
            CUM["portfolio/CumulativeReturn<br/>(since-inception, compounded)"]
            DPL["portfolio/DailyPLHistory"]
            EXS["portfolio/ExposureSummary"]
            THB["research/ThesisBlock"]
        end

        subgraph FELIB["Frontend read-model — frontend/lib/derivations/"]
            FENUM["numeric.ts<br/>(TS mirror of NumericDerivation)"]
            FEADV["advisory.ts<br/>(TS mirror of AdvisoryDerivation)"]
            FEFMT["format.ts<br/>(status / unit rendering)"]
        end

        FASSETMETA["frontend/lib/assetMetadata.ts<br/>(taxonomy seam: classify(ticker))"]

        SUPC["frontend/lib/supabase.ts<br/>(anon key, RLS-gated reads)"]
    end

    %% ───────── Edges: triggers → pipeline ─────────
    CRON -- "POST daily_refresh.py" --> BE

    FRED --> MF
    YF --> MF
    YF --> TS
    YF --> FF
    YF --> TG
    BRAVE --> TS
    REDDIT --> TS
    KEN --> FF
    POLY --> POLYSVC

    %% ───────── Deterministic layer edges ─────────
    MF -->|macro_indicators| DB
    TS -->|theme_signals,<br/>theme_signals_history<br/>(+signed_corr, crowding,<br/>data_source), theme_news| DB
    FF -->|factor_exposures| DB
    RC -->|regime_classifications| DB
    RE -->|portfolio_risk<br/>+ numeric_derivations| DB
    TG -->|trade_candidates,<br/>portfolio_positions<br/>+ numeric_derivations| DB
    POLYSVC --> DB
    PIPE -. "record_pipeline_run" .-> T_PIPE
    PF -->|portfolio_cumulative_return<br/>(since inception, compounded)| T_CUM
    EX -. "exposure aggregation" .-> TG

    %% ───────── Derivations module edges ─────────
    DNV --> RR
    DAV --> N8A
    FASSETMETA -. "classify(ticker) seam (T20)" .-> TG
    HC -. "abs(corr) normalization (T22)" .-> TS

    %% ───────── L5 reads from DB ─────────
    DB -- "L0–L4 snapshot" --> N1
    DB -- "scoring_config" --> N1
    T_NEWS -. "recent headlines" .-> N1
    TG -- "L1 candidate pool<br/>(hype-gated, EdgeScore-directioned,<br/>two-sided) — ADR-0030/0031" --> N2

    %% ───────── LLM edges ─────────
    MINIMAX -. "preferred" .-> N3
    MINIMAX -. "preferred" .-> N6
    ANTHROPIC -. "fallback" .-> N3
    ANTHROPIC -. "fallback" .-> N6
    GEMINI -. "fallback" .-> N3
    GEMINI -. "fallback" .-> N6

    %% ───────── L5 writes ─────────
    N8A -->|advisory_derivation| T_RECS
    N8 -->|research_recommendations| T_RECS
    N9 -->|book_metrics, scenario_results,<br/>correlation_pairs, cap_utilisation| T_RECS
    N2 -. "screening_funnel" .-> T_RECS
    T_PP --> V_PFE
    T_FE --> V_PFE
    V_PFE -- "book factor tilt" --> PG_HOME
    V_PFE -- "book factor tilt" --> PG_RISK
    T_RECS -- "structured analytics" --> PG_RISK
    T_RECS -- "picks + sizing + funnel" --> PG_BOOK
    T_PIPE -- "stage health" --> PG_METH
    T_SC -- "live weights" --> PG_METH
    N1 -->|input_snapshot +<br/>citations + retries| T_RUNS

    %% ───────── Frontend reads ─────────
    DB --> SUPC
    SUPC --> L6
    SUPC --> FELIB
    L6 --> L7
    L6 --> STATUS
    FELIB --> STATUS
    FELIB --> DERV

    %% ───────── Lens filter edges ─────────
    LENS -- "lens param" --> N2
    LENS -- "re-queries Supabase" --> SUPC

    %% ───────── Visual styling ─────────
    classDef llm fill:#fff3b0,stroke:#d97706,stroke-width:2px,color:#000
    classDef db  fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#000
    classDef fe  fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#000
    classDef ext fill:#f3f4f6,stroke:#374151,stroke-width:1px,color:#000
    classDef drv fill:#ede9fe,stroke:#6d28d9,stroke-width:2px,color:#000
    class N3,N6 llm
    class DB,T_THEMES,T_TA,T_TS,T_TSH,T_TC,T_PP,T_PR,T_PRISK,T_SC,T_MACRO,T_FE,T_REG,T_RUNS,T_RECS,T_NEWS,T_DISC,T_PIPE,T_CUM,V_PFE db
    class CRON,FRED,YF,BRAVE,REDDIT,KEN,POLY ext
    class L6,L7,PG_HOME,PG_BOOK,PG_RISK,PG_METH,PG_TR,PG_PF,PG_RS,REGIME,CONV,WATCH,TBL,ALLOC,FEAT,DERV,CITE,LENS,FEED,SUPC,STATUS,STATBAD,FRESH,UNC,CUM,DPL,EXS,THB,FELIB,FENUM,FEADV,FEFMT,FASSETMETA fe
    class DRV,DNV,DAV,RR,PF,EX,PIPE,HC,TG,POLYSVC drv
```

### How to read the diagram

| Color | Meaning |
|-------|---------|
| Grey | External data source or trigger (cron, FRED, yfinance, Brave, Reddit, Ken French, Polymarket) |
| White | Deterministic Python logic (L0–L4, all of L5 except `classify_news` and `reason_picks`) |
| **Yellow** | **The only LLM calls in the entire system** — `classify_news` (N3) and `reason_picks` (N6) |
| Blue | Supabase tables (cylinder) |
| Green | Frontend (L6 pages + L7 provenance components) |

The diagram is a single source of truth. If you add a node, table, page, component, API, or external source, edit this diagram in the same commit.

## Layers

| Layer | Name | Source | Output |
|-------|------|--------|--------|
| L0 | Macro Ingestion | `backend/data/macro_fetcher.py` | `macro_snapshot` dict (FRED series + yfinance) |
| L1 | Theme Detection | `scripts/daily_refresh.py` → `build_theme_signals` | `theme_signals` table (mention count, sentiment, price corr, momentum). Uses `abs(price_corr)` normalization (T22) |
| L2 | Factor Exposure | `backend/data/factor_exposures` table | `factor_exposures` dict (FF5 + UMD betas per ticker) |
| L3 | Regime Classifier | `backend/services/regime_classifier.py` | `regime` dict (cycle + sentiment) |
| L4 | Risk Engine | `scripts/daily_refresh.py` → `compute_and_persist_risk` (derive-aware `compute_risk` returns `NumericDerivation`, T9) | `portfolio_risk` table + `numeric_derivations` JSONB column (T15) |
| L5 | **Q1 Reasoning Agent** | `backend/services/q1_agent.py` → `run_q1_agent` | `research_recommendations` + `research_agent_runs` tables; 8 nodes (aggregate → screen → book metrics → scenario analysis → reason_picks LLM → verify_citations → size_positions → persist). Emits `AdvisoryDerivation` with T18 strict fallback policy. Supports `lens` parameter (multi_asset/credit/rates/equity/fx/commodity) per [ADR-0015](docs/adrs/0015-lens-mode-asset-class.md) |
| L6 | Writeup | `frontend/app/{book,risk,method}/` (legacy `{trades,portfolio,research}/` now `redirect()` → `/book`) | Book-centric IA ([ADR-0025](docs/adrs/0025-book-centric-information-architecture.md)): `/book` = positions + thesis + full sizing chain + screening funnel; `/risk` = stress scenarios, correlation matrix, cap headroom, factor tilt, drawdown; `/method` = live HypeScore/TradeScore/**4-component EdgeScore** formulas + conviction×inverse-vol sizing + abstention roster + `pipeline_runs` health. The three legacy pages are thin server redirects to the consolidated triad |
| L7 | **Provenance UI** | `frontend/components/{ThemeDerivationDrawer,CitationList,RegimeInputs,LensSelector}.tsx` + `frontend/components/status/{StatusBadge,FreshnessLabel,UncertaintyBand}.tsx` + `frontend/components/portfolio/{CumulativeReturn,DailyPLHistory,ExposureSummary}.tsx` | Click-through audit trail for every score (incl. the 4-component EdgeScore decomposition + conviction sizing in `TradeDerivationDrawer`); asset-class lens toggle on the `/book` triad; status/freshness/uncertainty read-models render derivations |
| — | **Derivations** | `backend/derivations/{numeric.py,advisory.py}` (mirrored in `frontend/lib/derivations/{numeric,advisory,format}.ts`) | Frozen dataclasses + validators (`NumericDerivation`, `AdvisoryDerivation`) consumed by L4, L5 and the L7 read-models |
| — | **Pipeline Runs** | `backend/services/pipeline_runs.py` | `pipeline_runs` table — per-stage execution audit (run_id, stage, status, duration_s, source_freshness) |

## Data Flow

```
L0: macro_fetcher.py
    → FRED (via python-dotenv) + yfinance
    → macro_snapshot dict

L1: daily_refresh.py / build_theme_signals
    → Brave Search MCP (news) + Reddit PRAW (social)
    → Sentiment scoring (VADER + FinBERT mock)
    → Supabase: theme_signals table

L2: factor_fetcher.py
    → Ken French Data Library (FF5 monthly + UMD monthly)
    → yfinance (252-day return correlations)
    → factor_exposures dict (beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared)

L3: regime_classifier.py
    → macro_snapshot inputs: yield_curve_slope, HY_OAS, VIX, real_rate, SPX breadth
    → cycle: early / mid / late / recession
    → sentiment: risk-on / risk-off

L4: daily_refresh.py / compute_and_persist_risk
    → FRED (SPX total return) + historical portfolio returns
    → VaR (historical, 95%), CVaR, Sharpe, beta, concentration HHI
    → Supabase: portfolio_risk table

L5: q1_agent.py / run_q1_agent
    → L0–L4 outputs (aggregate_context)
    → screen_candidates: filter the L1 pool (lens, R² ≥ 0.10, dedupe, cap) — hype gate + direction + two-sided inherited from L1 (ADR-0030)
    → compute_book_metrics: FF5+UMD tilts, net/gross exposure, cap violations, corr matrix
    → run_scenario_analysis: 4 stress scenarios (VIX/rates/USD/credit)
    → reason_picks: LLM (Claude Sonnet) → top 5 long + top 5 short + thesis + counter-thesis
    → verify_citations: citation guardrail (max 2 retries → fallback)
    → size_positions: HypeScore-weighted $100M allocation + 20%/30%/35% caps
    → Supabase: research_recommendations + research_agent_runs

**L5 is the only stochastic layer in the architecture.** Everything from L0 through L4 is a pure function — no LLM, fully reproducible. The LLM enters only at `reason_picks` and is bounded by:
- A hard candidate-set filter (LLM can only pick names that survived `screen_candidates`)
- The citation guardrail (`verify_citations` → max 2 retries → deterministic fallback)
- The size-positions cap enforcement (single-name 20% / sector 30% / geo 35%)

The LLM is treated as a *constrained synthesizer*, not a free agent. See [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) and [ADR-0013](docs/adrs/0013-deterministic-stochastic-split.md) for the design rationale.

L6: frontend/pages/research.tsx
    → Reads research_recommendations from Supabase
    → Renders: per-trade thesis, book view, scenario table, risk metrics
    → Every numeric claim carries a citation footnote (L7, see ADR-0010)

L7: frontend/components/{ThemeDerivationDrawer,CitationList,RegimeInputs}.tsx
    → Reads theme_signals_history (raw signals), themes (normalized sub-scores),
      scoring_config (weights), research_agent_runs.citations (LLM output citations)
    → Renders: click-through derivation showing raw signal → normalization →
      weight → final score, with source counts and citation footnotes
    → Pattern adopted from Perplexity Finance: every numeric claim has visible
      provenance (see ADR-0009, ADR-0010, ADR-0011)
```

## Supabase Tables

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `themes` | Master theme registry | id, name, keywords, run_date |
| `theme_assets` | Ticker assignments per theme/run_date | theme_id, ticker, run_date |
| `theme_signals` | Per-theme signals (daily) | theme_id, run_date, mention_count_1d, avg_sentiment, price_corr, momentum_raw, hype_score |
| `theme_signals_history` | Historical hype scores for momentum calc; signal provenance | theme_id, run_date, hype_score, momentum_raw (robust median/MAD z-score, ADR-0021), **`signed_corr`** + **`crowding`** (migration 019, ADR-0021), **`data_source`** (real/mock/mixed/none — migration 020, ADR-0023) |
| `factor_exposures` | FF5 + UMD betas per ticker | ticker, beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared, updated_at |
| `scoring_config` | Weighted config (drives hype + trade scores) | hype_volume_weight, hype_sentiment_weight, ... |
| `trade_candidates` | Ranked long/short candidates per run | theme_id, asset, direction, hype_score, trade_score, run_date |
| `portfolio_positions` | Sized positions per run; per-position provenance (T13) | theme_id, asset, direction, notional, weight, run_date, **`numeric_derivations` JSONB** (per-position NumericDerivation bundle: weight, notional, beta, sector, geo) |
| `portfolio_returns` | Daily portfolio P&L | run_date, daily_return |
| `portfolio_risk` | Daily risk metrics; L4 provenance (T15) | run_date, var_95, cvar_95, sharpe, beta, concentration_hhi, **`numeric_derivations` JSONB** (full L4 NumericDerivation bundle — T9 derive-aware) |
| `theme_news` | Collected headlines/posts per theme per run — feeds the L5 agent (migration 018, ADR-0020) | theme_id, run_date, source (`brave`/`reddit`/`mock_*`), headline, published_date |
| `discovered_themes` | Shadow-mode theme-discovery candidates (LDA∩embedding agreement; migration 021, ADR-0007) | run_date, label, terms JSONB, tier (2/3), methods, status (`shadow`/`promoted`/`rejected`) |
| `backtest_results` | HypeScore IC-backtest output (ADR-0022); anon-readable (migration 028), surfaced on `/method` via `SignalValidation` ("Does HypeScore actually predict returns?") — currently reports NOT-YET-VALIDATED (0 usable obs; history accruing) | test_name (`hype_ic`), metric_name (`mean_ic_h{h}`), realized_value, pass, notes JSONB |
| `research_agent_runs` | L5 agent run audit trail; citation guardrail now value-reconciles (ADR-0019) | run_date, prompt_version, model_id, input_snapshot, citations, verified, retries |
| `research_recommendations` | Q1 output (picks + book view + structured book analytics) | run_date, picks, book_view, book_risks, **`advisory_derivation` JSONB** (T18 strict; fallback cannot be `verified`), and from migration 022 ([ADR-0024](docs/adrs/0024-persist-book-analytics-not-prompt-strings.md)): **`book_metrics`**, **`scenario_results`**, **`correlation_pairs`**, **`cap_utilisation`**, **`screening_funnel`**, `lens`. Note: `book_metrics_summary` / `scenario_table` never existed as columns — the frontend selected them and 400'd |
| `portfolio_factor_exposure` | **VIEW** (migration 022) — book-level FF5+UMD tilt, one row per portfolio `run_date` | run_date, beta_mkt…beta_umd (signed-weighted so shorts reduce exposure), `coverage` (share of gross weight with R²≥0.10), assets_covered, assets_total. Queried by `/` and `/portfolio`, which previously 404'd against a table that never existed |
| `pipeline_runs` | Per-stage pipeline execution audit (T10, migration 012) | run_id, run_date, stage, status (`success`/`failure`/`partial`), duration_s, source_freshness JSONB, started_at, finished_at, error |
| `portfolio_cumulative_return` | Since-inception compounded cumulative return, one row per as_of date (T14, migration 014) | as_of (PK), inception_date, cumulative_value, compounded (always TRUE), daily_returns_count, source_first_run_id, source_last_run_id, computed_at |
| `theme_assets.asset_class` | L5 lens filter | ticker, asset_class (rates/credit/equity/fx/commodity) — added in migration 009 |

## Environment Variables

```bash
# Supabase (required for backend + frontend)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key    # backend writes
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co  # frontend reads
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key   # frontend reads (anon key, RLS-gated)

# External data sources (optional — falls back to mock data)
FRED_API_KEY=your-fred-key
BRAVE_SEARCH_API_KEY=your-brave-key           # Brave Search MCP for news
REDDIT_CLIENT_ID=...                          # Reddit PRAW for social
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT=Andromeda/1.0

# LLM (required for Q1 agent)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_ID=claude-sonnet-4-20250514  # optional override
GEMINI_API_KEY=AQ...                          # third L5 provider (ADR-0026), free tier
GEMINI_MODEL_ID=gemini-flash-latest           # optional override (avoid pinned 2.x — 404/429 on new keys)
```

## Q1 Agent: Citation Guardrail

Every numeric claim in the LLM's output must cite a FRED series ID (e.g. `BAMLH0A0HYM2`) or theme key. `verify_citations` checks each citation against `macro_snapshot`. Un-cited numbers → retry (max 2). On third failure → `fallback_picks` (deterministic, no LLM, always produces output).

The citation infrastructure (research_agent_runs.citations JSONB + verify_citations step) is the data layer that powers the L7 provenance UI — see [ADR-0010](docs/adrs/0010-citation-footnotes-everywhere.md) for the rendering-side design and [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the guardrail design rationale.

## L7: Provenance UI Layer (ADR-0009, 0010, 0011)

The platform's quantitative outputs (HypeScore, TradeScore, regime classification, factor betas) are not auditable from the current UI — they show as numbers without showing how they were derived. To address this, L7 surfaces the full derivation chain from raw data to final number:

- **Theme score derivation** (ADR-0011): click any theme card → see raw signals (mention count, VADER compound, ρ, z-score) → normalization window + method → weights from `scoring_config` → final weighted sum. Every input has a source count badge ("14 sources").

- **Citation footnotes** (ADR-0010): every numeric claim in the Q1 thesis renders with a superscript ¹-⁵ footnote that links to the source key in the L0–L4 inputs (FRED series ID, theme name, factor name). Footnotes panel at the bottom lists each citation with its value.

- **Regime inputs panel** (L7 component): the regime hero card expands to show the 6 inputs that produced the current classification (yield curve slope, HY OAS, VIX, VIX term structure, real rate, breadth) with their current values and the threshold logic.

- **Per-trade derivation** (L7 component): click any row in the Trade Ideas table → see the TradeScore math (hype momentum × weight + sentiment × weight), asset selection rationale (which `theme_assets` candidates were filtered, why this one won), and position sizing logic (HypeScore weighting + cap enforcement).

**Pattern source:** Perplexity Finance — every claim has visible provenance via superscript citations + "X sources" badges. Borrowed wholesale for the same reason: the data is the product, and the user needs to trust the data.

**Why this matters for the Q1 test deliverable:** the reviewer needs to verify "why this pick" not just "what's the pick." Without L7, the LLM output is a black box. With L7, every claim in the thesis is clickable back to a source.

## Cap Enforcement

Position sizing (`size_positions` / `allocate_portfolio`):

- Single-name: max 20% of book
- Sector: max 30% (only when ≥ 3 members in sector — avoids oscillation in 2-asset portfolios)
- Geography: max 35% (only when ≥ 3 members in geo group)

When a cap is violated: cap the dominated name(s) at the limit, redistribute the excess to uncapped names proportionally by their original weight, then normalize once.

## Quick Start

```bash
# Backend
cd backend && pip install -r requirements.txt
python -m scripts.daily_refresh   # requires SUPABASE_URL + SUPABASE_SERVICE_KEY

# Frontend
cd frontend && npm install && npm run dev
# → http://localhost:3000

# Tests
pytest tests/backend/ -v
```

## Feature Checklist

- [x] L0: FRED + yfinance macro snapshot
- [x] L1: Brave Search news + Reddit social + VADER sentiment + price corr + momentum (T22: `abs(price_corr)` for theme strength)
- [x] L2: Ken French FF5 + UMD factor betas — **now an instrumented stage of `daily_refresh.main()`** (`refresh_factor_exposures`, recorded in `pipeline_runs`); previously computed only by ad-hoc invocation and never orchestrated
- [x] L3: Regime classifier (cycle × sentiment)
- [x] L4: Historical VaR, CVaR, Sharpe, beta, HHI (T9: derive-aware `compute_risk` returns `NumericDerivation`)
- [x] L5: **Q1 reasoning agent** — 8-node pipeline (aggregate → screen → book metrics → scenario analysis → LLM reason_picks → verify_citations → size_positions → persist). Citation guardrail with 2-retry max + deterministic fallback. Factor-tilt aware, scenario-aware, cap-enforced.
- [x] L5 lens mode — `lens` parameter on `run_q1_agent` + `<LensSelector>` on the `/book` triad (ADR-0015). The former `/portfolio` and `/trades` hosts now `redirect()` → `/book`
- [x] L5 emits `AdvisoryDerivation` with T18 strict policy — deterministic fallback cannot be marked `verified`
- [x] L5 candidate taxonomy seam — `classify(ticker)` from `frontend/lib/assetMetadata.ts` (T20)
- [x] L5 TradeScore plumbing of per-theme `elapsed_days` (T22)
- [x] L5 **9th node `finalise_book_analytics`** — book metrics, stress scenarios and correlation matrix recomputed on the FINAL SIZED book and persisted as structured JSONB, instead of being formatted into a prompt string and discarded ([ADR-0024](docs/adrs/0024-persist-book-analytics-not-prompt-strings.md))
- [x] L5 `size_positions` delegates to `allocate_portfolio`, and shorts carry signed weight. The documented 20/30/35 caps are **genuinely enforced as of [ADR-0037](docs/adrs/0037-position-limits-bind-and-the-rest-is-cash.md)** — this line previously claimed enforcement that did not happen: a final "normalise so weights sum to 1.0" step divided the capped total straight back up to 100%, group caps compared each *member* against the *group* cap (so two names at 20% left a sector at 40% under a 30% cap, uncapped) and skipped groups with <3 members, and single-name redistribution could leave a recipient at 80% against its own 20% limit. Whatever the limits refuse is now held in **cash** rather than renormalised away, so a constrained book deploys less than $100M and `/book` states the cash and the reason.
- [x] L5 `screen_candidates` records per-filter attrition to `screening_funnel`
- [x] L6: **`/book`** — one expandable row per position: thesis, counter-thesis, catalysts, full sizing chain, factor tilts, per-scenario stress, cap utilisation, plus the screening funnel ([ADR-0025](docs/adrs/0025-book-centric-information-architecture.md))
- [x] L6: **`/risk`** — stress scenario matrix, correlation heatmap, cap-utilisation bars, book factor tilt, risk metric cards, drawdown/P&L chart
- [x] L6: **`/method`** — live HypeScore + TradeScore formulas with today's `scoring_config` weights and a worked example, `pipeline_runs` stage health, data-source provenance, citation-guardrail audit
- [x] L6: Research page rendering per-trade thesis + book view from `research_recommendations`
- [x] **Fabrication ban enforced** — hardcoded theses, synthetic sub-score attribution, invented Kelly sizing, fabricated source counts, hardcoded "Pipeline healthy"/theme counts/prompt version and "Conviction: HIGH" all removed; `EmptyState`/`QueryErrorState` render cause + remedy instead ([ADR-0025](docs/adrs/0025-book-centric-information-architecture.md))
- [x] Schema/query mismatches closed — `research_recommendations.book_metrics_summary`, `.scenario_table` and `regime_classifications.narrative` were selected but never existed (400/42703); `portfolio_factor_exposure` was queried but never existed (404/PGRST205)
- [x] Sub-score unit mismatch fixed — `themes.*_score` persist as [0,1] while `hype_score` is 0–100; `toDisplayScore` in `frontend/lib/themeSignals.ts` is the single conversion point
- [x] `themes.corr_score` now persists `abs(price_corr)` — the value `hype_score()` actually consumes — so the four sub-scores reproduce the score they claim to derive
- [x] **EdgeScore direction surfaced** — `edge_score`/`trend_signal`/`regime_bias` (migration 023) rendered on `/method` §4 (live weights + worked example), `/book` per-position "why this side", and `TradeDerivationDrawer`. The stale "direction = sign(TradeScore)" explanations on `/method` §3 and the drawer were corrected: TradeScore is reframed as intra-side ranking; direction is `sign(EdgeScore)` per [ADR-0031](docs/adrs/0031-edge-score-direction-signal.md). Read via `fetchThemeEdge` in `frontend/lib/themeSignals.ts`
- [x] L7: Provenance UI infrastructure — citation footnotes, theme derivation drawer, regime inputs panel, lens selector
- [x] L7 status read-models — `StatusBadge`, `FreshnessLabel`, `UncertaintyBand` rendering derivations
- [x] L7 portfolio read-models — `CumulativeReturn` (since-inception compounded), `DailyPLHistory`, `ExposureSummary`
- [x] L7 research read-model — `ThesisBlock`
- [x] Provenance columns on existing tables — `portfolio_risk.numeric_derivations` (T15), `portfolio_positions.numeric_derivations`, `research_recommendations.advisory_derivation` (T13)
- [x] Derivations module — `backend/derivations/{numeric.py,advisory.py}` + TS mirrors in `frontend/lib/derivations/`
- [x] Pipeline runs audit — `backend/services/pipeline_runs.py` populates `pipeline_runs` table per stage (T10, migration 012)
- [x] Since-inception cumulative return — `portfolio_cumulative_return` table, compounded product of `daily_return` rows (ADR-0020)
- [x] Signed-weights portfolio accounting — convention formalized at backend/frontend seam (ADR-0019)
- [x] Provenance read-model seam — frozen dataclasses + TS mirrors drive every L7 derivation render (ADR-0021)
- [x] Q1 thesis layer: deterministic L0–L4 features + stochastic L5 synthesis + auditable L6/L7 rendering (see ADR-0012, 0013, 0014, 0015, 0018)
- [x] **Q1/Q2 remediation (2026-07-23)** — citation guardrail now value-reconciles, not just key-checks (ADR-0019); real news wired into L5 via `theme_news` (ADR-0020); robust median/MAD momentum + signed `crowding` label (ADR-0021); HypeScore IC/decay backtest `scripts/backtest_hype.py` (ADR-0022); data-source provenance labels + `scripts/check_data_integrity.py` R0 fingerprint guard (ADR-0023); `theme_discovery.py` now persists Tier 2/3 to the `discovered_themes` shadow table. Backend suite 302 passing.
- [x] Q2: Theme feed with HypeScore gauges + trend arrows
- [x] Research-first redesign: regime hero, conviction cards, alloc bar, factor panel, global nav
- [x] End-to-end Playwright e2e tests — `frontend/tests/e2e/{dashboard,portfolio,trades}.spec.ts` (T25)
- [x] Verification matrix — `docs/verification/MATRIX.md` (T25)
- [x] Residual risk register — `docs/risks/RESIDUAL.md` (T28)
- [x] Lineage matrix — `docs/lineage/MATRIX.md` (T12)
- [x] Runtime execution graph — `docs/runtime/EXECUTION_GRAPH.md` (T16)
- [x] Baseline docs — `docs/baseline/{access,frontend-routes,pipeline-graph,schema}.md` + `STATUS.md` (T1)
- [x] Supabase migrations applied locally (001–009, 012–015)
- [x] 198+ tests passing (lens mode tests added); 227+ backend tests passing post-T9/T20/T22
- [ ] Migrations 010/011 (`market_assets`, `prediction_markets`) deployed to live Supabase — pending (Polymarket feed on local only)
- [x] Migrations 018–021 (`theme_news`, `theme_signals_history.signed_corr`/`crowding`/`data_source`, `discovered_themes`) deployed to live Supabase
- [ ] R0 fix: re-run `daily_refresh.py` against real data to overwrite the fabricated `portfolio_risk`/`portfolio_returns` seed rows — pending (needs live credentials; detectable now via `scripts/check_data_integrity.py`)
- [x] Scheduling is **GitHub Actions**, not cron-job.org (a ~10-min Python job can't live in an HTTP-ping cron or a Vercel function): `daily-refresh.yml` (21:30 UTC weekdays → L0–L5 + IC-validation refresh + integrity guard) and `theme-discovery.yml` (monthly → LDA ∩ embedding candidates). Both support `workflow_dispatch`. **Operator action required:** set the repo secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` mandatory; `BRAVE_SEARCH_API_KEY`, `MINIMAX_API_KEY`, `FRED_API_KEY` recommended) — see the Scheduled jobs table in `CLAUDE.md`. Note GitHub auto-disables scheduled workflows after 60 days of repo inactivity.
- [x] Theme discovery shadow mode — `theme_discovery.py` runs against the live DB (corpus sourced from `theme_news`), persists LDA∩embedding candidates to `discovered_themes`, and is surfaced on `/` via `DiscoveredThemes` ("What the engine is discovering"). Latest run: 6 Tier-2 (two-method agreement) + 5 Tier-3. Candidates stay `shadow` until an operator promotes them.
- [x] **Carry made two-sided; missing components renormalise** ([ADR-0036](docs/adrs/0036-carry-as-excess-yield-over-funding.md)) — `carry_signal` scored the raw LEVEL of a spread/yield (`tanh(HY_OAS/4.0)`), which is non-negative by construction, so the largest EdgeScore weight (0.34) was a standing long offset rather than a signal and a short book was structurally unreachable. Carry is now excess yield over funding (`(10y + OAS) − DFF` for credit, `10y − DFF` for rates), negative when the curve inverts. `carry_signal`/`value_signal` return `None` where L0 has no proxy (fx/equity/commodity) instead of a silent `0.0`, and `compute_edge_score` renormalises over the components actually present — an equity theme was previously capped at |Edge| ≤ 0.48 against the same 0.15 abstention band a credit theme met with |Edge| ≤ 1.0. **Did not create shorts** (universe is still long-biased today, 4 long / 0 short) but dropped Fed Policy — previously the entire $100M book — into abstention.
- [x] **Direction moved from the theme to the asset** ([ADR-0038](docs/adrs/0038-per-asset-direction.md)) — the reason the book produced zero shorts for its entire life, and why three iterations of universe-widening (tickers, discovered themes, and the planned single names) could never have fixed it. `_expand` stamped every asset in a theme with the theme's direction, so **GLD was held LONG inside Fed Policy, Inflation, US Dollar and Geopolitical Risk at once** while its own trend and regime scored it −0.44. Four of EdgeScore's five components are natively per-asset or per-asset-class (95% of the weight), and were being averaged across the basket before use. Now `compute_edge_scores` fills `asset_edges[(theme_id, asset)]` and each asset takes `sign(its own edge)`, abstaining on its own |edge|; themes still gate scope via the hype threshold, so the attention premise is untouched. First two-sided book: **7 long / 2 short, 9 positions, HHI 564** (was 3 long / 0 short, HHI 1243) with no threshold, cap, or universe change.
- [x] **Scope by attention, abstention by asset** ([ADR-0039](docs/adrs/0039-scope-by-attention-abstain-by-asset.md)) — ADR-0038 moved direction to the asset but left a theme-level `|EdgeScore| >= 0.15` gate standing in front of it, so only two themes contributed anything. Once direction is per-asset that gate is actively harmful: a theme's average edge is smallest exactly when its assets disagree, which is when it has most to offer a long-short book. Live proof — the three themes it rejected were the three richest in shorts: **US Dollar (the day's highest-attention theme, hype 73.4, edge +0.144) held 3 short-capable assets, China Growth 2, and Inflation was 4-for-4 short-capable at +0.086** — a number that blends the rates leg's carry with the commodity leg's trend and describes no asset that exists. Scope is now hype-ranked (attention premise intact, and a test pins that a below-gate theme stays out); every candidate still clears `|its own edge| >= 0.15`, so abstention is not weakened, it is applied once instead of twice. Book: **12 positions, 9 long / 3 short, 92.2% deployed** (was 9 positions, 7/2, 66.5%), with US Dollar supplying EEM and EMB long against GLD and FXE short.
- [x] **The published book is the book of record** ([ADR-0040](docs/adrs/0040-published-book-is-the-book-of-record.md)) — the app was rendering **two different portfolios**. `/book` shows `research_recommendations.picks` (L5's selection) while `portfolio_positions`, the daily return and every risk statistic came from L1's *provisional* book, which L5 re-picks a subset of. Live on 2026-07-24: 12 names at 92.2% gross vs 6 names at 98.9% — **EFA, IWM, QQQ, SLV, SPY and XLV were attributed risk on `/risk` while appearing nowhere in the book**, and VaR/CVaR/Sharpe/Beta/HHI described a portfolio nobody holds. `/risk` also contradicted itself, reading caps and scenarios from L5's book but attribution from L1's. After L5 persists, `portfolio_positions` is now rewritten to its picks and return/risk/cumulative are recomputed on that book — the same rule ADR-0024 already applied to tilts, scenarios and correlation. Compute-twice is deliberate: L5 *consumes* the provisional risk as reasoning input, so the final recompute must follow it. Picks match back on `(asset, direction)` (they cannot be invented — ADR-0014) and adopt L5's already-cap-respecting weights. If L5 produced nothing, or a pick falls outside the candidate set, the L1 book stands and it is logged rather than publishing a book that disagrees with its own risk.
- [x] **Regime drives direction through a continuous dial, not a label** ([ADR-0041](docs/adrs/0041-regime-as-a-dial-not-a-cliff.md)) — two runs hours apart on the SAME day produced opposite books (4L/2S at net +26.7%, then 2L/3S at net −20%) because `regime_classifications` moved `late/risk-on` → `late/neutral`. `regime_direction_bias` read that through `_SENTIMENT_SIGN {+1, 0, −1}` times the asset class's risk beta, so an equity's regime term swung from +0.5β to −0.5β — a full **1.0β move on a component carrying 0.23 of EdgeScore**, which inverted the equity complex at once. And the label moved because, with VIX 18.6 and HY OAS 268bp failing every other rule, the only path to "risk-on" was `breadth > 60`: **$100M of positioning hung on one breadth statistic crossing a single integer.** `risk_appetite(vix, hy_oas, vix_term_diff, breadth)` now returns a continuous [−1, +1] score (smooth tanh terms centred on each input's neutral level) and `regime_direction_bias`/`theme_regime_bias` take it in place of the label sign; across the breadth threshold the score moves **0.022 instead of 1.0**, while a stressed tape still scores −0.94 and a calm one +0.80. The discrete label is retained for display on `/` and `RegimeInputs`.
- [x] **HypeScore sub-scores made absolute** ([ADR-0042](docs/adrs/0042-absolute-hype-subscores.md), supersedes [0006](docs/adrs/0006-minmax-over-zscore-hypescore.md) and [0028](docs/adrs/0028-minmax-correlation-consistency.md)) — Q2 asks for a score that supports "idea generation **and risk monitoring**", and risk monitoring means tracking a theme's attention over time, which min-max across the day's themes cannot do: a theme's score was a statement about its peer group. Measured on production — **China Growth's 7-day mention count was byte-identical across two run dates (1.14286) and its HypeScore still fell 60.6 → 36.6**; Corporate Credit's was identical (0.857143) and fell 45.7 → 34.2. **ADR-0006 contradicts itself on exactly this**, listing "comparable across run dates" as a positive and "a theme can score 100 today and 30 tomorrow without changing its absolute signal" as a negative. Each sub-score now maps the theme's own signal against a documented anchor: volume `tanh(m7/3.0)`, sentiment `(compound+1)/2` (unchanged), correlation `min(1, |corr|/0.50)`, momentum `(tanh(z/2.0)+1)/2`. Same two cases now move −7.5 and −2.2 instead of −24.0 and −11.5, tracking each theme's genuine correlation decline, and the volume sub-score is identical across the two days as it should be. Side effect worth knowing: the `hype ≥ 50` gate is now a real level rather than "upper half of today's eight", so the count clearing it will vary — that variation is signal.
- [x] **Single companies added to the universe** ([ADR-0043](docs/adrs/0043-single-company-universe.md), migration `032_single_company_universe.sql`) — `task.md` asks for trades "across any asset class and/or **single companies**" and the universe had none. Twice deferred for the right reason: until [ADR-0038](docs/adrs/0038-per-asset-direction.md) direction was a THEME property, so a company added to a rising theme would have inherited long regardless of its own signal — exactly like the ETFs added in iteration 4, which produced no shorts either. Now that direction is `sign(the asset's own EdgeScore)` a company can oppose its own theme. The need is on the short side: the L1 pool held **14 long against only 4 short**, so L5 filled its long side to the cap (5 of 5) and could only find 2 shorts. 15 names added (JPM, GS / XOM, CVX, SLB / UNH / LMT, NOC, RTX / F / JD, PDD / FCX, NEM, NUE), **37 → 52 tickers**, each checked for ~251 daily closes and present in all three taxonomy maps before insertion. They disagree *inside* a theme — the defence primes span LMT −3.1%, RTX +7.3%, NOC −19.8% — which is the idiosyncratic dispersion theme-level direction could never use. Two new sectors (`Defense`, `Autos`) keep the 30% sector cap meaningful. **Open calibration question recorded in the ADR:** the 20% single-name cap was set when every "name" was a diversified fund, and single equities carry earnings/litigation risk that neither HypeScore (which counts *theme* mentions) nor the regime model sees.
- [x] **All six pipeline stages are instrumented** — L1 and L4 never called `record_pipeline_run()`, so `/method` showed them as *"not instrumented — Last success: never"* while the status bar read *"All stages complete · 4/4 succeeded"*. Both were true and together misleading: `EXPECTED_STAGES` was `["L0","L2","L3","L5"]`, counting the stages that **report** rather than the stages that **exist**. The two silent ones were the two the deliverables lean on — **L1 is theme detection (the whole of Q2's daily process) and L4 is the risk engine behind every number on `/risk`**. Both now write a `started` sentinel before any work and a `success` row with duration; L4 also writes `failure` before re-raising, so a crash in the risk block is visible rather than merely absent. Each carries `source_freshness` naming what it produced (`themes_scored`, `positions_priced`) — "it returned" is not "it did something". Live: L0 12.4s · L1 21.9s (themes_scored 8) · L2 4.5s · L3 1.7s · L4 1.3s (positions_priced 23) · L5.
- [x] **Factor model reconciled against known betas, and surfaced** (`frontend/components/method/FactorReconciliation.tsx`, `/method` §05) — L2's FF5+UMD betas drive the book's factor tilts and all four scenario shocks, yet nothing had ever checked them and `/method` had **no L2 section at all**: the layer beneath every tilt on the site was both unexplained and unverified. Checked against assets whose market beta is known a priori and it is sound — **SPY +0.99 at R² 1.00** (definitional: SPY *is* the market factor, so this fails loudly if the regression, date alignment or excess-return convention is wrong), IWM +1.02, QQQ +1.17, ARKK +1.49, XLF +0.94, HYG +0.23, GLD +0.27, TLT +0.11, SHY +0.01, **BIL −0.00** (T-bills, no equity risk). BIL and ARKK bracket the range correctly. The gap was that nobody had looked, not that it was broken — a credibility asset sitting invisible. Now rendered live from `factor_exposures` with the expected band beside each beta and why each is known in advance; bands are deliberately generous ("not broken", not "matches a vendor to two decimals"). Backed by `tests/backend/test_factor_reconciliation.py`, which pins beta recovery on synthetic series including the definitional β=1 case and the "40 observations must return {} rather than a beta labelled 252-day" guard.
- [x] **EdgeScore IC measured, persisted, and honestly labelled** ([ADR-0044](docs/adrs/0044-carry-ic-was-measured-on-a-superseded-signal.md)) — `scripts/backtest_edge.py` existed but only **printed**, so `backtest_results` held nothing for EdgeScore and the site never said whether the signal that decides the trades predicts anything. It also no longer ran: [ADR-0036](docs/adrs/0036-carry-as-excess-yield-over-funding.md) made `carry_signal`/`value_signal` return `None` and the harness still assumed floats (died on `abs(None)`), and it fed carry only the sleeve's own series when the new definition needs `DGS10` + `DFF` — it would have measured a signal production never computes. Fixed, run, and persisted under `test_name='edge_ic'` with N, t, p, hit-rate and a `pass` flag. **Result: Trend IC +0.0332 (N=975, p=0.300), Carry +0.1275 (N=94, p=0.221), Value +0.0939 (N=94, p=0.368); Regime and Sentiment not testable. All positive, NONE significant.** This corrects ADR-0033's "carry earned a strong significant IC, p=0.007" — that was measured on the superseded `tanh(OAS/4)` carry, and ADR-0036 changed the signal without re-running the test, leaving the **largest weight in EdgeScore (0.34)** justified by evidence about a different formula. **Weights deliberately unchanged** — re-fitting on p=0.22 would be fitting noise; they are now labelled priors informed by a weak positive signal rather than a fitted result.
- [x] **EdgeScore IC rendered on `/method`** (`frontend/components/method/EdgeValidation.tsx`) — the numbers were persisted by [ADR-0044](docs/adrs/0044-carry-ic-was-measured-on-a-superseded-signal.md) but nothing read them, so the site still said nothing about whether the signal that **decides the trades** predicts anything. HypeScore had a validation panel and EdgeScore did not, which is the wrong way round: HypeScore selects what we look at, EdgeScore picks the side and the size. The panel sits **inside** the EdgeScore section so the claim and the evidence meet on one screen, pairs each component's IC with the weight it actually buys (read live from `scoring_config`, never mirrored), and renders the uncomfortable parts as they are — every testable component *"right sign, not significant"*, Regime and Sentiment as *"not testable — needs per-theme history"* rather than as zero, and a footer stating outright that the weights are deliberately not re-fitted on p≈0.2 evidence.
- [x] **Under-sampled risk statistics are suppressed, not annotated** (`frontend/components/risk/RiskMetricsGrid.tsx`) — `/risk` rendered VaR, CVaR and Sharpe as a headline figure **plus** a caveat saying the figure meant nothing (**"SHARPE 10.77 ▲ +4.56"** at 22px above *"2 sessions of history — needs 60. Too small to read as a real Sharpe."*), while **Beta on the same card correctly showed "—· insufficient history"**. Two under-sampled statistics, two different treatments. A reader skims the number, not the footnote — and the delta chip asserted a meaningful *improvement* in a statistic we had just called noise, the same figure having read −8.23 before an earlier upstream correction. Annotating was a deliberate earlier choice and better than silence, but it still violated the standing rule *prefer "unavailable, because X" over a confidently-wrong number*. A statistic below its declared `MIN_DAYS_FOR_*` now renders `—`, badges **Unavailable** rather than Estimated, withholds the delta chip, and states the reason in place. The computed value remains in `portfolio_risk` for anyone who queries it; the page stops asserting it.
- [x] **The risk-limit board withholds statistics its sample cannot support** (`frontend/lib/risk/riskBoard.ts`) — suppressing the metric *tiles* sharpened a contradiction rather than resolving it: the board still read **"VaR (95%) 1.7% / 6.0% limit / OK"** while the tile on the same page read *"Not shown: 2 sessions of history, needs 30. A VaR from this sample is noise, so we do not publish one."* Same number, same page, opposite claims — and **the OK is the more dangerous**, because a green stamp against a governing limit reads as a risk check that passed. Beta already rendered NO DATA there, so the board too was treating two under-sampled statistics two ways. `buildLimitBoard` now takes `returnSessions` and withholds any statistic below its declared minimum, mirroring `MIN_DAYS_FOR_*` in `risk_engine.py` and `minSessions` in `RiskMetricsGrid` so tile and board cannot disagree. The row still renders (a limit a PM cannot see is a limit they cannot manage) as `unknown`. Scoped to statistical **estimates** only — max drawdown is a realised fact and the HHI/cap/exposure rows come from today's weights, so gating those would replace a real number with a blank; an unknown session count does not withhold either. Five tests pin it.
- [x] **Stress scenarios use per-asset betas, not the book tilt** (`backend/services/scenario_analysis.py`) — every scenario returned ~zero: **VIX Spike −0.021% (−$21k on $100M)**, credit −0.012%, USD −0.005%, rates −0.003%, all "low", on a row whose own description says *"historically associated with −15 to −25% SPX drawdown"*. `estimate_scenario_pnl` substituted `book_metrics`' **book-level** factor tilt for every pick's beta and `abs()`d it; pushing a book-level tilt inside the per-pick loop computes `β_book × Σ(±wᵢ) × shock` = **β_book × NET exposure**, when a shock acts on **GROSS**. The book ran 48.7% gross against 0.6% net, so `0.191 × 0.006 × −0.18 = −0.021%` — exactly the figure displayed. The `abs()` separately destroyed sign, so a net-short-beta book could never show a gain. The function's own docstring always specified per-asset betas; only the code disagreed. Now threaded `factor_exposures` (already in state at both call sites, and reconciled 8/8 against known benchmarks). After: VIX **+1.63%**, rates +1.05%, USD +0.26%, credit −0.02% — and independently confirmed, since `/risk` already showed **Σβ contribution = −0.09** for this book and −0.09 × −18% ≈ +1.6%. The scenario now agrees with the attribution table on the same page; it did not before. Assets with no factor row are skipped, not scored as β 0.
- [x] **A dropped quote no longer kills the daily run** (`scripts/daily_refresh.py::compute_and_persist_daily_return`) — the 2026-07-24 re-run died with `RuntimeError: daily return aborted: missing prices for ['EMB']`. EMB is a liquid ETF that fetched fine seconds later; a **batch yfinance download had silently dropped it**, and L4 risk plus the entire L5 book and thesis were lost because one quote of eighteen went missing in one HTTP call. The guard stays — never invent a return for an unpriced position, the rule that caught DXY in migration 031 — but aborting over a *transient* batch artefact is disproportionate for a process billed as daily. Missing tickers are now retried **individually** before the gap is treated as real; a single-ticker fetch reliably succeeds where a batch call dropped it. The contract is unchanged: a ticker still absent after its own dedicated fetch aborts exactly as before, and a test pins that alongside the recovery case, because the easy mistake is to "fix" the abort by tolerating missing data.
- [x] **The site says when the book is not today's book** (`frontend/lib/freshness.ts`) — the 2026-07-24 pipeline death was invisible in a way no other defect this session was. Every other one was a wrong number *on* the page; this was a **missing run**, and the page had no way to show it: `/book` printed "RUN DATE 2026-07-22" and the status bar said "2d ago", both factual, both in the same neutral grey as "5 min ago". `assessStaleness` judges a run_date in **business days** — calendar days are the wrong unit, since a Friday book read on Sunday is two calendar days old and perfectly current — and flags at **2**, not 1, because the job runs *after* the close so the newest book on any weekday morning is legitimately yesterday's; flagging at 1 would fire daily and a warning that is always on is a warning nobody reads. `/book` gets a banner naming the date, the missed-run count and the consequence ("These are not today's positions"), the run date turns amber, and the status bar carries the same signal on every page. Six tests pin the boundaries, including silence when there is no run date — a missing date is a different problem and inventing a staleness claim from it would be a fabrication.
- [x] **`/book` shows what cleared the screen and still was not taken** (`frontend/components/book/ClearedNotTaken.tsx`) — *"why isn't X in the book?"* had no answer anywhere: the abstention roster covers themes that failed the |EdgeScore| band and the screening funnel counts what each filter removed, but a candidate that passed **every** filter and simply was not selected by L5 was invisible. That is the largest remaining gap between pool and book, and the sharpest question about the current one — Q1 asks five-and-five, the book holds **5 long / 3 short**. The pool had five shorts (SLV −0.399 Metals, GDX −0.336 Gold Miners, NOC −0.304 Defense, GLD −0.301 Metals, ARKK −0.228 Disruptive Innovation) and L5 took one per distinct complex, skipping GDX and GLD as the same precious-metals bet already held via SLV. **Three independent short ideas is the honest answer to "why not five", and showing the two it declined makes that checkable rather than assertable.** The panel states only what the data supports — name, side, EdgeScore, theme, and whether the book already holds that theme — and deliberately does **not** attribute a reason to L5, whose rationale belongs in the thesis.
- [x] **"Why isn't X in the book?" answered with correlation, not a proxy** (`candidate_book_correlation`, migration `033_candidate_correlations.sql`) — the `ClearedNotTaken` panel first justified omissions by **theme overlap**, which had to be demoted to "a hint, not a verdict" once it was clear one theme routinely holds four positions across four sectors and both directions (GDX was labelled a duplicate of a theme held mostly *long*; QQQ long a duplicate of a theme held via ARKK *short*). Each unheld candidate is now scored against its **closest held position over 252 days**: GDX → SLV **+0.82**, GLD → SLV **+0.84**, AGG → TLT +0.91, IEF → TLT +0.91, EWJ → EFA +0.89, EEM → EFA +0.82, RTX → NOC +0.65, GS → JPM +0.63, **BIL → TLT −0.18**. GDX and GLD are demonstrably the same precious-metals bet already held through SLV — **which is why the short side is three independent ideas and not the five Q1 asks for**. That was reasoning before; it is evidence now, and BIL is the control that proves the measure discriminates. A candidate with no usable history renders `—`, never `0.00`. Persisted to `research_recommendations.candidate_correlations` (JSONB); the computation is wrapped so an explanatory panel can never fail the book.
- [x] **Correction: the short side is not capped by redundancy** — the `candidate_correlations` measurement added the same day disproved the claim that GDX/GLD being SLV-duplicates explained a three-idea short side. **NOC (edge −0.301, closest held ρ +0.20) is genuinely independent and was passed over**, while the book held only two shorts. Redundancy explains GDX (+0.82) and GLD (+0.84); it does not explain the short side's size — that is L5's selection, visible in the thesis rather than inferable from the pool. `ClearedNotTaken` now labels each row **"largely already held"** (ρ ≥ 0.70, the same `HIGH_CORR_THRESHOLD` `/risk` uses) or **"independent — passed over"**, and the non-discriminating "Theme also held?" column — which read *yes* on all sixteen rows once correlations landed — was removed.
- [x] **Correlation warnings cluster instead of listing every pair** (`correlation_clusters` in `book_metrics.py`) — chasing GOAL.md's open gap (the short side is limited by L5's *selection*, not the universe), I checked what L5 knows when it selects. It **does** receive correlation data — the "choosing blind" hypothesis was wrong — but as **31 near-identical verbose lines** on a 23-name pool, each ending with the same *"verify this is intentional, not accidental doubling of the same bet"*. Pairwise is also the wrong shape: nobody reasons about TLT-IEF, TLT-AGG, IEF-AGG and IEF-SHY separately, they reason about **the duration complex**. Connected components over the positively-correlated pairs turn those 31 lines into four named bets (`ONE BET: AGG, IEF, SHY, TLT …`), plus the strongest pairs for detail. **Inverse pairs are excluded from clusters and reported separately** — a −0.8 correlation is a HEDGE, and folding it into a "these are the same" cluster would invert the meaning; a test pins that. Not claimed to change the book: it improves a demonstrably noisy decision input, and whether L5 selects differently is its call, visible in the thesis.
- [x] **`/book` says how much of the book changed since the last run** (`frontend/lib/turnover.ts`, `frontend/components/book/BookTurnover.tsx`, [ADR-0045](docs/adrs/0045-turnover-on-names-without-a-verdict.md)) — *"would you get the same answer tomorrow?"* is the first question anyone asks of a systematic book and nothing here answered it. `research_recommendations` has always kept one row per `run_date`; no code had ever compared two. Turnover is **Jaccard distance over the held name sets** — names, not weights, because a position that survives at a different size is the same idea — with the **union** as denominator so a closed name counts as much as an opened one. **No verdict is attached**: a regime turn *should* churn a book, so "low = stable = good" would be a verdict about the market dressed as one about the process; the held-through / opened / closed lists are printed so a reader judges the change. **Today the reading is 100% and the panel says why that is not meaningful** — the live book holds 8 names and the previous run holds 2, from before the universe expanded, so `comparabilityCaveat` states in warning colour that this measures how much the *candidate universe* changed rather than the *view*. It clears itself once two consecutive full runs exist. Nothing renders at all when there is no previous run: an unmeasurable turnover is not zero.
- [x] **Correction: the book composition quoted in the two `ClearedNotTaken` entries above is superseded** — those describe the 2026-07-23 book (5 long / 3 short with **SLV** short, GDX and GLD *passed over*). The 2026-07-24 book is **JPM, EWZ, EMB, EWJ, TLT long; GDX, ARKK, NOC short** — GDX and NOC, both named there as declined, are now held, and SLV is out. The *reasoning* in those entries stands as the record of why each panel exists; the names in them are a snapshot of the day they were written. The book of record is always `research_recommendations` at the latest `run_date` ([ADR-0040](docs/adrs/0040-published-book-is-the-book-of-record.md)).
- [x] **"Why isn't X held?" was inverted for three of fifteen rows** (`frontend/lib/candidateOverlap.ts`, [ADR-0045](docs/adrs/0045-turnover-on-names-without-a-verdict.md)) — `ClearedNotTaken` thresholded each candidate against its closest held position on the **raw price correlation**, ignoring which side the book holds. The book is **short ARKK**; QQQ (rho +0.77), IWM (+0.80) and SPY (+0.80) are all LONG candidates, and all three read *"largely already held"* when each is nearer the **reverse** of that bet than a duplicate of it. `classifyOverlap` signs by both directions before thresholding — `aligned = rho x sign(candidate) x sign(held)` — giving the panel a category it could not previously express: **"would net against ARKK"**, which is a better reason to pass a name over than the one the page was giving. The held side now prints beside the ticker (`GDX short +0.82`) because the same rho reads as a duplicate against one side and a hedge against the other. The backend is unchanged by design: `candidate_book_correlation` returns an unsigned price correlation because it is a measurement, and `max|rho|` selects the same holding either way. **Found by reading the deployed page against the book above it** — the old code computed exactly what it meant to compute, so no test would have caught it. 10 tests pin the classifier including the three live rows that were wrong.
- [x] **`/risk` clipped rather than scrolled on a phone** (`frontend/components/risk/CapUtilisation.tsx`, `SectionGap.tsx`, `globals.css`) — cards set `overflow-x: hidden`, so content wider than the body is cut off **with nothing to reveal it**, which is strictly worse than a scrollbar: nothing signals that anything is missing. Cap utilisation needs 96 + 120 + ~110px plus gaps inside a 260px card body at 375px, so ~76px fell off the right edge — the `(68%)` utilisation reading, the number that panel exists to show. Two columns below `sm` (ticker and numbers on one line, bar full-width beneath), unchanged at three above. Source identifiers wrap with `overflow-wrap: anywhere`; `.card-header` gains `flex-wrap`. Verified at 375px and 1440px: zero page-level horizontal scroll and zero clipped elements on `/`, `/book`, `/risk`, `/method`.
