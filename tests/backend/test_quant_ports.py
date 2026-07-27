"""
Tests for the analytics modules read across from im-Jarvis:
monte_carlo, var_forecast, volatility_models, benchmark_compare, cost_model.

Two themes run through the whole file, because they are the two things a port gets
wrong on arrival:

  * **Units.** Every producer in this repo emits an ANNUALISED covariance. Each of
    these consumers de-annualises internally. A daily covariance passed where an
    annualised one is expected understates risk by a factor of 252 and looks fine.
  * **Signs.** Weights are signed here and unsigned in half of im-Jarvis's fixtures.
    ADR-0101 records what that costs.
"""
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.benchmark_compare import compute_comparison  # noqa: E402
from backend.services.cost_model import (  # noqa: E402
    DEFAULT_COMMISSION_BPS,
    DEFAULT_HALF_SPREAD_BPS,
    estimate_portfolio_costs,
    estimate_trade_cost,
)
from backend.services.monte_carlo import monte_carlo_var  # noqa: E402
from backend.services.var_forecast import compute_var_forecast  # noqa: E402
from backend.services.volatility_models import (  # noqa: E402
    ewma_volatility,
    garch11,
)

ASSETS = ["A", "B", "C"]


def _cov(seed=21, scale=0.011, n=400):
    rng = np.random.default_rng(seed)
    return np.cov(rng.normal(0.0, scale, size=(n, 3)), rowvar=False) * 252


# ─── Monte Carlo VaR ─────────────────────────────────────────────────────────


def test_monte_carlo_is_deterministic_under_a_seed():
    """ADR-0013 says L0-L4 are deterministic. A simulation is allowed here only
    because it is seeded; if this ever fails, the determinism claim is broken."""
    weights = {"A": 0.2, "B": -0.15, "C": 0.1}
    first = monte_carlo_var(ASSETS, weights, _cov(), horizon_days=21, n_sims=2000)
    second = monte_carlo_var(ASSETS, weights, _cov(), horizon_days=21, n_sims=2000)
    assert first.bands[0].var == second.bands[0].var
    assert first.p05_return == second.p05_return


def test_monte_carlo_expected_shortfall_exceeds_var():
    result = monte_carlo_var(ASSETS, {"A": 0.3, "B": 0.3, "C": 0.2}, _cov(), n_sims=4000)
    for band in result.bands:
        assert band.es >= band.var, (
            f"ES {band.es} below VaR {band.var} at {band.confidence} — the mean of a "
            "tail cannot be less extreme than the threshold defining it"
        )
    assert result.bands[1].var > result.bands[0].var, "99% VaR must exceed 95%"


def test_monte_carlo_risk_grows_with_the_horizon():
    weights = {"A": 0.3, "B": 0.3, "C": 0.2}
    one_day = monte_carlo_var(ASSETS, weights, _cov(), horizon_days=1, n_sims=4000)
    one_month = monte_carlo_var(ASSETS, weights, _cov(), horizon_days=21, n_sims=4000)
    assert one_month.bands[0].var > one_day.bands[0].var


def test_monte_carlo_defaults_to_zero_drift():
    """A VaR that quietly assumes the book earns its alpha is not a risk number."""
    result = monte_carlo_var(ASSETS, {"A": 0.3, "B": 0.3, "C": 0.2}, _cov(), n_sims=6000)
    assert result.mean_terminal_return == pytest.approx(0.0, abs=0.01)


def test_monte_carlo_reports_held_but_unpriced_names():
    result = monte_carlo_var(
        ASSETS, {"A": 0.2, "B": -0.2, "MISSING": 0.15}, _cov(), n_sims=1000
    )
    assert result.dropped_assets == ["MISSING"]
    assert any("MISSING" in w for w in result.warnings)


