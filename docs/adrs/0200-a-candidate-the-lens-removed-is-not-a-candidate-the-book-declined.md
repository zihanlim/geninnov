# ADR-0200: A candidate the lens removed is not a candidate the book declined

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0015](0015-lens-mode-asset-class.md), [ADR-0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md), [ADR-0197](0197-a-lens-control-belongs-where-every-figure-can-follow-it.md), [ADR-0199](0199-the-step-that-removed-a-position-is-the-answer.md), [ADR-0046](0046-attention-chooses-what-we-look-at-not-what-is-tradable.md)

## Context

ADR-0197 built the disclosure boundary for `/mandate` and `/risk`: `lib/risk/lensScope.ts`
classifies every panel `book` / `published` / `mixed`, and `LensScopeBanner` / `LensScopeChip`
mark the ones that cannot follow the lens. That work was scoped to `RiskBody` because that is
where the mixing was: `/book` had *always* had the lens selector, so `/book` was assumed to be
the page that already got this right.

It was not. `/book?lens=credit` on the 2026-07-30 run rendered, under the heading
**"Cleared the screen — not taken"** and the body copy *"These names passed every screen and
still did not make the book"*:

| | on screen | should have been |
|---|---:|---:|
| candidates listed as not taken | **39** | 8 |
| of a pool of | **42** | 11 |
| shorts among them | **13** | 0 |

The names were UNG, GLD, BABA, SLV, KWEB, GDX, MSFT, QQQ, SPY, SMH, TSM, NOC, ARKK and 18
more — a commodity, a gold miner, three China equities and the US large-cap complex, offered
to a reader as ideas a **credit** book had looked at and passed over.

**The page already contradicted itself, twice, within one screen height.** `PoolDepth`
(now `BookFunnel`) read `11 candidates → 3 independent ideas → 3 held`. The screening funnel
one section below read, in its own words:

```
{ "stage": "lens = credit", "removed": 31, "remaining": 11,
  "reason": "Asset outside the selected asset-class lens." }
```

And the thesis directly above the panel read *"no short candidates exist in the pool, so a
long/short structure is not constructible from this screen"* — against a panel summarising
"39 held back · 13 short". One page, three pool sizes, and the largest one was the
multi-asset book's.

**Why nothing caught it.** `research_recommendations` and `book_holdings` were re-keyed on
`(run_date, lens)` by migration 062, and `tests/unit/lens-qualified-reads.test.ts` parses the
source to prove every read of those two tables carries an explicit lens filter. Every one
does — `BookBody`'s book read is `.eq("lens", resolved)`, and ADR-0197 tightened that test's
window when it found it could accept a neighbour's filter inside a `Promise.all`. The leak is
not an unqualified read of a lens-keyed table. It is a **fully-qualified read of a table that
has no lens column and never will**: `trade_candidates` is the L1 pool, written by
`rank_trade_candidates` before any lens is chosen, so there is exactly one candidate table and
every lens screens the same 42 rows. A guard that asks "does this read name a lens?" cannot see
a table that has no lens to name.

That makes this the mirror image of ADR-0197's defect, and the more dangerous half.
ADR-0197's `portfolio_positions` and `portfolio_risk` are the *published record*, and reading
them under a credit heading shows the multi-asset book's risk beside the credit book's — wrong,
disclosed, and at least a real book's real figure. Here the panel presents names that were
**never in this book's universe** as *evidence about its selection*. It is the page's answer to
the sharpest question a reviewer asks — "what did you look at and decline?" — and it was
answering with another book's homework. A reader could reasonably conclude the credit book
declined 13 shorts on judgement, when the mandate never offered it one.

ADR-0199, committed hours earlier, closes with *"Not carried: the 29/13 long-short skew of the
raw 42, which lives in `trade_candidates` — a table the frontend does not read."* The frontend
does read it, and had since the panel was built; that sentence is corrected here.

## Decision

**A panel that describes what a book chose from may only show the pool that book actually
screened. Where the shared L1 pool is wider than the lens, the excess is counted and named as
out-of-lens, not listed as declined.**

### 1. The pool comes from the book's own record of it, not from a second ticker list

The membership rule is `LENS_TICKER_FALLBACK` in `backend/services/q1_agent.py` — a hardcoded
per-asset-class ticker set. A copy of it in the frontend was rejected outright: it would be a
second authority on what "credit" means, drifting the first time a ticker is added to one and
not the other, and the drift is **invisible** — the page would simply list a name the agent
never saw, which is this defect reintroduced by the fix for it.

`lib/book/candidatePool.ts` derives the pool from `research_recommendations.independent_ideas`
instead: written by the same node that applied the filter, keyed on `(run_date, lens)`, and it
enumerates the pool **by name and by side** (complex members plus standalones, per side).
`/book` already reads it for `BookFunnel`. So the fix imports no ticker list at all.

**Keyed by side, not by ticker.** The credit lens admitted TLT *long*; it did not admit TLT
*short*, and the agent was never shown it. Membership is tested on `asset::direction`.

**`candidate_correlations` was the shorter route and is wrong.** It holds only candidates with
a measurable 252-day correlation, so a name with no usable return history is absent from it.
Keying off that map would silently drop in-lens candidates *for lacking history* — the exact
unmeasured-is-not-absent error `ClearedNotTaken`'s own docstring warns about, and the reason
that panel renders an em-dash rather than 0.00.

### 2. The gate is the measurement, never the lens's name

