# 0036 — Carry is excess yield over funding, and a missing component is not a zero

- **Status:** accepted
- **Date:** 2026-07-24
- **Supersedes (in part):** [0032](0032-edge-carry-value-abstention-sizing.md) — the
  Stage-3 carry mapping and the treatment of unavailable components.

## Context

The book could not produce a single short position. Successive attempts treated this
as a breadth problem — more tickers per theme (24 → 37), then more themes — on the
reasoning that positions on a side = (themes selected) × (that theme's tickers), so
a side with no theme cannot be populated. Ticker breadth was completed and shorts
stayed at zero, which said the constraint was upstream of the universe.

It was in the signal. `carry_signal` scored the raw LEVEL of a yield or spread
against a fixed scale:

```python
credit: tanh(HY_OAS / 4.0)        # HY OAS 2.68 -> +0.585
rates:  tanh(real_yield / 2.0)    # DFII10 2.39 -> +0.832
fx:     tanh((DFF - 1.0) / 3.0)   # DFF   3.63 -> +0.705
equity, commodity: 0.0            # hardcoded
```

A credit spread is a positive number by construction, so the credit term could
**never** be negative. Neither could the rates or FX terms at any level seen in the
data. Carry carries the largest of the five EdgeScore weights (0.34), so it was not
a signal at all — it was a standing long offset of roughly +0.20 to +0.28 on every
credit, rates and FX theme. With a third of the score pinned long, a theme needed
the remaining two-thirds strongly negative just to reach neutral, and |Edge| ≤ −0.15
was effectively unreachable.

It also gave the wrong answer on its own terms. With HY OAS at 268bp, near the
tights of its available history, it read +0.585 — "well paid to hold credit" — when
the honest reading is that credit risk is thinly compensated. A reviewer asking "why
are you long credit at the tights?" would have been told "because carry is positive."

Two further consequences of the same design:

- **Equity and commodity carry were hardcoded to 0.0.** Combined with `value_signal`,
  which also returned 0.0 outside credit and rates, an equity theme had 0.34 + 0.18 =
  0.52 of its weight pinned at zero. Its |EdgeScore| could not exceed 0.48 however
  strong its trend and regime were, while a credit theme could reach 1.0 — and both
  were then judged against the same 0.15 abstention band, as if commensurate.
- **The entire live book rested on the overstatement.** On 2026-07-24 all four
  positions were Fed Policy, whose carry read +0.71 from the level of the real yield.
  The term premium a duration position actually earns is 10y less funding: +104bp.

## Decision

**1. Carry is excess yield over funding — the textbook definition, and two-sided.**

```
credit:  tanh(((10y UST + HY OAS) − overnight funding) / 3.0)
rates:   tanh((10y UST − overnight funding) / 3.0)
```

What the position earns per unit time if nothing moves, net of what the cash costs.
Centred on zero excess yield, which is the economically meaningful neutral: you are
paid exactly your funding cost, so holding earns nothing. Negative whenever the curve
is inverted — which is exactly when duration carry *is* negative. `_CARRY_SCALE_PCT
= 3.0` is a squash scale, not a centre.

**2. A component that cannot be computed returns `None`, never `0.0`.**

FX carry needs a foreign policy rate, equity carry an earnings yield, commodity carry
a roll yield. L0 has none of the three, and `value_signal` has no valuation proxy
outside credit and rates. These now return `None`.

**3. `compute_edge_score` renormalises over the components that are present.**

`None` drops the component *and its weight*; the remainder is rescaled to sum to 1.
An explicit `0.0` still means "computed, and neutral" and keeps its weight. If
nothing is computable the score is 0.0, which abstains — the correct answer when
there is no evidence.

We deliberately did **not** touch the 0.15 abstention band. Widening it would have
manufactured a fuller-looking book; the band is not the defect.

## Consequences

**The correction did not produce shorts, and we are not tuning it until it does.**
Re-scored on live 2026-07-24 data the universe is 4 long-capable, 0 short-capable —
unchanged in count. Every theme's score moved, but the market signal across these
eight macro themes genuinely leans long today: trend, regime and carry all point the
same way. Reverse-engineering the formula until a short appears would be the exact
dishonesty the abstention band exists to prevent.

**What did change is which themes, and the book's whole basis.** Fed Policy fell
+0.249 → +0.120 and now **abstains** — it was previously the entire $100M book, held
on a carry reading that mistook the level of the real yield for the yield a duration
position earns. Energy Prices (+0.176 → +0.367) and US Election (+0.165 → +0.343)
rose sharply: both are equity/commodity themes that had been diluted by the silent
zeros and are now scored on the evidence that exists for them.

**The remaining route to shorts is single names.** Eight macro themes in one regime
are directionally correlated by construction — that is what a macro theme *is*, so a
long-short book built only from them will lean one way in any decisive regime.
`task.md` explicitly permits "single companies", and the universe has essentially
none. Single names supply cross-sectional dispersion, where some names fall while the
theme rises. This is now the top Q1 gap.

**Carry and value remain distinct, and now correctly disagree.** Carry is a level
("what does this pay me"); value is a z-score against trailing history ("is this
cheap relative to where it has been"). Credit today is both well-paid in absolute
terms (carry +0.845) and historically expensive (value −0.851). The old design could
express only the first.

**Cost.** `carry_signal` and `value_signal` are now `float | None`, so every caller
must handle it — `daily_refresh.compute_edge_scores` averages over the computable
asset classes and passes `None` when a theme has none. Five tests in
`test_edge_signals.py` encoded the old contract and were rewritten to encode the new
one; 385 backend tests green.
