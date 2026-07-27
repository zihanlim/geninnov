"""
Award flow as a range position — and the settling data that would have made it lie.

`flow_index` is deliberately `cot_fetcher.cot_index` in another market, so most of what is
tested here is that its REFUSALS match. The one genuinely new hazard is that USASpending
keeps filling a quarter in for months after it closes, which makes the most recent readings
look like collapses.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.data.award_flow import (  # noqa: E402
    MIN_QUARTERS,
    SETTLEMENT_LAG_BUCKETS,
    flow_index,
    reading_from_buckets,
)


def _buckets(amounts, start_fy=2023, start_q=4):
    out, fy, q = [], start_fy, start_q
    for a in amounts:
        out.append({"time_period": {"fiscal_year": fy, "quarter": q}, "aggregated_amount": a})
        q += 1
        if q > 4:
            q, fy = 1, fy + 1
    return out


def test_settling_quarters_are_dropped_so_they_cannot_read_as_a_collapse():
    """The live case. Measured 2026-07-27: LMT ran $16.4bn then printed $6.7bn for a
    quarter that had closed four weeks earlier, and NOC printed 15% of its prior quarter.
    All three mapped primes hit a 12-quarter LOW at once — the tell that the data had not
    finished arriving rather than that award flow had collapsed.
    """
    settled = [10.0, 12.0, 8.0, 14.0, 11.0, 9.0, 13.0, 10.5, 12.5, 16.4]
    partial = [6.7, 0.03]                       # still settling, then the live quarter
    reading = reading_from_buckets("LMT", _buckets(settled + partial))

    assert reading.quarters == len(settled), (
        f"both settling buckets must be dropped, kept {reading.quarters}"
    )
    assert reading.latest_obligated == 16.4, "the reading must describe the last SETTLED quarter"
    assert reading.index is not None and reading.index > 90, (
        "16.4 is the top of its settled range; if the partial buckets leaked in this "
        "would read near zero"
    )


def test_two_buckets_not_one():
    """One drop is not enough — the quarter BEFORE the current one is under-reported too."""
    assert SETTLEMENT_LAG_BUCKETS == 2
    # 12 buckets in: nine at 10.0, one at 50.0, then two still settling. Dropping both
    # settling buckets leaves TEN, ending on 50.0.
    reading = reading_from_buckets("X", _buckets([10.0] * 9 + [50.0, 1.0, 0.01]))
    assert reading.quarters == 10
    assert reading.latest_obligated == 50.0
    # Dropping only one would end on 1.0 and read as a record low.
    assert reading.index == 100.0


def test_it_refuses_rather_than_returning_a_midpoint():
    """Mirrors cot_index exactly: None on a short window, None on a flat one, never 50.0."""
    assert flow_index([1.0] * (MIN_QUARTERS - 1)) is None
    assert flow_index([7.0] * MIN_QUARTERS) is None, "a flat range has no position within it"
    assert flow_index([]) is None


def test_the_index_is_a_range_position():
    amounts = [0.0, 5.0, 10.0, 2.0, 8.0, 1.0, 9.0, 10.0]
    assert flow_index(amounts) == 100.0
    assert flow_index([10.0, 5.0, 1.0, 2.0, 8.0, 3.0, 9.0, 0.0]) == 0.0


def test_every_refusal_carries_its_reason():
    thin = reading_from_buckets("X", _buckets([10.0, 11.0, 12.0, 1.0, 0.01]))
    assert thin.index is None
    assert "complete quarters" in thin.reason and str(MIN_QUARTERS) in thin.reason

    flat = reading_from_buckets("X", _buckets([5.0] * 10 + [1.0, 0.01]))
    assert flat.index is None
    assert "no range to position within" in flat.reason

    tiny = reading_from_buckets("X", _buckets([1.0, 0.5]))
    assert tiny.index is None and "still settling" in tiny.reason


def test_a_malformed_bucket_is_skipped_not_zeroed():
    buckets = _buckets([10.0] * 10 + [1.0, 0.01])
    buckets[3]["aggregated_amount"] = None      # NOT-COMPUTABLE stays absent (ADR-0066)
    reading = reading_from_buckets("X", buckets)
    assert reading.quarters == 9
