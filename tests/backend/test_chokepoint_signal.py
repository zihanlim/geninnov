"""
Tests for backend/services/chokepoint_signal.py (ADR-0095).

The rule under test: an input we do not trust must never move a published stress number.
Every refusal path returns the neutral multiplier WITH a stated reason — never a guess, and
never a bare 1.0 that a reader would mistake for a measurement.

The live fetch is deliberately untested against the network: tools/call needs a credential
we do not have. What is tested is everything that does not need one.
"""

import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.chokepoint_signal import (
    BASELINE_DISRUPTION_PCT, MAX_MULTIPLIER, MIN_MULTIPLIER, NEUTRAL,
    fetch_signal, neutral, scale_sector_shocks, signal_from_payload,
)


def payload(summaries, *, stale=False, cached_at="2026-07-26T09:00:00Z"):
    return {"cached_at": cached_at, "stale": stale,
            "data": {"transit-summaries": {"summaries": summaries}}}


def cp(disruption, *, available=True, risk="elevated", wow=-12.0):
    return {"disruptionPct": disruption, "dataAvailable": available,
            "riskLevel": risk, "wowChangePct": wow, "incidentCount7d": 2}


# ─── the measured path ────────────────────────────────────────────────────────

def test_baseline_disruption_runs_the_documented_calibration_exactly():
    """At the baseline the multiplier is 1.0: ADR-0088's reviewed calibration is the
    reference point, not something to be silently rescaled."""
    s = signal_from_payload(payload({"hormuz_strait": cp(BASELINE_DISRUPTION_PCT)}))
    assert s.measured and s.multiplier == 1.0
    assert s.chokepoint == "hormuz_strait"


def test_higher_disruption_amplifies_and_lower_damps():
    hi = signal_from_payload(payload({"h": cp(BASELINE_DISRUPTION_PCT * 1.25)}))
    lo = signal_from_payload(payload({"h": cp(BASELINE_DISRUPTION_PCT * 0.5)}))
    assert hi.multiplier > 1.0 and lo.multiplier < 1.0


def test_the_multiplier_is_bounded_both_ways_and_says_it_clamped():
    """100% disruption must not become a 2.5x shock — past the bound the scenario stops
    being the reviewed calibration and becomes an unreviewed extrapolation."""
    hi = signal_from_payload(payload({"h": cp(100.0)}))
    lo = signal_from_payload(payload({"h": cp(0.0)}))
    assert hi.multiplier == MAX_MULTIPLIER and hi.clamped
    assert lo.multiplier == MIN_MULTIPLIER and lo.clamped
    assert "Clamped" in hi.reason


def test_the_worst_chokepoint_binds_not_the_average():
    """A supply shock is a tail scenario. Averaging would let a quiet Panama cancel a
    closed Hormuz."""
    s = signal_from_payload(payload({"panama": cp(5.0), "hormuz_strait": cp(80.0)}))
    assert s.chokepoint == "hormuz_strait"
    assert s.disruption_pct == 80.0


def test_a_named_chokepoint_filters_by_substring():
    s = signal_from_payload(payload({"panama": cp(90.0), "hormuz_strait": cp(20.0)}),
                            chokepoint="hormuz")
    assert s.chokepoint == "hormuz_strait" and s.disruption_pct == 20.0


def test_reason_always_names_the_chokepoint_and_the_numbers():
    s = signal_from_payload(payload({"suez": cp(60.0)}))
    assert "suez" in s.reason and "60%" in s.reason and "ADR-0088" in s.reason


# ─── every refusal is stated ─────────────────────────────────────────────────

def test_a_stale_cache_is_not_a_low_disruption_reading():
    """Transport freshness and content freshness are separate claims and the upstream states
    both. A stale cache must not silently damp a published stress number."""
    s = signal_from_payload(payload({"h": cp(90.0)}, stale=True))
    assert not s.measured and s.multiplier == NEUTRAL
    assert "stale" in s.reason.lower()
    assert s.disruption_pct is None      # no value is carried through from a refused read


def test_data_unavailable_is_not_zero_disruption():
    """`dataAvailable: false` is the upstream saying it cannot see. Reading that as all-clear
    is the conflation ADR-0066 forbids."""
    s = signal_from_payload(payload({"h": cp(0.0, available=False)}))
    assert not s.measured and "usable disruption reading" in s.reason


def test_an_out_of_range_or_non_numeric_reading_is_refused():
    for bad in (150.0, -5.0, "high", None, True):
        s = signal_from_payload(payload({"h": cp(bad)}))
        assert not s.measured, f"{bad!r} should not be treated as a disruption"


