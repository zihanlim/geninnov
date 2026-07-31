# ADR-0212 — A tilt is not the book's beta, and the denominator is what makes it one

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0063](0063-one-beta-bar-across-every-surface.md), [0208](0208-a-nine-name-hhi-says-nothing-about-three-names.md), [0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md), [0211](0211-a-disclosure-that-names-the-panel-cannot-name-the-row.md), [0082](0082-euler-risk-decomposition-on-the-final-book.md), [0040](0040-published-book-is-the-book-of-record.md), design-goals.md §1, §2

## Context

ADR-0211 tagged the five rows of the risk-limit board whose values are the multi-asset
book's under `?lens=credit`. Tagging them raised the obvious next question: which of
them could be the credit book's own figure instead? ADR-0208 had already answered it for
HHI — compute per lens, persist on `book_metrics`, cite which table was read.

Beta looked like the same fix. The credit book has a measured market exposure of its
own: `research_recommendations.book_metrics.factor_tilts.beta_mkt`, which follows the
lens, reads **+0.24** on the 2026-07-30 credit book against the multi-asset book's
**+0.14**, and is derived from per-asset 252-day regressions rather than from a realised
series the credit book does not have. ADR-0063 had even pre-argued the sample question
for this exact quantity:

> The factor-model beta is built from today's weights and 252-day regressions; **it
> needs no return history and is knowable on day one. Gating it would replace a real
> number with a blank.**

**The naive version of that fix is wrong, and how it is wrong is the reason this ADR
exists.** `book_metrics.py` computes each tilt as

```
book_tilts[f] = Σ(signed_w × β_f) / total_weighted        # total_weighted = Σ|w|
```

so `beta_mkt` is a tilt **per unit of covered gross**, not the book's beta. The book's
beta is the **un-normalised** `Σ(signed_w × β)` — the quantity ADR-0063 names in as many
words (*"the book's net factor beta is −0.0355: `Σ signed_weight × β_mkt`"*) and the only
one a `|β| ≤ 0.50` mandate limit can mean.

The credit book is half-deployed. Tilt **+0.24** at **50% gross** is a market beta of
**+0.12**. Wiring the tilt into that row would have published the book at **2× its actual
directionality**, against a limit — the same class of error as measuring a nine-name HHI
against a three-name book, arrived at by trying to fix that error.

## Decision

**Persist the denominator, not a second copy of the numerator.** `BookMetrics` gains
`factor_covered_gross` (= `total_weighted`), serialised beside the tilts it divides.

Three reasons that shape beats the alternatives:

- **One number, six factors.** `tilt × factor_covered_gross` recovers the un-normalised
  Σ for *every* factor. A parallel set of six `portfolio_beta_*` fields would double the
  surface and could drift from the tilts; a denominator cannot disagree with the division
  it performed.
- **It cannot be derived in a consumer.** `total_weighted` sums only the picks clearing
  `r² ≥ 0.10`, while `gross_exposure` sums all of them, so `tilt × gross_exposure` is
  wrong whenever any holding lacks a usable regression — and wrong in the direction that
  overstates. Approximating a mandate limit's numerator is not acceptable.
- **It exposes coverage that was invisible.** `factor_covered_gross / gross_exposure` is
  the share of the book the tilts describe. Nothing reported that before.

The board prefers the lens-following beta and falls back to `portfolio_risk.beta`,
**citing which it read** — the ADR-0208 pattern, so a run predating the field is
unchanged and the ADR-0211 tag keeps saying "part multi-asset" while it falls through.

**The preferred figure is UNGATED by `returnSessions`**, on ADR-0063's ruling quoted
above: it is today's weights against 252-day regressions, the same family as the cap and
exposure rows, which `riskBoard.ts` already exempts because they "need no history at
all". The 60-session floor travels with the fallback, which is a realised estimate and
does need the sample.

**Gate on `factor_covered_gross > 0`, not on `computed`.** Two traps, each pinned by a
test:

