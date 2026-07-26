"""
Tests for backend/services/sanctions_exposure.py (ADR-0096).

The claim this has to get right is the DIRECTION. A China-heavy position list looks like
sanctions risk; held short, escalation is a tailwind. Saying "exposed" without the side
would be worse than saying nothing, because a reader would assume the wrong sign.
"""

import os, sys
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.sanctions_exposure import (
    EXPOSURE_MECHANISM, NO_IDENTIFIED_CHANNEL, assess, describe,
)

# The live 2026-07-25 book.
LIVE = [
    {"asset": "SHY",  "direction": "long",  "weight": 0.0925},
    {"asset": "XLE",  "direction": "long",  "weight": 0.0613},
    {"asset": "SVXY", "direction": "long",  "weight": 0.0394},
    {"asset": "NUE",  "direction": "long",  "weight": 0.0448},
    {"asset": "UNH",  "direction": "long",  "weight": 0.0317},
    {"asset": "GDX",  "direction": "short", "weight": 0.0640},
    {"asset": "BABA", "direction": "short", "weight": 0.0868},
    {"asset": "NOC",  "direction": "short", "weight": 0.0473},
    {"asset": "ARKK", "direction": "short", "weight": 0.0329},
    {"asset": "PDD",  "direction": "short", "weight": 0.0925},
]
GROSS = 0.5933


def test_the_live_book_is_net_short_sanctions_risk():
    """The finding: 17.9pp of book weight in Chinese ADRs — 30% of GROSS — all short.

    The two units are easy to conflate and I conflated them: 17.9 is percentage points of
    book weight, while the share of gross exposure is 30.2%. The second is the one that
    describes concentration, and it is much larger. Both are asserted so neither can be
    reported as the other.
    """
    e = assess(LIVE, GROSS)
    assert {p["asset"] for p in e.positions} == {"BABA", "PDD"}
    assert e.long_weight == 0.0
    assert e.short_weight == pytest.approx(0.0868 + 0.0925)
    assert e.direction == "short"
    # 17.9pp of weight...
    assert e.exposed_gross == pytest.approx(0.1793)
    # ...but 30% of gross, which is the concentration figure.
    assert e.share_of_gross == pytest.approx(0.1793 / GROSS, rel=1e-3)
    assert 0.30 < e.share_of_gross < 0.31


def test_the_description_says_escalation_is_a_tailwind():
    """Naming the exposure without the side is worse than silence — a reader scanning a
    China-heavy list assumes the opposite sign."""
    text = describe(assess(LIVE, GROSS))
    assert "NET SHORT" in text
    assert "TAILWIND" in text
    assert "BABA" in text and "PDD" in text


def test_a_net_long_book_is_described_as_a_headwind():
    e = assess([{"asset": "FXI", "direction": "long", "weight": 0.10}], 0.10)
    assert e.direction == "long"
    assert "HEADWIND" in describe(e).upper()


def test_offsetting_sides_are_flat_at_book_level_but_still_live_per_name():
    e = assess(
        [{"asset": "BABA", "direction": "long", "weight": 0.05},
         {"asset": "PDD", "direction": "short", "weight": 0.05}],
        0.10,
    )
    assert e.direction == "flat"
    assert e.exposed_gross == 0.10        # gross exposure is NOT netted away
    assert "flat on net" in describe(e)


def test_a_book_with_no_exposed_jurisdiction_says_so_plainly():
    e = assess([{"asset": "XLE", "direction": "long", "weight": 0.1}], 0.1)
    assert e.direction == "none" and e.positions == []
    assert "no positions" in describe(e)


# ─── absence is stated, never inferred ───────────────────────────────────────

def test_an_unknown_ticker_is_unclassified_not_cleared():
    """Absent from both maps means "cannot judge", not "not exposed" — the known/unknown
    split ADR-0094 and the freshness verdict work both landed on."""
    e = assess([{"asset": "NEWTICKER", "direction": "long", "weight": 0.1}], 0.1)
    assert e.unclassified == ["NEWTICKER"]
    assert e.direction == "none"
    assert "unknown, not absent" in describe(e)


def test_a_position_with_an_unreadable_side_is_unclassified_not_assumed_long():
    """Guessing `long` would invert the book's stated posture on a sanctions-exposed name."""
    e = assess([{"asset": "BABA", "direction": None, "weight": 0.09}], 0.09)
    assert e.unclassified == ["BABA"]
    assert e.long_weight == 0.0 and e.short_weight == 0.0


def test_a_jurisdiction_with_no_channel_is_cleared_rather_than_unclassified():
    """"We checked and found none" must be distinguishable from "we never looked"."""
    assert "US" in NO_IDENTIFIED_CHANNEL
    e = assess([{"asset": "SHY", "direction": "long", "weight": 0.1}], 0.1)
    assert e.unclassified == []


def test_share_of_gross_is_none_on_an_empty_book_not_zero():
    """A share of nothing is unmeasurable (ADR-0066)."""
    assert assess([], 0.0).share_of_gross is None
    assert assess(LIVE, 0.0).share_of_gross is None


def test_malformed_weights_are_skipped_rather_than_coerced():
    for bad in (None, "0.09", True, -0.05, 0.0):
        e = assess([{"asset": "BABA", "direction": "short", "weight": bad}], 0.09)
        assert e.exposed_gross == 0.0, f"{bad!r} should not count as a weight"


def test_every_mechanism_is_a_named_channel_not_a_vibe():
    """A reader must be able to disagree with a specific claim. "risky" is not one."""
    for juris, mech in EXPOSURE_MECHANISM.items():
        assert len(mech) > 40, juris
        assert any(k in mech for k in ("HFCAA", "Entity List", "index membership", "restrictions"))


def test_exposed_and_cleared_jurisdictions_do_not_overlap():
    assert not (set(EXPOSURE_MECHANISM) & set(NO_IDENTIFIED_CHANNEL))
