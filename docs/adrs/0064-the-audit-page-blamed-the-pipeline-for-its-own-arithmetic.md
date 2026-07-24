# ADR-0064 — The audit page blamed the pipeline for its own arithmetic

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0036](0036-carry-as-excess-yield-over-funding.md), [0031](0031-edge-score-direction-signal.md), [0032](0032-edge-carry-value-abstention-sizing.md), [0063](0063-one-beta-bar-across-every-surface.md)

## Context

`/method` is the Q2 surface. Its whole purpose is to show that every published number
is reproducible from the published formula against live data. It carried a red panel:

> **RECONCILIATION FAILURE** — Applying the live weights to the persisted components
> yields **+0.1700**, but `theme_signals_history.edge_score` holds **+0.3542**. *Either
> the weights changed after this row was written, or a component column and the score
> column were not written from the same inputs.*

**Both stated causes are false, and the accusation points the wrong way.** The worked
example above it printed:

```
w_trend  × Trend     = 0.20 × 0.7932 = 0.158646
w_regime × Regime    = 0.23 × 0.0365 = 0.008392
w_carry  × Carry     = 0.34 × null   = 0.000000   (null → 0)
w_value  × Value     = 0.18 × null   = 0.000000   (null → 0)
w_sent   × Sentiment = 0.05 × 0.0592 = 0.002961
                                       ─────────
                                       0.169999
```

and `0.169999 / (0.20 + 0.23 + 0.05) = 0.354165` — **the persisted value, exactly.**

[ADR-0036](0036-carry-as-excess-yield-over-funding.md) established that a component
which is `null` — *not computable for this theme* — is **dropped and its weight
renormalised over the components that are present**. `compute_edge_score` does exactly
that: `Σ(w·v over present) / Σ(w over present)`. Scoring a missing component as 0 is
not neutral; it shrinks |EdgeScore| toward the abstention band, penalising a theme for
a gap in our data rather than judging it on the market's signal.

**The backend was changed; the page never was.** It kept summing `w × (v ?? 0)`, kept
printing `(null → 0)`, and when the answer disagreed with the pipeline it published a
data-integrity accusation against the pipeline.

**The same root cause fires on `/book`.** `EdgeBars` sums `edgeContributions`, which
applies the identical `?? 0`, and warns when the total differs from the persisted score
by more than 0.01. Every position whose theme lacks a carry or value proxy therefore
raised the same false alarm inside its expanded derivation.

This is the sharpest form of the failure this project keeps finding. Not a wrong number
in isolation: **an auditing surface whose own arithmetic was wrong, presenting its error
as the audited system's error.** A reviewer checking the arithmetic would conclude the
pipeline is unreliable, and the reasoning that led them there would be the page's.

## Decision

**One renormalisation, in one function, used by every surface that recomputes an
EdgeScore.**

`recomputeEdgeScore(edge, weights)` returns `{ weightedSum, weightPresent, edgeScore }`,
implementing ADR-0036: drop null components, divide by the weight actually present, and
return `0` when nothing is computable (which abstains, matching `edge_signals.py`'s
`if total_w <= 0`).

- **It returns the parts, not just the total.** `/method` must *show* the division —
  a worked example that prints only the answer proves nothing. The block now prints
  `Σ weighted (present)`, `Σ weight (present)` and the quotient, and a dropped
  component renders `— (dropped, weight redistributed)` instead of `0.000000 (null → 0)`.
- **The explanatory note is corrected**, because it asserted the rule the code got
  wrong: it said a null component *"contributes exactly 0 — an honest absence, not a
  zero tilt"*, which is a contradiction in terms and the opposite of ADR-0036.
- **`edgeContributions` is deliberately left as-is.** It applies `?? 0` and that is
  correct for what it does: rank which component *dominates*, where a null component
  should never win. Only the surfaces that **reconcile against a persisted score** were
  wrong, and only those now call the new function.

## Consequences

- **The RECONCILIATION FAILURE panel keeps its trigger and its wording.** It is now
  reachable only by a genuine mismatch, and its two stated causes — changed weights, or
  components and score written from different inputs — are the real remaining
  explanations. Removing the panel would have been the wrong fix; it was doing its job,
  fed a wrong number.
- **`/book`'s per-position derivation stops accusing itself** on every theme without a
  carry or value proxy, which on the live book is most of them.
- **The general rule, and it is the third instance today:** a display surface that
  recomputes a persisted quantity must recompute it *the way the pipeline does*, not the
  way the formula reads in prose. [ADR-0063](0063-one-beta-bar-across-every-surface.md)
  was a panel that never saw a sample size; this is a panel that never saw a
  renormalisation. Both drifted because the rule lived in the backend and the surface
  reimplemented it.
- **Worth stating plainly:** this defect made the platform look *less* trustworthy than
  it is. Every previous finding here corrected a page that was too flattering; this one
  corrects a page that was unfairly damning. The discipline is the same — make the page
  say what is true — and the direction of the error is not the point.
