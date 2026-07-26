# ADR-0089 — A citation the reader can follow

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0010](0010-citation-footnotes-everywhere.md), [0012](0012-citation-guardrail-llm-defense.md), [0058](0058-explanations-are-owed-per-empty-slot.md), [0066](0066-not-computable-must-persist-as-null.md)

## Context

The theme derivation drawer renders the headlines behind a HypeScore as the
evidence for it. A reader who wants to know why a theme scored the way it did
opens the drawer, reads the headlines, and stops there — because the headlines
are plain text. There is nothing to click, and no way to check that a headline
says what the score implies it says.

Design goal 1 is explicit that this is worse than showing nothing:

> A number a reader cannot follow back to its origin is worse than no number,
> because it spends credibility we then can't rebuild.

An unlinked headline has the exact shape of that failure. It *looks* like
provenance. It is presented in the position provenance occupies. And it
terminates in a dead end, so the credibility it spends buys nothing.

**The link was never missing from the pipeline.** It was being discarded, three
steps before the reader:

| Step | What it has |
|---|---|
| `brave_client.fetch_news_for_theme` | returns `{headline, date, url}` |
| `reddit_client.fetch_posts_for_theme` | returns `post.url` |
| `daily_refresh.build_theme_signals` | rebuilds each item as `{source, text, date}` — **url dropped here** |
| `daily_refresh.persist_theme_news` | writes `theme_id, run_date, source, headline, published_date` |
| `theme_news` (migration 018) | has no `url` column to write to |

So the fetchers were paying for the URL on every run and the row it belonged in
did not exist.

The same trace turned up a second, quieter version of the same defect.
`theme_news.sentiment REAL` has been declared since migration 018 and **has never
been written**. `build_theme_signals` computes a per-item score for every headline
(`batch_sentiment(all_texts)`), immediately averages it into `avg_sentiment`, and
throws the per-item values away. A column that exists, is documented, and is
always null is a worse artefact than one that was never added — it reads to the
next person as "we have this and it came back empty."

An external review of a competitor's product supplied the argument for fixing
this now rather than eventually. That product renders inline citation markers as
unlinked 32-hex hashes; two of the ones sampled resolved to the wrong article,
above a fabricated detail — "3 US soldiers killed in Kuwait" where the cited
source says Jordan. Nothing in their UI could have caught it, because nothing in
their UI could be followed. Our exposure is smaller but the same kind: the L5
agent reasons over these headlines, and no reader can currently audit that step.

## Decision

**Persist the link, and render it.** Migration 042 adds `theme_news.url TEXT`,
`build_theme_signals` carries `url` through the item mapping, and
`persist_theme_news` writes it. The drawer renders each headline as an anchor
when a URL is present.

**Start writing `sentiment` in the same change.** The per-item scores already
exist at the point the rows are built; they are positionally aligned with the
headline list and are written alongside it. No new computation, no new call.

**Three constraints on how absence is handled**, all of which follow from
goals 1 and 2 rather than from taste:

1. **`url` is nullable and there is no backfill.** Every row written before
   migration 042 keeps `url IS NULL` forever. The fetch responses were never
   stored, so the URLs are genuinely gone. Reconstructing one — a search query,
   a publisher guess from the headline — would *manufacture* provenance, which
   is the failure this column exists to fix, committed in the fix itself.

2. **A null url renders as today's plain text with a stated cause**, never as a
   dead anchor and never by hiding the row. This is [ADR-0058](0058-explanations-are-owed-per-empty-slot.md)
   applied per headline: "no link" and "link to nowhere" are different claims,
   and the second is a lie.

3. **Mock rows persist NULL, not a placeholder.** `mock_brave` fixtures carry
   `https://example.com` and the `mock_reddit` fixtures have no url key at all.
   The placeholder is filtered rather than stored, so a fallback run cannot
   dress itself up as sourced. This extends the existing `ANDROMEDA_ALLOW_MOCK`
   discipline in `persist_theme_news`.

## Consequences

**A reader can now audit the L1 input to a HypeScore**, which was previously the
one layer of the L0–L5 chain with no reachable source. `/method` explains how the
score is computed; the drawer now shows what it was computed *from*, followed to
the publisher.

**Rows split into two visible eras**, and the split is permanent. Runs before
2026-07-26 show plain headlines with a cause; runs after show links. This is
ugly and it is correct — the alternative is a uniform surface that implies a
completeness we do not have. It also self-heals: `theme_news` accumulates, so
the unlinked era scrolls out of the default window over time.

**`sentiment` becomes a real column**, which means the next person to read the
schema learns something true from it. It is written but not yet *rendered* —
surfacing a per-headline score is a separate question about whether a reader
should weigh individual items, and that decision is not taken here.

**The L5 contract is untouched.** `q1_agent._load_recent_headlines` reads
headline text and is indifferent to both new fields. The citation guardrail of
[ADR-0012](0012-citation-guardrail-llm-defense.md) is unaffected: these links are
evidence *for the reader*, not new material the model may cite, and nothing about
this change lets an LLM ground a number in a URL.

**We take on link rot.** A persisted URL is a claim about a resource we do not
control, and some fraction will 404 within a year. Accepted deliberately: a link
that has decayed is still checkable — a reader learns the article moved — whereas
plain text was never checkable at all. We do not validate links at write time,
because a fetch-per-headline on every run buys accuracy about the moment of
writing and not about the moment of reading.
