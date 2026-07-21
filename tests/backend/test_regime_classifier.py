import pytest
import sys
sys.path.insert(0, "backend/services")
from regime_classifier import _classify_cycle, _classify_sentiment, RegimeOutput


class TestClassifyCycle:
    def test_recession_yc_inverted_hy_wide(self):
        """Deep inversion + wide credit = recession."""
        assert _classify_cycle(yield_curve_slope=-120, hy_oas=550, real_rate=None) == "recession"

    def test_recession_hy_very_wide(self):
        assert _classify_cycle(yield_curve_slope=-30, hy_oas=650, real_rate=None) == "recession"

    def test_early_cycle_steep_yc_low_real(self):
        """Steepening curve + low real rate = early cycle."""
        assert _classify_cycle(yield_curve_slope=90, hy_oas=300, real_rate=0.3) == "early"

    def test_late_cycle_inverted_sticky_real(self):
        """Inverted + restrictive real rate = late cycle."""
        assert _classify_cycle(yield_curve_slope=-20, hy_oas=380, real_rate=1.8) == "late"

    def test_late_cycle_restrictive_real_rate(self):
        """High real rate even with flat curve = late."""
        assert _classify_cycle(yield_curve_slope=20, hy_oas=300, real_rate=2.0) == "late"

    def test_mid_cycle_default(self):
        """Nothing dramatic = mid cycle."""
        assert _classify_cycle(yield_curve_slope=40, hy_oas=320, real_rate=0.8) == "mid"

    def test_missing_inputs_returns_mid(self):
        assert _classify_cycle(yield_curve_slope=None, hy_oas=None, real_rate=None) == "mid"


class TestClassifySentiment:
    def test_risk_off_high_vix(self):
        assert _classify_sentiment(vix_level=30, vix_term_diff=None, hy_oas=None, spx_breadth=None) == "risk-off"

    def test_risk_off_vix_plus_hy(self):
        assert _classify_sentiment(vix_level=22, vix_term_diff=2, hy_oas=450, spx_breadth=None) == "risk-off"

    def test_risk_off_backwardation(self):
        """VIX term > 5 = backwardation = stress."""
        assert _classify_sentiment(vix_level=20, vix_term_diff=7, hy_oas=None, spx_breadth=None) == "risk-off"

    def test_risk_off_low_breadth(self):
        assert _classify_sentiment(vix_level=18, vix_term_diff=-2, hy_oas=280, spx_breadth=30) == "risk-off"

    def test_risk_on_low_vix_tight_credit(self):
        assert _classify_sentiment(vix_level=13, vix_term_diff=-5, hy_oas=240, spx_breadth=70) == "risk-on"

    def test_risk_on_contango_low_vix(self):
        assert _classify_sentiment(vix_level=14, vix_term_diff=-4, hy_oas=None, spx_breadth=None) == "risk-on"

    def test_neutral_default(self):
        assert _classify_sentiment(vix_level=18, vix_term_diff=-1, hy_oas=310, spx_breadth=50) == "neutral"

    def test_missing_inputs_returns_neutral(self):
        assert _classify_sentiment(vix_level=None, vix_term_diff=None, hy_oas=None, spx_breadth=None) == "neutral"


class TestRegimeOutputDataclass:
    def test_creation(self):
        r = RegimeOutput(
            cycle="late",
            sentiment="neutral",
            yield_curve_slope=-15.0,
            hy_oas=360.0,
            vix_level=19.0,
            vix_term_diff=-1.5,
            real_rate=1.2,
            spx_breadth=52.0,
        )
        assert r.cycle == "late"
        assert r.sentiment == "neutral"
        assert r.hy_oas == 360.0
