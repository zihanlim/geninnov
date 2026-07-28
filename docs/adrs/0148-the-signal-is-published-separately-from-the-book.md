# ADR-0148: The signal is published separately from the book

**Status:** Accepted
**Date:** 2026-07-29

## Context

Andromeda publishes a book sized to $100M under a 20% single-name / 30% sector / 35%
geography cap set and a 100% gross budget. Those constraints belong to **one
hypothetical fund** — the one [ADR-0147](0147-the-mandate-is-a-parameter-not-an-ambient-fact.md)
made explicit.

Every consumer-facing surface emitted only the sized output: `/book`, and all ten MCP
tools in `frontend/lib/chat/tools.ts`. `book_summary` returns weights and notionals.
`position_detail` returns a sizing derivation. `sizing_provenance` returns which
sizer ran.

So a portfolio-management application running its own capital base and its own limits
could consume **none of it**. Everything on offer was denominated in someone else's
mandate, and the one number such a caller actually needs —
`conviction = |EdgeScore| / vol` — was not a first-class output at all. It appeared
only as a column inside a sizing derivation, beside weights that were not theirs.

The observation that prompted this: *"a portfolio management app will not be able to
properly use this andromeda research tool since the recommendations are already
coloured by the 100m and mandate."* That is correct, and it is a design defect rather
than a limitation.

### The underlying fusion

Research and portfolio construction are different jobs:

```
signal   (mandate-free)   what we think, and why
  + mandate (a parameter)
  -> sizing = f(signal, mandate)
```

`q1_agent` already had this shape. Its nodes run
`… -> reason_picks (LLM) -> verify_citations -> size_positions -> persist`: the LLM
chooses names and sides, and a separate node turns them into weights. What was missing
is that **the intermediate was never persisted**, so the only artefact that escaped
was the one with a mandate baked in.

## Decision

**Persist the signal as its own artefact, captured before anything sizes it.**

1. **`extract_signal` is called between the citation retry loop and
   `size_positions`** — the one point where the picks are final and nothing has sized
   them. That placement makes the mandate-free claim *structural*: there are no
   weights in scope to leak, because they do not exist until the next line.

2. **`book_signal` is one row per NAME**, not one row per run. A consumer asking
   "what do you think about VRT" should not have to fetch and filter a book-shaped
   jsonb blob, and there is no column on that table that could hold a weight.

3. **`conviction` is carried, and is the point.** It is a ratio — edge per unit of
   volatility — so it is identical at $100M and at $5bn. Mandate-free by
   construction, and the input any sizer wants.

4. **Sector and geography travel with it.** They are facts about the *instrument*,
   not the mandate, and a consumer applying their own sector cap cannot do it without
   them. They come from `book_metrics.ASSETS`, which
   [ADR-0121](0121-one-record-per-ticker.md)/[ADR-0125](0125-derived-views-not-parallel-dicts.md)
   made the single record for a ticker's identity — so the frontend reads them from
   this row rather than keeping a second copy that could drift.

5. **Two new MCP tools.** `signal` returns the research with no mandate on it;
   `size_book(mandate)` sizes it under a caller-supplied one (see
   [ADR-0149](0149-request-time-sizing-calls-the-real-optimizer.md)).

### The guarantee is an absence, so it is asserted

`FORBIDDEN_FIELDS` enumerates what may never appear: `weight`, `signed_weight`,
`notional`, `cash`, `gross`, `total_capital`. It is an explicit list rather than a
"copy everything except…" filter, because a blocklist silently admits whatever sizing
field a future node happens to add — and the whole contract of this payload is what
it excludes.

An absence is invisible in code review. So a test hands `extract_signal` a **fully
sized book** and asserts the strip holds: if someone ever wires the pipeline the wrong
way round, the failure is caught here rather than by a consumer receiving weights in a
mandate that is not theirs.

## Consequences

**Andromeda becomes consumable by an external portfolio application.** Verified live
over `POST /api/mcp`: `tools/list` returns 12, and `signal` returns 32 facts for
2026-07-28 with no key containing `weight` or `notional`.

**The $100M book is reframed as one instantiation**, not the answer. Same signal,
different mandate, different book.

**Every score persists as `None` rather than `0.0` when absent.** "No edge" and "zero
edge" are different claims ([ADR-0066](0066-not-computable-must-persist-as-null.md)),
and a `NOT NULL DEFAULT 0` on that column would silently convert the first into the
second.

**The signal write is non-fatal and ordered after the book.** The book is the
deliverable; a signal write that fails must not cost a run that already produced a
publishable book. The reverse ordering would let a missing migration take down the
pipeline.

**A backfill was possible and was done.** 2026-07-28's ten names were reconstructed
from the published book joined to `portfolio_positions`, which carries the edge,
conviction and vol columns. This is legitimate under the same rule
`scripts/backfill_regime.py` states: it is arithmetic over already-persisted data, and
re-makes no judgement.

## Alternatives considered

**A column on `research_recommendations`.** Rejected: one row per run means a
consumer interested in one name parses a book-shaped blob, and a jsonb column can hold
anything — including, eventually, a weight. A table with no weight column cannot.

**Derive the signal in the frontend from the published picks.** Rejected: the picks
are already sized, so this would be reverse-engineering the mandate back out —
precisely the work this ADR exists to spare a consumer. It would also be a second
implementation of a derivation the backend already performs.

**Expose `conviction` on the existing `book_summary` tool and stop there.** Rejected
as half the fix. It would put a mandate-free number inside a payload whose every other
field is mandate-bound, leaving the caller to know which is which.
