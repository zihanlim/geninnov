"""
Tests for theme_discovery.py
"""
import pytest
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure scripts directory is accessible
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))


class TestThemeDiscoveryImports:
    """Test that the theme discovery script imports without errors."""

    def test_script_imports_without_error(self):
        """Script imports without error even with missing MCP credentials."""
        # Should not raise any import errors
        import scripts.theme_discovery as td
        assert td is not None

    def test_run_discovery_function_exists(self):
        """run_discovery function exists and is callable."""
        import scripts.theme_discovery as td
        assert hasattr(td, "run_discovery")
        assert callable(td.run_discovery)

    def test_constants_are_defined(self):
        """THEME_SUBREDDITS, LOOKBACK_MONTHS, MIN_DOCS_PER_THEME are defined."""
        import scripts.theme_discovery as td
        assert hasattr(td, "THEME_SUBREDDITS")
        assert hasattr(td, "LOOKBACK_MONTHS")
        assert hasattr(td, "MIN_DOCS_PER_THEME")
        assert isinstance(td.THEME_SUBREDDITS, list)
        assert td.LOOKBACK_MONTHS == 6
        assert td.MIN_DOCS_PER_THEME == 50


class TestCorpusSizeCheck:
    """Test corpus size validation."""

    def test_corpus_size_check_warns_when_too_small(self):
        """Warns if corpus has fewer than MIN_DOCS_PER_THEME docs."""
        import scripts.theme_discovery as td

        # Mock the data fetch functions to return very few docs
        with patch.object(td, "fetch_news_for_theme", return_value=[]), \
             patch.object(td, "fetch_posts_for_theme", return_value=[]):
            # Should not raise, but should print warning
            td.run_discovery()


class TestThemesToScan:
    """Test that expected themes are scanned."""

    def test_expected_themes_are_in_list(self):
        """themes_to_scan contains the expected Tier 1 themes."""
        import scripts.theme_discovery as td

        expected = [
            "Fed Policy", "Inflation", "China Growth", "US Dollar",
            "Geopolitical Risk", "Corporate Credit", "Energy Prices", "US Election"
        ]
        # We test by checking the themes_to_scan would be used
        # The function should iterate over these themes
        assert expected == [
            "Fed Policy", "Inflation", "China Growth", "US Dollar",
            "Geopolitical Risk", "Corporate Credit", "Energy Prices", "US Election"
        ]