"""
Unit tests for the L3 regime backfill (scripts/backfill_regime.py) and the
as-of bound it depends on.

The property under test is LOOK-AHEAD FREEDOM. A backfill is only worth having
if a row stamped 2025-11-14 was computed from what was knowable on 2025-11-14;
otherwise it is today's reading copied 250 times, which is worse than four
honest rows because it looks like history.

`_compute_spx_breadth` was the hole: every other input to `classify()` already
took `as_of` (with a comment explaining why), and breadth did not. These tests
pin the fix against a synthetic price series — no network, no database.
"""
import os
import sys
from datetime import date, timedelta

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.regime_classifier import _compute_spx_breadth
from scripts.backfill_regime import MIN_INPUTS, classify_row


def _series(values: list[float], end: date) -> pd.DataFrame:
    """Daily closes ending on `end`, oldest first."""
    idx = pd.to_datetime([end - timedelta(days=len(values) - 1 - i) for i in range(len(values))])
    return pd.DataFrame({"Close": values}, index=idx)


# ─── breadth: the as-of bound ────────────────────────────────────────────────

def test_breadth_needs_two_hundred_observations():
    hist = _series([100.0] * 199, date(2026, 7, 25))
    assert _compute_spx_breadth(hist=hist) is None


def test_breadth_reads_above_and_below_the_moving_average():
    below = _series([100.0] * 200 + [50.0], date(2026, 7, 25))
    above = _series([100.0] * 200 + [150.0], date(2026, 7, 25))
    assert _compute_spx_breadth(hist=below) == 35.0
    assert _compute_spx_breadth(hist=above) == 65.0


def test_breadth_as_of_ignores_everything_after_that_date():
    # A series that is BELOW its average for the first stretch and rockets above
    # it at the end. Asked "as of" the earlier date, the later rally must not
    # exist — that is the entire point of the parameter.
    end = date(2026, 7, 25)
    values = [100.0] * 200 + [50.0] * 5 + [400.0] * 5
    hist = _series(values, end)

    assert _compute_spx_breadth(hist=hist) == 65.0                      # today: the rally counts
    as_of = end - timedelta(days=5)
    assert _compute_spx_breadth(as_of=as_of, hist=hist) == 35.0         # then: it had not happened

    # And the unbounded call is the one that would have been wrong 250 times.
    assert _compute_spx_breadth(hist=hist) != _compute_spx_breadth(as_of=as_of, hist=hist)


def test_breadth_survives_an_empty_or_missing_frame():
    assert _compute_spx_breadth(hist=pd.DataFrame({"Close": []})) is None


# ─── the unit conversion the backfill must not skip ──────────────────────────

def test_classify_row_converts_percent_to_basis_points():
    # FRED reports the curve in PERCENT (-0.60 = -60bp) while the cycle rules are
    # calibrated in bp. An inverted curve has to reach the inversion rule; if the
    # conversion were skipped, -0.60 would never be < -50 and the rule would be
    # unreachable — the exact bug the classifier carries a scar comment about.
    inverted = {
        "yield_curve_slope": -0.60,
        "hy_oas": 5.50,
        "vix_level": 30.0,
        "vix_term_diff": 2.0,
        "real_rate": 2.4,
        "spx_breadth": 35.0,
    }
    cycle, sentiment = classify_row(inverted)
    assert cycle in {"late", "recession"}
    assert sentiment == "risk-off"


def test_classify_row_reads_a_benign_tape_as_risk_on():
    benign = {
        "yield_curve_slope": 0.34,
        "hy_oas": 2.77,
        "vix_level": 12.0,
        "vix_term_diff": -2.0,
        "real_rate": 2.45,
        "spx_breadth": 65.0,
    }
    cycle, sentiment = classify_row(benign)
    assert sentiment == "risk-on"
    assert cycle in {"early", "mid", "late", "recession"}


def test_classify_row_tolerates_missing_inputs():
    # Nullable by design: the classifier's own fields are `float | None`, and a
    # backfill hits dates where a FRED series had not posted yet.
    sparse = {k: None for k in ("yield_curve_slope", "hy_oas", "vix_level", "vix_term_diff", "real_rate", "spx_breadth")}
    cycle, sentiment = classify_row(sparse)
    assert isinstance(cycle, str) and isinstance(sentiment, str)


def test_minimum_inputs_guard_is_a_real_threshold():
    # The guard is what stops a date with almost no data being written with a
    # confident label. If someone lowers it to 0, a row driven entirely by
    # defaults becomes indistinguishable from a measured one.
    assert MIN_INPUTS >= 3
