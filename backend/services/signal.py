"""The signal: what the research says, before any mandate touches it.

WHY THIS IS A SEPARATE THING
----------------------------
Andromeda publishes a book sized to $100M under a 20/30/35 cap set and a 100% gross
budget. Those constraints belong to ONE hypothetical fund. Every consumer-facing
surface — `/book`, and all ten MCP tools — emitted only the SIZED output, so a
portfolio-management app with its own capital base and its own limits could not use
any of it without reverse-engineering back to the research underneath. The number it
actually needs, `conviction = |EdgeScore| / vol`, was never a first-class output at
all: it appeared only as a column in a sizing derivation.

That fusion is the defect. Research and portfolio construction are different jobs:

    signal   (mandate-free)  what we think, and why
       + mandate (a parameter)
       -> sizing = f(signal, mandate)

`q1_agent` already had this shape — `reason_picks` chooses names and sides,
`size_positions` turns them into weights, and they are separate nodes. What was
missing is that the intermediate was never persisted, so the only artefact that ever
escaped was the one with someone else's mandate baked in.

WHAT A SIGNAL ROW MAY NOT CONTAIN
---------------------------------
No weight, no signed_weight, no notional, no cash, no gross. If a field cannot be
computed without knowing the capital base or the caps, it belongs to the book and not
here. `extract_signal` is called BEFORE `size_positions` for exactly this reason:
there is no sizing in scope to leak.

The one number that carries sizing INFORMATION without carrying a mandate is
`conviction`. It is a ratio — edge per unit of volatility — so it is the same whether
a reader runs $100M or $5bn, and it is what any mandate's sizer needs as input.

See ADR-0148.
"""

from __future__ import annotations

from typing import Any

# Fields copied verbatim from a pick. Deliberately enumerated rather than
# "everything except the sized fields": a blocklist silently admits any sizing field
# a future node happens to add, and this payload's whole contract is what it excludes.
_THESIS_FIELDS = (
    "thesis",
    "catalysts",
    "risk",
    "counter_thesis",
    "time_horizon",
)

# Never copied, even if present on the pick. Asserted by the test suite, because the
# guarantee this module makes is an ABSENCE and absences are not visible in review.
FORBIDDEN_FIELDS = (
    "weight",
    "signed_weight",
    "notional",
    "cash",
    "gross",
    "total_capital",
)


def extract_signal(
    picks: list[dict[str, Any]],
    candidates: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """The mandate-free signal for each name the agent chose.

    Args:
        picks:      `state["picks"]` after `verify_citations` and BEFORE
                    `size_positions`. Sizing fields are absent at that point; if a
                    caller passes a sized book anyway, they are stripped rather than
                    trusted, so this cannot silently start publishing weights.
        candidates: the L1 candidate rows, which carry `edge_score`, `conviction` and
                    `vol`. The pick itself does not — the LLM names and argues, it
                    does not score.

    Returns one row per pick, ordered as the agent ordered them.
    """
    by_asset: dict[str, dict[str, Any]] = {}
    for cand in candidates or []:
        asset = cand.get("asset")
        if asset:
            by_asset[asset] = cand

    out: list[dict[str, Any]] = []
    for pick in picks or []:
        asset = pick.get("asset")
        if not asset:
            # A pick with no ticker cannot be joined, cited or traded. Dropping it
            # loudly beats emitting a row keyed on nothing.
            continue

        cand = by_asset.get(asset, {})
        row: dict[str, Any] = {
            "asset": asset,
            "direction": pick.get("direction"),
            "theme": pick.get("theme") or pick.get("theme_name"),
            "theme_id": pick.get("theme_id"),
            # The scored quantities. None, never 0.0 — a missing edge is not a
            # neutral one, and ADR-0066 makes that distinction persist.
            "edge_score": _num(cand.get("edge_score")),
            "conviction": _num(cand.get("conviction")),
            "vol": _num(cand.get("vol")),
            "hype_score": _num(pick.get("hype_score") or cand.get("hype_score")),
            "citations": pick.get("citations") or [],
        }
        for field in _THESIS_FIELDS:
            row[field] = pick.get(field)

        # Belt and braces: if a caller ever hands this a sized book, the sizing does
        # not travel. The contract is the absence.
        for field in FORBIDDEN_FIELDS:
            row.pop(field, None)

        out.append(row)

    return out


def _num(value: Any) -> float | None:
    """Coerce to float, or None. Never 0.0 as a stand-in for absent."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None  # NaN -> None


def signal_payload(
    run_date: str,
    picks: list[dict[str, Any]],
    candidates: list[dict[str, Any]] | None = None,
    lens: str | None = None,
) -> dict[str, Any]:
    """The full persisted payload: the rows plus what a consumer must know to use them.

    `mandate_free: True` is a claim this module is willing to make and the test suite
    enforces. It is stated in the payload rather than in documentation because the MCP
    consumer reads the payload and never reads the docs.
    """
    rows = extract_signal(picks, candidates)
    return {
        "run_date": run_date,
        "lens": lens,
        "signals": rows,
        "count": len(rows),
        "mandate_free": True,
        "note": (
            "Names, sides and conviction only. No weights, notionals or capital "
            "base: size these under your own mandate. conviction = |EdgeScore| / "
            "vol is a ratio and is the same at any capital base."
        ),
    }
