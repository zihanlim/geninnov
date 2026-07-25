"""Running the battery — against a canned book, a deliberately broken one, or a live LLM.

The three agent functions are the reason this is useful in CI at all. `run_battery`
does not care where a book came from, so the same cases and the same scorer serve
three jobs:

* `canned_agent_fn` — builds a compliant book straight from the fixture. It calls no
  model and costs nothing. Running the battery against it proves the *scorer* is
  wired up: if a hand-built correct answer fails, the check is broken, not the agent.
* `drifting_agent_fn` — builds a book that is wrong in a specific, named way. Proves
  the scorer actually rejects. A check that never fires is indistinguishable from a
  check that always passes, and only this catches that.
* `llm_agent_fn` — calls the real `reason_picks` on the fixture. This is the one that
  costs money and answers the actual question. `scripts/run_eval.py` drives it.

The split is borrowed from im-Jarvis's `agents/eval/runner.py`, which separates a
CI-safe `engine_fn`/`agent_fn` pair from the live ones for the same reason.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .battery import EvalCase
from .fixtures import fresh
from .scorer import CaseScore, aggregate, score_book

AgentFn = Callable[[EvalCase], dict[str, Any]]


@dataclass(frozen=True, slots=True)
class BatteryResult:
    scores: tuple[CaseScore, ...]
    summary: dict[str, Any]

    @property
    def all_passed(self) -> bool:
        return all(s.passed for s in self.scores)


def run_battery(cases: tuple[EvalCase, ...], *, agent_fn: AgentFn) -> BatteryResult:
    """Score every case. A case whose agent raises is recorded as a failure, not a crash.

    A live provider can time out or return unparseable JSON on one case and behave on
    the next four; aborting the run would throw away the four results that arrived.
    """
    scores: list[CaseScore] = []
    for case in cases:
        try:
            book = agent_fn(case)
        except Exception as exc:  # noqa: BLE001 — a provider failure is a result, not a crash
            book = {
                "picks": [],
                "book_view": "",
                "book_risks": [],
                "citations": [],
                "agent_error": f"{exc.__class__.__name__}: {exc}",
            }
        scores.append(score_book(case, book))
    return BatteryResult(scores=tuple(scores), summary=aggregate(scores))


# ─────────────────────────────────────────────────────────────────────────────
# Canned agent — the CI round-trip
# ─────────────────────────────────────────────────────────────────────────────

def _eligible(case: EvalCase) -> list[dict]:
    """Candidates ranked by conviction, with correlated complexes collapsed.

    Ranking on |trade_score| across *both* sides rather than within each side is what
    makes the canned book directional: in a fixture where every short carries a
    stronger score than every long, the top of this list is all shorts, which is the
    answer the case asserts. Collapsing complexes to their strongest member is the
    ADR-0048 rule stated as code.
    """
    ideas = case.state.get("independent_ideas") or {}
    suppressed: set[str] = set()
    for side in ("long", "short"):
        for complex_ in (ideas.get(side) or {}).get("complexes", []) or []:
            strongest = complex_.get("strongest")
            suppressed |= {m for m in (complex_.get("members") or []) if m != strongest}

    candidates = [
        c for c in (case.state.get("candidates") or [])
        if str(c.get("asset")) not in suppressed
    ]
    return sorted(candidates, key=lambda c: abs(float(c.get("trade_score") or 0.0)), reverse=True)


def _theme_lookup(case: EvalCase) -> dict[str, dict]:
    return {str(t["theme_id"]): t for t in (case.state.get("theme_scores") or [])}


def _macro_sentence(case: EvalCase) -> str:
    """A prose line quoting the macro snapshot exactly, in the snapshot's own units.

    Built from the fixture rather than written by hand so it cannot drift from it —
    the `ProseNumber` checks read this sentence. Source *keys* are deliberately kept
    out of it: a ticker like BAMLH0A0HYM2 contains digits, and the extractor would
    read the `0` in it as the number the label introduces.
    """
    macro = case.state.get("macro_snapshot") or {}
    fragments = []
    for sid, meta in macro.items():
        name = str(meta.get("name") or sid)
        value, unit = meta.get("value"), str(meta.get("unit") or "")
        suffix = {"pct": "%", "bps": " bps", "index": "", "usd": " USD"}.get(unit, f" {unit}".rstrip())
        fragments.append(f"the {name} at {value}{suffix}")
    return "Inputs as given: " + ", ".join(fragments) + "."


def canned_agent_fn(case: EvalCase) -> dict[str, Any]:
    """A correct book, assembled mechanically from the fixture. No LLM involved.

    Deliberately does *not* try to write good prose — it writes verifiable prose.
    The point is a book that every check in the battery should accept, so that a
    failure means the scorer is wrong.
    """
    ranked = _eligible(case)
    themes = _theme_lookup(case)

    picks: list[dict] = []
    per_side: dict[str, int] = {"long": 0, "short": 0}
    for candidate in ranked:
        side = str(candidate.get("direction", "")).lower()
        if per_side.get(side, 0) >= 5 or len(picks) >= 8:
            continue
        per_side[side] = per_side.get(side, 0) + 1
        theme = themes.get(str(candidate.get("theme_id"))) or {}
        asset = str(candidate.get("asset"))
        theme_name = str(candidate.get("theme_name") or theme.get("name") or "")
        pick_citations = []
        if theme:
            pick_citations.append({
                "source": f"theme:{theme['theme_id']}:hype",
                "text": f"{theme_name} HypeScore {theme['hype_score']}",
                "value": float(theme["hype_score"]),
            })
        picks.append({
            "rank": len(picks) + 1,
            "direction": side,
            "asset": asset,
            "theme": theme_name,
            "theme_id": candidate.get("theme_id"),
            "hype_score": theme.get("hype_score"),
            "trade_score": candidate.get("trade_score"),
            "time_horizon": "1-3 months",
            "thesis": f"{asset} expresses the {theme_name} theme on the {side} side.",
            "counter_thesis": f"Exit {asset} if the {theme_name} theme's HypeScore falls by a third.",
            "risk": f"{asset} carries the liquidity and gap risk of a single-name expression.",
            "citations": pick_citations,
        })

    citations: list[dict] = []
    for sid, meta in (case.state.get("macro_snapshot") or {}).items():
        citations.append({
            "source": sid,
            "text": f"{meta.get('name', sid)} {meta.get('value')} {meta.get('unit', '')}".strip(),
            "value": float(meta["value"]),
        })
    for theme in (case.state.get("theme_scores") or []):
        citations.append({
            "source": f"theme:{theme['theme_id']}:trade",
            "text": f"{theme['name']} TradeScore {theme['trade_score']}",
            "value": float(theme["trade_score"]),
        })

    regime = case.state.get("regime") or {}
    longs = per_side.get("long", 0)
    shorts = per_side.get("short", 0)
    book_view = (
        f"Regime reads {regime.get('cycle', 'n/a')} / {regime.get('sentiment', 'n/a')}. "
        f"{_macro_sentence(case)} "
        f"The book takes {longs} long and {shorts} short expression(s), ranked on the "
        f"TradeScore attached to each candidate."
    )

    return {
        "picks": picks,
        "book_view": book_view,
        "book_risks": [
            "Single-name expressions carry idiosyncratic risk the theme view does not.",
            "A regime transition would invalidate the ranking the book is built on.",
        ],
        "citations": citations,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Drifting agent — proves the checks fire
# ─────────────────────────────────────────────────────────────────────────────

def drifting_agent_fn(case: EvalCase) -> dict[str, Any]:
    """The canned book, damaged in four specific ways.

    Each defect targets a different check, so a test asserting this book fails is
    asserting the checks are live rather than vacuous:

    1. a pick for an asset no candidate offers      → `PicksInPool`
    2. the first pick's citations stripped          → `EveryPickCited`
    3. every citation value fabricated              → `CitationsVerify`
    4. every macro figure in prose shifted          → `ProseNumber`

    Defect 3 replaces the citation array rather than salting it, because ADR-0027
    deliberately tolerates a small ungrounded minority — the guardrail accepts a book
    at 80% grounded, so appending two bad citations to ten good ones lands exactly on
    the tolerance and passes. A drift meant to prove the check fires has to clear the
    threshold the check actually applies.
    """
    book = canned_agent_fn(case)

    book["picks"] = list(book["picks"])
    book["picks"].append({
        "rank": len(book["picks"]) + 1,
        "direction": "long",
        "asset": "ZZZZ_NOT_A_CANDIDATE",
        "theme": "Invented",
        "thesis": "A name that appears in no candidate table.",
        "counter_thesis": "None — this pick should never have existed.",
        "citations": [],
    })
    if len(book["picks"]) > 1:
        book["picks"][0] = {**book["picks"][0], "citations": []}

    book["citations"] = [
        {
            "source": sid,
            "text": f"{meta.get('name', sid)} at {float(meta['value']) * 1.5:.2f}",
            "value": float(meta["value"]) * 1.5,
        }
        for sid, meta in (case.state.get("macro_snapshot") or {}).items()
    ] or [{"source": "BAMLH0A0HYM2", "text": "HY OAS at 1234.5 bps", "value": 1234.5}]

    macro = case.state.get("macro_snapshot") or {}
    fragments = [
        f"the {meta.get('name', sid)} at {float(meta['value']) * 1.5:.2f}"
        for sid, meta in macro.items()
    ]
    book["book_view"] = "Inputs as given: " + ", ".join(fragments) + "."
    return book


# ─────────────────────────────────────────────────────────────────────────────
# Live agent — the one that costs money
# ─────────────────────────────────────────────────────────────────────────────

def llm_agent_fn(case: EvalCase) -> dict[str, Any]:
    """Run the real `reason_picks` node against the case's frozen state.

    Imported lazily so that importing this package in CI never pulls a provider
    client or reads an API key into the process.
    """
    from backend.services.q1_agent import reason_picks

    state = fresh(case.state)
    state = reason_picks(state)
    return {
        "picks": state.get("picks") or [],
        "book_view": state.get("book_view") or "",
        "book_risks": state.get("book_risks") or [],
        "citations": state.get("citations") or [],
        "agent_error": state.get("error"),
        "fallback_used": bool(state.get("fallback_used")),
    }
