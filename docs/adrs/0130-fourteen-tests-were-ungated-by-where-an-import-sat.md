# ADR-0130: Fourteen tests were ungated by where an import sat

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0007](0007-two-method-theme-discovery.md), [ADR-0023](0023-data-provenance-and-fabrication-guard.md), [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md), [ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md)

## Context

`scripts/theme_discovery.py` opened with this claim:

> *"The heavy ML (SBERT / UMAP / HDBSCAN / LDA) lives in run_discovery; the agreement + labelling logic is factored into **pure functions that are unit-tested without the models**."*

Half of it was true. The logic *was* factored into pure functions — `agree_themes`, `cluster_term_sets`, `corpus_from_theme_news`, `persist_discovered_themes`. The other half was false, and four lines made it false:

```python
from gensim import corpora
from gensim import models
from sentence_transformers import SentenceTransformer
import umap
import hdbscan
```

At **module scope**. Importing the module for its pure functions imported torch. So the functions were not unit-testable without the models; they were merely *written* as if they were.

CI had already met this and worked around it, in `ci.yml`:

```yaml
# test_theme_discovery.py is excluded: scripts/theme_discovery.py imports
# gensim / sentence_transformers / umap / hdbscan at module scope, and
# installing those to run 14 tests means pulling torch into every push.
# It stays covered by the monthly theme-discovery workflow actually running.
- run: pytest tests/backend/ --ignore=tests/backend/test_theme_discovery.py
```

The diagnosis in that comment is exactly right. The remedy was not: it exempted the tests rather than moving the imports, and the justification — *"it stays covered by the monthly workflow actually running"* — conflates **a job executing** with **logic being tested**. The monthly job running proves `run_discovery` did not crash on that corpus. It proves nothing about whether Tier-2 agreement promotes at the right overlap threshold, which is what the excluded tests check.

The measurement that settles it: **not one of the 14 excluded tests touches a model.** `grep` for `SentenceTransformer|umap\.|hdbscan\.|models\.Lda|corpora\.` across the test file returns nothing. Fourteen tests were ungated entirely by where four import statements sat.

This is [ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md)'s failure in a different costume — a guard reporting on a smaller surface than a reader believes, with a comment asserting coverage that does not exist. It is also the specific gap [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md) recorded and routed around rather than fixed: *"`gensim` is still not installed, and `test_theme_discovery.py` still fails. This ADR routes around that dependency rather than fixing it."*

## Decision

**Move the ML imports inside `run_discovery`, past the corpus-size gate.**

Not merely to the top of the function — *after* the `len(corpus) < MIN_DOCS_PER_THEME` check. Steps 1 and 5 (assemble corpus, agree, persist) need no model; only steps 2–4 do. Loading a multi-hundred-megabyte tree to then discover the corpus holds twelve documents is pure cost, and placing the import after the gate keeps the "corpus too small" path testable without the ML as well.

**`ImportError` is deliberately not caught.** Past the gate the function cannot do its job without the models, and a discovery run that silently returns `None` because a dependency is missing is precisely the failure [ADR-0023](0023-data-provenance-and-fabrication-guard.md) exists to prevent. The monthly workflow must fail loudly so the absence is visible, rather than degrading into "no candidates found" — which is indistinguishable from a real result.

**CI gates the whole file.** The `--ignore` is gone; `pytest tests/backend/` now runs 1113 tests, up from 1097, with **no new dependency installed**. The monthly `theme-discovery.yml` still installs the full CPU-only torch stack, because that is the job that actually runs the models.

**A guard replaces the comment.** `TestImportsWithoutTheModels` does two things:

- imports the module in a **subprocess** with `gensim`, `sentence_transformers`, `umap`, `hdbscan` and `torch` blocked by a `sys.meta_path` finder, and asserts the pure surface is reachable and callable. A subprocess because the property is about a *fresh interpreter*: in-process, another test may already have imported the real modules and `sys.modules` would mask a module-scope import that fails on a clean machine.
- greps the source for a heavy import at column 0, which is cheap and names the exact line a future edit would add.

The docstring now describes what the code does rather than what its author intended.

## Consequences

- **The backend suite is fully green — 1113 passing, 0 failing.** It has been showing 14 reds locally throughout, which trains the eye to skip them; a suite with permanent known-failures is a suite nobody reads.
- **CI coverage grew without CI cost.** No install changed. The 16 tests now gated (14 existing + 2 new guards) cover the agreement threshold, tier assignment, corpus dedup/mock-dropping, and the persistence contract — the logic ADR-0007 is about.
- **A behavioural improvement fell out of the placement.** `run_discovery` on an undersized corpus now returns without importing torch at all, which is the common case on a bootstrap or a stubbed test.
- **This does not make theme discovery testable end to end.** `run_discovery`'s ML path — SBERT encoding, UMAP reduction, HDBSCAN clustering, LDA topics — is still exercised only by the monthly job actually running, and is still untested in CI. The claim this ADR makes is narrower and now true: the *pure* logic is tested without the models. The ML path remains covered by execution, not by assertion.
- **The general lesson is about where a dependency is declared, not which one.** A module-scope import is a dependency of *importing*, and everything that imports the module inherits it — including a test that only wants a pure function. When a heavy dependency is used by one function, the import belongs in that function; otherwise the cost is paid by every consumer and the first one to object writes an exclusion instead of a fix.
