"""A scenario override may not fight the scenario's own factor path (ADR-0124).

The corrected SVXY entry in `scenario_analysis` carries a comment that DOES THE
ARITHMETIC: "measured beta_mkt is +2.08 ... this scenario's own description is a -15 to
-25% SPX drawdown, so the factor path implies about -37%". The pre-fix value was +0.20 —
sign-inconsistent with the scenario it sits inside — and it survived because that
reasoning lived in prose. A comment doing a test's job is how the defect survived.

This suite is the primary enforcement (it fails at CI time, before a merge); the
nightly guard runs the same function as a backstop for an edit that never ran the
tests. `test_the_live_scenarios_are_clean` is the one that binds the real constants.
"""
from __future__ import annotations

import pytest

from scripts.check_data_integrity import (
    SCENARIO_OVERRIDE_CONTRADICTION_GAP,
    check_scenario_overrides_reconcile,
)


def _scen(name: str, mkt, overrides: dict) -> dict:
    return {"name": name, "mkt_shock": mkt, "overrides": overrides}


BETAS = {
    "SVXY": {"mkt": 2.08},
    "XLE": {"mkt": 0.80},
    "GLD": {"mkt": 0.05},
    "TLT": {"mkt": -0.30},
}


class TestTheRegressions:
    def test_would_have_caught_the_s1_entry(self):
        """The defect ADR-0114 fixed: +0.20 stated, -0.37 implied — 'we are short VIX,
        this is a VIX scenario, so we gain', confusing short-vol with short the
        scenario."""
        flags = check_scenario_overrides_reconcile(
            [_scen("S1_vix_spike", -0.18, {"SVXY": +0.20})], BETAS
        )
        assert len(flags) == 1
        assert "SVXY" in flags[0] and "+0.20" in flags[0] and "-0.37" in flags[0]

    def test_would_have_caught_the_s4_entry(self):
        """The same defect's second instance: +0.15 against an implied -0.17."""
        flags = check_scenario_overrides_reconcile(
            [_scen("S4_credit_widening", -0.08, {"SVXY": +0.15})], BETAS
        )
        assert len(flags) == 1

    def test_the_corrected_entries_are_quiet(self):
        flags = check_scenario_overrides_reconcile(
            [
                _scen("S1_vix_spike", -0.18, {"SVXY": -0.35}),
                _scen("S4_credit_widening", -0.08, {"SVXY": -0.15}),
            ],
            BETAS,
        )
        assert flags == []


class TestLegitimateOverridesStayQuiet:
    def test_a_channel_view_may_cross_the_sign(self):
        """S2's real XLE entry: rising rates alongside strong energy. Implied -0.04,
        stated +0.03 — a genuine non-beta channel, 0.07 apart. The override mechanism
        exists FOR this."""
        assert check_scenario_overrides_reconcile(
            [_scen("S2_rate_shock", -0.05, {"XLE": +0.03})], BETAS
        ) == []

    def test_flight_to_quality_on_a_near_zero_beta_name(self):
        """GLD bid in a selloff: sign crosses, gap tiny. The mechanism working."""
        assert check_scenario_overrides_reconcile(
            [_scen("S1_vix_spike", -0.18, {"GLD": +0.05})], BETAS
        ) == []

    def test_same_sign_amplification_of_any_size_is_a_view(self):
        """S6 transmits primarily through SECTOR_MAP (ADR-0088) but carries a small mkt
        shock; its overrides dwarf the implied path in the SAME direction. Never
        flagged — magnitude is the override's job."""
        assert check_scenario_overrides_reconcile(
            [_scen("S6_supply_shock", -0.04, {"SVXY": -0.18})], BETAS
        ) == []

    def test_a_scenario_without_a_market_shock_is_exempt(self):
        """No factor path, nothing to reconcile against."""
        assert check_scenario_overrides_reconcile(
            [_scen("hypothetical", None, {"SVXY": +0.50})], BETAS
        ) == []

    def test_a_ticker_without_a_beta_is_skipped_not_assumed(self):
        """ADR-0066: NOT-COMPUTABLE is not zero."""
        assert check_scenario_overrides_reconcile(
            [_scen("S1_vix_spike", -0.18, {"NEWCO": +0.50})], BETAS
        ) == []

    @pytest.mark.parametrize(
        "mkt,direct",
        [(float("nan"), 0.2), (-0.18, float("nan")), ("x", 0.2), (-0.18, None)],
    )
    def test_junk_values_are_skipped(self, mkt, direct):
        assert check_scenario_overrides_reconcile(
            [_scen("s", mkt, {"SVXY": direct})], BETAS
        ) == []

    @pytest.mark.parametrize("scenarios,betas", [(None, BETAS), ([], BETAS), ([_scen("s", -0.1, {})], None)])
    def test_nothing_to_check_is_not_a_failure(self, scenarios, betas):
        assert check_scenario_overrides_reconcile(scenarios, betas) == []


class TestCalibration:
    def test_the_gap_separates_the_defect_from_the_channel(self):
        """The threshold is a judgement, stated as one: pre-fix SVXY sat at 0.57 and
        0.32, the largest legitimate sign-crossing override at 0.07. 0.25 has margin
        both ways, and this pins the margin so a re-tune shows up in a diff."""
        assert SCENARIO_OVERRIDE_CONTRADICTION_GAP == 0.25
        # just under the gap, signs crossed: quiet
        assert check_scenario_overrides_reconcile(
            [_scen("s", -0.10, {"SVXY": +0.03})], BETAS  # implied -0.208, gap 0.238
        ) == []
        # just over: fires
        assert check_scenario_overrides_reconcile(
            [_scen("s", -0.10, {"SVXY": +0.06})], BETAS  # implied -0.208, gap 0.268
        ) != []


class TestTheLiveConstants:
    def test_the_live_scenarios_are_clean(self):
        """The enforcement that replaces the comment. If a future scenario edit
        reintroduces an SVXY-shaped contradiction, THIS fails at CI time."""
        from backend.services.scenario_analysis import DEFAULT_TICKER_BETAS, SCENARIOS

        flags = check_scenario_overrides_reconcile(
            [
                {
                    "name": s.name,
                    "mkt_shock": (s.factor_shocks or {}).get("mkt"),
                    "overrides": dict(s.base_asset_shocks or {}),
                }
                for s in SCENARIOS
            ],
            dict(DEFAULT_TICKER_BETAS),
        )
        assert flags == [], flags
