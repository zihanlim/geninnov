# Andromeda: Market Theme Identification & Systematic Trade Generation Platform

**Date**: 2026-07-21
**Status**: Draft for Review

---

## 1. Concept & Vision

Andromeda is a systematic investment research platform that identifies trending market themes (Q2) and generates quantitatively-ranked trade ideas with per-trade thesis (Q1) using a layered pipeline. The platform bridges qualitative theme detection with quantitative portfolio construction, and bridges quantitative signals with discretionary synthesis — themes become signals, signals become ranked long/short candidates, candidates get risk-sized into a $100M portfolio, and an L5 reasoning agent synthesizes the deterministic L0–L4 outputs into a structured book with thesis, catalysts, and counter-thesis.

**Two questions, one system:**

- **Q2 (theme detection)** — "What themes are trending, and how much attention is each one attracting?" Answered by L1 (theme detection + HypeScore).
- **Q1 (book construction)** — "Given $100M, what are your top 5 long and top 5 short, and why?" Answered by the L0–L6 pipeline: L0 macro ingest + L1 theme detection + L2 factor exposures + L3 regime classifier + L4 risk engine feed the L5 reasoning agent, which produces a structured book rendered on `/research` (L6) with citation provenance (L7).

The L5 reasoning agent is the only stochastic layer. Everything from L0 through L4 is a deterministic pure function. The LLM is invoked only at L5 and is bounded by the citation guardrail (ADR-0012), the candidate-set hard filter (ADR-0014), and the deterministic-then-stochastic split (ADR-0013).

**System map (L0–L7):**

| Layer | Question answered | Stochastic? | Source |
|-------|-------------------|-------------|--------|
| L0 Macro ingest | What is the current macro state? | No | `backend/data/macro_fetcher.py` |
| L1 Theme detection | What themes are trending? (Q2) | No | `scripts/daily_refresh.py` → `build_theme_signals` |
| L2 Factor exposures | What is each candidate's factor tilt? | No | `backend/data/factor_fetcher.py` |
| L3 Regime classifier | What cycle × sentiment are we in? | No | `backend/services/regime_classifier.py` |
| L4 Risk engine | What is the portfolio's risk profile? | No | `scripts/daily_refresh.py` → `compute_and_persist_risk` |
| **L5 Q1 reasoning** | **What 5 long + 5 short, and why? (Q1)** | **Yes (LLM at `reason_picks` only)** | **`backend/services/q1_agent.py`** |
| L6 Writeup | How is the thesis rendered? | No (templated) | `frontend/app/research/page.tsx` |
| L7 Provenance UI | How is every claim audited? | No (read-only) | `frontend/components/{CitationList,ThemeDerivationDrawer,RegimeInputs}.tsx` |

**Feel**: A research desk meets a modern data dashboard — dense with information, auditable by default, and built around conviction over density.

---

## 2. Design Language

- **Aesthetic**: Dark-mode financial terminal with accent highlights per theme category
- **Color palette**:
  - Background: `#0d1117` (near-black)
  - Surface: `#161b22` (card backgrounds)
  - Border: `#30363d`
  - Accent Long: `#3fb950` (green)
  - Accent Short: `#f85149` (red)
  - Accent Neutral: `#58a6ff` (blue)
  - Text Primary: `#e6edf3`
  - Text Secondary: `#8b949e`
- **Typography**: `JetBrains Mono` for numbers/data, `Inter` for labels/text
- **Motion**: Minimal — theme cards fade in on load (200ms), gauge bars animate on score change (300ms ease-out)
- **Icons**: Lucide React (lightweight, consistent)

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Vercel (auto-deploy from GitHub)                         │
│  └── Next.js 14 App Router                               │
│      ThemeFeed │ HypeGauges │ TradeGenerator │           │
│      PortfolioBuilder │ Research                        │
│      ← reads directly from Supabase via client/queries    │
└──────────────────────────────────────────────────────────┘
                             ↑
              ┌──────────────┴──────────────┐
              │  Supabase (Managed DB)     │
              │  PostgreSQL — themes,       │
              │  signals, positions, cache  │
              └────────────────────────────┘
                             ↑
                   Daily cron job
                   (cron-job.org or $3 VPS)
                   Python script:
                   1. Pull Brave News + Reddit
                   2. Compute VADER sentiment
                   3. Calculate hype + trade scores
                   4. Write results to Supabase
