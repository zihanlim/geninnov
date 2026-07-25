"""L5 acceptance eval — does the agent still reason well enough to publish?

The citation guardrail (ADR-0012, ADR-0019, ADR-0027) answers a narrow question:
is every number the model cited actually one of the numbers it was shown? It is a
fabrication detector. It cannot tell you whether the book is any *good* — ADR-0049
records the case that made this concrete, where a thesis miscounted the pool in
prose and still wore a VERIFIED badge, because the claim never entered the citation
list the guardrail inspects.

`scripts/replication_test.py` answers a second question — does the same frozen input
produce the same book twice? — and that is variance, not correctness. A model that
returns the same wrong book three times scores perfectly on replication.

This package answers the third: on a frozen input whose right answer is known, does
the agent get it right? That matters most because `q1_agent._select_provider` picks
whichever of MiniMax / Anthropic / Gemini has a key present, silently. A missing
`MINIMAX_API_KEY` or an upstream deprecation changes who writes the book with no
signal anywhere. This is the gate that turns that into a failing test.

    from backend.eval import STANDARD_BATTERY, run_battery, canned_agent_fn

    result = run_battery(STANDARD_BATTERY, agent_fn=canned_agent_fn)
    assert result.all_passed

CI runs the battery against `canned_agent_fn`, which never calls an LLM: that proves
the *scorer* is wired correctly and costs nothing. `scripts/run_eval.py` runs the
same battery against a real provider through `reason_picks`, which is what you run
before changing `LLM_PROVIDER`, the prompt, or a model id.
"""
from .battery import (
    STANDARD_BATTERY,
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
)
from .runner import BatteryResult, canned_agent_fn, drifting_agent_fn, llm_agent_fn, run_battery
from .scorer import CaseScore, CheckResult, aggregate, score_book

__all__ = [
    "STANDARD_BATTERY",
    "BatteryResult",
    "CaseScore",
    "Check",
    "CheckResult",
    "CitationsVerify",
    "EvalCase",
    "EveryPickCited",
    "MaxPerSide",
    "NetTilt",
    "OnePerComplex",
    "PicksInPool",
    "ProseNumber",
    "SideCount",
    "aggregate",
    "canned_agent_fn",
    "drifting_agent_fn",
    "llm_agent_fn",
    "run_battery",
    "score_book",
]
