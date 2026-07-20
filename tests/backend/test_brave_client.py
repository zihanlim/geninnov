"""
Tests for brave_client.py
"""
import pytest
from datetime import date
from unittest.mock import patch
from backend.data.brave_client import fetch_news_for_theme, _mock_news, THEME_KEYWORDS


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
            # Verify date can be parsed as ISO format
            assert item["date"] == date.today().isoformat()

    def test_url_field_is_present(self):
        result = fetch_news_for_theme("Geopolitical Risk")
        for item in result:
            assert "url" in item
            assert isinstance(item["url"], str)

    @patch("backend.data.brave_client.subprocess.run")
    def test_mcp_unavailable_returns_mock(self, mock_run):
        """Mock data is returned when MCP is unavailable."""
        mock_run.side_effect = FileNotFoundError
        result = fetch_news_for_theme("Corporate Credit")
        assert isinstance(result, list)
        assert len(result) >= 1
        for item in result:
            assert "headline" in item
            assert "date" in item
            assert "url" in item

    @patch("backend.data.brave_client.subprocess.run")
    def test_mcp_returns_zero_code_returns_data(self, mock_run):
        """When MCP returns returncode 0, its data is used."""
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = '[{"headline": "Test", "date": "2026-07-21", "url": "https://test.com"}]'
        result = fetch_news_for_theme("Fed Policy")
        assert len(result) == 1
        assert result[0]["headline"] == "Test"