```

**Infrastructure decisions**:
- **Vercel**: Zero-infrastructure frontend hosting. Push to `main` branch → auto-deploy. No server management.
- **Supabase**: Managed PostgreSQL. Serves as both database and API layer. Frontend reads directly from it.
- **Daily cron**: A lightweight Python script runs once/day (market close, e.g. 4:30pm ET). Pulls fresh data, recalculates all scores, writes to Supabase. Runs on cron-job.org (free) or a $3/mo VPS.
- **No backend server**: No FastAPI, no VPS for API, no Redis — all complexity removed.

---

## 4. Data Architecture

### 4.1 Real Data Sources (Free Tier)

All data is pulled from free-tier APIs — no paid subscriptions required:

| Data Type | Source | Library / API | Limits |
|-----------|--------|---------------|--------|
| News headlines | Brave Search News API | `mcp__brave-search__brave_news_search` | 20 req/query, rate-limited |
| Social posts | Reddit | `PRAW` (Python Reddit API Wrapper) | 60 req/min |
| Price series | Yahoo Finance | `yfinance` | No limit (rate-limited by Yahoo) |
| Factor data | Kenneth French DB | `pandas-datareader` | Direct download (CSV) |
| Sentiment | VADER Lexicon | `nltk.sentiment.vader` | Local computation, no limit |

### 4.2 Data Refresh Strategy

- **Daily batch**: All data refreshed once per day at market close (~4:30pm ET) via `daily_refresh.py`
- **Prices**: Pulled fresh from Yahoo Finance each batch
- **News/Social**: Pulled fresh from Brave News + Reddit each batch
- **Factor data**: Static for the day — pulled at market open, reused in batch
- **Sentiment**: Computed locally on raw text data; no external API needed

### 4.3 Sentiment Analysis

VADER (Valence Aware Dictionary and sEntiment Reasoner) is used for financial text sentiment:
- Outputs compound score: `[-1, +1]` (negative to positive)
- Pre-trained on financial news; well-suited for headline-level analysis
- No API cost — runs entirely local via NLTK

### 4.4 Theme Taxonomy

Theme taxonomy has three tiers:

**Tier 1 — Macro Anchors (fixed):**
Always tracked. Defined by practitioner judgment, not discovered. These are the themes that drive cross-asset moves.

| Theme | Coverage |
|-------|---------|
| Fed Policy | FOMC, rate decisions, guidance, dot plot |
| Inflation | CPI, PPI, PCE, breakevens, input costs |
| China Growth | GDP, PBOC policy, property sector, EM spillover |
| US Dollar | DXY, EUR/USD, EM currency stress |
| Geopolitical Risk | Wars, sanctions, trade tensions, elections |
| Corporate Credit | IG/XO spreads, default rates, financing conditions |
| Energy Prices | Crude, nat gas, refining margins, energy equities |
| US Election | Policy uncertainty, regulatory impact by sector |

**Tier 2 — Data-Driven Themes (discovered):**
Discovered from 6-month corpus of Brave News + Reddit posts. Found via both LDA topic modeling AND sentence embeddings + clustering (UMAP + HDBSCAN). Only themes that both methods agree on are added. Discovery runs at bootstrap and monthly.

**Tier 3 — Flagged for Review:**
Themes found by only one method are surfaced as candidate themes for human review before being added to Tier 2.

### 4.5 Scoring Configuration

All scoring weights and lookback windows are stored in Supabase — **not hardcoded**. This allows post-hoc re-scoring and A/B testing after the prototype stage without rewriting logic.

```sql
-- scoring_config table (editable without code changes)
scoring_config (
  id, param_name, value, updated_at
)
-- Example rows:
-- ('hype_volume_weight',   '0.30')
-- ('hype_sentiment_weight','0.20')
-- ('hype_corr_weight',     '0.30')
-- ('hype_momentum_weight', '0.20')
-- ('hype_score_threshold', '50')
-- ('lookback_momentum_1d', '1')   -- days
-- ('lookback_momentum_7d', '7')   -- days
-- ('sharpe_lookback',      '252') -- trading days
-- ('beta_lookback',        '252') -- trading days
-- ('var_confidence',       '0.95')
```

### 4.6 HypeScore Formula

```
HypeScore = w₁×VolumeScore + w₂×SentimentScore + w₃×CorrScore + w₄×MomentumScore
```

Each sub-component is independently min-max normalized to [0, 1] across all themes on each run date. All raw values are stored before normalization so scores can be recomputed retroactively.

| Sub-score | Definition | Lookback |
|-----------|-----------|----------|
| **VolumeScore** | Min-max normalized mention count (news + Reddit combined) | 1 day |
| **SentimentScore** | VADER compound score rescaled from [-1, +1] → [0, 1] | 1 day |
| **CorrScore** | Absolute Pearson correlation between mention count and asset return, min-max normalized | 7 days |
| **MomentumScore** | (1-day mention count − 7-day avg) / 7-day std, min-max normalized | 7 days |

**Why not z-scores**: Pearson correlation is bounded [-1, +1]. Z-scoring it across themes on each run date distorts the signal (a 0.4 correlation scores high one day, low the next purely due to cross-theme variation). Min-max normalization preserves the signal's natural scale.

**Weight defaults**: w₁=0.30, w₂=0.20, w₃=0.30, w₄=0.20. These are starting hypotheses — validated and adjusted post-prototype via backtesting.

---

## 5. Layer 1: Theme Detection & Hype Calculation

### 5.1 Theme Engine

**Input**: Raw news headlines, social posts, price data
**Output**: Per-theme raw signals → stored before normalization

```python
# Per theme, per run date — raw signals stored in theme_signals_history table:
ThemeSignals = {
    "mention_count_1d": int,    # raw news + Reddit mentions today
    "mention_count_7d_avg": float, # 7-day rolling average mentions
    "mention_count_7d_std": float, # 7-day rolling std of mentions
    "avg_sentiment": float,     # VADER compound score, rescaled [0, 1]
    "price_corr": float,        # Pearson corr(mention_count_1d, asset_return_7d)
    "momentum_raw": float,      # (count_1d − count_7d_avg) / count_7d_std
}
```

All raw signals are **persisted to Supabase** (`theme_signals_history`) on each run — not just the final HypeScore. This enables retrospective re-scoring if weights are adjusted.

### 5.2 Hype Calculator

```python
def hype_score(raw: ThemeSignals, cfg: ScoringConfig) -> float:
    volume   = minmax_norm(raw["mention_count_1d"],  all_themes_counts)
    sent     = rescale_vader(raw["avg_sentiment"])          # [-1,1] → [0,1]
    corr     = minmax_norm(abs(raw["price_corr"]),  all_themes_corrs)
    momentum = minmax_norm(raw["momentum_raw"],      all_themes_momentum)

    w = cfg.weights  # e.g. {vol:0.30, sent:0.20, corr:0.30, mom:0.20}

    return 100 * (w.vol * volume + w.sent * sent + w.corr * corr + w.mom * momentum)
```

Each run writes: the final HypeScore AND all 4 normalized sub-scores AND all raw signals. Retroactive re-scoring requires only a SQL update — no data re-collection needed.

---

## 6. Layer 2: Systematic Trade Generation

### 6.1 Trade Candidate Scoring

For each theme, generate a **TradeScore** used to rank long/short ideas:

```
TradeScore = w_hype × HypeMomentum
           + w_sent × SentimentDirection
