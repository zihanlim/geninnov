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


# ─────────────────────────────────────────────────────────────────────────────
# check_edge_score_reconciles — a stored score must reproduce from its components
# ─────────────────────────────────────────────────────────────────────────────

_W = {"trend": 0.20, "regime": 0.23, "carry": 0.34, "value": 0.18, "sentiment": 0.05}


def _row(**kw):
    base = {
        "theme_id": "t-1",
        "run_date": "2026-07-25",
        "edge_score": None,
        "trend_signal": None,
        "regime_bias": None,
        "carry_signal": None,
        "value_signal": None,
        "sentiment_signal": None,
    }
    base.update(kw)
    return base


def test_accepts_the_live_row_that_a_naive_sum_rejected():
    """Energy Prices, 2026-07-25 — carry and value not computable.

    The naive sum is 0.169999; the persisted score is 0.354165. Renormalised over
    the 0.48 of weight actually present, they agree. /method printed the naive sum
    and published a RECONCILIATION FAILURE against a correct pipeline (ADR-0064).
    """
    from scripts.check_data_integrity import check_edge_score_reconciles

    rows = [_row(edge_score=0.354165, trend_signal=0.7932,
                 regime_bias=0.0365, sentiment_signal=0.0592)]
    assert check_edge_score_reconciles(rows, _W) == []


def test_flags_a_score_that_does_not_match_its_components():
    from scripts.check_data_integrity import check_edge_score_reconciles

    # Same components, but the stored score is the NAIVE sum — i.e. a pipeline that
    # forgot to renormalise. That is the regression this guard exists to catch.
    rows = [_row(edge_score=0.169999, trend_signal=0.7932,
                 regime_bias=0.0365, sentiment_signal=0.0592)]
    flags = check_edge_score_reconciles(rows, _W)
    assert len(flags) == 1
    assert "renormalise" in flags[0]
    assert "not computable: carry, value" in flags[0]


def test_all_components_present_needs_no_renormalisation():
    from scripts.check_data_integrity import check_edge_score_reconciles

    # Weights sum to 1.00, so renormalising divides by 1 and the naive sum is right.
    expected = 0.20 * 0.5 + 0.23 * 0.4 + 0.34 * 0.3 + 0.18 * 0.2 + 0.05 * 0.1
    rows = [_row(edge_score=expected, trend_signal=0.5, regime_bias=0.4,
                 carry_signal=0.3, value_signal=0.2, sentiment_signal=0.1)]
    assert check_edge_score_reconciles(rows, _W) == []


def test_is_silent_on_an_unscored_theme():
    """A theme that was never scored is not a mismatch."""
    from scripts.check_data_integrity import check_edge_score_reconciles

    assert check_edge_score_reconciles([_row(trend_signal=0.5)], _W) == []


def test_nothing_computable_abstains_at_zero_without_dividing_by_zero():
    from scripts.check_data_integrity import check_edge_score_reconciles

    assert check_edge_score_reconciles([_row(edge_score=0.0)], _W) == []
    flags = check_edge_score_reconciles([_row(edge_score=0.3)], _W)
    assert len(flags) == 1  # claims an edge with no evidence behind it


def test_is_silent_without_rows_or_weights():
    from scripts.check_data_integrity import check_edge_score_reconciles

    assert check_edge_score_reconciles(None, _W) == []
    assert check_edge_score_reconciles([_row(edge_score=0.3, trend_signal=0.5)], None) == []
    assert check_edge_score_reconciles([], _W) == []
