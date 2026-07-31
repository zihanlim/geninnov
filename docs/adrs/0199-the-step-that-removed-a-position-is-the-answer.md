# ADR-0199 — The step that removed a position is the answer, so the page draws the steps

**Date:** 2026-07-31
**Status:** Accepted
**Relates to:** [0056](0056-a-declined-idea-must-be-named.md), [0058](0058-explanations-are-owed-per-empty-slot.md), [0081](0081-a-worked-example-lineage-panel-on-book-additive-only.md), [0107](0107-the-optimizer-sizes-what-l5-chose.md), [0173](0173-a-turnover-cap-bound-against-the-published-book.md), design-goals.md §1, §2, §3, §7

## Context

Q1 asks for five long and five short trades. The published book of 2026-07-30 held
four long and five short, and `/book` could not say why.

Not because the reason was missing — because it was split across three panels and one
unrendered column:

| where | what it held |
|---|---|
| `PoolDepth` | 42 candidates → 30 → 10 independent long ideas / 7 short |
| `SizingProvenance` | `EMB`: conviction 20%, optimizer 0%, *"priced out"* |
| `optimizer_result.binding_constraints` | `["turnover at cap"]` — **rendered nowhere** |

Assembling those into *"the agent chose five longs and the turnover cap deleted the
fifth"* took three scroll positions and a SQL query against `heuristic_weights`. A
reader who did not do that work would draw the obvious and **wrong** conclusion: that
the screen found only four long ideas worth holding.

The truth is close to the opposite. The long side was the **deeper** one — 19 of the 30
candidates reaching the reasoning step were long, collapsing to 10 independent ideas
against the short side's 7. The agent selected five and five. `EMB` was sized at 20%,
the single-name cap, the **largest position in the book**, and the optimizer zeroed it
because realised turnover hit 59.99999% against a 60% cap, of which 35.2 points were
forced exit from the previous book.

"Four longs" is therefore a statement about a **risk control**, not about conviction.
Those read very differently to anyone deciding whether to trust the book, and the page
was telling the wrong one by omission.

`PoolDepth` was the panel built to answer this question (ADR-0056/0058) and it answers
a strictly smaller one. Counts and bars can say *how many* ideas existed; they cannot
say *which step* removed the position that is missing, because a stack of numbers has
no edges. The question is about a sequence.

## Decision

Replace `PoolDepth` with **`BookFunnel`** — the chain drawn as five nodes and four
labelled connectors, from the same columns, ending at the published book:

```
L1 screen → Reasoning pool → Independent ideas → Agent selected → Published
   42            30 (19L/11S)     17 (10L/7S)       10 (5L/5S)      9 (4L/5S)
        −12 context cap   −13 correlation    −7 agent      −1 sizer
```

The last connector is the one nothing rendered before, and it carries the constraint:
`EMB … Binding: turnover at cap. Realised turnover 60.0% against a 60.0% cap. 35.2% of
that was forced exit.`

**A headline sentence that only speaks when it has something to say.** `funnelHeadline`
returns a sentence *only* when the agent met five-and-five **and** the sizer then cut
it. On a run where the pool was genuinely thin it returns null and the diagram speaks
for itself. A sentence that renders every day becomes wallpaper and stops being read.

**The correlation step is reported as reclassification, not removal.** 30 names become
17 ideas because members correlated ≥ 0.70 are one idea, not several. A reader who
reads that edge as a filter concludes the pool was smaller than it was — the exact
misreading `PoolDepth` existed to prevent, inherited here rather than dropped.

**Selection joins the two grains.** Tickers in the final node are buttons; clicking one
sets which position `WorkedExamplePanel` traces directly below. The funnel is the
**population** per run; the lineage is **one position** over four pipeline stages. They
are orthogonal axes, which is why they stay two panels and are made adjacent rather
than merged.

ADR-0081 rendered exactly one lineage per page load, by highest |EdgeScore|, *"so it
does not bloat the page"*. That reason survives untouched: all nine are reachable, one
is rendered. What changes is that the |EdgeScore| pick becomes the **default** rather
than the only option — it had been answering "which position is most interesting?" with
"the biggest one", an editorial choice nothing on the page disclosed.

