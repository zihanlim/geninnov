# ADR-0201: A name the cap cut is marked, and a name the lens removed is hidden

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0200](0200-a-candidate-the-lens-removed-is-not-a-candidate-the-book-declined.md), [ADR-0199](0199-the-step-that-removed-a-position-is-the-answer.md), [ADR-0046](0046-attention-chooses-what-we-look-at-not-what-is-tradable.md), [ADR-0048](0048-count-independent-ideas-not-candidates.md), [ADR-0056](0056-an-instruction-is-not-a-guardrail.md)

## Context

ADR-0200 fixed `/book`'s "Cleared the screen — not taken" panel for a lens: the credit
book had listed 31 names its own screening funnel removed at the `lens = credit` stage.
It closed by naming a second, quieter instance of the same class and **deferring it on
purpose**:

> *Under `multi_asset` the funnel's `candidate pool (cap 30)` stage removed 12 names, so
> that page lists 12 names the agent was never shown either. Not folded in here: those
> names **did** clear every filter and were truncated out of the LLM's context window by
> conviction rank, so the honest answer is to say so in the row, not to hide the row.*

This is that fix. It matters more than the count suggests, because unlike ADR-0200's it is
on the **default** page — the one a live submission is read from. 12 of 33 rows, more than
a third, under body copy that reads *"These names passed every screen and still did not
make the book."* That sentence is true about the screen and false about the book: nothing
in the book weighed VST short, FXI short or the other ten. A context-window limit did.

The stage is not a screen and does not pretend to be. Its own `reason` string says so:

```
{ "stage": "candidate pool (cap 30)", "removed": 12, "remaining": 30,
  "reason": "Truncated to fit the LLM context window, keeping the highest |EdgeScore|.
             Ordered by conviction and NOT by attention: this cap decides what is
             discarded, and ranking it by HypeScore re-imposed the attention gate one
             layer below the gate itself (ADR-0046)." }
```

So the panel was attributing a **selection** to the agent for a set of names chosen by an
`[:30]` slice. That is the same error ADR-0056 caught one level up when `PoolDepth` pointed
readers at prose that did not account for a declined idea, and the same one this panel's own
docstring refuses when it declines to invent a reason L5 never gave: *"inventing one here
would be the kind of confident narration this codebase keeps removing."*

## Decision

**A candidate that never reached the agent is disclosed either way, but the treatment
follows what is factually true of its row: a name the LENS removed is hidden, a name the
CAP cut is kept and marked.**

The asymmetry is not a style choice, and it is the whole content of this ADR:

| | did it clear this book's screen? | was it not taken? | so the row is… | treatment |
|---|---|---|---|---|
| lens removed it | **no** — never in this book's universe | n/a | a false claim | **hidden**, counted (ADR-0200) |
| cap cut it | **yes** — passed every filter | **yes** | true; only the *implication* that something chose against it is false | **kept**, marked |

And one more reason the cap case must be kept rather than hidden: the cap stage's `removed`
count is **the only on-page evidence that the cap binds at all**. Hiding its victims would
delete the evidence, which is precisely the failure ADR-0199 named when it found
`optimizer_result.binding_constraints` rendered nowhere and "four longs" reading as a
conviction statement rather than a risk-control one.

### 1. `restrictToLensPool` returns a mode, not a boolean

- **`filter`** — the lens stage removed names. Excluded and counted (ADR-0200).
- **`mark`** — only the cap truncated. Rows kept; `reachedAgent(row)` marks each.
- **`none`** — nothing removed, or nothing recorded. The array passes through **by
  identity**, so the default page cannot be perturbed even by a re-sort.

A run where **both** stages removed names resolves to `filter`, not to a third mode.
`independent_ideas` records what survived *both* stages, so a missing name could owe its
absence to either and per-name attribution is impossible. Of the two errors available,
hiding a cap-cut in-lens name costs a row, while showing an out-of-lens name is the defect
ADR-0200 exists to close. Both counts still travel on the restriction, so the sentence on
screen can stay true without the rows being attributable.

