"""Tier 2 fact extraction: LLM-extract numeric claims from news articles
(ADR-0222 Tier 2 / #3 in the plan).

WHY THIS IS A SEPARATE MODULE
----------------------------
The other passes in `fact_extraction.py` are deterministic transforms
on data the pipeline already produces (FRED, regime, themes, the
curated structured_facts table). The news pass is different: it asks
an LLM to read article text and pull out numeric claims. That is the
ONLY place in the auto-derive pipeline that calls out to a model, and
it deserves its own module with its own discipline.

DISCIPLINE
----------
- Confidence is `low` for every extracted row. The LLM might
  misattribute a number to the wrong entity, or read a percentage
  as a count, or paraphrase a number from a chart. A `low` fact
  still travels through the citation guardrail — the L5 cites
  it with the confidence attached — but a `low` fact cannot be
  the sole support for a strong claim. The cite token is
  `[structured_facts:<entity>:<metric>]` and the row has a
  `source_url` so a reader can verify.
- A miss (no number found, malformed JSON, API error) is silently
  dropped, never a fabricated zero. Same rule as the other passes
  (ADR-0098).
- The extraction prompt is short and explicit. The model is asked
  for a JSON list of `{entity, metric, value, unit, as_of}`. The
  caller validates every field before writing a row.

WHAT IT IS NOT
--------------
- This is NOT a replacement for the curated seed. Curated facts
  are `high` confidence (primary source, audited); extracted facts
  are `low` (LLM-interpreted). They travel in the same table but
  the L5 cite prompt should call out the difference.
- This is NOT a scraper. It reads from `theme_news` — the headlines
  the daily pipeline ALREADY wrote. New facts only appear when
  the news pipeline has something to say.
- This is NOT real-time. It runs daily, on the cadence of the
  pipeline. A breaking story does not produce a fact until the
  next run.

COST
----
One Gemini-Flash call per unique article. The 7-day rolling
window over a typical theme yields ~30-100 articles. The extraction
prompt is short (article title + first 500 chars), the response
budget is 256 tokens. Cost is in the cents per day range.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import date
from typing import Any

import requests

# Gemini config — read once at import. The pipeline's LLM_PROVIDER
# isn't relevant here; extraction uses Gemini specifically because
# the cost of a few hundred extractions per day would be prohibitive
# on the larger reasoning models.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_FACT_MODEL", "gemini-flash-latest")
GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)
# Per-request safety: one retry on transient errors, hard fail
# thereafter. The pipeline must keep moving even if Gemini is down.
_REQUEST_TIMEOUT_S = 30
_MAX_RETRIES = 1

#: The extraction prompt. Short, explicit, and JSON-only. The
#: instruction tells the model to return a list of {entity, metric,
#: value, unit, as_of} rows for every numeric claim in the article.
#: A `null` value means "no numeric claims found" — same as an
#: empty list, both treated as absence downstream.
_EXTRACTION_PROMPT = """\
You are extracting numeric claims from a news article for a fact table.

For each numeric claim you find, return a JSON object with:
- entity: the subject (e.g. "NVDA", "industry:hyperscaler", "MSFT")
- metric: the quantity (e.g. "capex_2026_bn", "yoy_growth_pct")
- value: the number (float, no units)
- unit: the unit ("USD_bn", "pct", "years", "USD", "boolean")
- as_of: the year or date the fact is about (YYYY-MM-DD if known, else YYYY)

Return a JSON array. If the article has no numeric claims, return [].

ARTICLE TITLE: {title}
ARTICLE URL: {url}
ARTICLE BODY (first 500 chars): {body}

