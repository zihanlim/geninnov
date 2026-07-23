# ADR-0033 — EdgeScore Stage 5: sentiment demotion + IC-fit weights

- Status: accepted
- Date: 2026-07-24
- Tags: signal-design, validation, trade-generation
- Related: ADR-0031/0032 (EdgeScore Stages 1–4), ADR-0022 (IC backtest spine),
  spec `docs/superpowers/specs/2026-07-23-edge-score-direction-redesign.md`

## Context

EdgeScore had four components (Trend, RegimeFit, Carry, Value) with **asserted**
weights (0.35 / 0.25 / 0.20 / 0.20) and news sentiment fully removed from
direction. Two Stage-5 items remained:

1. **Sentiment demotion.** Sentiment was once *the* direction signal (wrongly — a
   near-zero VADER score decided a $100M side). The spec's endpoint is to fold it
   back as a *small, contrarian* tilt (crowding fade), not delete it.
2. **IC-fit the weights.** The 0.35/0.25/0.20/0.20 split was a prior, never tested.
   ADR-0022's spine says set each weight from *realized* information coefficient.

## Decision

**1. Sentiment as a 5th, contrarian, minor component.** `sentiment_signal =
-tanh(avg_sentiment / 0.4)` — extreme optimism is crowding to *fade* (short bias),
not a buy; near-zero sentiment contributes ~0. It carries a small weight.

**2. Weights set from a multi-component IC backtest** (`scripts/backtest_edge.py`),
which computes each component's rank IC vs forward 1-month returns on data-rich
history, then **shrinks the result 50% toward the priors** so weak/thin IC cannot
overfit.

### The IC result (honest)

| component | N | rank IC | t | p | hit |
|---|---:|---:|---:|---:|---:|
| **Carry** | 94 | **+0.277** | **+2.77** | **0.007** | **60.6%** |
| Value | 94 | +0.094 | +0.90 | 0.368 | 51.1% |
| Trend | 975 | +0.033 | +1.04 | 0.300 | 54.8% |
| RegimeFit | — | not testable yet (thin per-theme history) | | | |
| Sentiment | — | not testable yet | | | |

**Carry is the strongest, statistically significant component** (HY OAS level → HY
credit, real yield → duration — a documented risk premium). **Trend is weak** — the
signal the earlier stages leaned on hardest earns the least. Value is modest.
RegimeFit and the contrarian Sentiment tilt cannot be IC-tested yet (the per-theme
regime/sentiment history is only now accruing) and keep priors.

### The weights (shrunk 50% toward priors, migration 026)

| weight | was | now | why |
|---|---:|---:|---|
| `edge_trend_weight` | 0.35 | **0.20** | weak IC |
| `edge_regime_weight` | 0.25 | 0.23 | prior (untested) |
| `edge_carry_weight` | 0.20 | **0.34** | strong significant IC |
| `edge_value_weight` | 0.20 | 0.18 | modest IC |
| `edge_sentiment_weight` | — | 0.05 | new minor contrarian tilt |

Weights live in `scoring_config` (editable without code) and are read live
everywhere (backend + `/method` + the derivation drawer).

## Consequences

### Positive
- **The weights are now earned, not asserted.** The data overturned a prior:
  carry, not trend, is the workhorse. This is exactly the value of the IC spine.
- **Sentiment is safely re-included** — small and contrarian, so extreme optimism
  is a fade, not the coin-flip direction driver it wrongly was.
- **Reproducible.** Re-running `backtest_edge.py` refines the weights as history
  accrues; `/method` reconciles all five persisted components to `edge_score`.

### Negative / caveat (honest)
- **Carry's N is modest (94).** p=0.007 is significant, but it is two macro sleeves
  (credit + rates) over ~4 years; the effect is a known risk premium, not a
  fitted anomaly, which is why it's trusted — but it is not a large sample.
- **RegimeFit and Sentiment weights are priors**, not IC-fit — flagged. They
  become testable as the daily job accrues per-theme regime/sentiment history.
- **Shrinkage α = 0.5 is a judgement call.** With thin/weak IC, halving toward the
  prior is deliberately conservative; a longer track record would justify moving α up.

## Alternatives considered

- **Full IC weighting (α = 1).** Overfits on 94 obs — carry would swamp the book.
  Shrinkage is the disciplined choice on thin data.
- **Keep sentiment out entirely.** Simpler, but the spec's endpoint is a *demoted*
  sentiment (contrarian crowding signal), which carries genuine information at
  extremes; a 0.05 weight includes it without letting it drive.

## Links
- `backend/services/edge_signals.py` (`sentiment_signal`, 5-arg `compute_edge_score`),
  `scripts/backtest_edge.py` (multi-component IC + shrinkage), migration
  `026_edge_stage5_sentiment_ic_weights.sql`, `scripts/daily_refresh.py`
  (`compute_edge_scores`), `frontend/lib/themeSignals.ts` (5-component
  `edgeContributions`), ADR-0031, ADR-0032, ADR-0022.