A pool is applied only where the funnel's own `lens = …` stage reports `removed > 0`. Under
`multi_asset` that stage reads `removed: 0` — there is nothing for this filter to remove — so
it returns null and `inLensCandidates` returns **the same array reference**, not a copy: the
default page cannot be perturbed even by a re-sort. `/book` with no `?lens=` still reads
33 not taken of 42.

No lens is special-cased by name. A lens added later that admits everything is correctly a
no-op with no edit here, and `"multi_asset"` appears nowhere in the gate.

### 3. Fails open

Where the funnel says the lens filtered but `independent_ideas` records no pool (a row written
before that column), the restriction is `null` and today's unfiltered list renders. An
over-long candidate list is the bug we already had; a wrongly-empty one claims the screen
cleared nothing, which is a worse and newly-manufactured falsehood. `poolAssets` returns
**null rather than an empty set** for the same reason — the two must not collapse.

### 4. The excluded names are counted, not silently dropped

A reader who knows the pool ran to 42 needs to be told where the other 31 went, *and* that
they were never candidates for this book rather than candidates it declined — that distinction
is the entire point of the panel. So the terminator now states the in-lens pool
(`8 not taken, of 11 candidates screened this run`, which agrees with the funnel and
`BookFunnel` for the first time) and a second line names the exclusion and its cause.

### 5. Both consumers read through it

`ClearedNotTaken` is the visible one. The other is each held row's **"also cleared, not taken"**
footer, which matched theme and direction against the same unfiltered pool — so a credit
position could offer an out-of-lens name as the alternative it was taken over. It deep-links
to `#cleared-${asset}-${direction}`, an id rendered by `ClearedNotTaken`, so a footer this
filter did not reach would link at an anchor the table no longer renders. Filtered once in
`BookBody` and shared, so the two cannot disagree about the pool.

The filter is applied **inside** `ClearedNotTaken` rather than by the caller, because the
truncation notice compares the pool length against the query's row cap
(`CANDIDATE_POOL_LIMIT`). Filtering upstream would leave that check comparing a *filtered*
length against the *raw* cap, which is how "this list is complete" and "the query was capped"
start disagreeing — the null-vs-zero distinction applied to list length, and the reason the
terminator exists.

### 6. The cap-30 stage is deliberately left alone

Under `multi_asset` the funnel's `candidate pool (cap 30)` stage removed 12 names, so that page
lists 12 names the agent was never shown either. Not folded in here: those names **did** clear
every filter and were truncated out of the LLM's context window by conviction rank, so the
honest answer is to say so *in the row*, not to hide the row. Hiding them would delete the only
evidence that the cap binds at all. Different defect, different fix, recorded here so it is a
known gap rather than an oversight.

## Consequences

**Good.**

- `/book?lens=credit` now agrees with itself: 8 not taken of 11, matching the funnel's
  `remaining: 11` and `BookFunnel`'s `11 candidates → 3 ideas → 3 held`.
- Zero shorts, matching the thesis's own sentence about the pool.
- All 8 rows now carry a **measured** correlation to a held name (EMB, +0.66 to +0.88).
  Previously every out-of-lens row read `—` / "unmeasured", because the credit row's
  `candidate_correlations` never contained them. That was the tell, visible on screen for
  anyone who read the column, and it is now structurally impossible: the pool and the
  correlation map come from the same row.
- The default page is unchanged by array identity, not by inspection.
- The rule generalises to a lens that does not exist yet.

**Costs, stated.**

- `independent_ideas` is the post-`cap 30` pool. Where a lens filters **and** the cap binds
  (no lens does today — credit leaves 11 of a 30 cap), the pool is a strict subset of the
  post-lens set and the panel would under-list. It cannot over-list, which is the direction
  that matters, but the exclusion count would then conflate two causes under one sentence.
- `trade_candidates` still has no lens column, so this is a **render-time** reconciliation of
  a schema-level gap. The durable fix is for `screen_candidates` to persist the names it
  dropped at the lens stage, not just the count; then the page could name them. Not done here
  because L5 output is not backfillable (see `scripts/backfill_regime.py`'s docstring), so
  every already-published row would keep the defect.
- `lens-qualified-reads.test.ts` still cannot see this class of bug. It asks whether a read of
  a *lens-keyed* table names a lens; the leak was a lens-*less* table feeding a panel that
  reads as the lens's own. A guard for "which lens-less tables reach a lens-following panel"
  is what `lib/risk/lensScope.ts` does for `RiskBody` by hand, and `/book` has no equivalent
  classification. That is the next gap, not closed here.
- The `themes` + `theme_signals_history` reads behind `AbstentionRoster` are untouched: theme
  scoring is genuinely lens-independent, and the roster's claim ("scored, and |Edge| fell below
  the abstain bar") is a statement about the theme universe rather than about this book's
  selection. Recorded so the omission is a decision.

**Rejected.**

- A copy of `LENS_TICKER_FALLBACK` in the frontend (§1).
- Keying membership off `candidate_correlations` (§1) or off the ticker alone (§1).
- Gating on `lens !== "multi_asset"` — reads identically today and is wrong for the next lens.
- Suppressing the panel entirely under a non-default lens: it would delete the credit book's
  best answer to "what did you decline?", which after this fix is a real answer — SHY, long,
  ρ +0.66 to EMB, genuinely independent and passed over.
- Folding the `cap 30` stage in (§6).
