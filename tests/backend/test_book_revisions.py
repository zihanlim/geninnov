"""
Tests for backend/services/book_revisions.py (ADR-0093).

The failure modes this pins, in order of how much damage each does:
  1. a first publication logged as a revision (drowns the real ones)
  2. a revision with no stated reason (indistinguishable from a silent overwrite)
  3. floating-point noise logged as a change (a log nobody reads)
  4. absence conflated with zero (ADR-0066, on the diff instead of the value)
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.book_revisions import (
    BACKFILL,
    MANUAL_CORRECTION,
    MATERIAL_EPSILON,
    PIPELINE_RERUN,
    diff_books,
    summarise,
)

RD = "2026-07-25"


def book(picks=None, metrics=None, view="thesis", scenarios=0):
    return {
        "picks": picks if picks is not None else [{"asset": "XLE", "direction": "long", "weight": 0.06}],
        "book_metrics": metrics or {"gross_exposure": 0.59, "net_exposure": -0.05},
        "book_view": view,
        "scenario_results": [{"n": i} for i in range(scenarios)],
    }


# ─── first publication is not a revision ─────────────────────────────────────

def test_first_publication_records_nothing():
    """A baseline is not a change. Logging it would put a revision row on every book ever
    published and bury the ones that matter."""
    assert diff_books(RD, None, book()) == []


def test_an_identical_rerun_records_nothing():
    """The pipeline re-running and producing the same book is not a correction. Seventeen
    runs for one run_date (observed 2026-07-25) would otherwise emit sixteen empty
    revisions."""
    assert diff_books(RD, book(), book()) == []


# ─── every revision carries a reason ─────────────────────────────────────────

def test_every_revision_states_a_cause_even_unattributed():
    """Migration 044 makes `reason` NOT NULL on purpose. The default is a stated
    non-attribution, never an empty string — an unexplained revision reads exactly like the
    silent overwrite this table exists to prevent."""
    revs = diff_books(RD, book(), book(metrics={"gross_exposure": 0.70, "net_exposure": -0.05}))
    assert revs
    for r in revs:
        assert r.reason and r.reason.strip()
        assert "re-run" in r.reason.lower()
        assert r.trigger_type == PIPELINE_RERUN


def test_a_supplied_reason_and_evidence_are_carried_to_every_row():
    revs = diff_books(
        RD, book(), book(scenarios=1),
        trigger_type=BACKFILL, reason="Added S6 per ADR-0088.",
        evidence="docs/adrs/0088-...md", actor="claude",
    )
    assert revs and all(r.trigger_type == BACKFILL for r in revs)
    assert all(r.evidence == "docs/adrs/0088-...md" and r.actor == "claude" for r in revs)


# ─── materiality ─────────────────────────────────────────────────────────────

def test_float_noise_below_a_basis_point_is_not_a_revision():
    """MATERIAL_EPSILON is an ECONOMIC threshold, not a representation guard. A log that
    reports the sixteenth decimal moving is a log nobody reads."""
    a = book(metrics={"gross_exposure": 0.5933244069596506, "net_exposure": -0.05})
    b = book(metrics={"gross_exposure": 0.5933244069596600, "net_exposure": -0.05})
    assert diff_books(RD, a, b) == []


def test_a_move_above_the_threshold_is_reported():
    """Deliberately tests a move CLEARLY above the epsilon, not one exactly on it.

    `0.59 + 1e-4` differs from `0.59` by 9.9999999999989e-05 — marginally under the
    threshold — so an exact-boundary assertion tests floating-point luck rather than
    behaviour. The epsilon is a rough materiality cut ("would a reader notice?"), not a
    precise contract, so nobody should loosen the `>=` to `>` to make a boundary test pass.
    """
    a = book(metrics={"gross_exposure": 0.5900, "net_exposure": -0.05})
    b = book(metrics={"gross_exposure": 0.5900 + 2 * MATERIAL_EPSILON, "net_exposure": -0.05})
    fields = [r.field for r in diff_books(RD, a, b)]
    assert "book_metrics.gross_exposure" in fields


def test_appearing_or_disappearing_is_always_material_however_small():
    """None -> value is the difference between "not computable" and "computed" (ADR-0066),
    so it is reported even when the value is far below the epsilon."""
    a = book(metrics={"gross_exposure": None, "net_exposure": -0.05})
    b = book(metrics={"gross_exposure": 1e-9, "net_exposure": -0.05})
    revs = diff_books(RD, a, b)
    assert [r.field for r in revs] == ["book_metrics.gross_exposure"]
    assert revs[0].previous_value is None          # NOT the string "0"
    assert revs[0].new_value is not None


# ─── positions ───────────────────────────────────────────────────────────────

def test_a_changed_position_set_is_reported_as_membership():
    """What a reader who quoted the book asks first is whether the names changed."""
    a = book(picks=[{"asset": "XLE", "direction": "long", "weight": 0.06}])
    b = book(picks=[{"asset": "TLT", "direction": "long", "weight": 0.06}])
    revs = [r for r in diff_books(RD, a, b) if r.field == "picks[]"]
    assert len(revs) == 1
    assert "XLE:long" in revs[0].previous_value
    assert "TLT:long" in revs[0].new_value


def test_flipping_a_name_from_long_to_short_is_a_different_position_not_an_edit():
    """Direction is part of a position's identity — the same key ADR-0040 matches on.
    Reporting this as a weight change would hide a reversed bet."""
    a = book(picks=[{"asset": "GDX", "direction": "long", "weight": 0.06}])
    b = book(picks=[{"asset": "GDX", "direction": "short", "weight": 0.06}])
    fields = [r.field for r in diff_books(RD, a, b)]
    assert "picks[]" in fields
    assert not any(f.startswith("picks[GDX") and f.endswith(".weight") for f in fields)


def test_a_resized_position_is_reported_per_name():
    """"Same names, different sizes" is a different claim from "different names", and a
    reader has to be able to tell them apart."""
    a = book(picks=[{"asset": "XLE", "direction": "long", "weight": 0.06}])
    b = book(picks=[{"asset": "XLE", "direction": "long", "weight": 0.12}])
    revs = diff_books(RD, a, b)
    assert [r.field for r in revs] == ["picks[XLE:long].weight"]
    assert not any(r.field == "picks[]" for r in revs)


# ─── thesis and scenarios ────────────────────────────────────────────────────

def test_a_rewritten_thesis_is_reported_without_a_prose_diff():
    revs = [r for r in diff_books(RD, book(view="old"), book(view="new one")) if r.field == "book_view"]
    assert len(revs) == 1
    assert "superseded" in revs[0].previous_value


def test_an_added_scenario_is_reported_as_a_count():
    """The ADR-0088 S6 append is exactly this case, which is why `backfill` exists."""
    revs = [r for r in diff_books(RD, book(scenarios=5), book(scenarios=6)) if r.field == "scenario_results"]
    assert len(revs) == 1
    assert revs[0].previous_value == "5 scenarios" and revs[0].new_value == "6 scenarios"


# ─── persistence shape + summary ─────────────────────────────────────────────

def test_to_row_matches_the_migration_columns():
    r = diff_books(RD, book(), book(scenarios=1), trigger_type=MANUAL_CORRECTION,
                   reason="because")[0].to_row()
    assert set(r) == {
        "run_date", "field", "previous_value", "new_value",
        "trigger_type", "reason", "evidence", "actor",
    }
    assert r["run_date"] == RD


def test_summarise_says_so_when_nothing_changed():
    """A silent tool is indistinguishable from one that did not run."""
    assert "No material revision" in summarise([])
    assert "1 revision" in summarise(diff_books(RD, book(), book(scenarios=1)))
