"""A stall may be retried once. Never twice.

WHAT WAS WRONG
--------------
`reason_picks` refuses to retry its own timeout — ADR-0052, because three attempts
at `LLM_TIMEOUT_SECONDS` is 2700s and a 45-minute stalled run is exactly what was
measured in production.

That guard was defeated one level up. A timeout sets ``state["error"]``, and
`run_q1_agent`'s retry loop retried on ANY error, so a run could still reach
3 x 900s. The 2026-07-29 log shows both halves on consecutive lines:

    [reason_picks] LLM TIMED OUT (attempt 1): ... — not retrying; a stall is not
                   fixed by asking again.
    [run_q1_agent] Retrying reason_picks (attempt 2/3)...

Neither line is wrong about its own function, and together they describe a system
that does the opposite of what it says.

WHY ONE RETRY AND NOT ZERO
--------------------------
ADR-0052 was right about the cost and wrong about the remedy. The same pattern has
now been observed at TWO different ceilings — the module comment records "timed out
at 420 on attempt 1 and succeeded on attempt 2", and 2026-07-29 timed out at 900 on
attempt 1 and succeeded on attempt 2, producing a real ten-pick book with 45
citations. Raising the ceiling did not stop attempt 1 stalling. The retry is what
rescues the book; without it that run publishes an empty-thesis fallback.

So the budget is two deadlines, not three and not one.

WHY THE LOOP IS EXTRACTED
-------------------------
`run_q1_agent` takes ten arguments and persists to Supabase, so nothing ever drove
this loop — which is precisely why the bypass survived a green suite. The first
version of this test called `run_q1_agent()` with no arguments and asserted on a
call count of zero, proving nothing. The loop is now its own function and this
exercises the real one.
"""
from __future__ import annotations

from backend.services.q1_agent import (
    MAX_REASON_RETRIES,
    MAX_TIMEOUT_RETRIES,
    reason_and_verify_with_retries,
)

TIMEOUT_ERR = "LLM timeout: LLM call exceeded 900s wall clock — using fallback"
CITE_ERR = "Citations empty — using fallback"


class _Reasoner:
    """Scripts each reason_picks outcome and counts invocations."""

    def __init__(self, outcomes: list[str]):
        self.outcomes = outcomes
        self.n = 0

    def __call__(self, state: dict) -> dict:
        outcome = self.outcomes[min(self.n, len(self.outcomes) - 1)]
        self.n += 1
        if outcome == "timeout":
            state["error"], state["verified"] = TIMEOUT_ERR, False
        elif outcome == "badcite":
            state["error"], state["verified"] = CITE_ERR, False
        else:
            state["error"], state["verified"] = None, True
        return state


def _run(outcomes: list[str]) -> tuple[_Reasoner, dict]:
    """`outcomes[0]` is the FIRST attempt, which the caller makes before the loop."""
    reason = _Reasoner(outcomes)
    state: dict = {"retries": 0}
    state = reason(state)                      # the pre-loop attempt run_q1_agent makes
    out = reason_and_verify_with_retries(state, reason, lambda s: s)
    return reason, out


class TestTheTimeoutBudget:
    def test_a_stall_costs_two_deadlines_not_three(self):
        """The bug allowed three. ADR-0052's 45-minute worst case needs three."""
        reason, _ = _run(["timeout", "timeout", "timeout"])
        assert reason.n == 2

    def test_a_timeout_then_success_keeps_the_book(self):
        """The 2026-07-29 shape. Removing the retry loses a real ten-pick book."""
        reason, state = _run(["timeout", "ok"])
        assert reason.n == 2
        assert state["verified"] is True

    def test_the_retry_is_not_spent_before_it_is_needed(self):
        reason, state = _run(["ok"])
        assert reason.n == 1
        assert state["verified"] is True

    def test_the_second_stall_falls_back_rather_than_looping(self):
        _, state = _run(["timeout", "timeout"])
        assert state["verified"] is False
        assert state["error"] == TIMEOUT_ERR


class TestNonTimeoutFailuresAreUnchanged:
    """ADR-0052's reasoning only ever applied to stalls.

    A citation failure is worth retrying — the model can produce better output for
    the same prompt — and that budget is deliberately untouched.
    """

    def test_citation_failures_keep_the_full_budget(self):
        reason, _ = _run(["badcite", "badcite", "badcite"])
        assert reason.n == MAX_REASON_RETRIES + 1  # 3

    def test_a_citation_failure_does_not_consume_the_timeout_retry(self):
        """The budgets are separate; neither silently eats the other."""
        reason, state = _run(["badcite", "timeout", "ok"])
        assert reason.n == 3
        assert state["verified"] is True

    def test_a_timeout_does_not_shorten_the_citation_budget(self):
        reason, _ = _run(["timeout", "badcite", "badcite"])
        assert reason.n == 3


class TestTheConstants:
    def test_one_timeout_retry(self):
        assert MAX_TIMEOUT_RETRIES == 1

    def test_the_timeout_budget_is_strictly_smaller(self):
        """If these were equal the guard would be inert — the shape of the bug."""
        assert MAX_TIMEOUT_RETRIES < MAX_REASON_RETRIES

    def test_only_a_real_timeout_trips_the_stricter_budget(self):
        """Matched on the prefix `reason_picks` actually writes. A message change
        would silently restore the 3 x 900s worst case, so it is asserted."""
        reason, _ = _run(["badcite", "badcite", "badcite"])
        assert reason.n == 3
        reason, _ = _run(["timeout", "timeout", "timeout"])
        assert reason.n == 2
