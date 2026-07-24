# ADR-0061 — A false excuse is worse than none: reject an availability claim about a screened name

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0056](0056-an-instruction-is-not-a-guardrail.md), [0058](0058-explanations-are-owed-per-empty-slot.md), [0049](0049-the-guardrail-does-not-read-the-prose.md), [0045](0045-turnover-on-names-without-a-verdict.md)

## Context

[ADR-0056](0056-an-instruction-is-not-a-guardrail.md) required the agent to name the
independent ideas it declined and closed with an explicit limitation:

> the check verifies that a declined idea is *mentioned*, not that the reason given is
> *sound*. A thesis saying "ARKK was declined because it is Tuesday" passes.

[ADR-0058](0058-explanations-are-owed-per-empty-slot.md) confirmed on frozen inputs that
the prompt works — ARKK was named in 3 of 3 samples. **The first book published under it
named ARKK and gave this reason:**

> "The fifth independent short idea per POOL DEPTH, ARKK, is not present in the tradable
> candidate pool, so this book deploys four short picks rather than five."

**ARKK was in the pool.** `trade_candidates` for that run holds it at
`edge_score −0.2658`, `hype_score 60.69` — the eleventh of twelve short candidates. POOL
DEPTH counted it as an independent short idea *because* it was there. The sentence is
contradicted by the very data the model was shown, in the same breath as citing that
data.

**And it is worse than the silence it replaced.** Naming ARKK set `satisfied = True`,
which flips `/book`'s Pool depth panel out of its warning branch and into *"the thesis
accounts for what it declined."* The previous state — a true warning that the thesis said
nothing — was more useful to a reader than a neutral-coloured endorsement of a false
sentence. **The fix made the page credit a fabrication.** That is the sharpest form of
this project's recurring failure: not a wrong number, but a surface asserting something
it has not checked.

It also shows what pressure does. The agent was told it *must* explain; it had no reason
it considered good enough; it produced one. Demanding an explanation without checking it
manufactures explanations.

## Decision

**Judging whether a reason is good is out of reach. Judging whether it is contradicted
by our own pool is not — so check exactly that, and reject it outright.**

`check_availability_claims(prose, candidates)` scans forward from each mention of a
screened ticker for an availability excuse — *not present / not in / absent / unavailable
/ no longer* within the same sentence as *pool / candidates / universe / screen / list* —
and fails when the named ticker is in `trade_candidates`.

- **Exact, with no grounding tolerance**, alongside `check_idea_count_claims` and for the
  same reason ([ADR-0049](0049-the-guardrail-does-not-read-the-prose.md)): the model is
  contradicting a fact the system computed and handed it. There is no honest reading
  under which a screened name was unscreened.
- **It blocks the run** — `verified = False` → retry → fallback. ADR-0056 deliberately
  did *not* block on a **missing** explanation, and that stands: an omission leaves the
  reader to ask a question, while a false reason answers them wrongly *and clears the
  guardrail while doing it*. The two deserve different treatment.
- **Deliberately narrow.** It fires only on the availability *class* of excuse.
  *"ARKK would net against long SVXY"* is a claim about correlation, not membership, and
  is left to the reader — inventing a verdict on reasoning quality is what
  [ADR-0045](0045-turnover-on-names-without-a-verdict.md) refused to do for turnover.
- **Forward-only matching.** Reading backwards from a mention attributed the previous
  clause's negation to the ticker (*"Several names were not in the pool. ARKK, by
  contrast, cleared every screen"*), so the window starts at the mention and stops at the
  sentence end. Pinned by test.

**The prompt is told the same thing, and given an honest way out:** never claim a
declined name was unavailable — every name in POOL DEPTH came *from* the pool, so the
claim is always false — and if there is no better reason than *"I chose not to"*, say
exactly that. **An honest "no further conviction" is accepted; a fabricated availability
excuse is not.** A guardrail that leaves the model no truthful escape just teaches it a
different lie.

## Consequences

- **The generalisation is now explicit and should travel:** ADR-0049 established that *a
  number the system computes should never be re-typed by the model*. This extends it to
  facts — **a fact the system computed should never be re-asserted by the model** — and
  the same treatment applies wherever the agent restates something we handed it.
- **Demanding an explanation creates pressure to invent one.** Any future requirement
  that the agent justify a decision should ship with a check on the justification, or
  with an explicitly acceptable "no reason beyond judgement" answer. Preferably both,
  which is what this does.
- **The published book that contained the false sentence is superseded** by the next run
  under this guardrail. The sentence is recorded here rather than quietly overwritten,
  because the failure mode is the durable finding.
- **Still open, and narrowed rather than closed:** a reason that is merely *weak* — or
  false in a way we cannot mechanically test, such as a misdescribed correlation — still
  passes. What changed is that the one falsifiable excuse class the model actually
  reached for is now closed. There is no claim here that theses are now truthful.
