"""
Bar 1: sizing takes four inputs, not two.

`docs/GOAL.md` states the test that settles it, verbatim:

    **Test:** at equal conviction, can a reader see why the crowded position is smaller
    than the uncrowded one? Today: no, because it is not.

and the constraint that governs it:

    crowding is observable on ~20% of book gross. A sizing input that is unmeasurable on
    four fifths of the book must degrade to neutral **with its coverage stated at the point
    of use** — never silently, or the caps become a claim the data cannot support.

Both are asserted here. The first two tests in this file ARE the bar; if they are deleted,
the bar is unmet regardless of what the code does.

This file also guards the seam, not just the parts. ADR-0099: a capability with no caller is
not implemented, and every existing q1_agent test leaves `cot_readings` off state, so the
crowding path is invisible to all of them.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.data.cot_fetcher import CotReading  # noqa: E402
from backend.services import q1_agent  # noqa: E402
from backend.services.book_metrics import MAX_SINGLE_NAME_WEIGHT  # noqa: E402
from backend.services.expected_returns import IcReading  # noqa: E402
from backend.services.hype_calculator import ScoringConfig  # noqa: E402
from backend.services.positioning_crowding import (  # noqa: E402
    CROWDED_CAP_MULTIPLIER,
    assess,
    crowding_caps,
)
from backend.services.q1_agent import size_positions  # noqa: E402

CFG = ScoringConfig(
    hype_volume_weight=0.30, hype_sentiment_weight=0.20, hype_corr_weight=0.30,
    hype_momentum_weight=0.20, trade_hype_weight=0.55, trade_sentiment_weight=0.45,
    hype_score_threshold=50.0, total_capital=100_000_000.0,
)

# GLD and SLV both map to a COT contract, sit in different sectors and different geographies,
# and are long-capable — so the single-name cap is the only limit in play.
CROWDED, UNCROWDED = "GLD", "SLV"


def _reading(index, code="088691", name="GOLD", as_of="2026-07-21"):
    return CotReading(code=code, name=name, net_spec=1000, index=index,
                      as_of=as_of, weeks=156, low=-5000, high=5000)


def _readings(crowded_index=95.0, uncrowded_index=50.0):
    """GLD at a speculator extreme, SLV mid-range. Both observable."""
    return {
        CROWDED: _reading(crowded_index),
        UNCROWDED: _reading(uncrowded_index, code="084691", name="SILVER"),
    }


def _state(assets, readings, with_ic=False, ic_value=0.5, edges=None):
    edges = edges or {a: 0.40 for a in assets}
    picks = [
        {"asset": a, "direction": "long", "theme_id": f"t{i}", "hype_score": 55.0,
         "trade_score": 0.2, "avg_sentiment": 0.0}
        for i, a in enumerate(assets)
    ]
    candidates = [
        {"asset": a, "direction": "long", "theme_id": f"t{i}", "hype_score": 55.0,
         "edge_score": edges[a], "vol": 0.012, "conviction": 20.0}
        for i, a in enumerate(assets)
    ]
    state = {
        "picks": picks, "candidates": candidates, "cfg": CFG,
        "cot_readings": readings,
    }
    if with_ic:
        rng = np.random.default_rng(11)
        state["shared_returns"] = pd.DataFrame(
            rng.normal(0.0004, 0.011, size=(300, len(assets))),
            columns=assets,
            index=pd.date_range("2025-01-01", periods=300, freq="B"),
        )
        # A deliberately large IC so mu pushes the weights up against the caps — the caps
        # cannot be shown to bind differentially if the interior optimum sits below both.
        state["edge_ic"] = IcReading(
            value=ic_value, raw=ic_value * 2, shrinkage=0.5,
            components={"trend": ic_value * 2}, weights={"trend": 1.0},
            n_observations=200, as_of="2026-07-24",
        )
    return state


def _weights(out):
    return {p["asset"]: p["weight"] for p in out["picks"]}


# ─── THE BAR ─────────────────────────────────────────────────────────────────


def test_at_equal_conviction_the_crowded_position_is_smaller_conviction_path():
    """GOAL.md bar 1's test, on the conviction sizer.

    Two names, identical edge and identical vol, so conviction is identical. The only thing
    that differs is that speculators are crowded on GLD's side. If the two come back equal,
    crowding is not a sizing input and the bar is unmet.
    """
    out = size_positions(_state([CROWDED, UNCROWDED], _readings()))
    weights = _weights(out)

    assert weights[CROWDED] < weights[UNCROWDED], (
        f"equal conviction, equal vol, and only {CROWDED} sits with a crowded consensus — "
        f"it must be the smaller position. Got {CROWDED}={weights[CROWDED]:.4f} vs "
        f"{UNCROWDED}={weights[UNCROWDED]:.4f}"
    )
    assert weights[CROWDED] == pytest.approx(
        MAX_SINGLE_NAME_WEIGHT * CROWDED_CAP_MULTIPLIER
    )


def test_at_equal_conviction_the_crowded_position_is_smaller_optimizer_path():
    """The same bar, on the optimizer. Both sizers must honour the input or a fallback run
    silently drops it — which is ADR-0053 with a different field."""
    out = size_positions(_state([CROWDED, UNCROWDED], _readings(), with_ic=True))
    assert out["sizing_method"] == "optimizer", out.get("sizing_reason")
    weights = _weights(out)

    assert weights[CROWDED] < weights[UNCROWDED], (
        f"the optimizer ignored the tightened cap: {CROWDED}={weights[CROWDED]:.4f} vs "
        f"{UNCROWDED}={weights[UNCROWDED]:.4f}"
    )
    assert weights[CROWDED] <= MAX_SINGLE_NAME_WEIGHT * CROWDED_CAP_MULTIPLIER + 1e-9


def test_a_reader_can_see_why_from_the_persisted_row():
    """The bar asks whether a reader can SEE why. A smaller number with no attribution does
    not answer it, so the tightening has to be nameable from the row."""
    out = size_positions(_state([CROWDED, UNCROWDED], _readings(), with_ic=True))
    crowding = out["optimizer_result"]["crowding"]

    assert crowding["applied"] is True
    assert crowding["reason"] is None
    tightened = {t["asset"]: t for t in crowding["tightened"]}
    assert CROWDED in tightened and UNCROWDED not in tightened
    assert tightened[CROWDED]["cot_index"] == 95.0
    assert tightened[CROWDED]["crowded_side"] == "long"
    assert tightened[CROWDED]["cap"] == pytest.approx(
        MAX_SINGLE_NAME_WEIGHT * CROWDED_CAP_MULTIPLIER
    )
    # Coverage leads, because the tightening means nothing without the share it could reach.
    assert crowding["coverage_share"] is not None
    assert crowding["multiplier"] == CROWDED_CAP_MULTIPLIER

    binding = out["optimizer_result"]["binding_constraints"]
    assert any("tightened single-name cap" in b and CROWDED in b for b in binding), (
        f"a tightened cap must name itself as tightened, not report as the standing 20%: "
        f"{binding}"
    )


# ─── THE CONSTRAINT: neutral where unobservable ──────────────────────────────


def test_crowding_is_neutral_where_unobservable():
    """GOAL.md's constraint, and the one that fails silently.

    ARKK maps to no COT contract. Its weight must be BIT-IDENTICAL whether crowding is
    wired or not — not merely close. If an unobservable name ever moves because of a signal
    that cannot see it, the caps have become a claim the data does not support.
    """
    assets = [CROWDED, UNCROWDED, "ARKK"]
    with_crowding = _weights(size_positions(_state(assets, _readings())))
    # `readings=None` is the "we never looked" state, under which nothing is tightened.
    without = _weights(size_positions(_state(assets, None)))

    assert with_crowding["ARKK"] == without["ARKK"], (
        f"ARKK has no contract and must be untouched: {with_crowding['ARKK']!r} vs "
        f"{without['ARKK']!r}"
    )
    # And the observable crowded name IS touched, or the test above proves nothing.
    assert with_crowding[CROWDED] < without[CROWDED]


def test_nothing_is_tightened_when_the_fetch_never_happened():
    out = size_positions(_state([CROWDED, UNCROWDED], None))
    crowding = out["optimizer_result"]["crowding"]
    assert crowding["applied"] is False
    assert crowding["fetched"] is False
    assert "not retrieved" in crowding["reason"]
    assert "unknown, not uncrowded" in crowding["reason"]


def test_the_three_reasons_nothing_was_tightened_are_distinct():
    """`fetched=False`, "nothing maps", and "checked and uncrowded" are different facts.
    Collapsing them into one "no positions tightened" would be ADR-0098's failure."""
    picks = [{"asset": CROWDED, "direction": "long", "weight": 0.5},
             {"asset": "ARKK", "direction": "long", "weight": 0.5}]

    _, not_fetched = crowding_caps(assess(picks, 1.0, None), 0.20)
    _, nothing_maps = crowding_caps(
        assess([{"asset": "ARKK", "direction": "long", "weight": 1.0}], 1.0, {}), 0.20
    )
    _, uncrowded = crowding_caps(assess(picks, 1.0, {CROWDED: _reading(50.0)}), 0.20)

    reasons = {not_fetched["reason"], nothing_maps["reason"], uncrowded["reason"]}
    assert len(reasons) == 3, f"the three absences must read differently: {reasons}"
    assert "not retrieved" in not_fetched["reason"]
    assert "maps to a futures contract" in nothing_maps["reason"]
    assert "none sits at a speculator extreme" in uncrowded["reason"]


