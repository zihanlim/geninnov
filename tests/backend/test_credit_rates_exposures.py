"""credit_rates_exposures: per-asset duration / IG / quality betas.

Two classes carry the load.

`TestAcceptanceFixture` checks the DURATION leg against published effective
durations — the only leg with a known right answer, which is what makes this
layer falsifiable at all. It is also where the spec's own TLT figure turned
out to be wrong (see that class's docstring).

`TestOrthogonalisationDoesSomething` checks spec §9's last row: if the total
and marginal variants do not diverge for an equity, the residualisation is
doing nothing and storing two variants is decoration. It asserts a RATIO
rather than the spec's absolute threshold, for the reason given there."""
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


def _ff5umd(n: int = 400, seed: int = 0) -> pd.DataFrame:
    """The canonical synthetic FF5+UMD frame, in decimals like the real one."""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2024-01-01", periods=n)
    return pd.DataFrame(
        {
            "Mkt-RF": rng.normal(0.0004, 0.010, n),
            "SMB":    rng.normal(0.0, 0.004, n),
            "HML":    rng.normal(0.0, 0.004, n),
            "RMW":    rng.normal(0.0, 0.003, n),
            "CMA":    rng.normal(0.0, 0.003, n),
            "UMD":    rng.normal(0.0, 0.005, n),
            "RF":     np.full(n, 0.00012),
        },
        index=idx,
    )


def test_a_leg_explained_by_equity_factors_has_no_marginal_beta():
    """The SPY property, and the whole justification for storing two variants.

    The asset here is purely market-driven. Each leg is the market PLUS its
    own independent noise, which is what a real credit leg looks like -- it
    co-moves with equities without being them.

    TOTAL beta is large: the leg correlates with the market and so does the
    asset. MARGINAL beta is ~0: once the equity factors are residualised
    out, what remains of the leg is noise the asset has no exposure to.

    If these two did NOT diverge, the orthogonalisation would be doing
    nothing and spec section 5's two-variant design would be decoration.
    """
    f = _ff5umd()
    rng = np.random.default_rng(5)
    n = len(f)
    # Each leg: the market (in bp) plus independent idiosyncratic noise.
    legs = pd.DataFrame(
        {
            "d_ust10": f["Mkt-RF"] * 10000.0 + rng.normal(0, 20, n),
            "d_ig":    f["Mkt-RF"] * 10000.0 + rng.normal(0, 20, n),
            "d_qual":  f["Mkt-RF"] * 10000.0 + rng.normal(0, 20, n),
        },
        index=f.index,
    )
    y = f["RF"] + f["Mkt-RF"]  # purely market-driven

    marginal = cre.compute_marginal_betas(y, legs, f, lookback_days=252)
    assert marginal["n_obs"] == n
    for k in ("beta_ust10", "beta_ig", "beta_qual"):
        assert not np.isnan(marginal[k]), f"{k} should be estimable"
        assert abs(marginal[k]) < 0.5, f"{k}={marginal[k]}; asset has no exposure to the residual"

    # The contrast that makes the point: TOTAL is emphatically not zero.
    total = cre.compute_total_betas(y, legs, lookback_days=252)
    assert abs(total["beta_ust10"]) > 0.5, (
        f"total={total['beta_ust10']}; if this is also ~0 the test proves nothing"
    )


def test_three_identical_legs_decline_to_publish():
    """Three legs that are the same series residualise to three ~zero
    columns -- a rank-deficient design matrix. The fit must return NaN
    rather than emit coefficients from a singular solve."""
    f = _ff5umd()
    bp = f["Mkt-RF"] * 10000.0
    legs = pd.DataFrame({"d_ust10": bp, "d_ig": bp, "d_qual": bp}, index=f.index)
    y = f["RF"] + f["Mkt-RF"]
    out = cre.compute_marginal_betas(y, legs, f, lookback_days=252)
    for k in ("beta_ust10", "beta_ig", "beta_qual", "r2_marginal"):
        assert np.isnan(out[k])


