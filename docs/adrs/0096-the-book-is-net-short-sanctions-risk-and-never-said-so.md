# ADR-0096 — The book is net short sanctions risk, and never said so

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md), [0066](0066-not-computable-must-persist-as-null.md), [0043](0043-single-company-universe.md)

## Context

The 2026-07-25 book held **short BABA at 8.7% and short PDD at 9.25%** — 17.9 percentage
points of book weight, which against 59.3% gross is **30.2% of gross exposure** in US-listed
Chinese ADRs. Those are the most sanctions-exposed names in the Tier-1 universe: HFCAA
delisting risk, Entity List additions, outbound-investment restrictions.

Two things followed and neither was stated anywhere.

**First, the size.** 30% of gross in one sanctions-sensitive jurisdiction is a concentration
worth naming on its own.

**Second, and more important, the direction.** Held *short*, sanctions escalation is a
**tailwind** — the opposite of what a China-heavy position list suggests at a glance. A
reader scanning the book would assume the wrong sign.

This is the mirror image of what
[ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md) surfaced.
S6 revealed that short GDX plus short NOC was an unlabelled *short*-geopolitical-risk bet
worth −1.24% in a supply shock. Here the same book carries an unlabelled *long*
geopolitical-risk position at 30% of gross. In both cases the exposure is a side effect of
picks made on entirely other grounds — theme scores and EdgeScore — and in neither did the
book mention holding one.

The worldmonitor review flagged `ListSanctionsPressure` / `LookupSanctionEntity` as the
highest-value layer for this universe, which was right about the *subject* and wrong about
the *dependency*: the exposure needs no external data at all.

## Decision

`backend/services/sanctions_exposure.py` classifies the book's sanctions exposure from data
we already hold, and states which side it cuts.

**No credential required for the part that matters.** Which names sit in a
sanctions-sensitive jurisdiction, and which side we hold them, is entirely ours — `GEO_MAP`
plus the picks. worldmonitor's `get_sanctions_data` would add the dimension we lack — whether
pressure is *rising* — and is credential-gated exactly as `get_chokepoint_status` is
(`-32001`, Pro tier $39.99/mo, [ADR-0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md)).
The module is built so that a pressure score would *scale* an exposure we can already state,
rather than being the thing that makes it statable.

**Keyed on jurisdiction, not on tickers.** A Chinese ADR added to the universe tomorrow is
covered the day it appears — the same generalisation argument S6's `SECTOR_MAP` transmission
rests on.

**The classification is a judgement, so it is written down.** `EXPOSURE_MECHANISM` names the
specific channel per jurisdiction — "HFCAA delisting risk, Entity List additions,
outbound-investment restrictions" — rather than asserting a score. A reader can disagree with
an entry and see exactly what they are disagreeing with, which is not true of a number. A
test asserts every mechanism names a real channel rather than a vibe.

**Three states, not two.** `EXPOSURE_MECHANISM` says exposed; `NO_IDENTIFIED_CHANNEL` says
checked and clear; anything in neither is `unclassified` and reported as *"unknown, not
absent"*. Silently folding an unrecognised jurisdiction into "not exposed" is the same
known/unknown conflation [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md) and
the `assessStaleness` verdict work both removed.

## Consequences

- Live output on the 2026-07-25 book: *"NET SHORT sanctions risk: 30.2% of gross sits in
  sanctions-exposed jurisdictions (short PDD, short BABA), held net short by 17.9pp.
  Sanctions escalation is therefore a TAILWIND for this book, not a risk to it — the
  opposite of what a China-heavy position list suggests at a glance."*
- **Gross exposure is not netted away.** An offsetting long and short in the same
  jurisdiction reports `direction: flat` at book level while `exposed_gross` still records
  the full 10% — the book-level wash does not make the per-name exposure disappear.
- `share_of_gross` is `None`, not `0.0`, when the book has no gross: a share of nothing is
  unmeasurable ([ADR-0066](0066-not-computable-must-persist-as-null.md)).
- A position whose `direction` is unreadable is `unclassified`, never assumed long —
  guessing would invert the book's stated posture on a sanctions-exposed name, which is the
  most damaging error available here.
- **A unit correction, recorded because it was made repeatedly.** 17.9 is percentage *points
  of book weight*; the share of *gross* is 30.2%. Earlier notes in this workstream reported
  "~18% of gross", conflating the two and understating the concentration by a third. Both
  figures are now asserted separately by test so neither can be reported as the other.
- `gross_exposure` is passed in rather than summed from the picks, so the denominator is the
  same one `book_metrics` reports and the two cannot disagree.

## The render (shipped same day)

`/risk` shows it beside the stress table — the same kind of claim: what the book does under a
shock it did not choose. Persisted to `research_recommendations.sanctions_exposure`
(migration 045) and rendered from there rather than recomputed in TS, because the jurisdiction
map is a **judgement**. Two copies of a judgement drift into a confidently wrong
*classification* with no visible symptom, whereas two copies of a formula produce a visibly
wrong *number*. (Contrast `lib/method/trackRecord.ts`, which does re-implement its backend
aggregate — justified there because that aggregate is never persisted, only its per-pick rows
are.)

The persisted `summary` sentence renders verbatim, for the same reason each scenario now
carries its own description
([ADR-0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md)): the page must
not restate the direction in different words from the module that decided it.

Backfilled onto the live 2026-07-25 row so the disclosure applies to the published book, and
**that backfill is itself logged in `book_revisions`** — the second real entry in the log
ADR-0093 built, with `previous_value` NULL because the field did not exist rather than because
it was zero.

**The goal-3 guard caught the first draft.** It rendered the side with inline `badge-long` /
`badge-short`, and `chip-contrast.test.ts` flagged it: that sweep has no allowlist by design,
and a legitimate direction chip is expected to use the `dir-pill-*` primitive
([ADR-0085](0085-direction-cannot-be-carried-by-hue-alone.md)). Rewritten to match
`AttentionCrowding.dirLabel`, so there is one way to render a side on `/risk` rather than two.
Conforming was correct; exempting the chip would have been the exact failure that test exists
to prevent.

A null column renders "not judged", explicitly not "no exposure" — a run predating migration
045 has not been assessed, and the two must not look alike.

## What this still does not do

It does not tell you whether sanctions pressure is **rising** — only what the book would do if
it did. That needs the credential.
