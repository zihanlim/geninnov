"""
Tests for brave_client.py
"""
import json
import pytest
from datetime import date, timedelta
from unittest.mock import patch
from backend.data.brave_client import (
    fetch_news_for_theme,
    fetch_market_news,
    _mock_news,
    THEME_KEYWORDS,
)


class TestMockNews:
    def test_mock_news_returns_list(self):
        result = _mock_news("Test Theme", 7)
        assert isinstance(result, list)

    def test_mock_news_returns_at_least_one_item(self):
        result = _mock_news("Test Theme", 7)
        assert len(result) >= 1

    def test_mock_news_item_has_required_keys(self):
        result = _mock_news("Test Theme", 7)
        for item in result:
            assert "headline" in item
            assert "date" in item
            assert "url" in item

    def test_mock_news_uses_theme_in_headline(self):
        result = _mock_news("Inflation", 7)
        assert any("Inflation" in item["headline"] for item in result)

    def test_mock_news_tagged_mock_brave(self):
        result = _mock_news("Inflation", 7)
        assert all(item.get("source") == "mock_brave" for item in result)


class TestFetchNewsForTheme:
    def test_returns_list(self):
        result = fetch_news_for_theme("Fed Policy")
        assert isinstance(result, list)

    def test_returns_list_of_dicts(self):
        result = fetch_news_for_theme("Inflation")
        assert all(isinstance(item, dict) for item in result)

    def test_items_have_required_keys(self):
        result = fetch_news_for_theme("Energy Prices")
        for item in result:
            assert "headline" in item
            assert "date" in item
            assert "url" in item

    def test_unknown_theme_returns_mock_data(self):
        """Calling with unknown theme returns mock data (at least 1 item)."""
        result = fetch_news_for_theme("Unknown Theme XYZ")
        assert isinstance(result, list)
        assert len(result) >= 1

    def test_known_theme_returns_data(self):
        """Known themes should return data (mock or real)."""
        for theme in THEME_KEYWORDS:
            result = fetch_news_for_theme(theme)
            assert isinstance(result, list)
            assert len(result) >= 1

    def test_date_field_is_iso_format(self):
        result = fetch_news_for_theme("US Dollar")
        for item in result:
            # Verify date can be parsed as ISO format (YYYY-MM-DD)
            assert len(item["date"]) == 10
            assert item["date"].count("-") == 2
            int(item["date"].replace("-", ""))  # raises if not numeric

    def test_url_field_is_present(self):
        result = fetch_news_for_theme("Geopolitical Risk")
        for item in result:
            assert "url" in item
            assert isinstance(item["url"], str)

    @patch("backend.data.brave_client.subprocess.run")
    def test_mcp_unavailable_returns_mock(self, mock_run):
        """Mock data is returned when MCP is unavailable (default policy)."""
        mock_run.side_effect = FileNotFoundError
        result = fetch_news_for_theme("Corporate Credit")
        assert isinstance(result, list)
        assert len(result) >= 1
        for item in result:
            assert "headline" in item
            assert "date" in item
            assert "url" in item

    @patch.dict("os.environ", {"ANDROMEDA_ALLOW_MOCK": "0"})
    @patch("backend.data.brave_client.subprocess.run")
    def test_mcp_unavailable_returns_empty_when_mock_disabled(self, mock_run):
        """Production policy: a failed feed returns [] rather than fabricating."""
        mock_run.side_effect = FileNotFoundError
        assert fetch_news_for_theme("Corporate Credit") == []

    @patch("backend.data.brave_client.subprocess.run")
    def test_mcp_returns_zero_code_returns_data(self, mock_run):
        """When MCP returns returncode 0, its data is used and tagged 'brave'."""
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = json.dumps(
            [{"headline": "Test", "date": date.today().isoformat(), "url": "https://test.com"}]
        )
        result = fetch_news_for_theme("Fed Policy")
        assert len(result) == 1
        assert result[0]["headline"] == "Test"
        # Real MCP data is source-tagged so it is distinguishable from mock.
        assert result[0]["source"] == "brave"


class TestLookbackFilter:
    """Defense in depth behind the API-side `freshness` range that
    scripts/call_brave_mcp.js sends since 2026-07-28. For a year before that
    the script sent `from=`, a parameter Brave does not have and ignores
    without erroring, so the lookback existed only in this codebase's
    intentions — 43 of the 2026-07-28 run's 386 headlines predated 2026. If
    the API-side filter ever regresses that silently again, the drop tested
    here is what keeps evergreen explainers out of theme_news."""

    @staticmethod
    def _stdout(mock_run, items):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = json.dumps(items)

    @patch("backend.data.brave_client.subprocess.run")
    def test_drops_items_published_before_the_window(self, mock_run):
        self._stdout(mock_run, [
            {"headline": "Junk Bonds - Econlib", "date": "2018-02-05", "url": "https://old"},
            {"headline": "Fresh story", "date": date.today().isoformat(), "url": "https://new"},
        ])
        result = fetch_news_for_theme("Fed Policy", lookback_days=7)
        assert [i["headline"] for i in result] == ["Fresh story"]

    @patch("backend.data.brave_client.subprocess.run")
    def test_window_start_is_inclusive(self, mock_run):
        edge = (date.today() - timedelta(days=7)).isoformat()
        self._stdout(mock_run, [{"headline": "Edge", "date": edge, "url": "https://e"}])
        result = fetch_news_for_theme("Fed Policy", lookback_days=7)
        assert [i["headline"] for i in result] == ["Edge"]

    @patch("backend.data.brave_client.subprocess.run")
    def test_keeps_undated_items(self, mock_run):
        """date: null means 'unknown', not 'old'. The API-side freshness range
        already bounds what can come back, and a missing page_age must not
        silently delete a fresh story (nor, upstream, be stamped 'today')."""
        self._stdout(mock_run, [
            {"headline": "No page_age", "date": None, "url": "https://x"},
            {"headline": "Garbage age", "date": "2 weeks ago", "url": "https://y"},
        ])
        result = fetch_news_for_theme("Fed Policy", lookback_days=7)
        assert [i["headline"] for i in result] == ["No page_age", "Garbage age"]

    @patch("backend.data.brave_client.subprocess.run")
    def test_market_news_applies_the_same_window(self, mock_run):
        self._stdout(mock_run, [
            {"headline": "What is OPEC+ - EIA", "date": "2023-12-18", "url": "https://old"},
            {"headline": "Markets today", "date": date.today().isoformat(), "url": "https://new"},
        ])
        result = fetch_market_news(lookback_days=7)
        assert [i["headline"] for i in result] == ["Markets today"]
