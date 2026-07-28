"""
End-to-end coverage for the canonical L5 Q1 agent.

Replaces the legacy test_research_agent.py (deleted in T17) which used to
import the orphan backend.agents.research_agent module. The canonical L5
lives in backend.services.q1_agent and is driven from scripts/daily_refresh.py
via run_q1_agent.

T18 (separate) extends reason_picks to emit an AdvisoryDerivation with
display_status. These tests pin the precursor invariants that T18 must
preserve:

  * When the LLM path succeeds with verifiable citations, the resulting
    state has picks + book_view + citations + verified=True.
  * When the heuristic fallback is used, the resulting state must be
    distinguishable from an LLM-verified run — verified must be set in a
    way that T18's display_status mapping can downgrade to "partial"
    or "unverified" (i.e. the fallback path must NOT claim citation_status
    == "all_verified").

These tests stub backend.services.q1_agent._llm_complete — a real LLM
endpoint is never called.

Run with: pytest tests/backend/test_q1_agent.py -v
"""
import sys
import os
import json
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services import q1_agent
from backend.services.q1_agent import (
    Q1State,
    screen_candidates,
    fallback_picks,
    verify_citations,
    reason_picks,
    size_positions,
    _backfill_pick_theme_ids,
)
from backend.services.hype_calculator import ScoringConfig
from backend.derivations.advisory import AdvisoryDerivation, validate_advisory


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
]

MOCK_MACRO_SNAPSHOT = {
    "DGS10": {"name": "10y Treasury Yield", "value": 4.32, "unit": "pct"},
    "DGS2":  {"name": "2y Treasury Yield", "value": 3.92, "unit": "pct"},
    "BAMLH0A0HYM2": {"name": "HY Credit OAS", "value": 320.0, "unit": "bps"},
    "T10YIE": {"name": "10y Breakeven Inflation", "value": 2.52, "unit": "pct"},
    "^VIX":  {"name": "VIX Spot", "value": 14.5, "unit": "index"},
    "^VIX3M": {"name": "VIX 3M", "value": 16.6, "unit": "index"},
}


def _make_l1_candidates(theme_scores=MOCK_THEME_SCORES) -> list[dict]:
    """Mirror the L1 candidate pool daily_refresh hands to run_q1_agent: themes
    that clear the hype gate, direction = sign(TradeScore), expanded to assets.
    Since ADR-0030 screen_candidates FILTERS this pool rather than rebuilding it
    from theme_scores, tests must seed it the way L1 would."""
    pool: list[dict] = []
    for t in theme_scores:
        if t["hype_score"] < MOCK_CFG.hype_score_threshold or t["trade_score"] == 0:
            continue
        direction = "long" if t["trade_score"] > 0 else "short"
        for asset in q1_agent._theme_default_assets(t["name"]):
            pool.append({
                "asset": asset,
                "direction": direction,
                "theme_id": t["theme_id"],
                # L1 (run_q1_agent) hands over theme_name="" — screen_candidates
                # backfills it from theme_scores. Mirror that so the backfill path
                # is exercised, not bypassed (adversarial-review finding).
                "theme_name": "",
                "hype_score": t["hype_score"],
                "trade_score": t["trade_score"],
                "avg_sentiment": t.get("avg_sentiment", 0.0),
            })
    return pool


def _make_state(**overrides) -> Q1State:
    """Build a minimal Q1State suitable for driving deterministic graph nodes."""
    base = Q1State({
        "run_date": "2026-07-21",
        "supabase_url": "mock-url",
        "supabase_key": "mock-key",
        "macro_snapshot": MOCK_MACRO_SNAPSHOT,
        "theme_scores": list(MOCK_THEME_SCORES),
        "factor_exposures": {},
        "regime": dict(MOCK_REGIME_DICT),
        "risk_metrics": {"var_95": 1_840_000.0, "cvar_95": 2_760_000.0, "sharpe": 1.42, "beta": 0.68},
        "news_headlines": [],
        "classified_news": [],
        "candidates": _make_l1_candidates(),
        "picks": [],
        "book_view": "",
        "book_risks": [],
        "citations": [],
        "verified": False,
        "retries": 0,
        "input_snapshot": {},
        "error": None,
        "cfg": MOCK_CFG,
        "lens": "multi_asset",
        "book_metrics_summary": "",
        "scenario_table": "",
        "correlation_warnings": [],
        "cap_violations": [],
    })
    base.update(overrides)
    return base


def _make_5l_5s_payload() -> str:
    """A realistic LLM JSON response: 5 longs + 5 shorts, with verifiable citations.

    Every cited source must exist in MOCK_MACRO_SNAPSHOT so verify_citations
    passes. Citations carry text with a numeric value matching the snapshot
    (BAMLH0A0HYM2 == 320, ^VIX == 14.5).
    """
    return json.dumps({
        "picks": [
            {
                "rank": 1, "direction": "long", "asset": "TLT", "theme": "Fed Policy",
                "hype_score": 78.4, "trade_score": 0.41,
                "thesis": "Long duration as Fed pivots; HY OAS at 320bps keeps risk-on intact.",
                "counter_thesis": "Disqualified if 10y yield breaks above 4.80% for 3+ closes.",
                "time_horizon": "2-4 weeks",
                "catalysts": ["FOMC meeting"], "risk": "Curve steepens faster than expected.",
                "factor_tilts": {"beta_mkt": 0.12, "beta_umd": 0.22},
                "citations": [{"text": "HY OAS at 320bps", "source": "BAMLH0A0HYM2", "value": 320.0}],
            },
            {
                "rank": 2, "direction": "long", "asset": "GLD", "theme": "Fed Policy",
                "hype_score": 78.4, "trade_score": 0.41,
                "thesis": "Gold benefits from real-rate compression; VIX at 14.5 supports carry.",
                "counter_thesis": "Disqualified if VIX breaks above 22.",
                "time_horizon": "2-4 weeks",
                "catalysts": ["CPI release"], "risk": "Strong NFP surprises hawkish Fed.",
                "factor_tilts": {"beta_mkt": -0.08, "beta_hml": 0.18},
                "citations": [{"text": "VIX at 14.5", "source": "^VIX", "value": 14.5}],
            },
            {
                "rank": 3, "direction": "long", "asset": "FXI", "theme": "China Growth",
                "hype_score": 65.0, "trade_score": 0.28,
                "thesis": "China reopening tailwind; theme carries positive trade_score of 0.28.",
                "counter_thesis": "Disqualified if PBOC tightens unexpectedly.",
                "time_horizon": "1-3 months",
                "catalysts": ["Politburo meeting"], "risk": "Geopolitical escalation.",
                "factor_tilts": {"beta_mkt": 0.68},
                "citations": [{"text": "Trade score 0.28", "source": "theme:tid-chg:trade"}],
            },
            {
                "rank": 4, "direction": "long", "asset": "HYG", "theme": "Corporate Credit",
                "hype_score": 52.1, "trade_score": 0.14,
                "thesis": "Carry trade while HY OAS at 320bps.",
                "counter_thesis": "Disqualified if HY OAS widens above 450bps.",
                "time_horizon": "2-4 weeks",
                "catalysts": ["Earnings season"], "risk": "Credit downgrade cycle.",
                "factor_tilts": {"beta_mkt": 0.44},
                "citations": [{"text": "HY OAS at 320bps", "source": "BAMLH0A0HYM2", "value": 320.0}],
            },
            {
                "rank": 5, "direction": "long", "asset": "IEF", "theme": "Fed Policy",
                "hype_score": 60.0, "trade_score": 0.18,
                "thesis": "Intermediate duration as curve flattens.",
                "counter_thesis": "Disqualified if 10y yield breaks 5%.",
                "time_horizon": "1-3 months",
                "catalysts": ["Treasury refunding"], "risk": "Term premium repricing.",
                "factor_tilts": {"beta_mkt": 0.05},
                "citations": [{"text": "10y at 4.32%", "source": "DGS10", "value": 4.32}],
            },
            {
                "rank": 6, "direction": "short", "asset": "TLT", "theme": "Geopolitical Risk",
                "hype_score": 58.3, "trade_score": -0.18,
                "thesis": "Short duration into geopolitical shock; VIX term at -2.1 signals spot stress.",
                "counter_thesis": "Disqualified if VIX term flips positive.",
                "time_horizon": "1-2 weeks",
                "catalysts": ["OPEC meeting"], "risk": "Flight-to-quality overwhelms duration short.",
                "factor_tilts": {"beta_mkt": 0.12},
                "citations": [{"text": "VIX term diff -2.1", "source": "^VIX3M", "value": 16.6}],
            },
            {
                "rank": 7, "direction": "short", "asset": "GLD", "theme": "Inflation",
                "hype_score": 72.1, "trade_score": -0.31,
                "thesis": "Real rate at 0.8% caps gold upside.",
                "counter_thesis": "Disqualified if real rate turns negative.",
                "time_horizon": "2-4 weeks",
                "catalysts": ["Core PCE"], "risk": "Inflation re-acceleration.",
                "factor_tilts": {"beta_mkt": -0.08},
                "citations": [{"text": "Real rate 0.8%", "source": "DGS10", "value": 4.32}],
            },
            {
                "rank": 8, "direction": "short", "asset": "XLE", "theme": "Inflation",
                "hype_score": 72.1, "trade_score": -0.31,
                "thesis": "Energy rolls over as trade_score -0.31 signals exhaustion.",
                "counter_thesis": "Disqualified if oil breaks above 95.",
                "time_horizon": "1-3 months",
                "catalysts": ["OPEC+"], "risk": "Supply shock.",
                "factor_tilts": {"beta_mkt": 0.55},
                "citations": [{"text": "Trade score -0.31", "source": "theme:tid-inf:trade"}],
            },
            {
                "rank": 9, "direction": "short", "asset": "QQQ", "theme": "Geopolitical Risk",
                "hype_score": 58.3, "trade_score": -0.18,
                "thesis": "Crowded tech long vulnerable to geopolitical escalation.",
                "counter_thesis": "Disqualified if breadth re-accelerates above 70%.",
                "time_horizon": "2-4 weeks",
                "catalysts": ["Earnings"], "risk": "AI capex beat cycle extends.",
                "factor_tilts": {"beta_mkt": 1.10, "beta_umd": 0.65},
                "citations": [{"text": "Breadth 68%", "source": "DGS10", "value": 4.32}],
            },
            {
                "rank": 10, "direction": "short", "asset": "XLF", "theme": "Inflation",
                "hype_score": 72.1, "trade_score": -0.31,
                "thesis": "Banks hurt by curve flattening; trade_score -0.31 already rolling.",
                "counter_thesis": "Disqualified if curve re-steepens above 75bps.",
                "time_horizon": "1-3 months",
                "catalysts": ["FOMC"], "risk": "Yield curve control rumor.",
                "factor_tilts": {"beta_mkt": 0.85},
                "citations": [{"text": "Trade score -0.31", "source": "theme:tid-inf:trade"}],
            },
        ],
        "book_view": "Mid-cycle, risk-on regime with VIX at 14.5 and HY OAS at 320bps. Book tilts long duration, long credit carry, short energy and short tech into geopolitical risk.",
        "book_risks": [
            "VIX term structure inversion (-2.1) signals near-term hedging pressure",
            "Breadth 68% leaves 32% of names dragging; factor momentum fragile",
            "HY OAS at 320bps leaves limited carry cushion if credit widens",
        ],
        "citations": [
            {"text": "HY OAS at 320bps", "source": "BAMLH0A0HYM2", "value": 320.0},
            {"text": "VIX at 14.5", "source": "^VIX", "value": 14.5},
        ],
    })


# ─── Mock-LLM driver for Q1 ──────────────────────────────────────────────────

