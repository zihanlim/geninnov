"""One idea, one expected return — and the whole complex on the menu (ADR-0116).

ADR-0115 capped a correlation complex at one name's worth and claimed the covariance
would then decide the split across its members. It does not. `mu` is
`sign x |EdgeScore| x sigma` (ADR-0111), so while members carry different mu the
optimizer ranks them on EdgeScore — the same criterion `strongest` used — and inside a
block correlated at 0.99 a few percent of mu difference produces a corner solution.

These tests pin the two halves of the fix, which only work together:

  * `equalise_within_complexes` removes EdgeScore from the within-complex ranking, so
    the split is decided by variance alone;
  * `_complex_expressions` widens the menu to the pool members L5 did not name.

The order matters and `test_widening_alone_still_corners` is the reason: widening
without equalising is measurably WORSE than doing neither.
"""
from __future__ import annotations

import numpy as np
import pytest

from backend.services.expected_returns import equalise_within_complexes
from backend.services.optimizer import (
    OptimizerConstraints,
    OptimizerInputs,
    optimize,
)
from backend.services.q1_agent import (
    _complex_expressions,
    _complex_labels,
    _expression_position,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _correlated_cov(vols: dict[str, float], rho_driver: float = 0.9, seed: int = 4):
    """A covariance whose off-diagonal correlation is high, with the given vols."""
    rng = np.random.default_rng(seed)
    driver = rng.normal(0, 1, 600)
    cols = [
        (driver * rho_driver + rng.normal(0, np.sqrt(1 - rho_driver**2), 600))
        * v
        / np.sqrt(252)
        for v in vols.values()
    ]
    return np.cov(np.column_stack(cols), rowvar=False) * 252


def _solve(assets, mu, cov, complex_map, labels=None):
    inputs = OptimizerInputs(
        assets=assets,
        directions={a: "long" for a in assets},
        mu=mu,
        cov=cov,
        sector_map={a: f"s{i}" for i, a in enumerate(assets)},
        geo_map={a: f"g{i}" for i, a in enumerate(assets)},
        complex_map=complex_map,
        complex_labels=labels,
    )
    return optimize(inputs, "mean_variance", OptimizerConstraints(risk_aversion=0.02))


# ── equalise_within_complexes ────────────────────────────────────────────────

class TestEqualiseWithinComplexes:
    def test_members_share_one_mu(self):
        mu = {"QQQ": 0.30, "SPY": 0.20, "IWM": 0.10}
        out, prov = equalise_within_complexes(
            mu, {"QQQ": "long::0", "SPY": "long::0", "IWM": "long::0"}
        )
        assert out == pytest.approx({"QQQ": 0.20, "SPY": 0.20, "IWM": 0.20})
        assert prov["applied"] is True
        assert prov["complexes"][0]["spread_before"] == pytest.approx(0.20)

    def test_ungrouped_names_are_bit_identical(self):
        """A name correlated with nothing is not part of an idea and must not move."""
        mu = {"QQQ": 0.30, "SPY": 0.20, "GLD": 0.123456789}
        out, prov = equalise_within_complexes(
            mu, {"QQQ": "long::0", "SPY": "long::0"}
        )
        assert out["GLD"] == mu["GLD"]
        assert "GLD" not in {
            m for c in prov["complexes"] for m in c["members"]
        }

    def test_singleton_complex_untouched(self):
        mu = {"QQQ": 0.30}
        out, prov = equalise_within_complexes(mu, {"QQQ": "long::0"})
        assert out == mu
        assert prov["applied"] is False

    def test_sign_disagreement_refuses_rather_than_averaging(self):
        """Averaging across a hedge would invent a mu neither side holds."""
        mu = {"A": 0.30, "B": -0.30}
        out, prov = equalise_within_complexes(mu, {"A": "x", "B": "x"})
        assert out == mu
        assert prov["applied"] is False
        assert "sign" in prov["skipped"][0]["reason"]

    def test_empty_map_is_a_no_op(self):
        mu = {"QQQ": 0.30}
        assert equalise_within_complexes(mu, {})[0] == mu


# ── the measured claim this whole change rests on ────────────────────────────

class TestTheSplitIsDecidedByVariance:
    ASSETS = ["SPY", "QQQ", "SVXY"]
    VOLS = {"SPY": 0.15, "QQQ": 0.19, "SVXY": 0.55}
    CMAP = {a: "long::0" for a in ASSETS}

    def test_widening_alone_still_corners(self):
        """Without equalisation the optimizer funds ONE name — the highest-EdgeScore
        one — no matter how many members are on the menu. This is the finding that
        makes widening-without-equalising a regression, and it is why the two changes
        ship together."""
        cov = _correlated_cov(self.VOLS)
        # SVXY carries the highest edge on the live book, and mu is monotone in it.
        mu = {"SPY": 0.100, "QQQ": 0.105, "SVXY": 0.130}
        result = _solve(self.ASSETS, mu, cov, self.CMAP)
        assert result.feasible
        funded = {a: w for a, w in result.signed_weights.items() if abs(w) > 1e-6}
        assert list(funded) == ["SVXY"], funded

    def test_equalised_mu_routes_around_the_high_vol_member(self):
        """The point of the change: with one mu the linear term depends only on the
        complex TOTAL, so the split is settled by the quadratic term — and the book
        carries the exposure through the member that costs least variance."""
        cov = _correlated_cov(self.VOLS)
        mu = {"SPY": 0.100, "QQQ": 0.105, "SVXY": 0.130}
        equalised, _ = equalise_within_complexes(mu, self.CMAP)
        result = _solve(self.ASSETS, equalised, cov, self.CMAP)
        assert result.feasible
        weights = result.signed_weights
        assert weights["SVXY"] == pytest.approx(0.0, abs=1e-6), weights
        assert weights["SPY"] > weights["QQQ"] > 0.0, weights

    def test_the_complex_cap_still_binds_the_total(self):
        cov = _correlated_cov(self.VOLS)
        mu = {a: 0.12 for a in self.ASSETS}
        result = _solve(self.ASSETS, mu, cov, self.CMAP)
        total = sum(abs(w) for w in result.signed_weights.values())
        assert total <= OptimizerConstraints().max_complex + 1e-6


# ── binding constraints name the idea, not an index ──────────────────────────

class TestBindingConstraintNaming:
    def test_label_replaces_the_internal_id(self):
        assets = ["SPY", "QQQ"]
        cov = _correlated_cov({"SPY": 0.15, "QQQ": 0.19})
        cmap = {a: "long::0" for a in assets}
        result = _solve(
            assets, {a: 0.40 for a in assets}, cov, cmap,
            labels={"long::0": "long US equity beta"},
        )
        joined = " | ".join(result.binding_constraints)
        assert "long US equity beta at correlation complex cap" in joined
        assert "long::0" not in joined

    def test_sparse_map_does_not_warn_for_ungrouped_names(self):
        """A name in no complex is correlated with nothing — the common case. Warning
        on it buried the real taxonomy gaps under one line per standalone name."""
        assets = ["SPY", "QQQ", "GLD"]
        cov = _correlated_cov({"SPY": 0.15, "QQQ": 0.19, "GLD": 0.14})
        result = _solve(
            assets, {a: 0.40 for a in assets}, cov, {"SPY": "long::0", "QQQ": "long::0"}
        )
        assert not [w for w in result.warnings if "correlation complex" in w]


# ── _complex_expressions ─────────────────────────────────────────────────────

class TestComplexExpressions:
    KEPT = [{"asset": "SVXY", "direction": "long", "theme_id": "t1"}]
    CMAP = {"SVXY": "long::0", "SPY": "long::0", "QQQ": "long::0", "GLD": "long::1"}
    POOL = [
        {"asset": "SVXY", "direction": "long", "theme_id": "t1", "edge_score": 0.71},
        {"asset": "SPY", "direction": "long", "theme_id": "t2", "edge_score": 0.55},
        {"asset": "QQQ", "direction": "long", "theme_id": "t2", "edge_score": 0.62},
        {"asset": "GLD", "direction": "long", "theme_id": "t3", "edge_score": 0.44},
    ]

    def test_offers_the_unnamed_members_of_a_bought_complex(self):
        out = _complex_expressions(self.KEPT, self.POOL, self.CMAP)
        assert sorted(e["asset"] for e in out) == ["QQQ", "SPY"]
        assert {e["expresses_pick"] for e in out} == {"SVXY"}
        assert all(e["named_by_llm"] is False for e in out)

    def test_never_introduces_an_idea_the_model_did_not_buy(self):
        """This widens HOW an idea is expressed. It must not add a NEW bet."""
        out = _complex_expressions(self.KEPT, self.POOL, self.CMAP)
        assert "GLD" not in {e["asset"] for e in out}

    def test_a_name_outside_the_pool_is_never_summoned(self):
        pool = [c for c in self.POOL if c["asset"] != "SPY"]
        out = _complex_expressions(self.KEPT, pool, self.CMAP)
        assert sorted(e["asset"] for e in out) == ["QQQ"]

    def test_opposite_side_members_are_refused(self):
        pool = [
            dict(c, direction="short") if c["asset"] == "SPY" else c
            for c in self.POOL
        ]
        out = _complex_expressions(self.KEPT, pool, self.CMAP)
        assert "SPY" not in {e["asset"] for e in out}

    def test_standalone_pick_offers_nothing(self):
        out = _complex_expressions(
            [{"asset": "GLD", "direction": "long"}], self.POOL, {"GLD": "long::1"}
        )
        assert out == []

    def test_no_complex_map_is_a_no_op(self):
        assert _complex_expressions(self.KEPT, self.POOL, {}) == []


# ── the thesis contract ──────────────────────────────────────────────────────

class TestExpressionPosition:
    PARENT = {
        "asset": "SVXY",
        "direction": "long",
        "theme": "US Election",
        "theme_id": "t1",
        "exposure": "long US equity beta",
        "thesis": "SVXY at $52.10 discounts a VIX term structure that ...",
        "counter_thesis": "Wrong if VIX closes above 28 for three sessions",
        "time_horizon": "2-4 weeks",
        "citations": [{"text": "VIX at 16.2", "source": "^VIX", "value": 16.2}],
    }
    EXPRESSION = {
        "asset": "SPY",
        "direction": "long",
        "theme_id": "t2",
        "edge_score": 0.55,
        "expression_of": "long::0",
        "expresses_pick": "SVXY",
        "named_by_llm": False,
    }

    def _build(self):
        return _expression_position(self.EXPRESSION, self.PARENT, 0.08, 100_000_000.0, {})

    def test_does_not_restate_the_parents_prose(self):
        """A reader must never meet a paragraph arguing SVXY on a row holding SPY."""
        row = self._build()
        assert row["thesis"] != self.PARENT["thesis"]
        assert "$52.10" not in row["thesis"]

    def test_points_at_where_the_argument_lives(self):
        row = self._build()
        assert row["expresses_pick"] == "SVXY"
        assert "SVXY" in row["thesis"]
        assert row["exposure"] == "long US equity beta"

    def test_inherits_no_citations(self):
        """verify_citations adjudicated those numerals against prose this row did not
        write. Inheriting them would launder a verified claim onto unverified text."""
        assert self._build()["citations"] == []

    def test_carries_no_numerals_of_its_own(self):
        row = self._build()
        assert not any(ch.isdigit() for ch in row["thesis"] + row["counter_thesis"])

    def test_is_a_real_sized_position(self):
        row = self._build()
        assert row["weight"] == pytest.approx(0.08)
        assert row["signed_weight"] == pytest.approx(0.08)
        assert row["notional"] == pytest.approx(8_000_000.0)

    def test_short_expression_keeps_its_sign(self):
        row = _expression_position(
            dict(self.EXPRESSION, direction="short"),
            dict(self.PARENT, direction="short"),
            -0.05,
            100_000_000.0,
            {},
        )
        assert row["signed_weight"] == pytest.approx(-0.05)
        assert row["weight"] == pytest.approx(0.05)


# ── labels ───────────────────────────────────────────────────────────────────

class TestComplexLabels:
    def test_prefers_the_models_own_exposure(self):
        labels = _complex_labels(
            [{"asset": "SVXY", "exposure": "long US equity beta"}],
            {"SVXY": "long::0", "SPY": "long::0"},
        )
        assert labels["long::0"] == "long US equity beta"

    def test_falls_back_to_members_never_to_the_raw_id(self):
        labels = _complex_labels([], {"SVXY": "long::0", "SPY": "long::0"})
        assert labels["long::0"] == "long SPY / SVXY"
