# ADR-0135: A thesis must not assert a position the book does not hold

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0019](0019-citation-value-reconciliation.md), [ADR-0049](0049-thesis-badge-certifies-figures-not-prose.md), [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md), [ADR-0129](0129-ai-capex-is-a-theme-and-the-tracker-found-it-sideways.md)

## Context

Asked whether any AI names had actually been chosen. Two had — GEV and VRT, from the electrical-plant link of the AI Capex chain. Reading VRT's published thesis to answer the question surfaced something else:

> *"AI Capex hype at 53.6 and SPX breadth at 81.82% support continued risk-on rotation into data-center electrical infrastructure; **the long VRT / short MSFT structure below** isolates the capex-deployment vs capex-monetization gap."*

The 2026-07-28 book is `BABA, GDX, GEV, JPM, NUE, PDD, UNG, VRT, XLE`. **There is no MSFT position.**

MSFT was not invented. It was a genuine candidate — the engine put it **short at EdgeScore −0.322**, the AI Capex theme's most convicted name at 14.9 — and it did not survive selection into the final nine. So the agent reasoned about a paired structure and published one leg of it, describing a trade the book does not contain.

**Every number in that sentence is correct.** `53.6` is the theme's HypeScore, `81.82%` is SPX breadth. The citation guardrail ([ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0019](0019-citation-value-reconciliation.md)) verifies exactly that — cited *numbers* against the frozen L0–L4 inputs — and it has no notion of a *position*. The claim passed because the guardrail was never asked the question.

[ADR-0049](0049-thesis-badge-certifies-figures-not-prose.md) already recorded that the thesis badge certifies figures rather than prose, and added a line saying the reasoning is the model's own. That was the right call for *interpretation* — "a name over-owned, a sector defensive" are judgements, not facts. But **"the book holds a short MSFT" is not an interpretation.** It is a checkable statement about our own output, and it was false.

## Decision

**Check that every position a thesis asserts is one the book holds.**

`backend/services/thesis_positions.py`, called from `verify_citations`.

**A claim is not a mention, and the difference is the whole design.** A check that flagged every ticker appearing in prose would fire constantly on correct writing. The same run's GDX thesis reads:

> *"GDX is the strongest expression of the gold-short trade from the {GDX, GLD, IAU, NEM, SLV} cluster"*

That names a correlation complex and says which member was chosen — [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md) being *explained*, not violated. It asserts no position in GLD or SLV and must not be flagged. So:

- **Braced cluster listings are masked** before matching. `{…}` is the vocabulary the optimizer uses to name a complex.
- Only two forms count: a **direction word attached to the ticker** (`short MSFT`), or a **position noun following it** (`MSFT leg`, `MSFT structure`).
- **One claim per ticker.** *"the long VRT / short MSFT structure"* matches both forms on MSFT; counting it twice would make one defect read as two.
- A pick's **own asset is exempt** — `long VRT` in VRT's thesis is the one position claim guaranteed true.

**It warns; it does not reject.** A citation failure means a number is wrong and the book is unsafe, so the pipeline discards it. This is a different severity: one sentence over-claims while every figure is sound, and discarding a correct book over a clause would be disproportionate. The finding is written as `thesis_caveat` **on the pick**, so `/book`, `/ask` and MCP all read it from the same payload rather than from a log line nobody sees. The caveat says explicitly that *the figures themselves are verified*, so it does not overstate the defect either.

A pick with nothing to caveat is left **untouched** — no empty key — so an absent `thesis_caveat` means "nothing over-claimed" and never "not checked".

## Consequences

- **Verified against the live book: exactly one finding**, `VRT → MSFT`, which is the defect that prompted this. The other eight picks are clean, and that is a result rather than an assumption.
- **The check is advisory and wrapped.** A failure inside it cannot cost a book whose numbers are sound; a test asserts the call sits inside a `try`.
- **`apply_caveats` is a pure function, tested directly.** The first cut lived inline in `verify_citations`, which meant testing it required constructing a passing citation set for an unrelated guardrail — a defect being *caught* should not depend on another guard's fixture.
- **This does not fix the underlying behaviour.** The agent still reasons about pairs and can still lose a leg in selection; this labels the result rather than preventing it. The stronger fix — feeding the final pick set back for a thesis rewrite, or rejecting the *sentence* — is a change to L5's control flow and is not made here.
- **The detector is lexical.** It will miss a claim phrased in a way the two patterns do not cover (*"we are positioned against Microsoft"* names no ticker at all), and this is a floor rather than a guarantee. Chosen over an LLM check deliberately: a guardrail that itself needs a model is a guardrail that can hallucinate.
- **It only sees tickers in `ASSETS`.** A thesis asserting a position in something outside our universe is a different defect — the citation guardrail's candidate hard-filter is what prevents that — and is not this check's job.
