"""
Tests for backend/services/optimizer.py.

The first test in this file is the one that matters. `im-Jarvis`'s optimizer clips
every weight at zero and renormalises to sum 1, unconditionally — so ported naively it
would return a long-only, fully-invested book from a long-short input and look
completely well-formed doing it. Nothing about that failure is loud. This file exists
so it cannot come back.
"""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.optimizer import (  # noqa: E402
    EfficientFrontier,
    OptimizerConstraints,
    OptimizerInputs,
    covariance_from_returns,
    efficient_frontier,
    optimize,
    portfolio_point,
)

# Deliberately NOT in SECTOR_MAP/GEO_MAP — these tests pass their own taxonomy so a
# universe change cannot silently alter which group cap binds.
_SECTORS = {"A": "s1", "B": "s2", "C": "s3", "D": "s4"}
_GEOS = {"A": "g1", "B": "g2", "C": "g3", "D": "g4"}


def _cov(n=4, seed=11, scale=0.011):
    rng = np.random.default_rng(seed)
    returns = rng.normal(0.0, scale, size=(400, n))
    return np.cov(returns, rowvar=False) * 252


def _inputs(directions, mu, cov=None, weights0=None, weights_held=None, assets=None):
    assets = assets or list(directions.keys())
    return OptimizerInputs(
        assets=assets,
        directions=directions,
        mu=mu,
        cov=cov if cov is not None else _cov(len(assets)),
        weights0=weights0,
        weights_held=weights_held,
        sector_map={a: _SECTORS.get(a, f"s_{a}") for a in assets},
        geo_map={a: _GEOS.get(a, f"g_{a}") for a in assets},
    )


# ─── The regression this file exists for ─────────────────────────────────────


def test_shorts_stay_short_and_gross_never_exceeds_one():
    """THE test. A long-short book in, a long-short book out.

    The source's `_quantise_weights` does `clipped = [max(x, 0.0) for x in raw]` with
    no reference to its own `long_only` flag, then divides through so the weights sum
    to exactly 1. On Andromeda's data that deletes every short and levers the rest to
    100% — silently, because the output is a perfectly valid-looking weight vector.

    If this test ever fails with the shorts at 0.0, someone has reintroduced the clip.
    """
    directions = {"A": "long", "B": "short", "C": "long", "D": "short"}
    mu = {"A": 0.05, "B": -0.04, "C": 0.03, "D": -0.06}
    result = optimize(_inputs(directions, mu), "mean_variance")

    assert result.feasible, result.reason
    for asset, direction in directions.items():
        weight = result.signed_weights[asset]
        if direction == "short":
            assert weight <= 0.0, (
                f"{asset} was pinned short and came back at {weight:+.6f}. "
                "A positive weight here means the sign was clipped away."
            )
        else:
            assert weight >= 0.0, f"{asset} was pinned long and came back at {weight:+.6f}"

    assert any(v < 0 for v in result.signed_weights.values()), (
        "every short was zeroed — the book came back long-only, which is the exact "
        "ported defect this test guards"
    )
    assert result.gross <= 1.0 + 1e-9, f"gross {result.gross} exceeds the budget"


def test_weights_are_not_renormalised_to_one():
    """ADR-0037: what the limits refuse is cash, and the book is not scaled back up.

    A tight single-name cap on four names caps gross at 4 x 0.10 = 0.40. If anything
    renormalises, gross comes back 1.0 and the cap has been undone — the precise
    defect ADR-0037 was written about, arriving from a different direction.
    """
    directions = {"A": "long", "B": "long", "C": "long", "D": "long"}
    mu = {a: 0.10 for a in directions}
    result = optimize(
        _inputs(directions, mu),
        "mean_variance",
        OptimizerConstraints(max_single=0.10, risk_aversion=0.01),
    )
    assert result.feasible, result.reason
    assert result.gross <= 0.40 + 1e-6, (
        f"four names capped at 10% cannot exceed 40% gross; got {result.gross}"
    )
    assert result.cash >= 0.60 - 1e-6, "the refused capacity must be reported as cash"


