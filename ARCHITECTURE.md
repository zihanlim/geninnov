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
            N2["2. screen_candidates<br/><i>hard filter: hype, direction,<br/>R²≥0.10, ADV≥$2M, lens</i>"]
            N3["3. classify_news<br/>🤖 <b>LLM</b> — tag headlines<br/>{category, sentiment, theme}"]
            N4["4. compute_book_metrics<br/><i>FF5+UMD tilts, caps,<br/>correlation matrix</i>"]
            N5["5. run_scenario_analysis<br/><i>4 stress: VIX / rates / USD / credit</i>"]
            N6["6. reason_picks<br/>🤖 <b>LLM</b> — top-5L + top-5S<br/>+ thesis + counter-thesis"]
            N7["7. verify_citations<br/><i>pure-fn guardrail,<br/>max 2 retries</i>"]
            N7F["7b. fallback_picks<br/><i>deterministic if retries exhaust</i>"]
            N8["8. size_positions<br/><i>HypeScore-weighted $100M,<br/>20% / 30% / 35% caps</i>"]

            N1 --> N2 --> N3 --> N4 --> N5 --> N6 --> N7
            N7 -- "unverified" --> N6
            N7 -- "verified ✓" --> N8
            N7 -. "retries exhausted" .-> N7F --> N8
        end

        TG["backend/services/trade_ranker.py<br/>rank + size $100M book"]
        POLYSVC["backend/data/polymarket_fetcher.py<br/>prediction market feed"]
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
        T_RUNS["q1_agent_runs<br/>(citations, retries, verified)"]
        T_RECS["q1_recommendations<br/>(picks, book_view, scenarios)"]
    end

    %% ───────── Frontend (Next.js 14 → Vercel) ─────────
    subgraph FE["Frontend — Next.js 14 / Vercel<br/>andromeda-analytics.vercel.app"]
        direction TB

        subgraph L6["L6 — Writeup (per-page)"]
            PG_HOME["/ — Dashboard<br/>app/page.tsx"]
            PG_TR["/trades — Trade Ideas<br/>app/trades/page.tsx"]
            PG_PF["/portfolio — Portfolio<br/>app/portfolio/page.tsx"]
            PG_RS["/research — Research Thesis<br/>app/research/page.tsx"]
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
    TS -->|theme_signals,<br/>theme_signals_history| DB
    FF -->|factor_exposures| DB
    RC -->|regime_classifications| DB
    RE -->|portfolio_risk,<br/>portfolio_returns| DB
    TG -->|trade_candidates,<br/>portfolio_positions| DB
    POLYSVC --> DB

    %% ───────── L5 reads from DB ─────────
    DB -- "L0–L4 snapshot" --> N1
    DB -- "scoring_config" --> N1

    %% ───────── LLM edges ─────────
    MINIMAX -. "preferred" .-> N3
    MINIMAX -. "preferred" .-> N6
    ANTHROPIC -. "fallback" .-> N3
    ANTHROPIC -. "fallback" .-> N6

    %% ───────── L5 writes ─────────
    N8 -->|q1_recommendations| T_RECS
    N1 -->|input_snapshot +<br/>citations + retries| T_RUNS

    %% ───────── Frontend reads ─────────
    DB --> SUPC
    SUPC --> L6
    L6 --> L7

    %% ───────── Lens filter edges ─────────
    LENS -- "lens param" --> N2
    LENS -- "re-queries Supabase" --> SUPC

    %% ───────── Visual styling ─────────
    classDef llm fill:#fff3b0,stroke:#d97706,stroke-width:2px,color:#000
    classDef db  fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#000
    classDef fe  fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#000
    classDef ext fill:#f3f4f6,stroke:#374151,stroke-width:1px,color:#000
    class N3,N6 llm
    class DB,T_THEMES,T_TA,T_TS,T_TSH,T_TC,T_PP,T_PR,T_PRISK,T_SC,T_MACRO,T_FE,T_REG,T_RUNS,T_RECS db
    class CRON,FRED,YF,BRAVE,REDDIT,KEN,POLY ext
    class L6,L7,PG_HOME,PG_TR,PG_PF,PG_RS,REGIME,CONV,WATCH,TBL,ALLOC,FEAT,DERV,CITE,LENS,FEED,SUPC fe
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
| L1 | Theme Detection | `scripts/daily_refresh.py` → `build_theme_signals` | `theme_signals` table (mention count, sentiment, price corr, momentum) |
| L2 | Factor Exposure | `backend/data/factor_fetcher.py` | `factor_exposures` dict (FF5 + UMD betas per ticker) |
| L3 | Regime Classifier | `backend/services/regime_classifier.py` | `regime` dict (cycle + sentiment) |
| L4 | Risk Engine | `scripts/daily_refresh.py` → `compute_and_persist_risk` | `portfolio_risk` table (VaR, CVaR, Sharpe, beta, HHI) |
| L5 | **Q1 Reasoning Agent** | `backend/services/q1_agent.py` → `run_q1_agent` | `q1_recommendations` + `q1_agent_runs` tables; 8 nodes (aggregate → screen → book metrics → scenario analysis → reason_picks LLM → verify_citations → size_positions → persist). Supports `lens` parameter (multi_asset/credit/rates/equity/fx/commodity) per [ADR-0015](docs/adrs/0015-lens-mode-asset-class.md) |
| L6 | Writeup | `frontend/app/research/` | Per-trade thesis + book view rendered in `/research` page |
| L7 | **Provenance UI** | `frontend/components/{ThemeDerivationDrawer,CitationList,RegimeInputs,LensSelector}.tsx` | Click-through audit trail for every score; asset-class lens toggle on `/portfolio` and `/trades` |

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
    → screen_candidates: hype ≥ 50, trade_score ≠ 0, R² ≥ 0.10, dedup
    → compute_book_metrics: FF5+UMD tilts, net/gross exposure, cap violations, corr matrix
    → run_scenario_analysis: 4 stress scenarios (VIX/rates/USD/credit)
    → reason_picks: LLM (Claude Sonnet) → top 5 long + top 5 short + thesis + counter-thesis
    → verify_citations: citation guardrail (max 2 retries → fallback)
    → size_positions: HypeScore-weighted $100M allocation + 20%/30%/35% caps
    → Supabase: q1_recommendations + q1_agent_runs

