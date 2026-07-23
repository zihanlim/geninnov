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

        TG["backend/services/trade_ranker.py<br/>direction = sign(EdgeScore)<br/>(trend+regime+carry+value, abstain)<br/>size ∝ conviction — ADR-0031/0032"]
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
            PG_TR["/trades — Trade Ideas (legacy)<br/>app/trades/page.tsx"]
            PG_PF["/portfolio — Portfolio (legacy)<br/>app/portfolio/page.tsx"]
            PG_RS["/research — Research Thesis (legacy)<br/>app/research/page.tsx"]
        end

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
| L6 | Writeup | `frontend/app/{book,risk,method}/` (+ legacy `{trades,portfolio,research}/`) | Book-centric IA ([ADR-0025](docs/adrs/0025-book-centric-information-architecture.md)): `/book` = positions + thesis + full sizing chain + screening funnel; `/risk` = stress scenarios, correlation matrix, cap headroom, factor tilt, drawdown; `/method` = live HypeScore/TradeScore formulas + `pipeline_runs` health + source provenance |
| L7 | **Provenance UI** | `frontend/components/{ThemeDerivationDrawer,CitationList,RegimeInputs,LensSelector}.tsx` + `frontend/components/status/{StatusBadge,FreshnessLabel,UncertaintyBand}.tsx` + `frontend/components/portfolio/{CumulativeReturn,DailyPLHistory,ExposureSummary}.tsx` | Click-through audit trail for every score; asset-class lens toggle on `/portfolio` and `/trades`; status/freshness/uncertainty read-models render derivations |
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
| `backtest_results` | HypeScore IC-backtest output (ADR-0022) | test_name (`hype_ic`), metric_name (`mean_ic_h{h}`), realized_value, pass, notes JSONB |
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
- [x] L5 lens mode — `lens` parameter on `run_q1_agent` + `<LensSelector>` on `/portfolio` and `/trades` (ADR-0015)
- [x] L5 emits `AdvisoryDerivation` with T18 strict policy — deterministic fallback cannot be marked `verified`
- [x] L5 candidate taxonomy seam — `classify(ticker)` from `frontend/lib/assetMetadata.ts` (T20)
- [x] L5 TradeScore plumbing of per-theme `elapsed_days` (T22)
- [x] L5 **9th node `finalise_book_analytics`** — book metrics, stress scenarios and correlation matrix recomputed on the FINAL SIZED book and persisted as structured JSONB, instead of being formatted into a prompt string and discarded ([ADR-0024](docs/adrs/0024-persist-book-analytics-not-prompt-strings.md))
- [x] L5 `size_positions` delegates to `allocate_portfolio` — the documented 20/30/35 caps are now actually enforced, and shorts carry signed weight
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
- [ ] Migrations 018–021 (`theme_news`, `theme_signals_history.signed_corr`/`crowding`/`data_source`, `discovered_themes`) deployed to live Supabase — pending (needs user authorization; guarded fallbacks keep the pipeline running until applied)
- [ ] R0 fix: re-run `daily_refresh.py` against real data to overwrite the fabricated `portfolio_risk`/`portfolio_returns` seed rows — pending (needs live credentials; detectable now via `scripts/check_data_integrity.py`)
- [ ] Cron (`cron-job.org`) owned externally and triggered daily against the live Vercel deployment — pending (scripts run on-demand locally)
- [ ] Theme discovery shadow mode (`theme_discovery.py` running against live DB and diffed against the curated theme registry) — pending