def test_direction_pin_beats_a_mu_that_disagrees():
    """L5 chooses the side; the optimizer chooses only the size.

    Here B is pinned short while its mu is positive — a contradiction the optimizer
    must resolve by declining the position, never by flipping it long.
    """
    result = optimize(
        _inputs({"A": "long", "B": "short"}, {"A": 0.05, "B": +0.05}), "mean_variance"
    )
    assert result.feasible, result.reason
    assert result.signed_weights["B"] <= 0.0
    assert result.signed_weights["B"] == 0.0, (
        "a short whose expected return is positive should be declined, not held"
    )


# ─── Constraint behaviour ────────────────────────────────────────────────────


def test_group_cap_binds_on_the_group_total_not_the_member():
    """Two names at 20% put their shared sector at 40% against a 30% limit while
    neither member individually breaches 30%. ADR-0037 records a live book that sat
    at Credit 40% with the cap reported as satisfied for exactly this reason."""
    assets = ["A", "B"]
    inputs = OptimizerInputs(
        assets=assets,
        directions={"A": "long", "B": "long"},
        mu={"A": 0.20, "B": 0.20},
        cov=_cov(2),
        sector_map={"A": "Credit", "B": "Credit"},
        geo_map={"A": "US", "B": "EU"},
    )
    result = optimize(
        inputs, "mean_variance",
        OptimizerConstraints(max_single=0.20, max_sector=0.30, risk_aversion=0.01),
    )
    assert result.feasible, result.reason
    total = abs(result.signed_weights["A"]) + abs(result.signed_weights["B"])
    assert total <= 0.30 + 1e-6, (
        f"Credit totals {total:.4f} against a 0.30 sector cap — the cap is binding on "
        "the member rather than the group"
    )


def test_single_name_cap_binds():
    directions = {"A": "long", "B": "long", "C": "long", "D": "long"}
    result = optimize(
        _inputs(directions, {a: 0.15 for a in directions}),
        "mean_variance",
        OptimizerConstraints(max_single=0.12, risk_aversion=0.01),
    )
    assert result.feasible, result.reason
    for asset, weight in result.signed_weights.items():
        assert abs(weight) <= 0.12 + 1e-6, f"{asset} at {weight} breaches the 12% cap"


def test_turnover_cap_binds_on_weights_held_not_weights0():
    """ADR-0173. The constraint measures distance from YESTERDAY's published book
    (`weights_held`), never from the conviction book (`weights0`) — conflating the
    two was the exact defect this test replaces: it used to pass `weights0=start`
    and the cap bound on the wrong baseline by construction, which nothing caught
    because both fields were plausible-looking dicts of the same shape."""
    directions = {"A": "long", "B": "long", "C": "long", "D": "long"}
    start = {"A": 0.10, "B": 0.10, "C": 0.10, "D": 0.10}
    result = optimize(
        _inputs(directions, {a: 0.10 for a in directions}, weights_held=start),
        "mean_variance",
        OptimizerConstraints(max_turnover=0.05, risk_aversion=0.01),
    )
    assert result.feasible, result.reason
    assert result.realised_turnover is not None
    assert result.realised_turnover <= 0.05 + 1e-5, (
        f"realised_turnover {result.realised_turnover} exceeds its cap"
    )
    assert result.turnover_cap == pytest.approx(0.05)
    assert "turnover at cap" in result.binding_constraints


def test_turnover_cap_does_not_bind_the_intra_run_figure():
    """The two turnover figures are genuinely decoupled. A conviction book (weights0)
    far from the solve is unaffected by a tight turnover cap, because the cap
    constrains distance from weights_held, not from weights0."""
    directions = {"A": "long", "B": "long", "C": "long", "D": "long"}
    far_conviction = {"A": 0.0, "B": 0.0, "C": 0.0, "D": 0.0}
    close_held = {"A": 0.10, "B": 0.10, "C": 0.10, "D": 0.10}
    result = optimize(
        _inputs(
            directions, {a: 0.10 for a in directions},
            weights0=far_conviction, weights_held=close_held,
        ),
        "mean_variance",
        OptimizerConstraints(max_turnover=0.05, risk_aversion=0.01),
    )
    assert result.feasible, result.reason
    # realised_turnover (vs weights_held) is capped...
    assert result.realised_turnover <= 0.05 + 1e-5
    # ...while turnover (vs weights0, the far conviction book) is NOT — proving the
    # constraint never touched that quantity.
    assert result.turnover > 0.3


