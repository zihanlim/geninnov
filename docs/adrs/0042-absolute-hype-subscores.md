# 0042 — HypeScore sub-scores are absolute, not relative to the day's peer group

- **Status:** accepted
- **Date:** 2026-07-24
- **Supersedes:** [ADR-0006](0006-minmax-over-zscore-hypescore.md) (min-max
  normalisation), [ADR-0028](0028-minmax-correlation-consistency.md) (min-max |corr|)

## Context

Q2 asks for a process that *"quantifies how much attention, or 'hype', each theme is
attracting, so that the output can support both idea generation **and risk
monitoring**."*

Risk monitoring means tracking a theme's attention over time. HypeScore could not do
that, because three of its four sub-scores were min-max normalised **across the
day's themes**: a theme's score was a statement about its peer group, not about
itself.

Measured on production data across two consecutive run dates:

| theme | 7d mentions | HypeScore |
|---|---|---|
| China Growth | 1.14286 → **1.14286** (identical) | 60.6 → **36.6** |
| Corporate Credit | 0.857143 → **0.857143** (identical) | 45.7 → **34.2** |

Two themes whose attention volume did not change at all moved 24 and 11 points.
Some of that reflects genuine movement in their correlation and momentum inputs —
Corporate Credit's `price_corr` flipped +0.202 → −0.264 — but min-max amplified it,
because every score is measured against the day's extremes and those extremes moved
wholesale (`price_corr` range [−0.186, +0.304] → [−0.375, +0.174]).

**ADR-0006 contradicts itself on precisely this point.** It lists as a *positive*
that scores are "comparable across run dates without re-referencing historical
distributions", then states as a *negative* that "a theme can score 100 today and 30
tomorrow without changing its absolute signal". Both cannot be true; the negative is
the accurate one.

Its rejection of z-scores was also aimed at the wrong target. The objection — "a 0.4
correlation z-scores high one day and low the next purely because other themes'
correlations moved" — is an argument against **cross-sectional** normalisation of any
kind, which is exactly what min-max is. It never considered scoring each signal
against its own fixed scale.

There is a second consequence for idea generation. Min-max guarantees a theme at 1.0
and a theme at 0.0 in every sub-score, so the composite spans a similar range every
day and the `hype ≥ 50` gate admits a similar count whether or not anything is
genuinely trending. A gate that adapts to the pack is not a gate.

## Decision

Each sub-score is computed from **that theme's own signal against a documented
anchor**:

| sub-score | mapping | anchor |
|---|---|---|
| Volume | `tanh(m7 / 3.0)` | 3 mentions/day = a busy theme |
| Sentiment | `(compound + 1) / 2` | unchanged — VADER is already absolute |
| Correlation | `min(1, \|corr\| / 0.50)` | \|corr\| ≥ 0.50 earns full credit |
| Momentum | `(tanh(z / 2.0) + 1) / 2` | robust-momentum z; 0.5 at no change |

`robust_momentum` was already self-referenced — it compares a theme to its own
history via median/MAD. Only its final squash was cross-sectional.

ADR-0028's complaint was real: a raw `|corr|` of 0.1–0.4 under-delivered against a
30% weight. That was a **calibration** problem and min-max was the wrong remedy —
it fixed the scale by making the reading relative. Dividing by a documented
full-credit level fixes the calibration and keeps the number comparable.

## Consequences

**A theme's score now moves only when that theme's signal moves, and in proportion.**
On the two cases above:

| theme | min-max | absolute |
|---|---|---|
| China Growth | 60.6 → 36.6 (−24.0) | 56.5 → 49.0 (−7.5) |
| Corporate Credit | 45.7 → 34.2 (−11.5) | 47.1 → 44.9 (−2.2) |

The residual movement is the genuine decline in each theme's own correlation. The
volume sub-score is now *identical* across the two days for both, which is the
correct reading of an identical mention count and was impossible before.

**The 50 threshold becomes a real level.** It now means "this theme is genuinely
attracting attention" rather than "this theme is in the upper half of today's eight".
Expect the number of themes clearing it to vary day to day — that variation is
signal, and its absence was the defect.

**Scores are no longer forced to span 0–100.** A quiet day can leave every theme in
the 20s. That is the honest output and should not be re-normalised away.

**Cross-sectional ranking is unaffected.** Absolute scores rank perfectly well, so
idea generation keeps everything it had and risk monitoring gains what it lacked.

**The anchors are judgement calls and are documented as such.** 3 mentions/day,
|corr| 0.50 and a momentum scale of 2.0 are stated constants, not fitted values —
the same status the min-max design gave its implicit choices, but now visible. They
are the right thing for the HypeScore IC study to calibrate, and that study is
already flagged as NOT YET VALIDATED on `/method`.
