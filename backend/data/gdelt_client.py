"""
GDELT DOC 2.0 — the second news provider, and the only one with real history.

WHY (ADR-0144)
==============
Two open findings converge on one source.

**[ADR-0094](../../docs/adrs/0094-no-corroboration-gate-over-a-single-source.md):
the attention signal rests on one provider.** `select source, count(*) from
theme_news` returns `brave` and nothing else. A corroboration gate over a single
source either always passes or can never pass, so it was refused and the count
disclosed instead. GDELT is the second source that makes the gate meaningful, and
ADR-0094 already named it as the cheapest candidate — open, where ACLED needs a
commercial licence.

**[ADR-0143](../../docs/adrs/0143-the-price-link-gate-and-what-it-refuses-to-say.md):
the price-link gate has no history.** It needs ~20 trading sessions and had 5.
Brave cannot supply them: a 45-day Brave window returns **48% of its documents
from the last 7 days**, with older days holding 1–5 documents each. Backfilling
from it would fabricate an attention series — and worse, would clear the
20-session floor with that fabrication, turning `insufficient_history` into a
confident false `linked`.

Measured on the same 45-day window, GDELT returns **18% from the last 7 days**
across 40 of 45 days, with older days holding 3–9. It is an archive, not a
recency ranking, which is exactly the property a historical mention series needs.

OPERATIONAL CONSTRAINTS, LEARNED THE HARD WAY
=============================================
* **One request per 5 seconds, enforced server-side.** Exceeding it returns HTTP
  429 with a plain-text body, and the cooldown after tripping it is longer than
  5s — a burst of four probes 6s apart stayed throttled and needed ~60s to clear.
  The pacing therefore lives in this module, not in callers: a rate limit honoured
  only when the caller remembers is a rate limit that will be broken.
* **`maxrecords` caps at 250.**
* **`sourcelang:english` is required.** Without it the corpus fills with French
  and German market coverage — "L'intégrale de BFM Bourse" — which the tokenizer
  would treat as narrative vocabulary.
* **The response is UTF-8 and must be decoded as such.** Letting requests infer
  the charset produced mojibake in titles ("Lintégrale" → "Lint?grale").
"""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta

import requests

GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"

#: Server-side floor is one request per 5 seconds. 6.5 is deliberately above it:
#: tripping the limit costs ~60s of cooldown, so the cheap margin pays for itself
#: the first time a clock skews.
MIN_SECONDS_BETWEEN_CALLS = 6.5

#: GDELT's own cap. Asking for more is silently truncated.
MAX_RECORDS = 250

#: Backoff after a 429, in seconds. The observed cooldown exceeded 5s by a lot.
_RETRY_WAITS = (15.0, 30.0, 60.0)

_last_call_at: float = 0.0


def _throttle() -> None:
    """Block until `MIN_SECONDS_BETWEEN_CALLS` has passed since the last request.

    Module-level state on purpose. Every caller in this process shares one
    budget, because the limit is per-IP and a per-caller limiter would be no
    limiter at all.
    """
    global _last_call_at
    elapsed = time.monotonic() - _last_call_at
    if _last_call_at and elapsed < MIN_SECONDS_BETWEEN_CALLS:
        time.sleep(MIN_SECONDS_BETWEEN_CALLS - elapsed)
    _last_call_at = time.monotonic()


#: Body fragments that mean the QUERY is wrong, not that we are being throttled.
#:
#: Retrying these is pure waste: the full ladder is 105s spent on a request that
#: can never succeed, and — worse — it is reported as throttling, so the actual
#: cause never reaches the log. The live first run burned exactly that way on
#: *"Queries containing OR'd terms must be surrounded by ()"*, a defect the unit
#: tests could not see because they stub the response body.
_PERMANENT_QUERY_ERRORS = (
    "must be surrounded by",
    "query is too short",
    "query is too long",
    "unrecognized",
    "invalid",
)


def gdelt_query(query: str) -> str:
    """Translate a seed query into GDELT's dialect.

    **GDELT requires OR'd terms to be wrapped in parentheses**; Brave does not,
    and the shared `MARKET_SEED_QUERIES` are written in Brave's dialect. Sending
    them unwrapped returns HTTP 200 with the plain-text body *"Queries containing
    OR'd terms must be surrounded by ()"* — a success status carrying a failure,
    which is the same trap as the throttling body.

    Idempotent: a query already wrapped is left alone, so this cannot double-wrap
    if the seed list ever adopts GDELT's form.
    """
    q = query.strip()
    if " OR " not in q.upper():
        return q
    if q.startswith("(") and q.endswith(")"):
        return q
    return f"({q})"


