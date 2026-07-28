# ADR-0134: A prior and a discovery are different claims

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0023](0023-data-provenance-and-fabrication-guard.md), [ADR-0066](0066-absent-is-not-zero.md), [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0129](0129-ai-capex-is-a-theme-and-the-tracker-found-it-sideways.md)

## Context

Asked directly whether AI had been *discovered* by this system or merely added to it. The answer was: added. The tracker measured AI in **2 of 455 documents**, an operator said AI is a theme, and [migration 050](../../supabase/migrations/050_ai_capex_theme.sql) created it by hand.

That is a defensible way to add a theme. What was not defensible is that **the record could not tell you which had happened.** Before this change every row in `themes` read:

```
source = 'practitioner'   discovered_at = NULL
```

All nine of them. `AI Capex`, created that afternoon after a measured signal and an explicit instruction, was byte-identical in provenance to `Fed Policy`, which is a line in migration 001 from an opening list. On a product whose entire claim is that every number can be interrogated, the *origin of a theme* — the thing that decides which numbers get computed at all — was the one fact with no provenance.

The gap has a second edge. Promoting AI Capex set `covered_by = 'AI Capex'` on the `ai` and `capex` narratives, which **permanently removes them from the emerging shortlist**. That is correct behaviour — a watched theme is not a miss — but it means the promotion became unfalsifiable the moment it was made: the evidence that justified it stops being visible precisely because it succeeded.

## Decision

**Record whether a measurement preceded the theme, as a separate fact from which method named it.**

Migration 051 adds three columns to `themes`:

| Column | Holds |
|---|---|
| `promotion_basis` | Did evidence come first? Four values, below |
| `promoted_on` | When it entered the board. NULL for the migration-001 anchors, whose creation date is a commit, not a decision |
| `promotion_evidence` | The measurement, **dated**, where one exists |

`source` is deliberately **not** reused. Its CHECK is `('practitioner','lda','embedding','both_agreement')` — a taxonomy of *which method named it* — and it is read elsewhere. This asks a different question, and overloading one column with two is how `price_corr` came to mean two things ([ADR-0127](0127-the-cross-asset-term-measured-one-asset.md)).

**The four values, and the distinction that matters:**

- **`practitioner_prior`** — an opening list. No measurement claimed, and none needed.
- **`operator_directed`** — a person named it. Evidence may be attached but **did not precede the decision**.
- **`measured_discovery`** — the pipeline surfaced it and the evidence came **first**. The only value that claims the system found the theme.
- **`unrecorded`** — predates this column. An answer, not a silence.

**`AI Capex` is recorded as `operator_directed`, not `measured_discovery`,** and this is the whole point of the column. The retrospective LDA measurement — AI/capex in 4 of 8 topics over a 206-document un-themed corpus, including `alphabet / capex / fund / guidance / managers / meta` — is genuinely strong, and it is stored under a `retrospective` key beside an `at_promotion` key holding the 2-of-455 signal that actually preceded the call. A payload that recorded only the strong number would have laundered the ordering.

**A practitioner prior with no evidence is not a defect.** `evidenceExpected()` returns false for it, so the UI never renders its null payload with the "not recorded" treatment used for a decision that claimed evidence and cannot show it. This is [ADR-0066](0066-absent-is-not-zero.md)'s absent-is-not-zero applied to a justification rather than a number: absent evidence under a stated prior is *correct*, and only absent evidence under a claimed measurement is a gap.

**The chip is a label, not a ranking.** Only `measured_discovery` takes emphasis; the other bases are neutral. Fed Policy is not a worse theme than one the pipeline found — it is a different kind of claim, and colouring it as deficient would assert a quality judgement the column does not support.

## Consequences

- **The two themes that used to look identical no longer do.** `originSummary` returns *"Practitioner prior"* for Fed Policy and *"Operator-directed · promoted 2026-07-28"* for AI Capex, and a test asserts those differ.
- **The ordering caveat is derived, not asserted.** `orderingCaveat()` reads the payload's own shape — a `retrospective` block on a basis that is not `measured_discovery` **is** the caveat, whether or not anyone remembered to write one. A hand-set flag could say "evidence-led" about a payload that is not.
- **Nothing is `measured_discovery` yet.** The value exists and is unused, which is the honest state: no theme on this board was surfaced by the pipeline with evidence preceding promotion. The first real candidate is the 2026-08-01 discovery run, which will be the first chance to earn it.
- **This does not re-open the shortlist.** `ai` and `capex` remain suppressed by `covered_by`, because they genuinely are watched now. What changes is that a reader can see the promotion was operator-directed and inspect what was measured — the promotion is documented rather than falsifiable, which is weaker than [ADR-0090](0090-a-published-pick-must-be-falsifiable.md)'s standard for a *pick* and is stated as such.
- **It is self-reported.** Nothing enforces that a future `measured_discovery` row actually had its evidence first; the column records a claim about process, and a careless author can enter the wrong one. A guard could compare `promoted_on` against the evidence's `measured_on` — not built, because with one populated row it would be a test of nothing.
- **The eight anchors were labelled, not re-litigated.** Whether "US Election" should still be a theme in 2026 is a separate question this change deliberately does not touch.
