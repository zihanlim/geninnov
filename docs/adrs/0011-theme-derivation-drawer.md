# ADR-0011 — Theme Derivation Drawer (raw signals → normalized → weighted → final)

- Status: accepted
- Date: 2026-07-21
- Tags: ux, frontend, transparency

## Context

The platform's headline number is the HypeScore — a 0–100 score for each theme, computed from four sub-scores (Volume, Sentiment, Correlation, Momentum). The score is the basis for theme ranking, trade direction, and position sizing.

But the HypeScore is a single number, and the user cannot see how it was derived. The pipeline that produces it has 4 steps:
1. Raw signals from `theme_signals_history` (mention count, VADER compound, ρ, z-score)
2. Min-max normalization across all themes on the run date
3. Weighted sum with weights from `scoring_config` (default: 0.30/0.20/0.30/0.20)
4. Scaled to 0–100 and rounded

Each of these steps is deterministic and auditable. But none of it is visible in the UI. The user sees "HypeScore 78.4" and has to take the number on faith.

This matters for the Q2 deliverable specifically: the test asks the reviewer to evaluate the **systematic theme detection framework**, not just its outputs. Without derivation visibility, the framework looks like a black box that produces numbers. With derivation visibility, it looks like a rigorous, auditable system.

The same problem applies to:
- TradeScore (hype_momentum × weight + sentiment × weight)
- Regime classification (6 inputs → cycle × sentiment)
- Position sizing (HypeScore weighting + cap enforcement)
- Factor exposure (rolling 252d regression of returns on FF5 + UMD)

## Decision

Build a `<ThemeDerivationDrawer>` component — a slide-in panel from the right side of the screen — that opens when the user clicks any theme card or trade row. The drawer renders the full derivation chain with the same data the backend pipeline used.

### Drawer content structure

```
[Theme Name] · HypeScore 78.4  ·  ▲ +6.2 wow   [×]
Run: 2026-07-21  ·  14 sources  ·  Updated 2h ago

┌─ Why is this trending? ───────────────────────────┐
│ Top 3 catalysts (last 7 days):                     │
│  · Powell Jackson Hole preview (87 news)  +0.71   │
│  · June FOMC minutes dovish tilt (43 Reddit) +0.58│
│  · Fed funds futures: 92% Sept cut (CME)          │
└────────────────────────────────────────────────────┘

┌─ Score math ───────────────────────────────────────┐
│                                                       │
│ 1. VOLUME SUB-SCORE         weight: 0.30             │
│    Raw: 142 mentions today                            │
│    7d avg: 98.2 ± 18.4                                │
│    z = (142 - 98.2) / 18.4 = +2.38                    │
│    Normalized across 12 themes: 0.78                  │
│    Contribution: 0.78 × 0.30 = 23.4 pts               │
│                                                       │
│ 2. SENTIMENT SUB-SCORE      weight: 0.20             │
│    Raw: VADER compound = +0.64                        │
│    Rescaled to [0, 1]: 0.82                           │
│    Contribution: 0.82 × 0.20 = 16.4 pts               │
│                                                       │
│ 3. CORRELATION SUB-SCORE    weight: 0.30             │
│    Raw: ρ(mentions, SPX ret 7d) = 0.71                │
│    Normalized: 0.82                                    │
│    Contribution: 0.82 × 0.30 = 24.6 pts               │
│                                                       │
│ 4. MOMENTUM SUB-SCORE       weight: 0.20             │
│    Raw: z = +2.38 (already in volume)                 │
│    Normalized: 0.91                                    │
│    Contribution: 0.91 × 0.20 = 18.2 pts               │
│                                                       │
│ TOTAL: 23.4 + 16.4 + 24.6 + 18.2 = 82.6               │
│ Rounded: 78.4                                         │
└──────────────────────────────────────────────────────┘

┌─ Assumptions ───────────────────────────────────────┐
│ · Weights: scoring_config (w_vol=0.30, w_sent=0.20,  │
│   w_corr=0.30, w_mom=0.20)                           │
│ · Normalization: min-max across 12 themes            │
│   on 2026-07-21                                       │
│ · Source: theme_signals_history row 421              │
└──────────────────────────────────────────────────────┘

Sources: [Brave News 87] [Reddit 43] [yfinance 12] [FRED 3]
```

### Data sources

The drawer pulls from:
- `theme_signals_history` — raw signal values (mention_count_1d, mention_count_7d_avg, mention_count_7d_std, avg_sentiment, price_corr, momentum_raw)
- `themes` — normalized sub-scores (volume_score, sentiment_score, corr_score, momentum_score) and final hype_score
- `scoring_config` — weights and lookback windows
- `theme_assets` — asset mapping rationale (for the trade-level drawer)
- `q1_recommendations` — pick-level thesis and citations

### Implementation

```
frontend/components/
├── ThemeDerivationDrawer.tsx  ← main component, slide-in panel
├── DrawerSection.tsx          ← reusable section (Score math, Assumptions, etc.)
├── ScoreBar.tsx              ← compact bar for sub-score rendering
├── CitationList.tsx           ← inline citation rendering (per ADR-0010)
└── RegimeInputsPanel.tsx      ← expandable regime classification details
```

The drawer is triggered by clicking a `ConvictionCard` or a `TradeIdeasTable` row. URL query param `?derive=<theme_id>` deep-links to the drawer for shareable audit URLs.

## Consequences

### Positive
- Every HypeScore, TradeScore, regime classification is auditable from the UI
- The Q2 framework review becomes "here's exactly how every number was computed" instead of "trust the algorithm"
- The drawer doubles as documentation — clicking through 3-4 themes teaches the user the framework
- URL deep-links (`?derive=<id>`) make the audit trail shareable

### Negative
- Adds 2-3 components to the frontend bundle (~5KB)
- Requires the L0-L1 schema to expose all raw signals (already in `theme_signals_history`)
- The math is dense; some readers will find it overwhelming → mitigated by progressive disclosure (the panel collapses by default; the score is still visible without opening)

### Neutral
- The drawer doesn't write to the database — pure read-only UI
- The drawer works for any theme, regardless of tier (anchor / discovered / review)

## Alternatives considered

### Tooltip on hover
What it was: hover over the HypeScore → small popup with the breakdown.
Why we rejected: too cramped for the full math; doesn't support the "Why is this trending?" section; breaks on mobile.

### Separate `/research/<theme_id>` page
What it was: a dedicated page per theme with the full derivation.
Why we rejected: breaks the scanning flow; forces a navigation. The drawer keeps the user in the table view and lets them audit multiple themes without losing context.

### Inline expandable card
What it was: the card itself expands to show the derivation.
Why we rejected: makes the card layout unpredictable; breaks the comparison view (top 3 themes side-by-side). The drawer keeps the cards at fixed size and shows detail on demand.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §4.6, §5.2, §14
- Related: [ADR-0009](0009-research-first-design-philosophy.md), [ADR-0010](0010-citation-footnotes-everywhere.md)
- Data sources: `theme_signals_history` table, `scoring_config` table