def test_missing_or_malformed_payloads_are_refused_with_a_reason():
    for p in ({}, {"stale": False}, {"data": {}}, {"data": {"transit-summaries": {}}}, None, []):
        s = signal_from_payload(p)  # type: ignore[arg-type]
        assert not s.measured and s.multiplier == NEUTRAL and s.reason


def test_a_filter_matching_nothing_names_what_it_looked_for():
    s = signal_from_payload(payload({"panama": cp(50.0)}), chokepoint="hormuz")
    assert not s.measured and "hormuz" in s.reason


# ─── scaling ─────────────────────────────────────────────────────────────────

def test_scaling_changes_magnitude_and_never_direction():
    """A worse supply shock hurts importers more and helps producers more; it reverses
    nobody. Direction is the calibration's claim about transmission."""
    shocks = {"Energy": 0.18, "China Equities": -0.12, "Rates": -0.02}
    out = scale_sector_shocks(shocks, 1.5)
    assert out["Energy"] > 0.18 and out["China Equities"] < -0.12
    for k in shocks:
        assert (out[k] > 0) == (shocks[k] > 0)


def test_the_neutral_multiplier_leaves_the_calibration_untouched():
    shocks = {"Energy": 0.18, "Autos": -0.13}
    assert scale_sector_shocks(shocks, NEUTRAL) == shocks


# ─── no credential ───────────────────────────────────────────────────────────

def test_without_a_key_no_request_is_made_and_the_reason_says_so(monkeypatch):
    """Absent a credential the module must not reach the network at all — and must not
    quietly return 1.0 as though it had measured something."""
    monkeypatch.delenv("WORLDMONITOR_API_KEY", raising=False)
    import urllib.request
    def boom(*a, **k):  # noqa: ANN002,ANN003
        raise AssertionError("fetch_signal made a network call with no credential")
    monkeypatch.setattr(urllib.request, "urlopen", boom)
    s = fetch_signal()
    assert not s.measured and s.multiplier == NEUTRAL
    assert "WORLDMONITOR_API_KEY" in s.reason


# ─── S6 integration ──────────────────────────────────────────────────────────

def test_a_scaled_run_persists_the_scaled_description_not_the_constant():
    """The defect this guards: resolving the persisted row against the module constant would
    write the scaled P&L beside the UNSCALED description and shock map, so /risk would render
    a figure whose stated cause is not the one it was computed from."""
    from backend.services.scenario_analysis import (
        SCENARIOS, run_scenario_analysis_with_scenarios, scenario_results_to_dict,
    )

    class BM:
        gross_exposure = 0.20
        net_exposure = 0.0

    picks = [{"asset": "XLE", "direction": "long", "weight": 0.20}]
    sig = signal_from_payload(payload({"hormuz_strait": cp(80.0)}))
    assert sig.measured and sig.multiplier > 1.0

    results, scenarios = run_scenario_analysis_with_scenarios(
        picks, BM(), 1e8, None, chokepoint_signal=sig
    )
    rows = scenario_results_to_dict(results, scenarios)
    s6 = next(r for r in rows if r["scenario_name"] == "S6_supply_shock")

    # The persisted shock matches what the P&L was computed from...
    base = next(s for s in SCENARIOS if s.name == "S6_supply_shock")
    assert s6["sector_shocks"]["Energy"] > base.sector_shocks["Energy"]
    # ...and the description says it was scaled, naming the chokepoint.
    assert "hormuz_strait" in s6["description"]

    # Against the module constant it would have disagreed.
    stale_rows = scenario_results_to_dict(results)
    stale_s6 = next(r for r in stale_rows if r["scenario_name"] == "S6_supply_shock")
    assert stale_s6["sector_shocks"]["Energy"] == base.sector_shocks["Energy"]


def test_an_unmeasured_signal_leaves_s6_exactly_as_calibrated():
    from backend.services.scenario_analysis import SCENARIOS, scenarios_for_run
    base = next(s for s in SCENARIOS if s.name == "S6_supply_shock")
    run = next(s for s in scenarios_for_run(neutral("no key")) if s.name == "S6_supply_shock")
    assert run.sector_shocks == base.sector_shocks
    assert run.base_asset_shocks == base.base_asset_shocks
    # ...but the reader is still told which calibration ran.
    assert "no key" in run.description


def test_scenarios_for_run_never_mutates_the_module_constant():
    """SCENARIOS is the reviewed ADR-0088 calibration and has to stay readable as such."""
    from backend.services.scenario_analysis import SCENARIOS, scenarios_for_run
    before = dict(next(s for s in SCENARIOS if s.name == "S6_supply_shock").sector_shocks)
    scenarios_for_run(signal_from_payload(payload({"h": cp(95.0)})))
    after = dict(next(s for s in SCENARIOS if s.name == "S6_supply_shock").sector_shocks)
    assert before == after