```

Where:
- **HypeMomentum** ∈ [-1, +1]: (HypeScore_t − HypeScore_{t-1}) / HypeScore_{t-1}. Positive = rising attention, negative = fading.
- **SentimentDirection** ∈ [-1, +1]: VADER compound score. Positive = bullish coverage, negative = bearish coverage.
- **Weights** (starting defaults): w_hype = 0.55, w_sent = 0.45. Stored in `scoring_config` for post-prototype adjustment.

**Why momentum matters for direction**: A theme with positive sentiment but fading hype may be a "crowded trade" that's reversing. Momentum captures the velocity of the narrative, not just its sign.

**FactorAlignment is deferred** to Phase 4. When added, it will use Ken French factor returns (SMB, HML, MOM, etc.) to score whether a theme tilts toward or against current factor premia.

### 6.2 Long / Short Ranking

- **Direction rule**: Sign(TradeScore) determines direction. Positive → long candidate, Negative → short candidate.
- **Eligible-first**: themes with HypeScore ≥ threshold fill each side first — up to 5 longs (highest TradeScore) and 5 shorts (lowest TradeScore).
- **Direction is decoupled from the hype gate** ([ADR-0029](../../adrs/0029-two-sided-book-decouple-direction-revive-momentum.md)): the gate sets *priority*, not whether a side can exist. If a side is short of `min_side` (default 1) after the eligible pass, it is backfilled from the strongest **sub-threshold** themes of that direction, so the book is two-sided whenever the signal is. A side stays empty only when no theme of that sign exists anywhere (never fabricated). Backfilled picks carry low HypeScore, so hype-weighted sizing keeps them small. *Supersedes the earlier `eligible ∩ sign` rule, which produced an all-short book on a day when both hype-eligible themes shared one sign.*
- **HypeScore threshold**: Default 50, stored in `scoring_config` (editable without code changes)

### 6.3 Asset Mapping

**Tier 1 (Macro Anchors)** have fixed asset mappings defined by practitioner judgment:

```
THEME_ASSET_MAP_TIER1 = {
    "Fed Policy":       ["TLT", "GLD", "SVXY", "DXY"],
    "Inflation":         ["GLD", "SLV", "TIPS", "Commodity ETFs"],
    "China Growth":     ["FXI", "MCHI", "BABA", "KWEB"],
    "US Dollar":        ["UUP", "FXE", "GLD", "EWZ"],
    "Geopolitical Risk":["GLD", "TLT", "SLV", "EWJ"],
    "Corporate Credit": ["HYG", "LQD", "CDX", "SPX"],
    "Energy Prices":    ["XLE", "OIH", "CL", "UNG"],
    "US Election":      ["QQQ", "XLV", "XLF", "ARKK"],
}
```

**Tier 2 (Data-Driven)** asset mappings are defined when the theme is discovered — mapped to the most correlated asset(s) from a universe of liquid ETFs and equities at discovery time.

All asset mappings stored in `theme_assets` table (Section 9) with a `run_date` so historical re-scoring uses the correct assets for that period.

### 4.5 Theme Discovery Methodology

At bootstrap and monthly, run discovery on a 6-month rolling corpus of Brave News headlines + Reddit post titles. Goal: find themes that are emergent, recurring, and correlated with asset moves.

**Step 1 — Corpus assembly:**
- Scrape Brave News for financial/market headlines (6-month lookback)
- Scrape Reddit (r/wallstreetbets, r/investing, r/stocks, r/economy) for post titles
- Deduplicate, remove spam, keep only English financial content
- Output: ~50k–200k documents depending on activity level

**Step 2 — LDA Topic Modeling:**
- Use `gensim` or `sklearn` Latent Dirichlet Allocation
- Range topics from 10–30, select k using coherence score (c_v)
- Each topic = distribution over words + distribution over documents
- Label each topic by its top-10 weighted words
- Output: 10–20 candidate themes

**Step 3 — Sentence Embedding Clustering:**
- Encode each document with `sentence-transformers` (e.g., `all-MiniLM-L6-v2`)
- Reduce dimensionality with UMAP (preserve local structure)
- Cluster with HDBSCAN (density-based, no k needed)
- Each cluster = candidate theme
- Output: clusters with representative documents

**Step 4 — Agreement & Selection:**
- Compare LDA topics and embedding clusters
- Themes found by **both** methods → auto-add to Tier 2
- Themes found by **only one** method → surface to Tier 3 (human review)
- Filter out: themes with <50 documents, themes correlated >0.85 with existing Tier 1, themes covering <3 asset correlations

**Step 5 — Asset mapping (Tier 2 only):**
- For each new Tier 2 theme, compute Pearson correlation of mention count with returns of all assets in a liquid universe (50 ETFs)
- Map to top-3 most correlated assets as the initial `theme_assets` entry

**Discovery is not real-time.** It runs at system bootstrap (one-time) and then monthly or after major market events (rate decisions, crises, elections). Discovered themes are added to the `themes` table and tracked like any Tier 1 theme from that point forward.

---

## 7. Layer 3: Risk Engine (Portfolio Construction)

### 7.1 Position Sizing

Given $100M total portfolio, allocate to top 5 longs and top 5 shorts:

```python
def allocate_portfolio(candidates: list[TradeCandidate],
                       total_capital: float = 100_000_000,
                       cfg: ScoringConfig) -> list[Position]:
    # Weight by confidence (HypeScore) — themes with higher confidence get more capital
    weights = [c.hype_score / 100 for c in candidates]
    total_w = sum(weights)
    notionals = [w / total_w * total_capital for w in weights]
    return [Position(cand, notional) for cand, notional in zip(candidates, notionals)]
```

All weights and lookback parameters stored in `scoring_config` — not hardcoded.

### 7.2 Risk Metrics

All lookback windows are explicit and stored in `scoring_config`. Default values below:

| Metric | Formula | Lookback |
|--------|---------|----------|
| **VaR (95%)** | Portfolio value × z_α × σ_daily (parametric) | σ_daily = 252-day realized vol |
| **CVaR (95%)** | Average loss beyond VaR (more honest than VaR alone) | 252-day realized vol |
| **Sharpe Ratio** | (252-day realized return − risk-free) / σ_daily | 252 trading days |
| **Beta to SPX** | Cov(portfolio_rets, SPX_rets) / Var(SPX_rets) | 252-day daily returns |
| **Concentration HHI** | Sum of squared theme weights (range 0–10,000) | Current portfolio weights only |

**Why CVaR over VaR**: VaR only tells you the loss at the 5th percentile — not how bad it gets beyond that. CVaR (Conditional VaR / Expected Shortfall) averages all losses beyond VaR, capturing tail risk properly. VaR is still reported for familiarity but CVaR is the primary risk control metric.

**Expected return for Sharpe**: Uses realized 252-day return (from Yahoo Finance). Not a forecast — this is a descriptive past-performance Sharpe, not a predicted one. Flag this clearly in the UI so users don't mistake historical for forward-looking.

All raw return series stored in `portfolio_returns` table so metrics can be recomputed with different lookbacks post-hoc.

### 7.3 Post-Prototype Review Framework

After the prototype generates 30–60 days of live scores, the following should be validated before trusting the system with real capital:

**Signal validity checks:**
- Does top-ranked HypeScore theme actually outperform the bottom-ranked theme over the subsequent 5, 10, 20 trading days?
- Is the correlation signal (CorrScore) actually predictive, or is it spurious? Compare performance of high-corr vs low-corr themes.
- Is momentum (1d vs 7d avg) predictive of 1-week forward returns, or does it mean-revert?

**Long/short signal checks:**
- Do top-5 long themes outperform top-5 short themes over subsequent 20 trading days?
- What is the hit rate — % of long themes that beat the market over the next month?
- Is there a theme that looks good on hype but consistently loses?

**Risk metric calibration:**
- Does observed CVaR match predicted CVaR over the period? (Use realized max drawdown as ground truth)
- Is Sharpe computed on realized returns positive over the evaluation window?

**Validation output** stored in Supabase `backtest_results` table:
```sql
backtest_results (
  id, test_name, start_date, end_date,
  metric_name, predicted_value, realized_value,
  pass (boolean), notes, created_at
)
```

If a test fails (e.g., momentum is not predictive), the weight in `scoring_config` is adjusted and scores are recomputed retroactively for re-evaluation.

---

## 8. Frontend Pages

### 8.1 Theme Dashboard (`/`)
- **ThemeFeed**: Ranked list of all themes with HypeScores (color-coded bars)
- **HypeGauge**: Selected theme expanded with 4 signal breakdown
- **MarketCorrelation**: Time-series chart: theme mentions vs asset price overlay
- **DataSourceStatus**: Live indicator showing last refresh time and data source health

### 8.2 Trade Ideas (`/trades`)
- **LongShortTable**: Top 5 Longs and Top 5 Shorts ranked by TradeScore
- Each row: Theme, Asset(s), TradeScore, HypeScore, Direction, Entry Thesis
- Sortable by any column

### 8.3 Portfolio Builder (`/portfolio`)
- **PortfolioOverview**: $100M allocation visualization (treemap or bar chart)
- **RiskMetrics**: VaR, Sharpe, Beta, Concentration displayed as cards
- **PositionDetail**: Click any position for full risk breakdown

### 8.4 Research (`/research`)
- **Q1Analysis**: Full written + quantitative analysis of top 5 long/5 short
- Theme → Asset mapping, entry rationale, risk factors, timeframe

---

## 9. Data Access Layer

### Supabase as API

The frontend reads directly from Supabase — no custom backend API. Data is written by the daily cron script and read by the frontend via the Supabase JavaScript client.

### Supabase Tables

```sql
-- themes (current snapshot, updated daily)
themes (id, name, tier, hype_score, volume_score, sentiment_score,
        corr_score, momentum_score, source, discovered_at, updated_at)
