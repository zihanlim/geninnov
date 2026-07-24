# 0043 — Single companies enter the universe

- **Status:** accepted
- **Date:** 2026-07-24
- **Depends on:** [ADR-0038](0038-per-asset-direction.md) (direction is per asset),
  [ADR-0039](0039-scope-by-attention-abstain-by-asset.md) (scope by attention)

## Context

`task.md` asks for trades *"across any asset class and/or single companies"*. The
universe had none — 37 ETFs and futures proxies, zero individual equities.

This gap has been on the backlog since iteration 2 and was **twice deferred for the
right reason**: until ADR-0038, direction was a property of the THEME and every asset
in it inherited that direction. A single company added to a rising theme would have
been stamped long regardless of its own signal — exactly like the extra ETFs added in
iteration 4, which produced no shorts either. Adding single names before per-asset
direction would have added tickers and no information.

That constraint is gone. Direction is now `sign(the asset's own EdgeScore)` and scope
is chosen by attention rather than by the theme's average edge, so a company can
genuinely oppose the theme it expresses.

The need is concrete and it is on the short side. On 2026-07-24:

```
L1 candidate pool:  18  (14 long, 4 SHORT)
L5 picked:           7  ( 5 long, 2 short)
```

The long side filled to its cap of five. The short side could not, because only four
short candidates existed anywhere in the pool. Macro ETFs in a single regime are
directionally correlated *by construction* — that is what a macro theme is — so a
book built only from them leans one way. Q1 asks for five long **and five short**.

## Decision

Add 15 single companies, each mapped to the theme it genuinely expresses:

| theme | names | why |
|---|---|---|
| Fed Policy | JPM, GS | curve / NII and capital-markets sensitivity |
| Energy Prices | XOM, CVX, SLB | integrated crude beta; oilfield-services capex cycle |
| US Election | UNH | healthcare-policy exposure |
| Geopolitical Risk | LMT, NOC, RTX | defence primes |
| Corporate Credit | F | bellwether high-yield issuer |
| China Growth | JD, PDD | China domestic consumption |
| Inflation | FCX, NEM, NUE | copper, gold, steel — real-asset and pass-through beta |

Three constraints were checked before adding any of them:

1. **Price history.** Every ticker was confirmed to have ~251 daily closes. An asset
   with no history scores Trend 0 and enters the book on a *silent zero* — which is
   exactly how `DXY` got in and then aborted a run (migration 031).
2. **Full classification.** Each is present in `SECTOR_MAP`, `GEO_MAP` and
   `_ASSET_CLASS_MAP`. `is_classified` drops an unmapped ticker without a word, so a
   careless addition shrinks the book instead of widening it.
3. **Theme coherence.** Each name is a defensible expression of its theme.

**Names were chosen for what they express, not to manufacture shorts.** Whether any
of them ends up on the short side is the signal's decision, and this ADR does not
claim a particular outcome.

Two new sectors, `Defense` and `Autos`, keep the 30% sector cap meaningful — three
defence primes in one theme would otherwise have concentrated under whatever sector
they were forced into.

## Consequences

**Universe 37 → 52 tickers, and for the first time it contains idiosyncratic risk.**
The 6-month returns spread from NEM −21.8% and PDD −21.4% to NUE +34.6%, and — the
point — they **disagree inside a theme**: the three defence primes span LMT −3.1%,
RTX +7.3%, NOC −19.8%, and energy splits XOM +19.0% against SLB −3.2%. Under
theme-level direction all three defence names would have carried the same side.

**Concentration limits will bind harder, correctly.** Most of these are US equities,
so the 35% geography cap and the 30% sector caps engage sooner. Under
[ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md) that means a book which
cannot be filled inside its limits holds cash rather than concentrating — the right
behaviour, and now more visible.

**Single names carry risks the ETF universe did not.** An individual equity moves on
earnings, guidance and litigation that no macro theme explains, and neither the
HypeScore (which counts *theme* mentions) nor the regime model sees any of it. The
factor model (L2) partially covers this through FF5+UMD betas, but idiosyncratic
event risk is genuinely uncovered. A single-name book therefore deserves tighter
position limits than an ETF book, and the current 20% single-name cap was calibrated
when every "name" was a diversified fund. **That is a live calibration question, not
a settled one.**

**HypeScore attribution is inherited, not measured.** JPM's attention score is Fed
Policy's — news is collected per theme, not per company. That is honest for a
theme-expression instrument and wrong for a stock-specific view, and it means these
names should not be read as "the market is talking about JPM".
