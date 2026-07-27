"""
Bar 2's source: federal contract awards attributed to names the book holds.

The fetch is the easy part. What is worth testing is the MAPPING, because it is a
judgement — the same kind `COT_CONTRACTS` carries — and the way it fails is by being
generous: attributing a sub-tier award to a prime would inflate the coverage figure that
makes every other number here meaningful. That is the "miners are not the metal" refusal
(ADR-0097) in a different market.

Network is never touched: `summarise` is pure over rows.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.data.defense_awards import (  # noqa: E402
    MAX_PAGE_LIMIT,
    attribute,
    summarise,
    unattributed_reason,
)


def _award(recipient, amount):
    return {"Recipient Name": recipient, "Award Amount": amount}


def test_a_subsidiary_is_its_parent():
    """Sikorsky's revenue IS Lockheed's. Attributing it is correct, not generous."""
    assert attribute("SIKORSKY AIRCRAFT CORP").ticker == "LMT"
    assert attribute("LOCKHEED MARTIN CORPORATION").ticker == "LMT"
    assert attribute("PRATT & WHITNEY DIVISION").ticker == "RTX"
    assert attribute("RAYTHEON COMPANY").ticker == "RTX"


def test_an_unmapped_recipient_is_not_bucketed_into_the_nearest_plausible_ticker():
    """The failure mode is generosity. A defence prime the book does not hold must not
    quietly become one it does."""
    assert attribute("ELECTRIC BOAT CORPORATION") is None
    assert attribute("THE BOEING COMPANY") is None
    assert attribute("SOME UNKNOWN LLC") is None


def test_every_refusal_carries_a_reason():
    assert "General Dynamics" in unattributed_reason("ELECTRIC BOAT CORPORATION")
    assert "not in this universe" in unattributed_reason("THE BOEING COMPANY")
    # And an unrecognised name still gets a sentence rather than a silent drop.
    assert unattributed_reason("WIDGETS INC")


def test_coverage_is_reported_and_bounded_by_the_book():
    """A reading about a name nobody owns is trivia, and counting it would inflate the
    coverage figure the rest depends on."""
    rows = [
        _award("LOCKHEED MARTIN CORP", 100.0),
        _award("SIKORSKY AIRCRAFT CORP", 50.0),
        _award("THE BOEING COMPANY", 400.0),      # not held
        _award("NORTHROP GRUMMAN SYSTEMS", 25.0),  # mapped but not in this book
    ]
    out = summarise(rows, held_assets=["LMT", "XLE"])

    assert out["held_names_with_awards"] == ["LMT"]
    assert out["coverage_count"] == 1
    # Sikorsky folded into LMT, and both recipient spellings are kept for the reader.
    assert out["readings"]["LMT"]["total_obligated"] == 150.0
    assert out["readings"]["LMT"]["award_count"] == 2
    assert len(out["readings"]["LMT"]["recipients"]) == 2

    # Attributed share is against everything seen, not against the attributed slice —
    # otherwise one mapped award in a thin window reads as "100% covered".
    assert out["attributed_share"] == 150.0 / 575.0


def test_a_mapped_name_the_book_does_not_hold_says_exactly_that():
    rows = [_award("NORTHROP GRUMMAN SYSTEMS", 25.0)]
    out = summarise(rows, held_assets=["LMT"])
    assert out["coverage_count"] == 0
    reasons = [b["reason"] for b in out["unattributed"]]
    assert any("maps to NOC" in r and "does not hold" in r for r in reasons)


def test_the_live_book_case_zero_coverage_is_a_finding_not_an_error():
    """On 2026-07-27 the book held no defence name at all — LMT/NOC/RTX are in the
    universe but the optimizer did not select them. The summary must say so rather than
    read as a failed fetch."""
    rows = [_award("LOCKHEED MARTIN CORP", 100.0)]
    out = summarise(rows, held_assets=["XLE", "SVXY", "BABA"])
    assert out["coverage_count"] == 0
    assert out["held_names_with_awards"] == []
    assert out["awards_examined"] == 1, "we DID look — this is coverage, not a fetch failure"
    assert out["attributed_share"] == 0.0


def test_empty_and_malformed_rows_do_not_raise():
    assert summarise([], ["LMT"])["coverage_count"] == 0
    out = summarise([{"Recipient Name": None, "Award Amount": "not a number"}], ["LMT"])
    assert out["coverage_count"] == 0


def test_the_page_limit_is_clamped_in_the_request_body():
    """Measured: 150 -> HTTP 422 with no explanatory body, 100 -> 100 rows. An unclamped
    caller gets an opaque failure that reads like the service being down."""
    source = (
        Path(__file__).resolve().parents[2] / "backend" / "data" / "defense_awards.py"
    ).read_text(encoding="utf-8")
    assert "min(int(limit), MAX_PAGE_LIMIT)" in source
    assert MAX_PAGE_LIMIT == 100
