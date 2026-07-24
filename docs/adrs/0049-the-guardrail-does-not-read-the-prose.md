# ADR-0049 — The citation guardrail does not read the prose, and grounding cannot verify a count

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0012](0012-citation-guardrail-llm-defense.md), [0019](0019-exact-citation-reconciliation.md), [0027](0027-value-grounding-for-citations.md), [0048](0048-count-independent-ideas-not-candidates.md)

## Context

[ADR-0012](0012-citation-guardrail-llm-defense.md) makes citation verification "the
primary defense against LLM hallucination of macro numbers", and `/book` renders the
thesis with a **VERIFIED** badge and an evidence-source count beside it. That badge is
the strongest claim this project makes about its own output.

ADR-0048 gave the agent a measured pool-depth block and told it how many independent
ideas each side held. The next run's published thesis said:

> *"Five longs and four shorts are returned — the SHORT pool yields **only four
> independent ideas** because GDX/NEM collapse into SLV and KWEB collapses into BABA
> per correlation analysis."*

The measurement said **five** — precious metals, China internet, PDD, NOC, ARKK. The
model's clustering reasoning was right and its count was wrong; it forgot ARKK. The
Pool depth panel immediately below the thesis said five. The run was `verified=True`.

Two separate holes let that through, and the first is the one that matters.

**1. `verify_citations` never inspects the prose.** It iterates
`state["citations"]`. The claim appeared in `book_view` and **no citation mentioned
"independent" at all** — checked on the live run: 30 citations, zero matches. Every
number the model asserts in narrative prose without also listing it as a citation is
unverified, and the prose is what the reader reads. The badge covers the citation
list; the page applies it to the paragraph.

**2. Grounding is structurally blind to small integers.** ADR-0027 accepts a citation
whose value matches any number the model was shown, within
`max(0.02, 0.01·|value|)`. Measured against the live inputs — 106 values —
**every integer from 0 to 9 grounds**:

| claimed | grounded? | matched |
|---|---|---|
| 0 | yes | 0.0, −0.013 |
| 4 | yes | 4.0 |
| 5 | yes | 5.0 |
| 9 | yes | 9.0 |
| 10 | **no** | — |

So "four independent ideas" and "five independent ideas" are indistinguishable to the
grounding rule. **The fix recorded in `GOAL.md` after the previous iteration — expose
the count as a citable source — would not have worked**: it only helps if the model
chooses to cite it with that key, and grounding cannot backstop the failure.

A third detail closes off the obvious general fix: the miscount was **spelled out in
words**. A regex over digits in the prose finds 16 numbers in this thesis and misses
"four" and "five" entirely. Extracting digits would not have caught it either.

## Decision

**Do not ask the model to restate a computed count, and check that it didn't.**

1. **Prompt.** The system prompt already forbids stating sizes, weights, notionals and
   net/gross exposure — *"a later deterministic step decides HOW MUCH"*. Independent-
   idea counts join that list for the same reason: use POOL DEPTH to **decide** how
   many picks to return; the page states the counts itself. Name which complexes were
   collapsed and why; leave how many to the measurement.

2. **Guardrail.** A prompt is not a guardrail. `check_idea_count_claims` scans
   `book_view` for a claim of the form *"‹n› independent idea(s)"* — **digits or
   number-words** — infers which side it refers to from the preceding text, and
   compares it against the measurement. A mismatch rejects the output, which routes
   into the existing retry-with-feedback path and then the deterministic fallback.

   The check is **exact and outside the 80%-grounded tolerance** that ADR-0027
   applies to citations. That tolerance exists so a derived metric computed from
   grounded inputs is not treated as a hallucination; a count restated against a
   number we computed ourselves has no such excuse.

   With no measurement available, or prose making no such claim, it is silent — a
   guardrail that fires when the panel simply did not render would be worse than the
   hole it closes.

## Consequences

- The specific failure is closed, pinned by seven tests including the exact published
  sentence and the word-vs-digit case.
- **The general hole is not closed, and this ADR is the honest record of that.**
  `verify_citations` still reads only the citation list. Any *other* number the model
  asserts in prose without citing remains unverified, and the VERIFIED badge still
  spans the whole thesis. Closing it properly means either verifying every number in
  the prose — which the same small-integer blindness makes weak — or narrowing what
  the badge claims. Both are larger changes than this one and neither should be
  smuggled in unmeasured.
- The generalisable rule this is an instance of: **a number the system computes should
  never be re-typed by the model.** It was already applied to sizes and exposures;
  it now covers pool depth. Any future computed quantity handed to the agent should
  arrive with the same prohibition, because the guardrail cannot check arithmetic the
  model performs on our own outputs.
- Rejecting on a count costs a retry, and the retry now carries explicit feedback, so
  the cost of a false positive is one extra LLM call rather than a lost book.
