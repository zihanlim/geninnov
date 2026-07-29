"""Tests for the daily narrative tracker (ADR-0128).

The property under test throughout: a narrative NOBODY NAMED IN ADVANCE can be
detected, dated, and told apart from one of the eight hard-coded anchors.
"""
from datetime import date, timedelta

import pytest

from backend.services.narrative_tracker import (
    MIN_DAYS_FOR_VELOCITY,
    DailyCorpus,
    anchor_for_phrase,
    build_narrative_signals,
    classify_status,
    NarrativeSignal,
    daily_phrase_counts,
    emerging_narratives,
    load_history,
    persist_narrative_signals,
    phrases_in,
    prune_subsumed,
    tokenize,
    track_narratives,
)

RUN = date(2026, 7, 28)

ANCHORS = {
    "Fed Policy": ["Federal Reserve", "FOMC", "interest rates", "monetary policy"],
    "US Dollar": ["US dollar", "DXY", "currency", "FX"],
    "Inflation": ["CPI", "PPI", "inflation"],
}


class TestTokenize:
    def test_ai_survives_tokenisation(self):
        """The brief's own example. A 3-character minimum deleted "ai" and with
        it every phrase the AI capex narrative is expressed in."""
        assert "ai" in tokenize("AI capex cycle accelerates")

    def test_other_two_letter_finance_tokens_survive(self):
        for tok in ("eu", "uk", "em", "hy", "qt"):
            assert tok in tokenize(f"{tok.upper()} outlook shifts"), tok

    def test_two_letter_grammar_words_are_still_dropped(self):
        got = tokenize("as it is to be by an at or")
        assert got == []

    def test_us_is_kept_because_it_means_united_states_here(self):
        """Two of the eight anchor themes are "US Dollar" and "US Election".
        Stopping "us" as a pronoun decapitated both."""
        assert tokenize("US dollar weakness") == ["us", "dollar", "weakness"]

    def test_compound_tokens_are_not_split(self):
        got = tokenize("Risk-off tone hits S&P")
        assert "risk-off" in got
        assert "s&p" in got

    def test_newswire_furniture_is_dropped(self):
        # "market", "wrap", "stocks", "close" and "today" are all furniture.
        assert tokenize("Market wrap: stocks close today") == []

    def test_content_bearing_descriptors_are_kept(self):
        # "high" is furniture on its own but load-bearing inside "record high" and
        # "high yield" - and because n-grams are built over the FILTERED stream,
        # stopping a token removes it from every phrase containing it.
        assert "high" in tokenize("Gold hits record high")
        assert "record high" in phrases_in("Gold hits record high")

    def test_single_characters_are_dropped(self):
        assert tokenize("a b c dollar") == ["dollar"]


class TestPhrasesIn:
    def test_builds_unigrams_bigrams_and_trigrams(self):
        got = phrases_in("dollar debasement fears")
        assert "dollar" in got
        assert "dollar debasement" in got
        assert "dollar debasement fears" in got

    def test_repeats_within_one_document_count_once(self):
        """Document frequency, not term frequency: one story repeating a word
        emphatically is still one story about it."""
        once = phrases_in("tariffs")
        many = phrases_in("tariffs tariffs tariffs")
        assert "tariffs" in once and "tariffs" in many
        # a set either way — the caller increments by one per document
        assert isinstance(many, set)

    def test_ngrams_bridge_dropped_stopwords(self):
        """"the Fed is hawkish" must yield "fed hawkish". N-grams over raw tokens
        would bury every real phrase under "of the" and "in a"."""
        assert "fed hawkish" in phrases_in("the Fed is hawkish")


class TestPruneSubsumed:
    def test_a_unigram_that_is_just_a_bigram_missing_a_word_is_dropped(self):
        got = prune_subsumed({"intelligence": 12, "artificial intelligence": 11})
        assert got == {"artificial intelligence": 11}

    def test_the_more_specific_phrase_always_survives(self):
        got = prune_subsumed({"capex": 10, "ai capex": 9, "ai capex cycle": 8})
        assert "ai capex cycle" in got

    def test_an_independently_popular_short_phrase_survives(self):
        """"gold" appearing in 40 documents is not explained by the 5 that say
        "gold miners" — it is its own narrative."""
        got = prune_subsumed({"gold": 40, "gold miners": 5})
        assert got == {"gold": 40, "gold miners": 5}

    def test_containment_respects_word_boundaries(self):
        """"us" must not be treated as contained in "thus far"."""
        got = prune_subsumed({"us": 10, "thus far": 10})
        assert "us" in got


