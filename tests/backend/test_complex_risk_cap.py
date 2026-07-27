"""A correlation complex is capped in RISK, not only in capital (ADR-0118).

ADR-0116 tried to make the members of a complex interchangeable by adjusting mu under a
CAPITAL cap. It cannot be done, and the reason is structural rather than a tuning
failure:

  * average mu           -> a low-vol member gets a high-vol member's return at its own
                            risk, a Sharpe no instrument has. Measured on the live book:
                            gross 58.4% -> 98.8%, three substitutes pinned to the cap.
  * average the signal   -> every member has an identical Sharpe, so the one delivering
                            the most return per unit of CAPITAL wins: the highest-vol
                            member. SVXY took the entire complex.

Both are corners produced by what the cap is denominated in. In RISK units the bias
disappears: holding member i alone at budget B takes weight B/sigma_i and returns
(IC*sigma_i*z)*(B/sigma_i) = IC*z*B, the same for every member.

`test_members_are_interchangeable_in_risk_units` is the load-bearing one — it is the
claim ADR-0116 made and could not support.
"""
from __future__ import annotations

import numpy as np
import pytest

from backend.services.book_metrics import CAP_EPSILON as CAP_EPS, exceeds_cap
from backend.services.expected_returns import equalise_signal_within_complexes
from backend.services.optimizer import (
    OptimizerConstraints,
    OptimizerInputs,
    _psd_sqrt,
    optimize,
)


ASSETS = ["SPY", "QQQ", "SVXY"]
VOLS = {"SPY": 0.15, "QQQ": 0.19, "SVXY": 0.55}
CMAP = {a: "long::0" for a in ASSETS}


