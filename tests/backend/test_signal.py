"""The signal must not carry a mandate.

The whole point of this payload is what it EXCLUDES, and an absence is invisible in
code review — nobody notices the field that isn't there until a consumer starts
relying on it. So the exclusion is asserted, including against a deliberately
hostile input: a fully sized book handed to a function that is only ever supposed to
see an unsized one.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.signal import (  # noqa: E402
    FORBIDDEN_FIELDS,
    extract_signal,
    signal_payload,
)

UNSIZED_PICKS = [
    {
        "asset": "VRT",
        "direction": "long",
        "theme": "AI Capex",
        "theme_id": "t-1",
        "thesis": "Power and cooling is the bottleneck.",
        "catalysts": ["Q3 orders"],
        "risk": "A capex pause.",
        "counter_thesis": "Hyperscalers self-supply.",
        "time_horizon": "6-12 months",
        "citations": [{"source": "macro.vix", "text": "18.2"}],
    },
    {
        "asset": "BABA",
        "direction": "short",
        "theme": "China Growth",
        "theme_id": "t-2",
        "thesis": "A price downtrend.",
    },
]

CANDIDATES = [
    {"asset": "VRT", "edge_score": 0.41, "conviction": 12.6, "vol": 0.0325},
    {"asset": "BABA", "edge_score": -0.41, "conviction": 15.8, "vol": 0.0259},
]


class TestTheSignalIsMandateFree:
    def test_carries_no_sizing_field(self):
        rows = extract_signal(UNSIZED_PICKS, CANDIDATES)
        for row in rows:
            for field in FORBIDDEN_FIELDS:
                assert field not in row, f"{field} leaked into the signal"

    def test_strips_sizing_even_from_an_already_sized_book(self):
        # The hostile case. size_positions runs AFTER this in the pipeline, but a
        # future caller could wire it the wrong way round, and the failure would be
        # silent: a consumer would receive weights denominated in a mandate that is
        # not theirs and have no way to tell.
        sized = [
            dict(
                UNSIZED_PICKS[0],
                weight=0.095,
                signed_weight=0.095,
                notional=9_500_000.0,
                total_capital=100_000_000.0,
            )
        ]
        row = extract_signal(sized, CANDIDATES)[0]
        for field in FORBIDDEN_FIELDS:
            assert field not in row
        # The research survives the strip; only the mandate is removed.
        assert row["thesis"] == "Power and cooling is the bottleneck."
        assert row["conviction"] == 12.6

    def test_conviction_is_carried_because_it_is_a_ratio(self):
        # This is the one number a consumer genuinely needs, and it is mandate-free
        # by construction: |edge| / vol is identical at $100M and at $5bn.
        rows = extract_signal(UNSIZED_PICKS, CANDIDATES)
        assert rows[0]["conviction"] == 12.6
        assert rows[1]["conviction"] == 15.8


class TestAbsenceIsNotZero:
    def test_a_name_with_no_candidate_row_gets_none_not_zero(self):
        rows = extract_signal([{"asset": "NEW", "direction": "long"}], CANDIDATES)
        assert rows[0]["edge_score"] is None
        assert rows[0]["conviction"] is None
        assert rows[0]["vol"] is None

    def test_unparseable_score_is_none_not_zero(self):
        rows = extract_signal(
            [{"asset": "X", "direction": "long"}],
            [{"asset": "X", "edge_score": "not-a-number", "conviction": None}],
        )
        assert rows[0]["edge_score"] is None
        assert rows[0]["conviction"] is None

    def test_nan_is_none(self):
        rows = extract_signal(
            [{"asset": "X", "direction": "long"}],
            [{"asset": "X", "edge_score": float("nan")}],
        )
        assert rows[0]["edge_score"] is None


class TestShape:
    def test_drops_a_pick_with_no_ticker(self):
        rows = extract_signal([{"direction": "long", "thesis": "..."}], [])
        assert rows == []

    def test_preserves_agent_ordering(self):
        rows = extract_signal(UNSIZED_PICKS, CANDIDATES)
        assert [r["asset"] for r in rows] == ["VRT", "BABA"]

    def test_empty_in_empty_out(self):
        assert extract_signal([], []) == []
        assert extract_signal(None, None) == []

    def test_payload_states_its_own_contract(self):
        # The MCP consumer reads the payload, never the docstring.
        payload = signal_payload("2026-07-28", UNSIZED_PICKS, CANDIDATES, lens="multi_asset")
        assert payload["mandate_free"] is True
        assert payload["count"] == 2
        assert payload["lens"] == "multi_asset"
        assert "own mandate" in payload["note"]