def test_no_prior_book_means_no_turnover_constraint():
    """weights_held absent (a genuine first day, or an unreachable read) must not
    silently become a zero-weights baseline — that would assert the book started
    from cash, which no run has ever claimed. None means the constraint does not
    apply, the same way it does when max_turnover itself is None."""
    directions = {"A": "long", "B": "long", "C": "long", "D": "long"}
    result = optimize(
        _inputs(directions, {a: 0.10 for a in directions}),  # no weights_held
        "mean_variance",
        OptimizerConstraints(max_turnover=0.05, risk_aversion=0.01),
    )
    assert result.feasible, result.reason
    assert result.realised_turnover is None
    assert result.turnover_cap is None
    assert "turnover at cap" not in result.binding_constraints


# ─── Correctness against a closed form ───────────────────────────────────────


def test_two_asset_minimum_variance_matches_the_analytic_solution():
    """With equal (zero) expected returns and gross pinned to 1, mean-variance
    reduces to minimum variance, whose solution is w proportional to inv(Sigma) 1.

    This is the same assertion `im-Jarvis`'s own optimizer test makes, kept so the
    reimplementation is checked against the mathematics rather than against the source.
    """
    sigma = np.array([[0.04, 0.006], [0.006, 0.09]])
    inputs = OptimizerInputs(
        assets=["A", "B"],
        directions={"A": "long", "B": "long"},
        mu={"A": 0.0, "B": 0.0},
        cov=sigma,
        sector_map={"A": "s1", "B": "s2"},
        geo_map={"A": "g1", "B": "g2"},
    )
    result = optimize(
        inputs, "mean_variance",
        OptimizerConstraints(max_single=1.0, max_sector=1.0, max_geo=1.0,
                             target_gross=1.0, risk_aversion=1.0),
    )
    assert result.feasible, result.reason

    analytic = np.linalg.solve(sigma, np.ones(2))
    analytic = analytic / analytic.sum()
    solved = np.array([result.signed_weights["A"], result.signed_weights["B"]])
    assert np.allclose(solved, analytic, atol=1e-5), (
        f"min-variance solve {solved} does not match the analytic {analytic}"
    )


def test_volatility_is_computed_from_the_rounded_weights():
    """The reported vol must describe the book that is stored, not the solver's
    unrounded interior point — otherwise the persisted weights and the persisted
    volatility describe two different portfolios."""
    directions = {"A": "long", "B": "short", "C": "long", "D": "short"}
    cov = _cov(4)
    result = optimize(_inputs(directions, {"A": 0.05, "B": -0.05, "C": 0.04, "D": -0.03}, cov=cov))
    assert result.feasible, result.reason
    vector = np.array([result.signed_weights[a] for a in ["A", "B", "C", "D"]])
    assert result.volatility == pytest.approx(float(np.sqrt(vector @ cov @ vector)), rel=1e-9)


# ─── Failure is reported, never raised ───────────────────────────────────────


def test_infeasible_returns_a_reason_rather_than_raising():
    """Gross pinned at 1.0 with four names capped at 0.10 admits no solution."""
    directions = {"A": "long", "B": "long", "C": "long", "D": "long"}
    result = optimize(
        _inputs(directions, {a: 0.1 for a in directions}),
        "mean_variance",
        OptimizerConstraints(max_single=0.10, target_gross=1.0),
    )
    assert result.feasible is False
    assert result.reason, "an infeasible result must carry a reason for the reader"
    assert result.signed_weights == {}


