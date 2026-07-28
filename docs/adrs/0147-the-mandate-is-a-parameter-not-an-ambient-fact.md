# ADR-0147: The mandate is a parameter, not an ambient fact

**Status:** Accepted
**Date:** 2026-07-29

## Context

`/book` tells a reader that today's book is *"sized by conviction across $100M"*,
that *"$38.1M is held in cash: at 10 names the book cannot take more without
breaching its own position limits"*, and that the US geography cap is binding.

Every one of those is a claim about a **mandate** — a capital base and a set of
limits the book is run under. The mandate was real and fully enforced. It was
written down nowhere a reader could find, and in the two places parts of it *were*
written down, they disagreed with each other and with the sizer.

### What was actually enforced, and where it lived

| Constraint | Value | Declared in |
|---|---|---|
| Capital base | $100M | `scoring_config.total_capital`, plus ~15 hardcoded fallbacks |
| Single name | ≤ 20% | `book_metrics.py` |
| Sector | ≤ 30% | `book_metrics.py` |
| Geography | ≤ 35% | `book_metrics.py` |
| Gross | ≤ 100% | `optimizer.py` |
| Correlation complex | ≤ 20% | `optimizer.py` |
| Crowded-name cap | × 0.5 | `positioning_crowding.py` |
| Cash | residual, never a target | ADR-0037 |
| Book shape | ≤ 5 long + 5 short | `q1_agent.py` |

Nine constraints across five modules, mirrored by hand into TypeScript, kept in
agreement by a code comment asking the next person to keep them in step.

### The comment failed, twice

1. **The single-name and geo caps shipped TRANSPOSED** in `riskBoard.ts` (0.35 /
   0.20). The board judged every position against the wrong ceiling in both
   directions — understating single-name breaches by measuring a 20% cap as 35%,
   and overstating geographic ones by measuring a 35% cap as 20%.

2. **`gross_exposure_pct` read `2.0`** — 200% gross, 2× leverage — against an
   optimizer that has enforced `max_gross = 1.0` since ADR-0037 began banking
   un-deployable capital as cash instead of renormalising the book. The board was
   publishing a limit permitting leverage the sizer *structurally cannot produce*.
   That is precisely the defect [ADR-0123](0123-a-group-cap-is-projected-not-declared-close-enough.md)
   names: a published risk limit disagreeing with the published book.

Two further consequences of the same cause:

3. **`riskBoard.ts` looked up the cap values in `scoring_config`, where they had
   never been seeded.** All ten limits silently resolved to `house_default` — a
   lookup that reads as live and had never once returned a value.

4. **`net_exposure_pct: 0.3` and `beta_abs: 0.5` existed only in TypeScript.**
   Nothing in the backend constrains net exposure or beta, yet they rendered beside
   the 20% single-name cap as though a breach of either were the same kind of event.

And one piece of pure fiction: `TradeDerivationDrawer.tsx`, unreferenced by
anything, was the frontend's only list-form statement of the three caps. It
described the **pre-ADR-0037** allocator — claiming sector and geography caps
applied *"only when the group has ≥ 3 members"*, and that a capped name's excess was
*"redistributed to uncapped names… then the book is normalised once"*. ADR-0037
deleted the member-count qualifier and **reversed** the redistribution. Every line
of it was wrong.

### Why this is a goal-1 failure, not a tidiness problem

`docs/design-goals.md` goal 1: *"Every figure on screen traces to a persisted source
(`table.column`) or is labelled as a browser-side estimate."*

A reader seeing **"US geography 35% — at limit"** could not learn who chose 35%,
against what, or whether the sizer and the board agreed it was 35%. They did not
agree. The caps were naked numbers, at the level of the constraints the entire book
is constructed under.

## Decision

**The mandate becomes one object, passed as a parameter to the sizer.**

1. **`backend/services/mandate.py` is the single source of truth.** It holds every
   value. `book_metrics.py` re-exports the three caps so its dozen existing
   importers are untouched, but declares none of them.