### 2. `inLensCandidates` drops only what the lens removed

The held-row **"also cleared, not taken"** footer has no room for a marker, so it can only
show a name or not — and for a cap-cut name it should **show** it. That footer's claim is
"this cleared and was not taken", which is true of a cap-cut name; dropping it would delete
a true statement. For a lens-removed name the same footer is false. Filter the false claim,
keep the true one. This is also what keeps the default page's footers byte-identical.

### 3. A cap-cut row cannot be the headline

The collapsed summary names *"most independent: X at ρ … to anything held"* — the candidate
that was genuinely independent of the book and **passed over anyway**, because that is the
live question a reviewer should ask. A cap-cut name was not passed over, so it is excluded
from that selection. It stays in the table, where its marker says what happened; it just
cannot be promoted to the finding. (Verified live: the default page's `BIL long at ρ 0.18`
did reach the agent, so the summary is unchanged.)

### 4. The marker sits after the overlap read, not instead of it

On its own line, so it cannot be skimmed as a suffix. The correlation is still true and
still worth reading — replacing it would hide *why* the name was low-conviction enough to
be near the cap boundary in the first place.

It also explains something the page had left unexplained: **every cap-cut row reads
"unmeasured"**, because `candidate_correlations` only holds candidates that reached the
agent. The em-dash was correct and causeless; now it has a cause beside it. (The same
signature was the tell in ADR-0200 — there, every out-of-lens row read unmeasured.)

## Consequences

**Good.**

- The default `/book` no longer attributes a judgement to the agent for 12 of 33 rows.
- The `candidate pool (cap 30)` stage is now visible where its effect is, not only as a
  count in a collapsed funnel — ADR-0199's argument applied one panel over.
- The unexplained "unmeasured" cluster has an explanation.
- Row count, ordering, footers and summary on the default page are otherwise unchanged.
- The two defects now have one mechanism and one module, so a future lens or a moved cap
  needs no new code: `capRemoved` prefix-matches `candidate pool (cap`, so the day the cap
  stops being 30 the marker still works.

**Costs, stated.**

- **The marked set is inferred, not recorded.** It is `trade_candidates` minus
  `independent_ideas`, which is exact only because the funnel says the lens stage removed
  0 on this run. The durable fix remains the one ADR-0200 named: have
  `screen_candidates` persist the NAMES each stage dropped, not just the counts. Blocked
  the same way — L5 output is not backfillable, so every published row would keep the gap.
- **A both-stages run under-lists**, silently as to which rows, though the two counts are
  reported. No lens does this today (credit leaves 11 against a cap of 30).
- The panel now carries three sentences under one table (end-of-list, cap, and — under a
  lens — exclusion). That is at the edge of what a terminator should be, and a fourth cause
  should get a small provenance block rather than a fourth paragraph.
- `/book` still has no `lib/risk/lensScope.ts`-equivalent panel classification, so a future
  panel reading a lens-less table under a lens heading is still invisible to the suite.
  Named in ADR-0200, still open, and unchanged by this ADR.

**Rejected.**

- **Hiding the cap-cut rows** (the symmetric, simpler treatment). It deletes a true row and
  the only evidence the cap binds.
- **Leaving them unmarked and rewriting the body copy** to "these cleared the screen"
  without the "not taken" implication. The panel's whole subject is what the book declined;
  weakening the sentence for all 33 rows to accommodate 12 would lose the finding for the 21
  that *were* declined.
- **A third mode for the both-stages run.** Per-name attribution is not available, so the
  mode would be a claim the data cannot support.
- **Marking with a colour or an icon alone.** Design goal 1 — the row states its cause in
  words; the `title` adds the full explanation for a reader who stops on it, and is not
  relied on, since it is invisible on touch and absent from Ctrl+F.
