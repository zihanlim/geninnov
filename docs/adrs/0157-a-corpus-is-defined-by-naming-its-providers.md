# ADR-0157: A corpus is defined by naming its providers

**Status:** Accepted
**Date:** 2026-07-29

## Context

[ADR-0094](0094-no-corroboration-gate-over-a-single-source.md) has recorded since it
was written that HypeScore's attention, volume and sentiment all rest on **one**
provider. It refused to build a corroboration gate over a single source — at N=1 a
gate either always passes or can never pass — and disclosed the count instead,
deriving it so that wiring a second provider would correct the disclosure rather than
create a new false claim.

On 2026-07-29 that exposure stopped being theoretical. Brave's quota died mid-run,
three themes collected zero documents, and each was published with a fabricated
`hype_score = 28.5714` ([ADR-0156](0156-a-failed-feed-is-not-a-quiet-market.md)).
ADR-0156 made that failure *audible*. It does not make it *survivable*: one provider
failing still costs the themes it covered.

### What was measured

Four options, on the same day, against the repo's own queries:

| Provider | Publication date present | Self-host | API key | Quota |
|---|---|---|---|---|
| **RSS** | **388/388 = 100%** | no | no | none |
| SearXNG (news category) | 360/429 = 84% | **yes** | no | none |
| SearXNG (general category) | 0/194 = **0%** | **yes** | no | none |
| Brave | dated | no | **yes** | $ per 1000 |

`pubDate` is **required** by the RSS 2.0 spec and is emitted by the publisher. Every
search-derived option infers a date from a result page, which is why SearXNG's general
category carries none at all. Publication date is the field that buckets a document
into a day, so a provider that guesses it can carry neither a share-of-voice series
(ADR-0155) nor a `mention_count_1d`.

Self-hosted metasearch was measured properly and rejected on the merits. Two of the
three objections originally raised against it were **wrong** — dates are present at
84% and agreed with the URL slug on 8/8 checkable, and run-to-run composition was
stable at 92.6–93.6% Jaccard. What held: it is *more* recency-skewed than the provider
[ADR-0144](0144-a-second-provider-that-is-an-archive.md) already rejected for that
(52.1% of a 45-day window in the last 7 days, vs Brave 48% and GDELT 18%; 28 of 45 days
populated vs GDELT's 40), one engine carried **200 of 250** market-seed results so a
single block collapses the corpus, and public instances returned 429/403 on the first
request. It also requires a host, which the operator ruled out.

### The defect this surfaced

`load_market_corpus` defaulted to `sources=None`, meaning **every row in
`market_news`**. Under that rule, adding a provider is an `INSERT` — so a new fetcher
redefines the denominator of every share in the combined series without touching a line
of scoring code and without any reviewable config change.

That is ADR-0155's failure arriving through the one door ADR-0155 did not guard: not a
change in fetch *depth*, but in fetch *breadth*. The 2.5× corpus-size guard would not
even fire — RSS adds ~383 documents to ~1840, a 21% move, well inside the band.

## Decision

**1. RSS is added as a third provider** — `backend/data/rss_client.py`, 14 broad
financial and business feeds, stdlib only, no key, no host. Two regulator feeds (Fed,
SEC) are included deliberately: primary sources whose items are not selected by an
editor chasing traffic is a *different* bias from the newswires, not a smaller one.

**2. A corpus names its providers.** `COMBINED_SOURCES = ["brave_market", "gdelt"]`,
and `load_market_corpus` applies it as the default filter. There is no longer any
value of `sources` that produces an unfiltered read.

**3. RSS is SHADOW on arrival.** It is absent from `COMBINED_SOURCES`, so it is
collected, source-tagged and persisted while no scored corpus reads it. Turning it on
is the single act of adding it to that list.

The shadow period is not caution for its own sake. The corroboration ADR-0094 asks for
— do two providers agree about which themes are loud? — **cannot be measured before
two providers have run side by side.** Switching RSS on immediately would change every
share in the combined series on the same day it became possible to check whether it
should.

**4. An undated item is dropped, not stamped.** Dates being real is the entire
argument for this provider; keeping an undated item would spend that property for one
extra headline, and would put an unknown-age document into a daily bucket — the
failure [ADR-0066](0066-not-computable-must-persist-as-null.md) names.

**5. A dead feed is reported, not absorbed.** `fetch_market_rss` returns the items
**and** the per-feed failures, and `all_failed` distinguishes "the feeds were quiet"
from "we have no network". Fourteen feeds silently becoming three is ADR-0156 with more
steps.

## Consequences

**RSS is not a replacement for Brave, and the numbers say so.** Filtering the pooled
388 headlines through `THEME_KEYWORDS`:

```
Geopolitical Risk 23 · Fed Policy 18 · Inflation 7 · AI Capex 6
Energy Prices 3 · US Election 2 · China Growth 0 · US Dollar 0 · Corporate Credit 0
```

Three themes matched **nothing**. A general-news pool cannot be interrogated per theme;
Brave returns ~40 per theme because you can ask it a question. This supplements the
paid provider and does not substitute for it.

**RSS is not an archive either.** A feed holds only its most recent items, typically
10–50. There is no backfill: what was not collected yesterday is gone. GDELT remains
the only source of history.

**The first live run found a bug of exactly the kind this ADR is about.** 14 of 14
feeds fetched successfully and **0 items parsed**, with no error anywhere — an
ElementTree `Element` with no subelements is falsy, so `node.find("title") or
node.find("atom:title")` discarded every title in every feed. Silent emptiness,
reproduced inside the fix for silent emptiness. It is now pinned by a test.

**The explicit source list is the durable half of this change.** RSS is one provider;
the next one arrives the same way. `test_corpus_sources_are_named.py` asserts that no
call path yields an unfiltered read and that persisting an RSS row leaves the combined
corpus byte-identical.

**`sourceIndependence()` will report three fetched providers, one of them contributing
nothing to any scored corpus.** That disclosure is derived rather than stated
(ADR-0094), so it stays true through the shadow period rather than needing an edit
when RSS is switched on.

## Alternatives considered

**Add RSS to `COMBINED_SOURCES` immediately.** Rejected — it changes a published
denominator on the same day the data to justify it starts existing, and it discards the
parallel-history window that makes the corroboration question answerable at all.

**Route `theme_news` through RSS to stop paying Brave.** Rejected on the measurement:
three of nine themes match zero RSS headlines. This would trade a $5 bill for three
themes that cannot be scored.

**Self-hosted SearXNG or OpenSERP.** Measured and rejected above — worse recency skew
than an already-rejected provider, single-engine concentration, and a host requirement.

**A separate table for shadow rows.** Rejected: `market_news` is already the un-themed
corpus and a second table would duplicate its schema. Once the corpus is defined by an
explicit provider list, the table can safely hold rows no corpus reads — which is the
general fix, where a new table would have been a fix for RSS specifically.
