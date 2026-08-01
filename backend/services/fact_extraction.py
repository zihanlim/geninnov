"""Auto-derive structured_facts from the data the pipeline ALREADY produces
(ADR-0222's Tier 1).

The 50 hand-curated rows in `data/structured_facts_seed.json` are the
`high`-confidence tier — every value is human-authored with a real source.
This module is the `medium`-confidence tier: re-shape what's already in
the database into the structured_facts shape so the L5 can cite it, the
/facts page can render it, and a reader can see "the system has data on
this, this is where it came from."

Three sources are read, each tagged by a category so /facts groups them:

  * `macro_indicators`  → category `auto_macro`  (FRED + yfinance latest)
  * `regime_classifications.computable_macro` → category `auto_computable`
  * `regime_classifications` row itself → category `auto_regime`
  * `themes` per-theme scores            → category `auto_themes`

Source naming: `auto-derived: <table>`. The L5 cites the value with
`confidence = medium` attached — a hand-curated `high` and a derived
`medium` travel separately through the citation guardrail.

Failure mode: a source row is missing is silently skipped, not a zero.
The L5 cites absence as absence, same discipline as ADR-0217 / 0218.

Idempotent: re-running on the same as_of updates in place via
`upsert_fact` (the unique key is (entity, metric, as_of)). Each run is
the same data, same key, same value — the rows just keep their creation
timestamp.
"""
from __future__ import annotations

import os
from datetime import date
from typing import Any

from supabase import Client

from backend.services.structured_facts import upsert_fact
from backend.services import news_fact_extractor  # noqa: F401 — imported for _TEST_HOOK dispatch

# A read that failed is not a zero — these are the only values the
# function will treat as "value to write". A None, NaN, or empty string
# from any source is treated as "absent" and the row is skipped.
_AUTO_CONFIDENCE = "medium"
_AUTO_SOURCE_PREFIX = "auto-derived:"


def _safe_num(v: Any) -> float | None:
    """Coerce to float, returning None on NaN/None/non-numeric. The
    loader schema requires NUMERIC, so a string '4.32' that pandas
    left in a frame must not slip through."""
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    # NaN and inf are not legal NUMERIC values in the schema; both
    # are absent values, not zero.
    if x != x or x in (float("inf"), float("-inf")):
        return None
    return x


def _upsert_many(supabase: Client, rows: list[dict[str, Any]]) -> int:
    """Upsert each row, swallow the per-row failure (one bad row must
    not stop the run — the L5 cites the rest, the bad row is a
    structured absence on the next read). Returns the count written."""
    n = 0
    for r in rows:
        try:
            upsert_fact(supabase, r)
            n += 1
        except Exception as exc:  # noqa: BLE001 — best-effort
            # Print and continue: the failure is logged at the run
            # boundary by daily_refresh.py, not here.
            print(
                f"[fact_extraction] SKIP {r.get('entity')}/{r.get('metric')}: "
                f"{exc.__class__.__name__}: {exc}"
            )
    return n


