# ADR-0128: A theme we did not name in advance

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0007](0007-two-method-theme-discovery.md), [ADR-0042](0042-absolute-subscores.md), [ADR-0047](0047-conviction-vol-floor.md), [ADR-0054](0054-a-daily-publication-not-a-scanner.md), [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md), [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md), [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md)

## Context

The brief asks for a daily process that **identifies which themes are trending**. This system identified which of **eight** themes were trending, and the eight were hard-coded twice: as rows in `themes` (`001_initial_schema.sql:163`) and as keyword lists in `brave_client.THEME_KEYWORDS`.

Attention was measured by asking Brave for those keywords. So a narrative that did not lexically match one of eight lists was not *low-scoring* — it was **structurally invisible**, with no counter, no series and no row. The brief's own examples land differently against that universe:

| Example | Status |
|---|---|
| central bank hawkish/dovish pivot | covered by Fed Policy — though US-only; there is no ECB or BoJ theme, and PBOC sits inside China Growth |
| dollar debasement | *partially* covered. `US Dollar` asks for `US dollar, DXY, currency, FX, dollar weakness/strength` — the cyclical dollar. The fiscal / de-dollarisation / gold-as-reserve framing that makes debasement a distinct narrative is asked for by nothing |
| AI capex cycle | **no theme, no keyword, no mapped asset.** Invisible |

`theme_discovery.py` was supposed to answer this. It cannot, for two reasons its own docstring concedes:

1. **Its corpus is circular.** It reads `theme_news`, which was collected using those same eight keyword queries. It can only surface sub-themes of narratives already named.
2. **It runs monthly, and it does not run here.** SBERT + UMAP + HDBSCAN + LDA is a multi-hundred-megabyte dependency tree that is not installed in CI — `import gensim` fails outright, and 14 tests in `test_theme_discovery.py` have been failing on that for some time. The one component meant to find new themes does not execute in the environment that runs everything else.

## Decision

**Collect a corpus nobody selected, and track every phrase in it daily.**

Three parts.

### 1. An un-themed corpus

`brave_client.MARKET_SEED_QUERIES` asks about the **market**, not about a theme — *"stock market OR equities OR bond market"*, *"earnings OR guidance OR capital spending"* — and accepts whatever returns. Results land in `market_news`, a table separate from `theme_news` **by design**: `theme_news` answers "what was said about Fed Policy" and the L5 agent reads it per theme, so un-themed headlines merged under a sentinel row would enter the agent's per-theme reasoning context as evidence about a theme that did not collect them.

`fetch_market_news` has **no mock fallback**, the only fetcher in the repo without one. Mock headlines come from a fixed template; a frequency tracker reading them would "discover" the template's own vocabulary and report it as an emerging market narrative. An empty corpus produces no signal, which is the truth.

This widens the aperture; it does not remove it. A query is still an editorial act. What it buys is that the aperture is no longer *the same eight labels the scoring layer already knows*.

### 2. A daily, dependency-free tracker

`backend/services/narrative_tracker.py` is deliberately the **cheap** method: document frequency over 1–3-grams, share of voice, and a robust velocity against each phrase's own history. No embeddings, no topic model, no downloads — `statistics` and `re`. That buys three things the heavy method cannot:

- it runs **every day**, so a narrative forming over a week is visible on day two rather than at the next month boundary;
- it runs **in CI**, so the logic is tested rather than asserted (39 tests);
- it is **deterministic**, which [ADR-0013](0013-determinism.md) requires and HDBSCAN-over-UMAP does not offer.

Design points that are load-bearing rather than incidental:

- **Share of voice, not document count.** The corpus size swings with how many articles the fetch returned, so a raw count rises on a day the fetcher simply worked better. Share is the only version comparable across days — it is also exactly Google Trends' normalisation.
- **A MAD floor on the velocity scale** (`SHARE_SCALE_FLOOR`), for the same reason as [ADR-0047](0047-conviction-vol-floor.md)'s conviction vol floor. A phrase flat at one share for eight days has MAD 0, so a raw z is 0/0. Refusing to score there is backwards: a departure from a perfectly stable base is the *strongest* evidence of a break, and it is precisely the shape a new narrative makes. Without the floor, the phrases most likely to be new — least history, least spread — are exactly the ones the statistic declines to score.
- **A two-letter minimum token length, not three.** Three deleted `ai`, and with it every phrase the AI capex narrative is expressed in — the single example the brief names. It also deleted `eu`, `uk`, `em`, `hy`, `qt`. Two-letter grammatical words belong in the stoplist, which can tell `as` from `AI`; a length rule cannot.
- **`covered_by`.** Every phrase is labelled with the anchor theme whose keywords already ask for it. This is the field that makes the output answer the question: a surge in `fomc` is Fed Policy doing its job; a surge in `ai capex cycle` is a narrative nothing in the pipeline is watching. The emerging shortlist excludes the covered.
- **Both corpora are read, not just the un-themed one.** Excluding themed news would discard most of the day's documents and compute share of voice against too small a denominator. What keeps it honest is `covered_by`, not exclusion.

