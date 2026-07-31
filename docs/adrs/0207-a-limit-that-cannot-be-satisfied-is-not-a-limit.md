# ADR-0207: A limit that cannot be satisfied is not a limit

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0197](0197-a-lens-control-belongs-where-every-figure-can-follow-it.md), [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md), [ADR-0056](0056-an-instruction-is-not-a-guardrail.md), [ADR-0115](0115-a-complex-is-one-idea.md), [ADR-0123](0123-a-group-cap-is-projected-not-declared-close-enough.md), [ADR-0015](0015-lens-mode-asset-class.md)

## Context

Asked whether the mandate should differ between the credit lens and the multi-asset book.
The credit book's own numbers answer it.

The **2026-07-30 credit book** — 3 positions, EMB 20% / BIL 20% / BKLN 10%, 50% gross:

| limit | credit | multi-asset |
|---|---|---|
| single-name 20% | **EMB 100%, BIL 100%** | max 37% |
| sector 30% | **Credit 100%** | max 38% |
| geo 35% | US 86% | max 67% |
| net exposure ±30% *(monitored)* | **167% — BREACHED** | 26%, OK |

Same numbers, entirely different meaning. The credit book sits on three enforced caps
simultaneously; the multi-asset book's tightest is 67%.

**Why it deploys only half the capital**, traced through the binding chain:

1. 11 in-lens candidates;
2. correlation at ρ≥0.70 collapses **9 of the 11 into one complex** (AGG, ANGL, EMB, HYG,
   IEF, JNK, LQD, SHY, TLT);
3. `complex_pct` 20% ([ADR-0115](0115-a-complex-is-one-idea.md)) gives that whole
   complex 20%, spent on EMB;