def _derive_macro_indicators(
    supabase: Client, *, as_of: date
) -> list[dict[str, Any]]:
    """Re-shape today's macro_indicators snapshot. The fetch_date
    column is the day the value was observed, which IS the as_of for
    a daily fetcher — so we use the latest fetch_date <= as_of and
    the row's as_of column tracks that date."""
    resp = (
        supabase.table("macro_indicators")
        .select("series_id, value, unit, fetch_date")
        .lte("fetch_date", as_of.isoformat())
        .order("fetch_date", desc=True)
        .limit(500)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return []
    # The fetcher upserts in place per fetch_date (delete-then-insert
    # in `upsert_latest_snapshot`), so a single fetch_date carries one
    # value per series. Pick the LATEST per series — we cite the most
    # recent observation, not every historical one.
    by_series: dict[str, dict[str, Any]] = {}
    for r in rows:
        sid = r.get("series_id")
        if sid not in by_series:
            by_series[sid] = r
    out: list[dict[str, Any]] = []
    for sid, r in by_series.items():
        v = _safe_num(r.get("value"))
        if v is None:
            continue
        fetch_date = r.get("fetch_date", "")
        if not fetch_date:
            continue
        out.append({
            "entity": f"macro:{sid}",
            "metric": "value",
            "value": v,
            "unit": r.get("unit") or "pts",
            "as_of": fetch_date,
            "source": f"{_AUTO_SOURCE_PREFIX} macro_indicators",
            "confidence": _AUTO_CONFIDENCE,
            "category": "auto_macro",
            "notes": f"Latest {sid} observation, auto-shaped from macro_indicators.",
        })
    return out


def _derive_computable_macro(
    supabase: Client, *, as_of: date
) -> list[dict[str, Any]]:
    """Re-shape the regime row's computable_macro JSONB into structured
    rows. ADR-0217 owns the JSONB; this module only mirrors the parts
    that are citable as facts (the value, not the per-metric status)."""
    resp = (
        supabase.table("regime_classifications")
        .select("run_date, computable_macro")
        .lte("run_date", as_of.isoformat())
        .order("run_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return []
    cm = rows[0].get("computable_macro") or {}
    run_date = rows[0].get("run_date", "")
    if not run_date or not isinstance(cm, dict):
        return []
    out: list[dict[str, Any]] = []

    # Each metric is its own row. The shape mirrors what the L5 already
    # cites: `regime_classifications:computable_macro:<metric>`. We use
    # entity=`regime:computable_macro:<metric>` and metric=`value` so
    # the citation guardrail can verify a `[structured_facts:...]` cite
    # the same way it does for any other fact.
    for metric, payload in cm.items():
        if not isinstance(payload, dict):
            continue
        status = payload.get("status")
        if status != "measured":
            # The `unknown` and `absent` states are deliberately NOT
            # written as facts — the L5 cites absence as absence
            # (ADR-0098), and writing a NULL here would invite a
            # citation that names the row as if it were measured.
            continue
        v = payload.get("value")
        # Boolean metrics (socgen_flip_active) come through as int 0/1;
        # both are legitimate NUMERIC values, the unit is `boolean`.
        unit = "boolean" if isinstance(v, int) and metric.endswith("active") \
            else payload.get("unit", "pct")
        if v is None:
            continue
        out.append({
            "entity": f"regime:computable_macro:{metric}",
            "metric": "value",
            "value": v,
            "unit": unit,
            "as_of": run_date,
            "source": f"{_AUTO_SOURCE_PREFIX} regime_classifications.computable_macro",
            "confidence": _AUTO_CONFIDENCE,
            "category": "auto_computable",
            "notes": payload.get("note") or f"Computable macro reading for {metric}.",
        })
    return out


def _derive_regime_row(
    supabase: Client, *, as_of: date
) -> list[dict[str, Any]]:
    """Re-shape the regime row's scalar columns into structured_facts.
    These are the cycle, sentiment, fed_posture, debasement_pressure
    columns the regime_classifier writes."""
    resp = (
        supabase.table("regime_classifications")
        .select(
            "run_date, cycle, sentiment, fed_posture, debasement_pressure, "
            "yield_curve_slope, hy_oas, vix_level, real_rate, spx_breadth"
        )
        .lte("run_date", as_of.isoformat())
        .order("run_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return []
    r = rows[0]
    run_date = r.get("run_date", "")
    if not run_date:
        return []
    # (metric, value, unit) — only the numeric columns become facts.
    # `cycle`, `sentiment`, `fed_posture` are categorical strings, not
    # numbers, and a NUMERIC column would coerce them into 0. The
    # L5 cites those from regime_classifications directly, not via
    # structured_facts — same discipline as the JSONB metrics.
    numeric_cols: list[tuple[str, str]] = [
        ("yield_curve_slope", "pct"),
        ("hy_oas", "pct"),
        ("vix_level", "pts"),
        ("real_rate", "pct"),
        ("spx_breadth", "pct"),
    ]
    out: list[dict[str, Any]] = []
    for col, unit in numeric_cols:
        v = _safe_num(r.get(col))
        if v is None:
            continue
        out.append({
            "entity": f"regime:{col}",
            "metric": "value",
            "value": v,
            "unit": unit,
            "as_of": run_date,
            "source": f"{_AUTO_SOURCE_PREFIX} regime_classifications.{col}",
            "confidence": _AUTO_CONFIDENCE,
            "category": "auto_regime",
            "notes": f"Regime classifier output for {col}.",
        })
    return out


def _derive_theme_signals(
    supabase: Client, *, as_of: date
) -> list[dict[str, Any]]:
    """One row per (theme, sub-score) from the latest themes snapshot.
    The themes table is the published run's row per theme; the L5
    already cites the score directly from `themes` for some purposes,
    but a structured_facts row gives /facts a single page where the
    reader sees "this is what the system scored today" alongside the
    curated company-level facts.
    """
    resp = (
        supabase.table("themes")
        .select(
            "id, name, hype_score, volume_score, sentiment_score, "
            "corr_score, momentum_score, updated_at"
        )
        .order("updated_at", desc=True)
        .limit(50)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return []
    # One row per (theme_id, sub_score) — the (entity, metric) pair
    # becomes the cite target. The L5 cites
    # `[structured_facts:theme:<theme_id>:hype_score]` and the guardrail
    # verifies against the row.
    score_cols: list[tuple[str, str]] = [
        ("hype_score", "score_0_100"),
        ("volume_score", "score_0_100"),
        ("sentiment_score", "score_0_100"),
        ("corr_score", "score_0_100"),
        ("momentum_score", "score_0_100"),
    ]
    out: list[dict[str, Any]] = []
    # Themes can update multiple times in a day; pick the LATEST
    # updated_at per theme_id to keep the cite stable across the day.
    by_id: dict[str, dict[str, Any]] = {}
    for r in rows:
        tid = r.get("id")
        if tid and tid not in by_id:
            by_id[tid] = r
    for tid, r in by_id.items():
        updated_at = r.get("updated_at", "")
        if not updated_at:
            continue
        # `as_of` is a DATE in structured_facts, so use the date part
        # of the timestamp — two writes on the same day upsert onto
        # the same key, keeping the row count bounded.
        as_of_str = updated_at[:10]
        for col, unit in score_cols:
            v = _safe_num(r.get(col))
            if v is None:
                continue
            out.append({
                "entity": f"theme:{tid}",
                "metric": col,
                "value": v,
                "unit": unit,
                "as_of": as_of_str,
                "source": f"{_AUTO_SOURCE_PREFIX} themes",
                "confidence": _AUTO_CONFIDENCE,
                "category": "auto_themes",
                "notes": f"Theme {r.get('name') or tid} {col}.",
            })
    return out


def derive_auto_facts(supabase: Client, *, as_of: date) -> int:
    """Run all six auto-derivation passes, upsert every row, return
    the total count written. A failure in one source is logged and the
    other sources still complete — the L5 cites what is there.

    This is the daily pipeline entry point. The script-side wrapper
    (`scripts/auto_derive_facts.py`) calls it on demand; the daily
    refresh wires it in after regime classification + computable_macro.
    """
    all_rows: list[dict[str, Any]] = []
    for fn in (
        _derive_macro_indicators,
        _derive_computable_macro,
        _derive_regime_row,
        _derive_theme_signals,
        _derive_industry_aggregates,
        _derive_news_facts,
    ):
        try:
            all_rows.extend(fn(supabase, as_of=as_of))
        except Exception as exc:  # noqa: BLE001 — best-effort
            print(
                f"[fact_extraction] {fn.__name__} failed: "
                f"{exc.__class__.__name__}: {exc}"
            )
    return _upsert_many(supabase, all_rows)


#: The window of recent news to scan for numeric claims. 7 days
#: matches the daily_refresh cadence and the "freshness" expectation
#: of a `low`-confidence auto-derived row. Older claims are still
#: in the table from previous runs (we upsert on the (entity, metric,
#: as_of) key, so a re-extracted claim replaces the prior one).
_NEWS_LOOKBACK_DAYS = 7


def _derive_news_facts(
    supabase: Client, *, as_of: date
) -> list[dict[str, Any]]:
    """Read recent theme_news, run each article through the LLM
    extractor, and write the validated claims as `low`-confidence
    `auto_news` rows.

    Two design choices that are easy to miss:

      1. We dedupe by (source, headline) BEFORE calling the LLM.
         The same article can land in `theme_news` for several
         themes (e.g. an AI Capex story tagged to both "AI Capex"
         and "Corporate Credit"). One extraction per article,
         the row is then written with the FIRST theme that brought
         it in — the cite token doesn't carry the theme name, only
         the entity and metric, so a multi-tagged article would
         otherwise produce one fact per theme (4x the LLM cost,
         4x the row count, same value).

      2. The pass is OPTIONAL and OFF by default. Set
         `ANROMEDA_NEWS_EXTRACTION=1` in the environment to enable.
         The first run in production should be with a SMALL
         lookback and a CAREFUL read of the resulting rows —
         a hallucinated `capex_2026_bn = 99999` would land in the
         table and the L5 would happily cite it. Same discipline
         as a one-off admin upsert.
    """
    if os.environ.get("ANDROMEDA_NEWS_EXTRACTION", "").strip() != "1":
        return []
    # Pick the extractor: test hook when set, real Gemini call otherwise.
    # Uses the module-level import (same qualified name as the test patches).
    if news_fact_extractor._TEST_HOOK is not None:
        _extract = news_fact_extractor.extract_claims_for_test
    else:
        _extract = news_fact_extractor.extract_claims_from_article

    from datetime import timedelta
    lookback_start = (as_of - timedelta(days=_NEWS_LOOKBACK_DAYS)).isoformat()
    resp = (
        supabase.table("theme_news")
        .select("headline, source, published_date, theme_id")
        .gte("run_date", lookback_start)
        .lte("run_date", as_of.isoformat())
        .order("run_date", desc=True)
        .limit(500)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return []

    # Dedupe by (source, headline) — keep the first occurrence.
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        key = (r.get("source", ""), r.get("headline", ""))
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    if not unique:
        return []

    out: list[dict[str, Any]] = []
    for r in unique:
        title = r.get("headline", "")
        # The article URL is the citation source. theme_news does
        # not currently store the URL separately — the source
        # column is the human-readable name (e.g. "brave", "reddit",
        # "Tom's Hardware"). The URL would require a join to
        # news_raw, which is out of scope here. We cite the source
        # name as the L5 cite path already does.
        url = r.get("source", "")
        body = r.get("headline", "")  # theme_news only has the headline, not body
        claims = _extract(title=title, url=url, body=body)
        for claim in claims:
            out.append({
                "entity": claim["entity"],
                "metric": claim["metric"],
                "value": claim["value"],
                "unit": claim["unit"],
                "as_of": claim["as_of"],
                "source": f"auto-derived: news_fact_extractor (theme_news via {r.get('source', '?')})",
                "source_url": None,  # URL not stored on theme_news; see comment above
                "confidence": "low",
                "category": "auto_news",
                "notes": f"LLM-extracted from news headline: {title[:80]}",
            })
    return out


#: The "Big Five" hyperscalers. Industry-aggregate facts compute over
#: this set; if a new hyperscaler is added (e.g. META on its own
#: promotion), it joins the set without code change. The set is the
#: literal list of tickers that show up in the curated ai_capex seed.
_HYPERSCALERS: tuple[str, ...] = ("MSFT", "META", "GOOGL", "AMZN", "ORCL")

#: Which metrics are aggregated, and what unit they carry. Adding a
#: new metric here is a one-line change; the aggregates (sum, mean,
#: min, max) are computed uniformly.
_HYPERSCALER_METRICS: tuple[tuple[str, str], ...] = (
    ("capex_fy26_bn", "USD_bn"),
    ("cash_runway_years", "years"),
    ("trailing_eps_ttm", "USD_per_share"),
)


def _derive_industry_aggregates(
    supabase: Client, *, as_of: date
) -> list[dict[str, Any]]:
    """Compute SUM/MEAN/MIN/MAX over the hyperscaler set for each
    curated company-level metric, and write one row per (metric, agg).

    The result is a derived reading that the L5 can cite — for
    example, `[structured_facts:industry:hyperscaler:top5:capex_fy26_bn_sum]`
    returns the total FY26 capex across MSFT/META/GOOGL/AMZN/ORCL.
    The hand-curated `industry:hyperscaler:capex_2026_total_bn = 725`
    is a JPM research note that ALSO includes smaller hyperscalers;
    the auto-derived sum is the big-five slice and is the right cite
    when the thesis is "the top 5 are committing $X in FY26" — same
    shape, different scope, both honest.

    Reads from the structured_facts table itself (not macro_indicators
    or any other source) so the aggregates always reflect the latest
    curated or auto-derived company rows. A row in `category=ai_capex`
    with `entity IN (MSFT, META, GOOGL, AMZN, ORCL)` and the right
    metric is the input.
    """
    # Read all hyperscaler rows for the relevant metrics, picking the
    # MOST RECENT as_of per (entity, metric) — the same trajectory
    # discipline the L5 cite path uses (ADR-0098).
    resp = (
        supabase.table("structured_facts")
        .select("entity, metric, value, unit, as_of")
        .in_("entity", list(_HYPERSCALERS))
        .in_("metric", [m for m, _ in _HYPERSCALER_METRICS])
        .order("as_of", desc=True)
        .limit(500)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return []

    # Pick the latest row per (entity, metric).
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        key = (r.get("entity", ""), r.get("metric", ""))
        if key not in latest:
            latest[key] = r

    out: list[dict[str, Any]] = []
    for metric, unit in _HYPERSCALER_METRICS:
        values: list[tuple[str, float, str]] = []
        for entity in _HYPERSCALERS:
            r = latest.get((entity, metric))
            if not r:
                continue
            v = _safe_num(r.get("value"))
            if v is None:
                continue
            as_of_str = str(r.get("as_of", ""))[:10]
            values.append((entity, v, as_of_str))
        if not values:
            continue
        # The aggregate's as_of is the LATEST of the inputs — same
        # convention as the L5 cite: "what is the system reading
        # right now", not "when did the most stale input land".
        agg_as_of = max(v[2] for v in values)
        n = len(values)
        n_label = f"top{n}_hyperscaler"

        def _row(metric_suffix: str, value: float, notes: str) -> dict[str, Any]:
            return {
                "entity": f"industry:hyperscaler:{n_label}",
                "metric": f"{metric}_{metric_suffix}",
                "value": value,
                "unit": unit,
                "as_of": agg_as_of,
                "source": f"{_AUTO_SOURCE_PREFIX} structured_facts[ai_capex]",
                "confidence": _AUTO_CONFIDENCE,
                "category": "auto_industry",
                "notes": notes,
            }

        sum_v = round(sum(v for _, v, _ in values), 4)
        mean_v = round(sum_v / n, 4)
        min_v = round(min(v for _, v, _ in values), 4)
        max_v = round(max(v for _, v, _ in values), 4)

        entities_str = ", ".join(e for e, _, _ in values)
        out.append(_row("sum", sum_v,
                        f"Sum across {n_label} ({entities_str})"))
        out.append(_row("mean", mean_v,
                        f"Mean across {n_label} ({entities_str})"))
        out.append(_row("min", min_v,
                        f"Min across {n_label} (worst-case {entities_str})"))
        out.append(_row("max", max_v,
                        f"Max across {n_label} (best-case {entities_str})"))
    return out