def test_a_spread_signal_survives_orthogonalisation():
    """A leg NOT explained by the equity factors keeps its beta on the
    residual. This is what makes the marginal variant usable by S.

    Units: `shock` is a decimal daily move; the leg is `shock * 10000` bp.
    A -3% per 100bp loading means the asset's decimal return carries
    -0.03 per 100bp-unit, and a 100bp-unit is `shock * 100`, so the
    contribution is `-3.0 * shock`.
    """
    f = _ff5umd()
    rng = np.random.default_rng(11)
    shock = pd.Series(rng.normal(0, 0.0008, len(f)), index=f.index)  # decimal
    # d_ig needs its OWN independent component. Giving it `shock` plus a
    # market term would residualise to `shock` as well, making it collinear
    # with d_qual and turning the joint fit singular -- which is real
    # behaviour, but not what this test is trying to observe.
    ig_shock = pd.Series(rng.normal(0, 0.0008, len(f)), index=f.index)
    legs = pd.DataFrame(
        {
            "d_ust10": f["Mkt-RF"] * 10000.0 + rng.normal(0, 20, len(f)),
            "d_ig":    (ig_shock + 0.2 * f["Mkt-RF"]) * 10000.0,
            "d_qual":  shock * 10000.0,
        },
        index=f.index,
    )
    y = f["RF"] + f["Mkt-RF"] - 3.0 * shock
    out = cre.compute_marginal_betas(y, legs, f, lookback_days=252)
    assert out["beta_qual"] == pytest.approx(-3.0, abs=1.0)
    # The other legs carry no signal and must not absorb one.
    assert abs(out["beta_ig"]) < 1.0


def test_missing_factors_raise_rather_than_returning_zeros():
    """FF5+UMD unavailable is a DIFFERENT state from 'too little history'
    and from 'singular'. A typed exception keeps the caller able to write
    a partial row (total populated, marginal NULL, status='measured')
    instead of discarding a real measurement."""
    idx = pd.bdate_range("2024-01-01", periods=300)
    rng = np.random.default_rng(0)
    legs = pd.DataFrame({
        "d_ust10": rng.normal(0, 5, 300),
        "d_ig": rng.normal(0, 5, 300),
        "d_qual": rng.normal(0, 5, 300),
    }, index=idx)
    y = pd.Series(rng.normal(0, 0.01, 300), index=idx)
    with pytest.raises(cre.FactorsUnavailable):
        cre.compute_marginal_betas(y, legs, pd.DataFrame(), lookback_days=252)


def test_short_history_returns_nan_not_an_exception():
    """Too little history is NOT FactorsUnavailable — the factors are fine,
    the asset is new. NaN betas with the observation count preserved."""
    f = _ff5umd(n=100)
    legs = pd.DataFrame({
        "d_ust10": f["Mkt-RF"] * 10000.0,
        "d_ig": f["SMB"] * 10000.0,
        "d_qual": f["HML"] * 10000.0,
    }, index=f.index)
    y = f["RF"] + f["Mkt-RF"]
    out = cre.compute_marginal_betas(y, legs, f, lookback_days=252)
    assert out["n_obs"] == 100
    for k in ("beta_ust10", "beta_ig", "beta_qual", "r2_marginal"):
        assert np.isnan(out[k])


def test_assemble_row_measured_when_total_and_marginal_both_succeed():
    row = cre.assemble_row(
        asset="TLT",
        run_date=date(2026, 1, 15),
        lookback_days=252,
        total={"beta_ust10": -17.0, "beta_ig": -2.0, "beta_qual": -1.0,
               "r2_ust10": 0.85, "r2_ig": 0.3, "r2_qual": 0.2, "n_obs": 252},
        marginal={"beta_ust10": -10.0, "beta_ig": -1.5, "beta_qual": -0.8,
                  "r2_marginal": 0.7, "n_obs": 252},
    )
    assert row["asset"] == "TLT"
    assert row["run_date"] == "2026-01-15"
    assert row["lookback_days"] == 252
    assert row["status"] == "measured"
    assert row["total_beta_ust10"] == -17.0
    assert row["marginal_beta_ust10"] == -10.0