class _StubLLM:
    """
    Test double that monkey-patches q1_agent._llm_complete to return a
    fixed response (used for reason_picks). classify_news is a no-op when
    state['news_headlines'] is empty so it never calls _llm_complete.
    """
    def __init__(self, payload: str):
        self.payload = payload
        self.calls: list[tuple[str, str]] = []

    def __call__(self, prompt: str, system: str = "", temperature: float = 0.0,
                 response_schema: dict | None = None) -> str:
        # Mirror _llm_complete's signature — reason_picks now passes
        # response_schema (Gemini structured output); the stub just ignores it.
        self.calls.append((prompt, system))
        return self.payload


@pytest.fixture
def stub_llm(monkeypatch):
    """Install a stub LLM and yield it so tests can inspect .calls."""
    stub = _StubLLM(_make_5l_5s_payload())
    monkeypatch.setattr(q1_agent, "_llm_complete", stub)
    return stub


# ─── Test 1: LLM path produces verifiable advisory with display_status contract ─

def test_q1_llm_path_persists_advisory_with_display_status(stub_llm):
    """
    Drive the Q1 graph nodes (screen → book_metrics → scenario → reason →
    verify → size) in mock LLM mode. Assert the resulting state has the
    contract T18 will use to emit display_status:

      - 10 picks (5 long + 5 short)
      - non-empty book_view
      - non-empty citations list
      - verified=True (citation_status == "all_verified")
      - retries == 0 (LLM succeeded first try)
      - the same shape validate_advisory requires for display_status=verified
        (non-empty evidence_ids, generated_by='l5_q1_agent', fallback_used=False)

    This is the "happy path" that produces a verified advisory row.
    """
    state = _make_state()
    state = screen_candidates(state)
    assert len(state["candidates"]) >= 5, "screen_candidates should yield a usable pool"

    state = reason_picks(state)
    assert state["verified"] is False or len(state["picks"]) > 0, \
        "reason_picks should populate picks even before verify_citations"

    state = verify_citations(state)
    assert state["verified"] is True, \
        f"expected verified=True on clean citations, got error={state.get('error')}"
    assert len(state["citations"]) > 0, "verified advisory must carry citations"
    assert state["retries"] == 0, "stub LLM should succeed on first try"
    assert len(state["picks"]) == 10, "5 long + 5 short = 10 picks"
    longs = [p for p in state["picks"] if p["direction"] == "long"]
    shorts = [p for p in state["picks"] if p["direction"] == "short"]
    assert len(longs) == 5
    assert len(shorts) == 5
    assert len(state["book_view"]) > 50, "book_view should be a real narrative"

    # Shape the T18 AdvisoryDerivation must validate as display_status='verified'.
    # We assert the inputs validate_advisory requires so that, when T18 wires
    # reason_picks to emit AdvisoryDerivation, the verified branch passes.
    evidence_ids = [c["source"] for c in state["citations"]]
    advisory = AdvisoryDerivation(
        field_id="q1.thesis",
        generated_by="l5_q1_agent",
        display_status="verified",
        body=state["book_view"],
        method_id="q1_agent.reason_picks",
        evidence_ids=evidence_ids,
        citation_status="all_verified",
        fallback_used=False,
        computed_at=date(2026, 7, 21),
        as_of=date(2026, 7, 21),
    )
    # Must not raise — equivalent of asserting display_status='verified' is
    # admissible for the LLM-path row that T18 will persist.
    validate_advisory(advisory)

    # Confirm the stub LLM was actually invoked (i.e. we drove the real path).
    assert len(stub_llm.calls) >= 1
    # And the prompt contained the macro snapshot (sanity-check real wiring).
    assert "MACRO SNAPSHOT" in stub_llm.calls[0][0]


def test_screen_candidates_inherits_l1_pool_without_regating_hype():
    """ADR-0030: screen_candidates filters the L1 pool and does NOT re-apply the
    hype gate or re-derive direction. A backfilled long from a SUB-threshold theme
    (the ADR-0029 two-sided guarantee) survives into the L5 candidate pool. Before
    ADR-0030 the L5 screen rebuilt the pool from theme_scores with its own
    hype>=threshold gate and dropped it, so the L5 book could go one-sided even
    when the L1 book was two-sided."""
    state = _make_state(
        candidates=[
            # eligible short (hype 80, clears the gate)
            {"asset": "FXI", "direction": "short", "theme_id": "tid-chg",
             "theme_name": "China Growth", "hype_score": 80.0, "trade_score": -0.2,
             "avg_sentiment": -0.1},
            # backfilled long from a SUB-threshold theme (hype 39 < 50 gate)
            {"asset": "HYG", "direction": "long", "theme_id": "tid-crd",
             "theme_name": "Corporate Credit", "hype_score": 39.0, "trade_score": 0.04,
             "avg_sentiment": 0.09},
        ],
        factor_exposures={},
    )
    state = screen_candidates(state)
    pairs = {(c["asset"], c["direction"]) for c in state["candidates"]}
    assert ("HYG", "long") in pairs      # sub-threshold backfilled long survives
    assert ("FXI", "short") in pairs
    assert {c["direction"] for c in state["candidates"]} == {"long", "short"}


def test_screen_candidates_backfills_theme_name_from_theme_scores():
    """ADR-0030: L1 hands over theme_name="" ; screen_candidates backfills it from
    theme_scores so the candidate table and /book provenance name the theme."""
    state = _make_state()   # _make_l1_candidates seeds theme_name="" (as L1 does)
    state = screen_candidates(state)
    assert state["candidates"], "expected a non-empty pool"
    assert all(c["theme_name"] for c in state["candidates"]), \
        "every candidate must have a backfilled theme_name"
    # e.g. the China Growth ticker FXI resolves to its theme name
    fxi = next(c for c in state["candidates"] if c["asset"] == "FXI")
    assert fxi["theme_name"] == "China Growth"


def test_screen_candidates_lens_filter_drops_out_of_lens():
    """lens != multi_asset keeps only in-lens assets; the drop is counted in the funnel."""
    state = _make_state(
        lens="credit",
        candidates=[
            {"asset": "HYG", "direction": "long", "theme_id": "tid-crd",
             "theme_name": "Corporate Credit", "hype_score": 60.0, "trade_score": 0.1, "avg_sentiment": 0.1},
            {"asset": "FXI", "direction": "short", "theme_id": "tid-chg",
             "theme_name": "China Growth", "hype_score": 70.0, "trade_score": -0.2, "avg_sentiment": -0.1},
        ],
        factor_exposures={},
    )
    state = screen_candidates(state)
    assets = {c["asset"] for c in state["candidates"]}
    assert "HYG" in assets          # in the credit lens
    assert "FXI" not in assets      # equity, outside the credit lens
    lens_stage = next(s for s in state["screening_funnel"] if s["stage"].startswith("lens"))
    assert lens_stage["removed"] == 1


def test_screen_candidates_r2_filter_drops_illiquid_equity_exempts_etf():
    """Equities need R^2 >= 0.10; ETFs (in SECTOR_MAP) are exempt."""
    state = _make_state(
        candidates=[
            # ZEQ: not an ETF (absent from SECTOR_MAP) with R^2 0.05 -> dropped
            {"asset": "ZEQ", "direction": "long", "theme_id": "tid-fed",
             "theme_name": "Fed Policy", "hype_score": 80.0, "trade_score": 0.3, "avg_sentiment": 0.2},
            # SPY: an ETF -> exempt from the R^2 check even at 0.05
            {"asset": "SPY", "direction": "short", "theme_id": "tid-inf",
             "theme_name": "Inflation", "hype_score": 70.0, "trade_score": -0.2, "avg_sentiment": -0.1},
        ],
        factor_exposures={"ZEQ": {"r_squared": 0.05}, "SPY": {"r_squared": 0.05}},
    )
    state = screen_candidates(state)
    assets = {c["asset"] for c in state["candidates"]}
    assert "ZEQ" not in assets      # illiquid equity dropped
    assert "SPY" in assets          # ETF exempt
    r2_stage = next(s for s in state["screening_funnel"] if s["stage"].startswith("factor"))
    assert r2_stage["removed"] == 1


def test_screen_candidates_dedupes_keeping_highest_hype():
    """Same (asset, direction) reached via two themes -> keep the higher-HypeScore one."""
    state = _make_state(
        candidates=[
            {"asset": "GLD", "direction": "long", "theme_id": "tid-a",
             "theme_name": "A", "hype_score": 55.0, "trade_score": 0.1, "avg_sentiment": 0.1},
            {"asset": "GLD", "direction": "long", "theme_id": "tid-b",
             "theme_name": "B", "hype_score": 88.0, "trade_score": 0.2, "avg_sentiment": 0.2},
        ],
        factor_exposures={},
    )
    state = screen_candidates(state)
    golds = [c for c in state["candidates"] if c["asset"] == "GLD"]
    assert len(golds) == 1
    assert golds[0]["hype_score"] == 88.0     # higher-hype entry kept


def test_screen_candidates_caps_at_30():
    """The pool handed to the LLM is capped at 30."""
    cands = [
        {"asset": f"T{i}", "direction": "long", "theme_id": f"tid-{i}",
         "theme_name": f"Theme {i}", "hype_score": 90.0 - i * 0.1, "trade_score": 0.2,
         "avg_sentiment": 0.1}
        for i in range(35)
    ]
    state = _make_state(candidates=cands, factor_exposures={})
    state = screen_candidates(state)
    assert len(state["candidates"]) == 30
    cap_stage = next(s for s in state["screening_funnel"] if "cap 30" in s["stage"])
    assert cap_stage["removed"] == 5


def test_screen_candidates_empty_l1_pool_is_clean():
    """An empty L1 pool produces an empty candidate list and a well-formed funnel."""
    state = _make_state(candidates=[], factor_exposures={})
    state = screen_candidates(state)
    assert state["candidates"] == []
    assert state["screening_funnel"][0]["remaining"] == 0


def test_screen_candidates_funnel_arithmetic_reconciles():
    """Every funnel stage must satisfy remaining[i] == remaining[i-1] - removed[i],
    so the attrition accounting can't silently drift on a refactor."""
    state = _make_state()   # default pool has (GLD/TLT/SLV) dupes across themes
    state = screen_candidates(state)
    funnel = state["screening_funnel"]
    for prev, cur in zip(funnel, funnel[1:]):
        assert cur["remaining"] == prev["remaining"] - cur["removed"], \
            f"funnel stage '{cur['stage']}' breaks the running total"


def test_fallback_picks_preserves_two_sided_l1_pool():
    """ADR-0030: the deterministic fallback ranks the screened L1 pool, so a
    two-sided pool yields a two-sided fallback book (no divergent rebuild)."""
    state = _make_state(candidates=[
        {"asset": "HYG", "direction": "long", "theme_id": "tid-crd",
         "theme_name": "Corporate Credit", "hype_score": 60.0, "trade_score": 0.1, "avg_sentiment": 0.1},
        {"asset": "FXI", "direction": "short", "theme_id": "tid-chg",
         "theme_name": "China Growth", "hype_score": 70.0, "trade_score": -0.2, "avg_sentiment": -0.1},
    ])
    state = q1_agent.fallback_picks(state)
    dirs = {p["direction"] for p in state["picks"]}
    assert dirs == {"long", "short"}


def test_fallback_picks_diversifies_per_theme():
    """A day the LLM is down must not hand back a side of five correlated names. On
    2026-07-25 raw HypeScore ranking took FIVE China shorts (one theme, 6 high-corr
    pairs); the fallback now caps each theme at 2 and fills the rest from other themes."""
    china = [
        {"asset": a, "direction": "short", "theme_id": "tid-chg", "theme_name": "China Growth",
         "hype_score": 90.0 - i, "trade_score": -0.2, "avg_sentiment": -0.1}
        for i, a in enumerate(["BABA", "KWEB", "PDD", "MCHI", "FXI"])
    ]
    others = [
        {"asset": a, "direction": "short", "theme_id": tid, "theme_name": nm,
         "hype_score": 50.0, "trade_score": -0.2, "avg_sentiment": -0.1}
        for a, tid, nm in [("GDX", "tid-inf", "Inflation"),
                           ("NOC", "tid-geo", "Geopolitical"),
                           ("ARKK", "tid-elc", "US Election")]
    ]
    state = _make_state(candidates=china + others)
    state = q1_agent.fallback_picks(state)
    shorts = [p for p in state["picks"] if p["direction"] == "short"]
    china_shorts = [p for p in shorts if p["theme_id"] == "tid-chg"]
    assert len(china_shorts) <= 2, f"per-theme cap breached: {[p['asset'] for p in china_shorts]}"
    assert len(shorts) == 5, "should still fill to five from the diverse pool"


