"""
Tests for backend/services/expected_returns.py — the mu the optimizer sizes on.

This is the piece that is NOT a port. EdgeScore is a ranking signal in [-1, 1]; a
mean-variance optimizer needs annualised expected returns. The Grinold-Kahn transform
`mu = IC * sigma * z` is the bridge, and every one of its three terms has a failure
mode that shows up as a confidently wrong book rather than as an error.
"""
import inspect
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.edge_signals import compute_edge_score  # noqa: E402
from backend.services.expected_returns import (  # noqa: E402
    EDGE_COMPONENT_WEIGHTS,
    IC_SHRINKAGE,
    IcReading,
    annualised_vol,
    build_mu,
    composite_edge_ic,
)


def _row(component, ic, n=120, end_date="2026-07-26"):
    return {
        "metric_name": f"edge_ic_{component}",
        "realized_value": ic,
        "end_date": end_date,
        "notes": json.dumps({"n": n}),
    }


def _returns(assets, seed=4, n=300, scale=0.011):
    rng = np.random.default_rng(seed)
    return pd.DataFrame(
        rng.normal(0.0, scale, size=(n, len(assets))),
        columns=assets,
        index=pd.date_range("2025-01-01", periods=n, freq="B"),
    )


# ─── The composite IC ────────────────────────────────────────────────────────


def test_blend_weights_match_the_score_they_are_an_ic_of():
    """If `compute_edge_score`'s weights move and this table does not, the composite
    IC is a weighted average of the wrong thing — silently."""
    defaults = {
        name.removeprefix("w_"): param.default
        for name, param in inspect.signature(compute_edge_score).parameters.items()
        if name.startswith("w_")
    }
    assert defaults == EDGE_COMPONENT_WEIGHTS, (
        "EDGE_COMPONENT_WEIGHTS has drifted from compute_edge_score's own defaults"
    )


def test_unmeasured_components_are_renormalised_away_not_scored_zero():
    """ADR-0036/ADR-0066: a component with no measured IC is NOT COMPUTABLE, not zero.

    Scoring it zero would drag the composite toward zero in proportion to how much of
    our signal we have not yet been able to test — penalising the book for a gap in
    our validation rather than for a weakness in the signal.
    """
    reading, reason = composite_edge_ic([_row("trend", 0.04), _row("carry", 0.04)])
    assert reason is None and reading is not None
    # trend 0.35 and carry 0.20 renormalise to 0.636 / 0.364, both ICs being 0.04,
    # so the composite is 0.04 regardless of the two untested components.
    assert reading.raw == pytest.approx(0.04)
    assert sum(reading.weights.values()) == pytest.approx(1.0)
    assert set(reading.weights) == {"trend", "carry"}
    assert any("regime" in note for note in reading.notes)


def test_shrinkage_is_applied_and_reported():
    reading, _ = composite_edge_ic([_row("trend", 0.06)])
    assert reading.raw == pytest.approx(0.06)
    assert reading.value == pytest.approx(0.06 * (1 - IC_SHRINKAGE))
    assert reading.shrinkage == IC_SHRINKAGE


def test_a_negative_composite_is_refused_never_flipped():
    """A weak negative IC means "no demonstrated predictive power", not "the signal
    works backwards". Flipping it would invert every direction L5 chose."""
    reading, reason = composite_edge_ic([_row("trend", -0.05)])
    assert reading is None
    assert "at or below zero" in reason


def test_absent_and_unusable_inputs_each_give_a_reason():
    assert composite_edge_ic([])[0] is None
    assert "no backtest_results" in composite_edge_ic([])[1]

    none_measured, reason = composite_edge_ic([_row("regime", None), _row("sentiment", None)])
    assert none_measured is None
    assert "measured IC" in reason

    # sentiment carries weight 0.0 in the blend, so a reading that only measures it
    # cannot be renormalised into anything.
    zero_weight, reason = composite_edge_ic([_row("sentiment", 0.10)])
    assert zero_weight is None
    assert "zero weight" in reason


def test_malformed_notes_cost_the_observation_count_not_the_reading():
    rows = [{"metric_name": "edge_ic_trend", "realized_value": 0.04,
             "end_date": "2026-07-26", "notes": "not json"}]
    reading, reason = composite_edge_ic(rows)
    assert reason is None and reading is not None
    assert reading.n_observations == 0


# ─── Annualised vol ──────────────────────────────────────────────────────────


