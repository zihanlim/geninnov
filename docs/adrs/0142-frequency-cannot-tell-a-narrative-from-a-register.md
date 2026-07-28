# ADR-0142: Frequency cannot tell a narrative from a register

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0006](0006-hype-score-formula.md), [ADR-0042](0042-absolute-subscores.md), [ADR-0047](0047-conviction-vol-floor.md), [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md)

## Context

With the corpus bias fixed ([ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md)), the narrative board ranked by share of voice over 295 neutral documents:

```
 1. 27.6%  earnings      6.  8.2%  bond
 2. 13.7%  price         7.  7.8%  analysts
 3. 10.6%  q2            8.  7.2%  guidance
 4.  9.9%  growth        9.  6.5%  q2 earnings
 5.  9.2%  revenue      10.  6.5%  wall      …  12.  5.1%  ai
```

That is **the vocabulary of financial writing, not a set of narratives**. `earnings`, `price`, `growth`, `revenue`, `analysts` describe the *register* of the articles; they are what financial journalism sounds like. The question was whether a TF-IDF baseline would separate register from narrative.

## Decision

**No TF-IDF, no background-lift, no capitalisation heuristic. Three measured rejections.**

### TF-IDF is mathematically redundant here

Ranking by TF-IDF produced a **byte-identical** top-10 to ranking by share. That is not an accident of this corpus, it is provable.

This system already counts **document frequency**, not term frequency: `phrases_in` returns a *set*, so a document repeating "AI" twelve times contributes one. With `x = share = df/N`:

```
tfidf = x · log(N/df) = x · log(1/x) = −x·ln(x)
```

`−x·ln(x)` is **monotonically increasing for x < 1/e ≈ 0.368**. Every phrase in the corpus is far below that (max 27.6%), so TF-IDF is an order-preserving transform of share and **cannot reorder anything**. TF-IDF exists to damp term-frequency inflation; that inflation was designed out on day one, so there is nothing left for it to correct.

### A background baseline is only as good as its background

Ranking by lift against the accumulated corpus gave `q2` (211×), `revenue` (184×), `guidance` (143×), `q2 earnings` (129×) — every one with a background count of **zero**. The only accumulated corpus is `theme_news`: Fed, dollar, oil, China, geopolitics. It never discusses earnings, so earnings vocabulary looks infinitely novel against it.

That is [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md)'s bias in a new place: **an anchor-skewed background makes anchor-adjacent vocabulary invisible and everything else look new.** A background must represent financial writing generally; eight topics do not.

### Capitalisation does not survive real headlines

`Alphabet` and `Nvidia` are entities; `earnings` is a description — so casing looked like a free entity signal available with no history. Measured: **64% of headlines are title-cased**, where casing carries no information at all. Among the sentence-cased remainder the top mid-sentence capitalised tokens are `by`, `investing.com`, `the`, `times`, `business` — publishers and noise.

### What actually discriminates: change, then price

**Velocity**, which is already built. It compares a phrase against **its own history in the same corpus**, so it is self-referenced and needs no representative background — the same property that makes [ADR-0042](0042-absolute-subscores.md)'s absolute sub-scores comparable over time. `earnings` at 27% *every day* has zero velocity and classifies `established`; a narrative going 5% → 9% → 14% does not.

And beyond that, the brief's own definition: a market theme is **"a narrative driving cross-asset moves"**. That test is not linguistic at all. `correlation_with_mentions` and the per-class machinery from [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md) already answer it for anchor themes; pointed at a narrative phrase's mention series it would separate `earnings` — ambient, correlating with nothing in particular — from `ai capex`, which should co-move with the semis and power complex.

**The generalisable point: this was being attacked as a linguistics problem when the definition is economic.** Frequency, TF-IDF, stoplists and capitalisation are all attempts to decide "is this word a theme" from text alone. A word is a market theme when attention to it moves prices, and no amount of text statistics substitutes for checking that.

## Consequences

- **Nothing is added now.** Both instruments — velocity and a representative background — need the same input: accumulated `market_news`, now 295 documents/day. Velocity reports after ~4 runs; a usable background exists in a few weeks.
- **The stoplist is deliberately not grown.** Adding `earnings`, `q2`, `revenue` would be fitting to one day's data, and it is exactly the judgement velocity makes automatically and keeps making as the register changes. A hand-curated register list is [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md)'s hard-coded-themes problem in miniature.
- **The board ranks by share until velocity exists, and that ranking is register-dominated.** Stated rather than hidden: today the top of the list describes what financial writing sounds like, not what the market is arguing about.
- **The falsifiable test, four runs out:** `ai` and `capex` carry positive velocity while `earnings` sits near zero. If `earnings` also spikes, frequency-plus-velocity is insufficient and the price-link gate becomes necessary rather than merely better.
- **The price-link gate is designed but not built.** It is the strongest available discriminator and the one most aligned with the brief; it needs the same accumulated mention history, so it cannot be built earlier either.
- **Three rejections are recorded so they are not re-attempted.** The TF-IDF one in particular looks obviously right until the algebra is written down, and a future reader reaching for it will find the `−x·ln(x)` result here rather than re-deriving it.
