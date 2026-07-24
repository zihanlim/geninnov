# 0044 — The carry IC that justifies its 0.34 weight was measured on a superseded signal

- **Status:** accepted
- **Date:** 2026-07-24
- **Corrects:** [ADR-0033](0033-edge-stage5-sentiment-ic-weights.md) — the empirical
  claim, not the method.
- **Caused by:** [ADR-0036](0036-carry-as-excess-yield-over-funding.md) — which
  redefined carry without re-running the IC that set its weight.

## Context

ADR-0033 gave `edge_carry_weight` the largest share of EdgeScore — **0.34 of 1.00**,
above trend (0.20), regime (0.23) and value (0.18) — on this evidence:

> **Carry is the strongest, statistically significant component** … p=0.007 is
> significant

and `hype_calculator.py` still carries the comment *"carry earned a strong significant
IC, trend a weak one."*

ADR-0036 then redefined carry. It went from the raw LEVEL of a spread,
`tanh(HY_OAS / 4.0)`, to **excess yield over funding**, `tanh(((10y + OAS) − DFF) / 3)`
— a different signal, for good reasons set out in that ADR. **The IC was never
re-run.** The weight kept its justification; the thing being weighted changed
underneath it.

Re-running `scripts/backtest_edge.py` against the current definition, on the same
panel and the same 94 observations:

| component | N | IC | t | p | hit | significant |
|---|---|---|---|---|---|---|
| Trend | 975 | +0.0332 | +1.04 | 0.300 | 54.9% | no |
| **Carry** | **94** | **+0.1275** | **+1.23** | **0.221** | 55.3% | **no** |
| Value | 94 | +0.0939 | +0.90 | 0.368 | 51.1% | no |
| Regime | 0 | — | — | — | — | not testable |
| Sentiment | 0 | — | — | — | — | not testable |

Same N, p = 0.221 rather than 0.007. Carry is still the strongest of the three and
still points the right way — but on the signal actually in production, **no component
of EdgeScore clears conventional significance.**

The script also had to be repaired before it would run at all: ADR-0036 made
`carry_signal`/`value_signal` return `None` where L0 cannot support them, and the
harness still assumed floats, so it died on `abs(None)`. It had been broken since
that commit and nobody noticed, because nothing runs it. Worse, it was passing
`carry_signal` only the sleeve's own series — the new carry needs `DGS10` and `DFF`
as well — so it would have measured a signal the production path never computes.
Testing on inputs production never sees is worse than not testing, because the number
looks like evidence.

## Decision

**1. Correct the claim. Do not re-fit the weights.**

The honest reading of five insignificant ICs is that this sample cannot distinguish
the components' predictive power. Re-weighting on p=0.22 evidence would be fitting
noise — precisely what ADR-0033's own 50% shrinkage exists to prevent, and the script
prints its suggested weights as a *proposal to review*, not a migration to apply. The
weights stay where they are, now labelled as **priors informed by a weak positive
signal**, not as a fitted result.

**2. Publish the numbers, including the parts that look bad.**

`backtest_edge.py` now persists every component's IC, N, t, p, hit rate and horizon to
`backtest_results` under `test_name = 'edge_ic'`, with a boolean `pass` recording
whether it cleared p < 0.05. On 2026-07-24 that is `false` for all five. The script
previously only printed, which is why the site had never said anything about whether
the signal deciding the trades predicts anything.

## Consequences

**EdgeScore is now honestly characterised as unvalidated**, alongside HypeScore. Both
`/method` panels should read the same way: measured, positive, not significant. That
is a weaker claim than the codebase was making and a truer one.

**The 0.34 carry weight is now explicitly a prior.** A reviewer asking "why is carry
your biggest weight?" gets: it was the strongest measured component under the previous
definition and remains the strongest under the current one, but at N=94 and p=0.22 we
cannot claim significance, and we have not re-fitted on that basis.

**The real fix is more data, not a different formula.** N=94 for carry is two macro
sleeves at month-ends over six years. Nothing about the estimator improves that; only
a longer panel or more sleeves will.

**A general lesson worth stating: changing a signal invalidates the evidence that set
its weight.** ADR-0036 was correct on its merits and left a stale justification
standing for eight iterations. Any future change to a scored component should re-run
`backtest_edge.py` in the same change, and the script now being persisted and rendered
makes that omission visible rather than silent.
