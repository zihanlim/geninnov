"""Tests for the L5 prompt formatters (ADR-0220).

The formatters live in `backend.services.l5_prompt_formatters` and
are imported into q1_agent. We test them directly so a missing env
var (e.g. LLM API keys) does not skip the test.
"""
import sys

sys.path.insert(0, "backend/services")

from l5_prompt_formatters import (  # noqa: E402
    format_structured_facts,
    format_computable_macro,
    _format_num,
)


# ---- _format_num ------------------------------------------------------

def test_format_num_none_renders_na() -> None:
    assert _format_num(None) == "N/A"


def test_format_num_bool_renders_true_false() -> None:
    assert _format_num(True) == "true"
    assert _format_num(False) == "false"


def test_format_num_int_renders_as_str() -> None:
    assert _format_num(80) == "80"


def test_format_num_float_renders_with_4_sig_figs() -> None:
    assert _format_num(2.16) == "2.16"
    assert _format_num(0.0573) == "0.0573"
    assert _format_num(5234.18) == "5234"


# ---- format_structured_facts ------------------------------------------

def test_empty_returns_helpful_placeholder() -> None:
    """An empty list returns a placeholder that tells the L5 why.
    The placeholder must not advertise a fabrication route."""
    out = format_structured_facts([])
    assert "no structured_facts" in out.lower()
    assert "do not invent" in out.lower()


def test_renders_entity_metric_verbatim() -> None:
    """The L5 reads the table and copies the cite token. A typo in
    the rendered entity/metric would silently fail the guardrail."""
    rows = [
        {
            "entity": "MSFT", "metric": "capex_fy26_bn", "value": 80.0,
            "unit": "USD_bn", "as_of": "2026-06-30",
            "source": "MSFT 10-Q Q1 FY26", "confidence": "high",
            "category": "ai_capex",
        },
    ]
    out = format_structured_facts(rows)
    assert "MSFT" in out
    assert "capex_fy26_bn" in out
    assert "80" in out
    assert "ai_capex" in out
    assert "high" in out


def test_groups_by_category_in_alphabetical_order() -> None:
    rows = [
        {"entity": "X", "metric": "y", "value": 1, "unit": "u",
         "as_of": "2026-01-01", "source": "s", "confidence": "high",
         "category": "macro"},
        {"entity": "A", "metric": "b", "value": 2, "unit": "u",
         "as_of": "2026-01-01", "source": "s", "confidence": "high",
         "category": "ai_capex"},
    ]
    out = format_structured_facts(rows)
    assert out.index("ai_capex") < out.index("macro")


def test_sorts_within_category_by_entity_metric() -> None:
    rows = [
        {"entity": "B", "metric": "y", "value": 1, "unit": "u",
         "as_of": "2026-01-01", "source": "s", "confidence": "high",
         "category": "macro"},
        {"entity": "A", "metric": "y", "value": 1, "unit": "u",
         "as_of": "2026-01-01", "source": "s", "confidence": "high",
         "category": "macro"},
    ]
    out = format_structured_facts(rows)
    # A/B-entity rows: A appears before B
    assert out.index("A/y") < out.index("B/y")


# ---- format_computable_macro -----------------------------------------

def test_empty_payload_returns_helpful_placeholder() -> None:
    out = format_computable_macro({})
    assert "no computable_macro" in out.lower()


def test_renders_measured_status() -> None:
    """A 'measured' status renders the value."""
    payload = {
        "erp": {
            "erp_pct": 2.16, "earnings_yield_pct": 6.89, "spx_pe": 14.5,
            "ust10_pct": 4.73, "status": "measured",
            "as_of": "2026-07-31", "eps_as_of": "2026-06-30",
        },
        "equity_bond_corr": {
            "corr": -0.05, "n_pairs": 60, "lookback_days": 60,
            "ust10_pct": 4.73, "socgen_flip_active": False,
            "status": "measured", "as_of": "2026-07-31",
        },
        "ndx_seasonality": {
            "current_month": 8, "current_month_label": "Aug",
            "per_month": [], "midterm": {}, "window": {},
            "n_observations": 432,
        },
    }
    out = format_computable_macro(payload)
    assert "erp" in out
    assert "measured" in out
    assert "2.16" in out
    assert "socgen_flip" in out
    assert "ndx_seasonality" in out
    assert "n_observations=432" in out


def test_unknown_status_renders_na_not_zero() -> None:
    """ADR-0098: an 'unknown' status renders the value as N/A, not
    zero. The L5 cites 'unknown' rather than '0' or 'NA'."""
    payload = {
        "erp": {
            "erp_pct": None, "earnings_yield_pct": None, "spx_pe": None,
            "ust10_pct": 4.73, "status": "unknown",
            "as_of": "2026-07-31", "reason": "trailing_eps unavailable",
        },
    }
    out = format_computable_macro(payload)
    assert "unknown" in out
    assert "N/A" in out


def test_missing_metric_renders_not_present() -> None:
    """A metric that's not in the payload renders '(not present)' —
    the L5 sees which of the three are loaded."""
    payload = {"erp": {"status": "measured", "erp_pct": 1.0, "as_of": "2026-07-31"}}
    out = format_computable_macro(payload)
    assert "equity_bond_corr" in out
    assert "not present" in out
