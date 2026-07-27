"""An asset's CLASS must not contradict its own measured beta (ADR-0120).

This repo validates its computations far harder than its inputs. Three separate SVXY
defects landed on 2026-07-27 — the stress signs, the market beta, and the classification
(ADR-0119) — and every one was a wrong INPUT that every downstream computation then
faithfully propagated. `check_data_integrity` had seven checks reading the published
book and none reading the taxonomy underneath it.

The two regression tests are the point: `test_would_have_caught_svxy` reproduces the
defect this check was written for, and `test_would_have_caught_ewz` reproduces the one
it found on its first live run.
"""
from __future__ import annotations

import pytest

from scripts.check_data_integrity import (
    MATERIAL_CLASS_BETA,
    check_asset_class_matches_measured_beta,
)


class TestTheRegressions:
    def test_would_have_caught_svxy(self):
        """SVXY: classified `rates` (risk beta -1.0, a haven) with measured +2.08. The
        defect ADR-0119 fixed, and the reason this check exists."""
        flags = check_asset_class_matches_measured_beta({"SVXY": "rates"}, {"SVXY": 2.08})
        assert len(flags) == 1
        assert "SVXY" in flags[0] and "rates" in flags[0] and "+2.08" in flags[0]
        assert "negative market beta" in flags[0]

    def test_would_have_caught_ewz(self):
        """EWZ: the iShares MSCI Brazil ETF classified `fx` with measured +0.98. Found
        by this check on its first run against production, hours after it was written."""
        flags = check_asset_class_matches_measured_beta({"EWZ": "fx"}, {"EWZ": 0.98})
        assert len(flags) == 1
        assert "EWZ" in flags[0] and "+0.98" in flags[0]

    def test_both_are_silent_once_reclassified(self):
        assert check_asset_class_matches_measured_beta(
            {"SVXY": "equity", "EWZ": "equity"}, {"SVXY": 2.08, "EWZ": 0.98}
        ) == []


class TestItDoesNotCryWolf:
    def test_a_near_zero_beta_refutes_nothing(self):
        """TLT measures +0.11 against a rates class expecting negative. Calling a
        Treasury fund a haven is a policy statement its equity beta does not refute —
        and a guard that flagged it would be ignored by the second week."""
        assert check_asset_class_matches_measured_beta({"TLT": "rates"}, {"TLT": 0.11}) == []
        assert check_asset_class_matches_measured_beta({"FXE": "fx"}, {"FXE": 0.09}) == []

    def test_commodity_claims_nothing_so_is_never_flagged(self):
        """ASSET_CLASS_RISK_BETA['commodity'] is 0.0 — an honest absence of a
        directional claim, not an oversight (ADR-0036)."""
        for beta in (-0.64, 0.27, 1.08, 2.5):
            assert check_asset_class_matches_measured_beta(
                {"SLV": "commodity"}, {"SLV": beta}
            ) == []

    def test_the_whole_live_equity_book_passes(self):
        """The betas actually measured on 2026-07-27. A check that fires on these is
        measuring the classification scheme, not a defect."""
        live = {
            "XLE": 0.04, "XLV": 0.58, "FXI": 0.90, "MCHI": 0.91, "XLF": 0.94,
            "EWJ": 1.10, "KWEB": 1.14, "QQQ": 1.17, "BABA": 1.25, "ARKK": 1.49,
        }
        classes = {t: "equity" for t in live}
        assert check_asset_class_matches_measured_beta(classes, live) == []

    def test_credit_at_a_small_positive_beta_passes(self):
        assert check_asset_class_matches_measured_beta(
            {"LQD": "credit", "HYG": "credit"}, {"LQD": 0.17, "HYG": 0.23}
        ) == []

    @pytest.mark.parametrize("beta", [MATERIAL_CLASS_BETA - 1e-9, -MATERIAL_CLASS_BETA + 1e-9])
    def test_exactly_below_the_threshold_is_silent(self, beta):
        assert check_asset_class_matches_measured_beta({"X": "rates"}, {"X": beta}) == []