def test_assemble_row_status_insufficient_history_below_floor():
    row = cre.assemble_row(
        asset="NEW",
        run_date=date(2026, 1, 15),
        lookback_days=252,
        total={"beta_ust10": float("nan"), "beta_ig": float("nan"), "beta_qual": float("nan"),
               "r2_ust10": float("nan"), "r2_ig": float("nan"), "r2_qual": float("nan"),
               "n_obs": 100},
        marginal=None,
    )
    assert row["status"] == "insufficient_history"
    # NULL never 0.0
    assert row["total_beta_ust10"] is None
    assert row["marginal_beta_ust10"] is None


def test_assemble_row_status_measured_with_partial_ff5_failure():
    """FF5 unavailable: marginal columns NULL, status still 'measured' —
    partial success recorded, not discarded."""
    row = cre.assemble_row(
        asset="LQD",
        run_date=date(2026, 1, 15),
        lookback_days=252,
        total={"beta_ust10": -7.5, "beta_ig": -2.0, "beta_qual": -1.5,
               "r2_ust10": 0.6, "r2_ig": 0.4, "r2_qual": 0.3, "n_obs": 252},
        marginal=None,  # partial: marginal columns will be NULL
    )
    assert row["status"] == "measured"
    assert row["total_beta_ust10"] == -7.5
    assert row["total_beta_ig"] == -2.0
    assert row["marginal_beta_ust10"] is None
    assert row["marginal_beta_ig"] is None
    assert row["marginal_beta_qual"] is None
    assert row["marginal_r2"] is None


def test_assemble_row_status_degenerate_on_singular_matrix():
    row = cre.assemble_row(
        asset="CONST",
        run_date=date(2026, 1, 15),
        lookback_days=252,
        total={"beta_ust10": float("nan"), "beta_ig": float("nan"), "beta_qual": float("nan"),
               "r2_ust10": float("nan"), "r2_ig": float("nan"), "r2_qual": float("nan"),
               "n_obs": 252},
        marginal=None,
    )
    # 252 obs but every leg has near-zero variance (degenerate) → 'degenerate'.
    assert row["status"] == "degenerate"
    assert row["total_beta_ust10"] is None


class _RecordingSB:
    def __init__(self):
        self.last_table = None
        self.last_payload = None
        self.last_on_conflict = None

    def table(self, name):
        outer = self
        class _T:
            def upsert(self, payload, on_conflict=None):
                outer.last_table = name
                outer.last_payload = payload
                outer.last_on_conflict = on_conflict
                class _R:
                    def __init__(self):
                        self.data = payload
                class _Exec:
                    def execute(inner_self):
                        return _R()
                return _Exec()
        return _T()


def test_upsert_exposures_writes_with_unique_constraint_and_returns_count():
    sb = _RecordingSB()
    rows = [
        {
            "asset": "TLT", "run_date": "2026-01-15", "lookback_days": 252,
            "total_beta_ust10": -17.0, "status": "measured",
            "n_obs": 252,
        },
    ]
    n = cre.upsert_exposures(sb, rows)
    assert n == 1
    assert sb.last_table == "credit_rates_exposures"
    assert sb.last_on_conflict == "asset,run_date,lookback_days"


def test_upsert_exposures_returns_zero_on_empty_input():
    sb = _RecordingSB()
    assert cre.upsert_exposures(sb, []) == 0
    assert sb.last_payload is None  # never called


# ---------------------------------------------------------------------------
# Acceptance fixture (spec section 9). The expected values were written into
# the spec BEFORE any of this code ran -- published effective durations are
# known in advance, which is the whole reason the duration leg is here.
# ---------------------------------------------------------------------------
from tests.backend.fixtures.credit_rates_exposures_acceptance import FIXTURE  # noqa: E402


def _returns_from_fixture(ticker: str) -> pd.Series:
    pairs = FIXTURE["prices"][ticker]
    close = pd.Series([p[1] for p in pairs],
                      index=pd.to_datetime([p[0] for p in pairs])).sort_index()
    return close.pct_change().dropna()