def test_fallback_picks_one_per_complex_uses_correlation_clusters():
    """When the correlation clustering is available (independent_ideas), the fallback keeps
    at most ONE name per complex — including a correlated group spread ACROSS themes that a
    per-theme cap cannot see (the 2026-07-25 gold names sat in Inflation + Fed Policy)."""
    shorts = (
        [{"asset": a, "direction": "short", "theme_id": "tid-chg", "theme_name": "China Growth",
          "hype_score": h, "trade_score": -0.2, "avg_sentiment": -0.1}
         for a, h in [("BABA", 80.0), ("KWEB", 81.0)]]
        + [{"asset": a, "direction": "short", "theme_id": tid, "theme_name": nm,
            "hype_score": h, "trade_score": -0.2, "avg_sentiment": -0.1}
           for a, tid, nm, h in [("GDX", "tid-inf", "Inflation", 70.0),
                                 ("GLD", "tid-fed", "Fed Policy", 71.0)]]   # gold, DIFFERENT themes
        + [{"asset": a, "direction": "short", "theme_id": tid, "theme_name": nm,
            "hype_score": h, "trade_score": -0.2, "avg_sentiment": -0.1}
           for a, tid, nm, h in [("NOC", "tid-geo", "Geopolitical", 60.0),
                                 ("ARKK", "tid-elc", "US Election", 61.0),
                                 ("SLB", "tid-eng", "Energy", 62.0)]]
    )
    ideas = {"short": {"complexes": [
        {"members": ["BABA", "KWEB"], "strongest": "BABA"},
        {"members": ["GDX", "GLD"], "strongest": "GDX"},   # cross-theme gold complex
    ], "standalone": ["NOC", "ARKK", "SLB"]}}
    state = _make_state(candidates=shorts, independent_ideas=ideas)
    state = q1_agent.fallback_picks(state)
    held = {p["asset"] for p in state["picks"] if p["direction"] == "short"}
    assert len(held & {"BABA", "KWEB"}) <= 1, f"two from the China complex: {held}"
    assert len(held & {"GDX", "GLD"}) <= 1, f"two from the gold complex (per-theme misses this): {held}"


def test_backfill_resolves_theme_id_from_llm_theme_name():
    """The LLM emits picks by theme NAME only; the backfill resolves the id
    (case-insensitively) so a stable theme_id travels with each pick."""
    picks = [
        {"asset": "TLT", "theme": "Fed Policy"},        # exact
        {"asset": "GLD", "theme": "inflation"},          # case-insensitive
        {"asset": "SPY", "theme": "other"},              # LLM's non-theme bucket
    ]
    _backfill_pick_theme_ids(picks, MOCK_THEME_SCORES)
    assert picks[0]["theme_id"] == "tid-fed"
    assert picks[0]["theme_name"] == "Fed Policy"
    assert picks[1]["theme_id"] == "tid-inf"
    # 'other' matches no scored theme — left without an id rather than guessed.
    assert picks[2].get("theme_id") is None


def test_backfill_keeps_existing_theme_id():
    """A pick that already carries a valid theme_id is not overwritten."""
    picks = [{"asset": "HYG", "theme": "Corporate Credit", "theme_id": "tid-crd"}]
    _backfill_pick_theme_ids(picks, MOCK_THEME_SCORES)
    assert picks[0]["theme_id"] == "tid-crd"


def test_fallback_picks_populate_theme_id():
    """ADR follow-up: the deterministic fallback now carries theme_id on every
    pick (it always had the candidate's id — it just used to drop it)."""
    state = _make_state(candidates=[
        {"asset": "HYG", "direction": "long", "theme_id": "tid-crd",
         "theme_name": "Corporate Credit", "hype_score": 60.0, "trade_score": 0.1, "avg_sentiment": 0.1},
    ])
    state = q1_agent.fallback_picks(state)
    assert state["picks"], "fallback should produce a pick"
    assert state["picks"][0]["theme_id"] == "tid-crd"
    assert state["picks"][0]["theme_name"] == "Corporate Credit"


def test_fallback_picks_empty_pool_emits_no_picks_no_fabrication():
    """ADR-0030: an empty screened pool yields an empty fallback book — the old
    path rebuilt from theme_scores via _theme_default_assets (no ADR-0029
    backfill), which could fabricate a one-sided book. It must not do that now."""
    state = _make_state(candidates=[])   # theme_scores still present
    state = q1_agent.fallback_picks(state)
    assert state["picks"] == []


# ─── Test 2: heuristic fallback must NEVER be display_status='verified' ─────

def test_q1_never_marks_heuristic_fallback_as_verified(monkeypatch):
    """
    Drive the deterministic fallback path (no LLM body). The resulting row
    must NEVER be admissible as display_status='verified'. Concretely:

      - fallback_picks populates picks, book_view, book_risks
      - the fallback body is templated (T18 contract: fallback_used=True)
      - the citations list is empty (T18 contract: evidence_ids empty)
      - therefore any AdvisoryDerivation built from this state must FAIL
        validate_advisory if display_status='verified'

    This is the guardrail that T18's verify_citations mapping must preserve.
    """
    # Force the LLM to fail so the agent takes the fallback path. Patch
    # _llm_complete to always raise — this triggers reason_picks to call
    # fallback_picks after exhausting retries.
    def _boom(*args, **kwargs):
        raise ValueError("simulated LLM outage")
    monkeypatch.setattr(q1_agent, "_llm_complete", _boom)

    state = _make_state()
    # Pre-populate candidates so fallback_picks has something to rank.
    state = screen_candidates(state)
    assert len(state["candidates"]) > 0

    # reason_picks retries 3 times (initial + 2 retries) then falls back.
    state = reason_picks(state)
    assert state["retries"] > 0, "fallback path must record at least one retry"
    # fallback_picks sorts longs/shorts and slices top 5 each; dedup may
    # reduce the count if (asset, direction) collides across themes.
    assert len(state["picks"]) > 0, "fallback must produce picks"
    assert len(state["picks"]) <= 10, "fallback cap is 10 (5L + 5S)"
    assert state["verified"] is True, \
        "fallback currently sets verified=True for downstream gating; " \
        "T18 maps this to display_status='partial'/'unverified' via fallback_used"

    # The fallback body is templated, not a real LLM synthesis.
    assert "fallback" in state["book_view"].lower() or "deterministic" in state["book_view"].lower()
    assert any("fallback" in r.lower() or "templated" in r.lower() for r in state["book_risks"])

    # Guardrail: T18's fallback path must never be admitted as 'verified'.
    # We model that here by building an AdvisoryDerivation and asserting
    # that display_status='verified' REJECTS — because fallback_used=True
    # with empty evidence_ids is incompatible with verified (per
    # validate_advisory rules).
    evidence_ids = [c["source"] for c in state.get("citations", [])]
    assert len(evidence_ids) == 0, \
        "fallback path must not synthesize LLM citations; " \
        f"got {evidence_ids!r}"

    # Build the would-be advisory with display_status='verified' and assert
    # validate_advisory raises — this proves T18's mapping must downgrade
    # fallback rows away from 'verified'.
    raised = False
    try:
        bad_advisory = AdvisoryDerivation(
            field_id="q1.thesis",
            generated_by="l5_q1_agent",
            display_status="verified",
            body=state["book_view"],
            method_id="q1_agent.fallback_picks",
            evidence_ids=evidence_ids,
            citation_status="all_verified",
            fallback_used=True,           # ← the smoking gun
            computed_at=date(2026, 7, 21),
            as_of=date(2026, 7, 21),
        )
        validate_advisory(bad_advisory)
    except ValueError:
        raised = True
    assert raised, \
        "validate_advisory must REJECT display_status='verified' when " \
        "fallback_used=True (heuristic fallback cannot be 'verified')"

    # And conversely, display_status='partial' with fallback_used=True is OK —
    # this is the target behavior T18 must implement for the fallback row.
    partial_advisory = AdvisoryDerivation(
        field_id="q1.thesis",
        generated_by="l5_q1_agent",
        display_status="partial",
        body=state["book_view"],
        method_id="q1_agent.fallback_picks",
        evidence_ids=[],
        citation_status="some_failed_retry_ok",
        fallback_used=True,
        computed_at=date(2026, 7, 21),
        as_of=date(2026, 7, 21),
    )
    # Must not raise — this is the T18 target contract for fallback rows.
    validate_advisory(partial_advisory)


# ─── Test 3: direct fallback_picks produces non-LLM-shape row ───────────────

def test_fallback_picks_does_not_invent_citations():
    """
    fallback_picks is the deterministic ranker invoked when the LLM fails.
    It must not synthesize citations for non-existent sources — that's
    exactly the failure mode T18's display_status guardrail is designed
    to catch.
    """
    state = _make_state()
    state = fallback_picks(state)

    # The fallback populates picks + book_view + book_risks.
    assert len(state["picks"]) == 10
    assert len(state["book_view"]) > 20

    # The fallback explicitly sets citations=[] (see q1_agent.fallback_picks).
    # If a future change adds LLM-style citations here, T18 would need to
    # know — this test catches that regression.
    assert state["citations"] == [], \
        "fallback_picks must not synthesize citations; T18 maps empty " \
        "citations + fallback_used=True to display_status='partial'"


# ─── Test 4 (T18): stub LLM that returns fallback-shaped body is NOT verified ─

def test_retry_feeds_the_rejection_back_into_the_prompt(monkeypatch):
    """ADR-0012 says a failed guardrail re-invokes reason_picks "with explicit
    error feedback". It didn't: the retry loop re-called the node with a
    byte-identical prompt, and _llm_complete runs at temperature=0 — so a
    deterministic model returned the same rejected answer every time. The
    2026-07-24 run failed "No citations provided" on all three attempts, then fell
    back. Without this, the retries are theatre.
    """
    stub = _StubLLM(_make_5l_5s_payload())
    monkeypatch.setattr(q1_agent, "_llm_complete", stub)

    state = _make_state()
    # First pass: no prior rejection, so the prompt must NOT carry feedback.
    q1_agent.reason_picks(state)
    first_prompt = stub.calls[-1][0]
    assert "YOUR PREVIOUS ANSWER WAS REJECTED" not in first_prompt

    # Simulate the guardrail rejecting it, exactly as verify_citations would.
    state["error"] = "No citations provided — rejecting output"
    q1_agent.reason_picks(state)
    retry_prompt = stub.calls[-1][0]

    assert "YOUR PREVIOUS ANSWER WAS REJECTED" in retry_prompt
    assert "No citations provided" in retry_prompt, "the actual reason must be quoted"
    assert retry_prompt != first_prompt, (
        "a retry prompt identical to the first is a no-op at temperature=0"
    )


def test_advisory_cannot_be_verified_with_zero_citations():
    """An empty citations array is itself a failure — silence is not compliance.

    /method publishes that contract, but nothing enforced it: any path setting
    state["verified"]=True yielded citation_status="all_verified" ->
    display_status="verified" -> a green VERIFIED chip on /book with no evidence
    behind it. research_agent_runs holds a live 2026-07-24 row with verified=True
    and citations=[] — a rule-built book presenting as model-verified.
    """
    from backend.services.q1_agent import _build_advisory_derivation

    state = _make_state(
        picks=[{"asset": "TLT", "direction": "long", "theme": "Fed Policy"}],
        book_view="A specific, non-templated macro view about duration.",
        citations=[],          # nothing to verify against
        verified=True,         # but the run claims it verified
        fallback_used=False,
    )
    adv = _build_advisory_derivation(state)
    assert adv.display_status != "verified", (
        "verified=True with zero citations must not reach display_status 'verified'"
    )
    assert adv.citation_status != "all_verified"


