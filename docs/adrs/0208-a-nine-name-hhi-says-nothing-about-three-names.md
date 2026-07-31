# ADR-0208: A nine-name HHI says nothing about three names

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0207](0207-a-limit-that-cannot-be-satisfied-is-not-a-limit.md), [ADR-0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md), [ADR-0197](0197-a-lens-control-belongs-where-every-figure-can-follow-it.md), [ADR-0115](0115-a-complex-is-one-idea.md), [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md)

## Context

[ADR-0207](0207-a-limit-that-cannot-be-satisfied-is-not-a-limit.md) closed by naming `hhi`
as an unchecked fourth limit. Checking it found the sharpest lens defect on the page.

`/mandate?lens=credit` showed:

> **Concentration (HHI) · OK · 1,174 / 2,000 · headroom +826 · 59%**

over a **three-name** book. That figure is the **multi-asset** book's:
`portfolio_risk.concentration_hhi` has no lens column (ADR-0194). The credit book's own HHI
is **3,600** — a breach of the same limit.

Of every lens-less row on that page this is the most inverted. A VaR borrowed from another
book is at least *a* risk number. A **diversification** figure borrowed from a nine-name book
reads as **reassurance** about a three-name one — in exactly the direction that flatters. It
was disclosed by ADR-0197's chip, so nothing was hidden; but a chip saying "some rows here are
multi-asset" does not say "and this one would breach if it were yours".

**What the limit arithmetically is.** HHI normalised by gross gives N equal names exactly
`10000/N`:

| names | HHI | vs 2,000 |
|---|---:|---|
| 2 | 5000 | breach |
| 3 | 3333 | breach |
| 4 | 2500 | breach |
| **5** | **2000** | at the limit |
| 9 | 1111 | ok |

So `limit_hhi = 2000` is not an independent risk statement — it is **"hold at least five
roughly-equal names"**, wearing an index.

That settles the two lenses in opposite directions:

- **Multi-asset: relevant, and doing work nothing else does.** 1,174 against an 1,111
  nine-name baseline says the book is within 6% of equal-weighted. No cap catches that: the
  20% single-name limit would happily permit one name at 20% and eight at 3%. HHI is the only
  limit measuring the *shape* of the weight distribution rather than its extremes.
- **Credit: the limit applies and the figure is true, but redundant.** 3,600 breaches because
  the book holds three names — which the page states at the top, and which is itself
  downstream of [ADR-0115](0115-a-complex-is-one-idea.md)'s complex cap. It re-expresses "the
  pool offered three ideas" as an index.

## Decision

**Compute HHI per lens. Persist it on `book_metrics` so it follows the lens. Prefer it, and
fall back to the lens-less column when it is absent.**

### 1. A coverage gap, not an applicability one — and that decides the fix

ADR-0207 marked the net-exposure band `not_applicable` because no compliant value was
definable: the pool had no shorts. **This is not that case.** The limit genuinely applies to
the credit book and its value is perfectly well defined at 3,600. It simply was not computed.

So `not_applicable` would be a **false statement**, and would have misused the status added
one commit earlier. The two treatments are opposite for a reason:

| | net exposure (ADR-0207) | HHI (here) |
|---|---|---|
| is a compliant value definable? | **no** — no short side existed | **yes** — 3,600 |
| what was wrong | a false alarm | a true alarm, **silenced** by another book's number |
| fix | suppress the verdict | compute the figure |

### 2. The formula is imported, never restated

`risk_engine._hhi` already settled the basis question — `|weight|` normalised by **gross**, so
cash cannot dilute the index. Its docstring records the bug that forced it: a live book read
**425**, *below* its own 1,111 nine-name floor, which is impossible for a real HHI, because the
raw shares-of-capital summed to gross and the cash level was doing the diversifying.

`compute_book_metrics` imports that function. A second copy of the reasoning is how two
answers drift apart — the failure `mandate-drift.test.ts` exists to prevent one module over.

**The cross-check that makes this a scope fix rather than a new number:** the new
lens-following field reproduces **1173.57** for the multi-asset book — the exact value the
lens-less column holds. Where both are defined they agree.

### 3. Preferred with a fallback, so nothing moves until the next run

`> 0`, not a null check. The agent's placeholder `BookMetrics` carries `0.0`, and a real HHI
over a non-empty book is at least `10000/N`, so **zero can only mean "not computed"**. That
lets a row written before this field fall back to `portfolio_risk` and behave exactly as
today, without threading `computed` through the payload.

The row **cites which table it actually read**, because only one of them is this book's.

`lensScope.ts` lists **both** tables for the two panels that render it. The chip must keep
saying "part multi-asset" while historical rows are still falling back — shortening the
disclosure before the data justifies it is the same class of error in reverse.

### 4. The limit is restated in the unit it is

The note now says 2,000 is exactly `10000/5` — "hold at least five roughly-equal names", and a
book of four or fewer breaches by construction. A reader who cannot decode a Herfindahl can
still act on the sentence, and it is what makes the credit breach legible as *agreement* with
the complex cap rather than as a second independent problem.

### 5. Not backfilled

It is a pure function of already-published picks, so it could be. But that means writing to
eight published books' rows **outside the pipeline**, which produces no `book_revisions` audit
entry — and the field populates at the next 21:30 UTC run regardless. Not worth touching a
published record to save hours.

## Consequences

**Good.** The credit page will state its own concentration — 3,600, breached — instead of
another book's 1,174 OK. The multi-asset page is unchanged and stays correct. One more figure
moves off the lens-less list, so the credit page's disclosure banner will shorten rather than
lengthen as rows roll forward.

**The breach is legitimate, and that is the point.** Unlike the net-exposure alarm ADR-0207
suppressed, a $50M book in three names *is* concentrated and a risk officer should see it. It
is redundant with the complex cap, and redundancy between a concentration limit and a
diversification cap is agreement, not noise.

**Costs, stated.**

- **Nothing visible until the next run.** Both pages still read 1,174 today. Verified, and
  the correct behaviour — but it means the fix cannot be demonstrated on screen yet.
- **`0.0` is a sentinel.** Defensible (a real HHI cannot be zero) but it is still a
  magic value rather than an explicit `computed` flag, and a future field on `book_metrics`
  should not assume the same trick works for it.
- **The field is defaulted and last on the dataclass** so six hand-built `BookMetrics`
  constructions keep working. That makes it possible to construct the object and forget the
  figure; `compute_book_metrics` and the one placeholder both set it explicitly.
- **HHI still says nothing about correlation.** It squares away sign, so two positions that
  perfectly hedge each other count as concentration exactly as two that compound. That is the
  correlation matrix's job, and worth remembering before reading a low HHI as low risk.

**Found on the way, NOT fixed.** `compute_book_metrics` indexes `SECTOR_MAP[asset]` and
`GEO_MAP[asset]` **directly**, so one unmapped ticker raises `KeyError` and takes out gross,
net, factor tilts, cap utilisation and now HHI *together*. Latent because every ticker L5 can
pick is currently mapped. It is a bigger decision than this change — whether an unmapped name
should fail the book or fall to an "Unmapped" bucket — and it is named here so it is a known
gap rather than a surprise.

**Rejected.** Marking it `not_applicable` (§1); adding a lens column to `portfolio_risk`
(ADR-0194 — a second book must not write into the first book's record); recomputing it in the
frontend from `picks` (a second implementation of a formula whose basis was already got wrong
once); and backfilling (§5).