- `tilt × 0` is `0.0`, which against `|β| ≤ 0.50` publishes a confident **OK** on a
  perfectly market-neutral book that was never measured.
- **`computed` is `True` for an EMPTY book.** It means `compute_book_metrics` ran, not
  that anything was measured — `test_book_metrics_empty_picks` has asserted this all
  along. A consumer gating a beta on it alone reads `0.0 × 0.0` and publishes neutrality
  from a run with no positions.

And ADR-0208's `> 0` sentinel trick does **not** transfer to the tilt itself, because
`0.0` is a legitimate beta. ADR-0208 predicted this in its own consequences — *"a future
`book_metrics` field must not assume the same trick works"* — and this is that field.

**The row is relabelled "Market beta (|β|)", in the board and in `MandatePanel`.** The
regression is against `benchmark_returns`; the factor beta is against Ken French's MKT-RF
(the CRSP value-weighted market, not the S&P). A label naming one index is false whenever
the other is read, and the two cards sit 24px apart, so they are renamed together.

## Consequences

- **Nothing changes on screen until the next 21:30 UTC run** writes `factor_covered_gross`.
  Verified live: the board still cites `portfolio_risk.beta` and still carries the
  ADR-0211 tag. Same deliberate lag as ADR-0208, for the same reason — this is a pipeline
  field, not a backfill, and backfilling would write to published rows outside the
  pipeline with no `book_revisions` entry.
- **When it does populate, the beta row stops being NO DATA on BOTH lenses.** It currently
  reads `— / 0.50` under multi-asset too, because the realised regression is withheld
  below 60 sessions while a measured book beta sat on the same payload. This is not only a
  lens fix.
- **The tagged set shrinks from five rows to four**, and to three once ADR-0208's HHI
  lands. What remains is max drawdown (needs a realised series the credit book will never
  have — ADR-0194) and VaR/CVaR. ADR-0211's disclosure does not go away; its scope does.
- **VaR and CVaR are NOT done here, and this ADR is the argument for why they need their
  own.** The same trap applies with less forgiving arithmetic: `monte_carlo_var` and
  `var_forecast` follow the lens, but they differ from `portfolio_risk.var_95` by method,
  horizon AND basis (ADR-0082 exists because this system already shipped two numbers
  called VaR). Beta was swappable because both quantities answer "how directional is this
  book" in the same unit against a limit that is about directionality. A 6% limit
  calibrated on 1-day parametric VaR is not a limit on a Student-t Monte Carlo VaR at a
  21-day horizon, and repointing it would be a regression disguised as a fix.
- **Two betas still exist and are still different**, which ADR-0063 settled and this does
  not reopen. The board now says which one it read; the attribution footer's Σ and the
  metrics tile are untouched. Anything that starts comparing them across surfaces is
  re-litigating ADR-0063.
- **`factor_covered_gross` is computed and nothing yet renders the coverage ratio.** It is
  available and unused, which is a smaller debt than the alternative but is a debt.

## Alternatives considered

- **Persist six `portfolio_beta_*` fields.** Rejected: double the surface, and a second
  numerator can drift from the tilts. The denominator cannot.
- **Derive it in the frontend as `tilt × gross_exposure`.** Rejected: wrong whenever a
  holding lacks a usable regression, and wrong in the overstating direction. It would have
  passed on today's book (all names covered) and broken silently on the first one that is
  not.
- **Use the attribution panel's Σ, which is already un-normalised.** Rejected: it is
  computed over `portfolio_positions`, which has no lens column (ADR-0194), so it is the
  multi-asset book's Σ under every lens — the defect being fixed.
- **Leave the row borrowed and rely on the ADR-0211 tag.** Rejected: the tag is an honest
  report of a gap, not a substitute for closing one that can be closed. HHI set that
  precedent.
- **Add a lens column to `portfolio_risk`.** Rejected — ADR-0194, and it is a decision
  about the record rather than about a measurement.