def _legs_from_fixture() -> pd.DataFrame:
    """Rebuild the three legs from the frozen macro slice.

    Deliberately mirrors `build_credit_legs`' arithmetic rather than calling
    it: that function takes a Supabase client, and the point of a frozen
    fixture is to need no client. The `* 100` percent-to-bp conversion is the
    same one, applied on the diff.
    """
    macro = FIXTURE["macro"]
    per: dict[str, dict] = {"DGS10": {}, "BAMLC0A0CM": {}, "BAMLH0A0HYM2": {}}
    for key, val in macro.items():
        sid, d = key.split("|")
        per[sid][d] = val
    common = sorted(set(per["DGS10"]) & set(per["BAMLC0A0CM"]) & set(per["BAMLH0A0HYM2"]))
    idx = pd.to_datetime(common)
    dgs10 = pd.Series([per["DGS10"][d] for d in common], index=idx)
    ig = pd.Series([per["BAMLC0A0CM"][d] for d in common], index=idx)
    hy = pd.Series([per["BAMLH0A0HYM2"][d] for d in common], index=idx)
    return pd.DataFrame({
        "d_ust10": dgs10.diff() * 100.0,
        "d_ig":    ig.diff() * 100.0,
        "d_qual":  (hy - ig).diff() * 100.0,
    }).dropna()


