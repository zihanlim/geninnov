# EdgeScore — a rigorous long/short direction signal (5-stage design)

- Status: complete (Stages 1–5 implemented — ADR-0031/0032/0033)
- Date: 2026-07-23
- Related: ADR-0028 (min-max corr), ADR-0029 (two-sided book), ADR-0030 (L5 uses L1 pool),
  ADR-0022 (HypeScore IC backtest)

## 1. The problem

Today the book's **direction** (long vs short, per theme) is decided by

```
TradeScore = 0.55 · HypeMomentum + 0.45 · Sentiment      →  direction = sign(TradeScore)
```

and because `HypeMomentum ≈ 0` in practice (no prior-day `hype_score` until the
daily job accrues history), **direction collapses to the sign of VADER news
sentiment.** That is not a rigorous basis for a $100M book:

1. **News sentiment is a weak, often *contrarian* direction signal.** Approving
   coverage does not imply the asset rises; frequently the move already happened
   (buy-the-rumor / crowding). A −0.004 VADER score deciding a $20M short is a
   decision *below the noise floor of the measurement*.
2. **The system conflates three distinct questions.** It uses **attention**
   (HypeScore) for the universe *and* for sizing, and **sentiment** for
   direction. A rigorous process keeps them separate.
3. **No expected-return anchor.** Nothing connects "high attention / positive
   tone" to "positive expected forward return." This is the core critique from
   the original design review.

## 2. Design principle — separate Attention, Direction, Conviction

| Question | Signal | Current | Target |
|---|---|---|---|
| What's worth looking at? (universe) | **Attention** = HypeScore | ✅ (keep) | keep — this is the genuine Q2 contribution |
| Which way does it go? (direction) | **Edge** = expected-return proxy | ❌ sentiment sign | **EdgeScore** (this doc) |
| How much to bet? (sizing) | **Conviction × risk** | ❌ ∝ HypeScore | conviction (signal agreement) × inverse-vol |

**HypeScore stays the attention/universe signal.** Direction moves to a new
**EdgeScore** anchored to measurable expected-return proxies a quant PM would
recognize. Sizing moves off popularity onto conviction×risk (Stage 4).

## 3. How real quant PMs decide direction

Direction is always anchored to a measurable edge with an economic rationale:

- **Systematic macro / CTA** — trend + carry + value + macro-momentum across
  asset classes; risk-parity sized.
- **Discretionary macro** — a regime view (growth / inflation / policy) mapped to
  asset sensitivities; long duration + defensives when growth slows, etc.
- **Quant equity L/S** — cross-sectional factor ranks (value / quality / momentum
  / revisions); long top-quintile, short bottom, sector-neutral.
- **Relative value** — long cheap-vs-fair-value, short rich; sized to the gap.

Common denominator: **direction = sign of an edge score**, never "how much it's
in the news." Andromeda already computes most of the raw ingredients (L0 macro,
L2 factor betas incl. UMD, L3 regime, price history) and simply doesn't use them
for direction. EdgeScore fixes that.

## 4. The EdgeScore framework

```
EdgeScore(theme) = Σ_k  w_k · s_k(theme)                       s_k ∈ [−1, +1]
direction        = long  if EdgeScore ≥ +τ
                   short if EdgeScore ≤ −τ
                   ABSTAIN otherwise (|EdgeScore| < τ  or  signals disagree)
```

Every component `s_k` is bounded to `[−1, +1]` (via z-score→tanh or a sign map)
so the weights `w_k` are comparable and interpretable. Weights and `τ` live in
`scoring_config` (editable without code — project rule), never hardcoded.

### The five components (stages)

| # | Component `s_k` | Source | What it measures | Sign convention |
|---|---|---|---|---|
| **1** | **Trend** | price history (yfinance) | time-series momentum of the theme basket | long if trending up |
| **2** | **RegimeFit** | L3 regime + L0 | does the theme's asset class benefit in the current cycle×sentiment regime | long if regime-favored |
| 3 | **Carry** | L0 (FRED) | yield/spread pickup for rates/credit/FX themes | long positive carry |
| 4 | **Value** | L0 + price history | asset vs its own history (spread / real-yield / valuation z-score) | long cheap |
| 5 | **Sentiment tilt** | L1 VADER (demoted) | catalyst / crowding — a *minor* tilt, optionally contrarian at extremes | small weight |

The current `Sentiment` is not deleted — it is **demoted** from *the* direction
signal to one small, possibly-contrarian tilt among five (Stage 5).

## 5. Stage detail

### Stage 1 — Trend (implemented)
- For each theme, fetch daily closes for its tradable assets over a trend window
  (default **126 trading days ≈ 6 months**), compute the trailing return per asset
  `r_a = P_t / P_{t−L} − 1`, average across the theme's assets, and squash:
  `TrendSignal = tanh(mean(r_a) / scale)` (scale default 0.15) → `[−1, +1]`.
- Long uptrends, short downtrends. This is a validated risk premium (time-series
  momentum), unlike news sentiment. It also *replaces* the dead HypeMomentum term
  as the primary magnitude driver of direction.

