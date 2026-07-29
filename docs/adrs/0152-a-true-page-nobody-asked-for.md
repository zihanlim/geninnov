# ADR-0152: A true page nobody asked for

**Status:** Accepted
**Date:** 2026-07-29
**Reverses:** [ADR-0151](0151-the-portfolio-is-not-the-book.md), same day

## Context

[ADR-0151](0151-the-portfolio-is-not-the-book.md) un-retired `/portfolio` as the
**held** book — the positions a portfolio following this research would actually own,
net of the cost of getting there — and added it as a fifth nav destination.

Its argument was sound on its own terms. ADR-0025 retired the old `/portfolio`
because it was one of three pages rendering *the same ten positions*; the held book
is not that. It has its own table, its own positions, its own cost-netted returns,
and on the live history it disagrees with the published book by more than the return
(+0.76% against −0.72%). Two pages that disagree about what you own are not
duplicates of each other.

**Every step of that reasoning is correct, and the conclusion was still wrong**,
because it was answering a question this project has not been asked.

### What the brief actually asks

`task.md`, in full, is two questions:

1. *"You have $100 million to invest in long and short trades across any asset class
   and/or single companies. **What are your top five long and short trades, and
   why?**"*
2. *"…design a daily process that 1) identifies which themes are trending;
   2) quantifies how much attention, or 'hype', each theme is attracting, so that the
   output can support both **idea generation** and **risk monitoring**… An
   illustrative prototype would be a plus."*

The Q1 deliverable is **ten trades with reasons**. The "$100 million" is *scale
framing* — it says these are institutional-size positions, and it makes sizing a
natural part of a good answer. It is not a mandate to run money. **Neither question
asks what the book earned**, over any horizon, net or gross.

A *book of trades* is not a *fund with a NAV*. ADR-0151 read the second where the
brief says the first.

### The specific harm

A page reporting NAV and since-inception return makes **"what is your track
record?"** the obvious next question. On six sessions of data that question has no
honest answer, and this repo has twice decided as much:
[ADR-0090](0090-a-published-pick-must-be-falsifiable.md) refuses a hit rate before
the picks mature, and [ADR-0112](0112-a-backtest-of-these-weights-is-not-a-track-record.md)
refuses to let a backtest stand in for one. Building a destination that raises the
question while the answer is still "not yet" works against both.

A page can be **true, well-built, and still a cost**: it takes a reader's attention
to arrive at, read, and rule out. `/portfolio` was all three.

## Decision

**Return `/portfolio` to a redirect and restore the four-destination nav.**

**Keep everything that was fixing a real defect:**

- `book_holdings` and `book_holdings_performance` remain, and the nightly run keeps
  extending them.
- `CostDrag` stays on `/risk`, above the curve it corrects.
- The realised-return caveat stays, on the page and in `llms.txt`.

That work is **not** the portfolio feature. It is the correction to a false claim
that predated all of it: the realised curve on `/risk` was gross of transaction costs
on a book turning over **95.1% one-way per run**, and showing what that costs
(+0.76% published against −0.72% held) is owed to a reader whatever the brief asks.
Removing the page does not un-ask that question.

## Consequences

**The nav is four again**, and `design-goals.md` records the episode rather than
quietly reverting — the widening it briefly documented is replaced by the worked
example of a fifth destination being proposed, argued, and refused.

**The bar for a fifth destination is now sharper than it was.** ADR-0151 established
"a different object, not a second view of one". That is necessary and **not
sufficient**. The full test: *a different object **the brief asks for***.

**`/portfolio` bookmarks redirect to `/book` again**, as they did before yesterday.
The URL's behaviour has now changed twice in a day; it ends where it started.

**The held book is now infrastructure with no destination**, reached only through
`CostDrag` on `/risk`. That is the correct weight for it: it exists to keep one
published figure honest, not to be a feature.

**Two bugs found while building the page stay fixed** — they were real and are
independent of whether the page ships: `extend_held_book` deleting before insert (a
name that left the book kept its row, giving 13 rows for a 9-name portfolio), and the
drift threshold at `1e-6` rather than `1e-9` against a float32 column.

**This ADR is dated the same day as the one it reverses.** That is not a
embarrassment to hide — ADR-0151 is left in place, accepted-then-reversed, because
the reasoning it contains is the reasoning that has to be checked against the brief
next time. A decision log that silently drops its wrong turns teaches nothing.

## Alternatives considered

**Keep the page, drop it from the nav.** Rejected: a destination nobody can navigate
to is worse than either option — it still costs a reader who finds it, and it removes
the one thing that made it defensible (being findable was the entire problem
ADR-0151 set out to solve).

**Keep the page and delete the held-book tables.** Exactly backwards. The tables are
the part that fixes a real defect; the page is the part nobody asked for.

**Keep everything and let the brief be answered by `/book` alone.** Rejected as the
status quo that produced this: scope accretes because each addition is individually
defensible. The check is not "is this true?" but "does the brief ask for it?".