def test_monte_carlo_returns_none_when_there_is_nothing_to_simulate():
    assert monte_carlo_var([], {}, np.zeros((0, 0))) is None
    assert monte_carlo_var(ASSETS, {"A": 0.0, "B": 0.0, "C": 0.0}, _cov()) is None
    assert monte_carlo_var(ASSETS, {"A": 0.2}, np.eye(2)) is None      # shape mismatch


def test_monte_carlo_degrees_of_freedom_below_three_is_corrected():
    result = monte_carlo_var(ASSETS, {"A": 0.3, "B": 0.2, "C": 0.1}, _cov(),
                             df=1.5, n_sims=800)
    assert result.df == 5.0
    assert any("finite variance" in w for w in result.warnings)


def test_student_t_tail_is_heavier_than_gaussian_at_99():
    """The entire reason to simulate rather than use the closed form."""
    weights = {"A": 0.3, "B": 0.3, "C": 0.3}
    cov = _cov()
    mc = monte_carlo_var(ASSETS, weights, cov, horizon_days=1, n_sims=40000,
                         confidence_levels=(0.99,))
    vector = np.array([weights[a] for a in ASSETS])
    daily_sigma = math.sqrt(float(vector @ cov @ vector) / 252)
    gaussian_99 = 2.326347874 * daily_sigma
    assert mc.bands[0].var > gaussian_99, (
        f"t(5) 99% VaR {mc.bands[0].var:.5f} should exceed the Gaussian "
        f"{gaussian_99:.5f}"
    )


# ─── VaR fan ─────────────────────────────────────────────────────────────────


def test_var_fan_follows_square_root_of_time():
    weights = {"A": 0.2, "B": -0.15, "C": 0.1}
    fan = compute_var_forecast(ASSETS, weights, _cov())
    bands = {b.horizon_days: b.quantiles["p95"] for b in fan.bands}
    assert bands[21] == pytest.approx(bands[1] * math.sqrt(21), rel=1e-9)
    assert bands[63] == pytest.approx(bands[1] * math.sqrt(63), rel=1e-9)


def test_var_fan_carries_the_twenty_one_day_horizon():
    """ADR-0090 scores every published pick over 21 trading days. Until this landed
    the book carried no risk number on the horizon it is actually judged over."""
    fan = compute_var_forecast(ASSETS, {"A": 0.2, "B": -0.2, "C": 0.1}, _cov())
    assert 21 in [b.horizon_days for b in fan.bands]


def test_var_fan_one_day_reconciles_with_the_same_covariance():
    """Two ex-ante VaRs built from one covariance must agree at t=1, or one of them
    is wrong. `risk_decomposition` uses z * sqrt(w' Sigma w) annualised; the fan uses
    the daily sigma. They differ only by sqrt(252)."""
    weights = {"A": 0.2, "B": -0.15, "C": 0.1}
    cov = _cov()
    fan = compute_var_forecast(ASSETS, weights, cov)
    vector = np.array([weights[a] for a in ASSETS])
    annual_sigma = math.sqrt(float(vector @ cov @ vector))
    assert fan.portfolio_volatility_annual == pytest.approx(annual_sigma, rel=1e-9)
    assert fan.portfolio_volatility_daily == pytest.approx(
        annual_sigma / math.sqrt(252), rel=1e-9
    )


def test_var_fan_states_its_assumption_in_the_payload():
    fan = compute_var_forecast(ASSETS, {"A": 0.3, "B": 0.2, "C": 0.1}, _cov())
    payload = fan.to_dict()
    assert "IID" in payload["assumption"]
    assert payload["method"]


def test_var_fan_is_none_when_there_is_no_volatility_to_project():
    assert compute_var_forecast(ASSETS, {}, _cov()) is None
    assert compute_var_forecast(ASSETS, {"A": 0.0, "B": 0.0, "C": 0.0}, _cov()) is None