-- tier: 'anchor' (Tier 1) | 'discovered' (Tier 2) | 'review' (Tier 3)
-- source: 'practitioner' | 'lda' | 'embedding' | 'both_agreement'

-- theme_assets (asset mapping per theme — versioned so historical re-scoring uses correct assets)
theme_assets (id, theme_id, ticker, weight, run_date, created_at)
-- weight = relative weight of this ticker within the theme (default equal weight)

-- theme_signals_history (raw signals before normalization — full history for re-scoring)
theme_signals_history (id, theme_id, run_date, mention_count_1d,
        mention_count_7d_avg, mention_count_7d_std, avg_sentiment,
        price_corr, momentum_raw, created_at)

-- trade_candidates (current snapshot)
trade_candidates (id, theme_id, asset, direction, trade_score, hype_score,
        entry_thesis, risk_factors, timeframe, updated_at)

-- portfolio_positions (current snapshot)
portfolio_positions (id, theme_id, asset, direction, notional, weight,
        hype_score, trade_score, updated_at)

-- portfolio_risk (current snapshot)
portfolio_risk (id, total_capital, var_95, cvar_95, sharpe, beta,
        concentration_hhi, updated_at)

-- portfolio_returns (daily P&L series for backtesting)
portfolio_returns (id, run_date, daily_return, cumulative_return,
        portfolio_value, created_at)

-- scoring_config (all weights and lookbacks — editable without code changes)
scoring_config (id, param_name, value, updated_at)

-- backtest_results (post-prototype validation output)
backtest_results (id, test_name, start_date, end_date, metric_name,
        predicted_value, realized_value, pass, notes, created_at)

-- research_output
research_output (id, section, content, updated_at)
```

### Frontend Data Access

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// Example query in a page
const { data: themes } = await supabase.from('themes').select('*').order('hype_score', { ascending: false })
```

---

## 10. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend Hosting | **Vercel** (auto-deploy from GitHub) |
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, Recharts |
| Database | **Supabase** (managed PostgreSQL) — reads directly from frontend via `@supabase/supabase-js` |
| Data ingestion | `yfinance`, `PRAW` (Reddit), Brave Search MCP, `pandas-datareader` |
| NLP / Sentiment | `nltk` + VADER (local, no API cost) |
| Theme discovery | `sentence-transformers` (`all-MiniLM-L6-v2`), `umap-learn`, `hdbscan`, `gensim` |
| Calculations | Pandas, NumPy |
| Cron scheduler | **cron-job.org** (free) or $3/mo VPS with `cron` |
| Future upgrade | Add FastAPI backend + Redis on VPS for real-time updates |

---

## 11. Project Structure

```
andromeda/
├── frontend/                        # Next.js — deploys to Vercel
│   ├── app/
│   │   ├── page.tsx               # Theme dashboard
│   │   ├── trades/page.tsx        # Trade ideas
│   │   ├── portfolio/page.tsx     # Portfolio builder
│   │   └── research/page.tsx     # Q1 research
│   ├── components/
│   │   ├── ThemeFeed.tsx
│   │   ├── HypeGauge.tsx
│   │   ├── MarketCorrelationChart.tsx
│   │   ├── TradeIdeasTable.tsx
│   │   ├── PortfolioTreemap.tsx
│   │   └── DataSourceStatus.tsx
│   ├── lib/
│   │   └── supabase.ts            # Supabase client for frontend reads
│   └── package.json
├── scripts/
│   ├── theme_discovery.py        # One-time/bootstrap: LDA + embedding → discover Tier 2 themes
│   └── daily_refresh.py          # Daily cron: pull data → score → write to Supabase
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # PostgreSQL schema (themes, signals, positions)
├── .env.example                   # Environment variables template (Supabase keys)
└── docs/
    └── specs/
        └── 2026-07-21-andromeda-market-theme-platform-design.md
```

---

## 12. Phasing

### Phase 1: Core MVP (3-5 days)
- Supabase project created (schema + sample data)
- Vercel frontend connected to Supabase
- Theme dashboard + Trade Ideas page + Research page (frontend only, reads static/sample data)
- Q1 research output

### Phase 2: Data Pipeline (2-3 days)
- `daily_refresh.py` script working end-to-end (sentinel-scraping + theme scoring)
- Theme discovery run at bootstrap (LDA + embedding clustering on 6-month corpus)
- Pull Brave News + Reddit via Brave Search MCP + PRAW
- Compute VADER sentiment + hype scores + trade rankings
- Write results to Supabase
- Set up cron-job.org to run script daily at market close

### Phase 3: Portfolio & Risk (2-3 days)
- Position sizing engine in `daily_refresh.py`
- Portfolio dashboard with VaR, Sharpe, Beta, HHI metrics
- All calculated in the daily batch job, stored in Supabase

### Phase 4: Real-Time Upgrade (future)
- Add FastAPI backend on VPS for interactive/real-time updates
- Add Redis for API rate-limit buffering
- Migrate cron job → APScheduler on VPS
- Frontend can optionally call API directly instead of reading cached Supabase data

### Phase 5: Q1 Reasoning Pipeline (3-5 days)
The Q1 deliverable — top 5 long + top 5 short with $100M and a fully-reasoned
writeup — is the layer the current system doesn't produce. It needs
deterministic quant features (macro, factors, regime) feeding an AI reasoning
agent that synthesizes them into a per-trade thesis. See §14 for the full
architecture.

