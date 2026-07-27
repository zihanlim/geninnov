"""A published claim must be ON THE RECORD at publication (ADR-0090, ADR-0117).

ADR-0090's first job is *record the commitment*: every published pick gets a row as soon
as its book exists, so the denominator is fixed before any outcome is known. Nothing
enforced it on the publishing path. The only writer was `scripts/resolve_outcomes.py`,
invoked as a sibling step in `daily-refresh.yml`, so a book published any other way had
no rows at all.

Measured 2026-07-27: the published book carried **9 picks and 0 outcome rows** — 28% of
every claim the project had ever published, permanently ungradeable, and invisible
because the track-record panel counts what IS recorded.

`test_a_pending_row_never_overwrites_a_verdict` is the one that matters most: the repair
writes `pending`, and a careless upsert would erase a resolved `hit`.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.services.pick_outcomes import (
    DEFAULT_HORIZON_DAYS,
    SPEC_VERSION,
    commitment_rows,
    resolve_pick,
)
from scripts.check_data_integrity import check_published_claims_are_on_the_record


RUN = date(2026, 7, 27)
PICKS = [
    {"asset": "SPY", "direction": "long", "thesis": "..."},
    {"asset": "TLT", "direction": "short", "thesis": "..."},
]


class TestCommitmentRows:
    def test_records_every_published_pick_as_pending(self):
        rows = commitment_rows(RUN, PICKS)
        assert len(rows) == 2
        assert {r["verdict"] for r in rows} == {"pending"}
        assert {r["asset"] for r in rows} == {"SPY", "TLT"}

    def test_needs_no_prices_at_all(self):
        """The point of the fix: recording cannot fail for the reasons fetching prices
        can, so publication and commitment succeed or fail together."""
        rows = commitment_rows(RUN, PICKS)
        assert all(r.get("entry_price") is None for r in rows)
        assert all(r.get("signed_return") is None for r in rows)

    def test_carries_the_spec_that_will_grade_it(self):
        row = commitment_rows(RUN, PICKS)[0]
        assert row["horizon_days"] == DEFAULT_HORIZON_DAYS
        assert row["spec_version"] == SPEC_VERSION
        assert row["expected_exit_date"] is not None

    def test_dedupes_within_one_book(self):
        """A book upserts on run_date, so a duplicate inside it would double-count the
        denominator — and the denominator is the whole point."""
        rows = commitment_rows(RUN, PICKS + [dict(PICKS[0])])
        assert len(rows) == 2

    def test_a_name_held_both_ways_is_two_claims(self):
        rows = commitment_rows(RUN, [
            {"asset": "SPY", "direction": "long"},
            {"asset": "SPY", "direction": "short"},
        ])
        assert len(rows) == 2

    def test_malformed_picks_are_skipped_not_guessed(self):
        rows = commitment_rows(RUN, [
            {"asset": "SPY", "direction": "long"},
            {"asset": "", "direction": "long"},
            {"asset": "QQQ", "direction": "sideways"},
            {"direction": "long"},
        ])
        assert [r["asset"] for r in rows] == ["SPY"]

    def test_no_picks_is_no_rows_not_an_error(self):
        assert commitment_rows(RUN, []) == []
        assert commitment_rows(RUN, None) == []

    def test_a_pending_row_never_overwrites_a_verdict(self):
        """The repair writes `pending` for books already published. Its conflict key must
        match a resolved row exactly, so an insert-if-absent write is a no-op rather than
        an erasure — `daily_refresh.record_published_claims` passes ignore_duplicates for
        exactly this reason."""
        start = date(2026, 1, 5)
        closes = [(start, 100.0)] + [
            (start + timedelta(days=1 + i), 100.0 + i) for i in range(40)
        ]
        resolved = resolve_pick(date(2026, 1, 5), "SPY", "long", closes).to_row()
        assert resolved["verdict"] == "hit"

        pending = commitment_rows(date(2026, 1, 5), [{"asset": "SPY", "direction": "long"}])[0]
        key = ("run_date", "asset", "direction", "horizon_days", "spec_version")
        assert tuple(pending[k] for k in key) == tuple(resolved[k] for k in key)
        assert pending["verdict"] == "pending"


class TestTheGuardCatchesTheGap:
    REC = {"run_date": "2026-07-27", "picks": PICKS}

    def test_silent_when_every_claim_is_recorded(self):
        recorded = [{"asset": "SPY", "direction": "long"},
                    {"asset": "TLT", "direction": "short"}]
        assert check_published_claims_are_on_the_record(self.REC, recorded) == []

    def test_flags_the_exact_failure_that_shipped(self):
        """9 picks, 0 rows — the 2026-07-27 book."""
        flags = check_published_claims_are_on_the_record(self.REC, [])
        assert len(flags) == 1
        assert "2 of 2 published claims" in flags[0]
        assert "long SPY" in flags[0] and "short TLT" in flags[0]

    def test_flags_a_partial_recording(self):
        """The subtler failure: recording ran but wrote fewer rows than the book has."""
        flags = check_published_claims_are_on_the_record(
            self.REC, [{"asset": "SPY", "direction": "long"}]
        )
        assert "1 of 2" in flags[0]
        assert "short TLT" in flags[0]
        assert "SPY" not in flags[0].split("can never be graded:")[1]

    def test_direction_is_part_of_the_claim(self):
        """A recorded LONG does not discharge a published SHORT."""
        flags = check_published_claims_are_on_the_record(
            {"run_date": "2026-07-27", "picks": [{"asset": "SPY", "direction": "short"}]},
            [{"asset": "SPY", "direction": "long"}],
        )
        assert flags and "short SPY" in flags[0]

    def test_names_the_repair(self):
        flags = check_published_claims_are_on_the_record(self.REC, [])
        assert "resolve_outcomes" in flags[0]

    @pytest.mark.parametrize("rec", [None, {}, {"run_date": "x", "picks": []}])
    def test_nothing_published_is_not_a_failure(self, rec):
        assert check_published_claims_are_on_the_record(rec, []) == []