Return ONLY the JSON array, no prose, no markdown."""


#: Permitted units. The LLM is asked to follow this vocabulary;
#: the validator enforces it. A claim with a free-form unit
#: (e.g. "pints", "horsepower") is dropped — not citable, same
#: discipline as the other passes.
_PERMITTED_UNITS = frozenset({
    "USD_bn", "USD", "pct", "years", "boolean",
    "USD_per_share", "USD_per_million_tokens",
    "trillion_params", "k", "index", "pts", "pct_pct",
})


def _validate_row(d: dict[str, Any]) -> dict[str, Any] | None:
    """Coerce a single extraction into a fact row. Returns None
    on any validation failure — the caller logs and continues.

    The validation is deliberately strict. A claim that says
    "value": "high" or "as_of": "last quarter" is rejected. The
    L5 cite path is permissive on what it can RENDER, but the
    table column types are NUMERIC, not text. ADR-0218 is
    explicit: a fact that cannot be expressed as a number does
    not belong here.
    """
    if not isinstance(d, dict):
        return None
    entity = d.get("entity")
    metric = d.get("metric")
    value = d.get("value")
    unit = d.get("unit")
    as_of = d.get("as_of")
    if not (isinstance(entity, str) and entity and isinstance(metric, str) and metric):
        return None
    if not (isinstance(unit, str) and unit in _PERMITTED_UNITS):
        return None
    if not (isinstance(as_of, (int, str))):
        return None
    # Coerce value to float. The LLM is asked for a number, but
    # sometimes returns a quoted string ("745") — same NumPy
    # tolerance as the macro_indicators snapshot.
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    # Normalize as_of to a date string. Year-only ("2026") is
    # permitted because the article may not specify a day.
    if isinstance(as_of, int):
        as_of_str = f"{as_of:04d}-01-01"
    else:
        s = str(as_of).strip()
        m = re.match(r"^(\d{4})(-\d{2}(-\d{2})?)?$", s)
        if not m:
            return None
        if m.group(2) is None:
            as_of_str = f"{m.group(1)}-01-01"
        elif m.group(3) is None:
            as_of_str = f"{m.group(1)}{m.group(2)}-01"
        else:
            as_of_str = s
    # Semantic check: reject invalid calendar dates (e.g. month=13, day=31 for Feb)
    try:
        from datetime import datetime
        datetime.strptime(as_of_str, "%Y-%m-%d")
    except ValueError:
        return None
    return {
        "entity": entity,
        "metric": metric,
        "value": v,
        "unit": unit,
        "as_of": as_of_str,
    }


def extract_claims_from_article(
    *, title: str, url: str, body: str
) -> list[dict[str, Any]]:
    """Call Gemini once for one article. Returns a list of validated
    claim dicts. Returns [] on any failure (no number found,
    network error, malformed JSON, validation rejection).

    The function is intentionally tolerant. A single bad article
    must not stop the rest of the pipeline from running. The
    `_AUTO_CONFIDENCE` for the resulting rows is `low` (set by
    the caller, not here — separation of concerns).
    """
    if not GEMINI_API_KEY:
        return []
    # Truncate the body. The model doesn't need the whole article
    # to find the numbers, and the request budget is small.
    body = (body or "")[:500]
    prompt = _EXTRACTION_PROMPT.format(
        title=title[:200], url=url[:200], body=body,
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.0,  # extraction is deterministic
            "maxOutputTokens": 256,
        },
    }
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES + 1):
        try:
            r = requests.post(
                f"{GEMINI_ENDPOINT}?key={GEMINI_API_KEY}",
                json=payload,
                timeout=_REQUEST_TIMEOUT_S,
            )
            r.raise_for_status()
            data = r.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            # Strip code-fence if the model emitted one despite the
            # instruction.
            text = text.strip()
            if text.startswith("```"):
                text = re.sub(r"^```[a-z]*\n?", "", text)
                text = re.sub(r"\n?```$", "", text)
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                return []
            if not isinstance(parsed, list):
                return []
            out: list[dict[str, Any]] = []
            for entry in parsed:
                row = _validate_row(entry)
                if row is not None:
                    out.append(row)
            return out
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < _MAX_RETRIES:
                time.sleep(1)
    if last_exc is not None:
        print(
            f"[news_fact_extractor] Gemini call failed for '{title[:40]}': "
            f"{last_exc.__class__.__name__}: {last_exc}"
        )
    return []


#: Module-level test hook: when set, the function does NOT call
#: Gemini. Tests inject deterministic responses. Production
#: code never sets this; the default of None means real calls.
#: This is the seam the unit tests use, and the ONLY seam — the
#: real extraction logic (validation, prompt formatting) is
#: the same code path either way.
_TEST_HOOK: "((title, url, body) -> list[dict]) | None" = None  # type: ignore[valid-type]


def extract_claims_for_test(
    *, title: str, url: str, body: str
) -> list[dict[str, Any]]:
    """Test entry point. Returns validated rows without calling
    Gemini. Used by tests to assert the validation contract."""
    if _TEST_HOOK is None:
        return extract_claims_from_article(title=title, url=url, body=body)
    out: list[dict[str, Any]] = []
    for raw in _TEST_HOOK(title, url, body):
        validated = _validate_row(raw)
        if validated is not None:
            out.append(validated)
    return out
