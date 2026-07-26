"""
Tests for backend/data/cot_fetcher.py + backend/services/positioning_crowding.py (ADR-0097).

Two claims have to be right, and they fail in opposite ways.

The first is COVERAGE. COT sees two of ten positions in the live book. A panel that reported
only a crowding verdict would let a reader believe the whole book had been checked, so the
coverage number is the headline and `crowded_share <= coverage_share` is an invariant, not an
observation.

The second is SIDE. SVXY is an inverse product: long SVXY is short volatility. Matching its
stated direction against the VIX speculator reading without the flip gives a verdict that is
exactly backwards — and a wrong side, unlike a wrong number, has no symptom a reader could
catch. The flip therefore gets a test that fails if it is ever removed.
"""

import os, sys
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.data.cot_fetcher import (
    COT_CONTRACTS, MIN_WEEKS, CotReading, cot_index, unmapped_reason,
)
from backend.services.positioning_crowding import (
    CROWDED_HIGH, CROWDED_LOW, assess, crowded_side, describe, effective_side, to_row,
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


def reading(asset: str, index, as_of="2026-07-21", net=-1000):
    cm = COT_CONTRACTS[asset]
    return CotReading(code=cm.code, name=cm.name, net_spec=net, index=index,
                      as_of=as_of, weeks=156, low=-2000, high=500)


# ---------------------------------------------------------------------------
# The inverse flip
# ---------------------------------------------------------------------------

def test_long_svxy_is_short_volatility():
    """The one mapping in the book where stated side != side in the underlying."""
    assert COT_CONTRACTS["SVXY"].inverse is True
    assert effective_side("long", inverse=True) == "short"
    assert effective_side("short", inverse=True) == "long"


def test_flip_is_not_applied_to_ordinary_products():
    assert COT_CONTRACTS["SHY"].inverse is False
    assert effective_side("long", inverse=False) == "long"


def test_removing_the_flip_would_invert_the_svxy_verdict():
    """Pins the flip by asserting the two readings disagree.

    Specs crowded SHORT VIX (index 10) + long SVXY (= short VIX) => the book AGREES with the
    crowd. Without the flip the same inputs read as long-vs-short => disagrees. If someone
    deletes `inverse`, this test fails rather than the panel quietly printing the wrong side.
    """
    picks = [{"asset": "SVXY", "direction": "long", "weight": 0.04}]
    pc = assess(picks, 0.04, {"SVXY": reading("SVXY", 10.0)})
    row = pc.rows[0]

    assert row["effective_side"] == "short"
    assert row["crowded_side"] == "short"
    assert row["agrees_with_crowd"] is True
    # The un-flipped comparison — what the code would say if the flip were removed.
    assert (row["crowded_side"] == row["direction"]) is False


# ---------------------------------------------------------------------------
# Coverage is the headline
# ---------------------------------------------------------------------------

def test_live_book_maps_only_two_of_ten_positions():
    """The finding this module exists to state."""
    mapped = [p["asset"] for p in LIVE if p["asset"] in COT_CONTRACTS]
    assert sorted(mapped) == ["SHY", "SVXY"]


def test_coverage_share_is_reported_and_bounds_crowded_share():
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", 69.9), "SVXY": reading("SVXY", 33.2)})
    cov = pc.coverage_share
    assert cov is not None
    # SHY 9.25% + SVXY 3.94% = 13.19pp of a 59.33% gross book.
    assert cov == pytest.approx((0.0925 + 0.0394) / GROSS, rel=1e-9)
    assert cov == pytest.approx(0.2223, abs=5e-4)
    assert pc.crowded_share <= cov


@pytest.mark.parametrize("shy_idx,svxy_idx", [(69.9, 33.2), (95.0, 10.0), (5.0, 90.0)])
def test_crowded_share_never_exceeds_coverage(shy_idx, svxy_idx):
    """The invariant, across crowded and uncrowded readings alike."""
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", shy_idx), "SVXY": reading("SVXY", svxy_idx)})
    assert pc.crowded_share <= pc.coverage_share


def test_live_readings_are_mid_range_so_nothing_is_crowded():
    """The actual 2026-07-21 CFTC prints: UST 2Y at 69.9, VIX at 33.2. Neither is extreme."""
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", 69.9), "SVXY": reading("SVXY", 33.2)})
    assert [r["crowded_side"] for r in pc.rows] == [None, None]
    assert pc.agreeing_gross == 0.0
    assert "no position sits at a speculator extreme" in describe(pc)


def test_summary_leads_with_coverage_not_with_the_verdict():
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", 69.9), "SVXY": reading("SVXY", 33.2)})
    text = describe(pc)
    assert text.startswith("COT positioning can see")
    assert "2 of 10 positions" in text


# ---------------------------------------------------------------------------
# Absence is stated, never filled
# ---------------------------------------------------------------------------

def test_every_unmapped_position_carries_a_reason():
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", 50.0), "SVXY": reading("SVXY", 50.0)})
    assert len(pc.unobservable) == 8
    for u in pc.unobservable:
        assert u["reason"].strip(), f"{u['asset']} was dropped without a reason"


def test_miners_are_not_mapped_to_the_metal():
    """The discipline line: mapping GDX to gold futures would manufacture coverage."""
    assert "GDX" not in COT_CONTRACTS
    assert "NEM" not in COT_CONTRACTS
    assert "miners" in unmapped_reason("GDX").lower()
    # ...while the metal itself IS mapped, so this is a deliberate distinction, not an omission.
    assert "GLD" in COT_CONTRACTS and "IAU" in COT_CONTRACTS


def test_sector_equities_are_not_mapped_to_the_commodity():
    assert "XLE" not in COT_CONTRACTS
    assert "crude" in unmapped_reason("XLE").lower()
    assert "CL" in COT_CONTRACTS  # the contract itself remains mapped


def test_credit_is_unobservable_rather_than_absent():
    reason = unmapped_reason("HYG")
    assert "unobservable" in reason
    assert "not zero" in reason


def test_single_names_fall_back_to_the_general_reason():
    """A name in a sector with no entry gets the default — there is no single-stock COT."""
    for name in ("NOC", "UNH", "JPM"):
        assert "no exchange-traded futures contract" in unmapped_reason(name).lower()


def test_a_sector_reason_wins_over_the_default_where_one_exists():
    """BABA is a single name too, but its sector has a specific reason, so it gets that one.

    Keyed on sector rather than ticker so a China ADR added tomorrow inherits the reason the
    day it appears — the same generalisation the sanctions jurisdiction map rests on.
    """
    assert "speculator positioning" in unmapped_reason("BABA")
    assert "no exchange-traded futures contract" not in unmapped_reason("BABA").lower()


def test_not_fetched_is_distinct_from_nothing_mapped():
    """`readings=None` means we did not look; `{}` means we looked and found nothing usable."""
    never = assess(LIVE, GROSS, None)
    looked = assess(LIVE, GROSS, {})

    assert never.fetched is False
    assert looked.fetched is True
    assert "unknown - not neutral" in describe(never).replace("—", "-")
    assert "gap in coverage" in describe(looked)
    # Either way, nothing is counted as uncrowded.
    assert never.agreeing_gross == 0.0 and looked.agreeing_gross == 0.0


def test_mapped_but_unfetched_position_is_unobservable_not_uncrowded():
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", 60.0)})
    svxy = [u for u in pc.unobservable if u["asset"] == "SVXY"]
    assert len(svxy) == 1
    assert "VIX FUTURES" in svxy[0]["reason"]
    assert "no reading was retrieved" in svxy[0]["reason"]


def test_position_with_an_unreadable_side_is_skipped_not_guessed():
    picks = [{"asset": "SHY", "direction": None, "weight": 0.09}]
    pc = assess(picks, 0.09, {"SHY": reading("SHY", 95.0)})
    assert pc.rows == [] and pc.unobservable == []
    assert pc.agreeing_gross == 0.0


# ---------------------------------------------------------------------------
# The percentile
# ---------------------------------------------------------------------------

def test_cot_index_needs_a_full_enough_window():
    assert cot_index(list(range(MIN_WEEKS - 1))) is None
    assert cot_index(list(range(MIN_WEEKS))) is not None


def test_cot_index_of_a_flat_series_is_unknown_not_midrange():
    """Returning 50.0 would invent a mid-range reading out of no information."""
    assert cot_index([7] * (MIN_WEEKS + 10)) is None


def test_cot_index_reads_newest_first():
    """The API returns DESC, so element 0 is the current print."""
    series = [100] + [0] * MIN_WEEKS          # current at the top of its range
    assert cot_index(series) == pytest.approx(100.0)
    series = [0] + [100] * MIN_WEEKS          # current at the bottom
    assert cot_index(series) == pytest.approx(0.0)


@pytest.mark.parametrize("idx,expected", [
    (CROWDED_HIGH, "long"), (95.0, "long"),
    (CROWDED_LOW, "short"), (2.0, "short"),
    (50.0, None), (None, None),
])
def test_crowded_side_thresholds_are_inclusive(idx, expected):
    assert crowded_side(idx) == expected


# ---------------------------------------------------------------------------
# Freshness and persistence
# ---------------------------------------------------------------------------

def test_as_of_is_the_stalest_observation_not_the_newest():
    """A mixed-date panel is only as fresh as its oldest input."""
    pc = assess(
        LIVE, GROSS,
        {"SHY": reading("SHY", 50.0, as_of="2026-07-21"),
         "SVXY": reading("SVXY", 50.0, as_of="2026-07-14")},
    )
    assert pc.as_of == "2026-07-14"


def test_summary_discloses_that_the_reading_is_old_by_construction():
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", 50.0), "SVXY": reading("SVXY", 50.0)})
    text = describe(pc)
    assert "2026-07-21" in text and "observation date" in text


def test_shares_are_none_not_zero_when_the_book_has_no_gross():
    pc = assess(LIVE, 0.0, {"SHY": reading("SHY", 50.0)})
    assert pc.coverage_share is None
    assert pc.crowded_share is None
    assert to_row(pc)["coverage_share"] is None


def test_to_row_carries_the_thresholds_and_the_sentence():
    pc = assess(LIVE, GROSS, {"SHY": reading("SHY", 69.9), "SVXY": reading("SVXY", 33.2)})
    row = to_row(pc)
    assert row["summary"] == describe(pc)
    assert row["crowded_high"] == CROWDED_HIGH and row["crowded_low"] == CROWDED_LOW
    assert len(row["rows"]) == 2 and len(row["unobservable"]) == 8
    assert row["as_of"] == "2026-07-21"


def test_every_mapped_contract_code_is_well_formed():
    """CFTC codes are six characters; a typo here silently yields an empty series."""
    for asset, cm in COT_CONTRACTS.items():
        assert len(cm.code) == 6, f"{asset} has code {cm.code!r}"
        assert cm.rationale.strip(), f"{asset} has no stated rationale"