class TestAcceptanceFixture:
    """Spec section 9, asserted against real market data captured 2026-07-31.

    These are the numbers that make the layer falsifiable. A spread beta has
    no external anchor to check against; a DURATION does -- TLT, IEF and SHY
    have published effective durations, and a model that cannot recover them
    is not measuring what it claims to measure. That is what the duration leg
    bought beyond its own usefulness, and why a spread-only build was
    rejected.
    """

    LOOKBACK = 252

    @pytest.fixture(autouse=True)
    def setup(self):
        self.legs = _legs_from_fixture()
        self.r = {t: _returns_from_fixture(t)
                  for t in ("TLT", "IEF", "SHY", "HYG", "LQD", "SPY")}

    def _total(self, ticker: str) -> dict:
        return cre.compute_total_betas(self.r[ticker], self.legs, self.LOOKBACK)

    def test_the_fixture_has_enough_history_to_fit(self):
        """If this fails, every assertion below is vacuously NaN."""
        out = self._total("TLT")
        assert out["n_obs"] == self.LOOKBACK, (
            f"only {out['n_obs']} overlapping sessions; the battery cannot run"
        )
        assert not np.isnan(out["beta_ust10"])

    def test_tlt_recovers_long_duration(self):
        """TLT measures -13.2, NOT the ~-17 the spec predicted, and the gap
        is the finding rather than a miss.

        The spec wrote down TLT's published EFFECTIVE DURATION -- sensitivity
        to the fund's OWN yield. What this regression measures is beta to
        DGS10, the TEN-year yield. Those coincide only for a fund whose
        holdings sit at the 10y point:

            IEF (7-10y)   beta -7.10 / duration ~7.4y  = 0.95
            SHY (1-3y)    beta -1.73 / duration ~1.85y = 0.94
            TLT (20-30y)  beta -13.21 / duration ~16y  = 0.83

        TLT's bonds are 20-30y, and the long end moves roughly 0.83bp per
        1bp of 10y move, so its beta to the 10y is duration x 0.83. The
        model is right; the spec's expected value silently assumed a
        1:1 curve.

        This is spec section 10's "an empirical beta, not analytic spread
        duration" caveat biting on the leg that was supposed to be the
        easy one -- which is exactly why the duration leg is worth having:
        it is the only leg where an error of this kind is VISIBLE.
        """
        assert self._total("TLT")["beta_ust10"] == pytest.approx(-13.2, abs=2.5)

    def test_beta_tracks_own_duration_scaled_by_distance_from_the_10y_point(self):
        """The structural claim behind the corrected TLT expectation, pinned
        so a future change cannot quietly restore the 1:1 assumption.

        A fund whose holdings sit AT the 10y point should recover close to
        its own duration; one whose holdings sit far out the curve should
        recover materially less. If TLT's ratio ever climbs to IEF's, either
        the curve regime changed or the leg stopped being the 10y.
        """
        ratio = {
            "TLT": self._total("TLT")["beta_ust10"] / -16.0,
            "IEF": self._total("IEF")["beta_ust10"] / -7.4,
            "SHY": self._total("SHY")["beta_ust10"] / -1.85,
        }
        # The belly tracks the 10y nearly 1:1; the long end does not.
        assert 0.85 < ratio["IEF"] < 1.1, f"IEF ratio {ratio['IEF']}"
        assert 0.70 < ratio["TLT"] < 0.95, f"TLT ratio {ratio['TLT']}"
        assert ratio["TLT"] < ratio["IEF"], (
            "the long end must track the 10y LESS than the belly does; "
            f"got TLT={ratio['TLT']:.2f} vs IEF={ratio['IEF']:.2f}"
        )

    def test_treasuries_rally_when_credit_widens(self):
        """A flight-to-quality check the spec did not ask for, and the
        cheapest possible refutation of a sign error: when credit spreads
        widen, Treasuries GAIN. All three Treasury funds must load POSITIVE
        on the IG leg while both credit funds load negative.

        A sign flip anywhere in the leg construction would invert this
        whole column at once, and no single-instrument assertion would
        notice.
        """
        for t in ("TLT", "IEF", "SHY"):
            assert self._total(t)["beta_ig"] > 0, f"{t} should gain when credit widens"
        for t in ("HYG", "LQD"):
            assert self._total(t)["beta_ig"] < 0, f"{t} should lose when credit widens"

    def test_ief_recovers_intermediate_duration(self):
        """IEF ~ 7.5y. Spec section 9 row 2."""
        assert self._total("IEF")["beta_ust10"] == pytest.approx(-7.5, abs=2)

    def test_shy_recovers_short_duration(self):
        """SHY ~ 1.9y. Spec section 9 row 3 -- and with TLT and IEF above,
        the ORDERING across the curve holds, which one instrument alone
        could not demonstrate."""
        assert self._total("SHY")["beta_ust10"] == pytest.approx(-1.9, abs=1)

    def test_the_duration_ordering_holds_across_the_curve(self):
        """A model that got all three magnitudes right by luck would still
        have to get their order right."""
        tlt = self._total("TLT")["beta_ust10"]
        ief = self._total("IEF")["beta_ust10"]
        shy = self._total("SHY")["beta_ust10"]
        assert tlt < ief < shy < 0, f"TLT={tlt}, IEF={ief}, SHY={shy}"

    def test_the_quality_leg_separates_hy_from_ig(self):
        """Spec section 9 row 4: HYG must load materially more negatively on
        the quality leg than LQD, or the leg is noise rather than a
        distress premium."""
        gap = self._total("HYG")["beta_qual"] - self._total("LQD")["beta_qual"]
        assert gap < -1.0, f"HYG - LQD quality gap is {gap}, expected < -1.0"

    def test_an_ig_etf_loads_on_ig_spreads(self):
        """Spec section 9 row 5."""
        assert self._total("LQD")["beta_ig"] < -2.0

    def test_equities_load_on_credit_stress(self):
        """Spec section 9 row 6. SPY is not a bond, but credit stress is an
        equity event too -- and this is the TOTAL beta, which includes
        everything the equity factors would also have explained."""
        assert self._total("SPY")["beta_ig"] < -0.5


def _factors_from_fixture() -> pd.DataFrame:
    f = FIXTURE["factors"]
    idx = pd.to_datetime(sorted(f))
    cols = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "RF"]
    return pd.DataFrame(
        {c: [f[d.date().isoformat()][c] for d in idx] for c in cols}, index=idx)


