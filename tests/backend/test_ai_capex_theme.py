"""AI Capex as a tradeable theme (ADR-0129).

The tracker could SEE the narrative; these pin the things that make it
tradeable, and the things that would silently un-trade it again.
"""
import pytest

from backend.services.book_metrics import ASSETS, SECTOR_MAP, GEO_MAP, MAX_SECTOR_WEIGHT
from backend.services.trade_ranker import ASSET_CLASS_MAP, classify, is_classified
from backend.data.brave_client import THEME_KEYWORDS, coverage_keywords
from backend.services.narrative_tracker import anchor_for_phrase

# The instrument map as migration 050 writes it.
AI_CAPEX_TICKERS = [
    "SMH", "NVDA", "TSM", "MSFT", "GOOGL", "VST", "XLU", "GEV", "VRT",
    "FCX", "JNK", "IEF", "UNG",
]
NEW_TICKERS = ["SMH", "NVDA", "TSM", "MSFT", "GOOGL", "VST", "XLU", "GEV", "VRT"]


class TestTaxonomy:
    def test_every_mapped_ticker_is_classified(self):
        """`is_classified` drops an unmapped ticker SILENTLY, so a name missing
        from the taxonomy shrinks the book rather than erroring. Migration 030
        recorded this as the thing to check before inserting."""
        unclassified = [t for t in AI_CAPEX_TICKERS if not is_classified(t)]
        assert unclassified == []

    def test_all_three_derived_maps_agree(self):
        # ADR-0125 made the three maps views of one record, so this cannot drift -
        # but ADR-0121 is what happens when it does, so the seam is asserted.
        for t in NEW_TICKERS:
            assert SECTOR_MAP[t] == ASSETS[t].sector
            assert GEO_MAP[t] == ASSETS[t].geo
            assert ASSET_CLASS_MAP[t] == ASSETS[t].asset_class

    def test_the_chain_is_not_one_sector(self):
        """A sector is what the 30% cap binds on. Filing semis, utilities and
        electrical plant together would let the book hold three legs of the same
        chain and call it diversified, while a real AI-capex drawdown hits all
        three at once."""
        sectors = {SECTOR_MAP[t] for t in NEW_TICKERS}
        assert {"Semiconductors", "Utilities", "Electrical Equipment"} <= sectors

    def test_the_spenders_share_a_cap_with_qqq(self):
        """MSFT and GOOGL are 40%+ of QQQ. A separate bucket would double the
        effective cap on one exposure."""
        assert SECTOR_MAP["MSFT"] == SECTOR_MAP["GOOGL"] == SECTOR_MAP["QQQ"]

    def test_taiwan_is_its_own_geo(self):
        """The single manufacturing concentration in the theme. Hidden inside EM
        it would net against Brazil and China, and the geo cap is the only thing
        that can express it."""
        assert GEO_MAP["TSM"] == "Taiwan"
        assert GEO_MAP["TSM"] not in {GEO_MAP["EEM"], GEO_MAP["FXI"]}

    def test_a_new_sector_cannot_exceed_the_cap_alone(self):
        # Sanity on the cap itself: three new sectors are only useful if the cap
        # is below 100%.
        assert 0 < MAX_SECTOR_WEIGHT < 1.0


class TestCrossAssetExpression:
    def test_the_theme_spans_four_asset_classes(self):
        """Since ADR-0127 the correlation sub-score is the mean over MEASURED
        asset classes, so an equity-only theme can score at most its equity leg.
        More to the point: an equity-only map cannot express the transmission
        that makes AI capex a market theme rather than a sector call."""
        classes = {classify(t)["asset_class"] for t in AI_CAPEX_TICKERS}
        assert classes == {"equity", "credit", "rates", "commodity"}

    def test_the_credit_leg_is_where_the_evidence_came_from(self):
        """Both live headlines mentioning AI were credit stories. A map without a
        credit leg would omit the only transmission this system has evidence of."""
        assert classify("JNK")["asset_class"] == "credit"

    def test_reused_tickers_are_not_duplicated_in_the_taxonomy(self):
        # FCX/JNK/IEF/UNG belong to other themes too. A theme is a view, not an
        # owner (migration 030), so they must be re-used rather than re-declared.
        for t in ("FCX", "JNK", "IEF", "UNG"):
            assert t in ASSETS


class TestNarrativeAttribution:
    def test_the_theme_now_claims_its_own_narrative(self):
        """The system working end to end: the tracker flagged `ai capex cycle` as
        watched by nothing, a theme was created for it, and the same phrase is
        now attributed to that theme instead of appearing on the shortlist."""
        assert anchor_for_phrase("ai capex cycle", coverage_keywords()) == "AI Capex"
        assert anchor_for_phrase("nvidia", coverage_keywords()) == "AI Capex"
        assert anchor_for_phrase("data center", coverage_keywords()) == "AI Capex"

    def test_the_theme_has_search_keywords_so_news_is_actually_collected(self):
        """A theme row without keywords collects nothing: `fetch_news_for_theme`
        falls back to querying the theme NAME, which returns little. Without this
        the theme would score a HypeScore of zero forever."""
        assert "AI Capex" in THEME_KEYWORDS
        assert len(THEME_KEYWORDS["AI Capex"]) >= 3

    def test_only_the_first_three_keywords_reach_the_query(self):
        """`fetch_news_for_theme` uses keywords[:3], so keyword ORDER decides what
        is actually fetched. The buildout phrases must lead, or the corpus fills
        with consumer-AI coverage."""
        assert THEME_KEYWORDS["AI Capex"][:3] == [
            "AI capex", "data center", "AI infrastructure",
        ]

    def test_aliases_do_not_swallow_a_genuinely_new_narrative(self):
        """Regression: adding "ai" as an alias must not start claiming unrelated
        narratives that merely contain those letters as a token elsewhere."""
        cov = coverage_keywords()
        assert anchor_for_phrase("dollar debasement", cov) is None
        assert anchor_for_phrase("quantum computing breakthrough", cov) != "AI Capex"
