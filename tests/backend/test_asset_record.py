"""One ticker, one identity — the taxonomy maps are views of one record (ADR-0125).

2026-07-27's fourth SVXY defect (ADR-0121) had a specific shape: sector, geography and
asset class lived in three separately-editable dicts across two modules, a fix landed
in two of them and missed the third, and the third was the one with the consequence.

These tests pin the structure, not the values: values are the guards' job
(test_asset_class_beta_guard). If someone re-introduces a literal map beside the
record, the derivation assertions here are what catch the first divergence.
"""
from __future__ import annotations

from backend.services.book_metrics import ASSETS, GEO_MAP, SECTOR_MAP, AssetRecord
from backend.services.trade_ranker import (
    ASSET_CLASS_MAP,
    _ASSET_CLASS_MAP,
    classify,
)


class TestTheMapsAreViews:
    def test_every_view_is_exactly_the_record(self):
        """Not co-extensive — DERIVED. A hand-edit to a view that diverges from the
        record fails here on the first key it touches."""
        assert SECTOR_MAP == {t: r.sector for t, r in ASSETS.items()}
        assert GEO_MAP == {t: r.geo for t, r in ASSETS.items()}
        assert _ASSET_CLASS_MAP == {t: r.asset_class for t, r in ASSETS.items()}

    def test_the_record_is_frozen(self):
        """A mutable record would reintroduce the half-edit one field at a time."""
        import pytest

        with pytest.raises(Exception):
            ASSETS["SVXY"].sector = "Rates"  # type: ignore[misc]

    def test_the_public_alias_is_the_same_object(self):
        """The concurrent-session property this consolidation must preserve: a consumer
        binding ASSET_CLASS_MAP must never get its own snapshot (ADR-0121)."""
        assert ASSET_CLASS_MAP is _ASSET_CLASS_MAP


class TestTheDefectsStayFixed:
    def test_svxy_is_equity_in_all_three_fields(self):
        """The four-defect ticker, asserted through the record — one line to check,
        because it is now one line to edit."""
        assert ASSETS["SVXY"] == AssetRecord("US Equities", "US", "equity")
        assert classify("SVXY")["asset_class"] == "equity"

    def test_ewz_is_equity(self):
        assert ASSETS["EWZ"] == AssetRecord("EM Equities", "EM", "equity")

    def test_a_haven_is_still_a_haven(self):
        """The consolidation changed ZERO values — TLT's identity is the sentinel."""
        assert ASSETS["TLT"] == AssetRecord("Rates", "US", "rates")
