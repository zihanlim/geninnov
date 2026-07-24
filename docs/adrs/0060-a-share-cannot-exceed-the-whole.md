# ADR-0060 — A share cannot exceed the whole: withhold net share on a market-neutral book

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0047](0047-conviction-needs-a-vol-floor.md), [0037](0037-position-limits-bind-and-the-rest-is-cash.md), [0016](0016-signed-weights-portfolio-accounting.md), [0058](0058-explanations-are-owed-per-empty-slot.md)

## Context

`/risk`'s per-position attribution carries a **Net share** column: each position's
signed weight as a share of the book's net exposure. On the live 2026-07-25 book it
read:

| asset | signed wt | net share |
|---|---|---|
| PDD | −9.6% | **−1071.4%** |
| BABA | −9.1% | **−1019.0%** |
| XLE | +8.8% | **+975.7%** |
| NUE | +6.4% | **+711.9%** |
| JPM | +6.2% | **+686.6%** |

The book runs **net +0.90% on 59.6% gross**. Dividing a ~9% position by a 0.9%
denominator is where the four-figure percentages come from.

The formula was `signedWeight / |net|`, guarded only by `netAbs > 0`. That guard
catches a *perfectly* hedged book and nothing else — and the interesting case is not
exact zero, it is *near* zero.

**Near zero is the design target, not an edge case.** This product builds a $100M
long-short book and reports market-neutrality as a feature; `/book`'s own summary says
*"It is close to market-neutral."* So the column was systematically broken for exactly
the kind of book the system exists to produce, and would have looked fine only on a
directional book this platform is not trying to build.

The damage is not merely cosmetic. A reader who takes the column at face value
concludes a single name is ten times the book. It is the same failure this project
keeps finding — **a correct calculation presented as if it meant something** — in the
company of the min-max HypeScore, the unfloored conviction ratio (ADR-0047), the
book-level beta pushed inside a per-pick loop, and the Sharpe of 10.77 on two sessions.

## Decision

**Withhold net share when it would not be a share.** The rule is not a tuned threshold;
it is what the word means:

> A share is a part of a whole, so it cannot exceed the whole. If the largest single
> position is larger than the entire net tilt, the ratios are not shares of anything.

```
netShareIsMeaningful(signedWeights)  ⇔  |Σ w| > 0  ∧  max|wᵢ| ≤ |Σ w|
```

On the live book: `max|w| = 9.6%`, `|net| = 0.90%` → withheld. On a directional book
with net 50% and a largest position of 15% → rendered.

Three properties:

- **No constant to fit, and none to drift.** ADR-0047 needed a stated basis for its vol
  floor because 5% annualised is a convention; this needs none, because the bound falls
  out of the definition. There is nothing to re-tune when the book changes.
- **Withheld, not clamped.** Capping the display at 100% would still assert that the
  decomposition exists. The honest statement is *"this book is close to market-neutral,
  so its directional tilt does not decompose"* — the same distinction iterations 20–21
  drew for VaR/Sharpe below their minimum sample: *"we do not know"* and *"we know, and
  it is X"* must not look alike.
- **The predicate is exported and used by both the computation and the panel that
  explains the blank.** ADR-0058 was forced by a verdict re-derived at the render layer
  drifting from the one computed upstream; the rule lives in one function so the column
  and its explanation cannot disagree.

**Gross share is untouched and is the column to read.** It divides by gross exposure,
which is 59.6% here and never near zero for a book with positions — so the panel loses
no information it could legitimately have shown, and says so.

## Consequences

- **A column of blanks now carries a sentence.** The note names both figures (net
  +0.90% against a largest position of 9.6%) and states that this is the *normal* state
  of a long-short book rather than a fault, so a reader does not read the absence as a
  data outage. A bare `—` with no explanation is the defect `docs/GOAL.md` tells every
  iteration to hunt.
- **On a genuinely directional book the column returns**, with no code change and no
  configuration — the predicate is evaluated per render against the book on the page.
- **This was found by reading the rendered page, not by a test**, which is now true of
  every defect this project has found. The old code computed exactly what it intended;
  no unit test would have flagged it, because there was no disagreement between two
  numbers — only a number that could not mean what its label claimed.
- **Not addressed here, and visible in the same table:** `Avg |ρ| to book` renders `—`
  on all nine rows, because it averages only pairs flagged at ρ ≥ 0.70 and this book has
  none. That is arguably correct — an unflagged book has no flagged correlations — but a
  column that can only be empty or partial is a weaker surface than one that reports the
  mean correlation outright. Named rather than fixed, because changing what it measures
  is a different decision from withholding one that cannot mean what it says.
