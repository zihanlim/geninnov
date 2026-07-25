# ADR-0071 — Pool metrics are not book metrics

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0067](0067-a-column-must-name-the-subset-it-measures.md), [0049](0049-the-guardrail-does-not-read-the-prose.md), [0061](0061-a-false-excuse-is-worse-than-none.md), [0040](0040-published-book-is-the-book-of-record.md)

## Context

The published `book_risks` panel on 2026-07-25 — the list a reviewer reads to learn what
could break the book — contained:

> **US geographic concentration:** pre-computed book metrics show US at **66.67%** versus
> the 35% cap (**31.67pp over**); UNH, JPM, NUE, and XLE additions would worsen this
> breach…

and, twice:

> …would also squeeze the **Gold Miners position (currently 7% of book)**

**Both are false of the book.** Measured against the same row's persisted metrics:

| claim | actual |
|---|---|
| US at 66.67%, 31.67pp over its cap | `geo_weights.US` = **35.00%**, `cap_utilisation.violations` = `[]` |
| Gold Miners at 7% of book | **no gold miner held** — sectors are China 18.53, Metals 12.24, Energy 8.77, Financials 6.23, Healthcare 4.63, Defense 4.63, Rates 4.34 |

The book is JPM, NUE, SVXY, UNH, XLE long; BABA, NOC, PDD, SLV short. It sits *exactly*
on its geography cap and breaches nothing.

**The model was not hallucinating. It was repeating what it was handed.**
`compute_book_metrics_node` runs **before** `reason_picks` and computes sector, geography
and exposure figures over the **screened candidate pool with equal weights** — its own
docstring says so: *"Runs on candidates (not yet sized picks)… We use equal weight here
since the LLM hasn't picked yet."* The prompt then presented that block under the header:

```
=== BOOK METRICS (computed, not estimated) ===
```

The arithmetic closes exactly. `screen_candidates` caps the pool at **30** names, so
**20/30 = 66.67%** US and **2/30 = 6.67% ≈ "7%"** Gold Miners (GDX, NEM — both in the pool,
neither in the book). Every figure the thesis quoted is the equal-weighted pool number,
reported faithfully under a label that said *book*.

This is [ADR-0067](0067-a-column-must-name-the-subset-it-measures.md)'s rule — *a column
must name the subset it measures* — displaced from the UI into the prompt, and the
consequence is worse: a UI mislabel misleads a reader, while a prompt mislabel makes the
system **publish a false claim of a governance breach in its own risk disclosures**.

## Decision

**Label the block as what it is, forbid restating it as the book's, and check the one
falsifiable half.**

1. **The prompt header now reads `CANDIDATE-POOL METRICS — EQUAL-WEIGHTED, BEFORE YOUR
   SELECTION`**, states that the pool has ~30 names and the book will have ~10, and says
   outright: *never state them as the book's own composition, and never claim a cap breach
   from them — the sizer enforces every cap after you pick.*
2. **`check_cap_breach_claims` rejects a thesis claiming a cap breach when
   `cap_utilisation.violations` is empty.** That is the [ADR-0049](0049-the-guardrail-does-not-read-the-prose.md)
   rule again — *a number the system computes should never be re-typed by the model* —
   applied to caps, and it is exactly falsifiable: the sizer computes violations on the
   real book.
3. **It stays silent when the book genuinely breaches a cap.** A real breach *should* be
   discussed in `book_risks`; suppressing that would trade a false positive for a far
   worse false negative.
4. **Composition figures in prose are left to the prompt, not the guard.** Checking every
   sector and geography number a thesis mentions would mean adjudicating language, which
   is the unfalsifiable verdict [ADR-0045](0045-turnover-on-names-without-a-verdict.md)
   refused for turnover. Only the cap claim is mechanically decidable, so only it is
   mechanised.

## Consequences

- **Verified against live production, as a negative control**: the guard flags the exact
  published sentence — *"book_risks[3] claims a cap breach … but cap_utilisation.violations
  is empty"* — and stays quiet on the other five risk items, which are ordinary prose.
- **The daily guard reports the current book as failing until a new run publishes under
  the corrected prompt.** That is the check telling the truth, not a regression.
- **A test of mine had to be corrected too.** `test_guard_runs_as_a_script_not_only_as_a_module`
  asserted the guard exits `0` or `2` against production; it broke the instant a check
  legitimately fired. **A test that fails when a guard correctly reports a defect is
  testing the wrong thing** — it now accepts `1` and asserts only that nothing crashed,
  which was always its actual purpose.
- **Open, and named:** the pool metrics are still the only book-level context the agent
  gets before choosing, so it reasons about crowding from a 30-name equal-weighted proxy.
  Giving it post-selection metrics would require a second pass over its own picks. That is
  a real design question and is deliberately not answered here.
