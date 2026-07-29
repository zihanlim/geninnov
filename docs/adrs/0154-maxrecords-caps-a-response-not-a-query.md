# ADR-0154: `maxrecords` caps a response, not a query

**Status:** Accepted
**Date:** 2026-07-29

## Context

[ADR-0153](0153-two-corpora-two-series.md) got the discovery layer's velocity
computable for the first time, and ended by conceding it still produced nothing: at
~11 documents a day the archive surfaces `prices`, `us`, `global`, `nifty` — register,
not narrative — because `narrative_tracker.MIN_DOC_COUNT = 3` is a **share** of the
day's corpus. At 11 documents, a phrase must appear in **27%** of them to register at
all.

The obvious reading was that GDELT is simply sparse for these terms, and that the
remedy was a different provider. That was wrong, and one measurement shows why.

### The measurement

`gdelt_client` sent **one request per query covering the whole 45-day lookback**, with
`maxrecords` at GDELT's ceiling of 250. Same seed query, two window sizes:

| Request | Articles | Docs/day |
|---|---|---|
| 1 × **45 days** | 232 | **~5.5** — capped |
| 1 × **7 days** | 250 | **34** — capped |

`maxrecords` bounds the **response**, not the query. Asking for 45 days at once
returns 250 articles *for the whole window* and the remainder are never returned —
they are not missing from GDELT, they are discarded by the cap before they reach us.

Both figures are AT the cap, so 7 days is not the floor either; narrower windows
would return more again.

This also explains the earlier confusion in ADR-0153's rejected alternatives: one
query returned 232, four returned 462, ten returned the same 462. That looked like
query redundancy, and partly is — but the dominant effect was that every query was
being truncated identically by the same per-response cap.

## Decision

**Split each query's lookback into `WINDOW_DAYS = 7` sub-windows and issue one request
per window.**

Same query, same API, same cap — roughly **six times the density**. At 34 documents a
day, `MIN_DOC_COUNT = 3` is a 9% share rather than 27%, which is the difference
between a corpus where only newswire register clears the floor and one where a phrase
can.

**Windows run oldest-first.** A fetch truncated by the time budget then loses its
RECENT end, which the live Brave corpus already covers densely at 87–94 docs/day. Losing
the old end instead would tear a hole in the only history the archive exists to
provide.

**7 days, not narrower.** Each halving doubles the request count against a 5s
server-side rate limit, and the corpus has to be worth the wall clock. This is a
calibration, not a law.

### The budget, raised for the right reason this time

`DEFAULT_TIME_BUDGET_S` goes 200 → 600.

It was raised to 420s earlier the same day on the theory that ten queries at ~30s each
were overrunning 200s. **That was wrong and I reverted it**: the measurement showed 1
query → 232 articles, 4 → 462, 10 → the same 462, so the budget was never the binding
constraint and raising it bought nothing.

Windowing changes the arithmetic for real. Each query is now ~7 requests instead of 1,
so ten queries is ~70 requests at 6.5s pacing — roughly 8 minutes against a ceiling
that permitted three. The request count genuinely multiplied, and the ceiling
genuinely binds.

The distinction matters more than the number: the first raise was inferred, the second
was measured.

## Consequences

**Two bugs, both introduced by the loop, both caught by tests that predate it.**

1. **A query admitted by the outer budget check could fetch nothing** — the inner
   check ran before its first window, so a query could be counted as "run" while
   contributing zero documents. The budget is now checked *between* windows only.
2. **A permanently-rejected query was retried once per window** — seven doomed
   requests, ~45s, to learn what the first already said.
   `_PERMANENT_QUERY_ERRORS`' no-pointless-retry rule had been quietly reintroduced
   one level up. A first-window failure now abandons the query.

That the existing suite failed on both is the argument for those tests having been
written at all: they encode properties, and the properties survived a change that
restructured the function around them.

**The fix does not apply retroactively.** The nightly job only fetches forward, so
documents already stored were collected under the old single-request regime and stay
thin. `scripts/deepen_archive.py` re-fetches the window once, separately from the
pipeline — running the whole job instead would re-invoke L5 and spend MiniMax quota on
a book nobody asked for.

**Wall clock is the cost, and it is paid on the only source of history there is.**
Brave holds nothing older than 8 days, so a document GDELT does not return today is
missing from the series permanently rather than until tomorrow.

**This does not fix corpus DIVERSITY.** Ten queries of broad market language return
overlapping articles however finely they are windowed. Density and diversity are
different axes, and only the first is addressed here. Widening the seed set edges back
toward naming themes in advance — legitimate only while the queries are not the anchor
themes' keywords, which is the line [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md)
drew.

## Alternatives considered

**A different provider.** Where this was heading before the measurement. Rejected as
premature: the archive was not sparse, it was truncated, and replacing a provider to
fix a client-side cap would have been an expensive way to learn that.

**Raise `maxrecords`.** Not available — 250 is GDELT's ceiling and asking for more is
silently truncated, which is what the module docstring already recorded.

**Paginate within a window** (offset/scroll). GDELT DOC 2.0 offers no offset parameter;
date-windowing is the pagination mechanism it does offer.

**Narrower windows, e.g. daily.** Would return more still — both figures above are at
the cap. Rejected for now on request count: 45 daily windows × 10 queries is 450
requests at 6.5s, over 45 minutes, on a nightly job that runs ten. Worth revisiting if
the corpus is still too thin at 7 days, and the constant is one line.
