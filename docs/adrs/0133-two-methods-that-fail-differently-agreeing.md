# ADR-0133: Two methods that fail differently, agreeing

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0007](0007-two-method-theme-discovery.md), [ADR-0064](0064-one-formula-one-place.md), [ADR-0110](0110-crowding-caps-what-it-can-see.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0129](0129-ai-capex-is-a-theme-and-the-tracker-found-it-sideways.md), [ADR-0130](0130-fourteen-tests-were-ungated-by-where-an-import-sat.md)

## Context

Two independent methods now propose narratives over the same corpus:

- **frequency** — `narrative_tracker`, daily. Document frequency over n-grams, share of voice, robust velocity. Cheap, deterministic, dependency-free.
- **lda ∩ embedding** — `scripts/theme_discovery`, monthly. LDA topics and SBERT→UMAP→HDBSCAN clusters, promoted where the two agree ([ADR-0007](0007-two-method-theme-discovery.md)).

[ADR-0128](0128-a-theme-we-did-not-name-in-advance.md) observed that *"agreement between them is a stronger signal than either alone"* and then stated plainly: **"Wiring that comparison is not done."** This is that wiring — and building it surfaced a defect that made it unsafe to build first.

**Three of the eleven candidates in the live 2026-07-24 discovery run are built on publisher names.** Two of them are **Tier 2** — the tier that exists to mean *two independent methods agreed*:

| Candidate | Tier |
|---|---|
| `dollar / forecast / fxstreet` | **2** |
| `nato / pravda / ukraine` | **2** |
| `fxstreet / high / nato` | 3 |

They agreed on a byline. `theme_discovery.preprocess` kept its own tokenizer, and it carried all three defects that were fixed in `narrative_tracker` earlier the same day: no trailing-attribution stripping, no publisher stoplist, and `len(t) > 2` — which deletes `ai`, so the discovery job could not have found the AI capex narrative even given a perfect corpus.

Wiring corroboration on top of that would have **laundered publisher noise into the strongest badge the system emits**.

## Decision

**Fix the source first: one tokenizer, one stoplist.**

`theme_discovery.preprocess` now delegates to `narrative_tracker.tokenize`. This is [ADR-0064](0064-one-formula-one-place.md)'s one-formula-one-place applied to a wordlist — the two implementations diverged precisely because they were two implementations.

It also closes a hole in [ADR-0130](0130-fourteen-tests-were-ungated-by-where-an-import-sat.md). That ADR moved the module-scope ML imports and missed this one: `preprocess` did `from gensim.parsing.preprocessing import STOPWORDS` **inside** a function the module calls pure, so `cluster_term_sets` still failed without the stack — and CI, which deliberately does not install gensim, **would have gone red on the next push**, caused by ADR-0130's own removal of the `--ignore`. The guard test asserted `callable(...)`, which is true of any function that has been defined and says nothing about whether it runs. It now *runs* them.

**Corroborate on ≥ 2 shared tokens, measured rather than picked.**

A narrative phrase corroborates a discovered candidate when their token sets share at least `MIN_TERM_OVERLAP = 2` terms. Measured over the 2026-07-28 signals against the 2026-07-24 discovery run:

- at **≥ 1** the top matches are `oil`, `dollar`, `fxstreet` — a single word in common, which two methods over one corpus produce constantly by chance.
- at **≥ 2** they are `credit spreads` ↔ *credit / high / spreads*, `federal reserve` ↔ *federal / rates / reserve*, `china gdp` ↔ *china / chinas / chinese*, `rate hike` ↔ *fed / hike / holds*. Those are the same narrative found twice.

Live result: **20 of 506 narratives corroborated.** A consequence worth stating: a **one-token phrase can never be corroborated**, because it cannot share two tokens with anything. Deliberate, and the same argument as `anchor_for_phrase`'s single-token rule — one word is too thin to assert two methods found the same thing.

**What the claim actually is.** Not "two votes beat one". The two methods **fail differently**: frequency is fooled by a repeated boilerplate phrase, clustering by a topic that is coherent but tiny. Neither failure mode explains both, which is what makes the conjunction informative.

## Consequences

- **Still shadow.** Corroboration raises confidence a narrative *exists*; it says nothing about tradeability, which needs mapped instruments and a measured price link ([ADR-0129](0129-ai-capex-is-a-theme-and-the-tracker-found-it-sideways.md)). Nothing here sizes a position.
- **It is not a simultaneous second opinion.** Discovery runs monthly, so today's phrases are matched against a candidate set up to a month old. `days_stale` travels with every match so a reader can discount it rather than assume the two ran together.
- **The publisher fix is upstream and takes effect at the next monthly run.** The rows currently in `discovered_themes` still contain `fxstreet` and `pravda`, so today's corroborations include `dollar index` ↔ *dollar / forecast / fxstreet*. The match itself is sound — `dollar` and `index` are real shared terms — but the candidate's *label* will keep reading badly until discovery re-runs. Not backfilled: re-deriving a past run's clusters without its corpus would be fabrication.
- **An unmatched signal is returned bit-identical.** `apply_corroboration` rebuilds only matched records (the dataclass is frozen), so adding this to a live board cannot move a number on a narrative nobody corroborated — the same property [ADR-0110](0110-crowding-caps-what-it-can-see.md) holds for sizing, and the reason it is safe to wire in.
- **Corroboration re-persists after the tracker has already written.** A failure in the agreement step costs the badge, never the day's signals.
- **Only the newest discovery run is used**, not every run in the window. Unioning several would let a candidate dropped by a later run keep corroborating today, silently resurrecting a rejected hypothesis.
- **The generalisable lesson is about `callable`.** A guard that checks a function exists is not a guard that it works, and the difference is invisible in a green suite. Where a test exists to prove a dependency is absent, it has to execute the code path that would need it.
