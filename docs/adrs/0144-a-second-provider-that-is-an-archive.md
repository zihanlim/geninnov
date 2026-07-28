# ADR-0144: A second provider that is an archive

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0023](0023-data-provenance-and-fabrication-guard.md), [ADR-0066](0066-absent-is-not-zero.md), [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0141](0141-the-corpus-and-its-denominator-were-both-ours.md), [ADR-0143](0143-the-price-link-gate-and-what-it-refuses-to-say.md)

## Context

Two open findings turned out to have one cause and one fix.

**[ADR-0094](0094-no-corroboration-gate-over-a-single-source.md) — the attention signal rests on one provider.** `select source, count(*) from theme_news` returns `brave` and nothing else. A corroboration gate over one source either always passes (N=1) or can never pass (N≥2), so that ADR refused the gate and disclosed the count instead, naming GDELT as the cheapest second candidate.

**[ADR-0143](0143-the-price-link-gate-and-what-it-refuses-to-say.md) — the price-link gate has no history.** It needs ~20 trading sessions and had 5, so every verdict is `insufficient_history`.

Asked whether the history could be backfilled from Brave. Measured, on identical 45-day windows:

| | Brave | GDELT |
|---|---|---|
| documents returned | 374 | 250 (one query) |
| distinct days | 39 | 40 |
| **published in the last 7 days** | **48%** | **18%** |
| oldest days, docs each | 1, 1, 1, 5, 1, 3 | 3, 7, 8, 9, 7, 7 |

Brave is a **recency ranking**: 16% of the window supplies half the documents, and older days hold one or two. A share-of-voice series built from it would be mostly zeros punctuated by spurious 100%s — and, far worse, **39 dates would clear ADR-0143's 20-session floor**, flipping `insufficient_history` into a confident false `linked`. The backfill would defeat the guard by satisfying it. That is the same reasoning `backfill_regime.py` already gives for refusing to reconstruct HypeScore, now with numbers.

GDELT is an **archive**. Same window, a third of the recency skew, old days genuinely populated.

## Decision

**Add GDELT DOC 2.0 as a second provider for the un-themed corpus.**

`backend/data/gdelt_client.py`. Free, keyless — the same properties that made `cot_fetcher` acceptable. It answers both findings at once: a second `source` value makes ADR-0094's corroboration gate meaningful, and a flat 45-day distribution gives the price-link gate ~31 trading sessions instead of 5.

Four operational constraints are encoded because each was learned by tripping it:

- **One request per 5 seconds, server-enforced.** The pacing lives in the client, not in callers — a rate limit honoured only when the caller remembers is not a rate limit. Set to 6.5s, because tripping it costs roughly a minute of cooldown and the margin is cheap.
- **Throttling arrives as a plain-text body, sometimes under HTTP 200.** So status alone cannot distinguish success from throttling, and a naive `.json()` raises instead of retrying. The client tests the body, not the code.
- **`sourcelang:english` is mandatory and is appended here.** Without it the corpus fills with French and German coverage — *"L'intégrale de BFM Bourse"* — which the tokenizer would treat as narrative vocabulary.
- **The response must be decoded as UTF-8 explicitly.** Letting `requests` infer the charset produced mojibake in live titles.

**A wall-clock budget bounds the whole fetch.** The retry ladder is 15 + 30 + 60s over 6.5s pacing, so one throttled query can burn ~131s and ten ~22 minutes, against a daily pipeline that takes about ten in total. At expiry the fetch returns what it has and **reports how many queries it skipped** — GOAL.md's no-silent-caps rule, because a short corpus that says so is recoverable and one that looks complete is not.

**GDELT supplements Brave rather than replacing it.** Brave supplies density on recent days (39 docs/day against GDELT's 6); GDELT supplies history. A GDELT failure is caught and logged as *"the corpus loses its history, not its present."*

## Consequences

- **The corpus gains a second `source` value**, which is the precondition ADR-0094 said would make its corroboration gate available "with no schema change the moment a second provider exists". Building that gate is not done here.
- **`insufficient_history` should clear on the next run.** 45 days is ~31 trading sessions against a 20-session floor. That is the expectation, not a result: the price-link gate has not yet been run against a GDELT-backed corpus.
- **The first live run through the client failed, and the failure was worth more than the success.** It returned **zero headlines from three queries**, and the log said *"throttled or non-JSON (HTTP 200): Queries containing OR'd terms must be surrounded by ()."* Two defects behind one message:

  1. **GDELT requires OR'd terms in parentheses; Brave does not.** `MARKET_SEED_QUERIES` is written in Brave's dialect, so every multi-term query was rejected. `gdelt_query()` now translates, idempotently.
  2. **The client treated a permanent query error as throttling.** Any non-JSON body was retried, so a query that could *never* succeed consumed the full 15+30+60s ladder and was reported as rate limiting — the real cause never reached the log. Permanent errors now return immediately and say what they were.

  **Neither was reachable by the unit tests**, which stub the response body and therefore cannot discover what the server actually says. The suite was green throughout. After the fix, a live run returns **231 headlines across 40 distinct days** (2026-06-14 → 07-27), in English, having recovered from one genuine 429 through the retry path.
- **No new dependency.** `requests` is already on the critical path for `macro_fetcher`.
- **GDELT indexes coverage, not markets.** Its corpus is global news, so a market-seed query returns market coverage from outlets Brave may never surface — which is the point of a second source — but it is not curated for finance and will carry more off-topic material. The share-of-voice denominator absorbs that; a narrative shortlist may need to notice it.
- **Two providers is not many.** The count is disclosed, not gated, and ADR-0094's underlying caution stands: this is still a very thin basis for claiming corroboration, and the second source is one nobody would call authoritative on markets.