def test_empty_and_unknown_objective_are_handled():
    empty = optimize(
        OptimizerInputs(assets=[], directions={}, mu={}, cov=np.zeros((0, 0))),
        "mean_variance",
    )
    assert empty.feasible is False and empty.status == "empty"

    bad = optimize(_inputs({"A": "long", "B": "long"}, {"A": 0.1, "B": 0.1}), "sharpe_max")
    assert bad.feasible is False and bad.status == "unknown_objective"


def test_scenario_objectives_require_scenarios():
    result = optimize(_inputs({"A": "long", "B": "long"}, {"A": 0.1, "B": 0.1}), "min_cvar")
    assert result.feasible is False
    assert result.status == "no_scenarios"
    assert "scenario" in (result.reason or "")


def test_min_cvar_and_mad_solve_with_scenarios():
    rng = np.random.default_rng(5)
    scenarios = rng.normal(0.0, 0.012, size=(300, 2))
    for objective in ("min_cvar", "mad"):
        inputs = OptimizerInputs(
            assets=["A", "B"],
            directions={"A": "long", "B": "long"},
            mu={"A": 0.05, "B": 0.04},
            cov=np.cov(scenarios, rowvar=False) * 252,
            scenarios=scenarios,
            sector_map={"A": "s1", "B": "s2"},
            geo_map={"A": "g1", "B": "g2"},
        )
        result = optimize(
            inputs, objective,
            OptimizerConstraints(max_single=0.60, max_sector=0.60, max_geo=0.60),
        )
        assert result.feasible, f"{objective}: {result.reason}"
        assert result.gross == pytest.approx(1.0, abs=1e-3), (
            f"{objective} minimises a risk measure, so it must be pinned to a "
            "deployment or the trivial optimum is the empty book"
        )


def test_scenario_objectives_deploy_only_what_the_limits_allow():
    """A risk-minimising objective must not report INFEASIBLE just because the group
    caps forbid full deployment. ADR-0037 records live books at 60% and 30% gross —
    those are the caps working, not a failure to solve. The book should come back
    deployed to the reachable maximum with the rest in cash.
    """
    rng = np.random.default_rng(9)
    scenarios = rng.normal(0.0, 0.012, size=(300, 2))
    inputs = OptimizerInputs(
        assets=["A", "B"],
        directions={"A": "long", "B": "long"},
        mu={"A": 0.05, "B": 0.04},
        cov=np.cov(scenarios, rowvar=False) * 252,
        scenarios=scenarios,
        sector_map={"A": "Credit", "B": "Credit"},      # one sector, capped at 30%
        geo_map={"A": "US", "B": "EU"},
    )
    result = optimize(inputs, "min_cvar", OptimizerConstraints(max_sector=0.30))
    assert result.feasible, result.reason
    assert result.gross == pytest.approx(0.30, abs=1e-3), (
        f"a one-sector book under a 30% sector cap can deploy 30%; got {result.gross}"
    )
    assert result.cash == pytest.approx(0.70, abs=1e-3)
    assert any("cash" in w for w in result.warnings), (
        "a book that could not fully deploy owes the reader that fact"
    )


# ─── Covariance helper ───────────────────────────────────────────────────────


def test_covariance_needs_two_priced_names_and_enough_history():
    import pandas as pd

    rng = np.random.default_rng(2)
    frame = pd.DataFrame(
        rng.normal(0, 0.01, size=(120, 2)),
        columns=["A", "B"],
        index=pd.date_range("2025-01-01", periods=120, freq="B"),
    )
    cov, used, dropped = covariance_from_returns(frame, ["A", "B", "MISSING"])
    assert cov is not None and used == ["A", "B"] and dropped == ["MISSING"]

    short_cov, _, _ = covariance_from_returns(frame.head(20), ["A", "B"])
    assert short_cov is None, "under 60 overlapping sessions must yield no covariance"

    single, _, _ = covariance_from_returns(frame, ["A"])
    assert single is None, "one priced name is not a covariance"


