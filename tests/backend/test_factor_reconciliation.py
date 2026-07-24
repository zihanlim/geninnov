"""The factor model must recover a beta we know the answer to.

L2's betas drive the book's factor tilts and all four scenario shocks, and nothing
checked them until 2026-07-24 — /method had no L2 section at all, so the layer under
every tilt on the site was unexplained and unverified.

The load-bearing test is definitional: an asset that IS the market factor must
regress to beta_mkt ~ 1.00 with R^2 ~ 1.00. It fails loudly if the regression, the
date alignment or the excess-return convention is wrong, none of which a smoke test
over live data would catch.

Live reconciliation is rendered by components/method/FactorReconciliation.tsx against
factor_exposures. These tests pin the mechanics with synthetic series so a regression
is caught without a network call.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.data.factor_fetcher import rolling_regression


def _factors(n: int = 300, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2024-01-01", periods=n)
    return pd.DataFrame(
        {
            "Mkt-RF": rng.normal(0.0004, 0.010, n),
            "SMB": rng.normal(0.0, 0.004, n),
            "HML": rng.normal(0.0, 0.004, n),
            "RMW": rng.normal(0.0, 0.003, n),
            "CMA": rng.normal(0.0, 0.003, n),
            "UMD": rng.normal(0.0, 0.005, n),
            "RF": np.full(n, 0.00012),
        },
        index=idx,
    )


def test_an_asset_that_is_the_market_recovers_beta_one():
    """The SPY check, synthetically. beta ~ 1.00 and R^2 ~ 1.00, or the plumbing
    (alignment / excess returns / OLS) is wrong."""
    f = _factors()
    # Asset return = RF + 1.0 * Mkt-RF exactly: it IS the market.
    asset = f["RF"] + f["Mkt-RF"]
    out = rolling_regression(asset, f, lookback_days=252)
    assert out, "regression returned nothing on a 300-day series"
    assert out["beta_mkt"] == pytest.approx(1.0, abs=0.02)
    assert out["r_squared"] > 0.99


def test_a_cash_like_asset_has_no_market_beta():
    """The BIL check. A position earning the risk-free rate must sit at zero, not at
    'small' — a non-zero beta here means RF is leaking into the excess return."""
    f = _factors()
    asset = f["RF"].copy()
    out = rolling_regression(asset, f, lookback_days=252)
    assert out
    assert out["beta_mkt"] == pytest.approx(0.0, abs=0.05)


def test_a_levered_asset_recovers_its_leverage():
    """The ARKK check: high-beta names must read high, and the model must recover the
    multiple rather than merely ranking it above the market."""
    f = _factors()
    asset = f["RF"] + 1.5 * f["Mkt-RF"]
    out = rolling_regression(asset, f, lookback_days=252)
    assert out
    assert out["beta_mkt"] == pytest.approx(1.5, abs=0.03)


def test_a_second_factor_is_recovered_independently():
    """Betas must separate. Loading on momentum as well as the market has to show up
    on UMD without contaminating beta_mkt."""
    f = _factors()
    asset = f["RF"] + 0.8 * f["Mkt-RF"] + 0.6 * f["UMD"]
    out = rolling_regression(asset, f, lookback_days=252)
    assert out
    assert out["beta_mkt"] == pytest.approx(0.8, abs=0.05)
    assert out["beta_umd"] == pytest.approx(0.6, abs=0.05)


def test_too_little_history_returns_nothing_rather_than_a_number():
    """A short series must yield {} so the caller skips the asset. Emitting a beta
    from 40 observations and labelling it a 252-day exposure is the kind of
    confidently-wrong number this codebase keeps finding."""
    f = _factors(n=40)
    asset = f["RF"] + f["Mkt-RF"]
    assert rolling_regression(asset, f, lookback_days=252) == {}