### 3. A trends board

`NarrativeTrends` plots share of voice over time for the loudest narratives, with the emerging-and-uncovered shortlist beneath. Written against [ADR-0126](0126-a-chart-without-a-value-axis-is-a-shape.md): value axis with tick labels, every line direct-labelled at its right end with a leader line where the anti-collision pass displaces it, and a figures table — a tooltip is never the only copy of a number.

Its palette is **validated, not chosen**: `--series-1..5` in `globals.css`, run through the dataviz validator against this app's white card surface (worst adjacent CVD pair ΔE 9.1 protan, normal-vision ΔE 22.9). Two slots carry sub-3:1 contrast warnings, which are legal **only** with visible labels or a table view; both are present, and a test asserts they stay. `--long`/`--short` are deliberately not reused: ADR-0126 measured them at ΔE 6.1 under deuteranopia, and they already mean *direction* everywhere in this app. A narrative has no direction.

## Consequences

- **Nothing here enters the book.** `narrative_signals` is shadow, on the same footing as `discovered_themes` (RESIDUAL R5). No phrase sizes a position, joins the theme board, or reaches the L5 agent without an operator promoting it. A phrase trending in the news is evidence a narrative *exists*, not evidence it is *tradeable* — the tradeable claim needs mapped instruments and a measured price link, which an anchor theme has and a fresh phrase does not.
- **This does not replace the two-method agreement.** Frequency-and-velocity is a weaker claim than "LDA and embedding clustering independently found this". The monthly job is unchanged; `methods` on the persisted row records which method saw a candidate, so agreement between them is a stronger signal than either alone. Wiring that comparison is not done.
- **The first several days will show every phrase as `new`.** Velocity needs history the table does not have yet, and the tracker says so rather than reporting a 0.0 that reads as "flat".
- **`gensim` is still not installed, and `test_theme_discovery.py` still fails.** This ADR routes around that dependency rather than fixing it; the monthly job remains untested in CI and unrunnable locally. That is a known gap, not a solved one.
- **The attention signal still rests on one provider.** Widening the *queries* does not widen the *source* — this is still Brave, and [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md)'s finding stands unchanged. A narrative Brave's index under-covers is still under-counted here, and now it is under-counted across a wider aperture.
- **A phrase is not a theme.** `ai capex cycle` as an n-gram has no mapped instruments, no asset class, and therefore no HypeScore, no EdgeScore and no position. Promoting one into the live board means hand-authoring its `theme_assets` mapping — which is the step that makes it tradeable and the step nothing here automates. The gap between "we can see it" and "we can trade it" is now visible instead of hidden, which is progress, but it is not closed.

- **The first live run found two defects the unit tests could not.** Run against the accumulated 453-document corpus: `fxstreet` ranked as the **6th-loudest narrative of the day at 8.4% share, above OPEC** — headlines carry `| Publisher` attribution and it was being tokenised as content. And `fed` (9.3%) and `rates` (7.7%) both reported `covered_by = None`, i.e. *"nothing is watching this"*, because `"Federal Reserve"` tokenises to `{federal, reserve}` and never matches the token `fed`. Fixed by `strip_attribution` (structural — it removes the tail whatever publisher it names), a publisher blocklist as backstop, plural folding, and `THEME_COVERAGE_ALIASES`. Both were invisible to a fixture and obvious in one run against real headlines.
- **`anchor_for_phrase` deliberately over-attributes rather than under-attributes.** A single generic token is no longer claimed by a multi-word keyword — `us`, the loudest phrase in the live corpus at 14.1%, was being attributed to US Dollar — but the alias list otherwise errs toward marking things covered. That is the right direction: a phrase wrongly marked covered is missing from a shortlist, while a phrase wrongly marked uncovered is a **false claim that nothing is watching it**, and the shortlist's only value is that its entries are real.
- **The alias list is fitted to one day's corpus and will need extending.** It cannot change what the tracker *sees* — only how a seen phrase is attributed — so the failure mode is a shortlist entry that should have been filtered, not a missed narrative. Still, `york`, `house` and `united states` currently sit in the uncovered tail as generic noise, and a stoplist is a silent editorial decision about what counts as a narrative.
