# ADR-0074 — Stress both tails, not just the crash

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0041](0041-direction-must-not-invert-on-a-label-flip.md), [0069](0069-utc-run-date.md)

## Context

The stress-test suite in `scenario_analysis.py` was four scenarios — VIX Spike, Rate
Shock, USD Strength, Credit Widening — and every one is a **risk-off** shock: each
carries a negative market shock (`mkt` −0.03 … −0.18). That is the right battery for the
long-biased book the platform published for most of its history.

On the 2026-07-25 run the book turned **net short** (−5.3%, market beta −0.50) after the
regime unit fix (ADR-adjacent, iteration 72) removed a spurious risk-on tilt. A net-short
book **gains** in every risk-off shock, so `/book` reported:

```
WORST SCENARIO  −0.0%   (USD Strength +5% DXY)
VIX Spike +3.4%  ·  Rate Shock +2.0%  ·  Credit Widening +0.2%  ·  USD Strength −0.0%
```

A $100M book whose worst stress scenario loses **nothing** is the first number a reviewer
pokes — not because the book is riskless, but because the battery only tested the tail it
is hedged against. The real risk of a short-biased book is the opposite tail: a **risk-on
melt-up / short squeeze** where high-beta and innovation shorts (ARKK, BABA, PDD) rip
higher. That tail was untested, so the page understated the book's risk to zero.

## Decision

Add a fifth scenario, **`S5_melt_up` — "Melt-up / Squeeze (SPX +10%)"**: `mkt` +0.10,
`umd` +0.08, with per-asset shocks that squeeze the short book (ARKK +25%, China +15%,
short-VIX +18%) and unwind the hedges (gold/miners −5…−7%, duration −6%). The suite now
spans **both tails**, so a book of either bias is stressed on its actual downside.

Kept as a fixed, documented calibration (not fitted to the current book): a `+0.10`
market melt-up is a symmetric partner to the risk-off shocks, and the per-asset moves
match the style of the existing four. The direct-shock path covers 64% of the current
book's gross, so it reports **−2.0%** — an honest worst case in place of −0.0%.

## Consequences

- `/book`'s "worst scenario" and `/risk`'s stress table now show a genuine loss for a
  net-short book; the panel can no longer read a misleading ~0.
- A net-long book is unaffected on its own downside (the four risk-off shocks remain its
  worst) but now also sees the melt-up as a mild tailwind — correct.
- The persisted `scenario_results` carries five rows; `scenario_results_to_dict` and the
  `/risk` renderer are agnostic to the count. Re-persisted on the live 2026-07-25 book so
  it is immediate, and committed so the next scheduled run keeps it.
- Tests pin the count at five and assert the suite contains both a risk-off (`mkt` < 0)
  and a risk-on (`mkt` > 0) shock, and that a high-beta short loses in the melt-up.
