# ADR-0205: A claim is resolved from the record of what was claimed, not from what is still published

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0117](0117-a-falsifiability-guarantee-that-lives-in-a-yaml-step-is-not-a-guarantee.md), [ADR-0203](0203-a-replaced-book-does-not-un-publish-its-picks.md), [ADR-0093](0093-a-published-book-that-changes-must-say-so.md), [ADR-0171](0171-a-veto-acts-forward-because-a-track-record-cannot-be-edited.md), [ADR-0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md)

## Context

ADR-0203 fixed the *reporting* of superseded claims — counted, disclosed, never removed —
and closed by naming the cause as unrepaired, with two candidate fixes:

> *The durable fix belongs in `scripts/resolve_outcomes.py` or the persist path — either
> void the superseded rows with a `void_reason` … or write outcomes only for the book that
> survives the run.*

Investigating those turned up something worse than the count. **Both candidates accept
that superseded claims are never scored, and being never scored is the actual defect.**

`resolve_outcomes.py` derived its claim set from `research_recommendations.picks` — from
whatever book is **currently published** for a run_date. The pipeline is invoked more than
once on some dates (measured: `research_agent_runs` holds 3 L5 invocations per day for
2026-07-27..30, and 17–25/day on 07-24/25 before this table existed), and
`research_recommendations` upserts on `(run_date, lens)` while `pick_outcomes` accumulates
the union. So a pick whose book was replaced was **never in the claim set again**: it stayed
`pending` past its `expected_exit_date`, forever, and could permanently pin
`first_expected_maturity`.

Live, 2026-07-31: **20 of ~80 claims** in that state — a quarter of the denominator, all
four affected dates 07-27..07-30. Independent corroboration that nothing had ever touched
them: of 70 `pending` rows, exactly **20 had no `entry_price`**, and they are the same 20.

A claim that can never resolve is not falsifiable. That is a violation of ADR-0090 — whose
title is *"a published pick must be falsifiable"* — reached not by removal but by
**abandonment**, which is why no guard saw it: `check_published_claims_are_on_the_record`
asks whether every published claim is *recorded*, and nothing asked whether every recorded
claim is *graded*.

### Two framings settled before deciding, because both would have led somewhere wrong

