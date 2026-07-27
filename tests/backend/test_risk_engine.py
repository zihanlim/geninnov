import math
import sys
import os

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.risk_engine import (
    concentration_hhi,
    compute_risk,
    _annualized_sharpe,
    _beta_to_spx,
    _normal_pdf,
    _parametric_cvar,
    _parametric_var,
    _z_score,
)


def _returns(values):
    return pd.Series(values)


def test_wrap_tolerates_as_of_ahead_of_now():
    """UTC date-boundary regression: as_of (a run_date set to today's UTC-midnight)
    can be AHEAD of now() in a +ve timezone (early morning in SGT = UTC+8). _wrap
    must clamp computed_at so validate_numeric's 'computed_at >= as_of' holds,
    rather than crash the whole L4 stage for a few hours each day."""
    from datetime import datetime, timedelta, timezone
    from backend.services.risk_engine import _wrap
    from backend.derivations.numeric import SourceRecord

    future = datetime.now(timezone.utc) + timedelta(hours=6)
    d = _wrap(
        "risk.var_95", "risk.var.v1", 1.0e6, "usd",
        [SourceRecord(table="portfolio_returns", id="rollup", as_of=future)],
        future, status="exact",
    )
    assert d.computed_at >= d.as_of                     # no ValueError raised
    assert d.freshness.observed_age_seconds == 0        # future as_of -> age floored


# ── _z_score / _normal_pdf ───────────────────────────────────────────────────


def test_z_score_95():
    """z(0.95) one-tailed ~ 1.6449."""
    assert abs(_z_score(0.95) - 1.6449) < 0.001


def test_z_score_99():
    """z(0.99) one-tailed ~ 2.3263. Winitzki approximation is ~2e-3 at the tails."""
    assert abs(_z_score(0.99) - 2.3263) < 0.005


def test_normal_pdf_at_zero():
    """phi(0) = 1/sqrt(2*pi) ~ 0.3989."""
    assert abs(_normal_pdf(0) - 0.3989) < 0.001


# ── the shipped parametric helpers ──────────────────────────────────────────
#
# These test `_parametric_var` / `_parametric_cvar` / `_annualized_sharpe` /
# `_beta_to_spx`, which is what `compute_risk` actually calls.
#
# They used to test a parallel public API — `value_at_risk`, `sharpe_ratio`,
# `beta_to_spx`, `conditional_value_at_risk`, `annualized_vol` — that had ZERO
# production callers. Same formulas, but scaled to dollars and gated by
# MIN_DAYS_FOR_*. So the headline risk numbers were verified 23 times over code
# the nightly run never executed, and the code it did execute was barely covered.
# The unused half is deleted (ADR-0101's rule: a live implementation already
# existed) and the formula assertions moved here, where they bind what ships.
#
# The private helpers return a DECIMAL loss fraction; `compute_risk` multiplies by
# portfolio_value. The scaling is therefore tested against `compute_risk` itself
# rather than against a helper that no longer takes a portfolio value.


def test_var_positive_for_nonzero_returns():
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 100))
    assert _parametric_var(rets, 0.95) > 0


def test_var_is_a_decimal_fraction_not_dollars():
    """The unit boundary that the deleted twin blurred by folding PV into the helper."""
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 100))
    assert 0 < _parametric_var(rets, 0.95) < 1


def test_var_scales_with_portfolio_value_through_compute_risk():
    """Scaling now asserted on the SHIPPED path, which is where the multiply happens."""
    rets = list(np.random.default_rng(0).normal(0, 0.02, 100))
    spx = list(np.random.default_rng(1).normal(0, 0.02, 100))
    book = [{"asset": "SPY", "weight": 1.0}]
    r1 = compute_risk(book=book, history=rets, spx_returns=spx, portfolio_value=100_000_000)
    r2 = compute_risk(book=book, history=rets, spx_returns=spx, portfolio_value=200_000_000)
    assert abs(r2["var_95"].value - 2 * r1["var_95"].value) < 1e-6


