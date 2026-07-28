# ADR-0141: The corpus and its denominator were both ours

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0007](0007-two-method-theme-discovery.md), [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0129](0129-ai-capex-is-a-theme-and-the-tracker-found-it-sideways.md), [ADR-0133](0133-two-methods-that-fail-differently-agreeing.md)

## Context

Asked why AI — plainly the dominant market conversation — was reading as a marginal narrative. Three defects, each hiding the next.

**1. Theme discovery never read the un-themed corpus.** [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md) built `market_news` specifically to break the circularity that `theme_discovery.corpus_from_theme_news` describes in its own docstring — and wired it into the daily tracker, **not into that function**. So discovery stayed circular after the ADR that claimed to fix it: it could only cluster what the eight anchor keyword queries had already asked for. `grep -c market_news scripts/theme_discovery.py` returned **0**.

**2. The tracker's denominator was 94% self-selected.** Share of voice was computed over `market_news + theme_news`:

| corpus | docs | AI-mentioning |
|---|---|---|
| un-themed | 100 | 34 (**34.0%**) |
| anchor-fetched | 1,688 | 92 (5.5%) |
| **blended — what was scored** | **1,788** | 126 (**7.0%**) |

AI was the largest narrative in the only unbiased sample and was diluted 5× by 1,688 documents fetched by asking about Fed, dollar, oil and China. The board duly read `us` 14.1%, `dollar` 13.5%, `oil` 12.8%, `fed` 9.3% — every one a thing we went looking for.

ADR-0128's own reasoning caused this. It argued that excluding themed news "would throw away most of the day's documents and leave share-of-voice computed on too small a denominator." That is wrong: a larger denominator of *self-selected* text does not improve the estimate, it corrupts it — and `covered_by` labelling cannot repair a denominator.

**3. A seed query named a narrative.** `"earnings" OR "guidance" OR "capital spending"` returned **52 of the corpus's 100 documents and 33 of its 34 AI-mentioning ones**. "Capital spending" is a capex synonym, so it does not ask what the market is discussing — it asks about one narrative, and right now capex stories *are* AI stories. The "AI is 34% of the un-themed corpus" figure was therefore a statement about the query.

## Decision

**Discovery reads both corpora; the tracker scores only the un-themed one.**

The two are different needs and the split matters. **Clustering** benefits from more text and computes no share, so discovery reads `market_news` *and* `theme_news` — un-themed first, so the half discovery cannot do without survives any row cap. **Share of voice** is a ratio, so its denominator must be an unbiased sample: the tracker scores `market_news` alone. Themed news is still collected and still used — for `covered_by` attribution, for the L5 agent, for clustering — just never as the denominator of a share.

The fallback keeps a biased reading rather than none, but says so loudly: *"Every share this run produces describes our own keyword mix, not market attention."*

**The seed queries name no narrative, and there are ten.** `"capital spending"` is gone. Five neutral queries were added, because Brave caps at 50 results per query and the original five overlapped down to 100 documents — too thin for a share, and thin enough that `MIN_DOC_COUNT=3` imposed a 3% visibility floor. Every addition is deliberately narrative-neutral: adding "technology" or "AI" would grow the corpus by pre-selecting the answer, which is the anchor-keyword failure wearing a fix's clothes.

## Consequences

- **Corpus 100 → 295 documents**, and AI measures **8.8%**, spread across queries with none dominant — a third of the figure the contaminated query produced, and far better evidence for being spread.
- **`us`, `dollar` and `oil` left the board entirely.** They were never market attention; they were our own queries reflected back.
- **Nothing was lost to the denominator change** because `narrative_signals` held exactly one day and **zero** computed velocities. A day later and every series would have carried a discontinuity.
- **Discovery, re-run with both fixes, produced `ai / earnings` as a Tier-2 two-method agreement** — and publisher contamination is gone (`nato / pravda / ukraine` → `nato / trump / ukraine`). But that run's corpus was 456 themed against 100 un-themed, and the AI Capex theme's own keywords contributed 84 AI headlines, so **it is not clean evidence of independent discovery**. The clean evidence is a separate two-method run over the un-themed corpus alone, which produced `ai / earnings / guidance` at Tier 2 from 100 documents that never mention AI.
- **The corpus is still one provider.** [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md)'s finding is untouched: widening the *queries* does not widen the *source*, and everything here rests on Brave's index.
- **Ten queries still shape the result.** `earnings` now tops the board partly because two queries ask about results season. The bias is smaller and no longer aligned with the eight themes the scoring layer already knows, which is the improvement — not neutrality, which no query set achieves.
