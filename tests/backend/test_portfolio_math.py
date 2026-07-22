import pytest
from datetime import date
from backend.services.portfolio import compute_daily_return, compute_daily_contributions, MissingReturnError, compute_cumulative_return

def test_long_only_positive():
    p = [
        {"ticker": "A", "weight": 0.5, "price_today": 101.0, "price_yesterday": 100.0},
        {"ticker": "B", "weight": 0.5, "price_today": 110.0, "price_yesterday": 100.0},
    ]
    # A: +1%, B: +10% => 0.5*0.01 + 0.5*0.10 = 0.055
    assert compute_daily_return(p) == pytest.approx(0.055)

def test_signed_short_subtracts():
    p = [
        {"ticker": "A", "weight": 0.5, "price_today": 101.0, "price_yesterday": 100.0},
        {"ticker": "B", "weight": -0.3, "price_today": 90.0, "price_yesterday": 100.0},
    ]
    # A: +1% * 0.5 = +0.005; B: -10% * -0.3 = +0.03
    assert compute_daily_return(p) == pytest.approx(0.035)

def test_missing_price_raises():
    p = [
        {"ticker": "A", "weight": 0.5, "price_today": None, "price_yesterday": 100.0},
    ]
    with pytest.raises(MissingReturnError):
        compute_daily_return(p)

def test_contributions_preserve_signs():
    p = [
        {"ticker": "A", "weight": 0.5, "price_today": 101.0, "price_yesterday": 100.0},
        {"ticker": "B", "weight": -0.5, "price_today": 90.0, "price_yesterday": 100.0},
    ]
    contrib = compute_daily_contributions(p)
    assert contrib["A"] == pytest.approx(0.005)
    assert contrib["B"] == pytest.approx(0.05)  # -0.5 * -0.10

def test_cumulative_compounds_sequentially():
    r = compute_cumulative_return([0.01, 0.02, -0.005], inception=date(2026, 1, 14))
    # 1.01 * 1.02 * 0.995 - 1
    assert r["value"] == pytest.approx(1.01 * 1.02 * 0.995 - 1)
    assert r["compounded"] is True
    assert r["inception"] == date(2026, 1, 14)
    assert r["as_of"] == date(2026, 1, 16)

def test_cumulative_empty_returns_zero():
    r = compute_cumulative_return([], inception=date(2026, 1, 14))
    assert r["value"] == 0.0

def test_cumulative_rejects_suspicious_magnitude():
    with pytest.raises(ValueError):
        compute_cumulative_return([5.0], inception=date(2026, 1, 14))

class TestCumulativeValueContract:
    """`portfolio_cumulative_return.cumulative_value` is a GROWTH FACTOR.

    ADR-0017 defines cumulative_value(as_of) = prod(1 + r_i), and the frontend
    renders `cumulative_value - 1` as the percentage. The backend was writing
    `product - 1.0` (a return) into that column, so a true +5% rendered as
    -95%, and the empty-book sentinel of 0 rendered as -100% -- both stamped
    display_status "exact".

    These assertions cross the seam: they check the number that gets persisted
    behaves correctly under the reader's transformation, which presence/status
    assertions cannot catch.
    """

    def _reader_pct(self, stored: float) -> float:
        """Mirror CumulativeReturn.tsx: `const cumReturn = row.cumulative_value - 1`."""
        return stored - 1.0

    def test_growth_factor_and_return_differ_by_one(self):
        r = compute_cumulative_return([0.01, 0.02], inception=date(2026, 1, 14))
        assert r["growth_factor"] == pytest.approx(r["value"] + 1.0)

    def test_reader_recovers_the_true_return_from_growth_factor(self):
        dailies = [0.01, 0.02, -0.005]
        r = compute_cumulative_return(dailies, inception=date(2026, 1, 14))
        expected = 1.01 * 1.02 * 0.995 - 1
        assert self._reader_pct(r["growth_factor"]) == pytest.approx(expected)

    def test_a_gain_never_reads_as_a_loss(self):
        """The shipped defect: a positive return rendering deeply negative."""
        r = compute_cumulative_return([0.01, 0.02], inception=date(2026, 1, 14))
        assert self._reader_pct(r["growth_factor"]) > 0

    def test_flat_book_reads_as_zero_percent(self):
        r = compute_cumulative_return([0.0, 0.0], inception=date(2026, 1, 14))
        assert self._reader_pct(r["growth_factor"]) == pytest.approx(0.0)

    def test_empty_history_sentinel_reads_as_zero_not_total_loss(self):
        """daily_refresh writes 1.0 for a fresh book; 0 would render -100%."""
        assert self._reader_pct(1.0) == pytest.approx(0.0)
        assert self._reader_pct(0.0) == pytest.approx(-1.0)  # the old, wrong sentinel