class TestAbsenceAndJunk:
    @pytest.mark.parametrize("classes,betas", [
        (None, {"A": 1.0}), ({"A": "equity"}, None), ({}, {}), (None, None),
    ])
    def test_nothing_to_check_is_not_a_failure(self, classes, betas):
        assert check_asset_class_matches_measured_beta(classes, betas) == []

    def test_a_ticker_with_no_measured_beta_is_skipped_not_assumed(self):
        """No beta is not a contradiction. ADR-0066: NOT-COMPUTABLE is not zero."""
        assert check_asset_class_matches_measured_beta(
            {"NEW": "rates"}, {"OTHER": 1.0}
        ) == []

    def test_an_unknown_class_makes_no_claim(self):
        assert check_asset_class_matches_measured_beta(
            {"BTC": "crypto", "X": "other"}, {"BTC": 1.5, "X": -2.0}
        ) == []

    @pytest.mark.parametrize("beta", [None, "n/a", float("nan"), float("inf")])
    def test_unusable_betas_are_skipped(self, beta):
        assert check_asset_class_matches_measured_beta({"X": "rates"}, {"X": beta}) == []

    def test_a_null_class_is_skipped(self):
        assert check_asset_class_matches_measured_beta({"X": None}, {"X": 2.0}) == []


class TestTheMessage:
    def test_it_names_the_consequence_not_just_the_mismatch(self):
        """A guard that says "mismatch" gets triaged as a taxonomy nit. This one has to
        say that the sign reaches EdgeScore, because that is why it matters."""
        flag = check_asset_class_matches_measured_beta({"SVXY": "rates"}, {"SVXY": 2.08})[0]
        assert "regime_direction_bias" in flag
        assert "inverted" in flag
        assert "ADR-0119" in flag

    def test_it_reports_every_offender_not_just_the_first(self):
        flags = check_asset_class_matches_measured_beta(
            {"SVXY": "rates", "EWZ": "fx", "QQQ": "equity"},
            {"SVXY": 2.08, "EWZ": 0.98, "QQQ": 1.17},
        )
        assert len(flags) == 2
        assert {"SVXY", "EWZ"} == {f.split()[0] for f in flags}


class TestTheTwoMapsMustAgree:
    """ADR-0121. There are two asset-class maps and they do different jobs:
    `trade_ranker._ASSET_CLASS_MAP` is what `classify()` returns and therefore what
    reaches `regime_direction_bias`; `theme_assets.asset_class` is the lens filter.

    Nothing compared them, and the cost was immediate: ADR-0119 fixed SVXY in SECTOR_MAP
    and the database and left the code map on `rates`, then ADR-0120 built a beta check
    that read the database column only. The regime term stayed inverted while the guard
    reported clean — a false assurance, which is worse than no guard.
    """

    def test_flags_the_divergence_that_shipped(self):
        from scripts.check_data_integrity import check_asset_class_maps_agree

        flags = check_asset_class_maps_agree(
            {"SVXY": "rates"},        # what classify() returned after ADR-0119
            {"SVXY": "equity"},       # what migration 049 wrote
        )
        assert len(flags) == 1
        assert "_ASSET_CLASS_MAP says 'rates'" in flags[0]
        assert "theme_assets.asset_class says 'equity'" in flags[0]
        assert "regime_direction_bias" in flags[0]

    def test_silent_when_they_agree(self):
        from scripts.check_data_integrity import check_asset_class_maps_agree

        assert check_asset_class_maps_agree(
            {"SVXY": "equity", "EWZ": "equity"},
            {"SVXY": "equity", "EWZ": "equity"},
        ) == []

    def test_a_ticker_in_only_one_map_is_not_a_disagreement(self):
        """The code map covers 53 tickers and the database column 23. Absence from one
        is a coverage gap, not a contradiction, and conflating them would bury the real
        divergences under noise."""
        from scripts.check_data_integrity import check_asset_class_maps_agree

        assert check_asset_class_maps_agree({"A": "equity"}, {"B": "rates"}) == []

    def test_the_live_maps_agree(self):
        """The regression this whole ADR chain exists for, asserted against the real
        maps rather than a fixture."""
        from backend.services.trade_ranker import _ASSET_CLASS_MAP

        assert _ASSET_CLASS_MAP["SVXY"] == "equity"
        assert _ASSET_CLASS_MAP["EWZ"] == "equity"

    def test_classify_is_what_reaches_the_regime_term(self):
        """The seam the earlier fix missed: SECTOR_MAP and the database column were
        corrected while `classify()` — the function feeding regime_direction_bias — kept
        returning the old class."""
        from backend.services.trade_ranker import classify
        from backend.services.edge_signals import regime_direction_bias

        for ticker in ("SVXY", "EWZ"):
            asset_class = classify(ticker)["asset_class"]
            assert asset_class == "equity", ticker
            # Risk-off must FADE a levered equity proxy, not favour it.
            assert regime_direction_bias(asset_class, "mid", "neutral", -0.8) < 0