**"Only the authoritative daily run should record claims."** Rejected — it reverses
ADR-0117:36, *"The path that publishes a claim records it"*, which names *"a manual `python
-m scripts.daily_refresh`"* as a publication. `CLAUDE.md` documents manual runs against
production as intended, `workflow_dispatch` is enabled, and **no mechanism distinguishing
run kinds exists** (`daily_refresh.py` has no argparse and reads only `SUPABASE_*`,
`ANDROMEDA_ALLOW_MOCK`, `RUN_CREDIT_LENS`). The off-schedule books were served on the live
site for hours; a reader could have acted on them. Gating entry would also create an escape
hatch: run a book, look at it, and it never enters the record.

**"Resolve from `pick_outcomes` *instead of* `research_recommendations`."** The first draft
of this decision, and wrong in the word *instead*. That read is also the **repair path**
(`check_data_integrity.py` instructs operators to run this script to fix
published-but-unrecorded claims; it caught 9 of 32 missing on 2026-07-27) and the **only way
a second horizon can come into existence** (`daily_refresh` calls `commitment_rows` without
a horizon, so it only ever writes 21d — `--horizon 63` would find nothing to resolve,
silently voiding ADR-0090's *"a 63-day companion is a row, not a migration"*).

## Decision

**Record from the book. Resolve from the record.** One script, two passes, two write
disciplines:

| | reads | writes |
|---|---|---|
| **Pass 1 — RECORD** | `research_recommendations`, lens-scoped | insert-if-absent, `pending` only |
| **Pass 2 — RESOLVE** | `pick_outcomes` WHERE `verdict = 'pending'` | upsert onto those rows only |

Pass 2 reading the record is the fix: a claim survives its book being replaced. Everything
below follows from having to make that safe.

### 1. Why this dominates both options ADR-0203 offered

- **Void the superseded rows.** Rejected. `void_rate` is denominated in *matured* picks
  (ADR-0090), so this would publish *"the spec could not score a quarter of the record"*
  about picks the spec scores perfectly well — a false statement about the instrument, and a
  non-price cause smuggled into a column whose meaning is "the price series could not supply
  an end".
- **Write outcomes only for the surviving book.** Rejected. Deletion by another name
  (ADR-0203 §1), and it re-arms the erasure in §3 below.

Neither grades the claims. This does.

### 2. Pass 1 keeps the book read, and the lens gate moves onto it

ADR-0194 keeps the credit book out of `pick_outcomes`. The gate stays, on pass 1, and **its
justification changes**: it was *"this script derives its own claim set independently"*,
which stops being true. It is now that **pass 1 is the only pass that creates rows** — so
pass 2 can only ever update rows that already passed the gate, and is *structurally*
incapable of admitting a credit claim. That is stronger than a filter, because there is no
filter left to delete.

Pass 1 builds rows with `commitment_rows`, not `resolve_pick`, which also closes a latent
hole: once anything has matured, a repair would otherwise insert a fully **resolved** row
that never existed as `pending` — which ADR-0117 distinguishes as *"a different act
entirely"* from backfilling a pending row. Nobody had hit it only because nothing has
matured.

### 3. Scoping pass 2 to `pending` fixes an existing ADR-0117 violation

The old resolver re-derived and re-upserted **every** claim nightly. `fetch_closes` returns
`{}` when `yf.download` fails, an empty series resolves to `pending`, and `pending` with
NULL prices is permitted by the `resolved_shows_its_work` constraint — so **one yfinance
outage would write `pending` over a resolved `hit`**. Exactly the erasure ADR-0117:38
forbids, in the file that ADR exempted, and the docstring claimed the opposite. Terminal
rows are now absent from the read, so the idempotency claim is true for the first time.

### 4. A claim that cannot be priced must be able to void — `as_of`

`resolve_pick` was a pure function with no notion of *now*, so it could only answer
`pending` for a series that never arrives: empty, or stopping short of the horizon. A name
delisted five days into a 21-day window has five observations forever. **The subset most
likely to be unpriceable was the subset this ADR is about.**

New optional `as_of`. Past `expected_exit_date + VOID_GRACE_DAYS`, both branches become
`void` with a reason stating the drought (`"only 5 of 21 observations after …; series ends
…"`). `as_of=None` is byte-identical to before — which `commitment_rows` **depends on**,
since it calls `resolve_pick` with an empty series at publication and must get `pending`.
Recording a claim as void the moment it is published would be catastrophic.