### Stage 2 — RegimeFit (implemented)
- Each asset class has a **risk-on beta** `β_ac ∈ {−1, 0, +1}`: does it rise in
  risk-on? `equity:+1, credit:+1, rates:−1, fx(USD):−1, commodity:0 (ambiguous —
  Stage 3/4 disambiguates gold vs energy)`.
- The regime supplies a **sentiment sign** `σ`: `risk-on:+1, neutral:0,
  risk-off:−1`, and a **cycle tilt** `γ_ac` (late-cycle / recession add a
  defensive lean: `−0.5` to risk assets, `+0.5` to havens; early/mid the reverse,
  smaller).
- `RegimeFit(asset) = clip(β_ac · σ + γ_ac, −1, +1)`; theme-level = mean over the
  theme's assets. So: risk-off ⇒ long rates/USD, short equity/HY; risk-on ⇒ the
  reverse. This is the single biggest "make it make sense" win — it connects the
  regime we already classify (L3) to the side we take.

### Stage 3 — Carry (planned)
- Rates: curve carry (roll-down + yield). Credit: OAS pickup vs funding. FX:
  rate differential (USD-funded). `CarrySignal = z-score of carry across the
  eligible set → tanh`. Long positive carry.

### Stage 4 — Value + abstention + conviction sizing (planned)
- **Value**: asset vs its own history — HY OAS z-score vs trailing 2y, real-yield
  vs neutral, index earnings-yield vs history. Long cheap, short rich.
- **Abstention**: take a position only if `|EdgeScore| ≥ τ` **and** the components
  agree in sign (≥ K of the active components share the EdgeScore's sign).
  Otherwise **no position** — a rigorous book abstains on conflicting/weak signal
  rather than forcing a side from noise.
- **Sizing**: replace HypeScore-weighting with **conviction × inverse-vol**:
  `weight ∝ agreement(theme) / σ_theme`, then apply the existing sector/geo/
  single-name caps. Popularity stops driving position size.

### Stage 5 — Sentiment demotion + validation (planned)
- Fold the VADER sentiment back in as a **small** tilt (`w_sent` small) or a
  **contrarian** term at extremes (crowding fade). It becomes a catalyst/timing
  input, not the driver.
- **Validation is the arbiter (ADR-0022 spine).** IC-test each component's
  forward-return predictiveness (1d / 5d / 21d) via `scripts/backtest_hype.py`,
  and set each `w_k` from *realized* IC, not assertion. Trend (Stage 1) is
  backtestable now on price history; RegimeFit and the rest accrue significance as
  the daily job runs. Report N and significance honestly; a null result is a
  finding, not a failure.

## 6. Schema & config

- **Migration 023** adds to `theme_signals_history`: `edge_score`,
  `trend_signal`, `regime_bias` (component provenance for `/method` and the
  derivation drawer). Nullable, backfilled going forward.
- **`scoring_config`** gains `edge_trend_weight` (default 0.6),
  `edge_regime_weight` (default 0.4), `edge_abstain_threshold` (default 0.0 for
  Stages 1–2 — no abstention until Stage 4). All read via `ScoringConfig.from_db_rows`
  with `.get()` defaults so an un-migrated DB still loads.

## 7. Wiring into the pipeline

- `backend/services/edge_signals.py` (new): `theme_trend`, `regime_direction_bias`,
  `theme_regime_bias`, `compute_edge_score`, `edge_direction`.
- `scripts/daily_refresh.py`: after HypeScore/TradeScore, compute `edge_score` per
  theme (fetch a 6-month price window once; reuse the regime already classified in
  L3), attach to the scored dict, and persist the components.
- `rank_trade_candidates` gains a `score_key` param (default `"trade_score"` for
  back-compat); `daily_refresh` passes `score_key="edge_score"` so **direction and
  intra-side ranking use EdgeScore**. `TradeCandidate` carries `edge_score` for
  provenance. The ADR-0029 two-sided backfill and ADR-0030 L1→L5 unification are
  unchanged — EdgeScore simply replaces the number whose sign they act on.
- L5 inherits automatically (ADR-0030): the candidate pool it screens already
  carries edge-based direction; the LLM continues to *select + explain + size*,
  now over economically-anchored sides.

## 8. Rollout

- **Now (this change):** Stages 1 + 2 — Trend + RegimeFit — behind `scoring_config`
  weights, direction switched to `sign(EdgeScore)`, Stage-1 IC-checked on price
  history. Sentiment weight retained inside TradeScore but no longer *decides*
  direction.
- **Next:** Stage 3 (carry), Stage 4 (value + abstention + conviction sizing),
  Stage 5 (sentiment demotion + full IC-weighted composite).

## 9. Risks / open questions

- **Thin history.** RegimeFit and the composite can't be IC-validated until the
  daily job accrues weeks of data; Stage 1 (trend) can be validated now on prices.
  Interim weights are priors, flagged as such.
- **Theme→asset-class heterogeneity.** A theme spanning multiple asset classes has
  a blended RegimeFit; if the blend is near zero the abstention rule (Stage 4)
  should catch it rather than forcing a side.
- **Trend/Value tension.** Trend and Value can disagree (a cheap asset still
  falling). That is expected and healthy — Stage 4 abstention encodes "don't trade
  a conflicted signal," which is exactly the rigor that's missing today.