def test_engine_computes_on_a_short_sample_rather_than_refusing():
    """DELIBERATE, and the reason the deleted twins' MIN_DAYS gates are not missed.

    The engine computes and persists; the decision not to ASSERT an under-sampled
    figure lives at the consumers (`lib/risk/sampleAdequacy.ts`, ADR-0100), so that
    every consumer honours it rather than only the one that drew a tile. A gate here
    would blank `portfolio_risk` for anyone querying it directly.
    """
    rets = list(np.random.default_rng(0).normal(0, 0.02, 3))
    out = compute_risk(book=[{"asset": "SPY", "weight": 1.0}], history=rets,
                       spx_returns=rets, portfolio_value=100_000_000)
    assert out["var_95"].value is not None
    assert out["var_95"].epistemic == "known"


# ── _parametric_cvar ────────────────────────────────────────────────────────


def test_cvar_larger_than_var():
    """For normal returns, CVaR exceeds VaR (the tail is heavier than the threshold)."""
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 200))
    assert _parametric_cvar(rets, 0.95) > _parametric_var(rets, 0.95)


def test_cvar_95_matches_formula():
    """CVaR_0.95 = sigma * phi(1.645) / 0.05, as a decimal."""
    rets = _returns(np.random.default_rng(0).normal(0, 0.02, 200))
    sigma = float(rets.std(ddof=1))
    expected = sigma * 0.1031 / 0.05
    cvar = _parametric_cvar(rets, 0.95)
    assert abs(cvar - expected) / expected < 0.01


# ── _annualized_sharpe ──────────────────────────────────────────────────────


def test_sharpe_is_nan_for_zero_variance_returns():
    """NaN, not None: the shipped helper signals undefined in-band, and `compute_risk`
    is what converts that into an absent value. The deleted twin returned None, so a
    caller migrating between them would have silently changed its own None-check."""
    assert math.isnan(_annualized_sharpe(_returns([0.0] * 100)))


def test_sharpe_higher_for_higher_excess_return():
    rng = np.random.default_rng(42)
    s_low = _annualized_sharpe(_returns(rng.normal(0.0001, 0.01, 100)))
    s_high = _annualized_sharpe(_returns(rng.normal(0.001, 0.01, 100)))
    assert s_high > s_low


def test_sharpe_subtracts_the_risk_free_rate():
    rets = _returns(np.random.default_rng(7).normal(0.001, 0.01, 200))
    assert _annualized_sharpe(rets, risk_free_annual=0.0) > _annualized_sharpe(
        rets, risk_free_annual=0.05
    )


# ── _beta_to_spx ────────────────────────────────────────────────────────────


def test_beta_equals_one_when_perfectly_correlated():
    n = 100
    spx = _returns(np.random.default_rng(0).normal(0.001, 0.01, n))
    assert abs(_beta_to_spx(spx + 0.0001, spx) - 1.0) < 0.01


def test_beta_one_point_five_with_leverage():
    n = 100
    spx = _returns(np.random.default_rng(0).normal(0.001, 0.01, n))
    assert abs(_beta_to_spx(spx * 1.5 + 0.0001, spx) - 1.5) < 0.01


def test_beta_negative_for_inverse_returns():
    n = 100
    spx = _returns(np.random.default_rng(0).normal(0.001, 0.01, n))
    assert _beta_to_spx(-spx + 0.0001, spx) < 0


def test_beta_is_nan_when_the_market_has_no_variance():
    """Same in-band-NaN contract as the Sharpe helper."""
    flat = _returns([0.01] * 50)
    assert math.isnan(_beta_to_spx(_returns(np.random.default_rng(0).normal(0, 0.01, 50)), flat))


# ── concentration_hhi ───────────────────────────────────────────────────────


def test_hhi_zero_for_no_positions():
    assert concentration_hhi([]) == 0.0


def test_hhi_max_for_single_position():
    assert concentration_hhi([1.0]) == 10000.0


def test_hhi_scales_with_concentration():
    hhi_concentrated = concentration_hhi([1.0, 0.0, 0.0])
    hhi_balanced = concentration_hhi([1 / 3, 1 / 3, 1 / 3])
    assert hhi_concentrated > hhi_balanced