class TestDailyPhraseCounts:
    def test_counts_documents_and_reports_what_it_discarded(self):
        docs = ["AI capex cycle surges"] * 3 + ["something entirely different"]
        c = daily_phrase_counts(docs, RUN, min_doc_count=3)
        assert c.corpus_size == 4
        assert c.doc_counts["ai capex cycle"] == 3
        # The tail is real; a run that hid it would read as total coverage.
        assert c.below_threshold > 0

    def test_a_phrase_below_the_floor_is_not_tracked(self):
        c = daily_phrase_counts(["lone mention of quantum tariffs"], RUN, min_doc_count=3)
        assert c.doc_counts == {}


class TestAnchorCoverage:
    def test_a_phrase_an_anchor_already_asks_for_is_marked_covered(self):
        assert anchor_for_phrase("federal reserve", ANCHORS) == "Fed Policy"
        assert anchor_for_phrase("fomc", ANCHORS) == "Fed Policy"

    def test_a_longer_phrase_containing_an_anchor_keyword_is_covered(self):
        assert anchor_for_phrase("hawkish federal reserve", ANCHORS) == "Fed Policy"

    def test_the_ai_capex_narrative_is_covered_by_nothing(self):
        """The whole point of the field. None of the eight anchors asks for this,
        so a surge in it is news TO THIS SYSTEM rather than a theme doing its job."""
        assert anchor_for_phrase("ai capex cycle", ANCHORS) is None
        assert anchor_for_phrase("data center buildout", ANCHORS) is None

    def test_dollar_debasement_is_partially_covered_and_says_so(self):
        """"us dollar" is covered by the US Dollar anchor; "debasement" — the word
        that makes it a distinct narrative — is not."""
        assert anchor_for_phrase("us dollar", ANCHORS) == "US Dollar"
        assert anchor_for_phrase("debasement", ANCHORS) is None


class TestClassifyStatus:
    def test_too_little_history_is_new_not_emerging(self):
        """A phrase seen twice is not evidence. Calling it emerging promotes noise
        on its second day."""
        assert classify_status(None, 2, RUN - timedelta(days=1), RUN) == "new"

    def test_young_and_accelerating_is_emerging(self):
        assert classify_status(2.4, 6, RUN - timedelta(days=6), RUN) == "emerging"

    def test_old_and_accelerating_is_not_emerging(self):
        """Inflation having a loud week is not a new narrative. Without the age
        test, every established theme reads as emerging whenever it spikes."""
        assert classify_status(2.4, 200, RUN - timedelta(days=200), RUN) == "established"

    def test_decelerating_is_fading(self):
        assert classify_status(-2.0, 30, RUN - timedelta(days=30), RUN) == "fading"

    def test_present_but_flat_is_established(self):
        assert classify_status(0.2, 30, RUN - timedelta(days=30), RUN) == "established"


class TestBuildNarrativeSignals:
    def _corpus(self, counts, size=100):
        return DailyCorpus(run_date=RUN, doc_counts=counts, corpus_size=size)

    def test_share_of_voice_not_raw_count_is_the_series(self):
        """The daily corpus size swings with how many articles the fetch returned.
        A raw count rises on a day the fetcher simply worked better."""
        a = build_narrative_signals(self._corpus({"tariffs": 10}, size=100), {})
        b = build_narrative_signals(self._corpus({"tariffs": 20}, size=200), {})
        assert a[0].share == b[0].share == pytest.approx(0.10)

    def test_velocity_is_none_not_zero_without_enough_history(self):
        sig = build_narrative_signals(self._corpus({"tariffs": 10}), {})[0]
        assert sig.velocity is None
        assert sig.status == "new"

    def test_a_genuine_break_from_its_own_history_is_emerging(self):
        history = {
            "ai capex cycle": [
                (RUN - timedelta(days=d), 0.01) for d in range(8, 2, -1)
            ] + [(RUN - timedelta(days=2), 0.012), (RUN - timedelta(days=1), 0.011)]
        }
        sig = build_narrative_signals(self._corpus({"ai capex cycle": 25}), history)[0]
        assert sig.velocity is not None and sig.velocity > 0
        assert sig.status == "emerging"
        assert sig.days_observed == 9

    def test_first_seen_comes_from_history_not_today(self):
        history = {"tariffs": [(RUN - timedelta(days=40), 0.02)]}
        sig = build_narrative_signals(self._corpus({"tariffs": 5}), history)[0]
        assert sig.first_seen == RUN - timedelta(days=40)

    def test_covered_phrases_carry_their_anchor(self):
        sigs = build_narrative_signals(
            self._corpus({"fomc": 10, "ai capex cycle": 10}), {}, ANCHORS
        )
        by_phrase = {s.phrase: s for s in sigs}
        assert by_phrase["fomc"].covered_by == "Fed Policy"
        assert by_phrase["ai capex cycle"].covered_by is None


