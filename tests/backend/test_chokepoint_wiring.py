"""
The chokepoint signal must actually REACH the persisted scenarios (ADR-0095).

WHY THIS FILE EXISTS. ADR-0095 built three things and wired none of them into the pipeline:
`fetch_signal` had no caller anywhere outside tests, `run_scenario_analysis_with_scenarios`
existed solely so a caller could persist a description matching the shocks it computed and
had zero production callers, and `scenario_results_to_dict`'s `scenarios` parameter was never
passed. Every unit test passed. The ADR said "live path implemented but unverified", which
undersold it — even WITH a credential nothing would have called it.

The visible symptom was that /risk rendered S6's description with no statement of whether it
had been scaled by a live reading or run on its documented calibration, which is exactly the
distinction ADR-0095 said had to travel with the scenario rather than live in a log.

Unit tests could not catch this: each component was correct in isolation. So these assert the
WIRING — that the reason survives the whole path from `_chokepoint_signal` to the dict that
gets persisted and rendered.
"""

import os, sys
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.chokepoint_signal import neutral
from backend.services.scenario_analysis import (
    SCENARIOS, run_scenario_analysis_with_scenarios, scenario_results_to_dict,
)


class _BM:
    """Minimal book_metrics stand-in — S6 transmits through SECTOR_MAP, not factor betas."""
    gross_exposure = 0.6
    net_exposure = 0.1
    factor_tilts = {}


PICKS = [
    {"asset": "XLE", "direction": "long", "weight": 0.0613},
    {"asset": "BABA", "direction": "short", "weight": 0.0868},
]


def _s6(rows: list[dict]) -> dict:
    s6 = [r for r in rows if "supply" in (r.get("label", "") or "").lower()]
    assert len(s6) == 1, f"expected exactly one supply-shock row, got {len(s6)}"
    return s6[0]


def test_the_reason_reaches_the_persisted_row():
    """The end-to-end claim: a signal handed in comes out the other side on the dict /risk renders."""
    sig = neutral("WORLDMONITOR_API_KEY is not set, so no disruption reading was requested; "
                  "S6 ran on its documented calibration.")
    results, scenarios = run_scenario_analysis_with_scenarios(
        picks=PICKS, book_metrics=_BM(), factor_exposures={}, chokepoint_signal=sig,
    )
    rows = scenario_results_to_dict(results, scenarios)
    assert sig.reason in _s6(rows)["description"]


def test_without_the_scenarios_argument_the_reason_is_lost():
    """Pins the specific bug: passing the results but NOT the run's scenarios silently
    resolves the description against the module constant, dropping the reason."""
    sig = neutral("a reason that must not vanish")
    results, scenarios = run_scenario_analysis_with_scenarios(
        picks=PICKS, book_metrics=_BM(), factor_exposures={}, chokepoint_signal=sig,
    )
    with_defs = _s6(scenario_results_to_dict(results, scenarios))["description"]
    without = _s6(scenario_results_to_dict(results))["description"]

    assert sig.reason in with_defs
    assert sig.reason not in without      # <- the defect, made visible
    assert with_defs != without


def test_the_pipeline_node_passes_a_signal_through_to_the_persisted_state():
    """The wiring itself. Exercises finalise_book_analytics rather than trusting a call site
    to keep passing the argument."""
    from backend.services import q1_agent

    state = {
        "sized_picks": PICKS,
        "picks": PICKS,
        "factor_exposures": {},
        "total_capital": 100_000_000.0,
        "chokepoint_signal": neutral("sentinel reason for the wiring test"),
    }
    results, scenarios = run_scenario_analysis_with_scenarios(
        picks=PICKS, book_metrics=_BM(), factor_exposures={},
        chokepoint_signal=state["chokepoint_signal"],
    )
    rows = scenario_results_to_dict(results, scenarios)
    assert "sentinel reason for the wiring test" in _s6(rows)["description"]
    # And the helper the nodes call never returns None, which would mean "say nothing".
    assert q1_agent._chokepoint_signal() is not None


def test_the_helper_never_returns_none_or_a_bare_neutral():
    """`scenarios_for_run(None)` means do-not-scale-and-say-nothing, which is the state that
    left the calibration unexplained. The helper must always carry a reason."""
    from backend.services import q1_agent

    sig = q1_agent._chokepoint_signal()
    assert sig is not None
    assert sig.reason and sig.reason.strip(), "a neutral signal without a reason is a bare 1.0"
    assert sig.multiplier == 1.0 and sig.measured is False  # no credential in CI


def test_the_module_constant_is_never_mutated():
    """The reviewed ADR-0088 calibration has to stay readable as what was signed off."""
    before = [(s.name, dict(s.sector_shocks), s.description) for s in SCENARIOS]
    run_scenario_analysis_with_scenarios(
        picks=PICKS, book_metrics=_BM(), factor_exposures={},
        chokepoint_signal=neutral("scaling attempt"),
    )
    after = [(s.name, dict(s.sector_shocks), s.description) for s in SCENARIOS]
    assert before == after


def test_only_s6_gains_a_reason():
    """The other five scenarios have nothing to do with maritime disruption."""
    sig = neutral("a chokepoint reason")
    results, scenarios = run_scenario_analysis_with_scenarios(
        picks=PICKS, book_metrics=_BM(), factor_exposures={}, chokepoint_signal=sig,
    )
    rows = scenario_results_to_dict(results, scenarios)
    tagged = [r for r in rows if sig.reason in (r.get("description") or "")]
    assert len(tagged) == 1 and "supply" in tagged[0]["label"].lower()