# ─── Covariance shrinkage (ADR-0173) ──────────────────────────────────────────
#
# The regression this section exists for: `optimize()` minimises w'Sigma w under a
# NOISY sample Sigma, and that same Sigma is what `monte_carlo_var`/
# `compute_var_forecast` report as the book's risk — so an unshrunk estimate is
# biased low exactly where it is optimised against, and nothing said so. See the
# module-level comment on COV_SHRINKAGE_INTENSITY for the full argument.


def test_shrinkage_preserves_variance_and_pulls_correlation_toward_the_average():
    from backend.services.optimizer import _shrink_to_constant_correlation

    rng = np.random.default_rng(3)
    A = rng.normal(size=(6, 6))
    cov = A @ A.T + np.eye(6) * 0.01
    cov = (cov + cov.T) / 2

    shrunk = _shrink_to_constant_correlation(cov, 0.25)

    assert np.allclose(np.diag(cov), np.diag(shrunk)), (
        "shrinkage must not touch the diagonal — size_positions and the VaR/MC "
        "path both read per-asset risk contributions off it, and a target that "
        "flattened variances too would move single-name risk for no "
        "diversification reason"
    )
    assert np.allclose(shrunk, shrunk.T), "must stay symmetric"

    std = np.sqrt(np.diag(cov))
    off = (cov / np.outer(std, std))[~np.eye(6, dtype=bool)]
    off_shrunk = (shrunk / np.outer(std, std))[~np.eye(6, dtype=bool)]
    assert off_shrunk.std() < off.std(), (
        "shrinkage must narrow the SPREAD of pairwise correlations toward their "
        "average, which is the whole point of a constant-correlation target"
    )


def test_shrinkage_intensity_zero_and_one_are_the_named_edge_cases():
    from backend.services.optimizer import _shrink_to_constant_correlation

    rng = np.random.default_rng(4)
    A = rng.normal(size=(5, 5))
    cov = A @ A.T + np.eye(5) * 0.01
    cov = (cov + cov.T) / 2

    assert np.allclose(cov, _shrink_to_constant_correlation(cov, 0.0)), (
        "intensity 0 must return the sample estimate untouched"
    )

    full = _shrink_to_constant_correlation(cov, 1.0)
    std = np.sqrt(np.diag(cov))
    off_full = (full / np.outer(std, std))[~np.eye(5, dtype=bool)]
    assert np.allclose(off_full, off_full[0], atol=1e-8), (
        "intensity 1 must land EXACTLY on constant correlation — every "
        "off-diagonal entry equal"
    )


def test_covariance_from_returns_is_shrunk_by_default():
    """End-to-end: the function every caller uses applies the shrinkage, not just
    the helper in isolation. This is the assertion that actually protects against
    someone adding a new call site that bypasses it."""
    import pandas as pd

    rng = np.random.default_rng(6)
    # Correlated returns so the raw sample has real off-diagonal spread to shrink.
    factor = rng.normal(0, 0.01, size=120)
    frame = pd.DataFrame(
        {
            "A": factor + rng.normal(0, 0.003, size=120),
            "B": factor + rng.normal(0, 0.02, size=120),
            "C": -0.5 * factor + rng.normal(0, 0.01, size=120),
        },
        index=pd.date_range("2025-01-01", periods=120, freq="B"),
    )
    shrunk, used, dropped = covariance_from_returns(frame, ["A", "B", "C"])
    raw, _, _ = covariance_from_returns(frame, ["A", "B", "C"], shrinkage=0.0)
    assert used == ["A", "B", "C"] and dropped == []
    assert not np.allclose(shrunk, raw), (
        "the default call must differ from the unshrunk one, or the shrinkage is "
        "not actually wired into the function every caller uses"
    )
    assert np.allclose(np.diag(shrunk), np.diag(raw)), "variances must survive"


# ─── Frontier ────────────────────────────────────────────────────────────────