class TestEmergingNarratives:
    def _emerging(self, phrase, covered_by, velocity):
        history = {phrase: [(RUN - timedelta(days=d), 0.01) for d in range(9, 1, -1)]}
        corpus = DailyCorpus(run_date=RUN, doc_counts={phrase: 30}, corpus_size=100)
        sigs = build_narrative_signals(corpus, history, ANCHORS)
        return sigs

    def test_shortlist_excludes_what_an_anchor_already_covers(self):
        """The question is "what is the pipeline missing". A surge in "fomc" is
        not a miss."""
        covered = self._emerging("fomc", "Fed Policy", 3.0)
        assert covered[0].status == "emerging"
        assert emerging_narratives(covered) == []
        assert len(emerging_narratives(covered, include_covered=True)) == 1

    def test_shortlist_keeps_a_narrative_no_anchor_asks_for(self):
        fresh = self._emerging("ai capex cycle", None, 3.0)
        shortlist = emerging_narratives(fresh)
        assert [s.phrase for s in shortlist] == ["ai capex cycle"]


class TestTheFloorScalesWithTheCorpus:
    """An absolute document count does not survive an 80-fold change in corpus size.

    Measured on live runs: 3 documents is an 11% bar at 11 docs/day and a 0.35% bar
    at 868. The first admits only newswire register; the second admits coincidence.
    """

    def _docs(self, n: int, phrase_in: int) -> list[str]:
        """`n` headlines, `phrase_in` of which contain a shared phrase."""
        return (
            [f"copper supply squeeze deepens number {i}" for i in range(phrase_in)]
            + [f"unrelated filler headline number {i}" for i in range(n - phrase_in)]
        )

    def test_thin_day_uses_the_absolute_count(self):
        # 20 docs: 1% is 0.2, so the count binds and the bar stays 3.
        c = daily_phrase_counts(self._docs(20, 3), RUN)
        assert c.floor == 3
        assert "copper supply squeeze" in c.doc_counts

    def test_dense_day_uses_the_share(self):
        # 800 docs: 1% is 8, so 3 documents is no longer enough.
        c = daily_phrase_counts(self._docs(800, 3), RUN)
        assert c.floor == 8
        assert "copper supply squeeze" not in c.doc_counts

    def test_the_same_phrase_clears_the_dense_day_at_the_share(self):
        c = daily_phrase_counts(self._docs(800, 8), RUN)
        assert c.floor == 8
        assert "copper supply squeeze" in c.doc_counts

    def test_the_floor_travels_with_the_corpus(self):
        # Carried, not recomputed: a run has to be able to SAY what bar it applied
        # rather than leave a reader to infer it from a constant that is no longer
        # the whole story.
        assert daily_phrase_counts(self._docs(500, 9), RUN).floor == 5


