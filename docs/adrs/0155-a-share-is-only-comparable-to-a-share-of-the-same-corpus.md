# ADR-0155: A share is only comparable to a share of the same corpus

**Status:** Accepted
**Date:** 2026-07-29

## Context

[ADR-0154](0154-maxrecords-caps-a-response-not-a-query.md) fixed the archive's
density by windowing GDELT requests — roughly six times the documents per day. The
discovery layer immediately produced its first measurable velocities, and **every
one of the 34 was negative.**

That is not a finding about the market. It is arithmetic.

`velocity` is a robust z-score of a phrase's share of today's corpus against its
own history of shares. Share is `doc_count / corpus_size`. The windowing change
raised `corpus_size` from a median of ~20–60 documents to **868** in a single day,
so every phrase's denominator grew ~15× while its numerator did not. Every share
collapsed, and every velocity went negative together — the signature of a
denominator change, which is exactly what it was.

ADR-0153 had already stated the governing rule while guarding a different door:

> a series has to be counted out of the same kind of corpus every day or its
> differences mean nothing

It guarded the **provider mix**. Corpus **volume** breaks the same rule, and
nothing was watching it, because the volume was assumed to be a property of the
world rather than of our fetch configuration.

Two further defects surfaced in the same run, both of the same family — a constant
calibrated against a corpus that no longer exists.

**A fixed document floor is a moving share.** `MIN_DOC_COUNT = 3` was chosen
against ~11-document days, where it meant "appears in 27% of the corpus". At 868
documents it means 0.35%, so three incidental co-occurrences admitted a phrase.

**Top-N by share discards exactly what the detector is for.** `TOP_N_PERSISTED =
150` was harmless when a day yielded ~20 phrases. At 868 documents a day yields
736, so 586 were dropped — ranked by *share*, which is the wrong criterion, since
an emerging narrative is by definition **quiet and accelerating**. The live run
reported **0 emerging on a day with 34 measured velocities**.

## Decision

**1. Withhold velocity across a corpus-size break.** `MAX_CORPUS_SIZE_RATIO = 2.5`.
When today's corpus is more than 2.5× larger or smaller than the median of the
history it would be compared against, `velocity` is `None` and the reason travels
with it. Not a correction factor — we do not know what the phrase's share *would*
have been, and inventing one would be worse than declining.

2.5× each way is deliberately loose. Day-to-day collection genuinely varies with
what a fetch returns, and this must not suppress an ordinary day; it is aimed at
the order-of-magnitude break only a config change produces.

**2. The floor is a count OR a share, whichever is higher.**

```python
floor = max(min_doc_count, math.ceil(n_docs * min_doc_share))   # MIN_DOC_SHARE = 0.01
```

The absolute count protects a thin day from admitting a phrase seen once; the
share stops three documents from being a 0.35% accident once the corpus is large.
**Neither alone survives an 80-fold change in corpus size**, which is the range
this codebase has now actually operated over.

**3. Persist the loudest AND the movers.** The keep-list becomes a union of the two
questions the table serves — "what is the news about today" (top-N by share) and
"what is breaking out" (any phrase below the cut whose `|velocity| >=
VELOCITY_MATERIAL`). The second set is bounded by the phrases with enough history
to have a velocity at all, so it cannot balloon.

## Consequences

**The guard fired on its first live run, and that is the evidence it works.** The
2026-07-29 rebuild printed:

```
corpus is 1447 documents against a median history of 55 — 26.3x.
Velocity is WITHHELD for this run
```

A day with no velocities is a worse-looking board and a more honest one.

**After the fix, velocities are two-sided:** 141 positive / 132 negative across the
replayed archive, with 28 emerging. A detector that returns one sign for every
input is measuring itself.

**The withheld day is not recoverable.** Velocity needs a comparable history, and
history collected under a different fetch configuration is not comparable. The
series effectively restarts at each break — which is an argument for changing fetch
configuration rarely, and never silently.

**This does not make corpus size stable.** It detects a break and refuses; it does
not prevent one. The durable fix is a corpus whose volume we control rather than
one assembled from query-shaped fetches — see
[ADR-0156](0156-a-failed-feed-is-not-a-quiet-market.md), which is the same root
cause reaching the anchor themes.

## Alternatives considered

**Normalise share by corpus size.** That is what share already is. The problem is
not that the ratio is unnormalised, it is that a 15× denominator change alters what
the ratio can resolve — a phrase in 3 of 20 documents and one in 130 of 868 are the
same share and not the same measurement.

**Rescale history to today's corpus size.** Requires assuming the missing documents
would have distributed like the observed ones, which is precisely the assumption a
6× deeper fetch invalidates: the new documents come from the *older* end of each
window (ADR-0154 runs oldest-first).

**Raise `MIN_DOC_COUNT` to suit the larger corpus.** Fixes today and breaks the next
time the corpus shrinks. A constant that must be re-tuned per corpus size should be
expressed as a function of corpus size, which is what the share floor is.

**Drop `TOP_N_PERSISTED`.** Rejected on storage: 736 rows/day × two corpora × 45
days of replay is real. The union keeps the bound while fixing the criterion.
