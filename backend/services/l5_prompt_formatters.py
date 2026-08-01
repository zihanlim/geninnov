"""L5 prompt formatters for structured_facts and computable_macro
(ADR-0220).

Extracted from q1_agent so the format functions are unit-testable
without importing the whole pipeline (which has top-level imports
that may require Supabase / LLM env vars).

The two formatters produce the markdown-ish tables the L5 reads
verbatim. The cite token — `[structured_facts:<entity>:<metric>]`
or `[regime_classifications:computable_macro:<metric>]` — is
rendered as a column the L5 copies. A typo in the entity or metric
column would silently fail the citation guardrail downstream, so
the rendering is the contract.
"""
from __future__ import annotations

from typing import Any

#: How many rows of structured_facts the prompt should expose. The
#: 50-row seed is small enough to render in full; if the table
#: grows past 80 rows this needs a per-category budget.
STRUCTURED_FACTS_PROMPT_LIMIT = 80


def _format_num(v: Any) -> str:
    """Render a number for the L5 table. None → 'N/A'. Booleans →
    'true'/'false'. Floats are kept readable (no scientific notation
    for typical sizes)."""
    if v is None:
        return "N/A"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        # 4 sig figs is enough for the L5 to type a faithful cite
        # without dragging noise digits.
        if abs(v) >= 1.0:
            return f"{v:.4g}"
        return f"{v:.4g}"
    return str(v)


def format_structured_facts(rows: list[dict]) -> str:
    """Format the structured_facts table for the L5 prompt.

    Empty input returns a placeholder that tells the L5 why the
    table is empty. The placeholder must not advertise a fabrication
    route ("do not invent facts").

    Each row's entity and metric are rendered as the L5 will type
    them. Sorted by category, then (entity, metric), so the table
    reads top-down in a stable order across runs.
    """
    if not rows:
        return (
            "(no structured_facts loaded — table empty or pre-migration. "
            "Do not invent facts; cite macro_indicators or regime instead.)"
        )
    by_cat: dict[str, list[dict]] = {}
    for r in rows:
        by_cat.setdefault(r.get("category", "?"), []).append(r)
    out: list[str] = []
    out.append(
        "  entity / metric                          value          unit          as_of        source                                       confidence"
    )
    out.append(
        "  ----------------------------------------  -------------  ------------  -----------  ----------------------------------------  ----------"
    )
    for cat in sorted(by_cat):
        out.append(f"  --- {cat} ---")
        for r in sorted(by_cat[cat], key=lambda x: (x.get("entity", ""), x.get("metric", ""))):
            entity = r.get("entity", "?")
            metric = r.get("metric", "?")
            val = _format_num(r.get("value"))
            unit = r.get("unit", "")
            as_of = str(r.get("as_of", ""))[:10]
            source = (r.get("source") or "")[:40]
            confidence = r.get("confidence", "?")
            out.append(
                f"  {entity}/{metric:<35}  {val:<13}  {unit:<12}  {as_of}  {source:<40}  {confidence}"
            )
        if len(out) >= STRUCTURED_FACTS_PROMPT_LIMIT + 5:
            out.append(
                f"  ... ({len(rows) - (STRUCTURED_FACTS_PROMPT_LIMIT - 5)} more rows truncated; "
                "the citation guardrail still accepts them by exact (entity, metric) match.)"
            )
            break
    return "\n".join(out)


def format_computable_macro(payload: dict) -> str:
    """Format the computable_macro JSONB for the L5 prompt.

    Three metrics, one line each: status + primary value + extras.
    Empty payload returns a placeholder. A metric with status
    'unknown' renders its primary value as N/A, not zero
    (ADR-0098 / ADR-0217).
    """
    if not payload:
        return (
            "(no computable_macro data — runner has not run yet, or the "
            "JSONB column is empty. Cite regime_classifications directly.)"
        )
    out: list[str] = []
    for metric in ("erp", "equity_bond_corr", "ndx_seasonality"):
        m = payload.get(metric)
        if not m:
            out.append(f"  {metric}: (not present)")
            continue
        status = m.get("status", "unknown")
        as_of = m.get("as_of", "?")
        if metric == "ndx_seasonality":
            n_obs = m.get("n_observations", 0)
            out.append(
                f"  ndx_seasonality: status={status} as_of={as_of} "
                f"n_observations={n_obs} (per-month stats in JSON)"
            )
            continue
        # Render the primary value or "<unknown>" placeholder.
        primary_key = "erp_pct" if metric == "erp" else "corr"
        primary = m.get(primary_key)
        primary_str = _format_num(primary) if isinstance(primary, (int, float)) else "N/A"
        extra: list[str] = []
        if metric == "erp":
            pe = m.get("spx_pe")
            if isinstance(pe, (int, float)):
                extra.append(f"P/E={_format_num(pe)}")
            ust10 = m.get("ust10_pct")
            if isinstance(ust10, (int, float)):
                extra.append(f"ust10={_format_num(ust10)}")
        else:
            socgen = m.get("socgen_flip_active")
            if isinstance(socgen, bool):
                extra.append(f"socgen_flip={socgen}")
            ust10 = m.get("ust10_pct")
            if isinstance(ust10, (int, float)):
                extra.append(f"ust10={_format_num(ust10)}")
        extra_str = (" (" + ", ".join(extra) + ")") if extra else ""
        out.append(
            f"  {metric}: status={status} as_of={as_of} value={primary_str}{extra_str}"
        )
    return "\n".join(out)
