# ADR-0105: Most of our tables record when we asked, not when it happened

**Status:** Accepted
**Date:** 2026-07-27
**Supersedes:** —
**Renumbered:** filed as 0102, moved to 0105. A concurrent session had committed its own
0102 thirty-four minutes earlier; first commit keeps the number.
**Related:** [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md), [ADR-0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md), [ADR-0009](0009-research-first-design-philosophy.md)

## Context

A review of worldmonitor's dashboard proposed adopting several widgets: a live news video
panel with a broadcast channel picker, a 3D globe with 56 map layers, a finance radar across
29 exchanges, and a Country Instability Index. Run against the mockup triage in
`docs/design-goals.md`, four of five fail at step 1 — they invent data or capability the
backend does not have. Our geo data is six `GEO_MAP` buckets, not coordinates; our universe
is 53 named assets, not 29 exchanges; and a country stress *score* is exactly the opaque
number [ADR-0096](0096-the-book-is-net-short-sanctions-risk-and-never-said-so.md) rejected in
favour of a named channel a reader can disagree with.

The live news panel fails differently and worse. It reverses two written non-goals —
"real-time / tick-level anything" and the terminal look ([ADR-0009](0009-research-first-design-philosophy.md))
— but the deciding objection is narrower: **a video stream is the one element on the page a
reader could not trace.** Every other panel answers "where did this number come from". `/ask`
refuses to state a figure it cannot cite. An embedded broadcast cannot be cited, verified, or
reconciled against the book, and would be the only element exempt from the standard the rest
of the site is held to. The function it appears to offer — headlines behind the thesis — is
already served by `NewsFeed` and `ThemeDerivationDrawer` over `theme_news`, and those
headlines are the ones that actually moved HypeScore.

The fifth idea survived: worldmonitor advertises a **freshness monitor covering 35 source
groups**. We had nothing equivalent. Freshness was reported per surface — the book has a
`run_date`, the news ribbon a `published_date`, `/method` has pipeline health — so two
reader questions had no answer anywhere: *what is this built on?* and *which of those is
stale?*

## Decision

Build the freshness board over our own six sources. Building it surfaced the finding that
justifies the ADR.

**Most of our tables record only RETRIEVAL.** `macro_indicators` has `fetch_date` and
`fetched_at` and **no observation column at all**. `factor_exposures` has `run_date` and
`created_at`, both pipeline-assigned. So for FRED and Ken French, "how old is this reading"
has no answer in our schema — we know when we asked, not when the world was in that state.

This is [ADR-0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md)'s timestamp-role
distinction meeting our actual data, and it fails on two of six sources. A board printing
"updated 2026-07-25" would have hidden that behind a fresh-looking timestamp — worse than
saying nothing, because it answers a question it cannot answer.

So `age-unknowable` is a first-class verdict, rendered in the warning tone, and every age
**names the role it was measured from**. Three of six sources can date themselves: Brave (by
publication), yfinance (by trading date), CFTC (by observation Tuesday). Three cannot.

**Age is measured from the most meaningful date a table actually has** — observation, then
publication, then retrieval. Not cosmetic: the CFTC reading is observed Tuesday, published
Friday, retrieved Sunday, and measuring from retrieval would report a six-day-old reading as
one day old.

**Five verdicts, deliberately distinct**, because each asks something different of a reader:

| Verdict | Means | Reader should |
|---|---|---|
| `current` | rows, real date, within cadence | trust it |
| `stale` | rows, real date, past cadence | wait or investigate |
| `silent` | asked, got nothing back | treat the corpus as short |
| `unconfigured` | never asked — no credential | set the credential |
| `age-unknowable` | rows, but no observation date | not infer freshness at all |

Reddit is the live case for the last two: `daily_refresh` fetches it, the credential is
absent, `reddit_client` returns `[]` rather than fabricating posts
([ADR-0023](0023-data-provenance-and-fabrication-guard.md)), and `theme_news` has zero Reddit
rows. "Never asked" and "asked and got nothing" must not render alike
([ADR-0094](0094-no-corroboration-gate-over-a-single-source.md)).

Each source states its own **cadence** beside its threshold, so the staleness bar is arguable
rather than asserted. The catalogue is data (`SOURCES`), not JSX, so adding a source is one
entry and a test can assert against it.

## Consequences

**Two reader questions now have an answer**, on `/method/evidence` inside the existing
`sources` section rather than behind a new anchor — same reader question, so
[ADR-0084](0084-method-splits-by-reader-question-not-by-copy.md)'s stop rule applies.

**The headline is a count, not a percentage.** Six is too small a denominator for a
percentage to imply anything but false precision.

**A schema gap is now visible rather than merely true.** Giving `macro_indicators` and
`factor_exposures` real observation dates is a migration, not a render change, and the board
will show the improvement when it happens. Stating the gap first is the point: it was equally
true yesterday and nobody could see it.

**The board fails loudly.** If the source tables cannot be read it says so and calls it a
failure to check, not a clean bill of health — the same rule as every other absence here.

**What was refused stays refused.** The live news panel, globe, finance radar and CII are not
built, and this ADR is where that is recorded so the question is not re-litigated by
accident. If the live panel is ever wanted, it reverses two standing non-goals and needs its
own ADR arguing them down, not a component.
