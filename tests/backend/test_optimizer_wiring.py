"""
Does the optimizer actually size the published book?

ADR-0099: a capability with no caller is not implemented. Seventeen green unit tests
over a chokepoint signal meant nothing, because no production path called it. The
optimizer is in exactly that position on arrival — `backend/services/optimizer.py` has
sixteen tests of its own and every one of them constructs its inputs by hand.

So this file asserts the PATH: that an IC placed on state at the top reaches the sizing
node, that the sizing node's choice reaches the row that gets persisted, and — the
sharp one — that removing the IC visibly changes which sizing ran. A per-component test
cannot fail when the wiring is cut; these do.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import q1_agent  # noqa: E402
from backend.services.expected_returns import IcReading  # noqa: E402
from backend.services.hype_calculator import ScoringConfig  # noqa: E402
from backend.services.q1_agent import size_positions  # noqa: E402

CFG = ScoringConfig(
    hype_volume_weight=0.30, hype_sentiment_weight=0.20, hype_corr_weight=0.30,
    hype_momentum_weight=0.20, trade_hype_weight=0.55, trade_sentiment_weight=0.45,
    hype_score_threshold=50.0, total_capital=100_000_000.0,
)

# Spread across sectors and geographies so the caps do not clamp everything flat, and
# genuinely two-sided so the sign behaviour is exercised on the live path.
LONGS = ["SPY", "GLD", "EWJ", "EFA"]
SHORTS = ["FXI", "EEM", "UUP"]
ASSETS = LONGS + SHORTS

IC = IcReading(
    value=0.02, raw=0.04, shrinkage=0.5,
    components={"trend": 0.04}, weights={"trend": 1.0},
    n_observations=180, as_of="2026-07-26",
)


def _returns(seed=17, n=300):
    """A returns frame long enough to clear MIN_OBS_FOR_COVARIANCE (60)."""
    rng = np.random.default_rng(seed)
    data = rng.normal(0.0004, 0.011, size=(n, len(ASSETS)))
    data[:, 4] += 0.5 * data[:, 0]          # give FXI some correlation to SPY
    return pd.DataFrame(
        data, columns=ASSETS,
        index=pd.date_range("2025-01-01", periods=n, freq="B"),
    )


def _state(with_ic=True, returns=None):
    picks = [
        {"asset": a, "direction": "long" if a in LONGS else "short",
         "theme_id": f"t{i}", "hype_score": 55.0, "trade_score": 0.2,
         "avg_sentiment": 0.0}
        for i, a in enumerate(ASSETS)
    ]
    candidates = [
        {"asset": a, "direction": "long" if a in LONGS else "short",
         "theme_id": f"t{i}", "hype_score": 55.0,
         "edge_score": (0.30 if a in LONGS else -0.30) + i * 0.01,
         "vol": 0.012, "conviction": 20.0 + i}
        for i, a in enumerate(ASSETS)
    ]
    state = {
        "picks": picks,
        "candidates": candidates,
        "cfg": CFG,
        # Pre-seeded so the sizing node does not reach the network. `_hoist_returns`
        # returns the cache before fetching, which is the same seam
        # finalise_book_analytics relies on.
        "shared_returns": returns if returns is not None else _returns(),
    }
    if with_ic:
        state["edge_ic"] = IC
    else:
        state["edge_ic"] = None
        state["edge_ic_reason"] = "no EdgeScore IC has been measured yet"
    return state


# ─── The optimizer path actually runs ────────────────────────────────────────


def test_an_ic_on_state_reaches_the_sizer_and_the_optimizer_sizes_the_book():
    out = size_positions(_state())

    assert out["sizing_method"] == "optimizer", (
        f"an IC was on state and the returns frame was priced, so the optimizer "
        f"should have sized this book. It fell back instead: {out.get('sizing_reason')}"
    )
    assert out["sizing_reason"] is None
    result = out["optimizer_result"]
    assert result["feasible"] is True
    assert result["status"] in ("optimal", "optimal_inaccurate")
    assert result["ic"]["value"] == pytest.approx(0.02)
    assert result["mu"], "the expected-return vector must be persisted with the result"
    assert out["efficient_frontier"]["points"], "the frontier must be computed"
    assert out["efficient_frontier"]["current"] is not None, (
        "the 'you are here' point is the only part a reader actually asks for"
    )


def test_the_published_book_keeps_its_sides():
    """The live path, not a hand-built OptimizerInputs. Shorts must arrive negative."""
    out = size_positions(_state())
    by_asset = {p["asset"]: p for p in out["picks"]}

    assert by_asset, "the optimizer path produced no funded positions"
    for asset, pick in by_asset.items():
        if pick["direction"] == "short":
            assert pick["signed_weight"] < 0, f"{asset} is short but carries {pick['signed_weight']:+.4f}"
        else:
            assert pick["signed_weight"] > 0, f"{asset} is long but carries {pick['signed_weight']:+.4f}"
        assert pick["weight"] == pytest.approx(abs(pick["signed_weight"]))
        assert pick["notional"] == pytest.approx(pick["weight"] * CFG.total_capital)

    assert any(p["direction"] == "short" for p in by_asset.values()), (
        "every short was priced out — the book came back long-only on the LIVE path"
    )
    gross = sum(abs(p["signed_weight"]) for p in by_asset.values())
    assert gross <= 1.0 + 1e-9


def test_the_conviction_book_is_kept_as_the_comparison_baseline():
    out = size_positions(_state())
    heuristic = out["heuristic_weights"]
    assert set(heuristic) == set(ASSETS), (
        "the conviction book must cover every sizable pick, published or not"
    )
    for asset in SHORTS:
        assert heuristic[asset] < 0, "the baseline must be signed too, or the delta is nonsense"
    # The cost model prices the move from the baseline to the published book.
    assert out["rebalance_cost"]["total_cost"] >= 0
    assert out["rebalance_cost"]["turnover"] > 0, (
        "the optimizer and the conviction weighting produced identical books, which "
        "would make the whole comparison vacuous"
    )


# ─── Cutting the wiring must be visible ──────────────────────────────────────


def test_no_ic_falls_back_to_conviction_and_says_why():
    out = size_positions(_state(with_ic=False))

    assert out["sizing_method"] == "conviction"
    assert out["sizing_reason"] == "no EdgeScore IC has been measured yet", (
        "the fallback must carry the reason forward — an absence has to say which "
        "kind of absence it is (ADR-0098)"
    )
    assert out["optimizer_result"]["feasible"] is False
    assert out["optimizer_result"]["status"] == "not_run"
    assert out["picks"], "the book must still be sized — it is never left empty"
    assert all(p.get("weight") for p in out["picks"])


def test_an_unusable_returns_frame_falls_back_rather_than_failing():
    """Under 60 overlapping sessions yields no covariance. The book still publishes."""
    out = size_positions(_state(returns=_returns(n=30)))

    assert out["sizing_method"] == "conviction"
    assert "covariance" in (out["sizing_reason"] or "")
    assert out["picks"]
    gross = sum(abs(p["signed_weight"]) for p in out["picks"])
    assert gross > 0


def test_a_raising_optimizer_does_not_take_down_the_book(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("solver exploded")

    monkeypatch.setattr(q1_agent, "optimize", boom)
    out = size_positions(_state())

    assert out["sizing_method"] == "conviction"
    assert "solver exploded" in (out["sizing_reason"] or "")
    assert out["picks"], "an optimizer crash must cost the sizing, never the book"


# ─── The choice reaches the persisted row ────────────────────────────────────


class _Table:
    def __init__(self, sink):
        self.sink = sink

    def upsert(self, row, **_kwargs):
        self.sink.append(row)
        return self

    def insert(self, row, **_kwargs):
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return type("R", (), {"data": []})()


def test_the_sizing_method_reaches_the_row_that_gets_persisted(monkeypatch):
    """The boundary test. Every assertion above is about state; this is about the
    row. If someone adds a field to state and forgets `analytics_row`, nothing else
    in this file fails — and the published book goes back to not saying how it was
    sized, which is precisely ADR-0053.
    """
    upserted: list[dict] = []

    class _Client:
        def table(self, name):
            return _Table(upserted if name == "research_recommendations" else [])

    monkeypatch.setattr(q1_agent, "create_client", lambda *_a, **_k: _Client())
    monkeypatch.setattr(q1_agent, "_record_book_revisions", lambda *_a, **_k: None)

    state = size_positions(_state())
    state.update({
        "supabase_url": "https://example.supabase.co",
        "supabase_key": "key",
        "run_date": "2026-07-27",
        "book_view": "",
        "book_risks": [],
        "advisory_derivation": {"body": None},
    })

    assert q1_agent._persist_to_supabase(state) is True
    assert upserted, "nothing was written to research_recommendations"
    row = upserted[-1]

    assert row["sizing_method"] == "optimizer", (
        "size_positions chose the optimizer but the persisted row does not say so"
    )
    for column in ("optimizer_result", "efficient_frontier", "heuristic_weights",
                   "rebalance_cost", "sizing_reason"):
        assert column in row, f"{column} never reaches the persisted row"
    assert row["optimizer_result"]["feasible"] is True
    assert row["heuristic_weights"], "the comparison baseline must be persisted too"
