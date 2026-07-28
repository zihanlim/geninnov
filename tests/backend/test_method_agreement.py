"""Two-method agreement (ADR-0133).

Every fixture below is taken from live data: the 2026-07-28 narrative signals
against the 2026-07-24 discovery run.
"""
from datetime import date

import pytest

from backend.services.method_agreement import (
    MIN_TERM_OVERLAP,
    Corroboration,
    apply_corroboration,
    corroborate,
    load_discovered,
)
from backend.services.narrative_tracker import DailyCorpus, build_narrative_signals

RUN = date(2026, 7, 28)
DISCOVERY = date(2026, 7, 24)

# Verbatim from discovered_themes.
CANDIDATES = [
    {"label": "credit / high / spreads", "terms": ["credit", "high", "spreads"],
     "tier": 2, "methods": ["lda", "embedding"], "run_date": "2026-07-24"},
    {"label": "federal / rates / reserve", "terms": ["federal", "rates", "reserve"],
     "tier": 2, "methods": ["lda", "embedding"], "run_date": "2026-07-24"},
    {"label": "oil / opec", "terms": ["oil", "opec"],
     "tier": 2, "methods": ["lda", "embedding"], "run_date": "2026-07-24"},
    {"label": "fed / hike / holds", "terms": ["fed", "hike", "holds", "meeting", "rate", "rates"],
     "tier": 3, "methods": ["lda"], "run_date": "2026-07-24"},
    {"label": "china / chinas / chinese", "terms": ["china", "chinas", "chinese", "data", "economy", "gdp"],
     "tier": 3, "methods": ["embedding"], "run_date": "2026-07-24"},
]


class TestOverlapThreshold:
    def test_two_shared_tokens_is_the_same_narrative_found_twice(self):
        got = corroborate(["credit spreads"], CANDIDATES, RUN)
        assert got["credit spreads"].label == "credit / high / spreads"
        assert got["credit spreads"].shared == ["credit", "spreads"]
        assert got["credit spreads"].tier == 2

    def test_one_shared_token_is_not_corroboration(self):
        """At >= 1 the live top matches were "oil", "dollar" and "fxstreet" - a
        single word in common, which two methods over one corpus produce
        constantly by chance."""
        assert corroborate(["oil"], CANDIDATES, RUN) == {}
        assert corroborate(["high yield"], [CANDIDATES[0]], RUN) == {}

    def test_a_single_token_phrase_can_never_be_corroborated(self):
        # It cannot share two tokens with anything. Deliberate, and the same
        # argument as anchor_for_phrase's single-token rule.
        assert corroborate(["oil", "dollar", "fed"], CANDIDATES, RUN) == {}

    def test_the_threshold_is_two(self):
        assert MIN_TERM_OVERLAP == 2


class TestMatchSelection:
    def test_more_shared_tokens_wins(self):
        got = corroborate(["fed rate hike"], CANDIDATES, RUN)["fed rate hike"]
        assert got.label == "fed / hike / holds"
        assert got.shared == ["fed", "hike", "rate"]

    def test_ties_break_toward_the_stronger_tier(self):
        """Tier 2 means the discovery job's own two methods already agreed."""
        cands = [
            {"label": "weak", "terms": ["alpha", "beta"], "tier": 3,
             "methods": ["lda"], "run_date": "2026-07-24"},
            {"label": "strong", "terms": ["alpha", "beta"], "tier": 2,
             "methods": ["lda", "embedding"], "run_date": "2026-07-24"},
        ]
        assert corroborate(["alpha beta"], cands, RUN)["alpha beta"].label == "strong"

    def test_methods_records_every_method_that_saw_it(self):
        got = corroborate(["federal reserve"], CANDIDATES, RUN)["federal reserve"]
        assert got.methods == ["frequency", "lda", "embedding"]

    def test_a_single_method_candidate_says_so(self):
        got = corroborate(["china gdp"], CANDIDATES, RUN)["china gdp"]
        assert got.methods == ["frequency", "embedding"]
        assert got.tier == 3


class TestStaleness:
    def test_the_age_of_the_discovery_run_travels_with_the_match(self):
        """Discovery is MONTHLY. A match is routinely weeks old and must not be
        mistaken for a simultaneous second opinion."""
        got = corroborate(["credit spreads"], CANDIDATES, RUN)["credit spreads"]
        assert got.days_stale == (RUN - DISCOVERY).days == 4


class TestApplyCorroboration:
    def _signals(self, phrases):
        corpus = DailyCorpus(
            run_date=RUN, doc_counts={p: 10 for p in phrases}, corpus_size=100
        )
        return build_narrative_signals(corpus, {})

    def test_a_matched_signal_gains_the_other_methods(self):
        sigs = self._signals(["credit spreads"])
        out = apply_corroboration(sigs, corroborate(["credit spreads"], CANDIDATES, RUN))
        assert out[0].methods == ["frequency", "lda", "embedding"]

    def test_an_unmatched_signal_is_returned_bit_identical(self):
        """Wiring this in must not move a number on a narrative nobody
        corroborated -- the property that makes it safe to add to a live board
        (the same one crowding_caps holds for sizing, ADR-0110)."""
        sigs = self._signals(["some novel narrative"])
        out = apply_corroboration(sigs, corroborate(["some novel narrative"], CANDIDATES, RUN))
        assert out == sigs
        assert out[0].methods == ["frequency"]

    def test_it_does_not_mutate_the_frozen_input(self):
        sigs = self._signals(["credit spreads"])
        before = sigs[0].methods
        apply_corroboration(sigs, corroborate(["credit spreads"], CANDIDATES, RUN))
        assert sigs[0].methods == before == ["frequency"]


class TestLoadDiscovered:
    class _Sb:
        def __init__(self, rows): self.rows = rows
        def table(self, _n): return self
        def select(self, *a, **k): return self
        def gte(self, *a, **k): return self
        def order(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def execute(self): return type("R", (), {"data": self.rows})()

    def test_only_the_newest_run_is_used(self):
        """Unioning several monthly runs would let a candidate dropped by a later
        run keep corroborating today, silently resurrecting a rejected
        hypothesis."""
        rows = [
            {"run_date": "2026-07-24", "label": "new", "terms": ["a"], "tier": 2,
             "methods": ["lda"], "status": "shadow"},
            {"run_date": "2026-06-01", "label": "old", "terms": ["b"], "tier": 2,
             "methods": ["lda"], "status": "shadow"},
        ]
        got = load_discovered(self._Sb(rows), RUN)
        assert [r["label"] for r in got] == ["new"]

    def test_a_rejected_candidate_does_not_corroborate(self):
        rows = [
            {"run_date": "2026-07-24", "label": "kept", "terms": ["a"], "tier": 2,
             "methods": ["lda"], "status": "shadow"},
            {"run_date": "2026-07-24", "label": "binned", "terms": ["b"], "tier": 2,
             "methods": ["lda"], "status": "rejected"},
        ]
        got = load_discovered(self._Sb(rows), RUN)
        assert [r["label"] for r in got] == ["kept"]

    def test_a_missing_table_degrades_to_no_corroboration(self, capsys):
        class Broken:
            def table(self, _n): raise RuntimeError("relation does not exist")
        assert load_discovered(Broken(), RUN) == []
        assert "no corroboration this run" in capsys.readouterr().out