# ── compute_risk (derivation-aware) ─────────────────────────────────────────


def test_risk_engine_returns_derivations(monkeypatch):
    from backend.services import risk_engine as re
    book = [
        {"ticker": "A", "weight": 0.5, "price_today": 101.0, "price_yesterday": 100.0},
        {"ticker": "B", "weight": -0.5, "price_today": 99.0, "price_yesterday": 100.0},
    ]
    history = [0.001, -0.002, 0.0005, 0.003]
    out = re.compute_risk(book=book, history=history, spx_returns=[0.001, -0.0015, 0.0006, 0.002])
    assert "var_95" in out and out["var_95"].field_id == "risk.var_95"
    assert out["var_95"].display_status == "estimated"  # parametric
    assert out["var_95"].uncertainty is not None
    assert "hhi" in out


def test_compute_risk_returns_all_keys():
    book = [{"weight": 0.5}, {"weight": 0.5}]
    # 200 obs so VaR/CVaR/Sharpe/Beta are all computable
    rng = np.random.default_rng(0)
    history = rng.normal(0.0005, 0.01, 200).tolist()
    spx = rng.normal(0.0005, 0.01, 200).tolist()
    out = compute_risk(book=book, history=history, spx_returns=spx)
    # The original five, plus the historical/downside estimators added alongside
    # them. `var_95` stays parametric and `var_95_historical` is a SEPARATE key —
    # the two are different methods on the same book and must never be merged.
    assert set(out.keys()) == {
        "var_95", "cvar_95", "sharpe", "beta", "hhi",
        "var_95_historical", "es_95_historical", "sortino", "max_drawdown", "calmar",
    }
    assert out["var_95"].method_id == "risk.var.parametric.v1"
    assert out["var_95_historical"].method_id == "risk.var.historical.v1"
    for key in ("var_95", "cvar_95", "sharpe", "beta",
                "var_95_historical", "es_95_historical", "sortino",
                "max_drawdown", "calmar"):
        d = out[key]
        assert d.display_status == "estimated"
        assert d.value is not None
        assert d.uncertainty is not None
        assert d.uncertainty.method == "analytical"
        assert d.source_records
    assert out["hhi"].display_status == "exact"
    assert out["hhi"].uncertainty is None


def test_compute_risk_hhi_exact_with_short_book():
    """HHI uses |weight| so a 50/50 long/short is HHI=5000 (balanced), exact."""
    book = [{"weight": 0.5}, {"weight": -0.5}]
    out = compute_risk(book=book, history=[0.001] * 200, spx_returns=[0.001] * 200)
    assert out["hhi"].value == 5000.0
    assert out["hhi"].display_status == "exact"


def test_compute_risk_hhi_is_invariant_to_cash_level():
    """HHI measures how concentrated the book's BETS are, not how much is in cash.

    Two positions each at 25% of capital (50% held in cash) are exactly as
    concentrated as the same two at 50% each (fully invested) — both HHI 5000.
    Weighting by raw share of capital instead diluted it to 1250, which on the live
    book put HHI (425) below its own "10 000/N fully diversified" baseline and let
    the 2 000 concentration limit under-fire because cash was lowering the index.
    """
    fully_invested = compute_risk(
        book=[{"weight": 0.5}, {"weight": -0.5}],
        history=[0.001] * 5, spx_returns=[0.001] * 5,
    )
    half_in_cash = compute_risk(
        book=[{"weight": 0.25}, {"weight": -0.25}],
        history=[0.001] * 5, spx_returns=[0.001] * 5,
    )
    assert half_in_cash["hhi"].value == fully_invested["hhi"].value == 5000.0
    # Raw (un-normalised) share-of-capital weighting would have read 0.25²·2·10000 =
    # 1250 — diluted by the cash, and below equal-weight-2's own 5000 floor.
    assert half_in_cash["hhi"].value != 1250.0