2. **`OptimizerConstraints.from_mandate(mandate)`** replaces construction from module
   constants. `run_q1_agent` takes a `mandate` argument, seeds it into `Q1State`, and
   `size_positions` reads it — including `total_capital`, which previously came from
   `cfg.total_capital if cfg else 100_000_000.0`.

3. **The values are seeded into `scoring_config`** (migration 054), making
   `riskBoard.ts`'s existing lookup resolve for the first time. ADR-0037 already
   called the limit values *"an operator decision, not an implementation one"*, and
   an operator decision belongs in a table an operator can edit.

4. **`Mandate.sources` records per-field provenance** — `scoring_config` or
   `code_default`. The honest answer differs per field: the caps are seeded, the book
   shape and lens are not.

5. **Enforced and monitored are separate types** in `frontend/lib/mandate.ts`. The
   distinction is a different promise, not a label, and the type makes conflating
   them unrepresentable.

6. **`frontend/tests/unit/mandate-drift.test.ts` parses the Python** and fails when
   the TypeScript disagrees — the mechanism
   [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md)
   established for the minimum-sample rule. A comment is not a mechanism.

7. **`MandatePanel` on `/risk` states it**, above the board that measures against it.

### What this deliberately does NOT do

**No browser control may set the mandate.** Design goal 5: *"No control may imply it
can change the book… A button that implies a capability the system does not have is
a lie with a hover state."* The book is built by a GitHub Actions job at 21:30 UTC.
A cap changed at 14:00 changes nothing a reader can see until tomorrow, and nothing
at all about the book on screen. The panel says so in words rather than implying it
by the absence of a button.

## Consequences

**The sizer becomes `f(signal, mandate)`.** This is the load-bearing consequence.
One sizer can now serve three callers — the nightly run, a re-size under a different
capital base, and a caller-supplied mandate over MCP — and they cannot disagree
about what a limit is, because they are the same function reading the same object.
Verified: a `(5e8, 0.10, 0.20, 0.25, 1.5)` mandate yields those constraints against
the default `0.20 / 0.30 / 0.35 / 1.0`.

**The risk board stops contradicting the book.** Gross now reads a 100% limit from
`scoring_config` with 62% consumed, where it read a 200% house default before.

**A missing config row now yields the documented limit rather than an unbounded
one.** A malformed row is treated as a missing row: an absent limit must never
silently become a permissive one.

**The nightly job does one extra `scoring_config` read.** `load_mandate()` is
deliberately separate from `load_config()` — `ScoringConfig` is how a score is
*computed*, the mandate is what the resulting book is *allowed to be*, and the
mandate must travel to callers that never compute a score.

**`max_longs` / `max_shorts` and `lens` are in the object but not in the table.**
Book shape is enforced during agent selection rather than by the sizer, and the lens
is a per-run argument; seeding either would assert the solver honours it. They report
`code_default`, which is the true answer.

**Not addressed here:** the nightly run ships `lens="multi_asset"` while
[ADR-0015](0015-lens-mode-asset-class.md) records Andromeda Capital's own mandate as
credit + rates. Switching it changes the book and is an operator decision needing its
own ADR.

## Alternatives considered

**Leave the constants where they are and fix the two wrong numbers.** Rejected: it
fixes the instances and leaves the mechanism. The transposition and the 200% gross
ceiling were both introduced under a comment instructing the author to keep the
copies in step, which is evidence the comment does not work.

**Put the whole mandate in `ScoringConfig`.** Rejected: `ScoringConfig` answers how a
score is computed. Folding in the mandate would force every caller that sizes a book
to carry the scoring weights, which is exactly backwards for the MCP `size_book` case
where a caller supplies a mandate and computes no score at all.

**Generate the TypeScript from the Python at build time.** Rejected as heavier than
the problem. A drift test that fails loudly gives the same guarantee, matches the
existing `risk-thresholds.test.ts` precedent, and leaves both files readable.

**Seed the monitoring thresholds too, for uniformity.** Rejected: it would assert the
sizer honours a 30% net band and a 0.5 beta ceiling that no code enforces. Leaving
them `house_default` is the true statement.
