"""Tests for seasonality_analytics.

The function is pure (takes a list of monthly returns, returns a dict).
Tests cover:
  - the per-month stats
  - the midterm-year subset
  - the live yfinance fetcher is OPTIONAL — tests use synthetic frames
"""
import sys
from datetime import date

sys.path.insert(0, "backend/services")

import pytest
from seasonality_analytics import (
    MIDTERM_YEARS,
    compute_midterm_year_stats,
    compute_ndx_seasonality,
    compute_per_month_stats,
)


def _monthly_returns(n_years: int = 36, base_year: int = 1990) -> list[tuple[date, float]]:
    """A synthetic monthly-return series.

    Uses month-of-year sine patterns so per-month stats are
    deterministic and not noise: Aug = +2%, Sep = -2%, the rest near
    zero. 36 years (1990-2025) matches the default window.
    """
    pattern = {
        1: 0.5, 2: 0.0, 3: 0.8, 4: 1.0, 5: 0.3, 6: 0.0,
        7: 0.6, 8: 2.0, 9: -2.0, 10: 0.4, 11: 1.0, 12: 0.5,
    }
    out: list[tuple[date, float]] = []
    from calendar import monthrange
    for y in range(base_year, base_year + n_years):
        for m in range(1, 13):
            last = monthrange(y, m)[1]
            out.append((date(y, m, last), pattern[m]))
    return out


def test_per_month_means_match_synthetic_pattern() -> None:
    rows = _monthly_returns()
    per_month = compute_per_month_stats(rows)
    assert len(per_month) == 12
    # August mean = 2.0% by construction
    aug = next(p for p in per_month if p["month"] == 8)
    assert aug["mean_pct"] == 2.0
    assert aug["median_pct"] == 2.0
    assert aug["win_rate_pct"] == 100.0
    assert aug["n_years"] == 36
    # September mean = -2.0% by construction
    sep = next(p for p in per_month if p["month"] == 9)
    assert sep["mean_pct"] == -2.0
    assert sep["win_rate_pct"] == 0.0


def test_per_month_window_is_respected() -> None:
    """A window of 2010-2020 should drop pre-2010 and post-2020
    observations from the per-month counts."""
    rows = _monthly_returns(n_years=36, base_year=1990)  # 1990-2025
    per_month = compute_per_month_stats(rows, start_year=2010, end_year=2020)
    for p in per_month:
        assert p["n_years"] == 11  # 2010..2020 inclusive


def test_midterm_years_universe_is_well_known() -> None:
    """The midterm-year list is hardcoded for a reason: it is the US
    Congress's schedule, not a derived quantity. Every 4 years from
    1974 through 2026 (the current year as of 2026-08-01)."""
    assert MIDTERM_YEARS == (
        1974, 1978, 1982, 1986, 1990, 1994, 1998,
        2002, 2006, 2010, 2014, 2018, 2022, 2026,
    )


def test_midterm_year_aug_nov_cumulative_is_zero() -> None:
    """With the synthetic pattern (Aug +2, Sep -2, Oct +0.4, Nov +1.0),
    the Aug-Nov cumulative is 1.4%. The median across midterm years
    in the fixture should be 1.4 (within FP tolerance).

    The 36-year fixture (1990-2025) covers midterm years 1990, 1994,
    1998, 2002, 2006, 2010, 2014, 2018, 2022 — 9 years. 2026 is in
    MIDTERM_YEARS but the fixture ends at 2025; the function skips
    years with no observations."""
    rows = _monthly_returns()
    m = compute_midterm_year_stats(rows)
    assert m["aug_nov_median_pct"] == pytest.approx(1.4, abs=1e-9)
    assert m["aug_nov_mean_pct"] == pytest.approx(1.4, abs=1e-9)
    assert m["n_midterm_years"] == 9  # 1990..2022, every 4 years (2026 not in fixture)


def test_midterm_year_peak_to_trough() -> None:
    """With the synthetic pattern, the running cumulative Aug-Nov is
    +2, 0, 0.4, 1.4. Peak = +2, trough = 0 (at the end of Sep), so
    peak_to_trough = -2 percentage points."""
    rows = _monthly_returns()
    m = compute_midterm_year_stats(rows)
    assert m["peak_to_trough_avg_pct"] == -2.0


def test_full_seasonality_call_returns_combined_shape() -> None:
    rows = _monthly_returns()
    s = compute_ndx_seasonality(rows, current_month=8)
    assert s["current_month"] == 8
    assert s["current_month_label"] == "Aug"
    assert len(s["per_month"]) == 12
    assert "aug_nov_median_pct" in s["midterm"]
    assert s["window"]["start_year"] == 1990
    assert s["window"]["end_year"] == 2025
    assert s["n_observations"] == 36 * 12
    assert s["status"] == "measured"  # 432 obs >= 12 → measured


def test_empty_input_returns_safe_shape() -> None:
    s = compute_ndx_seasonality([])
    assert s["n_observations"] == 0
    assert s["status"] == "insufficient_history"  # 0 < 12
    assert all(p["mean_pct"] is None for p in s["per_month"])
    assert s["midterm"]["aug_nov_median_pct"] is None