- **M1 — L0 macro & market data ingestion.** FRED API (CPI, PCE, NFP,
  payrolls, breakevens, 2y/10y/30y, IG/HY OAS) + yfinance for VIX, DXY,
  commodities. Stored in `macro_indicators` table. Daily refresh.
- **M2 — L2 factor exposures.** Ken French Data Library (Fama-French 5
  + UMD). Per-asset factor betas (rolling 252d regression). Per-book
  aggregation. Stored in `factor_exposures` table.
- **M3 — L3 macro regime classifier.** Rule-based 2D classification:
  cycle (early/mid/late/recession) × sentiment (risk-on/risk-off). Inputs
  are yield-curve slope, credit spreads, VIX, real rates, breadth.
- **M4 — L5 AI reasoning agent.** LangGraph state machine (per user
  expertise). Pulls L0–L4 outputs + classified news → produces structured
  picks with per-trade thesis. Citation guardrail enforced.
- **M5 — L6 writeup generation + UI.** Markdown writeup per pick +
  book-level synthesis. Rendered on `/research`. Connection to Q2
  systematic engine is the differentiator.
- **M6 — End-to-end tests + live validation.** Mock-data E2E first,
  then one live run against real Supabase.

---

## 13. Infrastructure & Dependencies

### Hosting
- **Vercel**: Free tier for Next.js frontend (100GB bandwidth/mo)
- **Supabase**: Free tier — 500MB database, 1GB storage, 50k monthly users
- **Cron**: cron-job.org (free) or $3/mo VPS for `daily_refresh.py`

### API Rate Limits
- **Brave Search**: 20 req/query — the daily cron script makes one request per theme per day, well within limits
- **Reddit (PRAW)**: 60 req/min — daily batch is fine within limits, no caching needed
- **Yahoo Finance (yfinance)**: No strict limit — one batch pull per day

### Constraints
- **Free-tier APIs only** — Brave Search, Reddit, Yahoo Finance, Ken French (all free)
- **NLTK/VADER runs locally** — no sentiment API cost
- **Supabase free tier cap** — 500MB DB; if exceeded, upgrade plan or migrate to self-hosted PostgreSQL
- **Daily batch only** — data refreshes once/day at market close; not real-time
- **Architecture is swappable** — Phase 4 adds FastAPI + Redis on VPS for real-time without changing frontend

---

## 14. Q1 Reasoning Pipeline (Book Construction Layer)

> **Status: implemented.** This section describes the design; the implementation lives in `backend/services/q1_agent.py` (8-node pipeline), `backend/services/book_metrics.py`, and `backend/services/scenario_analysis.py`. The pipeline runs once per day from `scripts/daily_refresh.py` after the L1–L4 batch completes. Output: `research_recommendations` + `research_agent_runs` tables (renamed from `q1_recommendations`/`q1_agent_runs` in migration 008). Frontend render: `frontend/app/book/page.tsx` (the legacy `/research` page now redirects to `/book`).
>
> **Design rationale:** ADRs [0012](../adrs/0012-citation-guardrail-llm-defense.md), [0013](../adrs/0013-deterministic-stochastic-split.md), and [0014](../adrs/0014-candidate-set-hard-filter.md).

### 14.1 Motivation

The Q1 deliverable — "given $100M, what are your top 5 long and top 5 short, and why" — is **not** what the current theme-detection system produces. Theme detection (Layer 1) surfaces a ranked list of themes with constituent tickers. Q1 needs a *book*: a $100M long-short portfolio with per-trade thesis, per-trade catalysts, per-trade risks, and a book-level macro view that ties the 10 picks together.

The Q1 book construction needs **both** deterministic quantitative features **and** AI-synthesized narrative reasoning:

- The picks have factor tilts (momentum, growth, value, quality, size) that are measurable.
- The picks have macro dependencies (rate regime, growth regime, credit conditions) that are measurable.
- The picks have catalysts (FOMC, CPI, earnings) with specific dates.
- The synthesis of "given today's macro snapshot, today's theme rankings, today's factor exposures, and today's news, what 5 longs and 5 shorts make sense" is where the AI agent earns its keep.

A pure factor-investing approach (long value, short growth, etc.) is **not** what Q1 is asking for — Q1 is discretionary macro/thematic. A pure discretionary approach is **not** rigorous enough for a quant interview. The right framing is **systematic discretionary**: deterministic quant features provide the candidate set and the regime filter; the AI agent provides the synthesis.

