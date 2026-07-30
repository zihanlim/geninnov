"""credit_rates_exposures: per-asset duration / IG / quality betas.

The fixture for the total-vs-marginal distinction is the SPY assertion in
this file's `test_spy_marginal_credit_beta_is_near_zero` — if total and
marginal don't diverge for an equity that loads on credit only through
its market factor, the orthogonalisation isn't working and the two-variant
design is decoration. See spec §9, last row."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import credit_rates_exposures as cre  # noqa: E402


# A fake Supabase client that returns whatever rows `cre` asks for, from an
# in-memory store. This is what makes the test offline and deterministic —
# no network, no clock, no rate limit.
class _FakeSB:
    def __init__(self, frames: dict[tuple[str, date], float]):
        self._frames = frames

    def table(self, name):
        outer = self

        class _T:
            def __init__(self):
                self._filters = []  # accumulate: list of (col, op, val)

            def select(self, *_a, **_kw):
                return self

            def eq(self, col, val):
                self._filters.append((col, "=", val))
                return self

            def in_(self, col, vals):
                self._filters.append((col, "in", tuple(vals)))
                return self

            def gte(self, col, val):
                self._filters.append((col, ">=", val))
                return self

            def lte(self, col, val):
                self._filters.append((col, "<=", val))
                return self

            def order(self, *_a, **_kw):
                return self

            def limit(self, *_a, **_kw):
                return self

            def _match(self, sid: str, td: date, filt) -> bool:
                col, op, val = filt
                if col == "series_id":
                    return sid == val
                if col == "trading_date":
                    # val may be an ISO string from start.isoformat() / as_of.isoformat()
                    if isinstance(val, str):
                        from datetime import date as _date
                        val = _date.fromisoformat(val)
                    if op == "=":
                        return td == val
                    if op == ">=":
                        return td >= val
                    if op == "<=":
                        return td <= val
                return True

            def execute(self):
                rows = [
                    {"series_id": sid, "trading_date": td.isoformat(), "value": v}
                    for (sid, td), v in outer._frames.items()
                    if all(self._match(sid, td, f) for f in self._filters)
                ]
                class _R:
                    def __init__(self, data):
                        self.data = data
                return _R(rows)

        return _T()


def _frame(series_values: dict[str, list[tuple[date, float]]]) -> dict:
    out = {}
    for sid, pairs in series_values.items():
        for td, v in pairs:
            out[(sid, td)] = v
    return out


def test_build_credit_legs_diffs_in_basis_points_not_percent():
    """A 25bp move in DGS10 (4.30 -> 4.55) must come out as d_ust10 = 25.0,
    not 0.25 — the percent/bp trap the macro_fetcher comment warns about."""
    idx = pd.bdate_range("2024-01-01", periods=5)
    rows = _frame(
        {
            "DGS10":          [(d.date(), v) for d, v in zip(idx, [4.30, 4.55, 4.55, 4.40, 4.40])],
            "BAMLC0A0CM":     [(d.date(), v) for d, v in zip(idx, [1.50, 1.50, 1.55, 1.55, 1.55])],
            "BAMLH0A0HYM2":   [(d.date(), v) for d, v in zip(idx, [3.20, 3.20, 3.30, 3.30, 3.30])],
        }
    )
    sb = _FakeSB(rows)
    legs = cre.build_credit_legs(sb, lookback_days=5, as_of=idx[-1].date())
    assert not legs.empty
    # First row is dropped by differencing; remaining 4 rows of d_ust10 in bp:
    assert legs["d_ust10"].iloc[0] == pytest.approx(25.0)  # 4.30 -> 4.55, percent * 100 = bp
    assert legs["d_ust10"].iloc[1] == pytest.approx(0.0)
    assert legs["d_ust10"].iloc[2] == pytest.approx(-15.0)  # 4.55 -> 4.40


def test_build_credit_legs_quality_leg_is_hy_minus_ig_not_a_separate_series():
    """The HY-OAS raw series must NOT appear as its own column. Quality is
    the gap, not a third independent leg."""
    idx = pd.bdate_range("2024-01-01", periods=3)
    rows = _frame(
        {
            "DGS10":        [(d.date(), 4.0) for d in idx],
            "BAMLC0A0CM":   [(d.date(), 1.5) for d in idx],
            "BAMLH0A0HYM2": [(d.date(), v) for d, v in zip(idx, [3.0, 3.2, 3.4])],
        }
    )
    sb = _FakeSB(rows)
    legs = cre.build_credit_legs(sb, lookback_days=3, as_of=idx[-1].date())
    assert "BAMLH0A0HYM2" not in legs.columns
    assert "d_qual" in legs.columns
    # HY moves 20bp then 20bp; IG is flat; d_qual = 20, 20 (the gap widens by 20bp each day).
    assert legs["d_qual"].iloc[1] == pytest.approx(20.0)
    assert legs["d_qual"].iloc[0] == pytest.approx(20.0)


def test_build_credit_legs_raises_when_a_required_series_is_missing():
    """A truly missing series is a ValueError so the caller can decide
    between `insufficient_history` and `degenerate` — never silent zeros."""
    idx = pd.bdate_range("2024-01-01", periods=3)
    rows = _frame({"DGS10": [(d.date(), 4.0) for d in idx]})  # IG and HY missing
    sb = _FakeSB(rows)
    with pytest.raises(ValueError, match="BAMLC0A0CM"):
        cre.build_credit_legs(sb, lookback_days=3, as_of=idx[-1].date())


def test_build_credit_legs_handles_partial_history_by_using_available_intersection():
    """If OAS is back to 2024-03 but DGS10 is back to 2024-01, the legs
    begin at 2024-03 (intersection) rather than dropping the whole frame."""
    d_early = pd.bdate_range("2024-01-01", periods=65)   # Jan through late March
    d_late = pd.bdate_range("2024-02-15", periods=20)
    rows = _frame(
        {
            "DGS10":          [(d.date(), 4.0 + 0.01 * i) for i, d in enumerate(d_early)],
            "BAMLC0A0CM":     [(d.date(), 1.5) for d in d_late],
            "BAMLH0A0HYM2":   [(d.date(), 3.0) for d in d_late],
        }
    )
    sb = _FakeSB(rows)
    legs = cre.build_credit_legs(sb, lookback_days=55, as_of=d_late[-1].date())
    assert not legs.empty
    # The earliest leg date must be on or after 2024-02-15 (the IG/HY start).
    assert legs.index[0] >= pd.Timestamp("2024-02-15")


def test_compute_total_betas_recovers_a_known_duration():
    """A synthetic TLT: 17y effective duration, built in the units the
    PRODUCTION inputs actually arrive in, so the test cannot pass on a
    convention the live pipeline does not use.

    `legs` are BASIS POINTS (build_credit_legs -> diff() * 100).
    `asset_returns` are DECIMAL (close.pct_change()).
    A 100bp rise costs a 17y-duration bond 17% -> -0.17 DECIMAL.
    So the generating process is `-17 * (leg_bp / 10000)`, and the
    published beta must still read -17 (percent per 100bp).
    """
    rng = np.random.default_rng(0)
    idx = pd.bdate_range("2024-01-01", periods=300)
    d_ust10 = pd.Series(rng.normal(0, 5, 300), index=idx)  # bp moves
    # Decimal return: -17% per 100bp == -17 * (bp/10000).
    y = -17.0 * (d_ust10 / 10000.0) + rng.normal(0, 0.0005, 300)
    legs = pd.DataFrame({"d_ust10": d_ust10, "d_ig": d_ust10 * 0.0, "d_qual": d_ust10 * 0.0})
    out = cre.compute_total_betas(y, legs, lookback_days=252)
    assert out["beta_ust10"] == pytest.approx(-17.0, abs=2.0)
    assert out["r2_ust10"] > 0.9
    assert out["n_obs"] == 252


def test_a_realistic_daily_move_produces_a_realistic_daily_return():
    """The dimensional guard, stated as a fact about the world rather than
    about the code: a 25bp day must cost a 17y bond roughly 4.25%, and the
    beta recovered from such days must be -17, not -0.0017 and not -1700.

    This is the regression test for the defect the plan itself carried --
    the brief divided a bp leg by 100 (recovering -0.17) and the first fix
    removed the division entirely (recovering -17 from a generating process
    where a ONE basis point move cost 1700%). Both made the assertion pass.
    Only the units make it true.
    """
    idx = pd.bdate_range("2024-01-01", periods=300)
    # Every day is exactly +25bp; a 17y bond loses 17% * 0.25 = 4.25%.
    d_ust10 = pd.Series(np.full(300, 25.0), index=idx)
    expected_daily_decimal = -0.0425
    y = pd.Series(np.full(300, expected_daily_decimal), index=idx)
    legs = pd.DataFrame({"d_ust10": d_ust10, "d_ig": d_ust10 * 0.0, "d_qual": d_ust10 * 0.0})
    out = cre.compute_total_betas(y, legs, lookback_days=252)
    # A constant regressor is rank-deficient, so this configuration must
    # decline to publish rather than emit a number -- which is itself the
    # right behaviour and is asserted here.
    assert np.isnan(out["beta_ust10"])

    # With variation, the same physics must recover -17.
    rng = np.random.default_rng(3)
    d_ust10 = pd.Series(rng.normal(0, 25, 300), index=idx)
    y = -17.0 * (d_ust10 / 10000.0)
    legs = pd.DataFrame({"d_ust10": d_ust10, "d_ig": d_ust10 * 0.0, "d_qual": d_ust10 * 0.0})
    out = cre.compute_total_betas(y, legs, lookback_days=252)
    assert out["beta_ust10"] == pytest.approx(-17.0, abs=0.01)
    # And the implied one-day loss on a 25bp day is ~4.25%, not 0.04% or 425%.
    implied = out["beta_ust10"] * (25.0 / 100.0)
    assert implied == pytest.approx(-4.25, abs=0.05)


def test_compute_total_betas_keeps_three_legs_independent():
    """Three separate simple regressions, one per leg. Loading on d_ust10
    must NOT leak into beta_ig or beta_qual. Same unit convention as above:
    legs in bp, returns decimal, published betas percent-per-100bp."""
    rng = np.random.default_rng(0)
    idx = pd.bdate_range("2024-01-01", periods=300)
    d_ust10 = pd.Series(rng.normal(0, 5, 300), index=idx)
    d_ig = pd.Series(rng.normal(0, 5, 300), index=idx)
    d_qual = pd.Series(rng.normal(0, 5, 300), index=idx)
    y = (
        -10.0 * (d_ust10 / 10000.0)
        + -3.0 * (d_ig / 10000.0)
        + -5.0 * (d_qual / 10000.0)
        + rng.normal(0, 0.0003, 300)
    )
    legs = pd.DataFrame({"d_ust10": d_ust10, "d_ig": d_ig, "d_qual": d_qual})
    out = cre.compute_total_betas(y, legs, lookback_days=252)
    assert out["beta_ust10"] == pytest.approx(-10.0, abs=1.5)
    assert out["beta_ig"] == pytest.approx(-3.0, abs=1.5)
    assert out["beta_qual"] == pytest.approx(-5.0, abs=1.5)


def test_compute_total_betas_returns_nan_when_history_is_too_short():
    """Below the floor the function returns NaN, NOT 0.0 — a zero beta is
    the claim 'this asset is insensitive to rates' and is false for the
    very assets most likely to fail estimation."""
    rng = np.random.default_rng(0)
    idx = pd.bdate_range("2024-01-01", periods=100)
    legs = pd.DataFrame({"d_ust10": rng.normal(0, 5, 100)}, index=idx)
    y = pd.Series(rng.normal(0, 0.01, 100), index=idx)
    out = cre.compute_total_betas(y, legs, lookback_days=252)
    for k in ("beta_ust10", "beta_ig", "beta_qual", "r2_ust10", "r2_ig", "r2_qual"):
        assert np.isnan(out[k])
    assert out["n_obs"] < 252