## What was considered and refused

- **Lineage in a tooltip.** Rejected against design goal 1. A source behind a hover is
  not keyboard-reachable, invisible on touch, absent from Ctrl-F, and gone from a
  screenshot. Provenance is the one thing that may not sit behind an interaction.
  Tooltips remain fine for *definitions*, not for sources.
- **All nine lineages at once.** 36 step cards. Goal 7 — density serves comparison, and
  nine derivations stacked compare nothing.
- **Merging the funnel and the lineage into one diagram.** They have different units
  (positions vs. pipeline stages) and different cardinality (one per run vs. one per
  name). One row cannot carry both without one of them becoming decoration.
- **Keeping `PoolDepth` alongside.** The same measurement in two shapes, where the
  weaker shape is the one that cannot say where the fifth long went.
- **A name the sizer dropped being clickable.** `EMB` has no row in `picks`, so there is
  no lineage to render. It appears on the connector that removed it instead; a button
  opening an empty panel would be worse than showing it as what it is.

## Consequences

- `/book`'s "how solid is this book" grid drops from four panels to three, and from
  `lg:grid-cols-2` to `lg:grid-cols-3`. The arithmetic that made it 2×2 (four panels
  cannot fill three columns without orphaning one) makes it 1×3 now.
- `lib/book/bookFunnel.ts` is pure and tested against the live 2026-07-30 row, including
  the case that motivated it. `splitSigned` counts an exact `0.0` as **no position**:
  the optimizer writes zero for a name it declined, and counting it as a long would
  report a book one position larger than the one that exists.
- Goal 2 is enforced per node: a stage whose column is absent renders `—` with its
  cause, never `0`. On this page a zero would claim the screen found nothing.
- The funnel reads only columns `BookBody` already selects, so it costs no query.
- **Not yet carried:** the long/short split of the *raw* 42. That lives in
  `trade_candidates`, which the frontend does not read, so the first node shows a total
  with no split rather than a fabricated one. The 29/13 skew is genuinely interesting —
  the raw pool was more than twice as long as short — and surfacing it needs a decision
  about whether `/book` should read a second table.

## Correction, 2026-07-31 (same day, appended not rewritten)

**The last consequence above is wrong on its facts.** `BookBody` has read
`trade_candidates` for some time — `asset, direction, edge_score, theme_id, run_date,
via_conviction`, filtered to the latest candidate `run_date`, limit 200 — because
`ClearedNotTaken` needs it. The split was available the whole time and needed no new
query and no decision about reading a second table. I asserted a limitation instead of
checking for one, which is the same class of error as the "context cap" mislabel this
ADR's own fix commit records.

The split now renders on the first node, guarded: it is shown **only** when the
candidate row count equals the funnel's own first `remaining`. `trade_candidates` is
read on its own latest `run_date` and the book row on its own; those are normally the
same day and occasionally are not, and a split taken from one vintage sitting under a
total from another is two books on one line — the failure this whole panel exists to
stop, reproduced inside it. On disagreement the split is absent, which costs a detail;
asserting it anyway would cost a true one.

What it buys is the credit lens's central fact, measured rather than argued. The shared
L1 pool on 2026-07-30 is **29 long / 13 short**, and after `lens = credit` **11 long and
0 short** survive — so the edge now reads *"every short candidate in the pool is outside
this lens, so a long/short book is not constructible from it."* That sentence is stated
only when a side is genuinely emptied; on the multi-asset lens the same edge reports
"19 long and 11 short survive" and stops. A line that appears every day cannot mean
anything on the day it does.

This also settles a question the original text left open — whether both lenses start
from the same pool. They do, and necessarily: `trade_candidates` has no lens column, L1
ranks names before a lens is chosen, and the lens is a filter applied downstream inside
`screen_candidates`. Both books' funnels therefore open at 42 and diverge at the second
node. See [ADR-0200](0200-a-candidate-the-lens-removed-is-not-a-candidate-the-book-declined.md),
written concurrently, for what goes wrong when a panel forgets that.