**No new void cause.** Migration 043 (*"no price history, delisted, insufficient
observations"*) and ADR-0090 (*"no close on run_date, delisted, unusable price"*) already
name this; the code simply never reached it, having no clock. So this is ADR-0090 being
completed, not extended.

`VOID_GRACE_DAYS = 10` is derived where it is written: `expected_exit_date` ignores market
holidays and is therefore a lower bound, at most 2 holidays fall in a 21-business-day
window (≈ 4 calendar days), plus margin for a skipped run. The error is asymmetric — too
short and a live claim is voided because a feed was late, which is unfixable once terminal.

### 5. A failed fetch must never void anything

With an `as_of`-aware resolver, one outage past the grace window would permanently void the
entire matured set. **Zero tickers returned is a broken fetch, not a market in which
nothing trades**: the pass writes nothing and exits non-zero, so the nightly job fails
loudly instead of quietly destroying the record.

### 6. `--as-of` is refused for a real write

Measured on the live table: `--as-of 2026-10-01` voids **70 of 70** pending claims, because
the price series necessarily ends today while the grace window moves with the supplied
clock. A printed warning on a script that runs in a CI log is not a safeguard for a
terminal, irreversible verdict, so the flag is rehearsal-only and refused without
`--dry-run`. There is no legitimate write that needs a shifted clock: grading is a statement
about what the prices show *now*.

### 7. `spec_version` travels with the row

`resolve_pick` did not carry it into the outcome, so a row read back was re-stamped with
today's module constant. Since `spec_version` is in the conflict key, the day it becomes
`"v2"`: a v1 claim would be graded by v2 arithmetic, written as a **new** v2 row, and the v1
row abandoned as permanently `pending` — this ADR's own defect, by a new route. Pass 2 now
stamps the row's own spec and **refuses to grade a foreign one**, reporting it by name.

**Consequence, and it is a real cost: `SPEC_VERSION` can no longer be bumped in one line.**
A v2 requires keeping v1 resolvable — a spec→resolver registry — because migration 043
promises *"a future spec revision is additive rather than a rewrite of history"* and a
frozen v1 `pending` row is not additive. The integrity guard in §8 exempts retired-spec rows
for the same reason.

### 8. The reverse guard

`check_matured_claims_were_resolved` — the mirror of
`check_published_claims_are_on_the_record`. The two failures are mirror images and neither
implies the other: a claim can be published-but-unrecorded (nothing to grade) or
recorded-but-ungraded (nothing grading it), and only the first had a guard.

Three states, because collapsing them would report a spec migration as a data defect:
matured past grace on the current spec **fails**; on a retired spec it is **reported and
does not fail** (it needs a resolver for that spec, not a re-run); a NULL
`expected_exit_date` is **reported as unknown**, never skipped — every row `to_row` writes
has one, so a NULL is hand-inserted and the single case where silence would hide the class.

Grace 7 against the resolver's 10, deliberately: a human should see the stall while the
claim can still be graded, not after it has taken a terminal void.

## Consequences

**Good.** 20 unfalsifiable claims become gradeable. The idempotency claim becomes true. A
delisted name can now reach a verdict at all. `resolved_at`, declared in migration 043 and
never written by any code, is stamped (in the resolver's payload, not in `to_row`, which
stays clock-free).

**Verified live, not only in tests.** Baseline 70 `pending` + 10 `void` = 80. Dry run: 70
gradeable, 0 foreign spec, **zero voids**, first maturity 2026-08-20 — exactly right for a
date on which nothing has matured. Real run: **total still 80** (ADR-0203's decisive
property), and `pending` rows carrying an entry price went **50 → 70**, because the 20
superseded claims were touched for the first time since publication. A second run wrote 0.

**Costs, stated.**

- **The superseded quarter now enters the hit rate.** Today all 20 are `pending` and touch
  only `total`; once graded they are scored like any other claim. So roughly a quarter of
  the hit-rate denominator will come from claims a reader cannot find on `/book` for that
  date. ADR-0203's disclosure says they stay in the denominator; it must now also say they
  are graded and counted. That is the honest direction — the disclosure gets stronger — but
  it is a change in what a published number means.
- **`SPEC_VERSION` is no longer a one-line bump** (§7).
- **The cause is still not prevented**, only survived. Two books for one run_date remain
  possible; ADR-0203 explains why that is acceptable (they were both published) and this ADR
  makes both gradeable, but nothing stops a third.
- **`superseded` is still derived at read time** by diffing against `book_holdings`, so it
  is a property of what that table says now rather than a fact recorded when the supersession
  happened.
- A void is terminal and now reachable by a clock, so the two grace constants and the
  zero-ticker refusal are load-bearing in a way nothing else in this module is.

**Rejected.** Both ADR-0203 options (§1); entry-gating on run kind (Context); replacing the
book read rather than demoting it (Context); a printed warning instead of a refusal for
`--as-of` (§6).

## Corrections to existing prose

ADR-0171's harm (2) — *"silently stop resolving the name that was removed"* — **is no longer
true**: a removed name keeps resolving from the record. Its decision stands undisturbed on
harm (1) alone (a substitute inheriting an entry price from before the decision), and the
rule *"a veto acts on the next run and never mutates a published row"* is unaffected. The
same sentence appears in `backend/services/editorial_vetoes.py`, `scripts/veto.py` and
`supabase/migrations/058_editorial_vetoes.sql`; the first two are corrected in place, and the
applied migration's comment is corrected here rather than by editing history.

ADR-0194 §5 and the comment block in `resolve_outcomes.py`: the lens gate's justification is
now *"pass 1 is the only pass that creates rows"* (§2).

ADR-0117:44 — *"`resolve_outcomes.py` is unchanged and remains the repair path and the
resolver"* — still true, but the two jobs are now separate passes with separate write
disciplines, and the repair finally obeys 0117:38's own insert-if-absent rule.