def _get(params: dict) -> dict | None:
    """One paced request, retried through 429s. None on give-up.

    A **permanent** query error returns immediately rather than retrying — see
    `_PERMANENT_QUERY_ERRORS` for why that distinction is worth the code.
    """
    for attempt, wait in enumerate((0.0,) + _RETRY_WAITS):
        if wait:
            time.sleep(wait)
        _throttle()
        try:
            resp = requests.get(
                GDELT_DOC_API, params=params, timeout=90,
                headers={"User-Agent": "andromeda-research/1.0"},
            )
        except Exception as exc:
            print(f"[gdelt] request failed ({exc.__class__.__name__}); "
                  f"attempt {attempt + 1}")
            continue

        # GDELT signals rate limiting with a 200 or 429 carrying a PLAIN-TEXT
        # body, not JSON — so status alone is not enough to tell success from
        # throttling, and a naive `resp.json()` raises instead of retrying.
        body = resp.content.decode("utf-8", errors="replace").strip()
        if not body.startswith("{"):
            low = body.lower()
            if any(frag in low for frag in _PERMANENT_QUERY_ERRORS):
                # Not throttling. Retrying cannot help and would spend 105s
                # reporting the wrong cause.
                print(f"[gdelt] REJECTED QUERY (HTTP {resp.status_code}): "
                      f"{body[:90]} | query={params.get('query','')[:70]}")
                return None
            if attempt < len(_RETRY_WAITS):
                print(f"[gdelt] throttled (HTTP {resp.status_code}): {body[:60]}")
            continue
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            continue
    return None


def _seendate_to_iso(seendate: str) -> str | None:
    """`20260728T120000Z` -> `2026-07-28`. None when unparseable.

    None rather than today's date: a document whose date cannot be read must not
    be stamped as current, which would put it in the wrong bucket of a mention
    series and quietly bias the most recent day upward (ADR-0066).
    """
    raw = (seendate or "")[:8]
    if len(raw) != 8 or not raw.isdigit():
        return None
    try:
        return date(int(raw[:4]), int(raw[4:6]), int(raw[6:8])).isoformat()
    except ValueError:
        return None


#: Wall-clock ceiling for a whole fetch, in seconds.
#:
#: The retry ladder is 15 + 30 + 60s on top of 6.5s pacing, so a single throttled
#: query can burn ~131s and ten of them ~22 minutes — against a daily pipeline
#: that takes about ten minutes in total. A news corpus is worth waiting for; it
#: is not worth doubling the run for, and an unbounded retry loop turns a degraded
#: provider into a stalled pipeline.
#:
#: On expiry the fetch returns what it has and SAYS how many queries it skipped
#: (GOAL.md's no-silent-caps rule) — a short corpus that reports its shortfall is
#: recoverable; one that looks complete is not.
DEFAULT_TIME_BUDGET_S = 200.0


def fetch_market_news_gdelt(
    queries: list[str],
    lookback_days: int = 45,
    max_records: int = MAX_RECORDS,
    time_budget_s: float = DEFAULT_TIME_BUDGET_S,
) -> list[dict]:
    """Un-themed market news from GDELT, in the shape `market_news` stores.

    Returns `{headline, date, url, source: "gdelt", query}` per article,
    deduplicated by headline across queries. `sourcelang:english` is appended to
    every query here rather than being the caller's job — a caller that forgets it
    silently poisons the corpus with other-language coverage.

    Returns `[]` on total failure — never mock data, for the reason
    `fetch_market_news` gives: a frequency tracker reading template headlines
    would report the template's own vocabulary as an emerging narrative.

    At ~6.5s per query this takes about a minute for ten queries. That is
    acceptable for a daily job and is why it is not called per request.
    """
    end = datetime.utcnow()
    start = end - timedelta(days=lookback_days)
    seen: set[str] = set()
    out: list[dict] = []
    began = time.monotonic()
    skipped = 0

    for index, query in enumerate(queries):
        if time.monotonic() - began > time_budget_s:
            skipped = len(queries) - index
            break
        payload = _get({
            "query": f"{gdelt_query(query)} sourcelang:english",
            "mode": "artlist",
            "format": "json",
            "maxrecords": str(min(max_records, MAX_RECORDS)),
            "startdatetime": start.strftime("%Y%m%d%H%M%S"),
            "enddatetime": end.strftime("%Y%m%d%H%M%S"),
        })
        if payload is None:
            print(f"[gdelt] gave up on query: {query[:60]}")
            continue

        for art in payload.get("articles") or []:
            headline = (art.get("title") or "").strip()
            if not headline:
                continue
            key = headline.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "headline": headline,
                "date": _seendate_to_iso(art.get("seendate")),
                "url": art.get("url"),
                "source": "gdelt",
                "query": query,
            })

    if skipped:
        print(f"[gdelt] time budget ({time_budget_s:.0f}s) reached — "
              f"{skipped} of {len(queries)} queries not run. The corpus is short "
              f"by those queries, not complete.")
    return out
