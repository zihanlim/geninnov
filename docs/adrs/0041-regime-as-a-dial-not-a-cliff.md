# 0041 — The regime is a dial, not a cliff

- **Status:** accepted
- **Date:** 2026-07-24
- **Amends:** [ADR-0031](0031-edge-score-direction-signal.md) — RegimeFit keeps its
  role and its weight; only its input changes from a label to a continuous score.

## Context

Two pipeline runs hours apart on **the same calendar day** produced opposite books:

| run | book | net |
|---|---|---|
| earlier | 4 long / 2 short | **+26.7%** |
| later | 2 long / 3 short | **−20.0%** |

Same day, same universe, same thresholds. Three themes flipped sign — Corporate
Credit +0.244 → −0.407, US Election +0.342 → −0.166, US Dollar +0.144 → −0.199 —
and the entire equity complex inverted.

The cause was one input. `regime_classifications` for the day moved from
`late / risk-on` to `late / neutral`, and `regime_direction_bias` reads that label
through `_SENTIMENT_SIGN = {risk-on: +1, neutral: 0, risk-off: -1}`, multiplied by
the asset class's risk beta:

```
risk-on  equity bias = β·(+1) + (−0.5β)  = +0.5β
neutral  equity bias = β·( 0) + (−0.5β)  = −0.5β
```

A full **1.0·β swing** on a component carrying **0.23** of EdgeScore. That is more
than enough to flip a position, and it flipped most of them at once.

Worse is *why* the label moved. With VIX at 18.6 (failing the `< 15` and `< 18`
rules) and HY OAS at 268bp (failing `< 250`), the only rule that could return
"risk-on" was:

```python
if breadth is not None and breadth > 60:
    return "risk-on"
```

**So $100M of positioning hung on one breadth statistic crossing a single integer.**
Breadth 61 and breadth 59 are not different market states, and no defensible process
inverts a book between them.

## Decision

**Keep the discrete label for display. Use a continuous score for direction.**

`regime_classifier.risk_appetite(vix, hy_oas, vix_term_diff, breadth)` returns a
value in [−1, +1]. Each input contributes a smooth `tanh` term centred on its own
neutral level, and the available terms are averaged:

| input | neutral | scale |
|---|---|---|
| VIX | 19 | 6 |
| HY OAS | 350bp | 150 |
| VIX term structure | 0 | 4 |
| SPX breadth | 50% | 15 |

`regime_direction_bias` and `theme_regime_bias` take an optional `appetite` and use
it in place of the label sign. With no appetite available they fall back to the label
and behave exactly as before, so nothing else has to change at once.

The cycle tilt (late/recession defensive, early/mid cyclical) is untouched — it is a
genuinely slow-moving classification, not a noisy one.

## Consequences

**The cliff is gone and the ordering is kept.** At today's levels the appetite is
**+0.392** (mildly risk-on, which is the fair reading of VIX 18.6 with credit at the
tights). Across the breadth threshold that broke the book:

| breadth | old label → sigma | new appetite |
|---|---|---|
| 61 | risk-on → **+1.0** | **+0.402** |
| 59 | neutral → **0.0** | **+0.380** |

A 0.022 move instead of a 1.0 inversion. Genuine regimes still separate cleanly —
a stressed tape (VIX 32, HY 620, backwardation, breadth 25) scores **−0.94** and a
calm one (VIX 12, HY 240, contango, breadth 72) scores **+0.80**.

**The label is now strictly a summary.** `/` still shows "LATE · RISK-ON" and the
regime-inputs panel still shows the thresholds that produced it, which remains the
right way to *describe* the tape. It is simply no longer the dial that sets $100M of
direction. Worth remembering when reading the two together: the label can say
"neutral" while the appetite is mildly positive, and that is not a contradiction —
one is a bucket, the other is a position within it.

**This does not make the book fully stable, and should not be claimed to.** It
removes the largest and most arbitrary source of run-to-run inversion. Prices, news
counts and the HypeScore min-max normalisation (ADR-0006, known to be
outlier-dominated and not comparable day to day) still churn between runs. The next
thing to measure is how much of the remaining variation is real and how much is
normalisation artefact.

**A production caveat that makes this less alarming than it sounds:** the scheduled
job runs once daily at 21:30 UTC, after the US close, so intraday re-runs are a
development artefact. But "only unstable if you run it twice" is not a defence — a
reviewer refreshing the page would have seen the book invert, and the mechanism was
real regardless of how often it fires.