class TestTheKeepListDoesNotDiscardThePayload:
    """An emerging narrative is QUIET and accelerating.

    `signals` is sorted by share descending, so truncating at top_n keeps the
    loudest -- and discards the phrase this detector exists to find. The live
    2026-07-29 run persisted 150 of 736 phrases and reported 0 emerging on a day
    with 34 measured velocities.
    """

    def _sig(self, phrase, share, velocity):
        return NarrativeSignal(
            run_date=RUN, phrase=phrase, doc_count=int(share * 100), corpus_size=100,
            share=share, velocity=velocity, days_observed=5, first_seen=RUN,
            status="emerging" if velocity and velocity >= 1.5 else "established",
            covered_by=None, methods=["frequency"],
        )

    def test_a_quiet_mover_below_the_cut_is_kept(self):
        written = {}

        class _Sb:
            def table(self, _n): return self
            def upsert(self, rows, **_k):
                written["rows"] = rows
                return self
            def execute(self): return type("R", (), {"data": []})()

        signals = (
            [self._sig(f"loud{i}", 0.9 - i * 0.001, None) for i in range(5)]
            + [self._sig("quiet breakout", 0.01, 3.2)]
        )
        persist_narrative_signals(_Sb(), signals, top_n=5)

        kept = {r["phrase"] for r in written["rows"]}
        assert "quiet breakout" in kept, "the accelerating phrase was truncated away"
        assert len(kept) == 6, "loudest five plus the one mover"

    def test_a_quiet_phrase_that_is_NOT_moving_is_still_dropped(self):
        # The cap still caps. Only movement earns a reprieve, or nothing is dropped
        # and the cap means nothing.
        written = {}

        class _Sb:
            def table(self, _n): return self
            def upsert(self, rows, **_k):
                written["rows"] = rows
                return self
            def execute(self): return type("R", (), {"data": []})()

        signals = (
            [self._sig(f"loud{i}", 0.9 - i * 0.001, None) for i in range(5)]
            + [self._sig("quiet and flat", 0.01, 0.2)]
        )
        persist_narrative_signals(_Sb(), signals, top_n=5)
        assert "quiet and flat" not in {r["phrase"] for r in written["rows"]}


class TestNewswireFurniture:
    """A stoplist is a silent editorial decision about what counts, so each entry
    has to survive the question the `data` / `data center` case poses: what n-grams
    containing this token exist in the live corpus?"""

    def test_top_and_wall_are_stopped(self):
        # Both reached the emerging shortlist on the deepened archive -- `wall` at
        # 0.208 max share over 6 days -- and neither is a narrative.
        assert phrases_in("Top stocks to watch on Monday") == set()
        assert "wall" not in phrases_in("Wall Street drifts mixed as investors weigh")

    def test_stopping_wall_destroys_nothing_because_street_was_already_stopped(self):
        """The INVERSE of the `data` / `data center` trap.

        `street` is already newswire furniture, so "wall street" can never form as a
        bigram -- which is why the corpus yielded `wall`, `wall drifts` and
        `wall drifts mixed`. `wall` was the residue of a phrase already dismantled,
        not a fragment competing with a real one.
        """
        got = phrases_in("Wall Street rallies on Fed pivot")
        assert not any("wall" in p or "street" in p for p in got)

    def test_data_center_still_survives(self):
        """The regression this whole class of change risks (ADR-0129).

        n-grams are built over the FILTERED token stream, so stopping one token
        removes every phrase containing it. Stopping `data` once silently destroyed
        `data center` -- the phrase the entire AI capex buildout is described in.
        """
        got = phrases_in("AI data center buildout accelerates")
        assert "data center" in got
        assert "ai data center" in got


