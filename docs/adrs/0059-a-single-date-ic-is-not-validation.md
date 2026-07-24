# ADR-0059 — A single-date IC is measured, not validated — and the harness must survive to persist it

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0042](0042-absolute-hype-subscores.md), [0044](0044-carry-ic-was-measured-on-a-superseded-signal.md)

## Context

`GOAL.md`'s operating principles put validation second only to the answer existing:
*"Validation is the spine, not an afterthought."* HypeScore is the Q2 deliverable —
it quantifies attention — and the site is careful to say attention is not mispricing:
`/method`'s **Does HypeScore actually predict returns?** panel labels it **NOT YET
VALIDATED** and points at `scripts/backtest_hype.py`, the rank-IC harness.

Two things were wrong underneath that honest-looking panel, and they compounded.

**1. The harness crashed before it could persist.** `_print_report` printed its
legend with a Unicode arrow (`→`) and approx-equal (`≈`). On any stdout encoded as
cp1252 — a Windows shell, a mis-configured CI runner — writing those raises
`UnicodeEncodeError`. That print runs *before* `_persist_report`, so the crash aborts
the run with nothing written. The visible symptom was a panel showing **all-null**
`hype_ic` rows (n_obs 0 everywhere), which reads as *"the harness produces nothing"* —
when in fact, with the forward-price window that had since accrued, it could compute a
real IC. A latent crash on the write path had frozen the panel in a false "no data"
state.

**2. The panel would have overclaimed the moment a number landed.** Its verdict was
`validated = stats.some(s => s.ic !== null)` — *any* non-null IC flips it to the green
*"a stable non-zero IC is what makes HypeScore a signal"* copy. But the first IC the
harness produces is a **single date's** cross-sectional rank correlation across ~8
themes. One cross-section carries no information about stability, and stability is the
entire difference between a signal and a lucky draw. Measured live on 2026-07-25: h1
IC **−0.2275**, from `n_dates = 1`, `n_obs = 8`, `ic_ir = null`. Under the old rule
that would have painted the panel green. It is not a signal; it is one day.

## Decision

**Fix the crash with ASCII.** The two print strings use `->` and `~=`; the low-history
warning's em dash becomes a hyphen. Nothing about the output's meaning changes, and it
can no longer abort on a byte it cannot encode. Persist is also made idempotent
(delete this `end_date`'s rows before insert) so re-runs do not stack.

**Key the verdict on the IC information ratio, not on a point IC.** The IC IR
(mean/σ across dates) is the stability measure, and it is *undefined below two
independent cross-sections* — which makes it the exactly-right boundary between
"measured once" and "a signal". `validated` now means `some horizon has ic_ir != null`.
A number that exists but has no cross-date stability is **measured-thin**: shown with
its value and labelled *"measured · N dates — not yet stable"*, and the footer calls
it a single-date point estimate in as many words. The prose already claimed the IC IR
was what mattered; this makes the code say the same thing.

The verdict logic lives in `frontend/lib/method/hypeValidation.ts` as pure functions
(`horizonStatus`, `isValidated`, `isMeasuredThin`), unit-tested — including the trap
directly: **500 observations on a single date is still not validated**, because
breadth is not stability.

## Consequences

- The panel now tells the truth about the current state: HypeScore IC *has started to
  be measurable* (h1, one date, IC negative — attention mean-reverting, consistent
  with the crowding story the EdgeScore sentiment tilt already assumes), and is *not
  yet validated* because there is no stability across dates. That is strictly more
  informative than the all-dashes it showed before, and it does not overclaim.
- The write path can no longer be silently killed by an un-encodable character, so the
  daily refresh's IC step will actually deposit results.
- **The negative sign is worth noting, not acting on.** One date of IC −0.23 is not
  evidence that HypeScore anti-predicts; it is one draw. The honest move is to let the
  harness accumulate dates and watch the IC IR, which is exactly what the panel now
  waits for.
- The generalisable rule, and why this is an ADR rather than a patch: **a validation
  surface must gate on the statistic that means "stable", not the one that means
  "exists".** A non-null point estimate is the weakest possible bar, and wiring a
  "validated" claim to it is how a heuristic gets mislabelled a signal.
