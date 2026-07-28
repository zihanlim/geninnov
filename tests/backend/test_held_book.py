"""The held book must not repeat the defect it exists to fix.

The old series assumed rebalancing was instant and free on a book that turns over
50-77% daily. The tests that matter here are therefore the ones that would catch it
becoming free again, or becoming free in a subtler way — earning a return on
positions it did not hold through the period.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.held_book import (  # noqa: E402
    daily_return,
    rebalance,
    step,
    turnover,
    weight_delta,
)

CAPITAL = 100_000_000.0


class TestTradingIsNotFree:
    def test_a_full_turnover_costs_something(self):
        # The defect, stated as a test: yesterday's book sold entirely and replaced.
        out = step(
            previous_held={"AAA": 0.5, "BBB": -0.5},
            target={"CCC": 0.5, "DDD": -0.5},
            price_returns={"AAA": 0.0, "BBB": 0.0},
            total_capital=CAPITAL,
        )
        assert out["turnover"] == pytest.approx(2.0)
        assert out["cost_pct"] > 0
        assert out["cost_usd"] > 0
        # A flat market with a full rebalance LOSES money. Under the old series it
        # returned exactly zero.
        assert out["net_return"] < 0

    def test_net_is_gross_minus_cost(self):
        out = step(
            previous_held={"AAA": 0.5},
            target={"AAA": 0.2},
            price_returns={"AAA": 0.01},
            total_capital=CAPITAL,
        )
        assert out["gross_return"] == pytest.approx(0.005)
        assert out["net_return"] == pytest.approx(out["gross_return"] - out["cost_pct"])
        assert out["return_is_net_of_costs"] is True

    def test_holding_still_costs_nothing(self):
        out = step(
            previous_held={"AAA": 0.4},
            target={"AAA": 0.4},
            price_returns={"AAA": 0.02},
            total_capital=CAPITAL,
        )
        assert out["turnover"] == 0.0
        assert out["cost_pct"] == 0.0
        assert out["net_return"] == pytest.approx(0.008)


class TestNoLookAhead:
    def test_return_is_earned_on_the_book_that_was_held(self):
        # The subtle version of the same defect. If the return were computed on the
        # NEW book, this position would earn a day it was not positioned for.
        out = step(
            previous_held={"AAA": 1.0},
            target={"BBB": 1.0},
            price_returns={"AAA": -0.10, "BBB": +0.10},
            total_capital=CAPITAL,
        )
        # Held AAA through a -10% day. Being told to buy BBB today does not rescue it.
        assert out["gross_return"] == pytest.approx(-0.10)
        assert out["net_return"] < -0.10

    def test_an_empty_opening_book_earns_nothing_rather_than_the_targets_return(self):
        out = step(
            previous_held={},
            target={"AAA": 1.0},
            price_returns={"AAA": 0.05},
            total_capital=CAPITAL,
        )
        assert out["gross_return"] is None
        assert out["nav"] == CAPITAL


class TestAMissingPriceIsNotAFlatDay:
    def test_returns_none_rather_than_treating_a_gap_as_zero(self):
        assert daily_return({"AAA": 0.5, "BBB": 0.5}, {"AAA": 0.01}) is None

    def test_nav_is_carried_not_reset_when_the_return_is_unknown(self):
        out = step(
            previous_held={"AAA": 1.0},
            target={"AAA": 1.0},
            price_returns={},
            total_capital=CAPITAL,
            previous_nav=123_000_000.0,
        )
        assert out["net_return"] is None
        assert out["nav"] == 123_000_000.0


class TestNavCompounds:
    def test_nav_compounds_rather_than_recomputing_from_capital(self):
        nav = CAPITAL
        for _ in range(3):
            out = step(
                previous_held={"AAA": 1.0},
                target={"AAA": 1.0},
                price_returns={"AAA": 0.10},
                total_capital=CAPITAL,
                previous_nav=nav,
            )
            nav = out["nav"]
        # 1.1^3, not 1 + 3*0.1
        assert nav == pytest.approx(CAPITAL * 1.331)
        assert nav != pytest.approx(CAPITAL * 1.30)


class TestSignedWeights:
    def test_a_short_extended_is_turnover_not_a_cancellation(self):
        # -6% to -10% is a 4% trade. Differencing UNSIGNED weights would also give
        # 4 here but gives 16 for a +10% -> -6% flip, which is the real trap.
        assert turnover({"AAA": -0.06}, {"AAA": -0.10}) == pytest.approx(0.04)

    def test_a_direction_flip_is_the_full_distance(self):
        assert turnover({"AAA": 0.10}, {"AAA": -0.06}) == pytest.approx(0.16)

    def test_an_exit_is_priced(self):
        # Iterating only the current book's keys would price entries and silently
        # miss every exit -- a book that sold everything would report no cost.
        assert weight_delta({"AAA": 0.3}, {}) == {"AAA": -0.3}
        assert turnover({"AAA": 0.3}, {}) == pytest.approx(0.3)


class TestTheTurnoverBudget:
    def test_none_means_a_full_rebalance(self):
        held = rebalance({"AAA": 0.5, "BBB": -0.5}, {"AAA": 0.1}, max_turnover=None)
        assert held == {"AAA": 0.5, "BBB": -0.5}

    def test_a_budget_moves_every_name_the_same_fraction(self):
        # Pro-rata, so a partial rebalance is a smaller version of the intended move
        # rather than an arbitrary subset decided by dict ordering.
        held = rebalance(
            target={"AAA": 1.0, "BBB": -1.0},
            previous={"AAA": 0.0, "BBB": 0.0},
            max_turnover=1.0,          # half of the 2.0 required
        )
        assert held["AAA"] == pytest.approx(0.5)
        assert held["BBB"] == pytest.approx(-0.5)

    def test_a_budget_larger_than_needed_does_not_overshoot(self):
        held = rebalance({"AAA": 0.2}, {"AAA": 0.1}, max_turnover=5.0)
        assert held == {"AAA": 0.2}

    def test_tracking_error_is_zero_on_a_full_rebalance_and_reported_anyway(self):
        out = step({"AAA": 0.1}, {"AAA": 0.4}, {"AAA": 0.0}, CAPITAL)
        # Reported even at zero: a field that appears only when non-zero is a field
        # nobody knows to look for.
        assert out["tracking_error"] == pytest.approx(0.0)
        assert "tracking_error" in out

    def test_a_budget_creates_measurable_tracking_error(self):
        out = step({}, {"AAA": 1.0}, {"AAA": 0.0}, CAPITAL, max_turnover=0.25)
        assert out["held"]["AAA"] == pytest.approx(0.25)
        assert out["tracking_error"] == pytest.approx(0.75)
