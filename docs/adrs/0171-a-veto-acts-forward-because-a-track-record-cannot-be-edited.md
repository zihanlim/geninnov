---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0171 — A veto acts forward, because a track record cannot be edited

## Context

An outside review of this platform against `task.md` Q1 found four gaps. Two were
factually wrong — the portfolio thesis and the deliberate pairs both exist, are
LLM-generated with citations, and render on `/book` through `ThesisBlock`
(`BookBody.tsx:945`); the live 2026-07-29 `book_view` names *"the MSFT short paired
with VRT and GEV longs expresses a hardware-over-software rotation within the AI
Capex theme"*. One was fair: **there was no editorial judgment.**

Every filter in `screen_candidates` encodes a measurable property — HypeScore ≥
threshold, `|EdgeScore|` decisive (ADR-0046), factor R² ≥ 0.10, lens membership,
correlation-complex caps. None of them can express *"the attention on this name is
one news cycle, not a signal."* That is a judgement about whether a measurement
means what it appears to mean, and no threshold encodes it. The pipeline could
rank, size, cap and stress a candidate; nobody could decline one.

The obvious implementation — let a human reject a published pick and promote the
next pool candidate — is the one that must not be built. `pick_outcomes` sets
`entry = the close on run_date` (ADR-0090), and `scripts/resolve_outcomes.py:123`
**re-derives its claim set from the current `picks` on every run**. So editing a
published book would:

1. let a substitute inherit an entry price from *before* the decision — a swap made
   on 07-30 into the 07-29 book scores the new name from 07-29's close, one day of
   free hindsight; and
2. silently stop resolving the name that was removed.

Together that is a track record an operator could launder by editing history, in a
product whose entire claim is an auditable trail.

## Decision

**A veto acts on the next run and never mutates a published row.**

`editorial_vetoes` (migration 058) records a refusal of `(asset, direction)` with a
**`reason` that is NOT NULL by constraint** — the same guard, for the same reason,
as `book_revisions.reason` (ADR-0093): an unexplained absence from the book is
indistinguishable from a bug in the screen. `direction` is nullable and NULL means
both sides, because *"this name is untradeable"* and *"this SHORT is crowded"* are
different claims and collapsing them makes the veto over-broad one way and
unenforceable the other.

`backend/services/editorial_vetoes.py` is pure except for one function.
`screen_candidates` reads `state["editorial_vetoes"]` — populated by `run_q1_agent`,
**not fetched in the node** — so the node stays testable with a state carrying no
credentials, which is how `test_q1_agent.py` exercises it.

Placement in the screen is load-bearing in both directions:

- **Before the cap-30**, so a refused name does not occupy a slot in the LLM's
  context window and push a good candidate out by proxy.
- **After the rule-based filters**, so the funnel reads as eligibility-then-judgement
  and the veto count stays honest — vetoing a name the R² filter had already dropped
  would report attrition twice.

The drop surfaces as a `screening_funnel` stage shaped like ADR-0046's conviction
override: **it renders even when it removed nothing**, because a funnel listing only
the stages that fired implies the others do not exist, and a reader should be able
to see that editorial judgment was available and declined to act. Reasons are quoted
**verbatim** — the reason *is* the judgement, and paraphrasing it would put an
authored string in front of a reader that nobody wrote (ADR-0025 rule 1).

**Rows are revoked, never deleted.** `revoked_at` retires a veto and
`revoked_requires_reason` demands an explanation, so *"why is this name back?"* stays
answerable. `scripts/veto.py` is the operator interface — a CLI, not a button beside
a position, because a veto is an infrequent considered act.

## Consequences

Positive:
- The one step a PM performs that no rule can encode now exists, with an author, a
  reason and an expiry.
- It cannot launder the track record. Published books are untouched; `pick_outcomes`
  is untouched.
- A veto is visible: the funnel names the refused candidate and quotes the reason,
  in the same place ADR-0046's override already appears.
- `expires_on` distinguishes a tactical objection (crowded tape, pending print) from
  a structural one, so a moment-in-time view does not silently become a standing ban.

Negative / friction:
- **A veto cannot help today's book.** If a name in the published book looks wrong,
  the honest options are to say so or to wait for tomorrow — not to edit. That is the
  cost of the guarantee above, and it is the right way round.
- **A read failure degrades to "no vetoes applied"**, not to "refuse everything": an
  unreachable table must not empty the book on a network blip. The cost is that a
  veto can silently fail to apply, so `fetch_active_vetoes` prints the table name
  when it cannot read it.
- Determinism (ADR-0013) now has a human input. The run is still reproducible *given*
  the veto set, and the set is itself an audited table — but the pipeline is no longer
  a pure function of market data alone. That is what editorial judgment costs.
- "Never deleted" is a discipline, not a SQL guarantee: the service role can still
  `DELETE`. It was used exactly once, to remove this change's own smoke-test rows.

## Alternatives considered

**Substitute into the published book.** Closest to the original ask and rejected on
the hindsight/laundering grounds above. It would additionally require `pick_outcomes`
to carry a per-pick `entry_date` distinct from `run_date` — a schema change to the
one table whose job is to be un-gameable.

**Dissent overlay: keep the pick, publish the disagreement.** Genuinely honest, and
kept in reserve. Rejected as the primary mechanism because it records judgment
without ever acting on it — the PM's objection changes nothing about what the book
holds, which is not what "editorial judgment" means.

**Veto by theme rather than by name.** Rejected: a theme-level refusal is what the
HypeScore attention gate already is, and the unit of a veto should be the thing that
would appear in the book.