def test_advisory_stays_verified_when_citations_exist():
    """The guard must not break the genuine path: real citations still verify."""
    from backend.services.q1_agent import _build_advisory_derivation

    state = _make_state(
        picks=[{"asset": "TLT", "direction": "long", "theme": "Fed Policy"}],
        book_view="A specific, non-templated macro view about duration.",
        citations=[{"text": "HY OAS at 268bps", "source": "BAMLH0A0HYM2", "value": 268.0}],
        verified=True,
        fallback_used=False,
    )
    adv = _build_advisory_derivation(state)
    assert adv.citation_status == "all_verified"
    assert adv.display_status == "verified"


def test_q1_advisory_downgrades_when_llm_returns_fallback_body(monkeypatch):
    """
    T18 strict policy: if the LLM endpoint is alive but its response text
    matches the heuristic fallback (e.g. cached/template regurgitation), the
    AdvisoryDerivation MUST be downgraded to a non-verified status and the
    investor-facing body MUST be stripped to None.

    We stub _llm_complete to return a payload whose book_view carries the
    fallback sentinel phrase. reason_picks "succeeds" (LLM did not raise),
    verify_citations finds valid citations, and the row would otherwise be
    display_status='verified'. _build_advisory_derivation must still
    detect the templated body and force:
      - display_status != "verified"
      - body is None in the persisted AdvisoryDerivation
    """
    fallback_book_view = (
        "Regime: mid-cycle / risk-on sentiment. Book constructed from top "
        "HypeScore themes. This is a deterministic fallback — LLM synthesis "
        "unavailable."
    )
    fallback_payload = json.dumps({
        "picks": [
            {
                "rank": 1, "direction": "long", "asset": "TLT", "theme": "Fed Policy",
                "hype_score": 78.4, "trade_score": 0.41,
                "thesis": "long TLT via theme 'Fed Policy' (HypeScore 78.4).",
                "counter_thesis": "N/A — fallback path.",
                "time_horizon": "2-4 weeks",
                "catalysts": [], "risk": "fallback risk",
                "factor_tilts": {},
                "citations": [{"text": "HY OAS at 320bps", "source": "BAMLH0A0HYM2", "value": 320.0}],
            },
        ],
        "book_view": fallback_book_view,
        "book_risks": ["Fallback output — no LLM synthesis available"],
        "citations": [{"text": "HY OAS at 320bps", "source": "BAMLH0A0HYM2", "value": 320.0}],
    })

    stub = _StubLLM(fallback_payload)
    monkeypatch.setattr(q1_agent, "_llm_complete", stub)

    state = _make_state()
    state = screen_candidates(state)
    assert len(state["candidates"]) >= 1

    # Drive reason_picks → verify_citations → size_positions
    state = reason_picks(state)
    state = verify_citations(state)
    state = size_positions(state)

    # Sanity: the LLM-stub succeeded, so state carries the fallback-shaped body.
    assert "fallback" in state["book_view"].lower(), \
        "stub LLM must inject the fallback sentinel phrase"

    # Build the AdvisoryDerivation the way _persist_to_supabase does.
    advisory = q1_agent._build_advisory_derivation(state)
    validate_advisory(advisory)

    # Strict policy assertions (T18 brief):
    assert advisory.display_status != "verified", \
        f"fallback-shaped LLM body must NOT be display_status='verified'; " \
        f"got {advisory.display_status!r}"
    assert advisory.body is None, \
        f"fallback-shaped LLM body must be stripped to None in the persisted " \
        f"AdvisoryDerivation; got {advisory.body!r}"
    assert advisory.fallback_used is True, \
        f"fallback-shaped body must be detected and flagged fallback_used=True; " \
        f"got {advisory.fallback_used!r}"
    assert advisory.citation_status == "not_attempted", \
        f"fallback path citation_status must be 'not_attempted'; " \
        f"got {advisory.citation_status!r}"

    # And the asdict shape that goes into the JSONB column must preserve the contract.
    from dataclasses import asdict
    persisted = asdict(advisory)
    assert persisted["display_status"] != "verified"
    assert persisted["body"] is None
    assert persisted["fallback_used"] is True


# ─── verify_citations value reconciliation (P0 guardrail hardening) ───────────
#
# Historically verify_citations only checked that the *source key* existed; a
# recognised key with a hallucinated value passed. These tests pin the stronger
# contract: the cited value must MATCH the source value within tolerance.

def _state_with_citations(citations: list[dict]) -> Q1State:
    return _make_state(citations=citations)


def test_verify_citations_accepts_matching_value():
    """A citation whose value matches its source verifies cleanly."""
    state = _state_with_citations([
        {"text": "HY OAS at 320bps", "source": "BAMLH0A0HYM2", "value": 320.0},
        {"text": "VIX at 14.5", "source": "^VIX", "value": 14.5},
    ])
    state = verify_citations(state)
    assert state["verified"] is True, state.get("error")
    assert state["error"] is None


def test_verify_citations_accepts_value_within_tolerance():
    """Within the ±2% (min ±0.01) band, small reporting drift is allowed."""
    # BAMLH0A0HYM2 == 320.0 → tolerance is max(0.01, 6.4) = 6.4bps.
    state = _state_with_citations([
        {"text": "HY OAS ~324bps", "source": "BAMLH0A0HYM2", "value": 324.0},
    ])
    state = verify_citations(state)
    assert state["verified"] is True, state.get("error")


def test_verify_citations_rejects_mismatched_value():
    """The core fix: a hallucinated value on a valid source is now rejected."""
    state = _state_with_citations([
        {"text": "HY OAS at 380bps", "source": "BAMLH0A0HYM2", "value": 380.0},
    ])
    state = verify_citations(state)
    assert state["verified"] is False
    assert "does not match" in (state["error"] or "")
    assert "BAMLH0A0HYM2" in (state["error"] or "")


def test_verify_citations_rejects_valueless_text_number_mismatch():
    """With no explicit value field, the sole number in the text is reconciled."""
    # ^VIX == 14.5; claiming 25 in the text should fail.
    state = _state_with_citations([
        {"text": "VIX at 25", "source": "^VIX"},
    ])
    state = verify_citations(state)
    assert state["verified"] is False
    assert "does not match" in (state["error"] or "")


def test_verify_citations_accepts_valueless_text_number_match():
    state = _state_with_citations([
        {"text": "VIX printing 14.6", "source": "^VIX"},
    ])
    state = verify_citations(state)
    assert state["verified"] is True, state.get("error")


def test_verify_citations_reconciles_theme_sources():
    """Theme trade/hype/sentiment source keys reconcile against theme_scores."""
    # tid-fed trade_score == 0.41 in MOCK_THEME_SCORES.
    ok = verify_citations(_state_with_citations([
        {"text": "Trade score 0.41", "source": "theme:tid-fed:trade"},
    ]))
    assert ok["verified"] is True, ok.get("error")

    bad = verify_citations(_state_with_citations([
        {"text": "Trade score 0.99", "source": "theme:tid-fed:trade"},
    ]))
    assert bad["verified"] is False


def test_verify_citations_rejects_ungrounded_value():
    """A number that appears nowhere in the L0–L4 inputs is rejected, even with
    a plausible-looking source label (value-grounding, ADR-0027)."""
    state = _state_with_citations([
        {"text": "Fed cut 25bps", "source": "FEDFUNDS", "value": 25.0},
    ])
    state = verify_citations(state)
    assert state["verified"] is False
    assert "not grounded" in (state["error"] or "")


def test_verify_citations_grounds_value_despite_loose_source_label():
    """A correctly-valued citation with a human source label (not the exact key)
    passes because the value is grounded in the inputs (ADR-0027)."""
    # ^VIX == 14.5 in MOCK_MACRO_SNAPSHOT; label is a descriptive category.
    state = _state_with_citations([
        {"text": "VIX at 14.5", "source": "L3 regime classification", "value": 14.5},
    ])
    state = verify_citations(state)
    assert state["verified"] is True, state.get("error")


def test_verify_citations_accepts_qualitative_citation():
    """A citation with a valid source but no reconcilable number is accepted."""
    state = _state_with_citations([
        {"text": "Risk-on regime persists", "source": "^VIX"},
    ])
    state = verify_citations(state)
    assert state["verified"] is True, state.get("error")


# ─── _load_recent_headlines: L5 now reads real news (Task 2) ──────────────────

