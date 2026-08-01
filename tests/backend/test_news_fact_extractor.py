"""Tests for the news_fact_extractor module (ADR-0222 Tier 2 / #3).

The module has two surface layers, each with its own discipline:

  1. `_validate_row` — strict input validator. The LLM is asked for
     a JSON list of {entity, metric, value, unit, as_of}; this is
     what decides which entries survive into the fact table.

  2. `extract_claims_from_article` — the Gemini call. Tests use
     the module-level test hook (`_TEST_HOOK`) to avoid hitting
     the network; the real call is the SAME code path the
     production function takes once the hook is set to None.

The interesting cases are the boundary ones: what survives, what
gets dropped, and what the unit-vocabulary enforcement does.
"""
import sys
from datetime import date

sys.path.insert(0, "backend/services")
sys.path.insert(0, ".")

from news_fact_extractor import _validate_row  # noqa: E402


class TestValidateRow:
    """The validator is the gate. One bad field → None.
    A row that survives here WILL land in structured_facts."""

    def test_full_valid_row(self):
        out = _validate_row({
            "entity": "NVDA", "metric": "mkt_cap_drop_bn",
            "value": 600, "unit": "USD_bn", "as_of": "2025-01-27",
        })
        assert out is not None
        assert out["entity"] == "NVDA"
        assert out["value"] == 600.0
        assert out["as_of"] == "2025-01-27"

    def test_year_only_as_of_normalized(self):
        """The article may not give a day. Year-only is permitted."""
        out = _validate_row({
            "entity": "MSFT", "metric": "capex_fy26_bn",
            "value": 80, "unit": "USD_bn", "as_of": "2026",
        })
        assert out is not None
        assert out["as_of"] == "2026-01-01"

    def test_year_month_as_of_normalized(self):
        out = _validate_row({
            "entity": "AMZN", "metric": "capex_fy26_bn",
            "value": 105, "unit": "USD_bn", "as_of": "2026-07",
        })
        assert out is not None
        assert out["as_of"] == "2026-07-01"

    def test_value_as_string_coerced(self):
        """LLMs sometimes return `"745"` instead of `745`.
        The validator coerces, the same way macro_indicators does."""
        out = _validate_row({
            "entity": "industry:hyperscaler", "metric": "capex_2026_total_bn",
            "value": "745", "unit": "USD_bn", "as_of": "2026",
        })
        assert out is not None
        assert out["value"] == 745.0

    def test_missing_entity_dropped(self):
        assert _validate_row({
            "metric": "capex", "value": 80, "unit": "USD_bn", "as_of": "2026"
        }) is None

    def test_missing_metric_dropped(self):
        assert _validate_row({
            "entity": "MSFT", "value": 80, "unit": "USD_bn", "as_of": "2026"
        }) is None

    def test_non_permitted_unit_dropped(self):
        """Free-form units (e.g. "pints", "horsepower") are not
        citable. The vocabulary is closed; the LLM is told this
        in the prompt, and the validator enforces it as a backstop."""
        assert _validate_row({
            "entity": "company:X", "metric": "weight_kg",
            "value": 100, "unit": "kg", "as_of": "2026"
        }) is None

    def test_string_value_dropped(self):
        assert _validate_row({
            "entity": "MSFT", "metric": "capex",
            "value": "high", "unit": "USD_bn", "as_of": "2026"
        }) is None

    def test_nan_value_dropped(self):
        assert _validate_row({
            "entity": "MSFT", "metric": "capex",
            "value": float("nan"), "unit": "USD_bn", "as_of": "2026"
        }) is None

    def test_infinity_dropped(self):
        assert _validate_row({
            "entity": "MSFT", "metric": "capex",
            "value": float("inf"), "unit": "USD_bn", "as_of": "2026"
        }) is None

    def test_garbage_as_of_dropped(self):
        """'last quarter', 'Q3 2026', 'recent' — none of these
        are valid date strings and the validator rejects them."""
        for bad in ["last quarter", "Q3 2026", "recent", "2026-13-01",
                    "2026/01/15", "yesterday"]:
            out = _validate_row({
                "entity": "MSFT", "metric": "capex",
                "value": 80, "unit": "USD_bn", "as_of": bad,
            })
            assert out is None, f"as_of={bad!r} should be rejected"

    def test_empty_inputs_dropped(self):
        assert _validate_row({}) is None
        assert _validate_row(None) is None
        assert _validate_row("not a dict") is None
        assert _validate_row([]) is None


class TestExtractClaimsForTest:
    """The test entry point. Same code path as production when
    the test hook is None; bypasses the network when set."""

    def test_no_key_returns_empty(self, monkeypatch):
        """If GEMINI_API_KEY is unset, the function returns []
        immediately — no network attempt, no error. Same posture
        as the LLM cite path when MINIMAX/ANTHROPIC keys are absent."""
        import news_fact_extractor
        monkeypatch.setattr(news_fact_extractor, "GEMINI_API_KEY", "")
        monkeypatch.setattr(news_fact_extractor, "_TEST_HOOK", None)
        out = news_fact_extractor.extract_claims_for_test(
            title="X", url="http://example.com", body="body"
        )
        assert out == []

    def test_hook_overrides_call(self, monkeypatch):
        """When the test hook is set, it returns deterministic
        claims. The validator is still applied — bad rows from
        the hook are dropped."""
        import news_fact_extractor
        monkeypatch.setattr(news_fact_extractor, "GEMINI_API_KEY", "test-key")
        monkeypatch.setattr(
            news_fact_extractor, "_TEST_HOOK",
            lambda title, url, body: [
                # Good row — survives validation
                {"entity": "NVDA", "metric": "drop",
                 "value": 600, "unit": "USD_bn", "as_of": "2025-01-27"},
                # Bad row — missing entity, must be dropped
                {"metric": "drop", "value": 600,
                 "unit": "USD_bn", "as_of": "2025-01-27"},
                # Bad row — bad unit, must be dropped
                {"entity": "NVDA", "metric": "drop",
                 "value": 600, "unit": "kg", "as_of": "2025-01-27"},
            ],
        )
        out = news_fact_extractor.extract_claims_for_test(
            title="NVIDIA plunges", url="http://example.com/nvda", body=""
        )
        assert len(out) == 1
        assert out[0]["entity"] == "NVDA"
        assert out[0]["value"] == 600.0
