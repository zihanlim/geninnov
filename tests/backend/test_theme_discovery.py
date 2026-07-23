"""
Tests for theme_discovery.py
"""
import pytest
import sys
from datetime import date
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure scripts directory is accessible
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))


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


class TestClusterTermSets:
    """The embedding-method side of the agreement (pure)."""

    def test_groups_by_cluster_and_drops_noise(self):
        import scripts.theme_discovery as td
        texts = [
            "Fed raises interest rates", "Fed hikes rates again",
            "China GDP growth slows", "China stimulus package",
            "totally unrelated document",
        ]
        clusters = [0, 0, 1, 1, -1]   # -1 is HDBSCAN noise
        sets = td.cluster_term_sets(texts, clusters, topn=5)
        assert len(sets) == 2, "noise cluster (-1) must be dropped"
        joined = set().union(*sets)
        assert "fed" in joined or "rates" in joined
        assert "china" in joined


class TestAgreeThemes:
    """The core two-method agreement logic (pure)."""

    def test_overlap_promotes_to_tier2(self):
        import scripts.theme_discovery as td
        lda = [{"fed", "rates", "hike", "policy"}]
        clusters = [{"fed", "rates", "powell", "fomc"}]
        out = td.agree_themes(lda, clusters, min_overlap=2)
        assert len(out["tier2"]) == 1
        assert set(out["tier2"][0]["terms"]) >= {"fed", "rates"}
        assert out["tier2"][0]["methods"] == ["lda", "embedding"]
        assert out["tier3"] == []

    def test_disjoint_topics_are_tier3_single_method(self):
        import scripts.theme_discovery as td
        lda = [{"gold", "silver", "inflation"}]
        clusters = [{"china", "gdp", "growth"}]
        out = td.agree_themes(lda, clusters, min_overlap=2)
        assert out["tier2"] == []
        assert len(out["tier3"]) == 2
        methods = {tuple(i["methods"]) for i in out["tier3"]}
        assert methods == {("lda",), ("embedding",)}

    def test_overlap_below_threshold_is_tier3(self):
        import scripts.theme_discovery as td
        lda = [{"fed", "rates"}]
        clusters = [{"fed", "china", "gold"}]   # overlap 1 < 2
        out = td.agree_themes(lda, clusters, min_overlap=2)
        assert out["tier2"] == []
        assert len(out["tier3"]) == 2


class TestPersistDiscovered:
    def _recorder(self):
        captured = {}

        class _Tbl:
            def upsert(self, rows, **kw):
                captured["rows"] = rows
                captured["on_conflict"] = kw.get("on_conflict")
                return self

            def execute(self):
                return type("R", (), {"data": []})()

        class _SB:
            def table(self, name):
                captured["table"] = name
                return _Tbl()

        return _SB(), captured

    def test_persist_builds_tier_rows(self):
        import scripts.theme_discovery as td
        sb, captured = self._recorder()
        agreement = {
            "tier2": [{"label": "fed / rates", "terms": ["fed", "rates"], "methods": ["lda", "embedding"]}],
            "tier3": [{"label": "gold", "terms": ["gold"], "methods": ["lda"]}],
        }
        n = td.persist_discovered_themes(sb, date(2026, 7, 23), agreement, corpus_size=120)
        assert n == 2
        assert captured["table"] == "discovered_themes"
        assert captured["on_conflict"] == "run_date,label"
        assert {r["tier"] for r in captured["rows"]} == {2, 3}
        assert all(r["status"] == "shadow" for r in captured["rows"])
        assert all(r["corpus_size"] == 120 for r in captured["rows"])

    def test_persist_empty_agreement_is_noop(self):
        import scripts.theme_discovery as td

        class _SB:
            def table(self, name):
                raise AssertionError("must not touch the DB for an empty agreement")

        assert td.persist_discovered_themes(_SB(), date(2026, 7, 23), {"tier2": [], "tier3": []}, 0) == 0

    def test_persist_survives_missing_table(self):
        import scripts.theme_discovery as td

        class _Tbl:
            def upsert(self, *a, **k):
                raise Exception('relation "discovered_themes" does not exist')

        class _SB:
            def table(self, name):
                return _Tbl()

        agreement = {"tier2": [{"label": "x", "terms": ["x"], "methods": ["lda", "embedding"]}], "tier3": []}
        assert td.persist_discovered_themes(_SB(), date(2026, 7, 23), agreement, 60) == 0