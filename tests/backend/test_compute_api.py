"""Request-time sizing must be the SAME sizer, parameterised.

The property under test is that `size_book` is `f(signal, mandate)` using the real
`optimizer.py` — not a convenience reimplementation. If these tests can be made to
pass by a second, simpler sizer, they are not testing the thing that matters.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.compute_api import (  # noqa: E402
    ComputeError,
    MAX_ASSETS,
    factor_betas,
    mandate_from_payload,
    size_book,
)
from backend.services.mandate import DEFAULT_MANDATE  # noqa: E402

SIGNALS = [
    {"asset": "VRT", "direction": "long", "conviction": 9.09, "vol": 0.0440},
    {"asset": "XLE", "direction": "long", "conviction": 24.91, "vol": 0.0147},
    {"asset": "JPM", "direction": "long", "conviction": 21.48, "vol": 0.0145},
    {"asset": "BABA", "direction": "short", "conviction": 15.81, "vol": 0.0262},
    {"asset": "MSFT", "direction": "short", "conviction": 14.89, "vol": 0.0216},
]
SECTORS = {
    "VRT": "Electrical Equipment", "XLE": "Energy", "JPM": "Financials",
    "BABA": "China Equities", "MSFT": "Tech Growth",
}
GEOS = {"VRT": "US", "XLE": "US", "JPM": "US", "BABA": "China", "MSFT": "US"}


def _size(mandate, **kw):
    return size_book(SIGNALS, mandate, sector_map=SECTORS, geo_map=GEOS, **kw)


class TestTheMandateActuallyBinds:
    def test_a_different_mandate_produces_a_different_book(self):
        # The whole point. Same signal, two mandates, two books.
        default = _size(DEFAULT_MANDATE)
        tight = _size(mandate_from_payload({"max_single_name": 0.10}))
        assert default["feasible"] and tight["feasible"]
        assert default["signed_weights"] != tight["signed_weights"]

    def test_the_single_name_cap_is_honoured(self):
        for cap in (0.20, 0.10, 0.05):
            out = _size(mandate_from_payload({"max_single_name": cap}))
            for asset, weight in out["signed_weights"].items():
                assert abs(weight) <= cap + 1e-6, f"{asset} breached a {cap} cap"

    def test_gross_never_exceeds_the_budget(self):
        for gross in (1.0, 0.5, 0.25):
            out = _size(mandate_from_payload({"max_gross": gross}))
            assert sum(abs(w) for w in out["signed_weights"].values()) <= gross + 1e-6

    def test_capital_base_scales_notionals_and_nothing_else(self):
        small = _size(DEFAULT_MANDATE)
        big = _size(mandate_from_payload({"total_capital": 500_000_000}))
        # Weights are dimensionless, so a pure capital change must not move them.
        assert small["signed_weights"] == pytest.approx(big["signed_weights"])
        for asset, weight in big["signed_weights"].items():
            assert big["notional"][asset] == pytest.approx(weight * 500_000_000)

    def test_direction_is_pinned(self):
        # A short may never come back positive. This is the ADR-0107 failure that
        # deleted every short in the source this was read across from.
        out = _size(DEFAULT_MANDATE)
        for row in SIGNALS:
            weight = out["signed_weights"].get(row["asset"], 0.0)
            if row["direction"] == "short":
                assert weight <= 1e-9, f"{row['asset']} is short but sized {weight}"
            else:
                assert weight >= -1e-9

    def test_the_mandate_travels_with_the_result(self):
        out = _size(mandate_from_payload({"total_capital": 250_000_000}))
        assert out["mandate"]["values"]["total_capital"] == 250_000_000
        # A caller-supplied mandate did not come from scoring_config, and the
        # provenance must not claim it did.
        assert out["mandate"]["sources"]["total_capital"] == "code_default"


class TestNoViewIsNotAZeroMeasurement:
    def test_a_name_with_no_edge_is_named_not_silently_zeroed(self):
        signals = SIGNALS + [{"asset": "NVDA", "direction": "long"}]
        out = size_book(
            signals, DEFAULT_MANDATE,
            sector_map={**SECTORS, "NVDA": "Semiconductors"},
            geo_map={**GEOS, "NVDA": "US"},
        )
        assert "NVDA" in out["no_expected_return"]["assets"]
        assert "no view" in out["no_expected_return"]["note"]

    def test_a_scored_name_is_not_listed_as_no_view(self):
        out = _size(DEFAULT_MANDATE)
        assert "no_expected_return" not in out

    def test_conviction_and_vol_reconstruct_a_signed_mu(self):
        # conviction = |edge| / vol, so edge = conviction * vol, and the SIDE
        # supplies the sign. A short with a positive conviction must yield mu < 0.
        from backend.services.compute_api import _mu_for

        assert _mu_for({"direction": "long", "conviction": 10.0, "vol": 0.02}) == pytest.approx(0.2)
        assert _mu_for({"direction": "short", "conviction": 10.0, "vol": 0.02}) == pytest.approx(-0.2)
        assert _mu_for({"direction": "long"}) is None
        assert _mu_for({"direction": "long", "conviction": "x", "vol": 0.02}) is None


class TestTheDiagonalFallbackAdmitsWhatItAssumes:
    def test_an_absent_covariance_is_caveated_not_hidden(self):
        out = _size(DEFAULT_MANDATE)
        assert any("ZERO correlation" in w for w in out.get("warnings", []))

    def test_a_supplied_covariance_suppresses_the_caveat(self):
        cov = np.diag([r["vol"] ** 2 for r in SIGNALS])
        out = _size(DEFAULT_MANDATE, cov=cov)
        assert not any("ZERO correlation" in w for w in out.get("warnings", []))

    def test_a_wrong_shaped_covariance_is_refused(self):
        with pytest.raises(ComputeError, match="expected"):
            _size(DEFAULT_MANDATE, cov=np.eye(3))


class TestTheRequestIsValidated:
    def test_a_nonsense_cap_is_refused_not_clamped(self):
        # Silently clamping would size a book under a mandate the caller did not ask
        # for and would never be told about.
        for bad in ({"max_single_name": -0.1}, {"max_gross": 40}, {"max_geo": 0}):
            with pytest.raises(ComputeError):
                mandate_from_payload(bad)

    def test_a_non_numeric_field_is_refused(self):
        with pytest.raises(ComputeError, match="must be a number"):
            mandate_from_payload({"total_capital": "lots"})

    def test_absent_fields_fall_back_to_andromedas_mandate(self):
        m = mandate_from_payload({"total_capital": 250_000_000})
        assert m.total_capital == 250_000_000
        assert m.max_single_name == DEFAULT_MANDATE.max_single_name
        assert m.max_geo == DEFAULT_MANDATE.max_geo

    def test_empty_and_oversized_requests_are_refused(self):
        with pytest.raises(ComputeError, match="no signals"):
            size_book([], DEFAULT_MANDATE)
        too_many = [
            {"asset": f"A{i}", "direction": "long", "conviction": 1.0, "vol": 0.02}
            for i in range(MAX_ASSETS + 1)
        ]
        with pytest.raises(ComputeError, match="exceeds"):
            size_book(too_many, DEFAULT_MANDATE)

    def test_a_duplicate_or_malformed_signal_is_refused(self):
        with pytest.raises(ComputeError, match="twice"):
            size_book(SIGNALS + [SIGNALS[0]], DEFAULT_MANDATE)
        with pytest.raises(ComputeError, match="long\\|short"):
            size_book([{"asset": "X", "direction": "sideways"}], DEFAULT_MANDATE)


class TestFactorBetas:
    def test_recovers_a_known_beta(self):
        rng = np.random.default_rng(11)
        mkt = rng.normal(0, 0.01, 300)
        asset = 1.5 * mkt + rng.normal(0, 0.0005, 300)
        out = factor_betas(asset, mkt)
        assert out["beta_mkt"] == pytest.approx(1.5, abs=0.05)
        assert out["r_squared"] > 0.9
        assert out["insufficient"] is False

    def test_a_short_sample_yields_none_not_a_number(self):
        # A beta from ten observations is a number, not an estimate.
        out = factor_betas(np.zeros(10), np.zeros(10))
        assert out["beta_mkt"] is None
        assert out["insufficient"] is True
        assert out["observations"] == 10
