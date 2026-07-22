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