# ADR-0028 — Min-max |corr| across themes (supersedes T22 raw-abs)

- Status: accepted
- Date: 2026-07-23
- Tags: analytics, signal-design
- Supersedes: the T22 "raw abs(corr)" change to `hype_score`

## Context

`hype_score` combines four sub-scores. `volume` and `momentum` arrive **min-max
normalized across themes** (per ADR-0006), but `corr` was fed a **raw `abs()`**
(the T22 change) and `sentiment` a fixed `rescale_vader`. A raw `|corr|` on a
noisy 5–7-day mention/return window is small (~0.1–0.4), so the **30% corr
weight structurally under-delivered** — it added a near-constant to every theme
and compressed the distribution *below* the 50 threshold, a likely cause of the
"no qualifying candidates" outcome. This also contradicted ADR-0006, whose
decision was to min-max **each** sub-component across themes.

## Decision

- **Min-max `abs(corr)` across themes** in `compute_hype_scores`, consistent with
  volume/momentum (via the same `minmax_norm`). Keep the `abs()` fold —
  attention is direction-agnostic.
- **Keep `sentiment` as an absolute `rescale_vader`** — do NOT min-max it. Its
  **sign carries meaning** (a theme at +0.6 is genuinely bullish); ranking would
  score the least-bearish theme 1.0 even in a broadly bearish tape.
- **Principle:** magnitude / relevance signals (volume, momentum, `|corr|`) are
  **relative** → cross-theme min-max; sentiment is a **direction** signal →
  absolute. `persist()` stores the SAME min-max `corr_score` so display = score.

## Consequences

### Positive
- Consistent normalization; the corr weight can claim its full share; the score
  distribution widens and top themes clear 50 again (a discriminating threshold).

### Negative / caveat (honest)
- **Degenerate fallback:** when a magnitude signal has no cross-theme variance
  (all identical — e.g. every theme `|corr| = 0`), `minmax_norm` returns its 0.5
  neutral fallback → a flat contribution to every theme. It is *consistent*
  (score = display, not a phantom) but non-discriminating.
- **Degeneracy root cause (found + fixed):** on first inspection `corr` was
  degenerate (all 0), and min-max cleared themes only via the 0.5 neutral. That
  turned out to be a **date-type alignment bug**, not sparse data:
  `correlation_with_mentions` intersected an ISO-string mention index with a
  `datetime.date` price index — always empty → correlation returned 0 for
  *every* theme since day one (30% of HypeScore was dead). Fixed by coercing both
  indices to `datetime.date`. Correlation is now a **live, varying** signal
  (e.g. China Growth +0.39, Inflation −0.35) that genuinely discriminates —
  China Growth now leads at ~82 on real corr, not the neutral lift. Supporting
  density changes (Brave `count` 20→50, correlation window 7→30 days) help the
  series have spread. `momentum` can still be degenerate on a genuinely flat
  7-day window (that's honest). **IC validation** of the weights + threshold
  (ADR-0022) remains the eventual arbiter.

## Alternatives considered

- **Raw-abs + lower the threshold.** Keeps corr absolute while volume/momentum
  stay relative — a conceptual hybrid, and the threshold becomes a formula-tuned
  magic number treating the symptom, not the cause.
- **Document only.** Leaves a trade-generation engine emitting "no positions"
  from a normalization artifact rather than genuine market quiet.

## Links
- ADR-0006 (min-max over z-score), ADR-0022 (IC backtest), `backend/services/
  hype_calculator.py` (`compute_hype_scores`), `scripts/daily_refresh.py` (`persist`)