class TestTrackNarratives:
    class _FakeTable:
        def __init__(self, store):
            self.store = store
            self._rows = []

        def select(self, *_a, **_k):
            return self

        def eq(self, col, val):
            # load_history filters by corpus (ADR-0153). Recorded, not just
            # swallowed: a fake that quietly accepts any call would have hidden the
            # filter going missing, which is the bug this guards.
            self.store.setdefault("filters", {})[col] = val
            return self

        def gte(self, *_a, **_k):
            return self

        def lt(self, *_a, **_k):
            return self

        def order(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

        def execute(self):
            return type("R", (), {"data": self.store.get("history", [])})()

        def upsert(self, rows, **_k):
            self.store["written"] = rows
            return self

    class _FakeSb:
        def __init__(self, store):
            self.store = store

        def table(self, _name):
            return TestTrackNarratives._FakeTable(self.store)

    def test_history_is_read_from_the_SAME_corpus_it_writes(self):
        """The filter that keeps a velocity a statement about the phrase.

        A share is a fraction OF a corpus. Reading history from `combined` while
        counting today out of `archive` compares GDELT's ~11 documents a day against
        a combined ~98 and reports the difference as a change in attention. Nothing
        about the output would look wrong — every velocity would simply be an
        artefact — so the filter is asserted here rather than trusted.
        """
        for corpus in ("combined", "archive"):
            store: dict = {}
            # Four documents sharing a phrase, so it clears MIN_DOC_COUNT = 3 and
            # the run actually reaches the persist path.
            docs = [
                "oil prices climb on supply worry",
                "oil prices climb again in asia",
                "traders watch oil prices climb",
                "oil prices climb to a monthly high",
            ]
            track_narratives(self._FakeSb(store), RUN, docs, corpus=corpus)
            assert store["filters"]["corpus"] == corpus
            # ...and the rows it writes carry the same label, so the next run's
            # history read finds them.
            assert all(r["corpus"] == corpus for r in store["written"])

    def test_an_empty_corpus_produces_no_signal_and_says_why(self, capsys):
        """Never a fabricated signal, never silence."""
        out = track_narratives(self._FakeSb({}), RUN, [])
        assert out == []
        assert "Corpus is empty" in capsys.readouterr().out

    def test_persists_and_reports_the_emerging_shortlist(self):
        store = {"history": [
            {"phrase": "ai capex cycle", "run_date": (RUN - timedelta(days=d)).isoformat(),
             "share": 0.01}
            for d in range(9, 1, -1)
        ]}
        docs = ["AI capex cycle drives record spending"] * 30 + [
            f"Unrelated market story number {i}" for i in range(70)
        ]
        sigs = track_narratives(self._FakeSb(store), RUN, docs, ANCHORS)
        written = {r["phrase"]: r for r in store["written"]}
        assert "ai capex cycle" in written
        assert written["ai capex cycle"]["status"] == "emerging"
        assert written["ai capex cycle"]["covered_by"] is None
        assert [s.phrase for s in emerging_narratives(sigs)][:1] == ["ai capex cycle"]

    def test_a_missing_table_degrades_with_a_reason_rather_than_crashing(self, capsys):
        class Broken:
            def table(self, _n):
                raise RuntimeError("relation does not exist")

        sigs = track_narratives(Broken(), RUN, ["tariffs bite exporters"] * 5)
        # Signals still built; history unavailable so everything reads as new.
        assert all(s.status == "new" for s in sigs)
        assert "apply migration 049" in capsys.readouterr().out


class TestShareVelocity:
    """The MAD floor (SHARE_SCALE_FLOOR) — the same argument as ADR-0047's
    conviction vol floor, applied to share of voice."""

    def test_a_flat_history_does_not_refuse_to_score_a_break(self):
        """A phrase sitting at exactly 0.01 for eight days has a MAD of zero, so a
        raw median/MAD z is 0/0. Reporting "no reading" there is backwards: a
        departure from a perfectly stable base is the strongest evidence of a
        break, and it is the shape a genuinely new narrative makes."""
        from backend.services.narrative_tracker import share_velocity
        v = share_velocity(0.30, [0.01] * 8)
        assert v is not None
        assert v == pytest.approx(4.0)   # clipped

    def test_the_floor_does_not_override_a_real_spread(self):
        """When the history genuinely varies by more than the floor, the measured
        MAD is used and the floor is inert."""
        from backend.services.narrative_tracker import share_velocity
        wide = [0.10, 0.30, 0.12, 0.28, 0.11, 0.31]
        v = share_velocity(0.20, wide)
        assert v is not None
        assert abs(v) < 1.0    # 0.20 is unremarkable inside that range

    def test_no_history_is_none(self):
        from backend.services.narrative_tracker import share_velocity
        assert share_velocity(0.2, []) is None

    def test_a_decline_from_a_stable_base_is_negative(self):
        from backend.services.narrative_tracker import share_velocity
        v = share_velocity(0.001, [0.05] * 8)
        assert v is not None and v < -4.0 + 1e-9 or v == pytest.approx(-4.0)


class TestPublisherAttribution:
    """Measured on the live corpus: with attribution unstripped, "fxstreet"
    ranked as the 6th-loudest narrative of the day at 8.4% share - above OPEC."""

    def test_trailing_source_attribution_is_stripped(self):
        from backend.services.narrative_tracker import strip_attribution
        assert strip_attribution(
            "OPEC+ Set to Raise Output Again - Even as Members Can't Pump It | OilPrice.com"
        ) == "OPEC+ Set to Raise Output Again - Even as Members Can't Pump It"

    def test_a_publisher_does_not_become_a_narrative(self):
        # Varied wording so "dollar" survives on its own merit rather than as
        # part of one repeated phrase — prune_subsumed would otherwise fold it
        # into the longer n-gram and the assertion would test the wrong thing.
        tails = ["slips", "rallies", "steadies", "retreats", "firms",
                 "wobbles", "climbs", "eases", "jumps", "dips"]
        docs = [f"Dollar {t} against peers | FXStreet" for t in tails]
        c = daily_phrase_counts(docs, RUN, min_doc_count=3)
        # The publisher ran all ten stories; without the strip it would out-rank
        # the thing all ten are about.
        assert "fxstreet" not in c.doc_counts
        assert c.doc_counts.get("dollar") == 10

    def test_a_headline_with_a_pipe_in_its_content_keeps_it(self):
        """The strip is bounded to a short tail, so a long segment after a pipe
        is treated as content rather than attribution."""
        from backend.services.narrative_tracker import strip_attribution
        long_tail = "Fed holds | and the market reads the statement as decisively dovish overall"
        assert strip_attribution(long_tail) == long_tail

    def test_publisher_stoplist_backstops_an_unstripped_name(self):
        # No pipe, so strip_attribution does nothing; the blocklist catches it.
        assert "reuters" not in tokenize("Reuters reports dollar weakness")
        assert "bloomberg" not in tokenize("Bloomberg says gold rallied")


class TestCoverageAttribution:
    """The two loudest false "nothing is watching this" claims in the live run."""

    def _covered(self, phrase):
        from backend.data.brave_client import coverage_keywords
        return anchor_for_phrase(phrase, coverage_keywords())

    def test_fed_is_attributed_to_fed_policy(self):
        # "Federal Reserve" tokenises to {federal, reserve} and never matches the
        # token "fed", so this read as an unwatched narrative at 9.3% share.
        assert self._covered("fed") == "Fed Policy"

    def test_rates_is_attributed_despite_the_plural(self):
        assert self._covered("rates") == "Fed Policy"

    def test_oil_and_opec_are_attributed_to_energy(self):
        assert self._covered("oil") == "Energy Prices"
        assert self._covered("opec") == "Energy Prices"

    def test_trump_is_attributed_to_the_election_theme(self):
        assert self._covered("trump") == "US Election"

    def test_a_single_generic_token_is_not_claimed_by_a_multiword_keyword(self):
        """"us" was the loudest phrase in the live corpus at 14.3% and was being
        attributed to US Dollar by the reverse-subset rule. Over-matching is the
        costly error: a covered phrase is removed from the shortlist, which is
        the feature's whole point."""
        assert anchor_for_phrase("us", ANCHORS) is None
        assert anchor_for_phrase("policy", ANCHORS) is None

    def test_a_two_token_phrase_inside_a_keyword_is_still_claimed(self):
        assert anchor_for_phrase("us dollar", ANCHORS) == "US Dollar"

    def test_the_ai_capex_narrative_is_now_claimed_by_its_own_theme(self):
        """This assertion INVERTED on 2026-07-28, and the inversion is the
        system working. It read `is None` - "nothing is watching this" - which
        was true and was the finding. ADR-0129 then made AI Capex a theme with
        mapped instruments, so the same phrase is now attributed to it and drops
        off the shortlist. A narrative leaving this list because it was adopted
        is the only good reason for it to leave."""
        assert self._covered("ai capex cycle") == "AI Capex"
        assert self._covered("data center buildout") == "AI Capex"

    def test_a_narrative_no_theme_has_adopted_is_still_uncovered(self):
        # The guard that keeps the widening honest: adopting one narrative must
        # not start claiming the next one.
        assert self._covered("debasement") is None
        assert self._covered("dollar debasement") is None

    def test_aliases_only_narrow_the_shortlist_never_the_corpus(self):
        """coverage_keywords() must be a superset of THEME_KEYWORDS, so it can
        change attribution but never what the tracker is able to see."""
        from backend.data.brave_client import THEME_KEYWORDS, coverage_keywords
        cov = coverage_keywords()
        for theme, kws in THEME_KEYWORDS.items():
            assert set(kws) <= set(cov[theme])


class TestSingleTokenAliasesClaimOnlyThemselves:
    """A one-word keyword covers only the one-word phrase (ADR-0129).

    Caught by a test written for a different feature: after "dollar" was added as
    a US Dollar alias, "dollar debasement" attributed to US Dollar - annexing the
    exact narrative ADR-0128 names as the motivating example of one this system
    could not see.
    """

    def _cov(self, phrase):
        from backend.data.brave_client import coverage_keywords
        return anchor_for_phrase(phrase, coverage_keywords())

    def test_a_generic_alias_covers_its_own_phrase(self):
        assert self._cov("dollar") == "US Dollar"
        assert self._cov("fed") == "Fed Policy"
        assert self._cov("oil") == "Energy Prices"

    def test_a_generic_alias_does_not_annex_a_specific_narrative(self):
        assert self._cov("dollar debasement") is None
        assert self._cov("dollar weaponisation") is None

    def test_a_multiword_keyword_still_claims_a_more_specific_phrase(self):
        assert self._cov("us dollar") == "US Dollar"
        assert self._cov("ai capex cycle") == "AI Capex"
        assert self._cov("hawkish federal reserve") == "Fed Policy"

    def test_the_asymmetry_is_the_point(self):
        """Wrongly-covered removes a phrase from the shortlist the feature exists
        to produce; wrongly-uncovered only lengthens a list a human reads."""
        # specific enough to claim
        assert self._cov("data center") == "AI Capex"
        # too generic to claim anything but itself
        assert self._cov("center") is None


class TestTheDenominatorIsUnbiased:
    """Share of voice is scored on the UN-THEMED corpus only (ADR-0141).

    Measured 2026-07-28: AI was 34% of the un-themed corpus and 5.5% of the
    anchor-fetched one. Blending them -- 100 un-themed against 1688 themed --
    reported 7%, so the largest narrative in the only unbiased sample read as
    marginal. A bigger denominator of self-selected text corrupts the estimate.
    """

    class _Sb:
        def __init__(self, market, theme, fail=()):
            self.market, self.theme, self.fail, self._t = market, theme, fail, None
        def table(self, name):
            if name in self.fail:
                raise RuntimeError(f"{name} unavailable")
            self._t = name
            return self
        def select(self, *a, **k): return self
        def gte(self, *a, **k): return self
        def in_(self, *a, **k): return self
        def limit(self, *a, **k): return self
        def execute(self):
            return type("R", (), {"data": self.market if self._t == "market_news" else self.theme})()

    def _rows(self, *hs):
        return [{"headline": h, "source": "brave"} for h in hs]

    def _load(self, sb):
        # daily_refresh reads SUPABASE_* at module scope (GitHub Actions injects
        # them), so a stub is needed before import -- the same pattern
        # test_daily_refresh.py uses.
        import os
        os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
        os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
        import scripts.daily_refresh as d
        real, d.supabase = d.supabase, sb
        try:
            return d.load_market_corpus(RUN, lookback_days=7)
        finally:
            d.supabase = real

    def test_themed_news_is_excluded_from_the_denominator(self):
        sb = self._Sb(self._rows("AI capex lifts Alphabet"),
                      self._rows("Fed holds", "Dollar firms", "Oil slips"))
        assert self._load(sb) == ["AI capex lifts Alphabet"]

    def test_a_dominant_narrative_is_not_diluted_by_our_own_queries(self):
        """The live shape, in miniature: 1 of 2 un-themed docs is AI (50%), and
        6 anchor-fetched docs would drag it to 12.5%."""
        sb = self._Sb(self._rows("AI capex surges", "Bond yields rise"),
                      self._rows(*[f"Fed story {i}" for i in range(6)]))
        docs = self._load(sb)
        assert len(docs) == 2
        assert sum(1 for d in docs if "AI" in d) / len(docs) == 0.5

    def test_it_falls_back_to_themed_news_rather_than_scoring_nothing(self):
        sb = self._Sb([], self._rows("Fed holds"))
        assert self._load(sb) == ["Fed holds"]

    def test_the_fallback_says_the_reading_is_about_our_own_queries(self, capsys):
        sb = self._Sb([], self._rows("Fed holds"))
        self._load(sb)
        out = capsys.readouterr().out
        assert "WARNING" in out
        assert "our own keyword mix" in out

    def test_the_normal_path_states_what_it_excluded(self, capsys):
        sb = self._Sb(self._rows("AI capex"), self._rows("Fed holds"))
        self._load(sb)
        assert "themed news excluded from the denominator" in capsys.readouterr().out

    def test_mock_rows_never_enter_the_denominator(self):
        sb = self._Sb([{"headline": "synthetic", "source": "mock_brave"},
                       {"headline": "real story", "source": "brave_market"}], [])
        assert self._load(sb) == ["real story"]

    def test_duplicates_do_not_inflate_a_share(self):
        sb = self._Sb(self._rows("Same story", "Same story", "Other"), [])
        assert len(self._load(sb)) == 2
