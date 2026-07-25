"""The battery: what we assert about a book, and the cases that assert it.

This module is **data**. Every check is an inert frozen dataclass; the logic that
evaluates one lives in `scorer.py`. Keeping them apart is what lets a case be read
and argued with by someone who does not want to read a scoring function — which is
the point, because the directional cases below are judgment calls that deserve to be
argued with.

Two kinds of expectation, and the difference matters:

**Structural** — `PicksInPool`, `MaxPerSide`, `SideCount`, `OnePerComplex`,
`EveryPickCited`, `CitationsVerify`. These encode constraints the system already
claims to enforce (ADR-0014 hard candidate filter, ADR-0038 per-asset direction,
ADR-0048 independent ideas, ADR-0012 citation guardrail). A failure is a defect, not
a difference of opinion. These are the half of the battery that can gate CI.

**Directional** — `NetTilt`, and any `SideCount` used to express "should have
found more here". These are curated priors: a fixture is built so one answer is
clearly better *on the inputs given*, and the check asserts the agent finds it. They
are the more valuable half and the less certain half. im-Jarvis's equivalent battery
carries the same caveat in its own docstring — Claude-curated, hand-verified, and
reviewed by a human before it gates anything. Treat a directional failure as a
prompt to go read the book, not as an automatic bug.

`ProseNumber` sits between the two. It is structural in that a wrong number is
unambiguously wrong, but it targets a surface nothing else checks: ADR-0049 records
a published thesis that miscounted the pool in prose while carrying a VERIFIED
badge, because `verify_citations` reads the citation array and never the thesis.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Union

from .fixtures import (
    BENIGN_EARLY_CYCLE,
    CRISIS_DISTINCTIVE_NUMBERS,
    LONG_ONLY_POOL,
    THIN_SHORT_POOL,
    WIDE_CREDIT_RISK_OFF,
)


# ─────────────────────────────────────────────────────────────────────────────
# Checks
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class PicksInPool:
    """Every pick's (asset, direction) appears in the candidate table.

    ADR-0014 makes the candidate set a hard filter and ADR-0038 attaches direction
    to the asset rather than to the book, so shorting a name the pool offered long
    is as much a violation as inventing the name outright.
    """
    label: str = "picks_in_pool"


@dataclass(frozen=True, slots=True)
class MaxPerSide:
    """No more than `limit` picks on either side — the Q1 book is 5 + 5."""
    limit: int = 5
    label: str = "max_per_side"


@dataclass(frozen=True, slots=True)
class SideCount:
    """Bound the number of picks on one side.

    `at_most` is structural when it encodes pool depth (you cannot take six ideas
    from a pool holding two). `at_least` is directional — it asserts the agent
    should have found conviction it had the material for.
    """
    side: str
    at_most: int | None = None
    at_least: int | None = None
    label: str = "side_count"


@dataclass(frozen=True, slots=True)
class OnePerComplex:
    """At most one pick from each correlated complex named in POOL DEPTH.

    ADR-0048: five gold miners are one bet. The prompt states the complexes and
    names the strongest member of each; taking two of them is double-counting an
    idea, not diversifying.
    """
    label: str = "one_per_complex"


@dataclass(frozen=True, slots=True)
class EveryPickCited:
    """Each pick carries at least one citation, top-level or its own.

    `reason_picks` already aggregates per-pick citations up into the summary array
    when a model omits the top level, so this checks the union of both.
    """
    label: str = "every_pick_cited"


@dataclass(frozen=True, slots=True)
class CitationsVerify:
    """The real guardrail passes.

    This runs `q1_agent.verify_citations` against the fixture rather than
    reimplementing it, so the battery cannot drift from the production check. A
    failure here means the book would have been rejected and retried in a live run.
    """
    label: str = "citations_verify"


@dataclass(frozen=True, slots=True)
class NetTilt:
    """The book leans to `side` by pick count.

    Count, not weight: `reason_picks` returns unsized picks and `size_positions`
    runs downstream, so there is no weight to net at this point in the pipeline.
    `margin` is how many more picks the favoured side needs.
    """
    side: str
    margin: int = 1
    label: str = "net_tilt"


@dataclass(frozen=True, slots=True)
class ProseNumber:
    """A number the prose attributes to `metric` must match `expected`.

    Absent from the prose is a pass, not a failure — the agent is not obliged to
    quote any particular figure. This catches misquotation, not omission. See
    `scorer.METRIC_SYNONYMS` for how a label is located in free text.
    """
    metric: str
    expected: float
    tolerance: float = 0.02
    label: str = "prose_number"


Check = Union[
    PicksInPool, MaxPerSide, SideCount, OnePerComplex,
    EveryPickCited, CitationsVerify, NetTilt, ProseNumber,
]


# ─────────────────────────────────────────────────────────────────────────────
# Cases
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class EvalCase:
    """One frozen input plus everything we assert about the book it should produce.

    `rationale` is not decoration — it says which regression the case exists to
    catch, so a future reader deciding whether a failure matters has the original
    intent rather than having to infer it from the assertions.
    """
    id: str
    rationale: str
    state: dict[str, Any]
    checks: tuple[Check, ...] = field(default_factory=tuple)


STANDARD_BATTERY: tuple[EvalCase, ...] = (
    EvalCase(
        id="wide_credit_risk_off",
        rationale=(
            "Late-cycle, risk-off, HY OAS 620bp, and every short candidate carries a "
            "stronger |trade_score| than every long. Both sides hold five independent "
            "ideas, so nothing forces the answer except the data. A net-long book here "
            "means the agent is not reading the candidate table."
        ),
        state=WIDE_CREDIT_RISK_OFF,
        checks=(
            PicksInPool(),
            MaxPerSide(5),
            EveryPickCited(),
            CitationsVerify(),
            NetTilt(side="short", margin=1),
            SideCount(side="short", at_least=3),
        ),
    ),
    EvalCase(
        id="benign_early_cycle",
        rationale=(
            "The mirror image, and the reason it exists: a model that has learned "
            "'sound cautious' scores well on the risk-off case for the wrong reason. "
            "Tight spreads, VIX 13, contango, and the conviction is all on the long "
            "side. The short pool holds two names, so a five-short book is also wrong."
        ),
        state=BENIGN_EARLY_CYCLE,
        checks=(
            PicksInPool(),
            MaxPerSide(5),
            EveryPickCited(),
            CitationsVerify(),
            NetTilt(side="long", margin=1),
            SideCount(side="short", at_most=2),
        ),
    ),
    EvalCase(
        id="thin_short_pool",
        rationale=(
            "Nine short candidates, two ideas: five gold names and four China names. "
            "ADR-0048's exact case. The candidate table looks deep and the POOL DEPTH "
            "block says it is not. Taking two gold miners is double-counting one bet."
        ),
        state=THIN_SHORT_POOL,
        checks=(
            PicksInPool(),
            MaxPerSide(5),
            EveryPickCited(),
            CitationsVerify(),
            OnePerComplex(),
            SideCount(side="short", at_most=2),
        ),
    ),
    EvalCase(
        id="long_only_pool",
        rationale=(
            "No short candidate exists. The only correct number of shorts is zero. "
            "ADR-0014 makes this a hard filter, but the prompt also asks for a "
            "long-short book — the case checks the filter wins over the framing."
        ),
        state=LONG_ONLY_POOL,
        checks=(
            PicksInPool(),
            MaxPerSide(5),
            EveryPickCited(),
            CitationsVerify(),
            SideCount(side="short", at_most=0),
            SideCount(side="long", at_least=2),
        ),
    ),
    EvalCase(
        id="crisis_distinctive_numbers",
        rationale=(
            "Every headline number is deliberately odd — VIX 41.70, HY OAS 835, 10y "
            "3.18 — so a figure in the prose either came from the snapshot or was "
            "invented. Targets the ADR-0049 gap: the guardrail reads citations, not "
            "the thesis, so prose is where a wrong number survives to publication."
        ),
        state=CRISIS_DISTINCTIVE_NUMBERS,
        checks=(
            PicksInPool(),
            MaxPerSide(5),
            EveryPickCited(),
            CitationsVerify(),
            ProseNumber(metric="vix", expected=41.70),
            ProseNumber(metric="hy_oas", expected=835.0),
            ProseNumber(metric="dgs10", expected=3.18),
            SideCount(side="short", at_most=2),
        ),
    ),
)


def is_directional(check: Check) -> bool:
    """True when a failure is a difference of opinion rather than a defect.

    The split is mechanical, and it follows from what each check can know. A
    `NetTilt` asserts the agent should have leaned a particular way — defensible on
    the fixture's numbers, but still a view. A `SideCount` with `at_least` asserts it
    should have found more conviction, which is the same kind of claim. Everything
    else — pool membership, side caps, complex discipline, citations, and any
    `at_most` bound, which encodes how many ideas the pool actually holds — is a
    constraint the system already promises to honour.

    `scripts/run_eval.py` gates its exit code on the structural half only, so a
    disagreement about market judgment cannot fail a build while a broken guardrail
    still does.
    """
    if isinstance(check, NetTilt):
        return True
    if isinstance(check, SideCount):
        return check.at_least is not None
    return False


def case_by_id(case_id: str) -> EvalCase:
    for case in STANDARD_BATTERY:
        if case.id == case_id:
            return case
    known = ", ".join(c.id for c in STANDARD_BATTERY)
    raise KeyError(f"no eval case {case_id!r}; known cases: {known}")