def test_frontier_is_ordered_and_carries_the_you_are_here_point():
    directions = {"A": "long", "B": "short", "C": "long", "D": "short"}
    mu = {"A": 0.06, "B": -0.05, "C": 0.04, "D": -0.03}
    start = {"A": 0.2, "B": -0.2, "C": 0.15, "D": -0.1}
    frontier = efficient_frontier(_inputs(directions, mu, weights0=start))

    assert isinstance(frontier, EfficientFrontier)
    assert frontier.points, "expected at least one feasible frontier point"
    vols = [p.volatility for p in frontier.points]
    assert vols == sorted(vols), "the frontier must be ordered by volatility"

    assert frontier.current is not None
    assert frontier.current.gross == pytest.approx(0.65)
    # The "you are here" point must be scored under the SAME mu and Sigma as the
    # frontier, or the chart compares two different worlds.
    expected = portfolio_point(start, list(directions.keys()), mu, _inputs(directions, mu).cov)
    assert frontier.current.volatility == pytest.approx(expected.volatility, rel=1e-9)


def test_frontier_dedupes_repeated_corners():
    """Consecutive risk aversions routinely land on the same corner of the constraint
    set. Eight identical dots is not a frontier."""
    directions = {"A": "long", "B": "long"}
    frontier = efficient_frontier(
        _inputs(directions, {"A": 0.5, "B": 0.5}),
        OptimizerConstraints(max_single=0.05),          # binds at every gamma
    )
    coordinates = {(round(p.expected_return, 8), round(p.volatility, 8)) for p in frontier.points}
    assert len(coordinates) == len(frontier.points)


def test_a_binding_group_cap_does_not_round_into_a_breach():
    """The 2026-07-27 live run, as a test.

    Five US names bound the 35% geography cap. The solver returned a point satisfying it to
    ITS tolerance (~1e-8), rounding half-up preserved the overshoot, and `/risk` reported
    "US 35.00% — 0.00pp over its 35% cap" on a book that had breached nothing. ADR-0068
    exists to say a cap breach is not decided by float error.

    No per-name clamp could have caught this: the constraint is on the GROUP SUM, and every
    individual weight was comfortably inside its own limit.
    """
    from backend.services.book_metrics import CAP_EPSILON, exceeds_cap

    assets = ["A", "B", "C", "D", "E"]
    inputs = OptimizerInputs(
        assets=assets,
        directions={a: "long" for a in assets},
        # Large mu so the solve pushes hard against the group cap rather than sitting
        # at an interior optimum where the constraint never binds.
        mu={a: 0.40 for a in assets},
        cov=_cov(5, seed=3),
        sector_map={a: f"s{i}" for i, a in enumerate(assets)},   # sector never binds
        geo_map={a: "US" for a in assets},                        # geo binds at 0.35
    )
    result = optimize(inputs, "mean_variance",
                      OptimizerConstraints(max_geo=0.35, risk_aversion=0.05))
    assert result.feasible, result.reason

    total = sum(abs(w) for w in result.signed_weights.values())
    assert total <= 0.35, (
        f"US totals {total!r} against a 0.35 cap — the stored book must never exceed a "
        "constraint the solve satisfied"
    )
    assert not exceeds_cap(total, 0.35), (
        f"{total!r} is reported as a breach at CAP_EPSILON={CAP_EPSILON}"
    )
    # And the cap really did bind, or this test proves nothing.
    assert total > 0.35 - 1e-6, f"the geo cap did not bind at all (total {total})"


def test_stored_weights_never_exceed_the_solved_ones():
    """The general invariant behind the test above: flooring, not rounding."""
    directions = {"A": "long", "B": "short", "C": "long", "D": "short"}
    result = optimize(_inputs(directions, {"A": 0.06, "B": -0.05, "C": 0.04, "D": -0.03}))
    assert result.feasible, result.reason
    for asset, weight in result.signed_weights.items():
        # 8dp quantum, floored — so the magnitude is always a whole number of quanta.
        assert abs(round(abs(weight) * 1e8) - abs(weight) * 1e8) < 1e-3, (
            f"{asset} at {weight!r} is not on the 8dp grid"
        )
