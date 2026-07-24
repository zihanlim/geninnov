# ADR-0047 — Conviction needs a vol floor, and the floor must be absolute

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0032](0032-edge-stage4-abstention-conviction.md), [0042](0042-absolute-hype-subscores.md), [0046](0046-attention-chooses-what-we-look-at-not-what-is-tradable.md)

## Context

ADR-0032 made conviction the Stage-4 sizing weight: `conviction = |EdgeScore| / vol`,
signal strength per unit of risk, so a position is scaled by how much the market moves
it. `allocate_portfolio(size_by="conviction")` weights the book by this number, and
`/book` prints it in a Conv. column beside every position.

Reading that column on the deployed 2026-07-25 book:

| Asset | Annualised vol | Conviction |
|---|---|---|
| **BIL** | **0.19%** | **2375.2×** |
| SHY | 1.50% | 292.1× |
| AGG | 4.16% | 99.2× |
| IEF | 5.07% | 79.4× |
| *…35 names…* | 6.7% – 55.9% | 9.1× – 30.1× |
| SLV | 74.58% | 9.1× |

Thirty-five of thirty-nine names sit in a 9–30× band, a 3.3× spread. Four break out,
and they are exactly the four below ~5% annualised volatility. BIL is a 0–3 month
T-bill ETF; it scored **109× the next-highest name** and **260× SLV**.

That is not a claim that BIL was 260× the better idea than SLV. **It is the
denominator talking.** As vol → 0 the ratio stops describing the idea and starts
describing how still the instrument is.

Two consequences:

1. **A column whose whole purpose is comparison stopped being comparable.** A reviewer
   reading "2375.2×" next to "15.7×" has to be told to ignore it, which is the
   opposite of what a provenance-first page is for.
2. **It is a sizing weight, not just a display.** Weighting by an unbounded ratio
   means a cash-like instrument absorbs the book until the single-name cap stops it.
   Inverse-vol sizing is meant to scale risk; past the point where the denominator
   approaches zero it becomes a search for the least volatile thing available, which
   is not the same objective and was never the intended one.

This was found by reading the book's own Conv. column against itself, not by a test —
every number in it was computed exactly as specified.

## Decision

**Floor the denominator:** `conviction = |EdgeScore| / max(vol, conviction_vol_floor)`,
with the floor in `scoring_config` like every other weight and lookback.

**The floor is 0.00315 daily ≈ 5% annualised.** The basis is economic and stated:
*5% annualised volatility is the conventional boundary between a cash-like instrument
and a risk position.* Today's universe corroborates that line rather than defines it —
BIL (0.19%) and SHY (1.50%) are unambiguously places to park money, IEF (5.07%) and
AGG (4.16%) sit on it, and everything above is an instrument someone takes a view
with.

**The floor must be absolute, never a percentile of the day's names.** A relative
floor would make conviction a statement about the peer group that happened to be
scored alongside it rather than about the asset — precisely the defect
[ADR-0042](0042-absolute-hype-subscores.md) removed from HypeScore's sub-scores, where
a theme's score moved 60.6 → 36.6 with byte-identical inputs because its peers had
changed. A sizing weight with that property would rebalance the book on days when
nothing about the book changed.

**A zero or missing vol now returns `|edge| / floor`, not `|edge|`.** The old fallback
put an unpriceable name at the *bottom* of the conviction ranking (`|edge| ≤ 1` against
a book of 9–30), which reads as low conviction when the truth is no measurement — the
same silent-zero pattern this codebase keeps removing.

Setting `conviction_vol_floor` to 0 restores the previous behaviour exactly.

## Consequences

- Four names are re-scored and thirty-five are untouched: it is a floor, not a
  rescaling. BIL 2375 → ~93, SHY 292 → ~88, AGG 99 → ~83, IEF 79.4 → unchanged (it
  sits on the line). The book-wide max/median ratio falls from **148× to under 6×**.
- Low-vol names still size larger than high-vol ones, which is what inverse-vol
  sizing is *for*. The floor bounds the effect at `|edge| / floor`; it does not
  reverse it.
- The floor is a judgement call with a stated basis, not a fitted parameter. It was
  deliberately **not** shipped in the iteration that found the defect: picking the
  constant in the dark would have been the same error one level up. Both the number
  and its reasoning live in `scoring_config` and in this file, so changing it is a
  database edit and a documented decision rather than a silent code change.
- Six tests pin it, including the live BIL/SLV pair, the invariance of every
  above-floor name, and the absoluteness property — the same asset must score the same
  conviction whatever else was scored alongside it.
