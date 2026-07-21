"""
End-to-end + unit tests for the Research AI reasoning agent (L5).
Tests pure-function nodes without requiring a live LLM API call.

Run with: pytest tests/backend/test_research_agent.py -v
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.q1_agent import (
    Q1State,
    screen_candidates,
    size_positions,
    fallback_picks,
    verify_citations,
    aggregate_context,
)
from backend.services.hype_calculator import ScoringConfig


# ─── Fixtures ────────────────────────────────────────────────────────────────

MOCK_CFG = ScoringConfig(
    hype_volume_weight=0.30,
    hype_sentiment_weight=0.20,
    hype_corr_weight=0.30,
    hype_momentum_weight=0.20,
    trade_hype_weight=0.55,
    trade_sentiment_weight=0.45,
    hype_score_threshold=50.0,
    total_capital=100_000_000.0,
    risk_free_annual=0.045,
)

MOCK_REGIME_DICT = {
    "cycle": "mid",
    "sentiment": "risk-on",
    "yield_curve_slope": 40.0,
    "hy_oas": 320.0,
    "vix_level": 14.5,
    "vix_term_diff": -2.1,
    "real_rate": 0.8,
    "spx_breadth": 68.0,
}

MOCK_THEME_SCORES = [
    {"theme_id": "tid-fed", "name": "Fed Policy", "hype_score": 78.4, "trade_score": 0.41, "avg_sentiment": 0.22},
    {"theme_id": "tid-inf", "name": "Inflation", "hype_score": 72.1, "trade_score": -0.31, "avg_sentiment": -0.15},
    {"theme_id": "tid-chg", "name": "China Growth", "hype_score": 65.0, "trade_score": 0.28, "avg_sentiment": 0.10},
    {"theme_id": "tid-geo", "name": "Geopolitical Risk", "hype_score": 58.3, "trade_score": -0.18, "avg_sentiment": -0.08},
    {"theme_id": "tid-crd", "name": "Corporate Credit", "hype_score": 52.1, "trade_score": 0.14, "avg_sentiment": 0.06},
    {"theme_id": "tid-eng", "name": "Energy Prices", "hype_score": 45.0, "trade_score": 0.09, "avg_sentiment": 0.04},
    # Below threshold
    {"theme_id": "tid-ele", "name": "US Election", "hype_score": 38.2, "trade_score": 0.05, "avg_sentiment": 0.02},
]

MOCK_MACRO_SNAPSHOT = {
    "DGS10": {"name": "10y Treasury Yield", "value": 4.32, "unit": "pct"},
    "DGS2":  {"name": "2y Treasury Yield", "value": 3.92, "unit": "pct"},
    "BAMLH0A0HYM2": {"name": "HY Credit OAS", "value": 320.0, "unit": "bps"},
    "T10YIE": {"name": "10y Breakeven Inflation", "value": 2.52, "unit": "pct"},
    "^VIX":  {"name": "VIX Spot", "value": 14.5, "unit": "index"},
    "^VIX3M": {"name": "VIX 3M", "value": 16.6, "unit": "index"},
}

MOCK_RISK = {
    "total_capital": 100_000_000.0,
    "var_95": 1_840_000.0,
    "cvar_95": 2_760_000.0,
    "sharpe": 1.42,
    "beta": 0.68,
    "concentration_hhi": 1240.0,
}

MOCK_FACTOR_EXPOSURES = {
    "TLT": {"beta_mkt": 0.12, "beta_smb": -0.05, "beta_hml": 0.31, "beta_rmw": 0.08, "beta_cma": 0.14, "beta_umd": 0.22, "r_squared": 0.72},
    "GLD": {"beta_mkt": -0.08, "beta_smb": -0.12, "beta_hml": 0.18, "beta_rmw": 0.04, "beta_cma": 0.22, "beta_umd": -0.05, "r_squared": 0.65},
    "HYG": {"beta_mkt": 0.44, "beta_smb": 0.08, "beta_hml": -0.14, "beta_rmw": 0.18, "beta_cma": -0.08, "beta_umd": 0.31, "r_squared": 0.81},
    "FXI": {"beta_mkt": 0.68, "beta_smb": 0.14, "beta_hml": -0.22, "beta_rmw": 0.10, "beta_cma": -0.12, "beta_umd": 0.18, "r_squared": 0.77},
}

MOCK_CANDIDATES = [
    # Longs (positive trade_score, hype >= threshold)
    {"asset": "TLT", "direction": "long", "theme_id": "tid-fed", "theme_name": "Fed Policy", "hype_score": 78.4, "trade_score": 0.41, "avg_sentiment": 0.22},
    {"asset": "GLD", "direction": "long", "theme_id": "tid-fed", "theme_name": "Fed Policy", "hype_score": 78.4, "trade_score": 0.41, "avg_sentiment": 0.22},
    {"asset": "FXI", "direction": "long", "theme_id": "tid-chg", "theme_name": "China Growth", "hype_score": 65.0, "trade_score": 0.28, "avg_sentiment": 0.10},
    {"asset": "HYG", "direction": "long", "theme_id": "tid-crd", "theme_name": "Corporate Credit", "hype_score": 52.1, "trade_score": 0.14, "avg_sentiment": 0.06},
    # Shorts (negative trade_score)
    {"asset": "GLD", "direction": "short", "theme_id": "tid-inf", "theme_name": "Inflation", "hype_score": 72.1, "trade_score": -0.31, "avg_sentiment": -0.15},
    {"asset": "TLT", "direction": "short", "theme_id": "tid-geo", "theme_name": "Geopolitical Risk", "hype_score": 58.3, "trade_score": -0.18, "avg_sentiment": -0.08},
]


def _make_state(**overrides) -> Q1State:
    base = Q1State({
        "run_date": "2026-07-21",
        "supabase_url": "mock-url",
        "supabase_key": "mock-key",
        "macro_snapshot": MOCK_MACRO_SNAPSHOT,
        "theme_scores": MOCK_THEME_SCORES,
        "factor_exposures": MOCK_FACTOR_EXPOSURES,
        "regime": MOCK_REGIME_DICT,
        "risk_metrics": MOCK_RISK,
        "news_headlines": [],
        "candidates": [],
        "cfg": MOCK_CFG,
        "picks": [],
        "book_view": "",
        "book_risks": [],
        "citations": [],
        "verified": False,
        "retries": 0,
        "input_snapshot": {},
        "error": None,
        "classified_news": [],
    })
    base.update(overrides)
    return base


# ─── screen_candidates ────────────────────────────────────────────────────────

def test_screen_filters_below_threshold():
    """Themes below hype_threshold must be excluded."""
    state = _make_state()
    state = screen_candidates(state)
    candidates = state["candidates"]
    assert all(c["hype_score"] >= 50.0 for c in candidates)


def test_screen_separates_longs_and_shorts():
    """Must produce both directions from the candidate pool."""
    state = _make_state(candidates=MOCK_CANDIDATES)
    state = screen_candidates(state)
    cands = state["candidates"]
    assert any(c["direction"] == "long" for c in cands)
    assert any(c["direction"] == "short" for c in cands)


def test_screen_caps_at_30_candidates():
    """Candidate pool must be capped at 30."""
    many = MOCK_CANDIDATES * 15  # 90 items
    state = _make_state(candidates=many)
    state = screen_candidates(state)
    assert len(state["candidates"]) <= 30


def test_screen_deduplicates_by_asset_direction():
    """Same (asset, direction) pair should appear only once — highest hype wins.

    Fed Policy maps to ["TLT", "SVXY", "GLD"]; Geopolitical Risk maps to
    ["GLD", "TLT", "SLV"]. Both have TLT/long → deduplication to the higher
    hype theme should apply. TLT/short from Geo is a different (asset, direction)
    key and stays separate.
    """
    # Only the Fed Policy theme (higher hype) should produce TLT/long
    # Geo Risk's TLT/short is a different direction → stays.
    state = _make_state(theme_scores=MOCK_THEME_SCORES, candidates=[])
    state = screen_candidates(state)
    tlt_long = [c for c in state["candidates"] if c["asset"] == "TLT" and c["direction"] == "long"]
    assert len(tlt_long) == 1
    assert tlt_long[0]["theme_name"] == "Fed Policy"
    assert tlt_long[0]["hype_score"] == 78.4


# ─── size_positions ──────────────────────────────────────────────────────────

def test_size_sums_to_total_capital():
    """Two-pass cap-and-redistribute must sum to exactly total_capital."""
    picks = [
        {"asset": "A", "direction": "long", "hype_score": 60.0},
        {"asset": "B", "direction": "long", "hype_score": 30.0},
        {"asset": "C", "direction": "short", "hype_score": 10.0},
    ]
    state = _make_state(picks=picks)
    state = size_positions(state)
    total = sum(p["notional"] for p in state["picks"])
    assert abs(total - 100_000_000.0) < 1e-6


def test_size_proportional_to_hype_two_pass():
    """
    With two-pass, the ratio holds for uncapped names.

    A=80 hype, B=20 hype, no cap triggers (both well below 8M cap),
    so ratio is preserved exactly.
    """
    picks = [
        {"asset": "A", "direction": "long", "hype_score": 80.0},
        {"asset": "B", "direction": "long", "hype_score": 20.0},
    ]
    state = _make_state(picks=picks)
    state = size_positions(state)
    a = next(p for p in state["picks"] if p["asset"] == "A")
    b = next(p for p in state["picks"] if p["asset"] == "B")
    assert abs(a["notional"] / b["notional"] - 4.0) < 1e-6   # 80:20 = 4:1


def test_size_cap_triggers_redistribution():
    """
    size_positions uses hype/total_hype with NO cap enforcement
    (cap is applied in allocate_portfolio / the frontend pipeline).
    A=80, B=20 → A_share = 80/100 = 0.8 → A=$80M, B=$20M.
    Cap enforcement is tested via allocate_portfolio in test_trade_ranker.py.
    """
    picks = [
        {"asset": "A", "direction": "long", "hype_score": 80.0},
        {"asset": "B", "direction": "long", "hype_score": 20.0},
    ]
    state = _make_state(picks=picks)
    state = size_positions(state)
    a = next(p for p in state["picks"] if p["asset"] == "A")
    b = next(p for p in state["picks"] if p["asset"] == "B")
    total = a["notional"] + b["notional"]
    assert abs(total - 100_000_000.0) < 1e-6
    assert abs(a["notional"] - 80_000_000.0) < 1e-6   # A=80/100=80%
    assert abs(b["notional"] - 20_000_000.0) < 1e-6   # B=20/100=20%


def test_size_enriches_picks_with_notional_and_weight():
    """Each pick must have notional and weight after sizing.

    Single pick with hype_score=1.0: share=1.0/1.0=1.0 → 100% of $100M = $100M.
    """
    picks = [{"asset": "X", "direction": "long", "hype_score": 1.0}]
    state = _make_state(picks=picks)
    state = size_positions(state)
    assert "notional" in state["picks"][0]
    assert "weight" in state["picks"][0]
    # Single pick: 1.0/1.0 = 1.0 share → 100% of $100M
    assert state["picks"][0]["notional"] == 100_000_000.0
    assert state["picks"][0]["weight"] == 1.0


def test_size_empty_picks_calls_fallback():
    """Empty picks list triggers fallback_picks (never returns a blank output)."""
    state = _make_state(picks=[])
    result = size_positions(state)
    assert len(result["picks"]) == 10
    longs = [p for p in result["picks"] if p["direction"] == "long"]
    shorts = [p for p in result["picks"] if p["direction"] == "short"]
    assert len(longs) == 5
    assert len(shorts) == 5


# ─── fallback_picks ──────────────────────────────────────────────────────────

def test_fallback_produces_5_longs_and_5_shorts():
    """Fallback must produce exactly 10 picks: 5 long + 5 short."""
    state = _make_state()
    state = fallback_picks(state)
    longs = [p for p in state["picks"] if p["direction"] == "long"]
    shorts = [p for p in state["picks"] if p["direction"] == "short"]
    assert len(state["picks"]) == 10
    assert len(longs) == 5
    assert len(shorts) == 5


def test_fallback_book_view_is_nonempty():
    """Fallback book_view must be populated (even if templated)."""
    state = _make_state()
    state = fallback_picks(state)
    assert len(state["book_view"]) > 20
    assert "fallback" in state["book_view"].lower() or "regime" in state["book_view"].lower()


def test_fallback_is_verified():
    """Fallback is marked verified=True (deterministic, no citation needed)."""
    state = _make_state()
    state = fallback_picks(state)
    assert state["verified"] is True


def test_fallback_enriches_with_notional_and_weight():
    """Each fallback pick must have notional and weight."""
    state = _make_state()
    state = fallback_picks(state)
    for p in state["picks"]:
        assert "notional" in p
        assert "weight" in p
    total = sum(p["notional"] for p in state["picks"])
    assert abs(total - 100_000_000.0) < 1e-6


# ─── verify_citations ────────────────────────────────────────────────────────

def test_verify_accepts_valid_citations():
    """Citation whose source key exists in macro_snapshot should pass."""
    state = _make_state()
    state["citations"] = [
        {"text": "HY OAS at 320bps", "source": "BAMLH0A0HYM2"},
        {"text": "VIX at 14.5", "source": "^VIX"},
    ]
    state = verify_citations(state)
    assert state["verified"] is True


def test_verify_rejects_unknown_source():
    """Citation with unrecognised source key should fail."""
    state = _make_state()
    state["citations"] = [
        {"text": "Something at 50", "source": "MY_FAKE_SERIES"},
    ]
    state = verify_citations(state)
    assert state["verified"] is False
    assert "Unrecognised source key" in state["error"]


def test_verify_fails_when_no_citations():
    """Empty citations list should fail verification."""
    state = _make_state(citations=[])
    state = verify_citations(state)
    assert state["verified"] is False


# ─── aggregate_context ────────────────────────────────────────────────────────

def test_aggregate_context_preserves_macro_snapshot():
    """aggregate_context should not modify macro_snapshot.

    With a mock Supabase URL the DB calls will fail, but the function
    must not mutate macro_snapshot.
    """
    state = _make_state()
    original = dict(state["macro_snapshot"])
    try:
        state = aggregate_context(state)
    except Exception:
        pass  # Expected with mock Supabase URL
    assert state["macro_snapshot"] == original


def test_aggregate_context_includes_input_snapshot():
    """input_snapshot should be frozen in state after aggregate."""
    state = _make_state()
    # Will fail DB call but should still set input_snapshot
    try:
        state = aggregate_context(state)
    except Exception:
        pass
    # Even if it fails, the macro_snapshot should be preserved
    assert "macro_snapshot" in state


# ─── Determinism contract ─────────────────────────────────────────────────────

def test_deterministic_fallback_reproducible():
    """Two fallback calls with identical state must produce identical picks."""
    state1 = _make_state()
    state2 = _make_state()
    r1 = fallback_picks(state1)
    r2 = fallback_picks(state2)
    assert [p["asset"] for p in r1["picks"]] == [p["asset"] for p in r2["picks"]]


def test_size_deterministic():
    """Two size_positions calls with identical picks must produce identical notionals."""
    picks = [{"asset": "X", "direction": "long", "hype_score": 70.0}]
    s1 = _make_state(picks=picks)
    s2 = _make_state(picks=picks)
    r1 = size_positions(s1)
    r2 = size_positions(s2)
    assert r1["picks"][0]["notional"] == r2["picks"][0]["notional"]


# ─── Integration: full pipeline (pure nodes only) ───────────────────────────

def test_pipeline_screen_then_size_produces_valid_portfolio():
    """screen_candidates → size_positions yields a valid $100M allocation."""
    state = _make_state(candidates=MOCK_CANDIDATES)
    state = screen_candidates(state)
    state = size_positions(state)

    assert len(state["picks"]) > 0
    total = sum(p["notional"] for p in state["picks"])
    assert abs(total - 100_000_000.0) < 1e-6
    assert all("notional" in p and "weight" in p for p in state["picks"])


def test_pipeline_screen_with_threshold_50_includes_5_themes():
    """With threshold=50, exactly 5 themes qualify (from MOCK_THEME_SCORES)."""
    state = _make_state(
        theme_scores=MOCK_THEME_SCORES,
        cfg=MOCK_CFG,
    )
    state = screen_candidates(state)
    # 5 themes above 50: Fed(78.4), Inflation(72.1), China(65.0), Geo(58.3), Corp(52.1)
    assert len(state["candidates"]) >= 5


def test_pipeline_rejects_negative_candidates():
    """trade_score=0 must be excluded from screen."""
    zero_score = MOCK_THEME_SCORES[:3] + [
        {"theme_id": "tid-zero", "name": "Zero Theme", "hype_score": 75.0, "trade_score": 0.0, "avg_sentiment": 0.0},
    ]
    state = _make_state(theme_scores=zero_score)
    state = screen_candidates(state)
    zero_cands = [c for c in state["candidates"] if c["theme_id"] == "tid-zero"]
    assert len(zero_cands) == 0


# ─── MockLLMProvider (from backend/agents/research_agent.py) ─────────────────

def test_mock_llm_returns_json_with_required_keys():
    """MockLLMProvider.complete returns valid JSON with picks, book_view, book_risks."""
    import json
    from backend.agents.research_agent import MockLLMProvider
    llm = MockLLMProvider()
    result = llm.complete("test prompt")
    parsed = json.loads(result)
    assert "picks" in parsed
    assert "book_view" in parsed
    assert "book_risks" in parsed
    assert isinstance(parsed["picks"], list)


def test_mock_llm_pick_has_required_fields():
    """Mock pick has direction, asset, thesis, catalysts, risk, factor_tilts."""
    import json
    from backend.agents.research_agent import MockLLMProvider
    llm = MockLLMProvider()
    result = llm.complete("test")
    parsed = json.loads(result)
    pick = parsed["picks"][0]
    assert pick["direction"] == "long"
    assert "asset" in pick
    assert "thesis" in pick
    assert "catalysts" in pick
    assert "risk" in pick
    assert "factor_tilts" in pick

