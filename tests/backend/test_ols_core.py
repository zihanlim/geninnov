"""OLS core extracted from rolling_regression. Generic over factor columns,
window-validating, and the regression backend for both factor_exposures
and credit_rates_exposures."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.data import _ols_core as ols  # noqa: E402


def _daily_idx(n: int, start: str = "2024-01-01") -> pd.DatetimeIndex:
    return pd.bdate_range(start, periods=n)


def test_ols_window_recovers_a_single_known_coefficient():
    """Synthetic: y = 1.5 * x + noise. ols_window must return alpha ~ 0, the
    coefficient ~ 1.5, and r_squared reflecting fit quality."""
    rng = np.random.default_rng(0)
    x = pd.Series(rng.normal(0, 1, 300), index=_daily_idx(300))
    y = 1.5 * x + rng.normal(0, 0.1, 300)
    out = ols.ols_window(y, pd.DataFrame({"x": x}))
    assert out is not None
    assert out["alpha"] == pytest.approx(0.0, abs=0.05)
    assert out["x"] == pytest.approx(1.5, abs=0.05)
    assert out["r_squared"] > 0.9


def test_ols_window_returns_none_on_singular_matrix():
    """A constant X column is rank-deficient; ols_window must return None, not raise."""
    x = pd.Series(np.zeros(300), index=_daily_idx(300))
    y = pd.Series(np.ones(300), index=_daily_idx(300))
    assert ols.ols_window(y, pd.DataFrame({"const": x})) is None


def test_ols_window_returns_none_on_any_nan():
    """A single NaN poisons the window — partial windows do not produce numbers."""
    x = pd.Series(np.ones(300), index=_daily_idx(300))
    y = x.copy()
    y.iloc[42] = np.nan
    assert ols.ols_window(y, pd.DataFrame({"x": x})) is None


def test_rolling_ols_uses_intersection_guard():
    """A short intersection must yield {}, never a number from fewer
    observations than the window length."""
    idx_full = _daily_idx(400)
    idx_short = idx_full[:100]
    x = pd.Series(np.ones(100), index=idx_short)
    y = pd.Series(np.ones(100), index=idx_short)
    factors = pd.DataFrame({"x": np.ones(400)}, index=idx_full)
    out = ols.rolling_ols(y, factors, lookback_days=252)
    # Intersection is 100 days; need 252; insufficient → {}
    assert out == {}


def test_rolling_ols_returns_empty_dict_when_no_window_valid():
    """Mirrors the existing rolling_regression contract: returns {} so callers
    can `if not result: continue` rather than handle a None type."""
    out = ols.rolling_ols(
        pd.Series(dtype=float),
        pd.DataFrame(dtype=float),
        lookback_days=252,
    )
    assert out == {}


def test_rolling_ols_maps_coefficient_names_to_columns():
    """The factor_exposures consumer wants `beta_mkt` (mapped from Mkt-RF).
    credit_rates_exposures wants `beta_d_ust10` (mapped from a column literally
    named d_ust10). Both work because we never rename; we just expose keys
    that mirror the column names."""
    rng = np.random.default_rng(0)
    idx = _daily_idx(400)
    x1 = pd.Series(rng.normal(0, 1, 400), index=idx)
    x2 = pd.Series(rng.normal(0, 1, 400), index=idx)
    y = 0.7 * x1 + 0.3 * x2 + rng.normal(0, 0.05, 400)
    factors = pd.DataFrame({"d_ust10": x1, "d_ig": x2}, index=idx)
    out = ols.rolling_ols(y, factors, lookback_days=252)
    assert out
    assert out["d_ust10"] == pytest.approx(0.7, abs=0.05)
    assert out["d_ig"] == pytest.approx(0.3, abs=0.05)
    assert "alpha" in out and "r_squared" in out