def test_compute_risk_emits_estimated_even_with_short_history():
    """Parametric formulas emit 'estimated' (not 'unavailable') even with <30 obs,
    as long as we have at least 2 data points. HHI is exact and doesn't need history."""
    book = [{"weight": 1.0}]
    out = compute_risk(book=book, history=[0.001, -0.002], spx_returns=[0.001, -0.002])
    for key in ("var_95", "cvar_95", "sharpe", "beta"):
        assert out[key].display_status == "estimated"
        assert out[key].value is not None
        assert out[key].uncertainty is not None
    # HHI doesn't need history
    assert out["hhi"].display_status == "exact"
    assert out["hhi"].value == 10000.0


def test_compute_risk_unavailable_when_history_too_short():
    """With <2 obs, we genuinely cannot compute parametric metrics."""
    book = [{"weight": 1.0}]
    out = compute_risk(book=book, history=[0.001], spx_returns=[0.001])
    for key in ("var_95", "cvar_95", "sharpe", "beta"):
        assert out[key].display_status == "unavailable"
        assert out[key].value is None
        assert out[key].unavailable_reason
    assert out["hhi"].display_status == "exact"
    assert out["hhi"].value == 10000.0


def test_compute_risk_hhi_empty_book_is_zero():
    """No positions => HHI = 0, exact."""
    out = compute_risk(book=[], history=[0.001] * 200, spx_returns=[0.001] * 200)
    assert out["hhi"].value == 0.0
    assert out["hhi"].display_status == "exact"


class TestVaRIsScaledToDollars:
    """VaR/CVaR are persisted to portfolio_risk.var_95 and rendered with a
    currency formatter, so compute_risk must emit dollars, not decimals.

    compute_risk accepted portfolio_value and never used it: the parametric
    helpers return `z * sigma` (a decimal ~0.03) and the result was wrapped
    unit="usd". A $100M book with ~2% daily vol persisted var_95 = 0.033 and
    the UI rendered "$0" where the real figure is ~$3.3M.

    These assertions are on magnitude and unit deliberately. The original
    tests only checked that a value was present with the right status, which
    is exactly why the defect shipped.
    """

    BOOK = [
        {"ticker": "AAA", "weight": 0.5, "sector": "tech", "geo": "us"},
        {"ticker": "BBB", "weight": -0.5, "sector": "energy", "geo": "eu"},
    ]
    HISTORY = [0.01, -0.02, 0.015, -0.005, 0.02, -0.01, 0.005, -0.015]
    SPX = [0.008, -0.018, 0.012, -0.004, 0.017, -0.009, 0.004, -0.012]
    CAPITAL = 100_000_000.0

    def _risk(self, **kw):
        from backend.services.risk_engine import compute_risk

        params = dict(
            book=self.BOOK, history=self.HISTORY, spx_returns=self.SPX,
            portfolio_value=self.CAPITAL,
        )
        params.update(kw)
        return compute_risk(**params)

    def test_var_is_a_dollar_amount_not_a_decimal(self):
        var = self._risk()["var_95"]
        assert var.unit == "usd"
        # A ~1.4% daily sigma on $100M is millions, never cents.
        assert var.value > 1_000_000, (
            f"var_95={var.value} looks like a decimal fraction, not dollars"
        )

    def test_var_scales_linearly_with_portfolio_value(self):
        small = self._risk(portfolio_value=1_000_000.0)["var_95"].value
        large = self._risk(portfolio_value=100_000_000.0)["var_95"].value
        assert large == pytest.approx(small * 100.0, rel=1e-6)

    def test_cvar_exceeds_var_and_is_in_dollars(self):
        r = self._risk()
        assert r["cvar_95"].unit == "usd"
        assert r["cvar_95"].value > r["var_95"].value

    def test_ratio_metrics_are_not_scaled_by_capital(self):
        """Sharpe/beta/hhi are unitless; capital must not touch them."""
        small = self._risk(portfolio_value=1_000_000.0)
        large = self._risk(portfolio_value=100_000_000.0)
        for key in ("sharpe", "beta", "hhi"):
            assert small[key].value == pytest.approx(large[key].value)
            assert small[key].unit == "ratio"