def test_unobservable_causes_are_structured_not_only_prose():
    """Sizing has to distinguish "COT will never cover this" from "we failed to read it
    today". Parsing the rendered sentence to find out would make the wording load-bearing."""
    picks = [{"asset": "ARKK", "direction": "long", "weight": 0.5},   # no contract
             {"asset": CROWDED, "direction": "long", "weight": 0.5}]  # mapped, unread
    _, provenance = crowding_caps(assess(picks, 1.0, {}), 0.20)
    assert provenance["unobservable_causes"] == {"no_contract": 1, "not_retrieved": 1}


# ─── The inverse flip has to survive into the cap ────────────────────────────


def test_the_inverse_flip_reaches_the_cap():
    """Long SVXY is SHORT volatility. Against speculators crowded SHORT VIX, that position
    agrees with the crowd and must be tightened.

    ADR-0097 already asserts the flipped and unflipped comparisons disagree. This carries it
    through to the number that sizes the book — a wrong side has no symptom, and here it
    would silently cap the wrong position or none at all.
    """
    picks = [{"asset": "SVXY", "direction": "long", "weight": 1.0}]
    crowded_short_vix = {"SVXY": _reading(10.0, code="1170E1", name="VIX FUTURES")}

    caps, provenance = crowding_caps(assess(picks, 1.0, crowded_short_vix), 0.20)
    assert "SVXY" in caps, "long SVXY against crowded-short VIX must be tightened"
    entry = provenance["tightened"][0]
    assert entry["direction"] == "long"
    assert entry["effective_side"] == "short", "the resolved side must be the flipped one"
    assert entry["inverse"] is True

    # And the unflipped reading — specs crowded LONG VIX — must NOT tighten a long SVXY,
    # because that position is short the thing the crowd is long.
    caps_other, _ = crowding_caps(assess(picks, 1.0, {"SVXY": _reading(95.0, code="1170E1", name="VIX FUTURES")}), 0.20)
    assert caps_other == {}, (
        "if this tightens, the flip has been removed and the verdict is exactly backwards"
    )


