# ADR-0029 — Two-sided book: decouple direction from the hype gate + revive momentum

- Status: accepted
- Date: 2026-07-23
- Tags: analytics, signal-design, trade-generation
- Supersedes: the spec §6.2 "eligible ∩ sign" long/short ranking rule

## Context

A production run produced a **100% net-short book with zero longs**. Tracing it
to the per-theme numbers showed two independent failures compounding:

1. **The long/short split intersected two orthogonal gates.** `rank_trade_candidates`
   built `long_pool = {hype ≥ threshold} ∩ {trade_score > 0}`. On that day only
   two themes cleared `hype ≥ 50` (China Growth 90, US Dollar 71.8) and **both**
   had a (barely) negative `trade_score`, so both went short. Every
   positive-`trade_score` theme (Corporate Credit +0.040, US Election +0.039, Fed
   Policy +0.031, Inflation +0.021) — i.e. every *would-be long* — sat **below**
   the hype gate and was never considered. The intersection was empty:
   `long_pool = ∅`. The hype gate selects for *attention*; the direction rule
   selects for *sentiment sign*; nothing couples them, so a day where the loudest
   themes happen to share one sign yields a one-sided book.

2. **Half of `trade_score` was dead.** `trade_score = 0.55·hype_momentum +
   0.45·sentiment`, but `hype_momentum = 0` for **every** theme, so direction was
   decided 100% by the sign of a near-zero `avg_sentiment` (China Growth shorted
   on −0.004 — neutral to four decimals). Root cause: `compute_trade_scores`
   looked for a prior snapshot dated **exactly** `run_date − 1 day`. With an
   irregular run cadence (weekends, missed runs, several runs in one day) no row
   is dated exactly D-1, so `hype_yesterday` was empty and momentum collapsed to
   0. Compounding it, older `theme_signals_history` rows carried a **NULL**
   `hype_score`, so even the most-recent prior had nothing to compare against.

## Decision

**1. Decouple direction from the hype gate; guarantee a two-sided book
(`rank_trade_candidates`).** The gate now sets *priority*, not whether a side can
*exist*. Hype-eligible themes fill each side first (ordered by `trade_score`, up
to `top_n`). If a side is still short of `min_side` (default 1), it is backfilled
from the strongest **sub-threshold** themes of that direction. A side stays empty
**only** when no theme of that sign exists anywhere — the guarantee never
fabricates a direction the signal doesn't support. Because backfilled themes carry
a low `HypeScore`, the hype-weighted sizing in `allocate_portfolio` gives them
small positions: the guarantee adds a position without pretending it has high
conviction.

**2. Revive momentum (`compute_trade_scores`).** Use the **most-recent prior**
snapshot per theme (one round-trip, `.lt(run_date).order(desc)`), and for momentum
the most-recent prior row that actually carries a **non-null** `hype_score` — not
a row dated exactly D-1. Momentum stays 0 for a theme only when *no* prior run has
ever persisted a `hype_score`; it self-heals once the daily job writes one (which
`persist()` does). The same lookup feeds `elapsed_days`.

## Consequences

### Positive
- The book is two-sided whenever opposite-sign signal exists — the "0 long
  candidates" pathology cannot recur silently.
- The 0.55-weighted momentum term contributes again as soon as a prior
  `hype_score` exists, so direction stops being decided by fourth-decimal
  sentiment noise. Under a daily cadence this is the steady state.
- Backfilled low-attention picks are sized small by construction (hype-weighting),
  so the two-sided guarantee doesn't inject large low-conviction risk.

### Negative / caveat (honest)
- **Backfill trades a sub-threshold theme.** Satisfying `min_side` can pull in a
  low-attention theme (e.g. Corporate Credit at hype 39) purely because it has the
  best opposite-sign `trade_score`. That is a deliberate trade-off: a small,
  genuinely two-sided book over a large one-sided one. The L5 agent can still
  decline or down-weight it.
- **`min_side = 1` is a floor, not balance.** A day can still be 1-long-vs-5-short.
  Forcing symmetry (exactly 5+5) was rejected because it fabricates conviction the
  signal doesn't have (see Alternatives).
- **Momentum revival is forward-looking.** On the day of the fix the only prior
  rows had NULL `hype_score`, so momentum is still 0 *that* run; it comes alive on
  the next run once today's persisted `hype_score` becomes the baseline. IC
  validation (ADR-0022) remains the eventual arbiter of whether momentum earns its
  weight.

## Alternatives considered

- **Rank purely by `trade_score` across all themes, drop the hype gate.** Cleanest
  "decoupling", but discards the attention signal entirely — undermining the Q2
  "hype matters" story and letting a high-`trade_score`, zero-attention theme
  dominate. The backfill keeps hype as the primary ordering and relaxes it only to
  guarantee two-sidedness.
- **Lower the hype threshold.** Treats the symptom with a formula-tuned magic
  number; the intersection can still be empty on a one-signed day.
- **Force exactly `top_n` long and `top_n` short.** Meets task.md's "5 long + 5
  short" literally, but fabricates longs/shorts from themes with no directional
  signal — worse than an honestly thin side.

## Links
- ADR-0022 (IC backtest — the arbiter of the weights/threshold), ADR-0028 (min-max
  correlation), `backend/services/trade_ranker.py` (`rank_trade_candidates`),
  `scripts/daily_refresh.py` (`compute_trade_scores`),
  spec §6.2 (long/short ranking).
