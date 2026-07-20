# Andromeda: Market Theme Identification & Systematic Trade Generation Platform

**Date**: 2026-07-21
**Status**: Draft for Review

---

## 1. Concept & Vision

Andromeda is a systematic investment research platform that identifies trending market themes (Q2) and generates quantitatively-ranked trade ideas (Q1) using a layered scoring pipeline. The platform bridges qualitative theme detection with quantitative portfolio construction — themes become signals, signals become ranked long/short candidates, candidates get risk-sized into a $100M portfolio.

**Feel**: A Bloomberg Terminal meets a modern data dashboard — dense with information but visually clear, built for speed during market hours.

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

### 4.4 Theme Taxonomy (v1)

```
THEMES = [
  "AI Capex",           # AI infrastructure spending
  "Fed Pivot",          # Central bank rate cuts
  "Dollar Debasement",  # USD weakness / commodity inflation
  "China Stimulus",     # PBOC easing
  "EV Slowdown",        # EV demand concerns
  "Energy Transition",  # Clean energy capex
  "Healthcare Reform",  # Policy-driven healthcare
  "Real Estate Stress", # Commercial RE distress
  "Mag 7 Fatigue",      # Concentration risk in large caps
  "Value Revival",     # Value factor rotation
]
```

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
- **Top 5 Longs**: 5 highest TradeScore values where direction = long, HypeScore ≥ threshold
- **Top 5 Shorts**: 5 lowest TradeScore values where direction = short, HypeScore ≥ threshold
- **HypeScore threshold**: Default 50, stored in `scoring_config` (editable without code changes)

### 6.3 Asset Mapping

Each theme maps to a set of tradeable instruments:

```
THEME_ASSET_MAP = {
    "AI Capex":        ["NVDA", "MSFT", "AIQ", "SMCI", "XSD"],
    "Fed Pivot":       ["TLT", "GLD", "SVXY", "DGZ"],
    "Dollar Debasement": ["GLD", "SLV", "UUP", "FXE"],
    "China Stimulus":  ["FXI", "MCHI", "BABA", "KWEB"],
    "EV Slowdown":     ["TSLA", "RIVN", "LCID", "XLE"],
    "Energy Transition": ["ICLN", "FAN", "QCLN", "ENPH"],
    "Healthcare Reform": ["UNH", "CVS", "XLV", "IHF"],
    "Real Estate Stress": ["XLRE", "VNQ", "IYR", "REM"],
    "Mag 7 Fatigue":   ["QQQ", "SPXL", "SOXX", "ARKK"],
    "Value Revival":   ["VTV", "RFV", "IWD", "SPYV"],
}
```

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
themes (id, name, hype_score, volume_score, sentiment_score,
        corr_score, momentum_score, updated_at)

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
│   └── daily_refresh.py           # Daily cron script: pull data → score → write to Supabase
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
- `daily_refresh.py` script working end-to-end
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
