"""A thesis must not assert a position the book does not hold (ADR-0135).

Both fixtures are verbatim from the live 2026-07-28 book.
"""
from backend.services.thesis_positions import (
    audit_book,
    find_position_claims,
    unheld_claims,
)

UNIVERSE = {"NVDA", "MSFT", "GOOGL", "SMH", "TSM", "XLU", "IEF", "JNK",
            "GLD", "SLV", "IAU", "NEM", "GDX", "VRT", "GEV", "SPY"}

# The defect, verbatim.
VRT_THESIS = (
    "Vertiv is the picks-and-shovels beneficiary of hyperscaler power demand "
    "with the highest market beta in the long book (Mkt +2.08, R2 0.30). "
    "AI Capex hype at 53.6 and SPX breadth at 81.82% support continued risk-on "
    "rotation into data-center electrical infrastructure; the long VRT / short "
    "MSFT structure below isolates the capex-deployment vs capex-monetization gap."
)

# Correct prose from the same run, which must NOT be flagged.
GDX_THESIS = (
    "Gold Miners (GDX) face headwinds at overextended gold levels (GC=F $4045.20) "
    "with real yields at 2.43% (DFII10) and a risk-on regime. GDX is the strongest "
    "expression of the gold-short trade from the {GDX, GLD, IAU, NEM, SLV} cluster, "
    "with RMW -1.19 (low-quality) amplifying the downside."
)

HELD = {"BABA", "GDX", "GEV", "JPM", "NUE", "PDD", "UNG", "VRT", "XLE"}


class TestTheLiveDefect:
    def test_it_catches_the_short_msft_that_is_not_in_the_book(self):
        claims = unheld_claims(VRT_THESIS, HELD, UNIVERSE, self_asset="VRT")
        assert [c.ticker for c in claims] == ["MSFT"]

    def test_it_reports_the_phrase_as_evidence_not_just_a_verdict(self):
        claims = unheld_claims(VRT_THESIS, HELD, UNIVERSE, self_asset="VRT")
        assert "MSFT" in claims[0].phrase
        assert claims[0].phrase.lower().startswith("short")

    def test_a_picks_own_asset_is_never_flagged(self):
        """"long VRT" in VRT's own thesis is the one claim guaranteed true."""
        claims = unheld_claims(VRT_THESIS, HELD, UNIVERSE, self_asset="VRT")
        assert all(c.ticker != "VRT" for c in claims)


class TestComparisonIsNotAClaim:
    def test_a_cluster_listing_is_not_a_set_of_positions(self):
        """GDX naming its correlation complex is ADR-0116 being EXPLAINED. A
        check that flagged it would fire constantly on correct prose."""
        assert unheld_claims(GDX_THESIS, HELD, UNIVERSE, self_asset="GDX") == []

    def test_a_bare_mention_is_not_a_claim(self):
        assert find_position_claims("Gold at record levels supports GLD demand", UNIVERSE) == []

    def test_preference_language_is_not_a_claim(self):
        assert unheld_claims(
            "We prefer GDX to GLD on operating leverage.", HELD, UNIVERSE, self_asset="GDX"
        ) == []


class TestDetection:
    def test_direction_before_the_ticker(self):
        for phrase in ["long NVDA", "short NVDA", "overweight NVDA", "underweight NVDA"]:
            assert find_position_claims(f"We are {phrase} here.", UNIVERSE)

    def test_position_noun_after_the_ticker(self):
        for phrase in ["NVDA leg", "NVDA position", "NVDA hedge", "NVDA overlay"]:
            assert find_position_claims(f"The {phrase} carries the risk.", UNIVERSE)

    def test_matching_is_whole_word(self):
        # "SMHX" must not match SMH.
        assert find_position_claims("long SMHX exposure", UNIVERSE) == []

    def test_case_insensitive(self):
        assert find_position_claims("Long Msft into the print", UNIVERSE)

    def test_a_held_asset_is_not_flagged(self):
        assert unheld_claims("paired against the short PDD leg", HELD, UNIVERSE) == []


class TestAuditBook:
    def test_the_live_book_produces_exactly_one_finding(self):
        picks = [
            {"asset": "VRT", "thesis": VRT_THESIS},
            {"asset": "GDX", "thesis": GDX_THESIS},
            {"asset": "GEV", "thesis": "GE Vernova is independent of VRT per pool depth."},
        ]
        found = audit_book(picks, UNIVERSE)
        assert len(found) == 1
        assert found[0]["asset"] == "VRT"
        assert found[0]["references"] == "MSFT"

    def test_a_clean_book_returns_empty(self):
        """Empty is the result this exists to establish, not an absence of
        checking."""
        picks = [
            {"asset": "GDX", "thesis": GDX_THESIS},
            {"asset": "VRT", "thesis": "Vertiv benefits from data-center power demand."},
        ]
        assert audit_book(picks, UNIVERSE) == []

    def test_a_pick_with_no_thesis_does_not_crash(self):
        assert audit_book([{"asset": "VRT"}, {"asset": "GEV", "thesis": None}], UNIVERSE) == []


class TestApplyCaveats:
    """The behaviour `verify_citations` calls. Tested here rather than through
    that function so a defect being CAUGHT does not depend on constructing a
    passing citation set for an unrelated guardrail."""

    def _book(self):
        return [
            {"asset": "VRT", "direction": "long", "thesis": VRT_THESIS},
            {"asset": "GDX", "direction": "short", "thesis": GDX_THESIS},
        ]

    def test_it_caveats_the_pick_that_over_claims(self):
        from backend.services.thesis_positions import apply_caveats
        picks = self._book()
        apply_caveats(picks, UNIVERSE)
        by_asset = {p["asset"]: p for p in picks}
        assert "MSFT" in by_asset["VRT"]["thesis_caveat"]
        assert "does not hold" in by_asset["VRT"]["thesis_caveat"]

    def test_correct_prose_is_left_untouched(self):
        """No empty key -- an absent `thesis_caveat` must mean "nothing
        over-claimed", not "not checked"."""
        from backend.services.thesis_positions import apply_caveats
        picks = self._book()
        apply_caveats(picks, UNIVERSE)
        assert "thesis_caveat" not in {p["asset"]: p for p in picks}["GDX"]

    def test_the_caveat_says_the_figures_are_still_verified(self):
        """The numbers in that sentence are all correct. A caveat implying
        otherwise would overstate the defect."""
        from backend.services.thesis_positions import apply_caveats
        picks = self._book()
        apply_caveats(picks, UNIVERSE)
        assert "figures themselves are verified" in picks[0]["thesis_caveat"]

    def test_a_clean_book_returns_no_findings(self):
        from backend.services.thesis_positions import apply_caveats
        picks = [{"asset": "GDX", "direction": "short", "thesis": GDX_THESIS}]
        assert apply_caveats(picks, UNIVERSE) == []


class TestWiredIntoVerifyCitations:
    """The check must RUN, not merely exist (the ADR-0124 / ADR-0130 lesson)."""

    def test_verify_citations_calls_the_audit(self):
        import inspect
        from backend.services import q1_agent
        src = inspect.getsource(q1_agent.verify_citations)
        assert "apply_caveats" in src, "the audit is defined but never called"

    def test_a_failure_in_the_audit_cannot_cost_a_verified_book(self):
        """Advisory checks must not be able to reject a book whose numbers are
        sound. The call site is wrapped, and this asserts the wrapper exists."""
        import inspect
        from backend.services import q1_agent
        src = inspect.getsource(q1_agent.verify_citations)
        idx = src.index("apply_caveats")
        assert "try:" in src[:idx], "the advisory audit is not inside a try block"
