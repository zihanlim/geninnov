"""Generic OLS core used by both factor_fetcher (L2) and credit_rates_exposures (L2b).

Extracted from factor_fetcher.rolling_regression so the second consumer does
not reimplement OLS — and so the first consumer's published betas cannot
drift from the second consumer's by an arithmetic slip.

Both consumers want:
  * a single OLS fit on a window (`ols_window`), returning a coefficient dict
    keyed by column name (not by position);
  * a rolling driver (`rolling_ols`) that respects the half-window guard and
    returns the most-recent valid window.

This module deliberately knows nothing about Mkt-RF, SMB, RF, or any other
factor name. The factor-specific key renaming (`Mkt-RF` -> `beta_mkt`) is
the caller's job and lives in `rolling_regression`.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def ols_window(y: pd.Series, X: pd.DataFrame) -> dict[str, float] | None:
    """One OLS fit: y = alpha + X . beta + epsilon.

    Returns {alpha, <col>: float, ..., r_squared, _se: {alpha, <col>: float, ...}}.
    None on NaN, on a rank-deficient design matrix, or on any np.linalg failure.
    Never raises.

    `_se` is namespaced with a leading underscore so it reads as an addition
    rather than a sibling of the coefficient keys — a caller that builds its
    output dict by explicitly picking keys (as `rolling_regression` does) will
    not pick it up by accident, and a caller that wants it asks for it by name.

    Standard errors: se = sqrt(diag(s2 * inv(X'X))), s2 = RSS / (n - k), k =
    number of design-matrix columns INCLUDING the intercept. Uses
    `np.linalg.pinv` rather than `inv` so a near-singular (but full-rank, so
    the coefficient fit itself succeeded) X'X degrades to NaN standard errors
    instead of raising — the coefficients can still be trusted even when their
    precision cannot be estimated, and a caller must not conflate "no SE" with
    "SE is zero".
    """
    if y.isna().any() or X.isna().any(axis=None):
        return None
    y_vals = y.values
    X_vals = X.values
    X_mat = np.column_stack([np.ones(len(X_vals)), X_vals])
    try:
        coeffs, residuals, rank, s = np.linalg.lstsq(X_mat, y_vals, rcond=None)
    except Exception:
        return None
    if rank < X_mat.shape[1]:
        return None
    y_pred = X_mat @ coeffs
    ss_res = float(np.sum((y_vals - y_pred) ** 2))
    ss_tot = float(np.sum((y_vals - np.mean(y_vals)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot != 0 else 0.0

    n, k = X_mat.shape
    dof = n - k
    se_vals = np.full(k, float("nan"))
    if dof > 0:
        try:
            s2 = ss_res / dof
            xtx_inv = np.linalg.pinv(X_mat.T @ X_mat)
            var_diag = s2 * np.diag(xtx_inv)
            with np.errstate(invalid="ignore"):
                se_vals = np.sqrt(var_diag)  # negative (numerical noise) -> NaN, not raise
        except Exception:
            se_vals = np.full(k, float("nan"))

    se_out = {"alpha": float(se_vals[0])}
    for i, col in enumerate(X.columns, start=1):
        se_out[str(col)] = float(se_vals[i])

    out = {"alpha": float(coeffs[0]), "r_squared": float(r2), "_se": se_out}
    for i, col in enumerate(X.columns, start=1):
        out[str(col)] = float(coeffs[i])
    return out


def rolling_ols(
    asset_returns: pd.Series,
    factor_df: pd.DataFrame,
    lookback_days: int = 252,
    *,
    factor_columns: list[str] | None = None,
) -> dict[str, float]:
    """Rolling OLS driver. Returns {} when no window is valid.

    `factor_columns` defaults to `factor_df.columns` minus any column named
    `"RF"` (the existing rolling_regression convention).
    """
    if factor_columns is None:
        factor_columns = [c for c in factor_df.columns if c != "RF"]

    common = asset_returns.index.intersection(factor_df.index)
    if len(common) < lookback_days // 2:
        return {}

    y = asset_returns.loc[common].dropna()
    X = factor_df.loc[common].dropna()
    X = X.reindex(y.index)

    n = len(y)
    if n < lookback_days:
        return {}

    windows: list[dict[str, float]] = []
    for i in range(lookback_days, n + 1):
        y_win = y.iloc[i - lookback_days:i]
        x_win = X[factor_columns].iloc[i - lookback_days:i]
        result = ols_window(y_win, x_win)
        if result is not None:
            windows.append(result)
    return windows[-1] if windows else {}
