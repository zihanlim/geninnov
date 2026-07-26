# ADR-0097: External positioning can see a fifth of the book, and that is the finding

**Status:** Accepted
**Date:** 2026-07-26
**Supersedes:** —
**Related:** [ADR-0085](0085-direction-cannot-be-carried-by-hue-alone.md), [ADR-0093](0093-a-correction-that-does-not-quietly-replace-the-book.md), [ADR-0094](0094-one-source-is-not-corroboration.md), [ADR-0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md), [ADR-0096](0096-the-book-is-net-short-sanctions-risk-and-never-said-so.md)

## Context

Every crowding measure in this system was **internal**. HypeScore counts attention in a
corpus we assemble. `AttentionCrowding` ranks our own themes against each other. Both answer
"which of our themes is busiest", and neither answers the question a reader actually has
about a position: **is everyone else already in this trade?**

That gap matters because the two failure modes are not symmetric. A theme nobody is talking
about might be an edge. A position the entire speculative community already holds is not an
edge — it is exposure to a crowd unwinding, and it looks identical to conviction from the
inside.

The one external positioning series that is free, official, keyless, and long enough to
percentile against is the CFTC's **Commitments of Traders**. `publicreporting.cftc.gov`
answers unauthenticated (verified: 13 contract codes, current to 2026-07-21), which puts it
in a different class from the two worldmonitor feeds that are credential-gated at $39.99/mo
([ADR-0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md)).

The task that produced this ADR asked for **COT positioning and ETF flows**. Only one of the
two shipped; see "What we did not build" below.

## Decision

### Coverage is the headline, and the crowding verdict is subordinate to it

On the live 2026-07-25 book, exactly **two of ten positions** map to a futures contract — SHY
(UST 2Y) and SVXY (VIX). That is **22.2% of gross**. The other eight are single-name
equities, sector ETFs and thematic baskets that COT simply does not cover.

So `coverage_share` is computed first, persisted first, and rendered first. A panel that
opened with "no position is crowded" would be true and deeply misleading: it would invite a
reader to conclude the book had been checked when four fifths of it had not been.

The invariant `crowded_share <= coverage_share` holds by construction and is tested across
crowded and uncrowded readings alike. Both are denominated in **book gross**, not in the
observed slice — denominating the crowding share in the observed slice would let a single
crowded position in a thinly-covered book read as "100% crowded".

This is the same rule as [ADR-0094](0094-one-source-is-not-corroboration.md): when the
evidence cannot support the claim, publish the shortfall instead of the claim.

### Every unmapped position is listed with its reason

`unobservable` carries `{asset, direction, weight, reason}` for all eight. Never an omission,
because an omitted position reads as a checked-and-clear one.

The reasons are keyed on `SECTOR_MAP` rather than on tickers, so a name added to the universe
tomorrow inherits a reason the day it appears — the same generalisation argument the S6
transmission ([ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md))
and the sanctions jurisdiction map ([ADR-0096](0096-the-book-is-net-short-sanctions-risk-and-never-said-so.md))
rest on.

### Miners are not the metal, and sector equities are not the commodity

`GDX` is **not** mapped to gold futures. `XLE` is **not** mapped to crude. The bar for a
mapping is that the ETF holds or directly tracks what the contract settles on — GLD and IAU
clear it, GDX and NEM do not. A miner is an equity claim on a mining business carrying
operating cost, jurisdiction and financing risk the metal does not have.

Mapping them would have raised coverage from 22% to roughly 35% and made the panel look far
more useful. That is precisely why it is refused: manufactured coverage is the failure this
module exists to avoid, and the number it would have inflated is the one a reader trusts.

### The inverse product is where this could have been silently wrong

**SVXY is a -0.5x inverse VIX product: long SVXY is a *short* volatility position.** Comparing
its stated direction against the VIX speculator reading without flipping produces a verdict
that is exactly backwards.

A wrong *number* has a symptom — someone eventually notices it disagrees with another number.
A wrong *side* has none. It renders cleanly, reads plausibly, and is simply false. So
`ContractMap.inverse` exists, `effective_side()` is the only place direction is resolved, and
a test asserts the flipped and unflipped comparisons **disagree** — it fails if the flip is
ever removed rather than silently reverting to the wrong answer.

The panel renders the resolved side as its own column beside the book side, so a reader can
see the resolution rather than take it on trust.