class TestBetaAlignsByDate:
    """Beta must align portfolio and SPX returns by DATE, not by position.

    daily_refresh loads both as date-indexed Series, but flattened them to
    plain lists before compute_risk, so _beta_to_spx concatenated them on a
    positional RangeIndex: element 0 of a handful of portfolio rows against
    element 0 of ~252 SPX rows. Beta was meaningless whenever the two series
    differed in length or coverage, which is always.
    """

    def test_beta_uses_date_overlap_not_position(self):
        from backend.services.risk_engine import compute_risk

        # Portfolio moves exactly 2x SPX on the three shared dates. If beta
        # aligns by date it recovers ~2.0; if it aligns by position against the
        # longer, offset SPX series it does not.
        p_dates = ["2026-07-20", "2026-07-21", "2026-07-22"]
        p_vals = [0.02, -0.04, 0.03]
        m_dates = ["2026-07-17", "2026-07-18", "2026-07-20", "2026-07-21", "2026-07-22"]
        m_vals = [0.005, -0.011, 0.01, -0.02, 0.015]

        r = compute_risk(
            book=[{"ticker": "A", "weight": 1.0, "sector": "tech", "geo": "us"}],
            history=p_vals, spx_returns=m_vals,
            history_dates=p_dates, spx_dates=m_dates,
            portfolio_value=100_000_000.0,
        )
        assert r["beta"].value == pytest.approx(2.0, abs=1e-6)

    def test_positional_fallback_preserved_without_dates(self):
        """Equal-length lists with no dates keep the old positional behavior."""
        from backend.services.risk_engine import compute_risk

        r = compute_risk(
            book=[{"ticker": "A", "weight": 1.0, "sector": "tech", "geo": "us"}],
            history=[0.02, -0.04, 0.03], spx_returns=[0.01, -0.02, 0.015],
            portfolio_value=100_000_000.0,
        )
        assert r["beta"].value == pytest.approx(2.0, abs=1e-6)


# ─── Historical + downside estimators (read across from im-Jarvis risk_service) ──
#
# These sit BESIDE the parametric ones. The point of a historical VaR is that it
# carries whatever skew and fat tail the book actually had, so the gap between it and
# the parametric number measures how badly the Gaussian assumption fits. That only
# works if they stay separate columns — hence the method-id assertions.