def test_var_fan_uses_signed_weights():
    """A hedge reduces portfolio vol. If the sign were dropped, the market-neutral
    book below would look riskier than the outright long."""
    cov = np.array([[0.04, 0.035, 0.0], [0.035, 0.04, 0.0], [0.0, 0.0, 0.04]])
    hedged = compute_var_forecast(ASSETS, {"A": 0.3, "B": -0.3, "C": 0.0}, cov)
    outright = compute_var_forecast(ASSETS, {"A": 0.3, "B": 0.3, "C": 0.0}, cov)
    assert hedged.portfolio_volatility_annual < outright.portfolio_volatility_annual


# ─── Volatility models ───────────────────────────────────────────────────────


def test_ewma_reacts_to_a_recent_shock_where_the_sample_sd_barely_moves():
    """The whole point of a conditional estimator."""
    calm = [0.001, -0.001] * 150
    shocked = calm + [0.06, -0.055, 0.05, -0.045, 0.058]

    sample_before = float(np.std(calm, ddof=1))
    sample_after = float(np.std(shocked, ddof=1))
    ewma_before = ewma_volatility(calm).annualised_vol
    ewma_after = ewma_volatility(shocked).annualised_vol

    assert ewma_after / ewma_before > sample_after / sample_before, (
        "EWMA must respond to the shock more sharply than the trailing sample sd, "
        "which is the reason to prefer it for a conviction denominator"
    )


def test_ewma_series_has_one_point_per_observation():
    returns = list(np.random.default_rng(1).normal(0, 0.01, 120))
    result = ewma_volatility(returns)
    assert len(result.series) == len(returns)
    assert result.annualised_vol == pytest.approx(
        result.daily_vol * math.sqrt(252), rel=1e-12
    )


def test_ewma_guards_its_inputs():
    assert ewma_volatility([]).warnings
    assert ewma_volatility([0.01]).warnings
    assert ewma_volatility([0.01, 0.02], lam=1.5).warnings


def test_garch_is_stationary_and_reports_its_long_run_vol():
    rng = np.random.default_rng(8)
    returns = list(rng.normal(0, 0.012, 400))
    fit = garch11(returns)
    assert 0.0 <= fit.persistence < 1.0, "a non-stationary fit has no long-run variance"
    assert fit.alpha >= 0 and fit.beta >= 0
    assert fit.longrun_annualised_vol > 0
    assert fit.omega == pytest.approx((1 - fit.alpha - fit.beta) * (fit.longrun_annualised_vol ** 2 / 252), rel=1e-6)


def test_garch_degrades_to_ewma_on_a_short_sample_and_says_so():
    fit = garch11([0.01, -0.01] * 5)
    assert fit.converged is False
    assert any("EWMA" in w for w in fit.warnings)
    assert fit.daily_vol > 0, "it must still return a usable volatility"


def test_garch_handles_a_zero_variance_sample():
    fit = garch11([0.0] * 60)
    assert fit.daily_vol == 0.0 and fit.converged is False
    assert any("zero-variance" in w for w in fit.warnings)


# ─── Benchmark comparison ────────────────────────────────────────────────────


def _series(values, start=1):
    return [(f"2026-01-{start + i:02d}", v) for i, v in enumerate(values)]


def test_comparison_uses_only_the_common_dates():
    portfolio = [("2026-01-01", 0.01), ("2026-01-02", 0.02), ("2026-01-03", 0.03)]
    benchmark = [("2026-01-02", 0.01), ("2026-01-03", 0.01), ("2026-01-09", 0.05)]
    result = compute_comparison(portfolio, benchmark)
    assert result.n == 2, "a session present in only one series says nothing"
    assert result.as_of == "2026-01-03"


