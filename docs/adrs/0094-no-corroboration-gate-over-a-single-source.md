# ADR-0094 — No corroboration gate over a single source; disclose the count instead

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0023](0023-data-provenance-and-fabrication-guard.md), [0022](0022-hypescore-ic-backtest.md), [0059](0059-a-single-date-ic-is-not-validation.md), [0066](0066-not-computable-must-persist-as-null.md)

## Context

The worldmonitor review recommended adopting its **corroboration requirement**: it fires an
alert only when **five independent origin types** agree — not five articles, five *kinds* of
evidence. Applied to Andromeda, the proposal was a gate on theme promotion: admit a theme to
the candidate pool only once N independent source types support it. HypeScore is a weighted
blend (attention × sentiment × correlation × momentum), so one loud source can carry a
theme, and an independence *count* is a genuinely different guard from a weighted score.

Before building it, I measured how many source types exist.

```
select source, count(*) from theme_news group by source;
  brave | 1005
```

**One.** Every one of 1,005 rows carries `source = 'brave'`. Reddit contributes nothing.

This is not breakage. `scripts/daily_refresh.py` does call `fetch_posts_for_theme` and does
tag its items `source: "reddit"`, but `REDDIT_CLIENT_ID` is not among the repo secrets — it
is not even listed in CLAUDE.md's secrets table — so `reddit_client.fetch_posts_for_theme`
returns `[]` in production rather than fabricating posts. That is
[ADR-0023](0023-data-provenance-and-fabrication-guard.md)'s fabrication guard working
exactly as designed.

The consequence is that **HypeScore's attention, volume and sentiment sub-scores all rest on
a single provider**, and until now nothing said so. Worse, three surfaces said the opposite:

| Where | Claimed |
|---|---|
| `MethodBody` layer table | "Brave News + Reddit → VADER sentiment, mention counts…" |
| `MethodBody` sources table | "Brave News + Reddit" |
| `MethodBody` provenance table | "All collected text came from live Brave/Reddit responses." |
| `themeProvenance.provenanceLabel` | "Live Brave/Reddit signal" |

Naming a provider that supplies none of the rows — on the pages whose entire job is to say
where a number came from.

## Decision

**Do not build the gate.** At one source type it is not implementable in any honest form: a
gate requiring N independent source types either always passes (N=1, a control that never
refuses anything) or can never pass (N≥2, a control that would empty the candidate pool).
Either way it asserts a property the corpus does not have, which is the same failure
[ADR-0059](0059-a-single-date-ic-is-not-validation.md) records for a single-date IC read as
validation.

**Disclose the count instead**, and derive it from the data. `sourceIndependence()` computes
the contributing providers, the independent count, the top provider's share, which
pipeline-fetched providers contributed nothing, and which contributed only fallback rows.
`independenceSentence()` renders one sentence a reader can act on, and
`/method/evidence#sources` shows it with a per-provider table.

Derived rather than stated as a constant on purpose: the day Reddit credentials are added,
the disclosure corrects itself instead of becoming a new false claim in the opposite
direction. `PIPELINE_SOURCES` is the one hardcoded part, because it is the only way to
distinguish *"this provider returned nothing today"* from *"this provider was never asked"*.

**Correct the four overstatements.** `provenanceLabel` no longer names any provider — it has
no access to the corpus and cannot know which contributed, so it returns "Live provider
signal" and leaves the naming to the function that reads the data.

## Consequences

- A reader looking at a HypeScore now learns it is single-sourced and therefore carries no
  cross-provider corroboration. That is a materially worse-sounding claim than the page made
  before, and it is the true one.
- `topSourceShare` is `null`, not `1.0`, when nothing was collected. A share of an empty
  corpus is unmeasurable, not fully concentrated
  ([ADR-0066](0066-not-computable-must-persist-as-null.md)).
- An absent provider renders as an em dash, not `0` — "fetched and contributed nothing" and
  "supplied zero of a corpus it was part of" are different claims.
- A `mock_`-prefixed source counts as **present but synthetic**: the stub ran, so the
  provider was not silent, but the score is not a market observation. Both facts survive.
- The gate becomes available the moment a second provider is wired, with no schema change —
  `independentSources` is the number it would test.
- 9 tests, including the live single-source state and the empty-corpus case.

## What would make the gate worth building

A second genuinely independent provider. The cheapest is **GDELT**, which is open (unlike
ACLED, which requires a commercial licence) and which worldmonitor itself wraps
(`SearchGdeltDocuments`, `GetGdeltTopicTimeline`). Reddit credentials would also do it, at
the cost of a provider whose text is not independent of news coverage in the way a second
news corpus is. Until then, adding a gate would be a control that asserts corroboration
nobody has measured — which is the thing this repo keeps deleting.
