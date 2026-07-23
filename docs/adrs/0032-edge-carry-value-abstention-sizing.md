# ADR-0032 — EdgeScore Stages 3–4: Carry, Value, abstention, conviction sizing

- Status: accepted
- Date: 2026-07-23
- Tags: signal-design, trade-generation, risk, analytics
- Related: ADR-0031 (EdgeScore Stages 1–2), spec
  `docs/superpowers/specs/2026-07-23-edge-score-direction-redesign.md`

## Context

ADR-0031 anchored direction to `EdgeScore = 0.6·Trend + 0.4·RegimeFit`. Two rigour
gaps remained, both flagged in discussion:

1. **No fundamentals / relative-value.** Direction leaned on price trend + a
   prior-based regime; a quant PM also weighs *carry* (am I paid to hold this?)
   and *value* (cheap vs its own history?).
2. **No right to abstain, and popularity-based sizing.** Every theme was *forced*
   long or short by `sign(EdgeScore)`, even at |edge| ≈ 0.03 (US Dollar) where the
   signal is flat; and sizing was still ∝ HypeScore (popularity), not conviction
   or risk.

## Decision

Extend EdgeScore to four components and add abstention + conviction sizing.

```
EdgeScore = w_trend·Trend + w_regime·RegimeFit + w_carry·Carry + w_value·Value
weights (scoring_config, migration 024): 0.35 / 0.25 / 0.20 / 0.20
```

- **Stage 3 — Carry** (`carry_signal`): "am I paid to hold this?" from L0 macro
  LEVELS. credit = HY OAS (spread income); rates = 10y real yield; fx = USD short
  rate; equity/commodity = 0. High yield/spread → long bias.
- **Stage 4 — Value** (`value_signal`): cheap vs its OWN history = long, via
  **z-scores of L0 levels** against `macro_daily_history`. credit = +z(HY OAS)
  (wide = cheap = long); rates = +z(real yield). equity/fx/commodity = 0.
- **Stage 4 — Abstention** (`rank_trade_candidates(abstain_threshold=…)`): a theme
  enters a side only if `|EdgeScore| ≥ edge_abstain_threshold` (0.15). A weak or
  self-conflicting signal produces **no position** rather than a forced one; a
  side (or the book) can legitimately be smaller.
- **Stage 4 — Conviction sizing** (`allocate_portfolio(size_by="conviction")`):
  weight ∝ `conviction = |EdgeScore| / vol` (conviction × inverse-vol), not ∝
  HypeScore. Falls back to hype weighting if no conviction is present. The
  sector/geo/single-name caps are unchanged.

Provenance (`carry_signal`, `value_signal`, `conviction`) is persisted on
`theme_signals_history` (migration 024). HypeScore remains the attention/universe
signal; sizing no longer follows popularity.

## Consequences

### Positive
- **Multi-signal, and it abstains.** On the validation snapshot (regime late /
  risk-on), 4 themes carried conviction and **4 abstained**. Corporate Credit is
  the exemplar: **carry +0.59 (paid the spread) vs value −0.75 (tight vs history =
  rich)** conflict → net edge weak → *abstain*, exactly how a relative-value desk
  reasons. US Dollar, formerly forced short on sentiment, now abstains.
- **Fundamentals are in.** Carry + value use the L0 macro that was already
  computed; credit/rates themes now reflect income and mean-reversion, not just
  trend.
- **Sizing follows conviction and risk**, not attention — a low-hype,
  high-conviction theme can outsize a popular, low-conviction one (regression-tested
  with caps relaxed).

### Negative / caveat (honest)
- **Carry uses fixed reference levels** (`HY OAS/4%`, `real/2%`, `USD−1%`) — magic
  numbers. Stage 5 replaces them with historical / cross-sectional normalization.
- **Value covers only credit + rates** — L0 has no equity/fx valuation, so those
  contribute 0. Honest, but partial.
- **RegimeFit and the composite are still not IC-validated** (short history); only
  Stage-1 Trend is (weak +0.03 IC, ADR-0031). The 0.35/0.25/0.20/0.20 weights are
  priors, to be IC-fit in Stage 5.
- **Abstention can shrink the book.** A quiet, conflicted tape yields fewer
  positions — correct behaviour, but it means the two-sided guarantee (ADR-0029)
  now only fires among themes that clear the abstention band.

## Alternatives considered

- **Signal-agreement count instead of a magnitude threshold for abstention.**
  Cleaner in theory (require K of N components to agree), but the weighted
  magnitude already encodes agreement (conflicting components net to ~0). Deferred
  to Stage 5 alongside IC-weighting.
- **Keep hype sizing, add only carry/value to direction.** Leaves sizing on
  popularity — the review's specific critique. Rejected.

## Links
- `backend/services/edge_signals.py` (`carry_signal`, `value_signal`,
  `compute_edge_score`), `backend/services/trade_ranker.py`
  (`rank_trade_candidates` abstain, `allocate_portfolio` `size_by`),
  `scripts/daily_refresh.py` (`compute_edge_scores`, `_macro_zscores`),
  migration `024_edge_carry_value.sql`, ADR-0031, spec.
