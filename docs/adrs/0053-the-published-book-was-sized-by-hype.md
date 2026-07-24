# ADR-0053 — The published book was sized by HypeScore while every surface said conviction

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0032](0032-edge-stage4-abstention-conviction.md), [0040](0040-published-book-is-the-book-of-record.md), [0047](0047-conviction-needs-a-vol-floor.md)
**Partially corrects:** [0047](0047-conviction-needs-a-vol-floor.md) — see Consequences

## Context

[ADR-0032](0032-edge-stage4-abstention-conviction.md) made conviction the Stage-4
sizing weight: `conviction = |EdgeScore| / vol`, so a position is scaled by signal
strength per unit of risk. Every surface says so:

- `/book`'s header — *"sized by conviction across $100M"*
- `/method` §04 — *"conviction = |EdgeScore| / max(vol, 0.00315) → sizing weight ∝ conviction"*
- `SizingChainView`'s docstring — *"the documented model sizes by conviction"*
- L1's own allocation — `allocate_portfolio(..., size_by="conviction")`

`size_positions`, which sizes the **published** book, did not. It built its
`TradeCandidate` objects from the LLM's picks with only `theme_id`, `asset`,
`direction`, `trade_score`, `hype_score` and `avg_sentiment` — leaving `conviction`
and `vol` at their dataclass default of `0.0` — and called `allocate_portfolio`
without `size_by`, taking the `"hype"` default. `allocate_portfolio` also falls back
to hype when no candidate carries conviction, so both routes led to the same place.

The live 2026-07-25 book settles it. `|weight| / hype_score`:

| asset | hype | conviction | \|weight\| | w/hype |
|---|---|---|---|---|
| EEM | 26.29 | 15.79 | 0.0928 | **0.00353** |
| BABA | 26.29 | 13.58 | 0.0928 | **0.00353** |
| PDD | 26.29 | 14.26 | 0.0928 | **0.00353** |
| SLV | 27.26 | 9.13 | 0.0964 | **0.00353** |
| JPM | 42.70 | 22.00 | 0.0844 | **0.00198** |
| XLE | 32.60 | 31.07 | 0.0644 | **0.00198** |
| OIH | 32.60 | 20.20 | 0.0644 | **0.00198** |
| NUE | 27.26 | 22.41 | 0.0540 | **0.00198** |
| NOC | 41.87 | 14.89 | 0.0828 | **0.00198** |

Two exact constants — weight is proportional to HypeScore within cap group. Against
conviction the same book spans 2.8× and is close to **inverted**: the
highest-conviction name (XLE, 31.1) held 6.4% while the lowest-conviction long (EEM,
15.8) held 9.3%.

This is the failure this project keeps finding: **the page describes a model the code
does not run.** It is worse than the usual instance because the number in question is
*how much of $100M goes where* — the substance of Q1, not an explanatory panel.

`SizingChainView` even has a guard for exactly this — *"Sized by HypeScore, not the
documented conviction × inverse-vol model"* — and it never fired, because
`portfolio_positions` rows carry a conviction value (written from the L1 candidates)
that the sizer never used. A present-but-unused field defeated the check meant to
catch its absence.

## Decision

Thread `conviction` and `vol` from the L1 candidate through `run_q1_agent`'s
`candidate_dicts` and `screen_candidates` into `size_positions`, set them on the
`TradeCandidate`, and call `allocate_portfolio(..., size_by="conviction")`.

`allocate_portfolio`'s own fallback stays: with no conviction anywhere it still sizes
by hype rather than dividing by nothing, so a run without edge data degrades instead
of failing. A test pins that path as well as the primary one.

Tests use **ten names spread across sectors and geographies**. With two names the 20%
single-name cap clamps both to 20% and every ratio collapses to 1.0 — a test that
would have passed against the broken code.

## Consequences

- The published book's weights change on the next run. Conviction-weighted, the
  highest-|edge|-per-unit-vol names get the most capital, which is what ADR-0032
  specified and what the site has been claiming.
- **This partially corrects [ADR-0047](0047-conviction-needs-a-vol-floor.md).** That
  ADR's vol floor is right and its arithmetic held — BIL 2375× → 92.8× — but it
  claimed the unfloored ratio meant "a cash-like instrument absorbs the book until the
  single-name cap stops it". That was true of **L1's provisional book only**; the
  published book was never conviction-sized, so the floor could not have been
  protecting it. The floor's value stands; the scope claimed for it did not, and
  verifying it by reading the Conv. column could not have revealed the difference.
- The lesson generalises past this bug: **a displayed field is not evidence that the
  field is used.** `portfolio_positions.conviction` was populated, plausible, and
  inert. The check that would have caught it keyed off presence rather than use.
