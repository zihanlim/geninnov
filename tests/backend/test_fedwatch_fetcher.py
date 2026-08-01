"""Tests for the FedWatch fetcher.

The fetcher's contract: a list of (meeting_date, action,
probability_pct) rows. Network is not exercised in tests; instead
we feed pre-parsed JSON payloads through `_parse_json_payload` and
assert on the output shape.
"""
import sys
from datetime import date

import pytest

sys.path.insert(0, "backend/data")

from fedwatch_fetcher import (  # noqa: E402
    _action_from_label,
    _parse_json_payload,
    _parse_meeting_date,
    rows_to_macro_indicators,
    sanity_check,
)


# ---- _action_from_label -------------------------------------------------

def test_action_from_label_hold() -> None:
    assert _action_from_label("Unchanged") == "hold"
    assert _action_from_label("No change") == "hold"
    assert _action_from_label("0.00-0.25 unchanged") == "hold"


def test_action_from_label_hike_25() -> None:
    assert _action_from_label("0-0.25 increase") == "hike_25"


def test_action_from_label_hike_50() -> None:
    assert _action_from_label("25-50 increase") == "hike_50"


def test_action_from_label_cut_25() -> None:
    assert _action_from_label("0-0.25 decrease") == "cut_25"


def test_action_from_label_cut_50() -> None:
    assert _action_from_label("25-50 decrease") == "cut_50"


def test_action_from_label_unrecognised_returns_none() -> None:
    assert _action_from_label("something we don't know") is None


# ---- _parse_meeting_date -----------------------------------------------

def test_parse_meeting_date_iso() -> None:
    assert _parse_meeting_date({"meetingDate": "2026-09-17"}) == date(2026, 9, 17)


def test_parse_meeting_date_unix_ms() -> None:
    """A Unix-ms timestamp. We don't pin a specific date (timezone
    edge cases make the test fragile) — only that the parse returns
    a date object."""
    d = _parse_meeting_date({"date": 1787011200000})
    assert isinstance(d, date)
    assert d.year == 2026
    assert d.month in (8, 9)  # timezone of the host shifts the date


def test_parse_meeting_date_missing_returns_none() -> None:
    assert _parse_meeting_date({}) is None


def test_parse_meeting_date_bad_iso_returns_none() -> None:
    assert _parse_meeting_date({"meetingDate": "not a date"}) is None


# ---- _parse_json_payload -----------------------------------------------

def test_parse_shape_1_meeting_probabilities() -> None:
    payload = {
        "meetingProbabilities": [
            {
                "meetingDate": "2026-09-17",
                "outrights": {
                    "Unchanged": 0.43,
                    "0-0.25 increase": 0.57,
                    "0-0.25 decrease": 0.0,
                },
            }
        ]
    }
    rows = _parse_json_payload(payload)
    assert len(rows) == 3
    # The 0.0 probability is still emitted (L5 sees "0%" not absence).
    actions = {r["action"] for r in rows}
    assert actions == {"hold", "hike_25", "cut_25"}
    probs = {r["action"]: r["probability_pct"] for r in rows}
    assert probs["hold"] == 43.0
    assert probs["hike_25"] == pytest.approx(57.0, abs=1e-9)
    assert probs["cut_25"] == 0.0


def test_parse_shape_2_nested_meetings() -> None:
    payload = {
        "meetings": [
            {
                "date": "2026-09-17",
                "outrights": [
                    {"label": "Unchanged", "probability": 0.40},
                    {"label": "0-0.25 increase", "probability": 0.60},
                ],
            }
        ]
    }
    rows = _parse_json_payload(payload)
    assert len(rows) == 2
    assert rows[0]["meeting_date"] == date(2026, 9, 17)
    assert rows[0]["action"] == "hold"
    assert rows[0]["probability_pct"] == 40.0


def test_parse_unknown_shape_returns_empty() -> None:
    assert _parse_json_payload({"completely": "unknown"}) == []


def test_parse_skips_meetings_with_no_date() -> None:
    payload = {
        "meetingProbabilities": [
            {"meetingDate": "2026-09-17", "outrights": {"Unchanged": 0.5}},
            {"outrights": {"Unchanged": 0.5}},  # no date
        ]
    }
    rows = _parse_json_payload(payload)
    assert len(rows) == 1
    assert rows[0]["meeting_date"] == date(2026, 9, 17)


def test_parse_skips_unrecognised_actions() -> None:
    payload = {
        "meetingProbabilities": [
            {
                "meetingDate": "2026-09-17",
                "outrights": {
                    "Unchanged": 0.5,
                    "what is this even": 0.5,
                },
            }
        ]
    }
    rows = _parse_json_payload(payload)
    assert len(rows) == 1
    assert rows[0]["action"] == "hold"


# ---- rows_to_macro_indicators -----------------------------------------

def test_rows_to_macro_indicators_shape() -> None:
    rows = [
        {
            "meeting_date": date(2026, 9, 17),
            "action": "hold",
            "probability_pct": 43.0,
        },
        {
            "meeting_date": date(2026, 9, 17),
            "action": "hike_25",
            "probability_pct": 57.0,
        },
    ]
    out = rows_to_macro_indicators(rows)
    assert out[0]["series_id"] == "FEDWATCH_MEETING_2026-09-17_PROB_HOLD"
    assert out[0]["value"] == 43.0
    assert out[0]["unit"] == "pct"
    assert out[1]["series_id"] == "FEDWATCH_MEETING_2026-09-17_PROB_HIKE_25"


# ---- sanity_check ------------------------------------------------------

def test_sanity_check_passes_when_probs_sum_to_100() -> None:
    rows = [
        {"meeting_date": date(2026, 9, 17), "action": "hold", "probability_pct": 50.0},
        {"meeting_date": date(2026, 9, 17), "action": "hike_25", "probability_pct": 50.0},
    ]
    assert sanity_check(rows) is True


def test_sanity_check_fails_when_probs_dont_sum_to_100() -> None:
    rows = [
        {"meeting_date": date(2026, 9, 17), "action": "hold", "probability_pct": 30.0},
        {"meeting_date": date(2026, 9, 17), "action": "hike_25", "probability_pct": 50.0},
    ]
    assert sanity_check(rows) is False


def test_sanity_check_passes_on_empty() -> None:
    """An empty fetcher result trivially passes."""
    assert sanity_check([]) is True