### 14.2 Architecture: Six Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ L6: Writeup Generation     │  Per-trade thesis, book-level synthesis  │
│                            │  Markdown, cited, version-controlled     │
├────────────────────────────┼──────────────────────────────────────────┤
│ L5: AI Reasoning Agent     │  LangGraph state machine                 │
│    (LangGraph)             │  Input: L0-L4 outputs + classified news  │
│                            │  Output: structured top 5 L / top 5 S    │
├────────────────────────────┼──────────────────────────────────────────┤
│ L4: Risk Engine (extended) │  Existing: VaR/CVaR/Sharpe/Beta/HHI     │
│                            │  + factor-crowding risk                  │
│                            │  + regime-conditional max drawdown      │
├────────────────────────────┼──────────────────────────────────────────┤
│ L3: Macro Regime           │  Rule-based 2D classifier                │
│                            │  Cycle × sentiment                      │
│                            │  Yield curve, credit, VIX, breadth       │
├────────────────────────────┼──────────────────────────────────────────┤
│ L2: Factor Exposures       │  FF5 + UMD from Ken French               │
│                            │  Per-asset rolling-252d regression       │
│                            │  Per-book aggregation                   │
├────────────────────────────┼──────────────────────────────────────────┤
│ L1: Theme Detection        │  Existing HypeScore                      │
│    (existing)              │  + catalyst-date extraction              │
│                            │  + theme crowding score                 │
├────────────────────────────┼──────────────────────────────────────────┤
│ L0: Macro & Market Data    │  FRED: CPI/PCE/NFP, yields, IG/HY OAS   │
│    (new)                   │  yfinance: VIX, DXY, gold, oil, copper  │
│                            │  Stored in `macro_indicators`            │
└─────────────────────────────────────────────────────────────────────┘
```

**Determinism contract:** Everything from L0 through L4 is reproducible given the same data and the same code (no LLM involvement). The LLM enters at L5 only. L6 (writeup) is templated text populated by L5's structured output.

### 14.3 L0: Macro & Market Data Ingestion

**Source:** FRED API (free key) + `yfinance` for non-FRED series. Daily refresh at the same time as `daily_refresh.py`.

**Required series (starting list, expandable):**

| Series | FRED ID | Use |
|---|---|---|
| CPI YoY | `CPIAUCSL` | Inflation regime input |
| Core PCE YoY | `PCEPILFE` | Fed's preferred inflation gauge |
| Unemployment rate | `UNRATE` | Labor market / late-cycle signal |
| Nonfarm payrolls | `PAYEMS` | Same |
| 10y Treasury yield | `DGS10` | Yield curve input |
| 2y Treasury yield | `DGS2` | Yield curve input |
| 10y breakeven inflation | `T10YIE` | Real-rate decomposition |
| 5y5y forward inflation | `T5YIFR` | Same |
| IG credit OAS | `BAMLC0A0CM` | Risk-on/off signal |
| HY credit OAS | `BAMLH0A0HYM2` | Same |
| Fed funds rate | `DFF` | Policy stance |
| VIX | (yfinance `^VIX`) | Vol regime |
| VIX3M | (yfinance `^VIX3M`) | Term structure of vol |
| DXY | (yfinance `DX-Y.NYB`) | FX regime |
| Gold (GC=F), Oil (CL=F), Copper (HG=F) | yfinance | Cross-asset |
| % S&P 500 above 200d MA | (computed) | Breadth |

**Storage schema (`macro_indicators` table):**

```sql
CREATE TABLE macro_indicators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id TEXT NOT NULL,        -- e.g. 'CPIAUCSL', 'DGS10'
    run_date DATE NOT NULL,
    value REAL,
    source TEXT,                     -- 'FRED' | 'yfinance' | 'computed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(series_id, run_date)
);
```

### 14.4 L1: Theme Detection (Extended)

Existing HypeScore is kept. Two extensions:

- **Catalyst date extraction.** For each theme, scan the L1 collected news for mentions of upcoming events. Tag with `catalyst_date` and `catalyst_type` (e.g., "FOMC Mar 19 2026" or "CPI release Feb 12"). Stored in `theme_catalysts` table.
- **Theme crowding score.** For each theme, compare 7-day mention volume against its 90-day rolling average. Z-score of recent attention. High z-score = crowded = fragile entry. Stored alongside the HypeScore.

### 14.5 L2: Factor Exposures

**Source:** Ken French Data Library (free, direct CSV download). Five factors: Mkt-RF, SMB, HML, RMW, CMA. Plus UMD (momentum).

**Per-asset factor betas:** For each candidate asset (top 50 by liquidity), run a rolling 252-day regression:

```
r_asset_t = alpha + beta_MKT * MKT_t + beta_SMB * SMB_t + beta_HML * HML_t
         + beta_RMW * RMW_t + beta_CMA * CMA_t + beta_UMD * UMD_t + epsilon_t
```

Betas stored in `factor_exposures` table per (asset, run_date).

**Per-book aggregation:** Given a portfolio, the book-level factor exposure is the value-weighted sum of asset betas. This is the "factor tilt" the AI agent reasons about — e.g., "this book is +1.2 SMB (small-cap), −0.4 HML (low-value), +0.8 UMD (momentum)."

**Storage schema (`factor_exposures` table):**

```sql
CREATE TABLE factor_exposures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset TEXT NOT NULL,
    run_date DATE NOT NULL,
    beta_mkt REAL,
    beta_smb REAL,
    beta_hml REAL,
    beta_rmw REAL,
    beta_cma REAL,
    beta_umd REAL,
    r_squared REAL,                  -- goodness of fit
    lookback_days INT DEFAULT 252,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(asset, run_date, lookback_days)
);
```

### 14.6 L3: Macro Regime Classifier

**Input features** (all from L0):

| Feature | Source | Threshold logic |
|---|---|---|
| Yield curve slope (10y − 2y) | FRED DGS10, DGS2 | >0 = normal, <0 = inverted (recession signal) |
| HY credit OAS | FRED BAMLH0A0HYM2 | <350 bps = risk-on, 350-500 = neutral, >500 = risk-off |
| VIX | yfinance | <15 = complacent, 15-25 = normal, >25 = stressed |
| VIX term structure (VIX − VIX3M) | yfinance | contango = calm, backwardation = stress |
| Real rate (10y − 10y breakeven) | FRED DGS10, T10YIE | >1.5% = restrictive, <0 = accommodative |
| Breadth (% SPX > 200d MA) | computed | >60% = healthy, <40% = deteriorating |

**Output:** 2D classification:
- **Cycle:** early / mid / late / recession
- **Sentiment:** risk-on / neutral / risk-off

**Method:** Rule-based with explicit thresholds. Initial version is hand-coded; can be upgraded to a small ML classifier trained on NBER regime labels later. The classifier is **deterministic** (no LLM) — its output is auditable.

**Why this matters for Q1:** Factor returns are regime-dependent. A value-tilted book behaves differently in early-cycle (outperform) vs late-cycle (underperform). The AI agent's picks should be conditioned on the current regime — e.g., "we're late-cycle, so we're avoiding the long-duration AI capex longs and rotating to short-duration value."

### 14.7 L4: Risk Engine (Extended)

Existing (L4 in §7) is kept. Two extensions:

- **Factor crowding risk.** Variance of factor exposure across the book. If the entire book is +0.8 UMD (momentum), the book is crowded in momentum; a momentum reversal hits everything. Surface as `factor_crowding_score` per book.
- **Regime-conditional max drawdown.** For each historical regime, compute the max drawdown of the current portfolio over the past N years in that regime. Surface as `regime_conditional_mdd` (e.g., "this portfolio would have lost 18% in the 2008-style recession regime, vs 12% for SPX").

### 14.8 L5: AI Reasoning Agent  (v2.0.0 — implemented)

**Architecture:** Sequential node pipeline (8 pure-function nodes + 1 LLM call). Chosen for simplicity and auditability — the pipeline runs once daily, is purely sequential, and explicit Python functions with typed state are easier to test and reproduce than a state-machine graph. LangGraph would be over-engineered for this use case.

**State shape (`Q1State`, a TypedDict subclass persisted as a plain dict):**

```python
class Q1State(dict):
    run_date: str
    supabase_url: str
    supabase_key: str
    macro_snapshot: dict[str, dict]   # {series_id: {name, value, unit}} — L0
    theme_scores: list[dict]          # [{theme_id, name, hype_score, trade_score, avg_sentiment}] — L1
    factor_exposures: dict[str, dict] # {asset: {beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared}} — L2
    regime: dict                      # {cycle, sentiment, yield_curve_slope, hy_oas, vix_level, ...} — L3
    risk_metrics: dict[str, Any]     # {total_capital, var_95, sharpe, beta, cvar_95, concentration_hhi} — L4
    news_headlines: list[dict]       # raw L1 collected: [{text, date}]
    cfg: ScoringConfig                # weights + thresholds
    candidates: list[dict]            # screened candidates (after node 2)
    picks: list[dict]                 # final 10 picks from reason_picks
    book_view: str                    # 3-5 sentence macro view
    book_risks: list[str]             # cross-cutting risks
    citations: list[dict]              # [{text, source}] — every numeric claim
    verified: bool                    # passed citation check
    retries: int                      # re-pick attempts
    input_snapshot: dict               # frozen L0-L4 at run time (for audit)
    error: str | None
    # v2 additions (computed pre-pick, before reason_picks is called):
    book_metrics_summary: str          # value-weighted FF5+UMD tilts, net/gross exposure
    scenario_table: str                # formatted 4-scenario stress-test table
    correlation_warnings: list[str]    # high-corr pair warnings (ρ > 0.70)
    cap_violations: list[str]          # sector/geo/single-name violations in candidate book
