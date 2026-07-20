# ADR-0006 — Min-max normalization over z-scores for HypeScore

- Status: accepted
- Date: 2026-07-21
- Tags: data, analytics

## Context

The HypeScore is a weighted composite of four sub-scores: volume, sentiment, market correlation, and momentum. Each must be normalized to [0, 1] before weighting. The original instinct was to z-score normalize each sub-score, but Pearson correlation is bounded [-1, +1], making z-scoring inappropriate.

## Decision

Min-max normalize each HypeScore sub-component independently across all themes on each run date. Do not use z-score normalization.

## Consequences

### Positive
- Correlation values (bounded [-1, +1]) are not distorted by cross-theme z-scoring
- Scores are interpretable as 0–100 throughout
- Comparable across run dates without re-referencing historical distributions

### Negative
- Scores are relative to the current day's theme universe — a theme can score 100 today and 30 tomorrow without changing its absolute signal

### Neutral
- All raw signals are stored before normalization so scores can be recomputed retroactively

## Alternatives considered

### Z-score normalization
What it was: Normalize each sub-score by (value − mean) / std across all themes.
Why we ruled it out: Pearson correlation is bounded [-1, +1]. A 0.4 correlation z-scores high one day and low the next purely because other themes' correlations moved — not because this theme's signal changed. Min-max preserves the signal's natural scale.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §4.6