4. `single_name_pct` 20% caps BIL;
5. the Credit sector cap stops BKLN at 10% (30% − EMB's 20%).

**50% is the maximum this pool can legally deploy.** Every remaining Rates name is inside
EMB's full complex; TIPS is the only other sector in the universe and was not a candidate.
The $50M in cash is arithmetic, not caution.

## Decision

**The mandate's numbers stay identical across lenses. One monitored band is reported as
not-applicable when the run's pool cannot satisfy it. Nothing else changes.**

### 1. The net-exposure band, and only it

A ±30% net band is a statement about a long/short book. The credit pool contained **zero
short candidates**, so |net| = gross by construction. Scoring that as a breach is an alarm
about a book working exactly as designed — [ADR-0197](0197-a-lens-control-belongs-where-every-figure-can-follow-it.md)'s
argument for why the alarm register must not be spent on context, applied to a limit rather
than a panel.

It was also the *loudest* thing on the page. `tightest()` picks the highest utilisation, so
167% became the "Closest to binding" headline in warning colour, **displacing the three
limits that genuinely bind at exactly 100%**. The page's most prominent risk statement was
about the one limit that governs nothing.

**Withhold the verdict, keep the measurement.** |net| 50% against a 30% band stays on
screen with its utilisation; only OK/BREACH is withheld, because the judgement is what is
wrong, not the number. Blanking the value would hide a fact to avoid an unhelpful opinion
about it.

**A new `LimitStatus`, not a reuse of `unknown`.** Unknown means the value was withheld for
want of sample; here it is known exactly and the *limit* does not govern. Conflating them
sends a reader hunting a broken pipeline. `not_applicable` also breaks compilation at both
exhaustive `Record<LimitStatus, …>` maps and at the chip table, so no consumer can ignore
it silently — and the contrast suite validated the new chip automatically.

**Measured per RUN, never assumed per LENS.** From `independent_ideas.short.count`, not from
the published picks: a book can hold zero shorts because the agent *declined* every one it
was shown, and that is a selection the band should judge. `short.count === 0` is the stronger
claim — there was nothing to short. And per run because the credit universe **can** produce
shorts (L1 sets direction from `sign(TradeScore)`; HYG, LQD, JNK, TLT could all come through
short); it was simply empty that day, so the band goes live again the first run a credit
short appears. A blanket per-lens exemption would be a mandate that quietly relaxes itself.

**Fails toward the limit.** Absent or null scores the band normally, so a row predating
ADR-0056 is judged exactly as before. Absence of evidence must not switch a published limit
off — that is the direction that flatters the book.

### 2. What was rejected, and why it is the more important half

**Per-lens limit values.** The governance failure: the strategy choosing its own risk
appetite, and the mandate stops being what the firm allows. Comparability across lenses dies
with it.

**Re-basing the sector cap on credit sub-sector (IG / HY / EM / loans).** Genuinely more
meaningful — a 30% cap on "Credit" inside a credit book measures the lens's definition, not a
choice — and it would let BKLN, an independent idea, go 10%→20%. But it buys ~10 points of
deployment, leaves $40M idle for the same underlying reason, and is a change to **solver
constraints**. Whether 30%-per-sub-sector is the firm's appetite is a decision for the firm,
not a refactor.

**Loosening `complex_pct` for credit.** Rejected outright. Credit instruments share duration
and spread factors, which is *why* 9 of 11 candidates are one bet. Relaxing the complex cap
would deploy more capital into what is measurably one idea — the opposite of risk management.

**A risk-weighted single-name cap.** Tempting: BIL (front-end T-bills, near-zero duration and
credit risk) hits the same 20% ceiling as EMB, so the cap binds hardest on the safest
instrument in the book. But `credit_rates_exposures.py` clears its `|beta/se| ≥ 2` gate for
**1 of 9** held names, so a risk-based cap has no measurement to stand on. Revisit when the
betas are believable.

### 3. The finding that outranks the fix

**The cash is the mandate working.** The credit lens found 3 independent ideas and the caps
refused to pretend that is 10 — precisely [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md)'s
"hold whatever the position limits refuse as cash rather than renormalising the book back to
full notional". A version of this system that deployed $100M across 3 correlated credit
positions would be worse, not better.

So the binding constraint is a statement about the **universe**, not about the mandate. Two
honest responses, both strategy decisions rather than engineering ones:

1. **Widen the credit universe** so more genuinely independent ideas exist. The current
   14-ticker set is dominated by one duration/spread factor, which is why 9 names collapse to
   one. If the firm's mandate really is credit + rates (per ADR-0015), this is the substantive
   answer and it is a research question.
2. **State on the page that a credit book on this universe runs ~50% deployed** — as a
   property of the mandate meeting a thin universe, not as an unexplained pile of cash.

Neither is done here.

## Consequences

**Good.** `/mandate?lens=credit` no longer shows a false breach, and its "Closest to binding"
headline is now `Single-name cap (max) 100%` — the constraint that actually binds. The
default page is unchanged (`OK`, 7.7% / 30.0%, 26%; headline still Turnover 100%). The new
status is exhaustively handled by construction.

**Costs, stated.**

- **A limit can now be switched off by data.** The blast radius is one monitored band whose
  reason is rendered in the row, gated on a measured pool, failing toward the limit — but the
  mechanism exists, and a future `not_applicable` on an *enforced* cap would be a much larger
  claim. A test pins that only `net_exposure` can take the status today.
- **The disclosure is prose in a row**, so it grows the card. Accepted over a tooltip: a
  reader seeing N/A on a published risk limit will ask why, and a hover answer is invisible on
  touch and absent from Ctrl+F.
- **Three limits remain arguably mis-scoped for a single-asset-class lens** (sector, complex,
  single-name) and are deliberately untouched — §2 says why each is worse to change than to
  leave.
- **`hhi` was not checked.** It is monitored against `portfolio_risk.concentration_hhi`, which
  is lens-less (ADR-0194), so the credit book's own HHI is computed nowhere. On capital weights
  it is 900 and compliant; on deployed weights (0.4/0.4/0.2) it would be 3600 and past the
  2000 limit. Which basis the backend uses decides whether a fourth limit is silently
  unsatisfiable for this lens. Named, not resolved.

**Rejected.** Everything in §2; and suppressing the row entirely rather than marking it, which
would make "this limit does not apply" indistinguishable from "this limit does not exist".
