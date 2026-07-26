# ADR-0091: Breadth must be a share of something named

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [ADR-0012](0012-citation-guardrail-llm-defense.md) (numbers must reconcile), design goal 1 (no naked numbers)

## Context

`regime_classifications.spx_breadth` was labelled "% of SPX above 200d MA" on
`/method`, stored as a percentage, and cited by published books. It was computed
like this:

```python
if latest_close > latest_ma:   # SPY vs its own 200-day average
    return 65.0
else:
    return 35.0
```

One ticker, one comparison, two possible answers. It was not a share of anything
— it was a boolean wearing a percentage.

That would be a labelling problem on its own. What made it a correctness problem
is `_classify_sentiment`, whose breadth rules are:

```python
if breadth is not None and breadth < 40:  return "risk-off"
...
if breadth is not None and breadth > 60:  return "risk-on"
```

35 and 65 sit deliberately either side of 40 and 60. So **whenever breadth
resolved, it fired one of those two rules**. The VIX, term-structure and credit
rules above it only fire in genuine extremes (VIX > 25, HY > 500bp), and
`"neutral"` — the function's own third outcome — was unreachable on any day the
price feed worked. A four-input sentiment model was, in practice, a one-bit
switch on whether SPY closed above its 200-day average.

The year of L3 history backfilled earlier the same day is the evidence: 244
`risk-on` and 20 `risk-off` classifications, **zero neutral**, tracking SPY-vs-MA
almost exactly.

This was found while fixing a different bug in the same function (it had no
`as_of` bound, so a backfill would have stamped today's reading on every
historical row) and while reading an /ask answer that said "S&P 500 breadth of
65.00%" — a sentence that is true about the stored value and false about the
world.

## Decision

**Breadth is now the share of a named universe trading above its own 200-day
moving average, reported 0–100.**

The universe is the **eleven GICS sector SPDRs** (XLK, XLF, XLV, XLY, XLP, XLE,
XLI, XLB, XLRE, XLU, XLC).

**Why not the 500 constituents**, which would be the truer measure: there is no
constituent list in this repo, and using *today's* membership to measure a 2025
date imports survivorship bias into a historical series — the backfill would be
measuring the index that exists now, backwards, and calling it history. The
eleven sector ETFs have no membership question: each existed on every date in
the range and still does. They also partition the index by construction, so
"how many sectors are above their own average" is a real breadth statement about
the S&P rather than a restatement of the S&P.

The cost is granularity: the reading moves in steps of 1/11 ≈ 9.1 points. That is
disclosed rather than smoothed, and it is still enough for the 40/60 thresholds
to mean something — 2026-04-01 now reads **54.55**, which is exactly the case the
old design could not produce.

Three supporting rules:

- **A moving denominator is refused, not averaged.** If fewer than eight members
  have a full 200-day window, the function returns `None`. A share computed over
  whichever tickers happened to download is not comparable to yesterday's.
- **The universe is named in the UI.** `RegimeInputsPanel` said "% of SPX above
  200d MA" while measuring one ETF; it now says "% of 11 GICS sector SPDRs above
  their 200d MA". A source line that describes a different computation than the
  one that ran is worse than no source line.
- **The reading is bounded by `as_of`**, like every other L3 input.

### The published record is not restated

Books published on 2026-07-22 through 2026-07-25 **cite breadth** — 07-24's
`book_view`, its picks and its citations all reference it. Overwriting those
regime rows would leave a published thesis citing "65" against a row that now
reads 81.82, which is precisely the silent history-rewrite this product exists to
prevent.

So the recomputation covers **2025-07-22 through 2026-07-21 only** — every date
before the first published book. The four rows from 07-22 onward keep the
readings their books were reasoned against, and the next live pipeline run
continues the series with the new measure.

**This leaves a documented discontinuity in the column**: rows up to 2026-07-21
are a real share of eleven sectors; rows 07-22 to 07-25 are the old 65/35 flag;
rows from 07-26 are the real share again. Four legacy rows is the price of not
retconning four published books, and it is the right price. Anyone comparing
across that seam needs to know, which is why it is written here rather than
smoothed away.

## Consequences

**What gets better.** `neutral` becomes reachable, so the VIX, term-structure and
credit rules decide the days that are genuinely ambiguous instead of being
overruled by a boolean. The number on `/method` means what its label says. An
/ask answer quoting breadth is quoting a measurement.

**What gets worse.**

- **Historical sentiment labels changed** for pre-publication dates. They are
  more defensible now, but anyone who took a screenshot of the old series will
  find it different. That is the correct direction of travel and still a change.
- **A network dependency grew**: eleven tickers instead of one, cached once per
  process. A backfill downloads them once, not once per date.
- **Granularity is coarse.** 9.1-point steps. A 500-name version would be
  smoother and needs a constituent list plus an explicit stance on survivorship
  bias — a separate decision, and one that should be its own ADR.

**What would reopen this.** If `SECTOR_ETFS` is ever narrowed to one ticker, or
if a caller starts mapping the share back onto two constants, the failure mode
returns: an input that decides the answer while presenting as a supporting
detail. The tests in `tests/backend/test_regime_backfill.py` pin the share
against a synthetic universe, including that a 5-of-11 reading lands *between*
the two thresholds.
