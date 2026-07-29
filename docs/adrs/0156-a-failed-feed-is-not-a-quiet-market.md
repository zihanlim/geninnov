# ADR-0156: A failed feed is not a quiet market

**Status:** Accepted
**Date:** 2026-07-29

## Context

On 2026-07-29 the Brave Search quota was exhausted mid-run — HTTP 402, `current_spend
4.99 / usage_limit 4.99`. The pipeline completed, reported success, and published a
book.

What it published:

| Date | Articles | Themes | `mention_count_1d` |
|---|---|---|---|
| 2026-07-27 | 388 | 9 | 15, 12, 11, 7, 6, 4, 3, 3, 1 |
| 2026-07-28 | 375 | 9 | 28, 15, 9, 8, 6, 6, 2, 2, 1 |
| **2026-07-29** | **223** | **6** | **2, 1, 0, 0, 0, 0, 0, 0, 0** |

Three themes — **US Dollar, Geopolitical Risk, AI Capex** — collected zero
documents. All three were published with `hype_score = 28.5714`. Identical, because
the number contained no information about any of them:

```
volume    = 0.0    the one real signal, correctly zero
sentiment = 0.5    rescale_vader(0.0) — the neutral default over an empty corpus
momentum  = 0.5    the neutral default
corr      = None   dropped, remaining weights renormalised over 0.70

100 × (0.20×0.5 + 0.20×0.5) / 0.70  =  28.571428…
```

Two things make this worse than a stale number.

**The renormalisation amplified it.** [ADR-0036](0036-carry-as-excess-yield-over-funding.md)
("...and a missing component is not a zero") introduced weight renormalisation so
that an unmeasurable correlation would not be
scored as zero and silently deduct 30 points. Applied to a theme with *nothing*
measured, that same guard divides two placeholder values by 0.70 and scales them
**up**. A guard against one silent zero manufactured a different silent number.

**The information to prevent it already existed.** `scripts/call_brave_mcp.js` handled
the 402 correctly — `process.exit(1)` with `Brave API returned status 402: {"error":
{"detail":"Usage limit exceeded"}}` on stderr. `backend/data/brave_client.py` then
discarded both the return code and the message:

```python
        if result.returncode == 0:
            ...
            return kept
    except Exception:
        pass

    if not _mock_allowed():
        return []          # <- a dead provider and a quiet news day, merged
```

The docstring described this as production policy: *"a failed feed returns [] rather
than fabricating."* The intent was right and the implementation inverted it. Returning
`[]` **is** a fabrication by the time it reaches the scorer — it asserts "there was no
news about this theme", which is a claim about the market, not about the feed.

The failure was masked for roughly a week because HypeScore reads a 7-day mention
average, which carried prior data while `mention_count_1d` sat at 0.

## Decision

**A provider that did not answer must not be reported as a provider that answered
with nothing.**

**1. The client raises.** `brave_client.ProviderUnavailable` is raised on non-zero
exit, carrying the bridge's stderr line. `returncode == 0` with an empty list still
returns `[]` — that is a real measurement of a quiet theme and must stay one. The
mock fallback is unchanged for local dev/tests (`ANDROMEDA_ALLOW_MOCK`).

**2. The pipeline catches it per theme, not per run.** A quota that dies mid-run
leaves the earlier themes fully measurable, and discarding their work to punish an
unrelated failure is the opposite error. `build_theme_signals` records `feed_error`
on the affected theme and continues.

**3. A theme with `feed_error` is not scored.** `compute_hype_scores` returns
`hype_score = None`. `compute_trade_scores` returns `trade_score = None` rather than
deriving one from a score that does not exist. `persist` writes **all four
sub-scores as NULL** alongside it — persisting `sentiment_score = 0.5` and
`momentum_score = 0.5` next to a null score would publish the same two placeholders
in four columns instead of one, and `/method` would render them as measured
sub-scores of a score that is not there.

NULL, not 0.0. This is [ADR-0066](0066-not-computable-must-persist-as-null.md)'s
standing rule: 0.0 is a score — it ranks, it charts, and it reads as "nothing going
on".

## Consequences

**The frontend already handles this.** `unscored-theme-is-not-zero.test.tsx` pins
`ThemeHeatmap` and `ConvictionCard` rendering a null HypeScore as an em dash, written
when AI Capex was created between two runs. That guard now protects a case that
occurs from provider failure rather than only from theme creation.

**A dead provider is now visible in the run log** — `NEWS FEED UNAVAILABLE`, per
theme, with the upstream reason — instead of appearing as a quiet market.

**`theme_discovery.py` degrades differently and deliberately.** It pools one corpus
across themes and already gates on `MIN_DOCS_PER_THEME`, so it names the themes that
contributed nothing and lets the gate decide, rather than aborting.

**Fewer themes will carry scores on a bad day, and the board will show gaps.** That
is the intended trade. A gap is legible; 28.5714 is not.

**This does not fix the root cause, only its silence.** The corpus is still assembled
from query-shaped fetches whose volume and composition we do not control — the same
root cause as [ADR-0155](0155-a-share-is-only-comparable-to-a-share-of-the-same-corpus.md),
reaching the anchor themes instead of the discovery layer. The durable fix is a
second, independent provider so that one failure is survivable rather than merely
audible; measured options are in PROGRESS for 2026-07-29.

**The 1337-test suite passed throughout.** Every unit was correct; the defect was in
what two correct units meant when composed. `test_unscoreable_theme.py` therefore
tests the *wiring* — that `build_theme_signals` actually sets `feed_error` — not only
the guard given an input the pipeline might never produce.

## Alternatives considered

**Abort the run on any provider failure.** Rejected: it converts a partial outage into
a total one. Six themes were fully measurable on 2026-07-29 and their scores are good.

**Carry yesterday's HypeScore forward.** Rejected — it publishes a stale number under
today's `run_date`, which is a quieter version of the same lie and defeats
[ADR-0093](0093-a-published-book-that-changes-must-say-so.md)'s premise that a
published figure is dated.

**Score on `volume` alone and drop the unmeasurable components.** This is what the
renormalisation already does, and it is how 28.5714 was produced. Renormalising over
*zero* measured components is not a smaller version of the same operation; it is a
different one.

**Fix it in `call_brave_mcp.js`.** The bridge was already correct. Fixing a correct
component is how the real defect stays.