class TestHistoricalAndDownsideEstimators:
    def test_historical_var_reads_the_empirical_quantile(self):
        from backend.services.risk_engine import _historical_var

        # A deliberately skewed sample: one deep loss the Gaussian cannot see.
        returns = pd.Series([-0.20] + [0.005] * 99)
        historical = _historical_var(returns, 0.95)
        parametric = _parametric_var(returns, 0.95)
        assert historical != pytest.approx(parametric), (
            "on a skewed sample the two methods must disagree — if they agree, one "
            "of them is not doing what its name says"
        )
        assert math.isfinite(historical)

    def test_historical_es_is_at_least_as_severe_as_historical_var(self):
        from backend.services.risk_engine import _historical_es, _historical_var

        rng = np.random.default_rng(3)
        returns = pd.Series(rng.normal(0.0004, 0.01, 300))
        assert _historical_es(returns, 0.95) >= _historical_var(returns, 0.95)

    def test_historical_es_is_nan_when_the_tail_is_empty(self):
        """The mean of nothing is not zero. A zero here would report a book as having
        no tail risk on precisely the sample that cannot say."""
        from backend.services.risk_engine import _historical_es

        assert math.isnan(_historical_es(pd.Series([0.01, 0.01]), 0.95))

    def test_max_drawdown_matches_a_hand_worked_path(self):
        from backend.services.risk_engine import _max_drawdown

        # +10%, then -20%, then +5%. Peak is 1.10; trough is 1.10 * 0.8 = 0.88.
        # Deepest drawdown = 0.88/1.10 - 1 = -0.20.
        assert _max_drawdown(pd.Series([0.10, -0.20, 0.05])) == pytest.approx(-0.20, abs=1e-9)

    def test_max_drawdown_is_zero_for_a_monotonic_climb(self):
        from backend.services.risk_engine import _max_drawdown

        assert _max_drawdown(pd.Series([0.01] * 50)) == 0.0

    def test_max_drawdown_survives_a_total_loss(self):
        """log1p(-1) is -inf. Report the total loss rather than a NaN."""
        from backend.services.risk_engine import _max_drawdown

        assert _max_drawdown(pd.Series([0.01, -1.0, 0.02])) == -1.0

    def test_sortino_denominator_is_untouched_by_upside_volatility(self):
        """The defining property, isolated exactly.

        Both series carry the SAME ten losses; only the upside is amplified. So the
        downside deviation is identical by construction and Sortino must rise purely
        with the mean — while Sharpe's denominator rises too and blunts the gain. This
        is what "penalise only the volatility you mind" means.
        """
        from backend.services.risk_engine import (
            _annualized_sharpe,
            _annualized_sortino,
            _downside_deviation,
        )

        base = pd.Series([0.01] * 90 + [-0.02] * 10)
        boosted = pd.Series([0.05] * 90 + [-0.02] * 10)

        assert _downside_deviation(base) == pytest.approx(_downside_deviation(boosted))
        assert _annualized_sortino(boosted) > _annualized_sortino(base)
        # Sortino scales exactly with the mean; Sharpe does not, because amplifying
        # the upside also widened its denominator.
        assert _annualized_sortino(boosted) / _annualized_sortino(base) == pytest.approx(
            float(boosted.mean()) / float(base.mean()), rel=1e-9
        )
        assert _annualized_sharpe(boosted) / _annualized_sharpe(base) < (
            float(boosted.mean()) / float(base.mean())
        )

    def test_sortino_is_nan_with_no_downside(self):
        from backend.services.risk_engine import _annualized_sortino

        assert math.isnan(_annualized_sortino(pd.Series([0.01] * 50)))

    def test_calmar_is_nan_without_a_drawdown(self):
        """A book that has never been under water has no Calmar. An infinite ratio is
        an artefact of a short sample, not a compliment."""
        from backend.services.risk_engine import _calmar

        assert math.isnan(_calmar(pd.Series([0.01] * 50)))

    def test_calmar_is_annualised_return_over_the_drawdown(self):
        from backend.services.risk_engine import _calmar, _max_drawdown

        returns = pd.Series([0.10, -0.20, 0.05, 0.01, 0.02])
        expected = float(returns.mean()) * 252 / abs(_max_drawdown(returns))
        assert _calmar(returns) == pytest.approx(expected, rel=1e-9)

    def test_quantile_midpoint_matches_pandas(self):
        """Pinned rather than delegated: a quantile is one of nine conventions, and a
        VaR that silently changed convention on a pandas upgrade would be a number
        nobody could reproduce."""
        from backend.services.risk_engine import _quantile_midpoint

        values = [0.01, -0.02, 0.03, -0.04, 0.05, 0.002]
        for q in (0.05, 0.25, 0.5, 0.95):
            assert _quantile_midpoint(values, q) == pytest.approx(
                float(pd.Series(values).quantile(q, interpolation="midpoint")), rel=1e-12
            )

    def test_the_new_derivations_carry_distinct_method_ids(self):
        rng = np.random.default_rng(7)
        out = compute_risk(
            book=[{"weight": 0.5}, {"weight": -0.5}],
            history=rng.normal(0.0004, 0.01, 200).tolist(),
            spx_returns=rng.normal(0.0004, 0.01, 200).tolist(),
        )
        assert out["var_95"].method_id != out["var_95_historical"].method_id
        assert out["var_95"].unit == out["var_95_historical"].unit == "usd"
        assert out["max_drawdown"].value <= 0.0
        for key in ("sortino", "calmar", "max_drawdown"):
            assert out[key].unit == "ratio"

    def test_short_history_marks_the_new_metrics_unavailable_not_zero(self):
        out = compute_risk(book=[{"weight": 1.0}], history=[0.01], spx_returns=[0.01])
        for key in ("var_95_historical", "es_95_historical", "sortino",
                    "max_drawdown", "calmar"):
            assert out[key].display_status == "unavailable"
            assert out[key].value is None
            assert out[key].epistemic == "unknown"