def _cov(vols: dict[str, float], rho: float = 0.97, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    driver = rng.normal(0, 1, 800)
    cols = [
        (driver * rho + rng.normal(0, np.sqrt(1 - rho**2), 800)) * v / np.sqrt(252)
        for v in vols.values()
    ]
    return np.cov(np.column_stack(cols), rowvar=False) * 252


def _solve(assets, mu, cov, cmap, **kw):
    inputs = OptimizerInputs(
        assets=assets,
        directions={a: "long" for a in assets},
        mu=mu, cov=cov,
        sector_map={a: f"s{i}" for i, a in enumerate(assets)},
        geo_map={a: f"g{i}" for i, a in enumerate(assets)},
        complex_map=cmap,
    )
    return optimize(inputs, "mean_variance",
                    OptimizerConstraints(risk_aversion=0.02, **kw))


def _standalone_vol(weights: dict[str, float], assets, cov) -> float:
    v = np.array([weights.get(a, 0.0) for a in assets])
    return float(np.sqrt(max(0.0, v @ cov @ v)))


class TestPsdSqrt:
    def test_reproduces_the_matrix(self):
        cov = _cov(VOLS)
        root = _psd_sqrt(cov)
        assert np.allclose(root @ root, cov, atol=1e-10)

    def test_survives_the_singular_matrix_it_is_always_given(self):
        """A complex is near-singular BY CONSTRUCTION, which is exactly where Cholesky
        raises. This is why `_psd_sqrt` uses eigh."""
        singular = np.outer([0.2, 0.2, 0.2], [0.2, 0.2, 0.2])
        with pytest.raises(np.linalg.LinAlgError):
            np.linalg.cholesky(singular)
        root = _psd_sqrt(singular)
        assert np.isfinite(root).all()
        assert np.allclose(root @ root, singular, atol=1e-10)

    def test_clips_negative_eigenvalues_rather_than_going_complex(self):
        noisy = np.array([[1.0, 0.0], [0.0, -1e-14]])
        assert np.isrealobj(_psd_sqrt(noisy))


class TestTheRiskCapBinds:
    def test_it_caps_standalone_vol_not_capital(self):
        cov = _cov(VOLS)
        equalised, _ = equalise_signal_within_complexes(
            {a: 0.12 for a in ASSETS}, CMAP, VOLS
        )
        result = _solve(ASSETS, equalised, cov, CMAP)
        assert result.feasible
        budget = OptimizerConstraints().max_complex_risk_mult * float(
            np.median(np.sqrt(np.diag(cov)))
        )
        assert _standalone_vol(result.signed_weights, ASSETS, cov) <= budget + 1e-6

    def test_it_only_ever_tightens(self):
        """Added to the capital cap, never substituted for it — ADR-0110's rule."""
        cov = _cov(VOLS)
        mu, _ = equalise_signal_within_complexes({a: 0.12 for a in ASSETS}, CMAP, VOLS)
        with_risk = _solve(ASSETS, mu, cov, CMAP)
        without = _solve(ASSETS, mu, cov, CMAP, max_complex_risk_mult=None)
        assert sum(abs(v) for v in with_risk.signed_weights.values()) <= sum(
            abs(v) for v in without.signed_weights.values()
        ) + 1e-6

    def test_the_capital_cap_still_applies(self):
        cov = _cov(VOLS)
        mu, _ = equalise_signal_within_complexes({a: 0.12 for a in ASSETS}, CMAP, VOLS)
        result = _solve(ASSETS, mu, cov, CMAP)
        total = sum(abs(v) for v in result.signed_weights.values())
        assert total <= OptimizerConstraints().max_complex + 1e-4

    def test_a_standalone_name_is_not_risk_capped(self):
        """A one-member complex is already governed by the single-name cap; adding a
        risk cap would tighten a name for the accident of being clustered with nothing."""
        cov = _cov(VOLS)
        solo = _solve(ASSETS, {a: 0.12 for a in ASSETS}, cov, {"SVXY": "long::9"})
        assert solo.feasible
        assert not [b for b in solo.binding_constraints if "RISK cap" in b]

    def test_binding_is_reported_with_both_numbers(self):
        cov = _cov(VOLS)
        mu, _ = equalise_signal_within_complexes({a: 0.60 for a in ASSETS}, CMAP, VOLS)
        result = _solve(ASSETS, mu, cov, CMAP)
        risk_bindings = [b for b in result.binding_constraints if "RISK cap" in b]
        assert risk_bindings, result.binding_constraints
        assert "vol vs" in risk_bindings[0] and "budget" in risk_bindings[0]


class TestTheClaimAdr0116CouldNotSupport:
    def test_members_are_interchangeable_in_risk_units(self):
        """THE point. Under a capital cap, equal Sharpe favours the highest-vol member
        (most return per unit of capital) — SVXY took the whole complex. Under a risk
        cap, holding any member alone returns IC*z*B regardless of which, so no member
        can dominate on cost of expression alone."""
        cov = _cov(VOLS)
        mu, _ = equalise_signal_within_complexes({a: 0.30 for a in ASSETS}, CMAP, VOLS)
        result = _solve(ASSETS, mu, cov, CMAP)
        weights = result.signed_weights

        # Each member's RISK contribution, not its capital. These are what the cap
        # equalises, and they must be comparable rather than one taking everything.
        risk = {a: abs(weights[a]) * VOLS[a] for a in ASSETS}
        total = sum(risk.values())
        assert total > 0
        shares = {a: r / total for a, r in risk.items()}
        assert max(shares.values()) < 0.90, shares

    def test_capital_tilts_toward_the_cheaper_instrument_not_away(self):
        """The honest version of ADR-0116's claim. Equal RISK share means the high-vol
        member holds proportionally LESS capital — not zero, and not for a hardcoded
        reason, but because that is what equal risk means."""
        cov = _cov(VOLS)
        mu, _ = equalise_signal_within_complexes({a: 0.30 for a in ASSETS}, CMAP, VOLS)
        weights = _solve(ASSETS, mu, cov, CMAP).signed_weights
        assert abs(weights["SPY"]) > abs(weights["SVXY"]), weights

    def test_a_capital_cap_alone_would_favour_the_levered_member(self):
        """The failure this replaces, pinned so it cannot come back unnoticed."""
        cov = _cov(VOLS)
        mu, _ = equalise_signal_within_complexes({a: 0.30 for a in ASSETS}, CMAP, VOLS)
        capital_only = _solve(ASSETS, mu, cov, CMAP, max_complex_risk_mult=None)
        w = capital_only.signed_weights
        assert abs(w["SVXY"]) > abs(w["SPY"]), w


class TestSignalEqualisation:
    def test_every_member_ends_on_one_sharpe(self):
        mu = {"SPY": 0.10, "QQQ": 0.14, "SVXY": 0.40}
        out, prov = equalise_signal_within_complexes(mu, CMAP, VOLS)
        sharpes = [out[a] / VOLS[a] for a in ASSETS]
        assert max(sharpes) - min(sharpes) < 1e-12
        assert prov["applied"] is True
        assert "signal" in prov["complexes"][0]["basis"]

    def test_it_does_not_average_mu(self):
        """The ADR-0116 bug: averaging mu gives a low-vol name a high-vol name's return
        at its own risk. The high-vol member must keep the larger mu."""
        mu = {"SPY": 0.10, "QQQ": 0.14, "SVXY": 0.40}
        out, _ = equalise_signal_within_complexes(mu, CMAP, VOLS)
        assert out["SVXY"] > out["QQQ"] > out["SPY"]
        assert out["SVXY"] != pytest.approx(sum(mu.values()) / 3)

    def test_ungrouped_names_are_bit_identical(self):
        mu = {"SPY": 0.10, "QQQ": 0.14, "GLD": 0.123456789}
        out, _ = equalise_signal_within_complexes(
            mu, {"SPY": "long::0", "QQQ": "long::0"}, {**VOLS, "GLD": 0.14}
        )
        assert out["GLD"] == mu["GLD"]

    def test_a_member_without_vol_refuses_the_whole_complex(self):
        mu = {"SPY": 0.10, "QQQ": 0.14}
        out, prov = equalise_signal_within_complexes(
            mu, {"SPY": "long::0", "QQQ": "long::0"}, {"SPY": 0.15}
        )
        assert out == mu
        assert "usable vol" in prov["skipped"][0]["reason"]

    def test_sign_disagreement_refuses(self):
        out, prov = equalise_signal_within_complexes(
            {"A": 0.3, "B": -0.3}, {"A": "x", "B": "x"}, {"A": 0.2, "B": 0.2}
        )
        assert out == {"A": 0.3, "B": -0.3}
        assert "sign" in prov["skipped"][0]["reason"]


class TestGroupCapProjection:
    """ADR-0123. `_round_weights` FLOORS each magnitude, which absorbs the ~1e-8 a solver
    leaves on a SINGLE name. It cannot fix a GROUP: flooring three weights removes at
    most 3e-8 while the solver satisfies a SUMMED constraint to its own feasibility
    tolerance — measured at 3.3e-6 over a 20% complex cap, three orders above the
    CAP_EPSILON (1e-9) that `exceeds_cap` uses to decide a breach.

    So `/risk` could report a governance violation on a correctly-solved book, which
    ADR-0068 forbids. Loosening CAP_EPSILON was rejected: that converts a
    representation-error guard into a fitted economic tolerance.
    """

    def test_projects_the_measured_overshoot(self):
        from backend.services.optimizer import _project_group_caps

        # The real number from the ADR-0116 run: 0.20000334 against a 0.20 cap.
        weights = {"A": 0.06666778, "B": 0.06666778, "C": 0.06666778}
        cmap = {a: "long::0" for a in weights}
        out, binding = _project_group_caps(weights, [(cmap, 0.20, "correlation complex")])
        assert sum(abs(v) for v in out.values()) <= 0.20 + CAP_EPS
        assert binding and "projected onto its 20.00% cap" in binding[0]

    def test_a_compliant_group_is_bit_identical(self):
        """Sitting under a cap must cost nothing — no rescale, no rounding drift."""
        from backend.services.optimizer import _project_group_caps

        weights = {"A": 0.05, "B": 0.04, "C": -0.03}
        out, binding = _project_group_caps(
            weights, [({a: "g" for a in weights}, 0.20, "sector")]
        )
        assert out == weights
        assert binding == []

    def test_signs_survive_projection(self):
        from backend.services.optimizer import _project_group_caps

        weights = {"A": 0.15, "B": -0.15}
        out, _ = _project_group_caps(
            weights, [({a: "g" for a in weights}, 0.20, "sector")]
        )
        assert out["A"] > 0 and out["B"] < 0

    def test_a_name_takes_the_strictest_of_its_groups(self):
        """A ticker sits in a sector AND a geography AND possibly a complex. Scaling
        down can only reduce every other group's total, so taking the minimum factor in
        one pass is safe and conservative — under a cap, never over."""
        from backend.services.optimizer import _project_group_caps

        weights = {"A": 0.20, "B": 0.20}
        out, _ = _project_group_caps(
            weights,
            [
                ({"A": "s1", "B": "s1"}, 0.30, "sector"),   # needs 0.75
                ({"A": "g1", "B": "g1"}, 0.20, "geo"),      # needs 0.50 — stricter
            ],
        )
        assert sum(abs(v) for v in out.values()) <= 0.20 + CAP_EPS

    def test_it_only_ever_shrinks(self):
        """Magnitudes only fall, so single-name caps and the gross budget stay satisfied
        and nothing needs re-checking."""
        from backend.services.optimizer import _project_group_caps

        weights = {"A": 0.18, "B": 0.18, "C": 0.02}
        out, _ = _project_group_caps(
            weights, [({a: "g" for a in weights}, 0.20, "sector")]
        )
        assert all(abs(out[k]) <= abs(weights[k]) + 1e-15 for k in weights)

    def test_an_ungrouped_name_is_untouched(self):
        from backend.services.optimizer import _project_group_caps

        weights = {"A": 0.15, "B": 0.15, "SOLO": 0.19}
        out, _ = _project_group_caps(
            weights, [({"A": "g", "B": "g"}, 0.20, "sector")]
        )
        assert out["SOLO"] == 0.19

    def test_the_solved_book_satisfies_its_group_cap_at_cap_epsilon(self):
        """End to end, at the precision `exceeds_cap` actually judges by — not 1e-4."""
        cov = _cov(VOLS)
        mu, _ = equalise_signal_within_complexes({a: 0.60 for a in ASSETS}, CMAP, VOLS)
        result = _solve(ASSETS, mu, cov, CMAP)
        assert result.feasible
        total = sum(abs(v) for v in result.signed_weights.values())
        assert not exceeds_cap(total, OptimizerConstraints().max_complex), total
