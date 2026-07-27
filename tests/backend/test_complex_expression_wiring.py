"""Does `size_positions` actually PUBLISH an expression? (ADR-0116, ADR-0099)

`test_complex_expression.py` proves the pieces work in isolation. This proves they are
connected — the failure mode a unit test cannot see and this repo has now hit twice:
`build_mu` read `edge_score` off the model's own pick dicts, which never carry it, so
every mu came back zero and the book solved to 0% gross from a green optimizer; and
`_chokepoint_signal` computed a reading nothing consumed (ADR-0099).

The load-bearing assertion is `test_removing_the_handoff_loses_the_expression`: it
severs one line of wiring and requires the book to change. A test that only checks the
happy path would keep passing if `expressions` were never threaded into `assets`.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.services import q1_agent
from backend.services.expected_returns import IcReading


SESSIONS = 300


def _returns_frame(vols: dict[str, float], seed: int = 11) -> pd.DataFrame:
    """One driver, so the three equity names cluster; GLD independent."""
    rng = np.random.default_rng(seed)
    driver = rng.normal(0, 1, SESSIONS)
    index = pd.bdate_range("2025-01-01", periods=SESSIONS)
    cols = {}
    for asset, vol in vols.items():
        if asset == "GLD":
            shock = rng.normal(0, 1, SESSIONS)
        else:
            shock = driver * 0.97 + rng.normal(0, np.sqrt(1 - 0.97**2), SESSIONS)
        cols[asset] = shock * vol / np.sqrt(252)
    return pd.DataFrame(cols, index=index)


VOLS = {"SVXY": 0.55, "SPY": 0.15, "QQQ": 0.19, "GLD": 0.14}

CANDIDATES = [
    {"asset": "SVXY", "direction": "long", "theme_id": "t1", "edge_score": 0.71,
     "vol": 0.55, "conviction": 1.29, "hype_score": 60.0, "trade_score": 0.4},
    {"asset": "SPY", "direction": "long", "theme_id": "t2", "edge_score": 0.55,
     "vol": 0.15, "conviction": 3.67, "hype_score": 50.0, "trade_score": 0.3},
    {"asset": "QQQ", "direction": "long", "theme_id": "t2", "edge_score": 0.62,
     "vol": 0.19, "conviction": 3.26, "hype_score": 55.0, "trade_score": 0.35},
    {"asset": "GLD", "direction": "long", "theme_id": "t3", "edge_score": 0.44,
     "vol": 0.14, "conviction": 3.14, "hype_score": 40.0, "trade_score": 0.25},
]

PICKS = [
    {"asset": "SVXY", "direction": "long", "theme": "US Election", "theme_id": "t1",
     "exposure": "long US equity beta",
     "thesis": "SVXY discounts a VIX term structure that ...",
     "counter_thesis": "Wrong if VIX closes above 28 for three sessions",
     "time_horizon": "2-4 weeks", "citations": [{"text": "VIX 16.2", "source": "^VIX"}]},
    {"asset": "GLD", "direction": "long", "theme": "Geopolitical Risk", "theme_id": "t3",
     "exposure": "long gold as a geopolitical hedge",
     "thesis": "Gold at ... ", "counter_thesis": "Wrong if real rates rise above ...",
     "time_horizon": "1-3 months", "citations": []},
]

IDEAS = {
    "long": {
        "count": 2,
        "names": 4,
        "complexes": [{"members": ["QQQ", "SPY", "SVXY"], "strongest": "SVXY"}],
        "standalone": ["GLD"],
    },
    "short": {"count": 0, "names": 0, "complexes": [], "standalone": []},
}


def _state(**over):
    state = {
        "run_date": "2026-07-27",
        "picks": [dict(p) for p in PICKS],
        "candidates": [dict(c) for c in CANDIDATES],
        "independent_ideas": IDEAS,
        "edge_ic": IcReading(
            value=0.05,
            raw=0.10,
            shrinkage=0.5,
            components={"edge_score": 0.10},
            weights={"edge_score": 1.0},
            n_observations=250,
            as_of="2026-07-27",
        ),
        "shared_returns": _returns_frame(VOLS),
        "factor_exposures": {},
        "cot_readings": None,
        "cfg": None,
    }
    state.update(over)
    return state


@pytest.fixture
def sized():
    return q1_agent.size_positions(_state())


class TestTheWiringHolds:
    def test_the_optimizer_ran(self, sized):
        assert sized["sizing_method"] == "optimizer", sized.get("sizing_reason")

    def test_an_unnamed_complex_member_is_published_as_a_position(self, sized):
        """The whole point. L5 named SVXY; the book must be allowed to hold SPY/QQQ."""
        expressions = [p for p in sized["picks"] if p.get("named_by_llm") is False]
        assert expressions, [p["asset"] for p in sized["picks"]]
        assert {e["expresses_pick"] for e in expressions} == {"SVXY"}

    def test_the_book_carries_the_exposure_through_the_cheaper_instrument(self, sized):
        """SVXY at 55% vol vs SPY at 15% for the same bet — equalised mu is what lets
        the covariance say so. This is the live-book outcome ADR-0115 wanted."""
        weights = {p["asset"]: p["weight"] for p in sized["picks"]}
        assert "SVXY" not in weights, weights
        assert weights.get("SPY", 0.0) > 0.0, weights

    def test_the_complex_still_respects_one_names_worth(self, sized):
        members = {"SVXY", "SPY", "QQQ"}
        total = sum(p["weight"] for p in sized["picks"] if p["asset"] in members)
        assert total <= q1_agent.MAX_SINGLE_NAME_WEIGHT + 1e-6, total

    def test_no_new_idea_was_invented(self, sized):
        """Widening expresses ideas L5 bought. It must not add one it did not."""
        assert {p["asset"] for p in sized["picks"]} <= {"SVXY", "SPY", "QQQ", "GLD"}

    def test_every_position_names_its_bet(self, sized):
        assert all(p.get("exposure") for p in sized["picks"])

    def test_expressions_share_the_parents_idea_label(self, sized):
        by_asset = {p["asset"]: p for p in sized["picks"]}
        for pick in sized["picks"]:
            if pick.get("named_by_llm") is False:
                assert pick["exposure"] == "long US equity beta", pick

    def test_a_standalone_pick_gains_no_expressions(self, sized):
        assert not [
            p for p in sized["picks"] if p.get("expresses_pick") == "GLD"
        ]

    def test_the_payload_states_what_the_wider_menu_did(self, sized):
        block = sized["optimizer_result"]["complex_expression"]
        assert sorted(o["asset"] for o in block["offered"]) == ["QQQ", "SPY"]
        assert block["mu_equalised"]["applied"] is True
        # ADR-0053: the two sizers now differ in MEMBERSHIP. Say so in the payload.
        assert block["fallback_sizer_sees_named_picks_only"] is True

    def test_binding_constraints_never_print_the_internal_id(self, sized):
        joined = " | ".join(sized["optimizer_result"].get("binding_constraints") or [])
        assert "long::0" not in joined


class TestTheHandoffIsLoadBearing:
    def test_removing_the_handoff_loses_the_expression(self, monkeypatch):
        """Sever the one line that offers the complex to the optimizer. If the book is
        unchanged, the feature was never connected and every test above is decorative."""
        monkeypatch.setattr(q1_agent, "_complex_expressions", lambda *a, **k: [])
        severed = q1_agent.size_positions(_state())
        assert not [p for p in severed["picks"] if p.get("named_by_llm") is False]
        assert "SPY" not in {p["asset"] for p in severed["picks"]}

    def test_without_equalisation_the_book_funds_the_fragile_member(self, monkeypatch):
        """The finding that makes these two changes inseparable, at book level: with mu
        left alone, the wider menu still concentrates in the highest-EdgeScore name."""
        monkeypatch.setattr(
            q1_agent, "equalise_within_complexes", lambda mu, cmap: (mu, {"applied": False})
        )
        unequalised = q1_agent.size_positions(_state())
        weights = {p["asset"]: p["weight"] for p in unequalised["picks"]}
        assert weights.get("SVXY", 0.0) > 0.0, weights
        assert weights.get("SPY", 0.0) == 0.0, weights
