# ADR-0125: A chart without a value axis is a shape

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md), [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md), [ADR-0072](0072-persist-the-books-correlation-structure.md)

## Context

The quant layer reached a surface on 2026-07-27 and five illustrations were built over it: a Monte Carlo terminal-return histogram, a VaR horizon fan, a stress return profile, a position risk/conviction scatter, and a signed Euler risk-contribution waterfall.

An audit of them found the arithmetic sound and the presentation not. **The numbers were right**: Σ `contribution_to_vol` = 0.08049207 against a persisted `portfolio_vol` of 0.080492074, so the waterfall genuinely accumulates to the book's ex-ante volatility; the Monte Carlo `density` is `counts/total`, so the "% of paths" tooltip is the correct unit; the VaR markers and ES figures matched the persisted bands exactly.

**Three of the five had no value axis at all.** The waterfall printed the word *volatility* and nine asset names, and nowhere printed **8.05%** — the single number the chart exists to communicate. The fan printed *loss* and five day-ticks and never printed a loss figure. The scatter printed *adds risk* / *hedges* / *0x conviction* / *high*. In every case the values existed only inside SVG `<title>` tooltips, which are hover-only and absent on touch.

**Two marks were clipped by their own viewBox**, both from the same class of error — a mark centred on a coordinate that is already the plot boundary:

- The waterfall's total bar used `slot = plotWidth / (n + 1)` and placed the total at `slot × (n + 1)`, i.e. exactly the right plot edge. Measured on the live 9-position book: the rect spanned **683.5 → 724.5 against a 720 viewBox**.
- The histogram's bars were a fixed width centred on each bin midpoint, so the end bars overhung the axis by half a bar (~8px on the live 41-bin payload) and, on a coarse histogram, catastrophically — a 3-bin payload put the first bar at **x = −128**.

**And the colour carried a meaning the app gives it elsewhere.** `--long` (#126e53) against `--short` (#9f172a) measures **ΔE 6.1 under deuteranopia** (validated, not eyeballed). On the scatter, colour encoded the *sign of risk contribution* while direction — the thing colour means on every other surface in this app — was encoded as a **radius difference of 1px** (4 vs 5), with no legend. Today every contribution is positive, so all nine dots rendered in one colour and the channel carried nothing at all.

Separately, `CorrelationMatrix` printed two counts side by side drawn from **different denominators**: `{matrixPairs.length} measured · {sameDirection} same-direction`, where `sameDirection` counted only the *flagged* subset. With the matrix persisted that reads **"36 measured · 0 same-direction"** — as though none of the 36 move together, when it means "0 of 0 cleared the flag."

## Decision

**Every chart carries a value axis, and a tooltip is never the only copy of a number.**

`niceTicks` (1/2/5 × 10ⁿ) supplies rounded ticks; the waterfall, fan and scatter each render them with gridlines, and the waterfall additionally prints its **total above the total bar** because that figure is the chart's entire purpose. Values remain in `<title>` as well — as an enhancement, not as the record.

**Marks are derived from their extents and clamped to the plot, never centred on a boundary.**

- The waterfall reserves `n + 2` slots so the total occupies one of its own.
- Histogram bars are computed from **bin edges** (`mid ± step/2`) and clamped to `[PLOT_LEFT, PLOT_LEFT + PLOT_WIDTH]`, which fixes both the end-overhang and the coarse-histogram blow-out in one change, and yields the 1px inter-bar gap as a side effect.

A test asserts no `<rect>` escapes the viewBox, **parameterised over book sizes 2/3/5/9/14** — the original bug was invisible at the size the unit test happened to use.

**Where sign or direction is carried by `--long`/`--short`, a second channel carries it too.** At ΔE 6.1 those tokens sit inside the 6–8 band that is legal *only* with secondary encoding. So: the stress rows print the signed value beside every bar; the waterfall and scatter encode sign as position against a zero line; and the scatter marks **long as a filled dot and short as a ring**, with a legend. Colour on the scatter now means what it means everywhere else in the app — direction — and risk sign moved to the y-axis, where it belongs.

**The fan is an emphasis chart, not three competing hues.** p95 is the published figure; p90 and p99 are context. The previous cut drew p90 and p99 in the *same token* at different opacity, making them genuinely indistinguishable. Now p95 is the accent, p90/p99 are the de-emphasis grey, and all three are **direct-labelled at their right ends**, so identity never depends on a colour lookup. Its legend also stops calling p95 a horizon: **p95 is a confidence level; 21d is the scored horizon** ([ADR-0090](0090-a-published-pick-must-be-falsifiable.md)), and conflating them in a legend that read `p95 · scored horizon` was a category error over the one figure `pick_outcomes` grades against.

**Two counts printed together share a denominator.** `CorrelationMatrix` derives `sameDirection` from whichever set the adjacent count describes.

## Consequences

- Three charts gained axes and two gained legends, costing vertical space on `/risk`. That is the correct trade: a chart whose magnitude cannot be read is decoration.
- The scatter's y-domain is now taken from the data (with zero always in frame) rather than forced symmetric on ±max. Forcing symmetry left the entire lower half blank on a book with no hedges and crushed every point into a band.
- The scatter now **states when a held name has no decomposition entry** rather than dropping it silently. Today `picks` and `risk_decomposition` both hold 9, so nothing is dropped — the notice exists for when that stops being true.
- `book_metrics.correlation_matrix` (all pairs at `threshold=0.0`, [ADR-0072](0072-persist-the-books-correlation-structure.md) with the filter off) is written by `finalise_book_analytics`, so the full heatmap renders **only from the next pipeline run onward**. The card degrades to the flagged view plus the correlation summary until then.
- The ΔE finding is about the **design tokens**, not these charts. Every other surface that distinguishes long from short by colour alone inherits the same problem; this ADR fixes it where it was measured and does not claim to have fixed it globally.
- `--long` also measures **chroma 0.092 against a 0.1 floor** — marginally "reads grey". It is a system-wide semantic token and was not repainted over a 0.008 shortfall; the secondary encoding above is what makes it safe.
