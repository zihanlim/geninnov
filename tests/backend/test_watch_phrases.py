"""The phrase watch reports the state BEFORE a narrative can be named.

Everything asserted here is pure. The impure half (`main`) reuses
`load_market_corpus`, `document_floor` and `phrases_in` rather than reimplementing
them, which is the property `test_the_watch_counts_the_way_the_tracker_counts`
pins — a watch that assembles its own corpus answers a question the tracker never
asked.
"""
import pytest

from backend.services.narrative_tracker import (
    MAX_CORPUS_SIZE_RATIO,
    MIN_DAYS_FOR_VELOCITY,
    document_floor,
    phrases_in,
)
from scripts.watch_phrases import (
    PRICE_LINK_SESSIONS,
    WATCHES,
    TermState,
    build_states,
    comparability,
    observe,
    render,
)


def state(**over) -> TermState:
    base = dict(term="ai trade", docs=0, floor=3, tracked_days=0,
                tracked_velocity=None, tracked_covered_by=None)
    base.update(over)
    return TermState(**base)


class TestDocumentFloor:
    """Extracted from `daily_phrase_counts` so the watch cannot drift from it."""

    def test_the_absolute_count_binds_on_a_thin_day(self):
        # 109 docs -> ceil(1.09) = 2, so the absolute floor of 3 is the higher bar.
        assert document_floor(109) == 3

    def test_the_share_binds_once_the_corpus_is_large(self):
        # 912 docs -> ceil(9.12) = 10. Three documents in 912 is a coincidence.
        assert document_floor(912) == 10

    def test_the_crossover_is_at_three_hundred_documents(self):
        assert document_floor(299) == 3
        assert document_floor(301) == 4

    def test_an_empty_corpus_still_has_the_absolute_floor(self):
        assert document_floor(0) == 3


class TestObserve:
    def test_the_watch_counts_the_way_the_tracker_counts(self):
        """Document frequency via `phrases_in`, NOT substring matching.

        "AI trades higher" contains the substring "ai trade" and is not the phrase
        `ai trade` — the tokeniser emits `ai trades`, which folds nowhere near it.
        A regex-based watch would count it and report a narrative that is not there.
        """
        docs = [
            "Why India stock market is the inverse AI trade, according to Jefferies",
            "AI trades higher on no news whatsoever",
        ]
        counts, n_docs = observe(docs, ("ai trade",))
        assert n_docs == 2
        assert counts["ai trade"] == 1

    def test_a_document_is_counted_once_however_often_it_repeats_a_phrase(self):
        counts, _ = observe(["AI trade, AI trade, AI trade"], ("ai trade",))
        assert counts["ai trade"] == 1

    def test_a_document_yielding_no_phrase_is_not_in_the_denominator(self):
        """Matches `daily_phrase_counts`: the floor must come from the same n_docs."""
        _, n_docs = observe(["the and of", "AI hedge demand rises"], ("ai hedge",))
        assert n_docs == 1

    def test_a_term_absent_from_the_corpus_reads_zero_not_missing(self):
        counts, _ = observe(["Oil prices keep easing"], ("ai bubble",))
        assert counts["ai bubble"] == 0


class TestVerdict:
    def test_absent_and_below_floor_are_different_states(self):
        # ADR-0066's rule applied to a watch: a phrase nobody wrote and a phrase
        # written twice are not the same fact, and the shortlist for promotion
        # depends on telling them apart.
        assert state(docs=0).verdict == "absent"
        assert state(docs=2, floor=3).verdict == "below floor"

    def test_tracked_but_too_young_says_so_rather_than_claiming_a_velocity(self):
        s = state(tracked_days=MIN_DAYS_FOR_VELOCITY - 1)
        assert s.verdict == "tracked, no velocity yet"

    def test_measurable_is_not_yet_eligible_for_a_price_link(self):
        s = state(tracked_days=MIN_DAYS_FOR_VELOCITY, tracked_velocity=1.9)
        assert s.verdict == "measurable"
        assert "+1.90" in s.detail

    def test_eligibility_needs_the_full_price_link_window(self):
        assert state(tracked_days=PRICE_LINK_SESSIONS - 1).verdict == "measurable"
        assert state(tracked_days=PRICE_LINK_SESSIONS).verdict == "eligible for a price link"

    def test_a_tracked_phrase_names_what_watches_it(self):
        assert "watched by nothing" in state(tracked_days=9).detail
        assert "watched by AI Capex" in state(tracked_days=9, tracked_covered_by="AI Capex").detail


class TestComparability:
    """The watch's output is a ratio against a floor. If the denominator broke away
    from the board's, the ratios do not transfer and the report must say so."""

    def test_a_comparable_corpus_warns_about_nothing(self):
        assert comparability(120, 109) is None

    def test_a_corpus_an_order_of_magnitude_larger_is_flagged(self):
        warning = comparability(912, 109, "archive")
        assert warning is not None
        assert "8.4x" in warning
        assert "WITHHOLD" in warning

    def test_the_warning_names_only_the_corpus_it_measured(self):
        # It measured one corpus. Naming both would assert a break in a series it
        # never read -- the same over-claim the rest of this repo guards against.
        warning = comparability(912, 109, "archive")
        assert "archive" in warning
        assert "combined" not in warning

    def test_a_collapsed_corpus_is_flagged_too(self):
        # The break is symmetric: a fetch that returned a tenth of the usual moves
        # every share just as much as one that returned ten times.
        assert comparability(10, 109) is not None

    def test_the_limit_is_read_from_the_tracker_not_restated(self):
        just_inside = int(109 * MAX_CORPUS_SIZE_RATIO) - 1
        assert comparability(just_inside, 109) is None

    def test_no_board_history_is_not_a_break(self):
        assert comparability(500, None) is None
        assert comparability(500, 0) is None


class TestRender:
    def test_it_distinguishes_an_unnamed_narrative_from_an_absent_one(self):
        present = render(WATCHES[0], [state(term="ai trade", docs=1, floor=10)])
        assert "ARE in the corpus" in present

        nothing = render(WATCHES[0], [state(term="ai trade", docs=0)])
        assert "nothing in the corpus either" in nothing

    def test_a_tracked_term_suppresses_the_nothing_named_line(self):
        out = render(WATCHES[0], [state(term="ai trade", tracked_days=6, tracked_velocity=2.1)])
        assert "Nothing named" not in out


class TestWatchlist:
    @pytest.mark.parametrize("watch", WATCHES, ids=lambda w: w.name)
    def test_every_term_is_a_phrase_the_tokeniser_can_actually_emit(self, watch):
        """The trap this catches: a term written the way a person says it.

        "the AI trade" and "ai market hedge" can NEVER match, because "the" and
        "market" are removed before n-grams are built — so the watch would report
        `absent` forever on a narrative sitting in front of it. Round-tripping each
        term through `phrases_in` is the only check that cannot be fooled.
        """
        for term in watch.terms:
            assert term in phrases_in(term), (
                f"{term!r} is not a phrase `phrases_in` emits; it can never match"
            )

    def test_terms_are_unique_across_every_watch(self):
        seen = [t for w in WATCHES for t in w.terms]
        assert len(seen) == len(set(seen))

    def test_build_states_defaults_an_untracked_term_to_zero_days(self):
        states = build_states({"ai bubble": 1}, floor=10, tracked={})
        assert states[0].tracked_days == 0
        assert states[0].verdict == "below floor"
