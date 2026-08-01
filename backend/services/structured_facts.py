"""Structured facts the L5 reasoning agent cites, with provenance
(ADR-0218).

A thin read/write service over the `structured_facts` table. The
table is hand-curated, so the write side is for the loader script
and a one-off admin tool; the read side is what the L5 calls.

Reads follow ADR-0098: an absent fact returns None, NOT zero. The
L5 cites the absence as an absence — a fact the system does not
have is honest, a fake number is not.

The service intentionally does NOT cache: structured_facts is small
(<200 rows expected) and the L5 calls it once per thesis. Caching
would add complexity for no measurable win.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from supabase import Client


def _row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    """Convert a Supabase row to a JSON-friendly dict. Decimal dates
    that come back as strings are left as strings — the caller
    parses them as needed."""
    out: dict[str, Any] = dict(row)
    if "created_at" in out and out["created_at"] is not None:
        # Supabase returns timestamptz as ISO string already.
        pass
    return out


def get_fact(
    supabase: Client,
    entity: str,
    metric: str,
    *,
    as_of: date | None = None,
) -> dict[str, Any] | None:
    """Read one fact by (entity, metric). When as_of is None, returns
    the most recent row. Returns None when no row matches.

    ADR-0098: an absent fact is None, never a zero-row.
    """
    q = (
        supabase.table("structured_facts")
        .select("entity, metric, value, unit, as_of, source, source_url, "
                "confidence, category, notes, created_at")
        .eq("entity", entity)
        .eq("metric", metric)
    )
    if as_of is not None:
        q = q.lte("as_of", as_of.isoformat())
    resp = q.order("as_of", desc=True).limit(1).execute()
    rows = resp.data or []
    if not rows:
        return None
    return _row_to_dict(rows[0])


def get_facts_by_category(
    supabase: Client,
    category: str,
    *,
    as_of: date | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """All facts in a category, ordered by as_of DESC. The L5 calls
    this to pull 'everything we know about ai_capex' in one read."""
    q = (
        supabase.table("structured_facts")
        .select("entity, metric, value, unit, as_of, source, source_url, "
                "confidence, category, notes, created_at")
        .eq("category", category)
    )
    if as_of is not None:
        q = q.lte("as_of", as_of.isoformat())
    resp = q.order("as_of", desc=True).limit(limit).execute()
    return [_row_to_dict(r) for r in (resp.data or [])]


def get_facts_for_entities(
    supabase: Client,
    entities: list[str],
    metrics: list[str] | None = None,
    *,
    as_of: date | None = None,
) -> list[dict[str, Any]]:
    """Bulk read for L5 thesis construction. The agent says 'give me
    capex_fy26_bn for MSFT/META/GOOGL/AMZN/ORCL' in one call."""
    if not entities:
        return []
    q = (
        supabase.table("structured_facts")
        .select("entity, metric, value, unit, as_of, source, source_url, "
                "confidence, category, notes, created_at")
        .in_("entity", entities)
    )
    if metrics:
        q = q.in_("metric", metrics)
    if as_of is not None:
        q = q.lte("as_of", as_of.isoformat())
    resp = q.order("entity").order("metric").order("as_of", desc=True).execute()
    return [_row_to_dict(r) for r in (resp.data or [])]


def get_fact_trajectory(
    supabase: Client,
    entity: str,
    metric: str,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """All rows for (entity, metric), most recent first. Used by
    the /facts page to show the trajectory of a single quantity."""
    resp = (
        supabase.table("structured_facts")
        .select("entity, metric, value, unit, as_of, source, source_url, "
                "confidence, category, notes, created_at")
        .eq("entity", entity)
        .eq("metric", metric)
        .order("as_of", desc=True)
        .limit(limit)
        .execute()
    )
    return [_row_to_dict(r) for r in (resp.data or [])]


def upsert_fact(supabase: Client, fact: dict[str, Any]) -> int:
    """Insert or update one fact. The unique key is (entity, metric,
    as_of), so a re-load with the same three fields updates in place
    rather than creating a duplicate. Returns the row id.

    The loader uses this; the L5 does not.
    """
    payload = {
        k: v for k, v in fact.items()
        if k in (
            "entity", "metric", "value", "unit", "as_of", "source",
            "source_url", "confidence", "category", "notes",
        )
    }
    if not all(k in payload for k in ("entity", "metric", "value", "unit",
                                      "as_of", "source", "confidence",
                                      "category")):
        raise ValueError(
            "upsert_fact requires entity, metric, value, unit, as_of, "
            "source, confidence, category"
        )
    # Supabase returns the upserted row(s); on conflict on the unique
    # key, it updates the existing row.
    resp = (
        supabase.table("structured_facts")
        .upsert(payload, on_conflict="entity,metric,as_of")
        .execute()
    )
    rows = resp.data or []
    return rows[0]["id"] if rows else 0


def cite(entity: str, metric: str) -> str:
    """The canonical citation string the L5 uses: '[structured_facts:<entity>:<metric>]'.

    Kept as a function so the L5 prompt and the citation guardrail
    stay in lockstep — a typo in one would otherwise be silent."""
    return f"[structured_facts:{entity}:{metric}]"


def parse_cite(citation: str) -> tuple[str, str] | None:
    """Parse a citation string into (entity, metric). Returns None
    when the string is not a structured_facts citation."""
    s = citation.strip()
    if not s.startswith("[structured_facts:") or not s.endswith("]"):
        return None
    body = s[len("[structured_facts:") : -1]
    if ":" not in body:
        return None
    entity, metric = body.split(":", 1)
    return entity, metric