def test_a_book_that_moves_opposite_the_market_has_negative_down_capture():
    """The claim this book actually makes. A short book should capture LESS than none
    of a market fall, and nothing measured that before."""
    benchmark_moves = [-0.02, 0.01, -0.03, 0.02, -0.01, 0.015]
    portfolio_moves = [+0.02, -0.01, +0.03, -0.02, +0.01, -0.015]
    result = compute_comparison(_series(portfolio_moves), _series(benchmark_moves))
    assert result.down_capture is not None
    assert result.down_capture < 0, (
        f"a book that rises when the benchmark falls must show negative down-capture; "
        f"got {result.down_capture}"
    )
    assert result.beta is not None and result.beta < 0


def test_tracking_error_is_zero_when_the_book_tracks_exactly():
    moves = [0.01, -0.02, 0.015, 0.004, -0.01, 0.02]
    result = compute_comparison(_series(moves), _series(moves))
    assert result.tracking_error == pytest.approx(0.0, abs=1e-12)
    assert result.information_ratio is None, "IR is undefined at zero tracking error"
    assert result.active_return == pytest.approx(0.0, abs=1e-12)
    assert result.up_capture == pytest.approx(1.0)


def test_thin_samples_are_flagged_rather_than_hidden():
    result = compute_comparison(_series([0.01, 0.02]), _series([0.005, 0.01]))
    assert result.n == 2
    assert result.sufficient is False
    assert result.warnings


def test_comparison_returns_none_on_no_overlap():
    assert compute_comparison([], []) is None
    assert compute_comparison([("2026-01-01", 0.01)], [("2026-02-01", 0.01)]) is None


def test_overlay_compounds_from_a_shared_origin():
    portfolio = _series([0.10, 0.10])
    benchmark = _series([0.05, 0.05])
    result = compute_comparison(portfolio, benchmark)
    assert result.overlay[-1]["portfolio_cumulative"] == pytest.approx(0.21)
    assert result.overlay[-1]["benchmark_cumulative"] == pytest.approx(0.1025)
    assert result.portfolio_cumulative == pytest.approx(
        result.overlay[-1]["portfolio_cumulative"]
    )


# ─── Cost model ──────────────────────────────────────────────────────────────


def test_cost_is_linear_in_the_traded_value():
    assert estimate_trade_cost(1_000_000) == pytest.approx(
        1_000_000 * (DEFAULT_COMMISSION_BPS + DEFAULT_HALF_SPREAD_BPS) / 10_000
    )
    assert estimate_trade_cost(-1_000_000) == estimate_trade_cost(1_000_000), (
        "cost depends on the size of the trade, not its direction"
    )


def test_portfolio_cost_prices_a_signed_delta():
    """A long trimmed +10% -> +6% and a short extended -6% -> -10% are both 4% of
    turnover. Differencing unsigned weights would have missed the direction entirely
    — the signed/unsigned trap ADR-0101 records."""
    result = estimate_portfolio_costs({"A": -0.04, "B": -0.04}, 100_000_000.0)
    assert result.turnover == pytest.approx(0.08)
    assert result.n_trades == 2
    assert result.total_cost == pytest.approx(0.08 * 100_000_000.0 * 15 / 10_000)
    assert result.total_cost_pct == pytest.approx(result.total_cost / 100_000_000.0)


def test_untraded_names_are_not_listed_as_zero_cost_trades():
    result = estimate_portfolio_costs({"A": 0.05, "B": 0.0, "C": 0.0}, 100_000_000.0)
    assert result.n_trades == 1
    assert [t.asset for t in result.per_trade] == ["A"]


def test_cost_parameters_are_parameters():
    cheap = estimate_portfolio_costs({"A": 0.10}, 1_000_000.0,
                                     commission_bps=1.0, half_spread_bps=0.5)
    default = estimate_portfolio_costs({"A": 0.10}, 1_000_000.0)
    assert cheap.total_cost < default.total_cost
    assert cheap.commission_bps == 1.0


def test_cost_payload_states_its_limitation():
    payload = estimate_portfolio_costs({"A": 0.10}, 1_000_000.0).to_dict()
    assert "market-impact" in payload["limitation"]
