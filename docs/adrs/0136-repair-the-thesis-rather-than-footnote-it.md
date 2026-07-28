# ADR-0136: Repair the thesis rather than footnote it

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0013](0013-determinism.md), [ADR-0093](0093-a-published-book-that-changes-must-say-so.md), [ADR-0135](0135-a-thesis-must-not-assert-a-position-the-book-does-not-hold.md)

## Context

[ADR-0135](0135-a-thesis-must-not-assert-a-position-the-book-does-not-hold.md) detected a published thesis asserting a position the book does not hold — VRT's *"the long VRT / short MSFT structure below"* against a book with no MSFT — and attached a caveat. It closed by stating what it did not do: *"This does not fix the underlying behaviour... the stronger fix is a change to L5's control flow and is not made here."*

Doing that fix required first answering a question ADR-0135 assumed rather than checked: **where was the leg lost?** The ADR asserted MSFT "did not survive selection". `research_agent_runs.raw_output` says otherwise:

```
llm_picks: BABA short, GDX short, GEV long, JPM long,
           NUE long, PDD short, UNG short, VRT long, XLE long
```

The model's **raw output already was** the final nine. **MSFT was never emitted.** No downstream stage dropped a leg; the model described a companion position it then did not take. ADR-0135's framing — *"reasoned about a pair and published half of it"* — was right about the symptom and wrong about the mechanism, and the correction matters because it moves the fix: nothing in selection needs changing, and a repair aimed at *preserving* a leg would have been aimed at a stage that never lost one.

## Decision

**Two changes: tell the model, and repair what it emits anyway.**

**1. The prompt states the constraint.** `reason_picks` now says a thesis may only assert a position in a ticker among the model's own picks, cites the 2026-07-28 failure as the example, and explicitly preserves the legal case — *"You may still COMPARE... you may not claim a leg you did not take"*. A guard that only cleans up after the model is one the model never learns from.

**2. `repair_thesis` excises the offending clause, deterministically.** Not a second LLM call, for three reasons that compound: re-prompting spends a call on the nightly book's shared MiniMax quota (the constraint that gates `/ask` at all); it reruns a *stochastic* step over an output whose figures are already verified, so a correct book can come back worse; and it can introduce **new numbers**, which would then need re-verifying, turning a prose fix into another citation problem. Excision cannot do any of that — it only ever removes text, so every surviving figure was already checked. It also keeps [ADR-0013](0013-determinism.md)'s determinism, which a second model call would not.

**The repair declines more often than it fires, and that is the design.**

- It splits on **sentence and semicolon boundaries only**. A comma is not a safe cut point — *"Vertiv, the picks-and-shovels beneficiary, is long MSFT"* would leave a fragment — so a claim embedded mid-clause is left to the caveat path.
- It requires the repaired text to retain **≥55%** of the original. Below that the offending clause was carrying the argument rather than decorating it, and a stub misrepresents the reasoning worse than the original over-claim did. *"We are short MSFT on decelerating cloud growth. Risk is a beat."* is left alone.
- A single-clause thesis is never cut.

**The edit is never silent.** [ADR-0093](0093-a-published-book-that-changes-must-say-so.md) requires that a published figure cannot change without saying so; the same applies to published prose. `thesis_caveat` names the ticker, **quotes the removed text verbatim**, and states that the remaining figures are unchanged and verified. Where repair declines, the caveat says the text stands as written and why.

**It closes the seam.** Cutting a trailing clause leaves the previous one ending on its own semicolon — *"...electrical infrastructure;"* — which reads as truncated. A published thesis that looks broken invites doubt about the figures in it, so a trailing `;` or `,` becomes a full stop.

## Consequences

- **Verified on the live book: 1 claim before, 0 after.** The repaired VRT thesis keeps all four of its verified figures (2.08, 0.30, 53.6, 81.82) and reads as a finished argument.
- **ADR-0135's mechanism claim is corrected here rather than in place.** That ADR stays as written — ADRs are immutable — and this one records that `raw_output` disproves its "did not survive selection" line. The *decision* ADR-0135 made was still correct; only its account of the cause was wrong.
- **A regression test asserts repair cannot invent a figure**, comparing extracted numerals rather than whitespace tokens. The first version compared tokens and broke the moment the punctuation seam legitimately rewrote `;` to `.` — a test asserting the mechanism instead of the property.
- **The prompt change is unverifiable until the next run.** Whether the model obeys is a behavioural claim about MiniMax that no test here can settle; the repair is the backstop precisely because prompt instructions are not guarantees.
- **Still lexical, still a floor.** *"positioned against Microsoft"* names no ticker and passes both the detector and the repair. Chosen over an LLM check for the same reason as above: a guardrail that needs a model can hallucinate.
- **Nothing re-runs over the already-published book.** The 2026-07-28 row keeps its original thesis until the next pipeline run rewrites it. Backfilling would edit a published artefact outside the `book_revisions` path that exists to record exactly that ([ADR-0093](0093-a-published-book-that-changes-must-say-so.md)), which is a bigger change than this one.
