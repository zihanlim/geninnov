"""A corpus is defined by naming its providers, not by reading the whole table.

`load_market_corpus` used to default to `sources=None`, which meant "every row in
`market_news`". Under that rule, adding a provider is an INSERT — so a new fetcher
redefines the denominator of every share in the combined series without touching a
line of scoring code, and without any config change to review.

That is the ADR-0155 failure (a share is only comparable to a share of the same
corpus) arriving through the one door ADR-0155 did not guard: not a fetch-depth
change, but a fetch-BREADTH change. The 2.5x corpus-size guard would not even fire
for it — RSS adds ~383 documents to ~1840, a 21% move, well inside the band.

These tests pin the default. If RSS (or anything else) is ever to enter a scored
corpus, it happens by editing `COMBINED_SOURCES` — which is a reviewable act — and
these tests are what force that to be deliberate.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.data.rss_client import RSS_SOURCE  # noqa: E402


def _dr():
    """Import lazily, as the rest of this suite does — `daily_refresh` builds a
    Supabase client at import time and resolving the mock host is slow."""
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "scripts"))
    sys.path.insert(0, str(root / "backend"))
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
    import daily_refresh  # noqa: E402

    return daily_refresh


class _Chain:
    """Records the `.in_(...)` the query applied AND actually applies it.

    Recording alone is not enough. A mock that returns every row regardless of the
    filter proves the call was made, not that it excluded anything — and "the RSS
    rows are excluded" is the entire claim under test.
    """

    def __init__(self, sink, rows):
        self.sink = sink
        self.rows = rows

    def select(self, *a, **k):
        return self

    def gte(self, *a, **k):
        return self

    def in_(self, column, values):
        vals = list(values)
        self.sink[column] = vals
        self.rows = [r for r in self.rows if r.get(column) in vals]
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        return MagicMock(data=self.rows)


def _corpus(rows, **kwargs) -> tuple[list[str], dict]:
    from datetime import date

    dr = _dr()
    sink: dict = {}
    with patch.object(dr, "supabase") as sb:
        sb.table.return_value = _Chain(sink, list(rows))
        docs = dr.load_market_corpus(date(2026, 7, 29), **kwargs)
    return docs, sink


MIXED = [
    {"headline": "Fed holds", "source": "brave_market"},
    {"headline": "Oil climbs", "source": "gdelt"},
    {"headline": "Yields slip", "source": RSS_SOURCE},
]


class TestTheDefaultIsAnExplicitList:
    def test_default_constrains_to_COMBINED_SOURCES(self):
        _, applied = _corpus(MIXED)
        assert applied.get("source") == _dr().COMBINED_SOURCES

    def test_the_query_is_NEVER_unfiltered(self):
        """The property that matters. An unfiltered read is the bug itself."""
        for kwargs in ({}, {"sources": None}, {"sources": [_dr().ARCHIVE_SOURCE]}):
            _, applied = _corpus(MIXED, **kwargs)
            assert "source" in applied and applied["source"], (
                f"no source filter applied for {kwargs!r}"
            )

    def test_an_explicit_sources_argument_still_wins(self):
        archive = _dr().ARCHIVE_SOURCE
        _, applied = _corpus(MIXED, sources=[archive])
        assert applied["source"] == [archive]


class TestRssIsShadow:
    def test_rss_is_not_in_the_combined_corpus(self):
        assert RSS_SOURCE not in _dr().COMBINED_SOURCES

    def test_rss_is_not_in_the_archive_corpus(self):
        """The archive is one provider by definition (ADR-0153) — GDELT is the only
        one with history, and RSS explicitly has none."""
        assert RSS_SOURCE != _dr().ARCHIVE_SOURCE

    def test_persisting_rss_cannot_change_the_combined_denominator(self):
        """The end-to-end property, stated as a corpus-size comparison.

        Same stored rows, once with the RSS row present and once without. The
        combined corpus must be byte-identical — that is what "shadow" means.
        """
        without = [r for r in MIXED if r["source"] != RSS_SOURCE]
        docs_with, _ = _corpus(MIXED)
        docs_without, _ = _corpus(without)
        assert docs_with == docs_without


class TestTheCombinedDefinitionItself:
    def test_it_names_the_two_providers_that_exist_today(self):
        assert set(_dr().COMBINED_SOURCES) == {"brave_market", "gdelt"}

    def test_the_archive_source_is_one_of_them(self):
        """Combined is a superset of archive; if it were not, the two series would
        not be two readings of the same day."""
        d = _dr()
        assert d.ARCHIVE_SOURCE in d.COMBINED_SOURCES

    def test_no_mock_provider_can_enter_a_scored_corpus(self):
        assert not any(s.startswith("mock_") for s in _dr().COMBINED_SOURCES)


class TestMockRowsAreStillExcluded:
    def test_a_mock_row_is_dropped_even_if_its_source_were_listed(self):
        rows = MIXED + [{"headline": "Fabricated", "source": "mock_brave"}]
        docs, _ = _corpus(rows)
        assert "Fabricated" not in docs