```

**Graph nodes (9 total — v2 adds nodes 4 and 5):**

1. **`aggregate_context`** — Pure function. Pulls L0–L4 outputs from Supabase into Q1State. Also builds `input_snapshot` for the audit record. No LLM.
2. **`screen_candidates`** — Pure function. Applies hard filters to the ranked candidate set:
   - HypeScore ≥ `hype_score_threshold` (default 50)
   - `trade_score ≠ 0` (must have a directional signal)
   - Liquidity filter: equities require R² ≥ 0.10 vs theme's price signal; ETFs always pass
   - Deduplication: same `(asset, direction)` pair → keep highest HypeScore theme only
   - Caps at 30 candidates (max)
   - Output: list of `{asset, direction, theme_id, theme_name, hype_score, trade_score, avg_sentiment}`.
3. **`classify_news`** — Stub placeholder for future headline-tagging LLM call (not yet wired in the pipeline).
4. **`compute_book_metrics`** *(v2)* — Pure function. Computed over the candidate set BEFORE the LLM picks, so the agent has pre-computed factor context:
   - Value-weighted FF5 + UMD tilts per candidate (from `factor_exposures`, excluding assets with R² < 0.30)
   - Net exposure = Σ(long_weights) − Σ(short_weights), gross = Σ|weights|
   - Sector and geography aggregation via `SECTOR_MAP` / `GEO_MAP`
   - Violation detection: single-name > 20%, sector > 30%, geography > 35%
   - 252-day Pearson correlation matrix from yfinance; flags pairs with ρ > 0.70
   - Output: `book_metrics_summary`, `correlation_warnings`, `cap_violations` added to state.
5. **`run_scenario_analysis`** *(v2)* — Pure function. Runs 4 stress scenarios on the candidate book (pre-pick, so the LLM has scenario context when constructing the book):
   - S1 VIX spike: VIX > 30 → equity shock (β-based), flight-to-safety
   - S2 Rate shock: +50bps → duration assets hit hard, short-end sheltered
   - S3 USD surge: DXY +5% → EM/commodity FX hit
   - S4 Credit widening: HY OAS +150bps → spread products hit
   - Each pick gets: signed P&L estimate (direction-aware), severity classification (low/moderate/high/severe)
   - Worst scenario identified and surfaced; results sorted by severity
   - Output: `scenario_table` added to state for reference in `book_risks`.
6. **`reason_picks`** — Main LLM call (Anthropic Claude Sonnet). System prompt (`REASON_PICKS_SYSTEM`, version `v2.0.0`) contains:
   - Full macro snapshot (formatted key:value table)
   - Regime description (cycle + sentiment + key regime indicators)
   - Candidate list with hype/trade/sentiment scores
   - Book metrics summary (value-weighted tilts, sector/geo violations, correlation warnings)
   - Scenario analysis table (4 scenarios, severity, P&L estimates)
   - Instruction to avoid high-corr pairs and cap violations
   - Instruction that every numeric claim requires a citation
   - `counter_thesis` field per pick: measurable disqualifier (e.g., "FLIP if HY OAS breaks above 500bps")
   - `time_horizon` field per pick: "1-2 weeks" default
   - Output JSON schema: `{picks: [{direction, asset, theme_id, thesis, catalysts, risk, counter_thesis, time_horizon, factor_tilts}], book_view, book_risks, citations: [{text, source}]}`.
7. **`verify_citations`** — Guardrail. For each citation in LLM output, looks up the value in `macro_snapshot`. If cited value doesn't match, or a number lacks a citation → sets `verified=False`, increments `retries`, re-invokes `reason_picks` with explicit error feedback. Max 2 retries; third failure exits to `fallback_picks`.
8. **`size_positions`** — Pure function. Allocates $100M by HypeScore weight with hard cap enforcement:
   - Raw weight = `hype_score / Σ(hype_scores)` per candidate
   - Single-name cap (20%): cap dominated names, redistribute excess to uncapped names proportionally by original weight
   - Sector cap (30%): applied when sector has ≥ 3 members (avoids oscillation with 2-asset portfolios)
   - Geography cap (35%): applied when geo group has ≥ 3 members
   - Final normalization so weights sum exactly to 1.0
   - Output: each pick enriched with `notional` (dollar amount) and `weight` (fraction of book).
9. **`fallback_picks`** — Deterministic fallback. Triggered after 2 citation failures or empty picks. Produces 10 picks (5 long + 5 short) without any LLM: top 5 by HypeScore with positive trade score for longs; bottom 5 for shorts. Thesis is templated from regime and factor data. Always produces a valid output — never a blank slate.

**Citation guardrail (the most important guardrail):**

Every numeric claim in LLM output must cite a source key. The `verify_citations` node validates this. If a number is used without a citation, or the cited value doesn't match `macro_snapshot`, the output is rejected and `reason_picks` is re-invoked with explicit error feedback. Max 2 retries; then deterministic fallback. This is the primary defense against LLM hallucination of macro data.

**Reproducibility:** `temperature=0`, prompt version (`PROMPT_VERSION`) stored in `research_agent_runs`. `input_snapshot` freezes all L0–L4 inputs at run time for full reproducibility.

**LLM choice:** provider priority is **MiniMax → Anthropic Claude → Gemini** (`backend/services/q1_agent.py::_llm_complete`), selected by whichever `*_API_KEY` is set (`MINIMAX_API_KEY` > `ANTHROPIC_API_KEY` > `GEMINI_API_KEY`), overridable with `LLM_PROVIDER`. If no key is set the deterministic fallback kicks in (safe).

**Storage schema (`research_agent_runs` and `research_recommendations` tables — renamed from `q1_agent_runs`/`q1_recommendations` in migration 008):**

```sql
CREATE TABLE research_agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,
    prompt_version TEXT NOT NULL DEFAULT 'v2.0.0',
    model_id TEXT NOT NULL,
    input_snapshot JSONB,         -- frozen L0-L4 inputs at run time
    raw_output JSONB,             -- raw LLM response
    citations JSONB,             -- [{text, source}]
    verified BOOLEAN,
    retries INT,
    duration_ms INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE research_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL UNIQUE,
    picks JSONB,                  -- [{direction, asset, theme, theme_id, notional, weight,
                                    --  thesis, catalysts, risk, counter_thesis,
                                    --  time_horizon, factor_tilts}]
    book_view TEXT,                -- 3-5 sentence macro view
    book_risks JSONB,             -- list of risk strings
    book_metrics_summary TEXT,     -- v2: computed FF5+UMD tilts + violations
    scenario_table TEXT,           -- v2: 4-scenario stress table
    agent_run_id UUID REFERENCES research_agent_runs(id)
);
```

### 14.9 L6: Writeup Generation

**Per-trade output (rendered in `/research` page):**

```markdown
## Long #1: NVDA — AI Capex Picks-and-Shovels (HypeScore 78.4)

