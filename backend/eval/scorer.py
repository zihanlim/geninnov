"""Evaluating one book against one case's expectations.

The scorer is the only place in the package that knows how a check is decided.
`battery.py` stays inert data so the cases can be read and disputed without reading
this file.

Two deliberate choices worth knowing about before you trust a result:

**The citation check delegates to production.** `CitationsVerify` calls
`q1_agent.verify_citations` rather than reimplementing the guardrail. A
reimplementation would drift, and a battery that passes while production rejects the
same book is worse than no battery.

**Prose matching is lenient about absence and strict about presence.** A metric the
thesis never quotes numerically is not a failure — the agent is not obliged to
mention any particular figure. A metric it does quote, wrongly, is. That asymmetry is
the whole point: ADR-0049's failure was a *stated* number that was wrong, not a
missing one.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Any

from backend.services.q1_agent import verify_citations

from .battery import (
    Check,
    CitationsVerify,
    EvalCase,
    EveryPickCited,
    MaxPerSide,
    NetTilt,
    OnePerComplex,
    PicksInPool,
    ProseNumber,
    SideCount,
    is_directional,
)
from .fixtures import fresh

# How a metric is recognised in free text. Ordered longest-first at match time so
# "vix term structure" is not consumed by the "vix" entry.
METRIC_SYNONYMS: dict[str, tuple[str, ...]] = {
    "vix": ("vix", "volatility index", "implied vol"),
    "hy_oas": ("hy oas", "high-yield oas", "high yield oas", "credit spread",
               "high-yield spread", "hy spread", "bamlh0a0hym2"),
    "dgs10": ("10-year treasury", "10y treasury", "10-year yield", "10y yield",
              "10-year", "10y", "dgs10"),
    "dgs2": ("2-year treasury", "2y treasury", "2-year yield", "2y yield", "dgs2"),
    "yield_curve_slope": ("2s10s", "curve slope", "yield curve slope", "curve inversion"),
    "real_rate": ("real rate", "real yield"),
    "spx_breadth": ("breadth",),
    "var_95": ("var", "value-at-risk", "value at risk"),
    "cvar_95": ("cvar", "conditional var", "expected shortfall"),
    "sharpe": ("sharpe",),
    "beta": ("beta to spx", "portfolio beta"),
    "concentration_hhi": ("hhi", "herfindahl", "concentration"),
}

_NUMBER = re.compile(r"-?\d[\d,]*\.?\d*")
# How far past a label to look for the number it introduces. Wide enough for
# "HY OAS, currently sitting at 835bp", narrow enough not to reach the next clause.
_WINDOW = 48


@dataclass(frozen=True, slots=True)
class CheckResult:
    label: str
    passed: bool
    detail: str
    directional: bool = False


@dataclass(frozen=True, slots=True)
class CaseScore:
    case_id: str
    results: tuple[CheckResult, ...]
    picks: int
    longs: int
    shorts: int

    @property
    def passed(self) -> bool:
        return all(r.passed for r in self.results)

    @property
    def structurally_passed(self) -> bool:
        """Ignoring the directional checks — the half that can gate a build."""
        return all(r.passed for r in self.results if not r.directional)

    @property
    def failures(self) -> tuple[CheckResult, ...]:
        return tuple(r for r in self.results if not r.passed)


# ─────────────────────────────────────────────────────────────────────────────
# Prose number extraction
# ─────────────────────────────────────────────────────────────────────────────

def _parse(token: str) -> float | None:
    try:
        return float(token.replace(",", "").rstrip("."))
    except ValueError:
        return None


def prose_numbers_for(text: str, metric: str) -> list[float]:
    """Every number the text introduces immediately after a mention of `metric`.

    One number per mention — the first inside `_WINDOW` characters. Taking only the
    first is what lets a thesis say "VIX at 41.70, and a spike to 51.70 would..."
    without the scenario figure being read as a competing claim about the level.
    """
    lowered = text.lower()
    found: list[float] = []
    for synonym in sorted(METRIC_SYNONYMS.get(metric, (metric,)), key=len, reverse=True):
        for match in re.finditer(re.escape(synonym), lowered):
            tail = lowered[match.end(): match.end() + _WINDOW]
            hit = _NUMBER.search(tail)
            if hit:
                value = _parse(hit.group(0))
                if value is not None:
                    found.append(value)
    return found


def _matches_at_any_scale(claimed: float, expected: float, tolerance: float) -> bool:
    """True when `claimed` equals `expected` at unit scale, or in bps, or in percent.

    The snapshot states units ("620.0 bps"), but a thesis restating that as "6.20%"
    is correct English and correct finance. Rather than fail a correct restatement,
    the comparison is tried at 1x, 100x and 1/100x. The cost is a narrow class of
    false passes — a claim wrong by exactly two orders of magnitude reads as right —
    which is a trade worth making against routinely flagging good prose.
    """
    for scaled in (expected, expected * 100.0, expected / 100.0):
        band = max(abs(scaled) * tolerance, 1e-9)
        if abs(claimed - scaled) <= band:
            return True
    return False


def _all_prose(book: dict[str, Any]) -> str:
    """Every surface a reader sees, concatenated — the book view, each thesis and
    counter-thesis, each per-pick risk line, and the cross-cutting risks."""
    parts: list[str] = [str(book.get("book_view") or "")]
    for pick in book.get("picks") or []:
        for key in ("thesis", "counter_thesis", "risk"):
            parts.append(str(pick.get(key) or ""))
    parts.extend(str(r) for r in (book.get("book_risks") or []))
    return "\n".join(p for p in parts if p)


# ─────────────────────────────────────────────────────────────────────────────
# Individual checks
# ─────────────────────────────────────────────────────────────────────────────

def _sided(picks: list[dict], side: str) -> list[dict]:
    return [p for p in picks if str(p.get("direction", "")).lower() == side]


def _check_picks_in_pool(case: EvalCase, book: dict, picks: list[dict]) -> CheckResult:
    pool = {
        (str(c.get("asset")), str(c.get("direction", "")).lower())
        for c in (case.state.get("candidates") or [])
    }
    strays = [
        f"{p.get('direction')}:{p.get('asset')}"
        for p in picks
        if (str(p.get("asset")), str(p.get("direction", "")).lower()) not in pool
    ]
    return CheckResult(
        label="picks_in_pool",
        passed=not strays,
        detail=(
            f"all {len(picks)} picks are in the candidate pool"
            if not strays
            else f"{len(strays)} pick(s) outside the pool: {', '.join(strays)}"
        ),
    )


def _check_max_per_side(check: MaxPerSide, picks: list[dict]) -> CheckResult:
    longs, shorts = len(_sided(picks, "long")), len(_sided(picks, "short"))
    over = [s for s, n in (("long", longs), ("short", shorts)) if n > check.limit]
    return CheckResult(
        label="max_per_side",
        passed=not over,
        detail=(
            f"{longs} long / {shorts} short, limit {check.limit}"
            if not over
            else f"exceeds {check.limit} on: {', '.join(over)} ({longs} long / {shorts} short)"
        ),
    )


def _check_side_count(check: SideCount, picks: list[dict]) -> CheckResult:
    n = len(_sided(picks, check.side))
    problems: list[str] = []
    if check.at_most is not None and n > check.at_most:
        problems.append(f"{n} > at_most {check.at_most}")
    if check.at_least is not None and n < check.at_least:
        problems.append(f"{n} < at_least {check.at_least}")
    bounds = ", ".join(
        f"{k}={v}" for k, v in (("at_most", check.at_most), ("at_least", check.at_least))
        if v is not None
    )
    return CheckResult(
        label=f"side_count:{check.side}",
        passed=not problems,
        detail=f"{n} {check.side} pick(s) [{bounds}]" + ("" if not problems else f" — {'; '.join(problems)}"),
    )


def _check_one_per_complex(case: EvalCase, picks: list[dict]) -> CheckResult:
    ideas = case.state.get("independent_ideas") or {}
    offences: list[str] = []
    for side in ("long", "short"):
        chosen = {str(p.get("asset")) for p in _sided(picks, side)}
        for complex_ in (ideas.get(side) or {}).get("complexes", []) or []:
            overlap = sorted(chosen & set(complex_.get("members") or []))
            if len(overlap) > 1:
                offences.append(
                    f"{side}: took {', '.join(overlap)} from one complex "
                    f"(strongest is {complex_.get('strongest')})"
                )
    return CheckResult(
        label="one_per_complex",
        passed=not offences,
        detail="at most one name per correlated complex" if not offences else "; ".join(offences),
    )


def _check_every_pick_cited(book: dict, picks: list[dict]) -> CheckResult:
    """A pick counts as cited by its own citations, or by a top-level citation whose
    text or source names it — the schema allows either and `reason_picks` aggregates
    per-pick citations upward when the top-level array is missing."""
    top_level = book.get("citations") or []
    top_blob = " ".join(
        f"{c.get('source', '')} {c.get('text', '')}" for c in top_level
    ).lower()
    uncited = [
        str(p.get("asset"))
        for p in picks
        if not (p.get("citations") or []) and str(p.get("asset", "")).lower() not in top_blob
    ]
    return CheckResult(
        label="every_pick_cited",
        passed=not uncited,
        detail=(
            f"all {len(picks)} picks cited"
            if not uncited
            else f"{len(uncited)} uncited pick(s): {', '.join(uncited)}"
        ),
    )


def _check_citations_verify(case: EvalCase, book: dict) -> CheckResult:
    """Run the production guardrail against this book on this case's inputs."""
    state = fresh(case.state)
    state["picks"] = book.get("picks") or []
    state["citations"] = book.get("citations") or []
    state["book_view"] = book.get("book_view") or ""
    state["book_risks"] = book.get("book_risks") or []
    state["fallback_used"] = False
    state["error"] = None
    verified = verify_citations(state)
    ok = bool(verified.get("verified"))
    return CheckResult(
        label="citations_verify",
        passed=ok,
        detail="verify_citations accepted the book" if ok else str(verified.get("error") or "rejected"),
    )


