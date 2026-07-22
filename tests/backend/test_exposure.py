import pytest

from backend.services.exposure import (
    geo_concentration,
    gross_exposure,
    leverage,
    net_exposure,
    sector_concentration,
)

BOOK = [
    {"ticker": "A", "weight": 0.5, "sector": "tech", "geo": "us"},
    {"ticker": "B", "weight": -0.3, "sector": "tech", "geo": "eu"},
    {"ticker": "C", "weight": 0.2, "sector": "energy", "geo": "us"},
]


def test_gross_exposure_sums_absolute():
    assert gross_exposure(BOOK) == 1.0


def test_net_exposure_sums_signed():
    assert net_exposure(BOOK) == pytest.approx(0.4)


def test_leverage_uses_gross_over_capital():
    assert leverage(BOOK, capital=100_000_000) == pytest.approx(1e-8)  # 1.0 / 1e8


def test_sector_concentration():
    assert sector_concentration(BOOK) == {"tech": 0.8, "energy": 0.2}


def test_geo_concentration():
    assert geo_concentration(BOOK) == {"us": 0.7, "eu": 0.3}
