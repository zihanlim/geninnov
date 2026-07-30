---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0188 — The risk phase measured a book that did not exist yet

## Context

The owner asked whether `Sizing` should come before `Risk` in the rail.

The six-phase strip is the site's navigation (ADR-0170) and it teaches the
process before a reader has read anything, so the order is a claim. It read:

```
01 Mandate · 02 Alpha · 03 Risk · 04 Construction · 05 Execution · 06 Attribution
```

**The pipeline settles it in its own words.** `q1_agent.finalise_book_analytics`:

> *"Recompute book metrics, correlations and stress scenarios against the FINAL
> SIZED book. `compute_book_metrics_node` and `run_scenario_analysis_node` run
> before reason_picks, over the equal-weighted candidate pool, because the LLM
> needs them as prompt context. That makes them a description of a portfolio
> nobody holds… This node runs last, on the real book, and writes machine-readable
> dicts that `_persist_to_supabase` stores and **the /risk page renders**."*

So the scenario pass that happens before selection is 30 candidates at 3.3% each,
exists as prompt context, and is discarded. Every figure a reader sees on `/risk`
— `scenario_results`, `risk_decomposition`, `monte_carlo_var`, `var_forecast`,
correlation, factor tilt — is written after `size_positions`. The page's own lede
says as much: *"a pure function of the recommended weights."* Phase 3 could not
be produced without phase 4 having already happened.

**Where the drift came from.** The order was right for the phase as originally
written. Phase 3 was **"Catalyst & scenario"** — a question about an *idea*, which
a PM does ask before sizing. ADR-0172 renamed it **"Risk & scenario"** and gave it
the `/risk` route, noting that "the six-phase sequence is untouched". The sequence
was untouched; the *phase* was not. The rename moved it from idea-level to
book-level and left it standing in the idea-level position.

## Decision

**Swap: `03 Construction & sizing`, `04 Risk & scenario`.**

```
01 Mandate · 02 Alpha · 03 Construction · 04 Risk · 05 Execution · 06 Attribution
```

Two entries in `lib/method/phases.ts` reorder and renumber. Nothing else moves:
`TopBar`, `SideRail` and `ProcessMap` all render that array directly — ADR-0170's
"there is only one list" is what makes this a two-line change rather than a sweep.

Routes, ids, anchors and page content are untouched. `/book` is still
`/book` and `/risk` is still `/risk`; only their position in the sequence and
their displayed number change.

`risk-sections.test.ts` now asserts **the pair** — phase 4 is `risk` *and* phase 3
is `construction` — because a swap that renumbered one and not the other would
leave two phases claiming one position with nothing to catch it.

## Consequences

Verified live: the rail reads Mandate · Alpha · Sizing · Risk · Execution ·
Outcome; `/book` marks `03 Construction` current and `/risk` marks `04 Risk`; the
`/method` process map renders `01…06` in the new order. 982 frontend tests green,
`tsc --noEmit` clean, no console errors.

Costs:

- **The numbering is user-visible and now differs from three ADRs.** ADR-0169,
  ADR-0170 and ADR-0172 all quote `03 Risk · 04 Construction`. They stay as
  written — they are the record of what was decided then — and this supersedes
  them. Anyone reading them cold will see a sequence the app no longer has.
- **It moves away from the canonical PM workflow** that `task.md` Q1 is answered
  against, where scenario work precedes construction. The defence is that this
  system's phase 4 is not idea-level scenario work; if a genuinely idea-level
  catalyst surface is ever built, it wants its own phase before construction, not
  this one back.
- **Phase 1 is still "Mandate & risk architecture".** Risk now appears at both
  ends of the sequence — limits before anything, measurement after the book. That
  is correct but it does mean the word does two jobs in one strip.
- **`/risk`'s per-position attribution sits in phase 4 while phase 6 is called
  Attribution.** Pre-existing (`phaseSections.ts` documents it: one is ex-ante,
  one is ex-post), and the swap puts the two words two tabs apart instead of
  three.

Rejected:

- **Keep the order and restore phase 3 to idea-level scope.** It would mean moving
  VaR, the stress matrix and per-position attribution off `/risk` to somewhere
  after `/book`. That content has to live somewhere, and a page called Risk is
  where a reader looks for it.
- **Leave it.** The strip is the one piece of this site that teaches the process
  without being read, so an order the pipeline contradicts is the most expensive
  place to be wrong.
- **Renumber without reordering the array.** `TopBar` and `SideRail` render the
  array in order; the number and the position would disagree.