class _NewsChain:
    def __init__(self, data=None, raise_exc=None):
        self._data = data or []
        self._raise = raise_exc

    def select(self, *a, **k):
        return self

    def gte(self, *a, **k):
        return self

    def lte(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        if self._raise:
            raise self._raise
        return type("R", (), {"data": self._data})()


class _NewsSB:
    def __init__(self, chain):
        self._chain = chain

    def table(self, name):
        return self._chain


def test_load_recent_headlines_parses_and_filters():
    rows = [
        {"theme_id": "t1", "headline": "Fed holds rates", "source": "brave",
         "published_date": "2026-07-22", "run_date": "2026-07-23"},
        {"theme_id": "t2", "headline": "", "source": "reddit",
         "published_date": None, "run_date": "2026-07-23"},  # blank → filtered
    ]
    out = q1_agent._load_recent_headlines(_NewsSB(_NewsChain(rows)), "2026-07-23")
    assert len(out) == 1
    assert out[0]["text"] == "Fed holds rates"
    assert out[0]["date"] == "2026-07-22"
    assert out[0]["source"] == "brave"


def test_load_recent_headlines_falls_back_to_empty_when_table_absent():
    chain = _NewsChain(raise_exc=Exception('relation "theme_news" does not exist'))
    out = q1_agent._load_recent_headlines(_NewsSB(chain), "2026-07-23")
    assert out == []


# ─── Gemini provider (third L5 fallback, ADR-0026) ───────────────────────────

class _FakeGeminiResp:
    def __init__(self, status=200, text_payload=None, err=None):
        self.status_code = status
        self.headers = {"content-type": "application/json"}
        self._text_payload = text_payload
        self._err = err

    def json(self):
        if self._err is not None:
            return {"error": {"message": self._err}}
        return {"candidates": [{"content": {"parts": [{"text": self._text_payload}]}}]}

    @property
    def text(self):
        return "error-body"


def _only_gemini(monkeypatch, key="test-key"):
    monkeypatch.setattr(q1_agent, "MINIMAX_API_KEY", "")
    monkeypatch.setattr(q1_agent, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(q1_agent, "GEMINI_API_KEY", key)
    monkeypatch.setattr(q1_agent, "LLM_PROVIDER", "auto")


def test_gemini_path_strips_fences_and_passes_system(monkeypatch):
    import requests
    _only_gemini(monkeypatch)
    captured = {}

    def fake_post(url, params=None, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["params"] = params
        captured["json"] = json
        return _FakeGeminiResp(200, text_payload="```json\n{\"a\": 1}\n```")

    monkeypatch.setattr(requests, "post", fake_post)
    out = q1_agent._llm_complete("prompt text", system="sys text")

    assert out == '{"a": 1}'                       # fence stripped
    assert "gemini" in captured["url"]
    assert captured["params"]["key"] == "test-key"
    assert captured["json"]["system_instruction"]["parts"][0]["text"] == "sys text"
    assert captured["json"]["contents"][0]["parts"][0]["text"] == "prompt text"


def test_gemini_error_status_raises(monkeypatch):
    import requests
    _only_gemini(monkeypatch)
    monkeypatch.setattr(requests, "post",
                        lambda *a, **k: _FakeGeminiResp(429, err="quota exceeded"))
    with pytest.raises(ValueError, match="Gemini API error 429"):
        q1_agent._llm_complete("p")


def test_no_provider_configured_raises(monkeypatch):
    monkeypatch.setattr(q1_agent, "MINIMAX_API_KEY", "")
    monkeypatch.setattr(q1_agent, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(q1_agent, "GEMINI_API_KEY", "")
    with pytest.raises(ValueError, match="No LLM provider configured"):
        q1_agent._llm_complete("p")


def test_gemini_response_schema_wired_into_generation_config(monkeypatch):
    """response_schema forces Gemini structured output (so citations are present)."""
    import requests
    _only_gemini(monkeypatch)
    captured = {}

    def fake_post(url, params=None, headers=None, json=None, timeout=None):
        captured["json"] = json
        return _FakeGeminiResp(200, text_payload='{"ok": 1}')

    monkeypatch.setattr(requests, "post", fake_post)
    schema = {"type": "object", "properties": {"x": {"type": "number"}}, "required": ["x"]}
    q1_agent._llm_complete("p", response_schema=schema)

    gc = captured["json"]["generationConfig"]
    assert gc["responseMimeType"] == "application/json"
    assert gc["responseSchema"] == schema


def test_reason_picks_schema_requires_nonempty_citations():
    s = q1_agent.REASON_PICKS_SCHEMA
    assert "citations" in s["required"]
    assert s["properties"]["citations"].get("minItems", 0) >= 1


def test_active_model_id_reflects_provider(monkeypatch):
    monkeypatch.setattr(q1_agent, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(q1_agent, "MINIMAX_API_KEY", "")
    monkeypatch.setattr(q1_agent, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(q1_agent, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(q1_agent, "GEMINI_MODEL", "gemini-flash-latest")
    assert q1_agent._active_model_id() == "gemini-flash-latest"
    monkeypatch.setattr(q1_agent, "ANTHROPIC_API_KEY", "k")   # Anthropic outranks Gemini
    assert q1_agent._active_model_id() == q1_agent.DEFAULT_MODEL
    monkeypatch.setattr(q1_agent, "MINIMAX_API_KEY", "k")     # MiniMax outranks both
    assert q1_agent._active_model_id() == q1_agent.MINIMAX_MODEL


def test_select_provider_explicit_override_beats_priority(monkeypatch):
    monkeypatch.setattr(q1_agent, "MINIMAX_API_KEY", "m")
    monkeypatch.setattr(q1_agent, "ANTHROPIC_API_KEY", "a")   # ambient shell key
    monkeypatch.setattr(q1_agent, "GEMINI_API_KEY", "g")
    # Explicit override wins over the MiniMax/Anthropic priority.
    monkeypatch.setattr(q1_agent, "LLM_PROVIDER", "gemini")
    assert q1_agent._select_provider() == "gemini"
    # auto falls back to priority order.
    monkeypatch.setattr(q1_agent, "LLM_PROVIDER", "auto")
    assert q1_agent._select_provider() == "minimax"
    # override whose key is absent falls back to priority.
    monkeypatch.setattr(q1_agent, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(q1_agent, "GEMINI_API_KEY", "")
    assert q1_agent._select_provider() == "minimax"


def test_classify_news_caps_llm_calls(monkeypatch):
    """classify_news must not burn the whole rate-limited quota — bounded to
    CLASSIFY_MAX_HEADLINES / CLASSIFY_BATCH_SIZE calls (default 40/20 = 2)."""
    calls = {"n": 0}

    def fake(prompt, system="", temperature=0.0, response_schema=None):
        calls["n"] += 1
        return "[]"

    monkeypatch.setattr(q1_agent, "_llm_complete", fake)
    state = _make_state(news_headlines=[{"text": f"headline {i}"} for i in range(100)])
    q1_agent.classify_news(state)
    assert calls["n"] <= 2, f"classify_news made {calls['n']} calls; must stay bounded"


def test_finalise_book_analytics_tolerates_none_scenario_return(monkeypatch):
    """Regression: a scenario whose estimated_book_return is None (a pick with no
    factor beta and no direct shock) must not crash the L5 stage — surfaced by
    the GitHub Action run whose fresh factor data produced an unestimable scenario."""
    import pandas as pd
    import backend.services.book_metrics as _bm
    from types import SimpleNamespace
    monkeypatch.setattr(q1_agent, "compute_book_metrics",
                        lambda **k: SimpleNamespace(gross_exposure=1.0, net_exposure=0.0))
    monkeypatch.setattr(q1_agent, "compute_correlation_matrix", lambda *a, **k: [])
    # finalise_book_analytics now takes the run's scenario OBJECTS as well as its results, so
    # the persisted description matches the shocks the P&L came from (ADR-0095). The doubles
    # follow that shape; what this test asserts — a None estimate must not crash — is unchanged.
    monkeypatch.setattr(q1_agent, "run_scenario_analysis_with_scenarios",
                        lambda **k: (object(), []))
    # Hermetic: never let a unit test reach the network if a credential happens to be set.
    monkeypatch.setattr(q1_agent, "_chokepoint_signal",
                        lambda: SimpleNamespace(measured=False, multiplier=1.0, reason="test"))
    monkeypatch.setattr(q1_agent, "book_metrics_to_dict", lambda bm: {})
    monkeypatch.setattr(q1_agent, "scenario_results_to_dict",
                        lambda s, defs=None: [{"estimated_book_return": None}, {"estimated_book_return": -0.05}])
    monkeypatch.setattr(q1_agent, "correlation_pairs_to_dict", lambda c: [])
    monkeypatch.setattr(q1_agent, "cap_utilisation", lambda bm, picks: {"violations": []})
    # The hoisted-frame fetch and the Euler decomposition would otherwise hit yfinance.
    monkeypatch.setattr(_bm, "fetch_pick_returns", lambda *a, **k: pd.DataFrame())

    state = _make_state(picks=[{"asset": "FXI", "direction": "long", "weight": 0.5}])
    out = q1_agent.finalise_book_analytics(state)   # must not raise
    # None estimate is filtered from the worst-case calc; the data still preserves it.
    assert out["scenario_results_final"][0]["estimated_book_return"] is None
    # An empty frame yields no covariance, so the decomposition is None (not zeros).
    assert out["risk_decomposition_final"] is None


def test_finalise_book_analytics_wires_euler_decomposition(monkeypatch):
    """Step 2 of the Euler handoff: finalise_book_analytics runs decompose_risk on the
    final sized book, its contributions sum to portfolio_vol, and it REUSES the single
    hoisted frame — fetch_pick_returns is called exactly once (acceptance criterion #4)."""
    import math
    import pandas as pd
    import backend.services.book_metrics as _bm
    from types import SimpleNamespace

    idx = pd.date_range("2024-01-01", periods=120).date
    frame = pd.DataFrame({
        "AAA": [math.sin(i / 6) for i in range(120)],
        "BBB": [math.cos(i / 7) for i in range(120)],
        "CCC": [math.sin(i / 11) + 0.4 * math.cos(i / 4) for i in range(120)],
    }, index=idx)
    calls = {"n": 0}

    def _one_frame(*a, **k):
        calls["n"] += 1
        calls.setdefault("lookbacks", []).append(k.get("lookback_days"))
        return frame

    monkeypatch.setattr(_bm, "fetch_pick_returns", _one_frame)
    monkeypatch.setattr(q1_agent, "compute_book_metrics",
                        lambda **k: SimpleNamespace(gross_exposure=1.0, net_exposure=0.1))
    monkeypatch.setattr(q1_agent, "compute_correlation_matrix", lambda *a, **k: [])
    monkeypatch.setattr(q1_agent, "run_scenario_analysis_with_scenarios", lambda **k: ([], []))
    monkeypatch.setattr(q1_agent, "_chokepoint_signal",
                        lambda: SimpleNamespace(measured=False, multiplier=1.0, reason="test"))
    monkeypatch.setattr(q1_agent, "book_metrics_to_dict", lambda bm: {})
    monkeypatch.setattr(q1_agent, "scenario_results_to_dict", lambda s, defs=None: [])
    monkeypatch.setattr(q1_agent, "correlation_pairs_to_dict", lambda c: [])
    monkeypatch.setattr(q1_agent, "correlation_summary", lambda p: {})
    monkeypatch.setattr(q1_agent, "cap_utilisation", lambda bm, picks: {"violations": []})

    state = _make_state(picks=[
        {"asset": "AAA", "direction": "long", "weight": 0.4},
        {"asset": "BBB", "direction": "long", "weight": 0.3},
        {"asset": "CCC", "direction": "short", "weight": 0.3},
    ])
    out = q1_agent.finalise_book_analytics(state)
    rd = out["risk_decomposition_final"]
    assert rd is not None, "decomposition should be produced from a 3-name, 120-session frame"
    assert abs(sum(p["contribution_to_vol"] for p in rd["positions"]) - rd["portfolio_vol"]) < 1e-9
    # The invariant is that the 252-day frame is fetched ONCE and shared by every
    # consumer of it — the correlation matrix, the covariance and the Euler decomposition
    # (ADR-0082's acceptance criterion). It is NOT "yfinance is called once": the weights
    # backtest asks for a deliberately wider window, because a path statistic needs a
    # trading YEAR and 252 calendar days is only ~195 sessions. Widening the shared frame
    # instead would change the covariance from 252 sessions to 341 and move every ex-ante
    # figure AND the optimizer's weights, which is a sizing change, not a fetch change.
    #
    # So: the shared window is fetched exactly once, and no window is fetched twice.
    lookbacks = calls.get("lookbacks", [])
    assert lookbacks.count(252) == 1, (
        f"the 252-day frame must be hoisted once, was fetched {lookbacks.count(252)}x "
        f"(all lookbacks: {lookbacks})"
    )
    assert len(lookbacks) == len(set(lookbacks)), (
        f"a window was fetched more than once: {lookbacks}"
    )


def test_make_factor_table_tolerates_null_betas():
    """Real factor_exposures rows can carry NULL betas / r_squared; the prompt
    table formatter must not crash on them. Regression for the L5 TypeError
    (`unsupported format string passed to NoneType.__format__`)."""
    fe = {
        "TLT": {"beta_mkt": 0.2, "beta_smb": None, "beta_hml": 0.1,
                "beta_rmw": None, "beta_cma": 0.0, "beta_umd": None, "r_squared": None},
        "SPY": {"beta_mkt": 1.0, "beta_smb": 0.0, "beta_hml": 0.0,
                "beta_rmw": 0.0, "beta_cma": 0.0, "beta_umd": 0.0, "r_squared": 0.9},
    }
    out = q1_agent._make_factor_table(fe)   # must not raise
    assert "TLT" in out and "SPY" in out
    assert "0.00" in out                    # NULLs render as 0.00, not a crash


def test_candidate_cap_drops_the_least_decisive_not_the_least_loud():
    """ADR-0046 — the cap-30 truncation was re-imposing the attention gate.

    The pool is truncated for the LLM context window, so whatever it is sorted by
    decides what is thrown away. It was sorted by hype_score, which meant every name
    the conviction override had just admitted went straight back out again for
    belonging to a quiet theme. Measured on 2026-07-25, the first run after the
    override landed: SLV -0.430 — the single most decisive name of the day either
    way — was cut, along with GDX -0.368, NEM -0.337, IAU -0.288 and CVX +0.402.
    """
    from backend.services.q1_agent import screen_candidates

    # 31 candidates: one decisive short in a quiet theme, 30 mild names in loud ones.
    pool = [
        {"asset": "SLV", "direction": "short", "theme_id": "infl",
         "hype_score": 29.1, "trade_score": 0.0, "avg_sentiment": 0.0,
         "edge_score": -0.430, "via_conviction": True},
    ] + [
        {"asset": f"L{i:02d}", "direction": "long", "theme_id": "loud",
         "hype_score": 58.0, "trade_score": 0.0, "avg_sentiment": 0.0,
         "edge_score": 0.20, "via_conviction": False}
        for i in range(30)
    ]
    state = {
        "candidates": pool, "lens": "multi_asset", "factor_exposures": {},
        "theme_scores": [], "run_date": "2026-07-25", "cfg": MOCK_CFG,
    }
    out = screen_candidates(state)
    kept = {c["asset"] for c in out["candidates"]}
    assert len(out["candidates"]) == 30
    assert "SLV" in kept, "the most decisive name must survive the context-window cap"
    # It is first, not merely present — the ordering is by conviction.
    assert out["candidates"][0]["asset"] == "SLV"


def test_screening_funnel_reports_the_conviction_override():
    """A funnel that only ever subtracts implies the pool started complete. It did
    not, so the one stage that ADDS has to be visible."""
    from backend.services.q1_agent import screen_candidates

    pool = [
        {"asset": "FXI", "direction": "short", "theme_id": "china",
         "hype_score": 37.2, "trade_score": 0.0, "avg_sentiment": 0.0,
         "edge_score": -0.35, "via_conviction": True},
        {"asset": "SPY", "direction": "long", "theme_id": "elec",
         "hype_score": 58.2, "trade_score": 0.0, "avg_sentiment": 0.0,
         "edge_score": 0.21, "via_conviction": False},
    ]
    state = {
        "candidates": pool, "lens": "multi_asset", "factor_exposures": {},
        "theme_scores": [], "run_date": "2026-07-25", "cfg": MOCK_CFG,
    }
    out = screen_candidates(state)
    stage = next(s for s in out["screening_funnel"] if "conviction override" in s["stage"])
    assert "1 of these 2" in stage["reason"]
    # It adds rather than removes, so it must not claim attrition.
    assert stage["removed"] == 0


# ─── Pool-depth claim check (ADR-0049) ───────────────────────────────────────

def test_grounding_cannot_distinguish_a_wrong_count_from_a_right_one():
    """Why the count needs its own check rather than a citation source.

    Measured against the live 2026-07-25 inputs, every integer 0-9 grounds: each
    sits within tolerance of some value among the 106 numbers the model was shown.
    So "four independent ideas" and "five" are indistinguishable to the grounding
    rule, and no amount of exposing the count as a citable source fixes that.
    """
    from backend.services.q1_agent import _value_is_grounded

    known = [4.0, 5.0, 18.64, 2.77, 65.0]     # a realistic slice
    assert _value_is_grounded(4.0, known)
    assert _value_is_grounded(5.0, known)     # both "verify" — that is the problem


def test_idea_count_check_rejects_the_live_miscount():
    """The published 2026-07-25 thesis said the SHORT pool yielded four independent
    ideas. The measurement said five — it forgot ARKK — while the panel below it
    said five and the thesis carried a VERIFIED badge."""
    from backend.services.q1_agent import check_idea_count_claims

    prose = (
        "Five longs and four shorts are returned — the SHORT pool yields only four "
        "independent ideas because GDX/NEM collapse into SLV and KWEB into BABA."
    )
    fails = check_idea_count_claims(prose, {"long": {"count": 9}, "short": {"count": 5}})
    assert len(fails) == 1
    assert "claims 4" in fails[0] and "measurement is 5" in fails[0]


def test_idea_count_check_accepts_a_correct_restatement():
    from backend.services.q1_agent import check_idea_count_claims

    counts = {"long": {"count": 9}, "short": {"count": 5}}
    assert check_idea_count_claims("the short side held five independent ideas", counts) == []
    assert check_idea_count_claims("9 independent ideas on the long side", counts) == []


def test_idea_count_check_reads_words_and_digits():
    """The live miscount was spelled out. A digit-only scan would have missed it
    entirely, which is why a numeric-extraction guardrail was not the fix."""
    from backend.services.q1_agent import check_idea_count_claims

    counts = {"short": {"count": 5}}
    assert check_idea_count_claims("only three independent ideas short", counts)
    assert check_idea_count_claims("only 3 independent ideas short", counts)


def test_idea_count_check_is_silent_with_nothing_to_compare():
    """No measurement is not a licence to reject — and prose making no claim must
    pass untouched, or every run fails on a panel that did not render."""
    from backend.services.q1_agent import check_idea_count_claims

    assert check_idea_count_claims("four independent ideas", {}) == []
    assert check_idea_count_claims("", {"short": {"count": 5}}) == []
    assert check_idea_count_claims("a book of energy and defence", {"short": {"count": 5}}) == []


def test_verify_citations_rejects_a_wrong_count_even_when_citations_pass():
    """The check must not be swallowed by the 80%-grounded tolerance: a citation set
    can be perfect while the prose miscounts."""
    from backend.services.q1_agent import verify_citations

    state = {
        "citations": [{"text": "VIX at 18.64", "source": "^VIX", "value": 18.64}],
        "macro_snapshot": {"^VIX": {"value": 18.64}},
        "theme_scores": [], "risk_metrics": {}, "regime": {},
        "book_view": "the SHORT pool yields only four independent ideas",
        "independent_ideas": {"short": {"count": 5}},
    }
    out = verify_citations(state)
    assert out["verified"] is False
    assert "Pool-depth claim wrong" in out["error"]


def test_verify_citations_still_passes_a_clean_book():
    from backend.services.q1_agent import verify_citations

    state = {
        "citations": [{"text": "VIX at 18.64", "source": "^VIX", "value": 18.64}],
        "macro_snapshot": {"^VIX": {"value": 18.64}},
        "theme_scores": [], "risk_metrics": {}, "regime": {},
        "book_view": "fading crowded late-cycle trades",
        "independent_ideas": {"short": {"count": 5}},
    }
    assert verify_citations(state)["verified"] is True


# ─── LLM wall-clock deadline (ADR-0051) ──────────────────────────────────────

def test_llm_complete_enforces_a_wall_clock_deadline(monkeypatch):
    """requests' `timeout=` bounds the gap BETWEEN BYTES, not the call.

    Its docs say so explicitly — "not a time limit on the entire response
    download" — and the consequence was observed, not theorised: with
    LLM_TIMEOUT_SECONDS=900 one L5 call ran 23 minutes and a later one passed 45
    still inside a single attempt. In the daily job that is a hung workflow.
    """
    import time
    from backend.services import q1_agent as qa

    monkeypatch.setattr(qa, "LLM_TIMEOUT_SECONDS", 1)
    monkeypatch.setattr(qa, "_select_provider", lambda: "minimax")

    def _slow(*_a, **_k):
        time.sleep(30)          # a provider that is alive but not finishing
        return "never reached"

    monkeypatch.setattr(qa, "_llm_complete_inner", _slow)

    started = time.monotonic()
    with pytest.raises(TimeoutError) as exc:
        qa._llm_complete("prompt")
    elapsed = time.monotonic() - started

    assert elapsed < 10, f"deadline not enforced — took {elapsed:.1f}s"
    assert "wall clock" in str(exc.value)


def test_llm_complete_returns_the_providers_answer_untouched(monkeypatch):
    """The deadline must be a wrapper, not a rewrite: a normal call is unchanged."""
    from backend.services import q1_agent as qa

    monkeypatch.setattr(qa, "LLM_TIMEOUT_SECONDS", 30)
    monkeypatch.setattr(
        qa, "_llm_complete_inner",
        lambda prompt, system="", temperature=0.0, response_schema=None: f"ok:{prompt}",
    )
    assert qa._llm_complete("hello") == "ok:hello"


def test_llm_complete_propagates_a_provider_error_not_a_timeout(monkeypatch):
    """A provider that fails fast must surface its own error — the wrapper must not
    turn every failure into a timeout, or the retry feedback becomes useless."""
    from backend.services import q1_agent as qa

    monkeypatch.setattr(qa, "LLM_TIMEOUT_SECONDS", 30)

    def _boom(*_a, **_k):
        raise ValueError("MiniMax API error 429: rate limited")

    monkeypatch.setattr(qa, "_llm_complete_inner", _boom)
    with pytest.raises(ValueError, match="429"):
        qa._llm_complete("hello")


# ─── Timeout is not retried (ADR-0052) ───────────────────────────────────────

def test_a_timeout_goes_straight_to_fallback_not_three_more_attempts():
    """The real cost of a stalled provider was the retry loop, not one long call.

    reason_picks retries up to 3 times and treated every exception alike, so a
    timeout consumed 3 x LLM_TIMEOUT_SECONDS. At the 900s default that is 2700s —
    and 45 minutes is exactly what a stalled run measured. Retrying a decode failure
    is sensible (the model can fix its output, and the error is fed back); retrying a
    stall pays another full deadline to ask a deterministic model the same question.
    """
    from backend.services import q1_agent as qa

    calls = {"n": 0}

    def _stall(*_a, **_k):
        calls["n"] += 1
        raise TimeoutError("LLM call exceeded 420s wall clock (provider=minimax)")

    orig = qa._llm_complete
    qa._llm_complete = _stall
    try:
        state = dict(MOCK_STATE) if "MOCK_STATE" in globals() else {}
        state.update({
            "candidates": [{"asset": "SPY", "direction": "long", "theme_id": "t",
                            "hype_score": 50.0, "trade_score": 0.1,
                            "avg_sentiment": 0.0, "edge_score": 0.3}],
            "macro_snapshot": {}, "regime": {}, "risk_metrics": {}, "theme_scores": [],
            "factor_exposures": {}, "news_headlines": [], "cfg": MOCK_CFG,
            "picks": [], "citations": [], "retries": 0, "error": None,
            "lens": "multi_asset", "run_date": "2026-07-25",
        })
        out = qa.reason_picks(state)
    finally:
        qa._llm_complete = orig

    assert calls["n"] == 1, f"timeout was retried {calls['n']} times"
    assert "timeout" in (out.get("error") or "").lower()


def test_a_decode_failure_is_still_retried():
    """The distinction has to hold in both directions — malformed output is exactly
    what the retry-with-feedback path exists for."""
    from backend.services import q1_agent as qa

    calls = {"n": 0}

    def _garbage(*_a, **_k):
        calls["n"] += 1
        return "not json at all"

    orig = qa._llm_complete
    qa._llm_complete = _garbage
    try:
        state = {
            "candidates": [{"asset": "SPY", "direction": "long", "theme_id": "t",
                            "hype_score": 50.0, "trade_score": 0.1,
                            "avg_sentiment": 0.0, "edge_score": 0.3}],
            "macro_snapshot": {}, "regime": {}, "risk_metrics": {}, "theme_scores": [],
            "factor_exposures": {}, "news_headlines": [], "cfg": MOCK_CFG,
            "picks": [], "citations": [], "retries": 0, "error": None,
            "lens": "multi_asset", "run_date": "2026-07-25",
        }
        qa.reason_picks(state)
    finally:
        qa._llm_complete = orig

    assert calls["n"] == 3, f"decode failure should use all attempts, used {calls['n']}"


# ─── The published book is sized by conviction (ADR-0053) ────────────────────

# Ten names spread across sectors and geographies so neither the 20% single-name cap
# nor the 30%/35% sector/geo caps bind — with two positions the single-name cap clamps
# both to 20% and every ratio collapses to 1.0, which says nothing about the sizer.
_SPREAD = ["SPY", "EEM", "EWJ", "EFA", "GLD", "FXI", "EWZ", "UUP", "FXE", "CL"]


def _spread_picks(convictions=None, hypes=None):
    out = []
    for i, a in enumerate(_SPREAD):
        p = {
            "asset": a, "direction": "long", "theme_id": f"t{i}",
            "hype_score": (hypes[i] if hypes else 40.0),
            "trade_score": 0.2, "avg_sentiment": 0.0,
        }
        if convictions:
            p.update({"edge_score": 0.2, "vol": 0.01, "conviction": convictions[i]})
        out.append(p)
    return out


def test_size_positions_reads_conviction_from_candidates_not_picks():
    """The seam that mattered, and that the first fix's test missed.

    state["picks"] are the MODEL's dicts — asset, direction, thesis — enriched only
    with theme_id and citations. They never carry conviction or vol. The first attempt
    at ADR-0053 threaded those fields into state["candidates"] and read them off the
    PICK, so it changed nothing; its unit test passed only because the test itself
    hand-supplied conviction on the picks. The live book after that "fix" was still
    hype-sized: |weight|/hype constant at 0.00158 and 0.00326.

    So this test supplies picks the way reason_picks really does — WITHOUT conviction —
    and puts it only on the candidates.
    """
    from backend.services.q1_agent import size_positions

    convs = [20.0] + [10.0] * 9
    picks = [
        {"asset": a, "direction": "long", "theme_id": f"t{i}", "hype_score": 40.0,
         "trade_score": 0.2, "avg_sentiment": 0.0}          # no conviction, no vol
        for i, a in enumerate(_SPREAD)
    ]
    candidates = [
        {"asset": a, "direction": "long", "theme_id": f"t{i}", "hype_score": 40.0,
         "edge_score": 0.2, "vol": 0.01, "conviction": convs[i]}
        for i, a in enumerate(_SPREAD)
    ]
    out = size_positions({"picks": picks, "candidates": candidates, "cfg": MOCK_CFG})
    by = {p["asset"]: p["weight"] for p in out["picks"]}

    assert by["SPY"] / by["EEM"] == pytest.approx(2.0, rel=0.05), (
        f"conviction on the candidate must reach the sizer — got "
        f"{by['SPY'] / by['EEM']:.2f}x"
    )


def test_size_positions_weights_by_conviction_not_hype():
    """The published book was sized by HypeScore while every surface said conviction.

    size_positions built TradeCandidates without conviction/vol — the dataclass
    defaults them to 0.0 — and called allocate_portfolio without size_by, taking the
    "hype" default. Measured on the live 2026-07-25 book, |weight|/hype was EXACTLY
    0.00198 for six positions and 0.00353 for three: two constants, i.e. weight
    proportional to HypeScore within cap group. Meanwhile /book says "sized by
    conviction", /method renders "sizing weight is proportional to conviction", and
    ADR-0032 specifies it. Highest-conviction XLE (31.1) held 6.4% while
    lowest-conviction EEM (15.8) held 9.3% — close to inverted.
    """
    from backend.services.q1_agent import size_positions

    # Equal hype throughout, so any weight difference can only come from conviction.
    convs = [20.0] + [10.0] * 9
    out = size_positions({"picks": _spread_picks(convictions=convs), "cfg": MOCK_CFG})
    by = {p["asset"]: p["weight"] for p in out["picks"]}

    assert by["SPY"] / by["EEM"] == pytest.approx(2.0, rel=0.05), (
        f"equal hype, double conviction — got {by['SPY'] / by['EEM']:.2f}x"
    )
    # And the nine equal-conviction names must tie.
    rest = [by[a] for a in _SPREAD[1:]]
    assert max(rest) - min(rest) < 1e-9


def test_size_positions_still_degrades_to_hype_with_no_conviction():
    """A run with no edge data must still produce a book rather than divide by
    nothing — allocate_portfolio's own fallback has to survive the change."""
    from backend.services.q1_agent import size_positions

    hypes = [60.0] + [30.0] * 9
    out = size_positions({"picks": _spread_picks(hypes=hypes), "cfg": MOCK_CFG})
    by = {p["asset"]: p["weight"] for p in out["picks"]}

    assert all(w > 0 for w in by.values())
    assert by["SPY"] / by["EEM"] == pytest.approx(2.0, rel=0.05)


# ─────────────────────────────────────────────────────────────────────────────
# shortfall_accounting — did the book explain the ideas it declined? (ADR-0056)
# ─────────────────────────────────────────────────────────────────────────────

# The live 2026-07-25 pool depth, transcribed from the deployed /book panel. The
# regression this pins was only visible on a real book: the short side held four
# against five independent ideas and the thesis never mentioned the fifth.
_LIVE_IDEAS = {
    "long": {
        "count": 10,
        "names": 19,
        "complexes": [
            {"members": ["AGG", "IEF", "SHY", "TLT"], "strongest": "SHY"},
            {"members": ["EEM", "IWM", "QQQ", "SVXY"], "strongest": "SVXY"},
            {"members": ["CVX", "XLE", "XOM"], "strongest": "XLE"},
            {"members": ["OIH", "SLB"], "strongest": "OIH"},
        ],
        "standalone": ["NUE", "UNH", "JPM", "BIL", "GS", "JD"],
    },
    "short": {
        "count": 5,
        "names": 11,
        "complexes": [
            {"members": ["GDX", "GLD", "IAU", "NEM", "SLV"], "strongest": "SLV"},
            {"members": ["BABA", "KWEB", "MCHI"], "strongest": "BABA"},
        ],
        "standalone": ["PDD", "NOC", "ARKK"],
    },
}

_LIVE_PICKS = [
    {"direction": "long", "asset": a} for a in ("XLE", "JPM", "SVXY", "NUE", "UNH")
] + [{"direction": "short", "asset": a} for a in ("SLV", "BABA", "PDD", "NOC")]

# The thesis actually published on 2026-07-25, abridged. It restates the shortfall
# and never names ARKK.
_LIVE_PROSE = (
    "Central scenario is a late-cycle risk-on with mild curve steepening: long book "
    "captures energy/materials momentum (XLE, NUE), bank NIM expansion (JPM), and "
    "tactical vol carry (SVXY), while long UNH monetizes US-election optionality. "
    "Short book fades crowded trades - precious-metals extreme (SLV), China "
    "structural headwinds (BABA, PDD), and defense bubble (NOC). Net directional "
    "bias is long given 5 long picks vs 4 short picks."
)


def test_shortfall_flags_the_declined_idea_the_thesis_never_named():
    from backend.services.q1_agent import shortfall_accounting

    gaps = shortfall_accounting(_LIVE_PICKS, _LIVE_IDEAS, _LIVE_PROSE)

    # The long side took 5 of 5 reachable — nothing to account for, so it is absent.
    assert "long" not in gaps
    assert gaps["short"]["held"] == 4
    assert gaps["short"]["available"] == 5
    assert gaps["short"]["passed_over"] == ["ARKK"]
    assert gaps["short"]["unexplained"] == ["ARKK"]
    assert gaps["short"]["named"] == []
    # One empty slot, nothing named -> not satisfied.
    assert gaps["short"]["empty_slots"] == 1
    assert gaps["short"]["satisfied"] is False


def test_shortfall_is_satisfied_when_the_thesis_names_the_declined_idea():
    from backend.services.q1_agent import shortfall_accounting

    prose = _LIVE_PROSE + " ARKK was declined: short ARKK would net against long SVXY."
    gaps = shortfall_accounting(_LIVE_PICKS, _LIVE_IDEAS, prose)

    assert gaps["short"]["named"] == ["ARKK"]
    assert gaps["short"]["unexplained"] == []
    assert gaps["short"]["satisfied"] is True


def test_a_complex_is_declined_only_when_NOTHING_in_it_is_held():
    """Holding the second-strongest still expresses the bet.

    Representing a complex by `strongest` alone would report a phantom omission the
    moment the agent picked any other member of it — the panel would then demand an
    explanation for an idea the book actually holds.
    """
    from backend.services.q1_agent import shortfall_accounting

    # Hold GDX (not SLV, the strongest) out of the metals complex; drop NOC so the
    # side is genuinely short of target.
    picks = [
        {"direction": "short", "asset": a} for a in ("GDX", "BABA", "PDD")
    ]
    gaps = shortfall_accounting(picks, _LIVE_IDEAS, "")
    # metals is held via GDX, China via BABA, PDD held -> only NOC and ARKK declined.
    assert gaps["short"]["passed_over"] == ["NOC", "ARKK"]


def test_shortfall_is_silent_when_the_side_met_what_was_reachable():
    from backend.services.q1_agent import shortfall_accounting

    # A side with only 3 independent ideas that holds 3 is NOT short of target —
    # target is min(ideas, 5), so the pool is the constraint and there is nothing
    # for the agent to explain.
    ideas = {"short": {"count": 3, "names": 6, "complexes": [], "standalone": ["A", "B", "C"]}}
    picks = [{"direction": "short", "asset": a} for a in ("A", "B", "C")]
    assert shortfall_accounting(picks, ideas, "") == {}


def test_shortfall_is_silent_without_a_measurement_or_picks():
    from backend.services.q1_agent import shortfall_accounting

    assert shortfall_accounting(_LIVE_PICKS, {}, _LIVE_PROSE) == {}
    assert shortfall_accounting([], _LIVE_IDEAS, _LIVE_PROSE) == {}


def test_ticker_match_is_word_bounded():
    """A substring hit must not count as naming the idea.

    'BILL' contains 'BIL'; without a word boundary a thesis discussing a T-bill ETF
    it did NOT take would be credited with explaining it.
    """
    from backend.services.q1_agent import shortfall_accounting

    ideas = {
        "long": {"count": 5, "names": 5, "complexes": [],
                 "standalone": ["BIL", "GS", "JD", "NUE", "UNH"]}
    }
    picks = [{"direction": "long", "asset": a} for a in ("GS", "JD", "NUE")]
    gaps = shortfall_accounting(picks, ideas, "We avoided BILL and similar names.")
    assert "BIL" in gaps["long"]["unexplained"]


def test_shortfall_merges_into_independent_ideas_without_losing_the_measurement():
    from backend.services.q1_agent import _with_shortfall

    merged = _with_shortfall(
        {"independent_ideas": _LIVE_IDEAS, "picks": _LIVE_PICKS, "book_view": _LIVE_PROSE}
    )
    # The pool-depth measurement itself must survive untouched — /book renders it.
    assert merged["short"]["count"] == 5
    assert merged["short"]["complexes"] == _LIVE_IDEAS["short"]["complexes"]
    assert merged["short"]["shortfall"]["unexplained"] == ["ARKK"]
    assert "shortfall" not in merged["long"]


def test_explanations_owed_equals_empty_slots_not_declined_ideas():
    """ADR-0058 — the correction the frozen-input harness forced.

    A sample that held 3 longs against TEN independent long ideas was asked to
    account for SEVEN names, while the short side holding 4 against FIVE was asked
    for one. Both were short by a comparable amount and the burden differed
    sevenfold, because where ideas exceed the five slots most declines are forced by
    arithmetic and mean nothing.

    This is the real sample-1 book from that run: 3 longs held, 4 declined ideas
    named. Two slots empty, four named -> satisfied.
    """
    from backend.services.q1_agent import shortfall_accounting

    picks = [{"direction": "long", "asset": a} for a in ("OIH", "SVXY", "XLE")]
    prose = (
        "Long book is concentrated in energy and vol carry. NUE, UNH, JPM and BIL "
        "were considered and passed: each would add beta without adding a distinct bet."
    )
    gaps = shortfall_accounting(picks, _LIVE_IDEAS, prose)

    assert gaps["long"]["held"] == 3
    assert gaps["long"]["available"] == 5
    assert gaps["long"]["empty_slots"] == 2
    assert set(gaps["long"]["named"]) == {"NUE", "UNH", "JPM", "BIL"}
    # Seven ideas went untaken, but only two slots were left empty. Four named
    # covers it — demanding all seven would be a burden no book could discharge.
    assert len(gaps["long"]["passed_over"]) == 7
    assert gaps["long"]["satisfied"] is True
    # The unnamed ones are still reported, as information rather than as a verdict.
    assert set(gaps["long"]["unexplained"]) == {"SHY", "GS", "JD"}


def test_where_ideas_exactly_fill_the_book_the_rule_is_unchanged():
    """On a side with 5 ideas and 5 slots, every decline IS a shortfall.

    That is the case the original all-or-nothing rule got right, and the correction
    must not weaken it — one empty slot still demands one name.
    """
    from backend.services.q1_agent import shortfall_accounting

    picks = [{"direction": "short", "asset": a} for a in ("SLV", "BABA", "PDD", "NOC")]
    assert shortfall_accounting(picks, _LIVE_IDEAS, "no mention")["short"]["satisfied"] is False
    assert shortfall_accounting(picks, _LIVE_IDEAS, "ARKK passed")["short"]["satisfied"] is True


# ─────────────────────────────────────────────────────────────────────────────
# check_availability_claims — a false excuse is worse than none (ADR-0061)
# ─────────────────────────────────────────────────────────────────────────────

# The twelve short candidates actually screened on 2026-07-25, ARKK among them.
_LIVE_CANDIDATES = [
    {"asset": a, "direction": "short"}
    for a in ("SLV", "BABA", "GDX", "KWEB", "PDD", "NEM", "GLD", "IAU", "NOC",
              "MCHI", "ARKK", "FXI")
] + [{"asset": a, "direction": "long"} for a in ("XLE", "SVXY", "JPM", "NUE", "OIH")]

# The sentence actually published by the first book run under the ADR-0056 prompt.
_LIVE_FALSE_EXCUSE = (
    "Net direction is long, with factor tilts positive on Mkt and HML. The fifth "
    "independent short idea per POOL DEPTH, ARKK, is not present in the tradable "
    "candidate pool, so this book deploys four short picks rather than five."
)


def test_rejects_the_exact_false_excuse_that_was_published():
    from backend.services.q1_agent import check_availability_claims

    fails = check_availability_claims(_LIVE_FALSE_EXCUSE, _LIVE_CANDIDATES)
    assert len(fails) == 1
    assert "ARKK" in fails[0]
    assert "but it is" in fails[0]


def test_accepts_a_reason_that_is_not_about_availability():
    """Correlation, cap and conviction reasons are the model's to make.

    Judging whether a reason is GOOD is out of reach; only a claim contradicted by
    our own pool is checkable. Rejecting these would be inventing a verdict on
    reasoning quality, which ADR-0045 refused to do for turnover.
    """
    from backend.services.q1_agent import check_availability_claims

    for reason in (
        "ARKK was declined because short ARKK would net against the long SVXY position.",
        "ARKK is passed over: its edge of -0.27 sits closest to the abstention band.",
        "We declined ARKK to avoid a fifth position in the same high-beta complex.",
    ):
        assert check_availability_claims(reason, _LIVE_CANDIDATES) == []


def test_says_nothing_about_a_name_that_genuinely_was_not_screened():
    """The excuse is only false if the name IS in the pool."""
    from backend.services.q1_agent import check_availability_claims

    prose = "TSLA is not present in the tradable candidate pool, so it was not considered."
    assert check_availability_claims(prose, _LIVE_CANDIDATES) == []


def test_a_negation_in_the_previous_clause_is_not_attributed_to_the_ticker():
    """Reading backwards from a mention produced false positives on this shape."""
    from backend.services.q1_agent import check_availability_claims

    prose = (
        "Several names were not present in the candidate pool. ARKK, by contrast, "
        "cleared every screen and was declined on correlation grounds."
    )
    assert check_availability_claims(prose, _LIVE_CANDIDATES) == []


def test_is_silent_without_prose_or_candidates():
    from backend.services.q1_agent import check_availability_claims

    assert check_availability_claims("", _LIVE_CANDIDATES) == []
    assert check_availability_claims(_LIVE_FALSE_EXCUSE, []) == []


def test_catches_the_other_phrasings_of_the_same_excuse():
    from backend.services.q1_agent import check_availability_claims

    for prose in (
        "ARKK is absent from the candidate list this run.",
        "ARKK was unavailable in the screened universe.",
        "ARKK is no longer in the candidate pool.",
        "ARKK is not in the tradable universe.",
    ):
        assert check_availability_claims(prose, _LIVE_CANDIDATES), prose


# ─────────────────────────────────────────────────────────────────────────────
# attach_asset_factor_tilts — per-pick betas are joined, never re-typed (ADR-0075)
# ─────────────────────────────────────────────────────────────────────────────

_LIVE_EXPOSURES = {
    # Real 2026-07-25 rows. beta_umd is null for every asset in the live table.
    "ARKK": {"beta_mkt": 1.48955, "beta_smb": 0.366933, "beta_hml": -0.47521,
             "beta_rmw": -1.35673, "beta_cma": 0.0937154, "beta_umd": None,
             "r_squared": 0.772629},
    "SHY": {"beta_mkt": 0.0146072, "beta_smb": 0.0130453, "beta_hml": -0.0265642,
            "beta_rmw": 0.00358089, "beta_cma": 0.0419115, "beta_umd": None,
            "r_squared": 0.0729643},
    "BABA": {"beta_mkt": 1.24626, "beta_smb": -0.249799, "beta_hml": -0.207389,
             "beta_rmw": -0.369905, "beta_cma": 0.676156, "beta_umd": None,
             "r_squared": 0.138452},
}


def test_every_position_gets_its_own_betas_not_one_shared_row():
    """The live defect: all ten picks carried beta_mkt -0.02, the pool aggregate.

    SHY is 1-3yr Treasuries and ARKK is high-beta growth; a book that prints the same
    market beta for both has told the reader nothing about either.
    """
    from backend.services.q1_agent import attach_asset_factor_tilts

    picks = [{"asset": "ARKK", "direction": "short"},
             {"asset": "SHY", "direction": "long"},
             {"asset": "BABA", "direction": "short"}]
    attach_asset_factor_tilts(picks, _LIVE_EXPOSURES)

    mkts = [p["factor_tilts"]["beta_mkt"] for p in picks]
    assert mkts == pytest.approx([1.48955, 0.0146072, 1.24626])
    assert len(set(mkts)) == 3, "every position must carry its own beta"


def test_the_models_copied_tilts_are_overwritten():
    """The join is authoritative — a stale LLM value must not survive it."""
    from backend.services.q1_agent import attach_asset_factor_tilts

    picks = [{"asset": "ARKK", "factor_tilts": {"beta_mkt": -0.02, "beta_hml": 0.27}}]
    attach_asset_factor_tilts(picks, _LIVE_EXPOSURES)
    assert picks[0]["factor_tilts"]["beta_mkt"] == pytest.approx(1.48955)
    assert picks[0]["factor_tilts"]["beta_hml"] == pytest.approx(-0.47521)


def test_an_unmeasured_beta_is_omitted_not_zeroed():
    """ADR-0066: 0.0 would assert no momentum exposure was found, not that none
    was measured. beta_umd is null across the live table."""
    from backend.services.q1_agent import attach_asset_factor_tilts

    picks = [{"asset": "ARKK"}]
    attach_asset_factor_tilts(picks, _LIVE_EXPOSURES)
    assert "beta_umd" not in picks[0]["factor_tilts"]
    assert len(picks[0]["factor_tilts"]) == 5


def test_fit_quality_rides_along_with_the_betas():
    """A beta a reader cannot weight is a number with no unit: ARKK fits at 0.77,
    BABA at 0.14."""
    from backend.services.q1_agent import attach_asset_factor_tilts

    picks = [{"asset": "ARKK"}, {"asset": "BABA"}]
    attach_asset_factor_tilts(picks, _LIVE_EXPOSURES)
    assert picks[0]["factor_r_squared"] == pytest.approx(0.772629)
    assert picks[1]["factor_r_squared"] == pytest.approx(0.138452)


def test_a_pick_with_no_factor_row_gets_an_empty_dict():
    from backend.services.q1_agent import attach_asset_factor_tilts

    picks = [{"asset": "NOSUCH"}]
    attach_asset_factor_tilts(picks, _LIVE_EXPOSURES)
    assert picks[0]["factor_tilts"] == {}
    assert picks[0]["factor_r_squared"] is None


def test_missing_exposures_entirely_does_not_raise():
    from backend.services.q1_agent import attach_asset_factor_tilts

    picks = [{"asset": "ARKK"}]
    assert attach_asset_factor_tilts(picks, None)[0]["factor_tilts"] == {}


# ─────────────────────────────────────────────────────────────────────────────
# The regime block: units and characterisations are computed, not inferred
# ─────────────────────────────────────────────────────────────────────────────

def test_the_curve_is_rendered_in_bps_and_named():
    """yield_curve_slope is persisted in PERCENT. Printed raw under a header reading
    "bps", 0.34 told the agent the curve was a third of one basis point — and it
    opened the published thesis with "an inverted curve"."""
    from backend.services.q1_agent import _describe_yield_curve

    out = _describe_yield_curve(0.34)          # the live 2026-07-25 value
    assert "+34 bps" in out
    assert "NOT inverted" in out
    assert "INVERTED" in _describe_yield_curve(-0.20)
    assert "FLAT" in _describe_yield_curve(0.01)
    assert _describe_yield_curve(None) == "N/A"


def test_the_vol_term_structure_states_which_regime_it_is():
    """Handed -1.93 with a "positive = backwardation" note, the model re-expressed it
    as VIX3M-VIX = +1.93 and kept the label belonging to the other subtraction order."""
    from backend.services.q1_agent import _describe_vix_term

    out = _describe_vix_term(-1.93)            # the live 2026-07-25 value
    assert "CONTANGO" in out
    assert "-1.93" in out
    assert "BACKWARDATION" in _describe_vix_term(2.5)
    assert _describe_vix_term(None) == "N/A"


def test_a_percent_spread_is_rendered_in_bps():
    """HY OAS 2.77% was printed as "2.77 bps" — a credit market ~100x too tight."""
    from backend.services.q1_agent import _describe_bps

    assert _describe_bps(2.77) == "277 bps"
    assert _describe_bps(None) == "N/A"


class TestRegimeShadowStrip:
    """ADR-0139/0140: the regime row reaches the L5 snapshot via select("*"),
    so the shadow's L5 gate is this exclusion — without it a published thesis
    could cite a reading the shadow harness has not yet passed (ADR-0100: a
    guard that lives in one component guards one consumer)."""

    def test_strips_every_shadow_column_and_keeps_the_rest(self):
        row = {"run_date": "2026-07-28", "cycle": "late", "sentiment": "neutral"}
        row.update({k: 1 for k in q1_agent.REGIME_SHADOW_KEYS})
        out = q1_agent._strip_regime_shadow_keys(row)
        assert set(out) == {"run_date", "cycle", "sentiment"}

    def test_migration_columns_are_all_covered(self):
        """The exclusion list must cover exactly the columns migrations 052/053
        add — a column added there but not here leaks to the LLM mid-shadow,
        and a key here that no migration adds is a stale exclusion."""
        import re
        from pathlib import Path

        sql = ""
        for name in (
            "052_dollar_debasement_indicator.sql",
            "053_hawkish_dovish_pivot_indicator.sql",
        ):
            sql += Path("supabase", "migrations", name).read_text(encoding="utf-8")
        added = set(re.findall(r"ADD COLUMN IF NOT EXISTS (\w+)", sql))
        assert added == set(q1_agent.REGIME_SHADOW_KEYS)

    def test_column_mapping_matches_shadow_keys(self):
        """crosscurrents_columns is the ONE write-side mapping (classify() and
        the backfill both use it); its key set must equal the strip list, or a
        column gets written that the shadow does not strip."""
        from backend.services.regime_classifier import (
            DebasementReading,
            PostureReading,
            crosscurrents_columns,
        )

        cols = crosscurrents_columns(
            DebasementReading(None, None, None, None, None),
            PostureReading(None, None, None, None, None, None, None),
            None,
            {},
        )
        assert set(cols) == set(q1_agent.REGIME_SHADOW_KEYS)
