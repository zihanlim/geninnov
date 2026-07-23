# tests/backend/test_reddit_client.py
import os
import pytest
from datetime import date
from unittest.mock import patch

# Ensure the module is importable
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from data.reddit_client import fetch_posts_for_theme, _mock_posts, THEME_KEYWORDS, SUBREDDITS


class TestMockPosts:
    def test_mock_posts_returns_list(self):
        result = _mock_posts("Inflation", 7)
        assert isinstance(result, list)

    def test_mock_posts_has_required_keys(self):
        result = _mock_posts("Inflation", 7)
        assert len(result) > 0
        post = result[0]
        assert "title" in post
        assert "subreddit" in post
        assert "score" in post
        assert "date" in post

    def test_mock_posts_contains_theme_name(self):
        theme = "Inflation"
        result = _mock_posts(theme, 7)
        assert theme in result[0]["title"]


class TestFetchPostsForThemeNoCredentials:
    @patch.dict(os.environ, {"REDDIT_CLIENT_ID": "", "REDDIT_CLIENT_SECRET": ""}, clear=True)
    def test_returns_mock_when_no_credentials(self):
        result = fetch_posts_for_theme("Inflation")
        assert isinstance(result, list)
        assert len(result) > 0

    @patch.dict(os.environ, {}, clear=True)
    def test_returns_mock_when_env_not_set(self):
        result = fetch_posts_for_theme("Energy Prices")
        assert isinstance(result, list)
        assert len(result) > 0

    def test_mock_posts_have_correct_keys(self):
        result = fetch_posts_for_theme("Fed Policy")
        post = result[0]
        assert all(k in post for k in ["title", "subreddit", "score", "date"])


class TestMockProvenanceTag:
    def test_mock_posts_tagged_mock_reddit(self):
        result = _mock_posts("Inflation", 7)
        assert all(p.get("source") == "mock_reddit" for p in result)

    @patch.dict(os.environ, {"REDDIT_CLIENT_ID": "", "REDDIT_CLIENT_SECRET": ""}, clear=True)
    def test_fetch_without_creds_is_source_tagged_mock(self):
        result = fetch_posts_for_theme("Inflation")
        assert result and all(p.get("source") == "mock_reddit" for p in result)


class TestMockDisabled:
    @patch.dict(os.environ, {"REDDIT_CLIENT_ID": "", "REDDIT_CLIENT_SECRET": "",
                             "ANDROMEDA_ALLOW_MOCK": "0"}, clear=True)
    def test_no_creds_and_mock_disabled_returns_empty(self):
        # Production policy: no fabricated post — real feed or nothing.
        assert fetch_posts_for_theme("Inflation") == []

    @patch.dict(os.environ, {"REDDIT_CLIENT_ID": "", "REDDIT_CLIENT_SECRET": "",
                             "ANDROMEDA_ALLOW_MOCK": "1"}, clear=True)
    def test_no_creds_and_mock_enabled_returns_mock(self):
        assert len(fetch_posts_for_theme("Inflation")) > 0


class TestThemeKeywords:
    def test_all_themes_have_keywords(self):
        themes = ["Fed Policy", "Inflation", "China Growth", "US Dollar",
                   "Geopolitical Risk", "Corporate Credit", "Energy Prices", "US Election"]
        for theme in themes:
            assert theme in THEME_KEYWORDS
            assert len(THEME_KEYWORDS[theme]) > 0

    def test_unknown_theme_defaults_to_theme_as_keyword(self):
        result = _mock_posts("Some Unknown Theme", 7)
        assert "Some Unknown Theme" in result[0]["title"]


class TestSubreddits:
    def test_subreddits_list_not_empty(self):
        assert len(SUBREDDITS) > 0
        assert "wallstreetbets" in SUBREDDITS
        assert "investing" in SUBREDDITS