**L5 is the only stochastic layer in the architecture.** Everything from L0 through L4 is a pure function — no LLM, fully reproducible. The LLM enters only at `reason_picks` and is bounded by:
- A hard candidate-set filter (LLM can only pick names that survived `screen_candidates`)
- The citation guardrail (`verify_citations` → max 2 retries → deterministic fallback)
- The size-positions cap enforcement (single-name 20% / sector 30% / geo 35%)

The LLM is treated as a *constrained synthesizer*, not a free agent. See [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) and [ADR-0013](docs/adrs/0013-deterministic-stochastic-split.md) for the design rationale.

L6: frontend/pages/research.tsx
    → Reads q1_recommendations from Supabase
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
| `theme_signals_history` | Historical hype scores for momentum calc | theme_id, run_date, hype_score |
| `factor_exposures` | FF5 + UMD betas per ticker | ticker, beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared, updated_at |
| `scoring_config` | Weighted config (drives hype + trade scores) | hype_volume_weight, hype_sentiment_weight, ... |
| `trade_candidates` | Ranked long/short candidates per run | theme_id, asset, direction, hype_score, trade_score, run_date |
| `portfolio_positions` | Sized positions per run | theme_id, asset, direction, notional, weight, run_date |
| `portfolio_returns` | Daily portfolio P&L | run_date, daily_return |
| `portfolio_risk` | Daily risk metrics | run_date, var_95, cvar_95, sharpe, beta, concentration_hhi |
| `q1_agent_runs` | L5 agent run audit trail (citation guardrail audit log) | run_date, prompt_version, model_id, input_snapshot, citations, verified, retries |
| `q1_recommendations` | Q1 output (picks + book view + scenario table) | run_date, picks, book_view, book_risks, book_metrics_summary, scenario_table |
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
```

## Q1 Agent: Citation Guardrail

Every numeric claim in the LLM's output must cite a FRED series ID (e.g. `BAMLH0A0HYM2`) or theme key. `verify_citations` checks each citation against `macro_snapshot`. Un-cited numbers → retry (max 2). On third failure → `fallback_picks` (deterministic, no LLM, always produces output).

The citation infrastructure (q1_agent_runs.citations JSONB + verify_citations step) is the data layer that powers the L7 provenance UI — see [ADR-0010](docs/adrs/0010-citation-footnotes-everywhere.md) for the rendering-side design and [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the guardrail design rationale.

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
- [x] L1: Brave Search news + Reddit social + VADER sentiment + price corr + momentum
- [x] L2: Ken French FF5 + UMD factor betas
- [x] L3: Regime classifier (cycle × sentiment)
- [x] L4: Historical VaR, CVaR, Sharpe, beta, HHI
- [x] L5: **Q1 reasoning agent** — 8-node pipeline (aggregate → screen → book metrics → scenario analysis → LLM reason_picks → verify_citations → size_positions → persist). Citation guardrail with 2-retry max + deterministic fallback. Factor-tilt aware, scenario-aware, cap-enforced.
- [x] L5 lens mode — `lens` parameter on `run_q1_agent` + `<LensSelector>` on `/portfolio` and `/trades` (ADR-0015)
- [x] L6: Research page rendering per-trade thesis + book view + scenario table from `q1_recommendations`
- [x] L7: Provenance UI infrastructure — citation footnotes, theme derivation drawer, regime inputs panel, lens selector
- [x] Q1 thesis layer: deterministic L0–L4 features + stochastic L5 synthesis + auditable L6/L7 rendering (see ADR-0012, 0013, 0014, 0015)
- [x] Q2: Theme feed with HypeScore gauges + trend arrows
- [x] Research-first redesign: regime hero, conviction cards, alloc bar, factor panel, global nav
- [x] Supabase migrations (001–009)
- [x] 198+ tests passing (lens mode tests added)
- [ ] L7 component implementation (ThemeDerivationDrawer, CitationList) — in progress