def _check_net_tilt(check: NetTilt, picks: list[dict]) -> CheckResult:
    longs, shorts = len(_sided(picks, "long")), len(_sided(picks, "short"))
    lead = (shorts - longs) if check.side == "short" else (longs - shorts)
    return CheckResult(
        label=f"net_tilt:{check.side}",
        passed=lead >= check.margin,
        detail=(
            f"{longs} long / {shorts} short — {check.side} lead {lead:+d}, "
            f"needs >= {check.margin}"
        ),
    )


def _check_prose_number(check: ProseNumber, book: dict) -> CheckResult:
    quoted = prose_numbers_for(_all_prose(book), check.metric)
    if not quoted:
        return CheckResult(
            label=f"prose_number:{check.metric}",
            passed=True,
            detail=f"{check.metric} not quoted numerically in prose — nothing to reconcile",
        )
    hit = any(_matches_at_any_scale(q, check.expected, check.tolerance) for q in quoted)
    return CheckResult(
        label=f"prose_number:{check.metric}",
        passed=hit,
        detail=(
            f"prose quotes {check.metric} as {quoted}, expected {check.expected}"
            + ("" if hit else " — no quoted value matches at any unit scale")
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Entry points
# ─────────────────────────────────────────────────────────────────────────────

def score_check(case: EvalCase, book: dict[str, Any], check: Check) -> CheckResult:
    picks = book.get("picks") or []
    if isinstance(check, PicksInPool):
        result = _check_picks_in_pool(case, book, picks)
    elif isinstance(check, MaxPerSide):
        result = _check_max_per_side(check, picks)
    elif isinstance(check, SideCount):
        result = _check_side_count(check, picks)
    elif isinstance(check, OnePerComplex):
        result = _check_one_per_complex(case, picks)
    elif isinstance(check, EveryPickCited):
        result = _check_every_pick_cited(book, picks)
    elif isinstance(check, CitationsVerify):
        result = _check_citations_verify(case, book)
    elif isinstance(check, NetTilt):
        result = _check_net_tilt(check, picks)
    elif isinstance(check, ProseNumber):
        result = _check_prose_number(check, book)
    else:
        raise TypeError(f"no scorer for check type {type(check).__name__}")
    return replace(result, directional=is_directional(check))


def score_book(case: EvalCase, book: dict[str, Any]) -> CaseScore:
    """Evaluate one agent-produced book against one case."""
    picks = book.get("picks") or []
    return CaseScore(
        case_id=case.id,
        results=tuple(score_check(case, book, c) for c in case.checks),
        picks=len(picks),
        longs=len(_sided(picks, "long")),
        shorts=len(_sided(picks, "short")),
    )


def aggregate(scores: list[CaseScore]) -> dict[str, Any]:
    """Battery summary: case and check pass rates, plus which checks failed where."""
    checks_total = sum(len(s.results) for s in scores)
    checks_passed = sum(1 for s in scores for r in s.results if r.passed)
    per_check: dict[str, dict[str, int]] = {}
    for score in scores:
        for result in score.results:
            bucket = per_check.setdefault(result.label, {"passed": 0, "total": 0})
            bucket["total"] += 1
            bucket["passed"] += int(result.passed)
    return {
        "cases_passed": sum(1 for s in scores if s.passed),
        "cases_total": len(scores),
        "cases_structurally_passed": sum(1 for s in scores if s.structurally_passed),
        "checks_passed": checks_passed,
        "checks_total": checks_total,
        "per_check": per_check,
        "failures": [
            {
                "case": s.case_id,
                "check": r.label,
                "detail": r.detail,
                "directional": r.directional,
            }
            for s in scores
            for r in s.failures
        ],
    }
