# ADR-0031 — EdgeScore: anchor long/short direction to trend + regime, not sentiment

- Status: accepted
- Date: 2026-07-23
- Tags: signal-design, trade-generation, analytics
- Related: ADR-0029 (two-sided book), ADR-0030 (L5 uses L1 pool), ADR-0022 (IC backtest),
  spec `docs/superpowers/specs/2026-07-23-edge-score-direction-redesign.md`

## Context

Direction (long vs short, per theme) was `sign(TradeScore)` where
`TradeScore = 0.55·HypeMomentum + 0.45·Sentiment`. With `HypeMomentum ≈ 0` in
practice, **direction collapsed to the sign of VADER news sentiment** — a weak,
noisy, sometimes-contrarian signal. Deciding a $20M short on a −0.004 sentiment
score is a decision below the measurement's noise floor. Nothing connected
"positive tone" to "positive expected forward return." This is the original
review's core critique — *HypeScore measures what's trending, not what's
mispriced* — surfacing at the direction step.

The pipeline already computes the raw material for a real direction signal and
throws it away: L0 macro, L2 factor betas (incl. UMD), L3 regime, and price
history. A quant PM anchors direction to a measurable edge (trend, carry, value,
regime-fit, factor rank), never to news tone.

## Decision

Introduce **EdgeScore** as the direction signal, computed in
`backend/services/edge_signals.py`, and switch `rank_trade_candidates` to
`score_key="edge_score"` so **direction and intra-side ranking use it**. This is
Stages 1–2 of the 5-stage design in the spec; Carry / Value / Sentiment-demotion
(3–5) follow.

```
EdgeScore = edge_trend_weight · Trend + edge_regime_weight · RegimeFit     (each ∈ [-1,1])
direction = sign(EdgeScore)
```

- **Stage 1 — Trend**: the theme basket's ~6-month price momentum, `tanh`-squashed.
  A validated time-series-momentum premium (unlike news sentiment), and it
  replaces the dead `HypeMomentum` as the magnitude driver.
- **Stage 2 — RegimeFit**: `risk_beta(asset_class) · sentiment_sign + cycle_tilt`
  from the L3 regime — risk-off ⇒ long rates/USD, short equity/HY; late-cycle adds
  a defensive lean. This connects the regime we already classify to the side we take.

Weights and the (currently 0) abstention band live in `scoring_config`
(migration 023), not code. Component provenance (`edge_score`, `trend_signal`,
`regime_bias`) is persisted on `theme_signals_history`. HypeScore is unchanged and
remains the **attention / universe** signal; `TradeScore` is retained but no
longer decides direction. The ADR-0029 two-sided backfill and ADR-0030 L1→L5
unification are unchanged — EdgeScore is simply the number whose sign they act on.

## Validation (honest)

`scripts/backtest_edge.py` IC-tests the **Trend** component on 6 years of a
15-ETF panel, month-end sampled (N=975):

| metric | value |
|---|---|
| rank IC | **+0.033** |
| t-stat | +1.04 |
| p-value | 0.30 |
| hit rate | 54.9% |

**The trend edge is positive but weak and not statistically significant** at a
monthly horizon on this panel. We wire it in anyway because: (1) it is *still
far better grounded* than a noise-level sentiment sign — directionally correct
(IC > 0, hit rate > 50%) with an economic rationale, vs. an unvalidated
fourth-decimal VADER score; (2) the composite adds RegimeFit, whose value the
review agreed accrues live; (3) the honest next step is to **IC-fit the weights**
(Stage 5) rather than assert 0.6/0.4, and to Winsorize / vol-scale the trend
input. A weak-but-positive, *measured* signal that we can improve beats a
plausible-sounding one we never tested.

## Consequences

### Positive
- Direction has an economic anchor (trend + regime) a PM would recognise, with a
  reproducible IC number attached — not a coin-flip on sentiment noise.
- Sentiment is demoted from *the* driver to (for now) a retained-but-unused term,
  to be reintroduced as a small/contrarian tilt in Stage 5.
- No new data feed — L0/L2/L3/prices were already computed.

### Negative / caveat
- **The trend edge is weak (IC +0.03, p=0.30).** Interim weights (0.6/0.4) are
  priors, not IC-fit; flagged as such. Stages 3–5 (carry, value, abstention,
  IC-weighting) are needed for a genuinely strong signal.
- **RegimeFit is not yet IC-validated** — regime history is too short. It rests on
  economic priors until the daily job accrues data.
- **Commodity RegimeFit is 0** (gold-haven vs energy-cyclical ambiguity); Stage 3
  carry/value disambiguates.

## Alternatives considered

- **Keep sentiment as direction, lower the noise via smoothing.** Still an
  attention/tone signal, not an expected-return one; smoothing noise ≠ adding edge.
- **Wait for Stages 3–5 before shipping any of it.** Leaves direction on sentiment
  indefinitely; shipping Trend+Regime now, IC-checked and honestly caveated, is
  strictly better and unblocks live accrual of the regime/composite data.

## Links
- `backend/services/edge_signals.py`, `scripts/daily_refresh.py`
  (`compute_edge_scores`), `backend/services/trade_ranker.py`
  (`rank_trade_candidates` `score_key`), `scripts/backtest_edge.py`,
  migration `023_edge_score.sql`, spec `2026-07-23-edge-score-direction-redesign.md`.