**Thesis:** Hyperscaler capex guidance has been consistently revised up through
2026; power constraints are the real bottleneck, not chip supply. NVDA is the
primary beneficiary on the chip side; the picks-and-shovels (VST, GEV, Vertiv)
extend the trade to power and cooling.

**Factor tilts:** +0.9 UMD (strong momentum), +0.6 SMB (large-cap growth),
−0.2 HML (low-dividend, expensive on book).

**Catalysts:**
- Q4 2025 capex guide (expected Jan 29, 2026) — consensus $80B hyperscaler capex
- Q1 2026 earnings (May 2026) — watch for data-center revenue growth
- Power interconnection queue disclosures (ongoing)

**Position:** 7% of book ($7M notional), part of 18% AI-power thematic cluster.

**Risk:** Hyperscaler digestion if cloud growth disappoints; would also unwind
VST/GEV (the picks-and-shovels).
```

**Book-level output:**

```markdown
## Book View — 2026-07-21

**Central scenario:** Soft-landing-with-sticky-inflation. Fed pivots dovish
in Q1 2026, growth slows but doesn't contract, AI capex stays durable,
credit conditions benign (HY OAS at 380bps, IG at 95bps).

**Net exposure:** 80% long / 20% short. Sector tilts: +18% AI-power,
+12% Europe defence, +10% EM-India, −15% SaaS, −10% China-cyclicals,
−5% commercial REITs. HHI: 980 (well-diversified).

**Factor book tilt:** +0.7 UMD, +0.4 SMB, −0.3 HML, +0.2 RMW.
Consistent with late-cycle-but-not-recession regime.

**Cross-cutting risks:**
- Concentration in AI-power complex (18% of book in 4 names)
- Crowding: theme-level HypeScore for "AI capex" is at the 95th percentile
  of its 90-day history
- Correlation risk: if Fed pivots hawkish, AI capex longs and Treasury
  shorts move together (both hurt by higher rates)
```

### 14.10 Risk Considerations

| Risk | Mitigation |
|---|---|
| LLM hallucination of macro numbers | Citation enforcement (§14.8 step 5) |
| LLM picking names not in candidate set | Hard filter: LLM output names must be subset of `candidates` |
| LLM producing same number for different runs | `temperature=0`, prompt version stored, input snapshot frozen |
| Missing data (FRED series delayed) | Pipeline runs on stale-but-recent data, declares it in writeup |
| LLM API downtime | Deterministic fallback (§14.8) |
| Factor regression instability (low R²) | Filter assets with R² < 0.3 from factor-based scoring |
| Regime classifier wrong | Rule-based + auditable; can be inspected post-hoc |
| Data leak (Q1 picks based on future info) | All inputs are timestamped; agent run logs input snapshot |

### 14.11 Why this is not just "factor investing"

A common confusion: "doesn't Q1 just become a quant screen if you compute factor exposures?" The answer is no, for three reasons:

1. **The picks in the example are not factor-driven.** "European defence primes" and "India domestic capex" are not pure factor tilts — they're macro/thematic bets that happen to have a factor profile. The factor exposures are a *descriptor* of the pick, not the *generator*.
2. **The AI agent reasons, it doesn't optimize.** It weighs crowding, regime fit, catalyst timing, and the narrative coherence of the book. A pure quant screen picks by score; the AI agent picks by *fit*.
3. **The thesis is the deliverable.** Q1 asks "what are your top 5 long and short, and why?" The "why" is the writeup. Factor exposures are inputs to the writeup, not the writeup itself.

A more accurate framing: **the deterministic layers (L0-L4) provide the candidate set and the constraint set; the AI agent (L5) provides the synthesis; the writeup (L6) is the deliverable.** It's a deterministic-and-stochastic pipeline where the deterministic parts are auditable and the stochastic part is constrained.

### 14.12 Connection to Q2 (the existing system)

Q2 = theme detection + systematic trade generation. Q1 = the reasoning pipeline above. They form a loop:

```
Q2 (theme detection) ──► ranked themes with HypeScore
                          │
                          ▼
Q1 (reasoning pipeline) ──► top 5 L / top 5 S with thesis
                          │
                          ▼
discretionary execution ──► trades hit the market
                          │
                          ▼
positions accumulate ──► L4 risk metrics evolve
                          │
                          ▼
theme attention shifts ──► L1 HypeScores update
                          │
                          └────────► back to Q2
```

The Q2 system is the **systematic engine** (always-on, daily). The Q1 reasoning pipeline is the **deliberate judgment** (produced on demand, weekly or daily). Both are needed. The thesis the AI agent produces is more credible because it's grounded in the deterministic features (factors, regime, theme scores) — the recruiter can see exactly *why* the pick was made.

### 14.13 Open design questions (flagged for review)

- **Which LLM?** Claude Sonnet is the working assumption; OpenAI o3 and Gemini 2.5 Pro are alternatives. The agent is LLM-agnostic (just function calls + JSON output).
- **What if the regime classifier says recession but the LLM disagrees?** The LLM should defer to the regime classifier (deterministic, auditable) and explain its reasoning. Or the LLM can override with explicit "despite recession classification" framing. Not yet decided.
- **How often does Q1 run?** Default: daily after the daily batch. But a weekly "deeper think" run (with longer context, more news) is also worth considering. Phase 5 ships daily-only.
- **How do we validate the picks?** Spec §7.3's post-prototype validation framework applies: did top-ranked theme outperform bottom-ranked over the next 5/10/20 trading days? Backtest on synthetic L0 data before any live deployment.
- **Where does the recommendations table fit in the schema?** New table (shipped as `research_recommendations`, originally `q1_recommendations`; renamed in migration 008).