def test_short_history_is_omitted_rather_than_zeroed():
    """A zero vol would make mu zero for a name we merely could not measure — a
    different claim from "we expect nothing from it" (ADR-0023)."""
    frame = _returns(["A", "B"], n=300)
    frame.loc[frame.index[:280], "B"] = np.nan          # leaves B with 20 observations
    vols = annualised_vol(frame)
    assert "A" in vols and "B" not in vols
    assert vols["A"] == pytest.approx(
        float(frame["A"].std(ddof=1)) * np.sqrt(252), rel=1e-9
    )


# ─── mu ──────────────────────────────────────────────────────────────────────


def test_mu_carries_the_direction_not_the_sign_of_the_score():
    positions = [
        {"asset": "A", "direction": "long", "edge_score": 0.4},
        {"asset": "B", "direction": "short", "edge_score": -0.4},
        # Direction and score disagree. The position is the fact; the score is the
        # commentary, so the sign must follow `direction`.
        {"asset": "C", "direction": "short", "edge_score": +0.4},
    ]
    mu, dropped = build_mu(positions, _returns(["A", "B", "C"]), 0.05)
    assert dropped == []
    assert mu["A"] > 0
    assert mu["B"] < 0
    assert mu["C"] < 0, "direction must win over the sign of the edge"


def test_mu_is_scaled_not_demeaned():
    """The textbook cross-sectional z-score subtracts the mean, which is right when
    the score also picks the side. Here L5 already picked it, so demeaning would give
    a below-average long a NEGATIVE expected return and push the optimizer to zero a
    position for being less attractive than its book-mates."""
    positions = [
        {"asset": "A", "direction": "long", "edge_score": 0.5},
        {"asset": "B", "direction": "long", "edge_score": 0.3},
        {"asset": "C", "direction": "long", "edge_score": 0.1},
    ]
    mu, _ = build_mu(positions, _returns(["A", "B", "C"]), 0.05)
    assert all(v > 0 for v in mu.values()), (
        f"every name is long with a positive edge, so no mu may be negative: {mu}"
    )
    assert mu["A"] > mu["B"] > mu["C"], "relative magnitudes must be preserved"


def test_mu_scales_with_ic_and_with_vol():
    positions = [{"asset": "A", "direction": "long", "edge_score": 0.4},
                 {"asset": "B", "direction": "long", "edge_score": 0.2}]
    frame = _returns(["A", "B"])
    low, _ = build_mu(positions, frame, 0.02)
    high, _ = build_mu(positions, frame, 0.04)
    assert high["A"] == pytest.approx(2 * low["A"], rel=1e-9), (
        "mu must be linear in the IC — that is what makes a weak signal produce a "
        "smaller book rather than the same book held with less conviction"
    )

    # And the closed form end to end: mu = IC * sigma * (edge / cross-sectional sd).
    vols = annualised_vol(frame)
    dispersion = float(np.std([0.4, 0.2], ddof=1))
    assert low["A"] == pytest.approx(0.02 * vols["A"] * (0.4 / dispersion), rel=1e-9)
    assert low["B"] == pytest.approx(0.02 * vols["B"] * (0.2 / dispersion), rel=1e-9)


def test_unpriced_names_are_reported_not_silently_dropped():
    positions = [{"asset": "A", "direction": "long", "edge_score": 0.4},
                 {"asset": "GONE", "direction": "long", "edge_score": 0.4}]
    mu, dropped = build_mu(positions, _returns(["A", "B"]), 0.05)
    assert "GONE" not in mu
    assert dropped == ["GONE"], "a held name the model cannot see must reach the caller"


def test_no_ic_yields_no_expected_returns():
    positions = [{"asset": "A", "direction": "long", "edge_score": 0.4}]
    for bad_ic in (0.0, -0.1):
        mu, _ = build_mu(positions, _returns(["A", "B"]), bad_ic)
        assert mu == {}


def test_single_name_book_does_not_divide_by_zero_dispersion():
    positions = [{"asset": "A", "direction": "long", "edge_score": 0.4}]
    mu, _ = build_mu(positions, _returns(["A", "B"]), 0.05)
    assert mu["A"] > 0 and np.isfinite(mu["A"])


def test_identical_edges_do_not_divide_by_zero():
    positions = [{"asset": a, "direction": "long", "edge_score": 0.3} for a in ("A", "B", "C")]
    mu, _ = build_mu(positions, _returns(["A", "B", "C"]), 0.05)
    assert len(mu) == 3 and all(np.isfinite(v) and v > 0 for v in mu.values())


def test_ic_reading_round_trips_to_dict():
    reading = IcReading(value=0.02, raw=0.04, shrinkage=0.5, components={"trend": 0.04},
                        weights={"trend": 1.0}, n_observations=120, as_of="2026-07-26")
    payload = reading.to_dict()
    assert payload["value"] == 0.02 and payload["raw"] == 0.04
    assert payload["as_of"] == "2026-07-26"
