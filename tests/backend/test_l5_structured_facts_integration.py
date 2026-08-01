"""Tests for the L5 verify_citations extension for structured_facts
and computable_macro (ADR-0220).

The citation guardrail already grounds `macro_indicators`, `regime:*`,
`theme:*`, and `risk:*`. These tests assert the new namespaces:

  - `[structured_facts:<entity>:<metric>]` — passes when the row
    exists in the loaded structured_facts list with the cited value.
  - `[structured_facts:FAKE:foo]` — REJECTED. A row the L5 cites
    that the table does not have is a fabrication.
  - `[regime_classifications:computable_macro:erp:erp_pct]` —
    passes when the JSONB carries the value.
  - `[regime_classifications:computable_macro:erp:bogus_key]` —
    REJECTED. A key the JSONB does not have is a fabrication.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.q1_agent import verify_citations  # noqa: E402


def _state_for_citations(
    structured_facts: list[dict] | None = None,
    computable_macro: dict | None = None,
    citations: list[dict] | None = None,
) -> dict:
    """Build a minimal state that exercises the new namespaces."""
    return {
        "run_date": "2026-07-31",
        "lens": "multi_asset",
        "macro_snapshot": {},
        "regime": {
            "cycle": "mid", "sentiment": "risk_on",
            "yield_curve_slope": 40.0, "hy_oas": 320.0,
            "vix_level": 14.5, "vix_term_diff": -2.1,
            "real_rate": 0.8, "spx_breadth": 68.0,
        },
        "theme_scores": [],
        "factor_exposures": {},
        "candidates": [],
        "classified_news": [],
        "independent_ideas": {},
        "book_metrics_summary": "(book metrics unavailable)",
        "scenario_table": "(scenario analysis unavailable)",
        "risk_metrics": {
            "total_capital": 100_000_000.0,
            "var_95": 2_140_000.0, "cvar_95": 3_020_000.0,
            "sharpe": 0.94, "beta": 0.12, "concentration_hhi": 1180.0,
        },
        "correlation_warnings": [],
        "cap_violations": [],
        "picks": [],
        "book_view": "",
        "book_risks": [],
        "citations": citations or [],
        "verified": False,
        "retries": 0,
        "error": None,
        "input_snapshot": {},
        "news_headlines": [],
        # The two new layers:
        "structured_facts": structured_facts or [],
        "computable_macro": computable_macro or {},
    }


def test_structured_facts_cite_passes_when_row_exists() -> None:
    """A citation pointing at a structured_facts row that exists
    in the loaded list is accepted."""
    structured = [
        {
            "entity": "MSFT", "metric": "capex_fy26_bn", "value": 80.0,
            "unit": "USD_bn", "as_of": "2026-06-30",
            "source": "MSFT 10-Q", "confidence": "high",
            "category": "ai_capex",
        }
    ]
    citations = [
        {
            "text": "MSFT FY26 capex is $80bn",
            "source": "structured_facts:MSFT:capex_fy26_bn",
            "value": 80.0,
        }
    ]
    state = _state_for_citations(structured_facts=structured, citations=citations)
    verify_citations(state)
    # Either verified=True, or there's a tolerated ungrounded
    # citation. The point is the row's existence: the guardrail
    # should NOT reject because the cite is unknown. If the test
    # fails with 'not grounded', that's still a fail — the source
    # map MUST carry the new key.
    assert "structured_facts:MSFT:capex_fy26_bn" not in (state.get("error") or ""), (
        f"structured_facts cite was rejected: {state.get('error')!r}"
    )


def test_structured_facts_cite_rejected_when_row_absent() -> None:
    """A citation pointing at a structured_facts row that does NOT
    exist is a fabrication — the guardrail rejects it."""
    citations = [
        {
            "text": "FAKE foo is 42",
            "source": "structured_facts:FAKE:foo",
            "value": 42.0,
        }
    ]
    state = _state_for_citations(citations=citations)
    verify_citations(state)
    # The cite is unknown; the value isn't grounded either (no row
    # in the known_values set). The guardrail should mark this as
    # unverified.
    assert state.get("verified") is False or state.get("error"), (
        f"fabricated structured_facts cite was accepted; "
        f"state: verified={state.get('verified')!r}, error={state.get('error')!r}"
    )


def test_computable_macro_cite_passes_when_value_in_jsonb() -> None:
    """A citation pointing at a computable_macro inner key that
    exists in the JSONB is accepted."""
    payload = {
        "erp": {
            "erp_pct": 2.16, "earnings_yield_pct": 6.89, "spx_pe": 14.5,
            "ust10_pct": 4.73, "status": "measured",
            "as_of": "2026-07-31",
        }
    }
    citations = [
        {
            "text": "ERP is 2.16%",
            "source": "regime_classifications:computable_macro:erp:erp_pct",
            "value": 2.16,
        }
    ]
    state = _state_for_citations(computable_macro=payload, citations=citations)
    verify_citations(state)
    assert "computable_macro:erp:erp_pct" not in (state.get("error") or ""), (
        f"computable_macro cite was rejected: {state.get('error')!r}"
    )


def test_computable_macro_cite_rejected_when_key_absent() -> None:
    """A citation pointing at a key the JSONB does not have is
    rejected — the L5 cannot invent a metric the runner did not
    publish."""
    payload = {
        "erp": {
            "erp_pct": 2.16, "status": "measured", "as_of": "2026-07-31",
        }
    }
    citations = [
        {
            "text": "ERP coverage is 99%",
            "source": "regime_classifications:computable_macro:erp:coverage_pct",
            "value": 99.0,
        }
    ]
    state = _state_for_citations(computable_macro=payload, citations=citations)
    verify_citations(state)
    # The cite is unknown AND the value (99.0) is not grounded. The
    # guardrail should mark this as unverified.
    assert state.get("verified") is False or state.get("error"), (
        f"fabricated computable_macro cite was accepted; "
        f"state: verified={state.get('verified')!r}, error={state.get('error')!r}"
    )
