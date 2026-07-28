# ADR-0129: AI Capex is a theme, and the tracker found it sideways

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0030](0030-unify-l5-candidate-pool-with-l1.md), [ADR-0038](0038-per-asset-direction.md), [ADR-0043](0043-single-company-universe.md), [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0125](0125-one-ticker-one-record-the-maps-are-views.md), [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md)

## Context

[ADR-0128](0128-a-theme-we-did-not-name-in-advance.md) built the narrative tracker on the argument that the AI capex cycle was **structurally invisible** to this system: no theme, no keyword, no mapped asset. That argument was correct, and the first live run proved it in a way the ADR did not anticipate.

Measured over the accumulated 455-document corpus, **AI appears in exactly two documents**:

> *"Goldman Offers Way to Trade AI Junk Bonds $250 Million at a Time"*
> *"Bond market anxiety is growing over AI capex budgets"*

Both arrived through the **Corporate Credit** keyword query. Neither was collected because anything in this pipeline was looking for AI. The largest capex cycle in the market was reaching the system only as a side-effect of asking about junk bonds — which is the circularity ADR-0128 describes, caught in the act rather than argued in the abstract.

Two things follow, and they point in opposite directions:

1. The tracker did its job. It is what made this legible.
2. **Seeing is not trading.** ADR-0128 states the limit plainly — *"a phrase is not a theme until someone maps it to instruments, and that step is deliberately not automated"*. A phrase has no asset class, no price history and no correlation. Left there, the finding is an observation on a shadow board.

There is also a signal in *which* documents got through. Both are **credit** stories. The transmission this system has actual evidence of is AI capex → issuance → spreads, which is the leg [Andromeda's mandate lens](0015-lens-mode-asset-class.md) is pointed at.

## Decision

**Promote AI Capex to an anchor theme, mapped across four asset classes.**

`themes` gains one row (`tier='anchor'`, `source='practitioner'`) and `theme_assets` gains thirteen instruments (migration 050). The `source` is deliberately `practitioner`, not a promoted `discovered_themes` row: the tracker supplied the evidence and a human supplied the instrument map, and the provenance should record which of those happened rather than implying the pipeline promoted itself.

**The map is a chain, not a basket.** Each link is what breaks differently:

| Link | Instruments | Why it is here |
|---|---|---|
| Compute | SMH, NVDA | what the money is spent on |
| Manufacture | TSM | where it is physically made |
| The spenders | MSFT, GOOGL | the capex budgets the bond market is anxious about |
| Power | VST, XLU | the binding physical constraint on the buildout |
| Electrical plant | GEV, VRT | turbines, cooling, power distribution |
| Copper | FCX | grid and datacenter buildout is metal-intensive |
| **Funding** | **JNK** | where the live evidence actually came from |
| Duration | IEF | capex funded by issuance is supply into the belly |
| Gas | UNG | what the marginal datacenter megawatt burns |

**Four asset classes, not one.** Since [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md) the correlation sub-score is the mean over *measured* asset classes, so an equity-only theme can score at most its equity leg. The deeper reason is prior to the scoring: an equity-only map cannot express the transmission that makes AI capex a **market theme** rather than a sector call. Verified on real prices — all thirteen instruments measurable, collapsing to `{equity, credit, rates, commodity}`, breadth **2 of 4 classes material**.

**Three new sectors: Semiconductors, Utilities, Electrical Equipment.** A sector is what the 30% cap binds on. Filing the whole chain under "Tech Growth" would let the book hold three legs of one chain and call it diversified, while a real AI-capex drawdown hits all three at once. MSFT and GOOGL *do* go under the existing "Tech Growth" alongside QQQ, for the mirror-image reason: they are 40%+ of it, and a separate bucket would double the effective cap on one exposure. This is [ADR-0043](0043-single-company-universe.md)'s argument for Defense and Autos, applied again.

**Taiwan is its own geography.** It is the single manufacturing concentration in the theme, and the geo cap is the only mechanism that can express that. Filed inside "EM" it would net against Brazil and China. It also links this theme to Geopolitical Risk, whose keyword list already contains "Taiwan" — the same tape moves both, in opposite directions.

**Direction is not decided here.** Per [ADR-0038](0038-per-asset-direction.md) each asset's side is `sign(its own EdgeScore)`, so the same instrument can be long under one theme and short under another. Mapping JNK and IEF into an AI theme is not a claim that credit is short; it is what lets the engine take either side of the financing leg.

## Consequences

- **A theme with no attention history starts at zero and climbs.** `AI Capex` has no `theme_signals_history` rows, so its momentum term is degenerate on day one and its HypeScore will sit below the eight incumbents until the mention series accrues. It will be **under-weighted, not mis-weighted** — but a reader comparing it to Fed Policy tomorrow is comparing a theme with one observation to one with fifty.
- **Two tests inverted, and the inversion is the system working.** `test_the_ai_capex_narrative_is_covered_by_nothing` asserted `covered_by is None` — true when written, and the finding. It now asserts `== "AI Capex"`: the phrase drops off the emerging shortlist *because a theme adopted it*. That is the only good reason for a narrative to leave that list, and it is now the assertion.
- **A guard caught a gap this change would otherwise have opened.** [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md)'s supply-shock scenario transmits through `SECTOR_MAP`, and `test_supply_shock_covers_every_position_in_the_tier1_universe` failed the moment three new sectors existed — seven positions would have been **silently unstressed** in S6. Shocks added: Semiconductors −0.16 (the most shipping- and Taiwan-exposed sector in the book), Electrical Equipment −0.12 (freight- and metals-intensive capital goods), Utilities −0.03 (defensive and domestically regulated, so nearly insulated on demand — but input costs rise and pass-through lags, so **not** a haven and not zero). The test is the reason this is a decision rather than an omission.
- **The single-token attribution rule tightened, and it was a live regression.** Adding `dollar` as a coverage alias made `anchor_for_phrase("dollar debasement")` return `US Dollar` — annexing the exact narrative ADR-0128 names as its motivating example. A one-word keyword now covers **only the one-word phrase**; multi-word keywords still cover anything at least as specific. The asymmetry follows from cost: a phrase wrongly marked covered vanishes from the shortlist the feature exists to produce, while one wrongly marked uncovered merely lengthens a list a human reads.
- **`data` is no longer a stopword.** It read as newswire furniture ("economic data", "data shows") and was stopped — which silently destroyed **"data center"**, the phrase the entire buildout is described in. Because n-grams are built over the *filtered* token stream, stopping one common token removes every phrase containing it. A furniture judgement on a common word can delete a theme.
- **This is a hard-coded theme, and that is in tension with the brief.** The ask was for emerging themes rather than hard-coded ones. What is automated is *detection*; what is not is *instrument mapping*, because mapping requires a claim about which prices express a narrative — and that claim is exactly what a frequency count cannot make. The honest description of the system is now: **the tracker proposes, a human maps, the engine sizes.** Automating the middle step would mean inventing an instrument map from a phrase, which is the kind of confident fabrication ADR-0023's provenance guard exists to prevent.
- **US concentration rises.** Eight of the nine new tickers are US equities, in a book whose geo cap was already binding at 35% US. The cap still binds, so nothing breaks — the optimizer simply has more US candidates to choose among. It is worth stating rather than discovering: AI capex genuinely *is* a US-concentrated theme, and the book will reflect that up to the limit the cap allows.
