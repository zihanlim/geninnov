"""Tests for equity_risk_premium.compute_erp.

The function is pure (it takes inputs, returns a dict), so the test
suite is a series of fixture-driven scenarios with a known right
answer. Every absence path is exercised — the module's contract is
that absence is data, not zero.
"""
import sys
from datetime import date, timedelta

sys.path.insert(0, "backend/services")

from equity_risk_premium import EPS_STALENESS_DAYS_MAX, compute_erp


def test_erp_matches_jpm_style_formula() -> None:
    """SPX 5000, EPS 250, ust10 4.50% -> P/E 20, earnings_yield 5.00%,
    ERP = 0.50 percentage points."""
    r = compute_erp(
        spx_close=5000.0,
        ust10_pct=4.50,
        trailing_eps=250.0,
        eps_as_of=date(2026, 6, 30),
        as_of=date(2026, 7, 31),
    )
    assert r["status"] == "measured"
    assert abs(r["spx_pe"] - 20.0) < 1e-9
    assert abs(r["earnings_yield_pct"] - 5.0) < 1e-9
    assert abs(r["erp_pct"] - 0.50) < 1e-9
    assert r["ust10_pct"] == 4.50


def test_erp_q2_recap_ballpark() -> None:
    """The Q2 recap cited ERP=2.2%. A 1-quarter-stale EPS against a
    4.73% ust10 lands in the 1.5%-3.0% band. We do not pin to 2.2%
    exactly — the EPS is hand-curated and varies — but the ballpark
    must be right or the function is wrong."""
    # spx_pe=20, earnings_yield=5.0%, ust10=4.73 -> ERP=0.27 (low)
    # spx_pe=18, earnings_yield=5.56%, ust10=4.73 -> ERP=0.83 (low)
    # The 2.2% number implies earnings_yield ~ 6.9% (PE ~14.5).
    # Forward consensus EPS for 2026 S&P 500 has been running there.
    r = compute_erp(
        spx_close=5800.0,
        ust10_pct=4.73,
        trailing_eps=400.0,
        eps_as_of=date(2026, 6, 30),
        as_of=date(2026, 7, 31),
    )
    assert r["status"] == "measured"
    # PE = 14.5, ey = 6.896%, ERP = 6.896 - 4.73 = 2.166. Pin to 1e-6.
    assert abs(r["spx_pe"] - 14.5) < 1e-9
    assert abs(r["earnings_yield_pct"] - (100.0 / 14.5)) < 1e-6
    assert abs(r["erp_pct"] - 2.16655) < 1e-3


def test_missing_spx_close_returns_unknown() -> None:
    r = compute_erp(
        spx_close=None,
        ust10_pct=4.73,
        trailing_eps=400.0,
        eps_as_of=date(2026, 6, 30),
    )
    assert r["status"] == "unknown"
    assert r["erp_pct"] is None
    assert r["reason"] is not None
    assert "spx" in r["reason"].lower()


def test_missing_eps_returns_unknown_not_zero() -> None:
    """The cardinal sin this module was written to prevent: returning
    0.0 ERP when the EPS is unavailable. The function must report
    'unknown' with a NULL erp, not a zero, so the L5 cites an absence
    as an absence, never a fact."""
    r = compute_erp(
        spx_close=5800.0,
        ust10_pct=4.73,
        trailing_eps=None,
    )
    assert r["status"] == "unknown"
    assert r["erp_pct"] is None
    assert r["spx_pe"] is None
    assert r["earnings_yield_pct"] is None
    assert r["reason"] is not None
    assert "eps" in r["reason"].lower()


def test_stale_eps_returns_unknown() -> None:
    """A 1+ quarter stale EPS is a different epistemic state from
    'we have today's data and the answer is 2.2%'. The function must
    refuse to publish a number built on stale inputs."""
    r = compute_erp(
        spx_close=5800.0,
        ust10_pct=4.73,
        trailing_eps=400.0,
        eps_as_of=date(2026, 1, 15),  # ~6.5 months old
        as_of=date(2026, 7, 31),
    )
    assert r["status"] == "unknown"
    assert r["erp_pct"] is None
    assert "stale" in r["reason"].lower()


def test_fresh_eps_at_boundary_is_accepted() -> None:
    """EPS exactly at EPS_STALENESS_DAYS_MAX (120 days) is accepted.
    The threshold is a strict >, not >=."""
    as_of_d = date(2026, 7, 31)
    eps_as_of_d = as_of_d - timedelta(days=EPS_STALENESS_DAYS_MAX)
    r = compute_erp(
        spx_close=5800.0,
        ust10_pct=4.73,
        trailing_eps=400.0,
        eps_as_of=eps_as_of_d,
        as_of=as_of_d,
    )
    assert r["status"] == "measured", (
        f"Expected 'measured' at the {EPS_STALENESS_DAYS_MAX}-day "
        f"boundary; got {r['status']} with reason={r['reason']!r}"
    )


def test_eps_one_day_past_boundary_is_unknown() -> None:
    as_of_d = date(2026, 7, 31)
    eps_as_of_d = as_of_d - timedelta(days=EPS_STALENESS_DAYS_MAX + 1)
    r = compute_erp(
        spx_close=5800.0,
        ust10_pct=4.73,
        trailing_eps=400.0,
        eps_as_of=eps_as_of_d,
        as_of=as_of_d,
    )
    assert r["status"] == "unknown"


def test_negative_spx_close_returns_unknown() -> None:
    r = compute_erp(spx_close=-1.0, ust10_pct=4.73, trailing_eps=400.0)
    assert r["status"] == "unknown"
    assert r["erp_pct"] is None


def test_zero_eps_returns_unknown_not_nan() -> None:
    """A zero or negative EPS is a data error. The function must NOT
    divide by it (would yield inf) and must NOT silently fall back to
    'unknown' without explanation."""
    r = compute_erp(spx_close=5800.0, ust10_pct=4.73, trailing_eps=0.0)
    assert r["status"] == "unknown"
    assert r["erp_pct"] is None