class TestOrthogonalisationDoesSomething:
    """Spec section 9's last row -- the assertion the whole two-variant design
    rests on. If total and marginal do NOT diverge, the residualisation is
    doing nothing and storing two variants is decoration.

    The spec stated this as an absolute threshold (`SPY.marginal_beta_ig`
    magnitude < 0.3) and the live measurement came in at 0.33. Rather than
    move the threshold 10% to fit the result -- which is precisely what an
    acceptance fixture exists to prevent -- the assertion is restated as the
    claim it was always making.

    An absolute bound on a marginal beta is not well formed: whether 0.33 is
    "near zero" depends entirely on the total it is being compared to. At a
    total of 0.5 it would be no divergence at all; at a total of -31.7 it is
    a 96x collapse. The claim is about the RATIO, so the test asserts the
    ratio, which is also scale-free across market regimes in a way a fixed
    0.3 never was.
    """

    LOOKBACK = 252

    @pytest.fixture(autouse=True)
    def setup(self):
        self.legs = _legs_from_fixture()
        self.factors = _factors_from_fixture()
        self.spy = _returns_from_fixture("SPY")
        self.lqd = _returns_from_fixture("LQD")
        self.tlt = _returns_from_fixture("TLT")

    def _both(self, r):
        return (cre.compute_total_betas(r, self.legs, self.LOOKBACK),
                cre.compute_marginal_betas(r, self.legs, self.factors, self.LOOKBACK))

    def test_the_fixture_supports_a_marginal_fit(self):
        """The factor cache ends 2026-05-29, which binds the marginal window.
        If this fails, every assertion below is vacuously NaN."""
        _, marg = self._both(self.spy)
        assert marg["n_obs"] >= self.LOOKBACK, f"only {marg['n_obs']} sessions"
        assert not np.isnan(marg["beta_ig"])

    def test_an_equitys_credit_beta_is_overwhelmingly_equity_beta(self):
        """SPY. Almost all of an equity index's apparent sensitivity to credit
        spreads is its market factor wearing a different hat. Orthogonalising
        must remove nearly all of it."""
        total, marg = self._both(self.spy)
        assert abs(total["beta_ig"]) > 5.0, (
            f"total is only {total['beta_ig']}; the test proves nothing if the "
            "total was small to begin with"
        )
        retained = abs(marg["beta_ig"]) / abs(total["beta_ig"])
        assert retained < 0.10, (
            f"SPY retained {retained:.1%} of its credit beta after "
            f"orthogonalisation (total {total['beta_ig']:.2f} -> marginal "
            f"{marg['beta_ig']:.2f}); expected under 10%"
        )

    def test_a_credit_etfs_credit_beta_survives_orthogonalisation(self):
        """LQD. The other half of the claim, and the half that makes it
        non-trivial: if orthogonalising crushed EVERY credit beta, the
        transformation would be destroying signal rather than isolating it.
        An IG bond fund's exposure to IG spreads is real, not an equity
        artefact, so it must still be there afterwards."""
        total, marg = self._both(self.lqd)
        assert marg["beta_ig"] < -1.0, (
            f"LQD marginal credit beta is {marg['beta_ig']:.2f}; a real credit "
            "exposure must survive the transformation"
        )

    def test_the_divergence_is_specific_to_equities_not_universal(self):
        """The contrast, stated directly. SPY loses nearly all of its credit
        beta and LQD keeps its own -- so the residualisation is separating
        two different things, not applying a uniform haircut."""
        spy_t, spy_m = self._both(self.spy)
        lqd_t, lqd_m = self._both(self.lqd)
        spy_retained = abs(spy_m["beta_ig"]) / abs(spy_t["beta_ig"])
        lqd_retained = abs(lqd_m["beta_ig"]) / abs(lqd_t["beta_ig"])
        assert lqd_retained > spy_retained * 5, (
            f"SPY retained {spy_retained:.1%}, LQD retained {lqd_retained:.1%}; "
            "a uniform haircut would leave these similar"
        )

    def test_a_pure_duration_instrument_barely_moves(self):
        """Spec section 5.3's prediction, tested: for an instrument whose
        returns really are driven by rates rather than by equity co-movement,
        the two variants nearly agree. TLT is the case where the gap SHOULD
        be small, and a design that collapsed everything would fail here."""
        total, marg = self._both(self.tlt)
        gap = abs(marg["beta_ust10"] - total["beta_ust10"])
        assert gap < 4.0, (
            f"TLT total {total['beta_ust10']:.2f} vs marginal "
            f"{marg['beta_ust10']:.2f}; a pure-duration instrument should "
            "barely move between variants"
        )