This is the third finding this week whose substance was a **direction nobody had stated**:
short GDX + short NOC as an unlabelled short-geopolitical-risk bet (ADR-0088), the book being
net *short* sanctions risk so escalation is a tailwind (ADR-0096), and now long SVXY being
short volatility. The recurring failure is not bad arithmetic. It is an exposure that falls
out of sizing and is never named.

### Agreeing with a crowd is disclosure, never a signal

Nothing here recommends a trade, reverses one, or feeds sizing. A position sitting with an
extreme speculator consensus is reported as **exposure to that consensus unwinding**. The
80/20 percentile threshold is the conventional COT-index cut, named as a constant rather than
inlined, and explicitly *not* fitted — when someone does fit it, the change will be visible
in a diff.

### The lag is structural and is carried, not hidden

CFTC positions are as of **Tuesday** and publish the following **Friday**. A reading is never
fresher than three days and is up to ten days old before the next print. `as_of` is therefore
the **observation** date, not the retrieval date, and where contracts disagree it stores the
**stalest** — a mixed-date panel is only as fresh as its oldest input.

That observation/retrieval split is the role-distinct-timestamp idea from the provenance
envelope work, arriving here first because COT is the input where conflating the two would be
most misleading.

### `fetched=False` is a distinct state from "nothing is crowded"

`readings=None` (never fetched, or the portal failed wholesale) persists an assessment with
`fetched: false` and a summary that says positioning is **unknown, not neutral**. An empty
dict — fetched successfully, nothing usable — says the coverage gap is a gap and not evidence
of an uncrowded book. A null column says the run predates migration 046. Three different
claims, three different renders, none of them "not crowded".

### Persisted, not recomputed in TypeScript

Same argument as [ADR-0096](0096-the-book-is-net-short-sanctions-risk-and-never-said-so.md):
the contract mapping is a **judgement**, and two copies of a judgement drift into a
confidently wrong classification with no visible symptom, where two copies of a formula
produce a visibly wrong number. The mapping has one home, in Python. The `summary` sentence
renders verbatim so the page cannot restate the finding in different words from the module
that computed it.

## Consequences

**The live book carries the disclosure.** Migration 046 added the column; the 2026-07-25 row
was backfilled and **that backfill is logged in `book_revisions`** — the third real entry in
the log ADR-0093 built, `previous_value` NULL because the field did not exist rather than
because positioning was measured as absent.

**A silent-failure class got a guard.** Adding an analytic takes four edits — migration,
pipeline writer, row type, and the `/risk` select list — and missing the fourth produces *no
error anywhere*: the panel renders its empty state forever while the value sits in the
database. On a page whose empty states are deliberately careful, that is especially quiet.
`risk-analytics-columns.test.ts` now derives the expectation from `ResearchAnalyticsRow`
itself, so the next analytic is covered the day its field lands. It was negative-tested: with
`positioning_crowding` removed from the select list, it fails with the diagnostic.

**Two overlay analytics now share one reading of the book.** `_picks_and_gross` was extracted
so the sanctions and positioning panels cannot put different denominators on the same page.

**The nightly pipeline now makes a network call it did not before** — one request per distinct
contract, 12s timeout each, at most 13 in this universe and 2 in the live book. It degrades
per contract: a portal that does not answer yields a position marked unobservable *with a
reason*, never one counted as uncrowded.

**Coverage will stay low while the book stays equity-heavy**, and that is honest rather than
fixable. A credit-lens book would be worse: the CFTC publishes no Commitments report for
corporate credit at all, so HY and IG positioning is genuinely unobservable — not small, not
zero, unobservable.

## What we did not build

**ETF flows.** The task asked for them and they are not here, because no free source for them
exists. Creations and redemptions are the real flow measure, and they require shares
outstanding over time: `yfinance.Ticker.get_shares_full()` returns **zero rows** for GLD,
HYG, TLT and GDX (tested, not assumed). The remaining routes are a paid vendor feed, or
per-issuer scraping of iShares/SPDR daily files — fragile, 53 assets, and a ToS question.

The available free proxies are worse than nothing: **volume** is turnover, not flow, and
calling it flow would be a lie of exactly the kind the rest of this ADR is built to prevent.
So the gap is stated here and in `PROGRESS.md` rather than filled with a proxy, and the
crowding claim rests only on the evidence that exists.
