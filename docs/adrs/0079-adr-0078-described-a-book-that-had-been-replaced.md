# ADR-0079 — ADR-0078 described a book that had already been replaced

**Date:** 2026-07-25
**Status:** Accepted — corrects the evidence in [0078](0078-a-disqualifier-you-cannot-locate.md), whose decision stands
**Relates to:** [0078](0078-a-disqualifier-you-cannot-locate.md), [0070](0070-forward-dating-was-never-implemented.md), [0064](0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md)

## Context

[ADR-0078](0078-a-disqualifier-you-cannot-locate.md) opens on a measurement:

> *"**six of the ten** name the same trigger … `wrong if X breaks its 200-day MA` … and
> nothing anywhere on the page says what that moving average is."*

**That was true of a book that no longer existed when the ADR was written.** In the same
iteration, a full `daily_refresh` was launched against production and returned mid-way
through the work. The counter-theses were read *before* it finished and the ADR was written
*after* — so the evidence describes the superseded book and the ADR reads as though it
describes the current one. Both carry `run_date 2026-07-25`, which is exactly why the
staleness was invisible.

The published book now says something quite different. **Seven of ten name an external
driver at a measurable level, with the source series cited:**

| pick | disqualifier |
|---|---|
| SHY | 2y yield (**DGS2**) above **4.75%**, 3+ consecutive closes |
| XLE | WTI (**CL=F**) below **$80**, 5+ closes |
| SVXY | VIX (**^VIX**) above **25** for 5+ sessions |
| NUE | copper (**HG=F**) below **5.50 USD**, 3+ closes |
| GDX | gold (**GC=F**) above **4200 USD**, 3+ closes |
| BABA | China announces a **>500B USD** stimulus package |
| NOC | US defense appropriations **>10% YoY** in markup |

**Exactly one — ARKK — is self-referential:** *"breaks above its 200-DMA by >5%"*. UNH names
a legislative mechanism and PDD an earnings mechanism; neither is a price, and neither is
the defect ADR-0078 described.

**A guard for this was prototyped and deliberately not shipped.** A regex classifier
separating "names an external driver" from "restates the price going the other way" flagged
**UNH and PDD as false positives** — a legislative trigger and an earnings trigger both look
self-referential to a pattern that keys on the ticker appearing in the clause. The
distinction wanted here is *does this name a mechanism that could fail* , which is a
judgement, not a pattern. A guard at that precision would be worse than none: it would
train future work to make counter-theses **look** external rather than **be** falsifiable.
The first attempt also mis-stripped the preamble (`"XLE long is wrong if"`, not `"Long XLE
is wrong if"`) and reported **all ten** as circular — caught only by printing the clauses
rather than the verdict.

## Decision

**Record the correction; keep ADR-0078's decision; do not ship the classifier.**

- **ADR-0078's evidence is superseded**, and its prevalence claim ("six of ten") should be
  read as describing the pre-run book of 2026-07-25 only. `ARCHITECTURE.md`, `PROGRESS.md`
  and `GOAL.md` are amended to say so at each place they repeat it.
- **ADR-0078's decision stands unchanged.** `moving_average_context` is still computed and
  rendered: ARKK's disqualifier is still a 200-DMA trigger and still needs its distance
  stated, and where a name sits against its long-run average is useful context for any
  position. The feature was never contingent on the count.
- **No counter-thesis quality guard.** Recorded as attempted and rejected, with the reason,
  so it is not re-attempted blind.

## Consequences

- **The lesson is about *when* evidence is captured, not whether it was checked.** The
  observation was correct when made and stale by the time it was written down, because an
  action taken in the same iteration invalidated it. `GOAL.md`'s standing mandate already
  says *"re-derive again immediately before any irreversible action"* — publishing a claim
  into three doc surfaces is one, and this extends the rule to it.
- **Same-`run_date` rows are not the same book.** The row is upserted on `run_date`, so a
  re-run replaces the content while every date on the page stays put — the same property
  [ADR-0070](0070-forward-dating-was-never-implemented.md) traced through `created_at`.
  Anything quoted from a book should be re-read after any run, not trusted from earlier in
  the session.
- **The counter-theses genuinely improved**, and this ADR does *not* claim credit for it.
  The prompt changed in the same window (ADR-0075/0077), so the improvement is observed,
  not attributed — one run is one draw, and the next may regress.
- **Three prose classifiers have now nearly produced a wrong verdict in this project**
  (the `/risk` provisional warning, the `/NaN|undefined/` sweep matching the English word,
  and this one). The pattern is firm enough to state: **when a regex disagrees with the
  data, print the matches before believing the count.**
