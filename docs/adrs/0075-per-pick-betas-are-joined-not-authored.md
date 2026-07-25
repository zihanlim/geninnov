# ADR-0075 — Per-pick betas are joined, and a regime shape is computed, not authored

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md), [0071](0071-pool-metrics-are-not-book-metrics.md), [0049](0049-the-guardrail-does-not-read-the-prose.md), [0066](0066-not-computable-must-persist-as-null.md), [0054](0054-a-daily-publication-not-a-scanner.md)

## Context

[ADR-0073](0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md) forbade the model
from restating the pool's factor tilts as the book's, and added a guard. Reading the prompt
that shipped it turned up the instruction that had licensed the whole thing:

```
- factor_tilts: use the pre-computed book_metrics if available; set to {} if no data
```

`factor_tilts` is a **per-pick** field, rendered per row on `/book`. The instruction told
the model to fill it from an **aggregate**. It complied exactly. On the live 2026-07-25
book, all **ten** positions carried byte-identical tilts:

```
XLE SHY SVXY NUE UNH BABA GDX PDD NOC ARKK
   → every one:  beta_mkt -0.02  beta_hml +0.27  beta_rmw +0.35 …
```

**SHY** is a 1-3yr Treasury ETF. **SVXY** is inverse VIX. They were printed with the same
market beta. The measured values were sitting in `factor_exposures`, in the table the
prompt prints two sections above:

| asset | measured `beta_mkt` | R² |
|---|---|---|
| SVXY | **+2.08** | 0.68 |
| ARKK | **+1.49** | 0.77 |
| BABA | +1.25 | 0.14 |
| UNH | +0.62 | 0.06 |
| SHY | **+0.01** | 0.07 |
| NOC | **−0.01** | 0.04 |

So the prose defect ADR-0073 caught was the *smaller* half: the model had also been
hand-copying one row into ten, and the page rendered it. `GOAL.md` asks of any per-row
surface that **every scannable layer must differentiate**
([ADR-0054](0054-a-daily-publication-not-a-scanner.md)); ten identical rows is the
strongest possible failure of that.

**The same prompt block was misleading the model about the regime.** Three fields, checked
against L3:

| prompt printed | actually |
|---|---|
| `Yield curve slope (10y-2y): 0.34 bps` | `yield_curve_slope` is in **percent** — the curve is **+34 bps** |
| `HY credit OAS: 2.77 bps` | **277 bps** — a credit market rendered ~100x too tight |
| `VIX term structure: -1.93 (positive = backwardation)` | correct, but requires the reader to apply the convention |

This is the percent-vs-bps mismatch that made the classifier's own thresholds unreachable
(iteration 72), surviving in the one place it reaches a reader. Told the curve was
**0.34 basis points** — indistinguishable from flat — the agent opened the published
thesis with *"an **inverted** curve"* while quoting levels that show an upward slope. And
handed `-1.93`, it wrote *"term structure already in **backwardation** (VIX3M-VIX =
+1.93)"* — flipping the subtraction order, which is arithmetically fine, then keeping the
label that belonged to the other order. Under VIX3M − VIX = +1.93 the market is in
**contango**, the calm state, and the thesis used the opposite to argue a VIX-spike risk
was already underway.

Every number in both sentences was cited correctly. `verify_citations` grounds *numbers*,
so it passed all of them — the gap [ADR-0049](0049-the-guardrail-does-not-read-the-prose.md)
named.

## Decision

**Join what is measured; compute what can be characterised; ask the model for neither.**

1. **`attach_asset_factor_tilts` replaces the model's copy with the asset's own betas**,
   joined from `factor_exposures` in `size_positions` once the picks are known. The field
   is no longer requested in the output schema at all — a model should not be asked to
   type numbers that are about to be overwritten.
   - **`r_squared` rides along.** These betas are not equally trustworthy: ARKK fits at
     0.77, NOC at 0.04. A beta a reader cannot weight is a number with no unit, so `/book`
     prints the fit and says *"a weak fit, so read these betas loosely"* below 0.30.
   - **An unmeasured beta is omitted, not zeroed.** `beta_umd` is null for every asset
     today; 0.0 would assert that no momentum exposure was found rather than that none was
     measured ([ADR-0066](0066-not-computable-must-persist-as-null.md)).

2. **The regime block states units and names shapes.** `_describe_yield_curve` renders
   `+34 bps (upward-sloping — the curve is NOT inverted)`, `_describe_bps` renders HY OAS
   as `277 bps`, and `_describe_vix_term` renders `VIX − VIX3M = -1.93 (CONTANGO — spot
   below 3-month, the calm/normal state)`. A shape the system can compute is not left for
   the model to infer — the rule already applied to counts, sizes, exposures and tilts.

3. **Two guards, because a prompt is a request and a check is a verdict.**
   - `check_per_pick_tilts_differentiate` flags identical non-empty tilts across two or
     more picks. It tests the *fingerprint*, not the prose: that pattern cannot be a
     coincidence of measurement.
   - `check_regime_characterisation_claims` flags an *inversion* claim against a positive
     slope, and a *backwardation* / *contango* claim against the opposite sign.

## Consequences

- **The live book was repaired without a pipeline run.** `attach_asset_factor_tilts` is a
  pure join, so the 2026-07-25 picks were recomputed with the fixed code and PATCHed —
  ten distinct market betas from 2.08 to −0.01, live with no deploy. The same
  data-layer route iterations 45, 50 and 67 used.
- **The prose was not repaired, deliberately.** *"An inverted curve"* and
  *"market-neutral (Mkt −0.02)"* remain in the published thesis until the next run writes
  under the corrected prompt. Hand-editing model prose would make the page say something
  the agent did not conclude, and the guard reporting a real defect is the honest state.
- **All three checks were negative-controlled against production** before being trusted —
  each fired on the live row, naming the right numbers. A check that has only ever passed
  has not been shown to detect anything.
- **Fit quality is now visible per position, and much of it is poor.** Six of ten names
  regress below R² 0.30. That is a real disclosure, not a display bug: these are 252-day
  FF5 fits on single names, and the page now says so rather than presenting every beta as
  equally solid.
- **Still open, and now twice-implicated:** `compute_book_metrics_node` runs *before*
  selection, so the agent has never seen its own book. Every fix so far has been a
  prohibition on describing the wrong portfolio rather than the ability to describe the
  right one.
