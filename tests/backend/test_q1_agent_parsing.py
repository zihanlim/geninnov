"""LLM response cleaning — the seam where a budget failure masquerades as bad JSON."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.q1_agent import _strip_reasoning_and_fences as strip


def test_strips_a_closed_reasoning_block():
    assert strip('<think>weighing the options</think>{"picks": []}') == '{"picks": []}'


def test_strips_an_UNCLOSED_reasoning_block():
    """MiniMax-M2/M3 emit <think> BEFORE the answer, out of the same token budget.

    When reasoning exhausts the budget the response is an unterminated <think> and
    no answer at all — observed live on 2026-07-24, where reason_picks logged
    "raw=0 chars" on consecutive attempts and a direct probe reproduced it: HTTP 200,
    base_resp status 0, content consisting solely of an unclosed <think>. Leaving the
    fragment in produced a JSON parse error that described the wrong problem.
    """
    assert strip("<think>still reasoning when the ceiling hit") == ""
    assert strip('<think>reasoning\nmore reasoning\n{"picks": [1]}') == ""


def test_leaves_a_clean_payload_alone():
    assert strip('{"picks": [{"asset": "TLT"}]}') == '{"picks": [{"asset": "TLT"}]}'


def test_strips_markdown_fences_including_an_unclosed_one():
    assert strip('```json\n{"a": 1}\n```') == '{"a": 1}'
    assert strip('```json\n{"a": 1}') == '{"a": 1}'
