# ADR-0159: The plane read one day, and it was the wrong one

**Status:** Accepted
**Date:** 2026-07-29

## Context

[ADR-0158](0158-a-day-is-when-it-was-published-not-when-we-fetched-it.md) fixed the
archive series' bucketing, and the series became genuinely rich: **381 measured
velocities across 35 publication days**. The detection plane on `/` was nevertheless
blank, showing *"No measurable velocities yet — marks rise into this plane as each
phrase accrues enough observed days."*

The data was there. The board could not see it.

`lib/narratives.ts::toSeries` derives one anchor date and every consumer keys off it:

```ts
const latestDate = rows.reduce((max, r) => (r.run_date > max ? r.run_date : max), …);
const latest     = list.find((r) => r.run_date === latestDate);
```

The plane plots `latest.velocity`; so do the emerging shortlist, the uncovered count
and the attention funnel. All of them therefore describe exactly one day — the newest
in the window.

**And the newest day is structurally the least measurable one.** GDELT publishes with
a lag, so the most recent publication day is always the thinnest at the moment the job
runs, and a thin day is precisely what ADR-0155's corpus-size guard withholds a
velocity for. The board keyed itself to the single day most likely to have nothing.

The two defects compounded in a way neither would alone: ADR-0155 correctly refuses to
measure a thin day, and the board only ever looks at the day most likely to be thin.
Both behaved as designed and the result was a blank chart above a full series.

## Decision

**When the newest day carries no measurable velocity, the plane reads the most recent
day that does — and says which.**

- `latestMeasuredDate(rows)` returns the newest `run_date` with any non-null velocity,
  or `null` when the window contains none.
- `toSeries(rows, asOf?)` takes an optional explicit day. The default is unchanged, so
  `AttentionFunnel` and every other caller keep reading the newest run.
- The fallback engages **only** when the newest day is unmeasurable, so a healthy day
  is bit-identical to before.

**Both plane coordinates move together.** The plane is share × velocity; a share from
today plotted against a velocity from Tuesday is not a point on any plane. Pinning the
whole `latest` row to one date is what makes the fallback coherent rather than a
convenient mixture.

**The date is stated, prominently.** A chart labelled "run 2026-07-29" while plotting
2026-07-27 would be a worse lie than the blank it replaces. The header gains
`· last measured day` and the board carries a note naming the date and the reason.

## Consequences

**A withheld day now degrades to the last real reading instead of to nothing.** That is
the correct direction for this board: "here is the most recent thing we could actually
measure, dated" beats both a blank plane and — far worse — a plane of zeros.

**It does not weaken ADR-0155.** No velocity is invented, no threshold is relaxed, and
a withheld day stays withheld. This changes only *which* day the view is drawn from,
and never silently.

**The staleness is visible and bounded by the fetch window.** `fetchNarratives(30,
"archive")` reads 30 days, so the fallback can reach at most 30 days back. If it ever
displays a date that old, the honest reading is that the archive has stopped being
extended — which the stated date makes obvious rather than hiding.

**The other consumers are deliberately untouched.** `AttentionFunnel` counts what the
newest run saw and should keep doing so; its question ("what did today's corpus look
like") is not the plane's question ("what is breaking out"). Changing `toSeries`'
default would have silently redefined both.

**This is the third distinct way one bug class has surfaced this day** — ADR-0155
(corpus volume), ADR-0158 (the date field), and now the view's anchor date. The common
root is that a share is a fraction of a corpus, and every part of the system has to
agree on which corpus and which day. Two of the three were invisible in the output.

## Alternatives considered

**Plot velocity as a time series instead of a single-day scatter.** A larger change and
arguably a better board, but it answers a different question: the plane exists to show
*today's* loudness × breakout, and a phrase's velocity path over 30 days is a different
chart. Worth building; not a fix for this.

**Relax the corpus-size guard so the newest day always measures.** Rejected outright —
that guard exists because a share across a corpus break measures the denominator, and
loosening a correct detector to make a chart look populated is how the 28.5714 in
[ADR-0156](0156-a-failed-feed-is-not-a-quiet-market.md) happened.

**Change `toSeries`' default to the most recent measured day.** Rejected: it would move
`AttentionFunnel` and the uncovered count off the newest run without anyone asking, and
those genuinely want today. An opt-in argument keeps the change where it was reasoned
about.

**Leave it, since ADR-0158's newest-first fetch made the live day measurable again.**
It did — 2026-07-28 went from 11 documents to 109 and from 0 velocities to 37. But that
fixed the *supply* of documents, not the board's dependence on one day. The next thin
day, from any cause, would blank it again.
