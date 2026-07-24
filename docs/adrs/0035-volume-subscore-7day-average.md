# ADR-0035 — HypeScore Volume = 7-day average mentions, not the 1-day count

- Status: accepted
- Date: 2026-07-24
- Tags: signal-design, hype-score, data-robustness
- Related: ADR-0006 (HypeScore formula), ADR-0028 (min-max the corr term),
  ADR-0021 (robust momentum), `backend/services/hype_calculator.py`

## Context

HypeScore's Volume term was the cross-sectional min-max of each theme's
**1-day mention count** (`mention_count_1d`) across the theme universe on the run
date (`hype_calculator.compute_hype_scores` and the mirrored display path in
`daily_refresh.persist`).

On production this term was **degenerate**: `mention_count_1d` was `0` for *every*
theme on many runs. The cause is upstream — news is collected with the article's
own publish timestamp, and a run frequently finds no article dated that exact
calendar day (`mention_count_1d = len(todays_news) + len(todays_posts)` where
`todays_*` filters to `date == today`). When every input to `minmax_norm` is
equal, it returns its documented 0.5 neutral fallback, so **the Volume sub-score
was a flat 50 for all eight themes** — visible on the `/` heatmap as an entire
column of identical 50s, which correctly reads to a PM as "this signal is broken".

Meanwhile the 7-day average (`mention_count_7d_avg`) was already computed, stored,
and genuinely varied across themes (e.g. ~5.6/day vs ~0.4/day) — real
cross-sectional spread that the scorer was throwing away.

## Decision

Compute the Volume magnitude from the **trailing 7-day average daily mentions**,
via a shared `volume_base(row)` helper:

```python
def volume_base(r):
    avg = r.get("mention_count_7d_avg")
    return float(avg) if avg is not None else float(r.get("mention_count_1d", 0) or 0)
```

Both the score path (`compute_hype_scores`) and the persisted display path
(`persist`) call `volume_base`, preserving the invariant that the four persisted
sub-scores reproduce `hype_score` exactly. The fallback to `mention_count_1d`
keeps behaviour unchanged wherever the average is absent (old tests, bootstrap).

This makes the two mention-driven terms a clean **level / change** split:

- **Volume** = the theme's *sustained attention level* (7-day average), min-max'd
  across themes → "which themes are loudest this week".
- **Momentum** = today's *deviation from* that level (`robust_momentum` of the
  1-day count vs its 7-day window) → "which themes are getting unusually loud now".

The old design used the 1-day count for Volume, conflating level and recency into
one term that was usually zero.

## Consequences

- The heatmap Volume column carries real signal again; HypeScore rankings reflect
  sustained attention instead of a flat constant plus noise.
- No formula/weight change — `hype_volume_weight` (0.30) is untouched; only the
  quantity it multiplies changed. The `scoring_config` weights are unaffected.
- `/method` Volume definition updated to describe the 7-day window; the worked
  example still reconciles because both score and display use `volume_base`.
- Does **not** fix the upstream 0-same-day-mentions data issue — that is a
  collection concern (Brave/Reddit date coverage). This ADR makes the *score*
  robust to it; a separate improvement could widen the same-day match window.
- New tests in `test_hype_calculator.py::TestVolumeBase` lock in the behaviour,
  including the exact all-zero-1d / varied-7d production case.

## Alternatives considered

- **Blend 1-day and 7-day** (e.g. `max(1d, 7d_avg)` or a weighted mix). Rejected:
  the 1-day term is structurally ~0, so any blend is dominated by the 7-day part
  anyway, at the cost of a muddier definition.
- **Fix only the display, not the score.** Rejected: it would break the
  reproduce-the-score invariant and leave the actual HypeScore ranking degenerate.
- **Widen the same-day window upstream** (count articles from the last N days as
  "today"). A real option, but it changes what `mention_count_1d` *means* for
  momentum too; deferred as a separate collection-layer decision.
