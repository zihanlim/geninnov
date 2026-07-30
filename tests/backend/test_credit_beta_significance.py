"""The significance gate on measured credit betas (ADR-0193).

`credit_rates_exposures.py` computes `marginal_beta_ig` / `marginal_beta_qual` by
residualising each credit leg against FF5+UMD first. That residual is a
SMALL-VARIANCE regressor, so regressing a noisy single-name equity return on it
routinely produces a large, imprecisely-estimated coefficient. Measured on the live
2026-07-30 rows (t = beta / se, by hand): GEV -1.31, GLD +1.53, JD +1.08, SMH -1.73,
UNG -0.48, SPY -0.91 — not one clears |t| = 2. `marginal_r2` cannot catch this: it is
the r-squared of the JOINT fit, dominated by the six equity factors, and stays high
even when the credit coefficients are pure noise.

This file covers, in order: `ols_window` recovering a standard error that widens with
noise (the primitive the whole gate rests on); that `rolling_regression` still does not
leak the new `_se` key; `compute_marginal_betas`/`assemble_row` carrying `se_ig`/`se_qual`
through to persistence; the significance predicate itself (threshold, NULL-fails-closed);
and `scenario_analysis`'s gate applied end-to-end — insignificant betas falling through
(never a fabricated 0.0), per-leg gating, and the coverage line reporting measured vs.
believed separately.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.data._ols_core import ols_window  # noqa: E402
from backend.data.factor_fetcher import rolling_regression  # noqa: E402
from backend.services.credit_rates_exposures import (  # noqa: E402
    assemble_row,
    compute_marginal_betas,
)
from backend.services.book_metrics import BookMetrics, SECTOR_MAP  # noqa: E402
from backend.services.scenario_analysis import (  # noqa: E402
    CREDIT_BETA_T_THRESHOLD,
    Scenario,
    _coverage_tier,
    _credit_beta_significant,
    _resolve_shock,
    estimate_scenario_pnl,
)


def _daily_idx(n: int, start: str = "2024-01-01") -> pd.DatetimeIndex:
    return pd.bdate_range(start, periods=n)


# ─────────────────────────────────────────────────────────────────────────────
# ols_window: standard errors
# ─────────────────────────────────────────────────────────────────────────────

def test_ols_window_recovers_a_known_standard_error():
    """Independent cross-check: for a simple regression with intercept,
    Var(beta_hat) = s2 * diag(inv(X'X)), s2 = RSS / (n - k). Compute that
    closed form directly with numpy and compare against ols_window's `_se`."""
    rng = np.random.default_rng(42)
    n = 300
    x = pd.Series(rng.normal(0, 1, n), index=_daily_idx(n))
    y = 2.0 * x + rng.normal(0, 0.2, n)

    out = ols_window(y, pd.DataFrame({"x": x}))
    assert out is not None
    assert "_se" in out
    assert set(out["_se"]) == {"alpha", "x"}

    X_mat = np.column_stack([np.ones(n), x.values])
    coeffs, *_ = np.linalg.lstsq(X_mat, y.values, rcond=None)
    resid = y.values - X_mat @ coeffs
    s2 = float(np.sum(resid ** 2)) / (n - X_mat.shape[1])
    xtx_inv = np.linalg.inv(X_mat.T @ X_mat)
    expected_se = np.sqrt(s2 * np.diag(xtx_inv))

    assert out["_se"]["alpha"] == pytest.approx(expected_se[0], rel=1e-9)
    assert out["_se"]["x"] == pytest.approx(expected_se[1], rel=1e-9)
    # A clean, high-SNR fit gives a small SE relative to the recovered coefficient.
    assert out["_se"]["x"] < 0.05


def test_ols_window_se_widens_with_noise():
    """Same regressor, more noise on y -> a wider standard error on the SAME
    coefficient — the residualised-regressor defect this whole gate exists for,
    reproduced in miniature."""
    rng = np.random.default_rng(7)
    n = 300
    x = pd.Series(rng.normal(0, 1, n), index=_daily_idx(n))

    clean = ols_window(2.0 * x + rng.normal(0, 0.05, n), pd.DataFrame({"x": x}))
    noisy = ols_window(2.0 * x + rng.normal(0, 2.0, n), pd.DataFrame({"x": x}))

    assert clean["_se"]["x"] < noisy["_se"]["x"]


def test_ols_window_se_is_nan_when_covariance_inversion_fails(monkeypatch):
    """Defensive per the task: an SE computation failure must not sink the whole
    fit. The coefficients (already recovered via lstsq) are still returned; only
    `_se` degrades to NaN rather than raising."""
    import backend.data._ols_core as ols_core_module

    rng = np.random.default_rng(3)
    n = 300
    x = pd.Series(rng.normal(0, 1, n), index=_daily_idx(n))
    y = 1.5 * x + rng.normal(0, 0.1, n)

    def _raising_pinv(*_a, **_k):
        raise np.linalg.LinAlgError("forced failure for the test")

    monkeypatch.setattr(ols_core_module.np.linalg, "pinv", _raising_pinv)
    out = ols_core_module.ols_window(y, pd.DataFrame({"x": x}))

    assert out is not None
    assert out["x"] == pytest.approx(1.5, abs=0.05)      # coefficient fit unaffected
    assert out["_se"]["x"] != out["_se"]["x"]             # NaN
    assert out["_se"]["alpha"] != out["_se"]["alpha"]     # NaN


# ─────────────────────────────────────────────────────────────────────────────
# rolling_regression must not leak `_se` (the golden snapshot's own guarantee)
# ─────────────────────────────────────────────────────────────────────────────

def test_rolling_regression_does_not_leak_se_key():
    """`_ols_core.ols_window` now returns `_se`. `rolling_regression` builds its
    output dict by explicitly picking keys, so it must not leak it — this is the
    containment property migration 061 specifically requires. The bit-identical
    golden value pin lives in test_factor_fetcher.py; this asserts the key-set
    property that test would not itself catch if `_se` leaked alongside
    unchanged legacy values.
    """
    rng = np.random.default_rng(7)
    idx = pd.bdate_range("2024-01-01", periods=300)
    f = pd.DataFrame(
        {
            "Mkt-RF": rng.normal(0.0004, 0.010, 300),
            "SMB": rng.normal(0.0, 0.004, 300),
            "HML": rng.normal(0.0, 0.004, 300),
            "RMW": rng.normal(0.0, 0.003, 300),
            "CMA": rng.normal(0.0, 0.003, 300),
            "UMD": rng.normal(0.0, 0.005, 300),
            "RF": np.full(300, 0.00012),
        },
        index=idx,
    )
    asset = f["RF"] + f["Mkt-RF"]
    out = rolling_regression(asset, f, lookback_days=252)
    assert "_se" not in out
    assert set(out) == {
        "alpha", "r_squared", "beta_mkt", "beta_smb",
        "beta_hml", "beta_rmw", "beta_cma", "beta_umd",
    }


# ─────────────────────────────────────────────────────────────────────────────
# compute_marginal_betas / assemble_row carry the SEs through to persistence
# ─────────────────────────────────────────────────────────────────────────────

def _synthetic_marginal_inputs(n: int = 260, seed: int = 11):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2024-01-01", periods=n)
    mkt = rng.normal(0.0005, 0.01, n)
    factor_df = pd.DataFrame(
        {
            "Mkt-RF": mkt,
            "SMB": rng.normal(0, 0.004, n), "HML": rng.normal(0, 0.004, n),
            "RMW": rng.normal(0, 0.003, n), "CMA": rng.normal(0, 0.003, n),
            "UMD": rng.normal(0, 0.005, n),
        },
        index=idx,
    )
    legs = pd.DataFrame(
        {
            "d_ust10": rng.normal(0, 4.0, n),
            "d_ig": rng.normal(0, 3.0, n),
            "d_qual": rng.normal(0, 2.0, n),
        },
        index=idx,
    )
    # An asset driven by market beta alone, with no true credit-leg dependence —
    # exactly the case a residualised-regressor fit finds a noisy, insignificant
    # coefficient for.
    asset_returns = pd.Series(1.0 * mkt + rng.normal(0, 0.01, n), index=idx)
    return asset_returns, legs, factor_df


def test_compute_marginal_betas_returns_finite_positive_standard_errors():
    asset_returns, legs, factor_df = _synthetic_marginal_inputs()
    out = compute_marginal_betas(asset_returns, legs, factor_df, lookback_days=252)

    assert out["se_ig"] == out["se_ig"]      # not NaN
    assert out["se_qual"] == out["se_qual"]  # not NaN
    assert out["se_ig"] > 0
    assert out["se_qual"] > 0


def test_assemble_row_persists_marginal_standard_errors():
    asset_returns, legs, factor_df = _synthetic_marginal_inputs()
    marginal = compute_marginal_betas(asset_returns, legs, factor_df, lookback_days=252)
    total = {
        "n_obs": 252, "r2_ust10": 0.1, "r2_ig": 0.1, "r2_qual": 0.1,
        "beta_ust10": 0.0, "beta_ig": 0.0, "beta_qual": 0.0,
    }

    row = assemble_row(
        asset="SYN", run_date=date(2026, 7, 30), lookback_days=252,
        total=total, marginal=marginal,
    )

    assert row["marginal_se_ig"] == pytest.approx(marginal["se_ig"])
    assert row["marginal_se_qual"] == pytest.approx(marginal["se_qual"])
    assert row["marginal_se_ig"] > 0
    assert row["marginal_se_qual"] > 0


def test_assemble_row_writes_null_se_when_marginal_is_none():
    """FF5+UMD unavailable -> marginal=None (partial success, per assemble_row's own
    docstring). marginal_se_ig/qual must be NULL, exactly like the betas — never a
    default of 0.0, which downstream would fail closed on anyway but should not need to
    tell apart from a genuinely-zero SE."""
    total = {
        "n_obs": 252, "r2_ust10": 0.1, "r2_ig": 0.1, "r2_qual": 0.1,
        "beta_ust10": 0.0, "beta_ig": 0.0, "beta_qual": 0.0,
    }
    row = assemble_row(
        asset="SYN", run_date=date(2026, 7, 30), lookback_days=252,
        total=total, marginal=None,
    )
    assert row["marginal_se_ig"] is None
    assert row["marginal_se_qual"] is None
    assert row["marginal_beta_ig"] is None
    assert row["marginal_beta_qual"] is None


# ─────────────────────────────────────────────────────────────────────────────
# _credit_beta_significant: the predicate itself
# ─────────────────────────────────────────────────────────────────────────────

def test_threshold_constant_is_two():
    assert CREDIT_BETA_T_THRESHOLD == 2.0


def test_significant_at_exactly_the_threshold():
    assert _credit_beta_significant(4.0, 2.0) is True   # |t| == 2.0, inclusive


def test_insignificant_just_under_the_threshold():
    assert _credit_beta_significant(3.9, 2.0) is False  # |t| = 1.95


def test_null_se_fails_closed():
    assert _credit_beta_significant(-24.09, None) is False


def test_missing_beta_fails_closed():
    assert _credit_beta_significant(None, 1.0) is False


def test_non_positive_se_fails_closed():
    assert _credit_beta_significant(5.0, 0.0) is False
    assert _credit_beta_significant(5.0, -1.0) is False


def test_nan_se_fails_closed():
    assert _credit_beta_significant(5.0, float("nan")) is False


def test_measured_2026_07_30_sample_none_are_significant():
    """The six hand-checked live rows from the task's own measurement. Not one
    clears the gate — the honest empirical basis for ADR-0193."""
    sample = {
        "GEV": (-24.09, 18.45), "GLD": (16.90, 11.03), "JD": (14.28, 13.26),
        "SMH": (-13.03, 7.52), "UNG": (-12.62, 26.24), "SPY": (-0.33, 0.37),
    }
    for asset, (beta, se) in sample.items():
        assert _credit_beta_significant(beta, se) is False, asset


# ─────────────────────────────────────────────────────────────────────────────
# scenario_analysis: the gate applied end-to-end
# ─────────────────────────────────────────────────────────────────────────────

def _scenario(sector_shocks: dict | None = None) -> Scenario:
    return Scenario(
        name="test_gate", label="test", description="",
        factor_shocks={"mkt": -0.05}, base_asset_shocks={},
        sector_shocks=sector_shocks or {},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )


def test_insignificant_beta_does_not_transmit_falls_through_to_sector():
    """|t| < 2 on BOTH legs -> the measured tier is skipped entirely; the asset
    resolves via the sector bucket instead, never a fabricated 0.0."""
    scenario = _scenario(sector_shocks={"Credit": -0.30})
    credit_betas = {
        "LQD": {
            "marginal_beta_ig": -6.8, "marginal_se_ig": 10.0,     # t = -0.68
            "marginal_beta_qual": -2.0, "marginal_se_qual": 5.0,  # t = -0.40
        }
    }
    assert SECTOR_MAP.get("LQD") == "Credit"

    shock, origin = _resolve_shock(scenario, "LQD", credit_betas)
    assert shock == -0.30
    assert origin == " via Credit"
    assert _coverage_tier(scenario, "LQD", credit_betas) == "sector"


def test_significant_beta_does_transmit():
    """|t| >= 2 on both legs -> the full worked-example arithmetic transmits."""
    scenario = _scenario()
    credit_betas = {
        "LQD": {
            "marginal_beta_ig": -6.8, "marginal_se_ig": 1.0,      # t = -6.8
            "marginal_beta_qual": -2.0, "marginal_se_qual": 0.9,  # t = -2.22
        }
    }
    shock, origin = _resolve_shock(scenario, "LQD", credit_betas)
    assert shock == pytest.approx(-0.0688, abs=1e-9)
    assert origin == " via measured credit beta"
    assert _coverage_tier(scenario, "LQD", credit_betas) == "measured"


def test_per_leg_gating_only_significant_leg_contributes():
    """beta_ig significant, beta_qual not -> only the IG leg's term enters the sum;
    the insignificant qual leg is dropped, not zeroed-and-summed (same arithmetic
    result either way here, but the CODE PATH must be the drop, not a substitution —
    covered by the exact expected value using ONLY the ig term)."""
    scenario = _scenario()
    credit_betas = {
        "LQD": {
            "marginal_beta_ig": -6.8, "marginal_se_ig": 1.0,       # t = -6.8, significant
            "marginal_beta_qual": -2.0, "marginal_se_qual": 5.0,   # t = -0.4, not
        }
    }
    shock, origin = _resolve_shock(scenario, "LQD", credit_betas)
    expected_ig_only = (-6.8 * (60.0 / 100.0)) / 100.0
    assert shock == pytest.approx(expected_ig_only, abs=1e-9)
    assert origin == " via measured credit beta"


def test_null_missing_se_fails_closed_no_transmission():
    """A row with betas but no SE at all (pre-migration-061) fails closed: neither
    leg is believable, so the asset falls straight through to the sector tier —
    never a fabricated shock from an ungated beta."""
    scenario = _scenario(sector_shocks={"Credit": -0.30})
    credit_betas = {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}
    shock, origin = _resolve_shock(scenario, "LQD", credit_betas)
    assert shock == -0.30
    assert origin == " via Credit"


def test_insignificant_beta_is_fallthrough_never_zero():
    """No override, no sector match either -> the factor path (None), never 0.0."""
    scenario = _scenario()  # no sector_shocks
    credit_betas = {
        "NOTATICKER": {
            "marginal_beta_ig": -6.8, "marginal_se_ig": 10.0,
            "marginal_beta_qual": -2.0, "marginal_se_qual": 5.0,
        }
    }
    shock, origin = _resolve_shock(scenario, "NOTATICKER", credit_betas)
    assert shock is None
    assert shock != 0.0
    assert origin == ""


def test_coverage_reports_zero_believable_when_all_insignificant():
    """The expected honest outcome on a book with no distinguishable credit betas:
    N of N held names have a MEASURED beta, 0 of N are BELIEVED — S7 transmits
    through nothing and every position falls back to sector/factor. This is the
    finding the task anticipates for the live multi-asset book, reproduced here."""
    scenario = _scenario()
    credit_betas = {
        t: {
            "marginal_beta_ig": -10.0, "marginal_se_ig": 15.0,    # t ~ -0.67
            "marginal_beta_qual": 8.0, "marginal_se_qual": 10.0,  # t = 0.8
        }
        for t in ("SPY", "QQQ", "GLD")
    }
    picks = [dict(asset=a, direction="long", weight=0.05) for a in ("SPY", "QQQ", "GLD")]
    bm = BookMetrics(
        book_beta_mkt=0.5, book_beta_smb=0.0, book_beta_hml=0.0, book_beta_rmw=0.0,
        book_beta_cma=0.0, book_beta_umd=0.0, gross_exposure=0.15, net_exposure=0.15,
        long_weight=0.15, short_weight=0.0, sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=True,
    )

    result = estimate_scenario_pnl(scenario, picks, bm, 1e8, credit_betas=credit_betas)
    coverage_line = next(
        l for l in result.contribution_breakdown if "Credit-beta coverage" in l
    )

    assert "3 of 3 held names have a measured credit beta" in coverage_line
    assert "0 of 3" in coverage_line
    assert "distinguishable from zero" in coverage_line


def test_coverage_measured_and_believed_differ_when_only_some_are_significant():
    """The general case: some held names have a measured beta that clears the gate,
    some don't. The two counts in the coverage line must differ and both be correct."""
    scenario = _scenario()
    credit_betas = {
        "LQD": {  # measured, NOT believed
            "marginal_beta_ig": -6.8, "marginal_se_ig": 10.0,
            "marginal_beta_qual": -2.0, "marginal_se_qual": 5.0,
        },
        "HYG": {  # measured AND believed (ig leg)
            "marginal_beta_ig": -3.0, "marginal_se_ig": 1.0,
            "marginal_beta_qual": -1.0, "marginal_se_qual": 2.0,
        },
    }
    picks = [
        dict(asset="LQD", direction="long", weight=0.10),
        dict(asset="HYG", direction="short", weight=0.08),
    ]
    bm = BookMetrics(
        book_beta_mkt=0.5, book_beta_smb=0.0, book_beta_hml=0.0, book_beta_rmw=0.0,
        book_beta_cma=0.0, book_beta_umd=0.0, gross_exposure=0.18, net_exposure=0.02,
        long_weight=0.10, short_weight=0.08, sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=True,
    )

    result = estimate_scenario_pnl(scenario, picks, bm, 1e8, credit_betas=credit_betas)
    coverage_line = next(
        l for l in result.contribution_breakdown if "Credit-beta coverage" in l
    )

    assert "2 of 2 held names have a measured credit beta" in coverage_line
    assert "1 of 2" in coverage_line
