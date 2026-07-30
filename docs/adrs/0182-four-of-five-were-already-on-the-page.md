---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0182 — Four of the five were already on the page

## Context

The owner asked why the risk-metric tiles were on `/mandate` at all.

They were never chosen for it. Before the phase split, `/risk` was one page and
`RiskMetricsGrid` sat inside `<section id="limits">`. ADR-0170 cut that page by
reader question and mapped `limits` → mandate, so the grid travelled with the
section it happened to live in. ADR-0181 then moved it into the row's last
column, which made the question visible rather than creating it.

Read off the live page at 1440 on the 2026-07-30 run:

| Figure | Risk-limit board, same page | Metric tile, same page |
|---|---|---|
| VaR (95%) | `NO DATA — / 6.0%` | `Unavailable —` |
| CVaR (95%) | `NO DATA — / 9.0%` | `Unavailable —` |
| Beta to SPX | `NO DATA — / 0.50` | `Unavailable —` |
| Concentration (HHI) | `1,403 / 2,000, headroom +597, OK` | `1403 ▲ +5, Exact` |
| Sharpe (252d) | — no mandate limit exists | `Unavailable` |

Four of the five are the same `portfolio_risk` columns the board already reports
**against their limit and headroom** — which on a page whose question is "is the
book inside its mandate" is strictly the more useful form. Three of those four
were stating the same *absence* twice, two cards apart, in two different
wordings. The fifth, Sharpe, is a realised risk-adjusted return with no mandate
limit at all: phase 6's question, not phase 1's.

## Decision

**The grid moves to `/attribution`, at the top of the `realised` section.**

`/risk` was rejected as a destination on its own copy: its lede promises that
*"every figure here is EX-ANTE — a pure function of the recommended weights and a
252-day covariance estimate"*, and every one of these five is computed off the
realised return series. Landing them there would have made that sentence false.

`/attribution` is the backward-looking surface, the Δ-vs-yesterday chips are
exactly its claim, and the phase already opens with an answer card — *"7 sessions
— 11 statistics are still withheld for want of history; var_95 unlocks at 30"* —
that is about these tiles specifically. They now sit directly beneath the card
that explains their own absence.

No change to `RISK_SECTION_PHASE`: the grid moved *into an existing section*
rather than becoming one, so the nav ⟷ section parity the split is tested on is
untouched. The attribution lede gains a clause naming what the phase now opens
with.

Two follow-ons the move forced:

- `RiskMetricsGrid` drops the `xl:grid-cols-1` step ADR-0181 added. That existed
  for a 318px column which no longer exists; a class kept "in case" is a class
  nobody can delete later. Back to `grid-cols-2 md:grid-cols-5`, and `mb-6`
  returns now that no parent stack owns its spacing.
- `CapUtilisation` takes `open:h-full` back. It owns the last column again, so it
  is what meets the other two cards' bottom edge — including the
  `[&::details-content]` rule ADR-0181 recorded but did not need, which is now
  what pins its closing note to the baseline.

## Consequences

Measured at 1440: `/mandate`'s three cards run **474 → 2062px**, one top and one
bottom edge, page 2483 → **2166px**. On `/attribution` the strip renders five
across at 259px per tile, 175px tall, above the track record. Collapsing the caps
card still returns it to 58px. No overflow, no console errors, 975 frontend tests
green, `tsc --noEmit` clean.

Costs:

- **`/attribution` inherits the duplication it does not have yet.** `beta` also
  appears in `BenchmarkComparison` further down that page, and VaR/CVaR appear in
  `VarMethods` on `/risk`. This change removes one duplication and does not audit
  the rest.
- **The provenance rendering moved, it did not spread.** These tiles are still
  the only place `numeric_derivations` (method id, freshness, uncertainty band)
  reaches a reader for these five figures. The limit board reports the same
  numbers with no provenance beyond a source line — an asymmetry left standing.
- **`/mandate` lost its only Sharpe.** Nothing there reports a risk-adjusted
  return now. That is intended — a mandate is not a performance statement — but
  it is a figure a reader of that page could previously see.
- **The mandate row is one card narrower in content.** The last column is a
  single disclosure again, stretched to 1588px, so its slack is back (the caps
  content is ~1131px of it).

Rejected:

- **Leave it.** The duplication is on one screen and includes the same absence
  stated twice.
- **Retire the grid entirely and rehome only Sharpe.** Cheapest, and it would
  have deleted the only surface rendering derivation provenance for these five
  figures.
- **Move it to `/risk`.** Contradicted by that page's own lede, which is a
  promise about every figure on it.
