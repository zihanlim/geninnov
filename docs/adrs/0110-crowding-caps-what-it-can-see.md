# ADR-0110: Crowding caps what it can see, and says how little that is

**Status:** Accepted
**Date:** 2026-07-27
**Supersedes:** the *"never feeds sizing"* clause of [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md), **and only that clause**
**Related:** [ADR-0032](0032-edge-carry-value-abstention-sizing.md), [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md), [ADR-0053](0053-the-published-book-was-sized-by-hype.md), [ADR-0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md), [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md), [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md), [ADR-0111](0111-mu-is-the-return-input-and-what-it-is-not.md)

## Context

`docs/GOAL.md` records four bars from a quantamental PM's account of where the alpha is. The first:

> **Sizing takes four inputs, not two: vol, conviction, crowding, upside.**
> **Test:** at equal conviction, can a reader see why the crowded position is smaller than the uncrowded one? Today: no, because it is not.
> **Constraint before wiring it:** crowding is observable on ~20% of book gross. A sizing input that is unmeasurable on four fifths of the book must degrade to neutral **with its coverage stated at the point of use** — never silently, or the caps become a claim the data cannot support.

`positioning_crowding.py` has computed the third input since ADR-0097 and fed it to nothing. Its own docstring said so, which is how GOAL.md was able to cite it as evidence.

**Wiring it reverses an accepted decision.** ADR-0097's Decision says, under the heading *"Agreeing with a crowd is disclosure, never a signal"*: *"Nothing here recommends a trade, reverses one, or feeds sizing."* That sentence also lives in the module docstring and in `/risk`'s footnote. Editing ADR-0097 would destroy the record of why it was decided the other way, so this supersedes one clause of it and leaves the rest standing.

## Decision

**Crowding tightens a position's single-name limit. It does not touch expected return.**

A name whose *effective* side agrees with an extreme speculator consensus gets `MAX_SINGLE_NAME_WEIGHT × CROWDED_CAP_MULTIPLIER`. Everything else is **absent from the cap map**, and an absent name keeps the base cap.

**Why a cap and not a haircut on μ.** Crowding says the exit is narrow — a liquidity and positioning fact. Docking μ would say the position will *return* less, which is a claim about future returns that nothing here has measured; tightening the limit says we will *hold* less of it, which is exactly what a positioning extreme supports. A cap is also **visible**: it lands in `OptimizationResult.binding_constraints` naming the position it bit, and it names itself as *tightened* rather than reporting as the standing 20%. A μ adjustment would leave a reader looking at a smaller weight with no way to attribute it — which fails the bar's own test, since that test is about whether a reader can *see* why.

**Both sizers apply the same caps.** The map is computed once in `size_positions` and handed to the optimizer and to `allocate_portfolio` alike. [ADR-0053](0053-the-published-book-was-sized-by-hype.md) is what happens when two sizing paths diverge and nothing in the data says which ran; a crowding input the optimizer honoured and the fallback ignored would be the same defect wearing a different field name.

**A per-name entry may only ever tighten.** `_cap_vector` and `allocate_portfolio` both take `min(base, entry)`. A COT print is not permitted to *loosen* this book's published risk policy.

**Neutrality is absence, and it is pinned by test.** `test_crowding_is_neutral_where_unobservable` asserts an unmapped name's weight is **bit-identical** with crowding wired and unwired. Not close — identical. This is GOAL.md's constraint, and it is the one that fails silently.

**One reading per run.** The COT fetch moves from persist time into `aggregate_context`, over the candidate pool (picks are a subset), and `_positioning_row` reuses it. Two fetches in one run can return two different readings, leaving the book **sized** by one and **explained** by the other — the defect [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md) had to restructure the chokepoint signal to avoid. A sentinel distinguishes "never set" from "fetched and got `{}`", because an empty dict is a real finding and must not trigger a refetch.

**`CROWDED_CAP_MULTIPLIER = 0.5` is a judgement, not a fit** — the same standing `CROWDED_HIGH = 80.0` already has, and named for the same reason: when someone fits it, the change is in the diff.

## The bias this creates, stated rather than designed away

**Penalising only what we can see gives a structural advantage to what we cannot.** Crowding can reach 22% of gross. A name with no futures contract can never be tightened, so over many runs the book drifts toward instruments nobody can observe — it selects for unmeasurability.

A coverage floor would remove the bias by refusing the signal below some threshold. It was rejected: on today's coverage it would mean the input never binds, which **fails bar 1's own test**, and it would trade a real bias for a fake neutrality.

So the bias is named here and made watchable instead. `optimizer_result.crowding` persists `coverage_share` every run. If the observable share of gross falls run-over-run *while* crowding is binding, that is this bias showing up in the data, and the counter is [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md)'s own answer: raise coverage honestly, never by mapping miners to the metal.

## What ADR-0097 keeps

Unchanged and still binding: **coverage is the headline** and the verdict is subordinate to it; every unmapped position is listed **with its reason**; **miners are not the metal** (GDX is not gold, XLE is not crude, and manufactured coverage is the failure the module exists to avoid); the **inverse flip** — long SVXY is short VIX — with `effective_side` as the only place direction resolves; `fetched=False` as a state **distinct** from "nothing is crowded"; and the mapping living in Python only, never recomputed in TypeScript.

The inverse flip now reaches the number that sizes the book, and `test_the_inverse_flip_reaches_the_cap` asserts both directions: a long SVXY against crowded-**short** VIX is tightened, and against crowded-**long** VIX is not. A wrong side still has no symptom; it would now silently cap the wrong position.

## Consequences

**On the live 2026-07-25 book, nothing is tightened, and that is the result.** Coverage 22.2% — SHY and SVXY, the only two positions mapping to a contract. Both sit mid-range (COT index 69.9 and 33.2) against an 80/20 threshold, so the recorded reason is *"2 observable positions were checked and none sits at a speculator extreme"* — which is the "checked and found uncrowded" state, distinct from both "we did not look" and "nothing maps". The eight remaining positions carry `cause: "no_contract"`.

The honest reading: the machinery is wired, tested and correct, and today it changes no weight because the data says nothing. That is not a reason to loosen the multiplier.

**`unobservable` records gain a structural `cause`** — `no_contract` / `not_retrieved` / `insufficient_history` — beside the prose `reason`. Sizing has to distinguish "COT will never cover this" from "COT covers it and we failed to read it today"; parsing the rendered sentence to tell them apart would make the copy load-bearing.

**Three absences stay three absences.** `crowding_caps` returns a different `reason` for a failed fetch, for nothing mapping, and for everything mapped being uncrowded ([ADR-0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md)), and a test asserts all three read differently.

**Bar 1 is settled for the third input and stated for the fourth.** Vol and conviction enter through μ ([ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md)); crowding enters here; upside is addressed in units but not in substance, and stays on the register — see [ADR-0111](0111-mu-is-the-return-input-and-what-it-is-not.md).
