"""
Tests for the R0 fabricated-data guard (scripts/check_data_integrity.py).

Pins the detection of the seed fingerprint so fabricated portfolio numbers can
never quietly reach production again (RESIDUAL R0).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.check_data_integrity import (
    detect_fabricated_seed,
    _looks_like_alternating_seed,
)


# The exact metrics the seed script wrote.
FABRICATED_RISK = {
    "concentration_hhi": 1850.0,
    "var_95": 2_500_000.0,
    "cvar_95": 4_000_000.0,
    "sharpe": 1.15,
    "beta": 0.65,
}

# A genuine computed row (HHI ~1000.12, per RESIDUAL R0).
REAL_RISK = {
    "concentration_hhi": 1000.12,
    "var_95": 1_840_000.0,
    "cvar_95": 2_760_000.0,
    "sharpe": 1.42,
    "beta": 0.68,
}


def _ret_rows(values):
    return [{"run_date": f"2026-07-{20 + i}", "daily_return": v} for i, v in enumerate(values)]


def test_detects_fabricated_risk_row():
    flags = detect_fabricated_seed(FABRICATED_RISK, [])
    assert any("portfolio_risk" in f for f in flags)


def test_real_risk_row_is_clean():
    assert detect_fabricated_seed(REAL_RISK, []) == []


def test_single_coincidental_sentinel_does_not_flag():
    # A real book that happens to have beta 0.65 — one match is not enough.
    row = {**REAL_RISK, "beta": 0.65}
    assert detect_fabricated_seed(row, []) == []


def test_detects_alternating_return_series_phase_a():
    rows = _ret_rows([0.0015, -0.0008, 0.0015, -0.0008, 0.0015])
    flags = detect_fabricated_seed(REAL_RISK, rows)
    assert any("portfolio_returns" in f for f in flags)


def test_detects_alternating_return_series_phase_b():
    rows = _ret_rows([-0.0008, 0.0015, -0.0008, 0.0015])
    assert _looks_like_alternating_seed([r["daily_return"] for r in rows])


def test_real_returns_are_clean():
    rows = _ret_rows([0.011, -0.021, 0.004, 0.0032, -0.0075])
    assert detect_fabricated_seed(REAL_RISK, rows) == []


def test_alternating_seed_requires_min_length():
    assert _looks_like_alternating_seed([0.0015, -0.0008]) is False


def test_both_fingerprints_flag_together():
    rows = _ret_rows([0.0015, -0.0008, 0.0015, -0.0008])
    flags = detect_fabricated_seed(FABRICATED_RISK, rows)
    assert len(flags) == 2
