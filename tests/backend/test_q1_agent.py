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
        "candidates": [],
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

    def __call__(self, prompt: str, system: str = "", temperature: float = 0.0) -> str:
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