# ─── Caps may only tighten ───────────────────────────────────────────────────


def test_a_per_name_entry_can_never_raise_a_cap():
    """An external COT print must not be able to loosen this book's published risk policy."""
    from backend.services.optimizer import OptimizerConstraints, _cap_vector
    from backend.services.trade_ranker import TradeCandidate, allocate_portfolio

    vector = _cap_vector(
        ["A", "B"],
        OptimizerConstraints(max_single={"A": 0.90}, default_single=0.20),
    )
    assert vector.tolist() == [0.20, 0.20], "0.90 must be clamped down to the base cap"

    candidates = [
        TradeCandidate(theme_id="t", asset=a, direction="long", trade_score=0.2,
                       hype_score=50.0, avg_sentiment=0.0, conviction=10.0)
        for a in ("GLD", "SLV")
    ]
    sized = allocate_portfolio(candidates, 100_000_000.0, max_single={"GLD": 0.90},
                               default_single=0.20)
    assert all(w <= 0.20 + 1e-12 for _c, _n, w in sized)


# ─── One reading per run ─────────────────────────────────────────────────────


def test_the_reading_that_sizes_is_the_reading_that_is_persisted(monkeypatch):
    """The chokepoint lesson (ADR-0099), applied here.

    Two fetches in one run can return two different readings, leaving the book SIZED by one
    and EXPLAINED by the other. `_positioning_row` must reuse what sizing used and must not
    reach the network again — this asserts the fetcher is never called once state carries a
    reading, which no per-component test can.
    """
    calls: list = []

    def _boom(*args, **kwargs):
        calls.append(args)
        raise AssertionError("a second COT fetch happened during persistence")

    monkeypatch.setattr("backend.data.cot_fetcher.fetch_readings", _boom)

    state = {
        "picks": [{"asset": CROWDED, "direction": "long", "weight": 0.15}],
        "cot_readings": _readings(),
        # `_picks_and_gross` needs a gross to denominate the coverage share against — it is
        # deliberately passed in rather than summed, so the panels cannot disagree about it.
        "book_metrics_final": {"gross_exposure": 0.15},
        "cfg": CFG,
    }
    row = q1_agent._positioning_row(state)
    assert calls == [], "the persisted row refetched instead of reusing the run's reading"
    assert row is not None
    assert row["fetched"] is True
    assert [r["asset"] for r in row["rows"]] == [CROWDED]


def test_an_empty_reading_is_not_treated_as_never_fetched():
    """`{}` means "we looked and COT had nothing usable" — a real finding. `None` means "we
    did not look". A `.get()` that cannot tell them apart would refetch on the first and
    report the second as the same thing."""
    state = {
        "picks": [{"asset": "ARKK", "direction": "long", "weight": 0.15}],
        "cot_readings": {},
        "book_metrics_final": {"gross_exposure": 0.15},
        "cfg": CFG,
    }
    row = q1_agent._positioning_row(state)
    assert row is not None
    assert row["fetched"] is True, "an empty dict is a successful fetch, not an absent one"
    assert row["rows"] == []
    assert len(row["unobservable"]) == 1
