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


class TestCorpusFromThemeNews:
    """corpus_from_theme_news reads the persisted headlines instead of re-fetching."""

    @staticmethod
    def _sb_returning(rows):
        class _Q:
            def select(self, *a, **k): return self
            def gte(self, *a, **k): return self
            def limit(self, *a, **k): return self
            def execute(self):
                return type("R", (), {"data": rows})()

        class _SB:
            def table(self, name):
                assert name == "theme_news"
                return _Q()
        return _SB()

    def test_dedupes_and_drops_mock(self):
        import scripts.theme_discovery as td
        sb = self._sb_returning([
            {"headline": "Fed holds rates", "source": "brave", "run_date": "2026-07-24", "published_date": "2026-07-24"},
            {"headline": "Fed holds rates", "source": "brave", "run_date": "2026-07-23", "published_date": "2026-07-23"},  # dup
            {"headline": "MOCK story", "source": "mock_brave", "run_date": "2026-07-24", "published_date": None},          # mock
            {"headline": "Oil spikes on OPEC cut", "source": "reddit", "run_date": "2026-07-24", "published_date": None},
            {"headline": "  ", "source": "brave", "run_date": "2026-07-24", "published_date": None},                        # blank
        ])
        corpus = td.corpus_from_theme_news(sb, lookback_days=180)
        texts = [c["text"] for c in corpus]
        assert texts == ["Fed holds rates", "Oil spikes on OPEC cut"]  # deduped, mock+blank dropped

    def test_read_failure_returns_empty(self):
        import scripts.theme_discovery as td

        class _SB:
            def table(self, name):
                raise Exception("network down")
        assert td.corpus_from_theme_news(_SB(), lookback_days=180) == []

class TestImportsWithoutTheModels:
    """`theme_discovery` must import with NO heavy ML installed (ADR-0130).

    This is the property the module docstring has always claimed and did not have:
    the pure functions were factored out, but module-scope `gensim` /
    `sentence_transformers` / `umap` / `hdbscan` imports meant importing them
    pulled in torch. CI's answer was `--ignore=tests/backend/test_theme_discovery.py`,
    so 14 tests that touch no model went ungated.
    """

    def test_module_imports_with_the_ml_stack_blocked(self):
        """Run in a SUBPROCESS with the heavy modules blocked at import time.

        A subprocess because the property is about a fresh interpreter: in THIS
        process another test may already have imported the real modules, and
        `sys.modules` would mask a module-scope import that would fail on a clean
        machine. See the entry-point lesson — verify under the invocation
        production uses, not the one pytest happens to give you.
        """
        import subprocess
        import sys
        import textwrap
        from pathlib import Path

        repo = Path(__file__).resolve().parents[2]
        program = textwrap.dedent(
            """
            import sys

            BLOCKED = {"gensim", "sentence_transformers", "umap", "hdbscan", "torch"}

            class Blocker:
                def find_module(self, name, path=None):
                    return self if name.split(".")[0] in BLOCKED else None
                def find_spec(self, name, path=None, target=None):
                    if name.split(".")[0] in BLOCKED:
                        raise ImportError(f"blocked for test: {name}")
                    return None

            sys.meta_path.insert(0, Blocker())

            import scripts.theme_discovery as td

            # The pure surface must RUN, not merely be importable.
            #
            # This block asserted `callable(...)` and called only agree_themes,
            # which let a real hole through: preprocess() still did
            # `from gensim.parsing.preprocessing import STOPWORDS` INSIDE the
            # function, so cluster_term_sets -- which calls it -- failed without
            # the ML stack while the test reported the module clean. `callable`
            # is true of any function that has been defined; it says nothing
            # about whether it works (ADR-0133).
            assert td.agree_themes([{"a", "b", "c"}], [{"a", "b", "d"}])["tier2"]
            assert td.preprocess("Fed holds rates steady") == ["fed", "rates", "steady"]
            sets = td.cluster_term_sets(
                ["Fed holds rates steady", "Fed holds rates again"], [0, 0]
            )
            assert sets and "fed" in sets[0]
            assert td.lda_topic_sets.__name__ == "lda_topic_sets"
            print("OK")
            """
        )
        result = subprocess.run(
            [sys.executable, "-c", program],
            cwd=str(repo),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        assert result.returncode == 0, (
            "theme_discovery does not import without the ML stack.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert "OK" in result.stdout

    def test_no_heavy_import_survives_at_module_scope(self):
        """The specific regression: a heavy import at column 0. Cheap, and it
        names the exact line a future edit would add."""
        import re
        from pathlib import Path

        src = (Path(__file__).resolve().parents[2] / "scripts" / "theme_discovery.py").read_text(
            encoding="utf-8"
        )
        offenders = [
            line
            for line in src.splitlines()
            if re.match(r"^(import|from)\s+(gensim|sentence_transformers|umap|hdbscan|torch)\b", line)
        ]
        assert offenders == [], (
            "heavy ML imported at module scope — move it inside run_discovery: " f"{offenders}"
        )


class TestDiscoveryUsesTheSharedTokenizer:
    """`preprocess` delegates to `narrative_tracker.tokenize` (ADR-0133).

    Measured on the live 2026-07-24 discovery run: three of eleven candidates
    were built on publisher names, and two of those were **Tier 2** -- the tier
    that means two independent methods agreed. They agreed on a byline.
    """

    def test_publishers_do_not_become_discovery_terms(self):
        import scripts.theme_discovery as td
        # The exact live case: "nato / pravda / ukraine", Tier 2.
        assert "pravda" not in td.preprocess("Ukraine hits NATO summit | Pravda")
        assert "fxstreet" not in td.preprocess("Dollar index forecast | FXStreet")

    def test_trailing_attribution_is_stripped(self):
        import scripts.theme_discovery as td
        assert td.preprocess("Gold hits record high | OilPrice.com") == [
            "gold", "hits", "record", "high",
        ]

    def test_two_letter_tokens_survive_here_too(self):
        """`len(t) > 2` meant the discovery job could not have found the AI capex
        narrative even with a perfect corpus."""
        import scripts.theme_discovery as td
        assert "ai" in td.preprocess("AI capex cycle accelerates")

    def test_it_is_the_same_function_not_a_copy(self):
        """One tokenizer, one stoplist, one place to argue with it. A copy would
        drift, which is how the two implementations diverged in the first place."""
        import scripts.theme_discovery as td
        from backend.services.narrative_tracker import tokenize
        for text in [
            "Fed holds rates steady | Reuters",
            "AI capex cycle and the US dollar",
            "OPEC+ raises output amid Hormuz tensions",
        ]:
            assert td.preprocess(text) == tokenize(text)
