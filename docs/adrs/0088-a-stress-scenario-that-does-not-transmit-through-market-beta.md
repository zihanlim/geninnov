# ADR-0088 — A stress scenario that does not transmit through market beta

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0074](0074-stress-both-tails-not-just-the-crash.md), [0043](0043-single-company-universe.md), [0066](0066-not-computable-must-persist-as-null.md)

## Context

[ADR-0074](0074-stress-both-tails-not-just-the-crash.md) fixed a suite that only
tested one tail. It added `S5_melt_up` so a net-short book had a scenario it loses
in, and the live worst case moved from −0.0% to −2.0%. That was the right fix for
the problem it addressed, and it left a second one untouched.

All five scenarios transmit through the same channel. Each is a market shock scaled
by a factor beta, optionally overridden by a per-ticker shock. They differ in sign
and magnitude but not in **shape** — which means a position the factor model cannot
see is invisible to the entire battery, and a book can be hedged against all five
the same way.

Measured on the live 2026-07-25 book (10 positions, 59.3% gross, −5.4% net):

| Position | Weight | Worst \|P&L\| across **all** of S1–S5 |
|---|---|---|
| NOC (short) | 4.73% | **0.093%** |
| SHY (long) | 9.25% | **0.026%** |

`NOC` carries `beta_mkt` **−0.014** and appears in no scenario's shock list, so every
beta-transmitted scenario reads it as flat. It is a 4.7% short whose entire investment
case is geopolitical — a short in defense is a short in escalation — and nine basis
points was the most any stress test could say about it. `SHY` is the book's largest
long at 9.25% with `beta_mkt` +0.015, and was scored at 2.6bp for the same reason.
Together, **23.6% of gross was effectively unstressed**, structurally rather than by
oversight: the channel could not carry those positions.

The suite also had no *inflationary* shock. S1 and S4 both pay a long-duration book
(TLT +4%, +6%) because deflationary risk-off is the only kind of risk-off modelled.
A book hedging with duration therefore looked hedged against every downside the page
displayed.

## Decision

Add **`S6_supply_shock` — "Supply Shock (chokepoint closure)"**: a maritime chokepoint
closes and crude supply is disrupted. Two things make it structurally different from
S1–S5 rather than a sixth variation:

**1. It transmits through sector dependency, not market beta.** `Scenario` gains a
`sector_shocks: dict[str, float]` field, keyed by the `SECTOR_MAP` buckets the book is
already capped and reported against. Resolution order is ticker → sector → factor
path, via a single `_resolve_shock` helper that both the P&L loop and the
`covered_frac` gate call — they were previously able to disagree about what "covered"
meant, and a gate that counts an asset the loop skips silently selects the wrong
estimator. `factor_shocks` is deliberately near-empty (`mkt` −0.04): routing S6 through
the beta channel too would collapse it into a smaller S1.

Sector transmission also generalises where a ticker list does not. A name added to
`SECTOR_MAP` is stressed by S6 the day it appears, with no edit to the scenario — pinned
by a test that fails if any Tier-1 ticker resolves no shock.

**2. It is inflationary, so duration does not hedge.** TLT is −7% here against +4%/+6%
in S1/S4. This is the only state in the suite where Treasuries fall alongside equities.

Ticker overrides remain for names that do not behave like their bucket: `SVXY` is filed
under `Rates` but is short-vol, and inherits nothing sensible from a rates shock.

Calibration is fixed and documented, not fitted to the current book — the same standard
ADR-0074 set. Energy +18%, Defense +10%, Gold Miners +12% on the supply side; China
Equities −12%, Japan −11%, Autos −13%, Disruptive Innovation −14% on the demand side,
scaled by energy-import dependence.

## Consequences

- **S6 does not become the worst case on the current book, and was not tuned to.** It
  scores **+1.48%**: the book is short 18% of China, which a chokepoint shock hurts.
  The melt-up remains worst at −1.99%. A scenario built to produce a predetermined
  headline would not be a stress test.
- **What it does change is coverage.** S6 assigns a direct shock to 10/10 positions.
  `NOC` moves from 9bp to **47bp** and the book's implicit short-geopolitical-risk
  position — short gold miners **and** short defense, −1.24% combined — becomes visible
  for the first time. No other scenario reveals it.
- `SHY` moves 2.6bp → 5bp. Small, and the point is not the magnitude: a *measured*
  near-zero and an *unmeasured* near-zero render identically and mean different things,
  which is the distinction [ADR-0066](0066-not-computable-must-persist-as-null.md) and
  design goal 2 exist to protect.
- The five existing scenarios are **unchanged**: re-run against the live book they
  reproduce their persisted values to the basis point (`+0.00pp` on all five).
- `scenario_results` rows gain `sector_shocks`; `/risk` renders chips from both maps.
  A sector-transmitted scenario emitting only `factor_shocks` would have shown a
  near-empty chip row under a material P&L — a number with its cause left off, which
  design goal 1 forbids. Breakdown rows name their origin (`NOC (short) via Defense`)
  so the shock traces to a row of the transmission map.
- Sub-percent shocks now print at 1dp. At the table's `:+.0%`, SHY's −0.5% rendered
  `+0%`, giving a row whose own numbers multiply to zero under a non-zero result — the
  self-consistency [ADR-0074](0074-stress-both-tails-not-just-the-crash.md)-era rows
  were explicitly fixed to keep.
- `scenario_analysis` now imports `SECTOR_MAP` from `book_metrics`. `book_metrics` does
  not import `scenario_analysis`, so there is no cycle.
- **Persisted to the live 2026-07-25 book by appending S6 alone**, not by rewriting the
  array. Recomputing all six would have rewritten the five published returns by ~2e-08
  — float4 betas widened to float64 differ from the in-memory regression output the
  original run used — and a rounding difference is not a reason to touch a published
  number. Append-only keeps the first five byte-identical (verified: the md5 of
  elements 1-5 is unchanged across the write). Order does not matter because `/risk`
  re-sorts with `sortWorstFirst`. The write was guarded on that same md5 and on S6 not
  already being present, so it cannot double-apply or race the other session.
- **Until the frontend deploys, `/risk` shows S6 with a single `MKT -4.00%` chip.** The
  shipped `ShockChips` reads `factor_shocks` only, so the 22 sector chips are absent.
  Incomplete rather than false — `mkt` −0.04 *is* one of the scenario's shocks, the
  breakdown legs render their `via Energy` origins correctly because those are strings
  in the persisted row, and the description states the transmission is by sector
  dependency. It is still the goal-1 shape this ADR set out to avoid, and it closes when
  the component ships.
- Tests pin the count at six, that **only** S6 carries a sector map (if another scenario
  grows one, the distinction this ADR rests on has quietly gone), the ticker-over-sector
  precedence, the inflationary duration sign, and the NOC blind spot with its
  pre-condition asserted.

## What this does not claim

S6 is a **risk** instrument, not an alpha signal. It says what the book loses if a
supply disruption happens; it does not forecast one, and no geopolitical feed is
consumed to produce it. The pipeline runs once daily after the US close, which is the
wrong cadence to trade an event on — a shock surfaced intraday is in the tape long
before the next run. Anything that would change *which* positions are picked belongs in
a separate decision, argued on its own evidence.
