import pytest
import sys
from datetime import date
sys.path.insert(0, "backend/services")
from regime_classifier import (
    _classify_cycle,
    _classify_sentiment,
    _fetch_latest_series,
    RegimeOutput,
)


class _FakeQuery:
    """Records the filters applied so a test can assert on the as-of bound."""

    def __init__(self, rows, recorder):
        self._rows = rows
        self._recorder = recorder

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._recorder.setdefault("eq", []).append((col, val))
        return self

    def lte(self, col, val):
        self._recorder.setdefault("lte", []).append((col, val))
        return self

    def order(self, col, desc=False):
        self._recorder["order"] = (col, desc)
        return self

    def limit(self, n):
        self._recorder["limit"] = n
        return self

    def execute(self):
        rows = self._rows
        # Honour the as-of bound the way PostgREST would.
        for col, val in self._recorder.get("lte", []):
            rows = [r for r in rows if r[col] <= val]
        return type("Resp", (), {"data": rows})()


class _FakeSupabase:
    def __init__(self, rows):
        self._rows = rows
        self.recorder: dict = {}

    def table(self, name):
        self.recorder["table"] = name
        return _FakeQuery(self._rows, self.recorder)


class TestFetchLatestSeriesAsOf:
    """`classify(run_date)` stamps its output with run_date, so its inputs must
    be bounded by that date. Reading the newest available row regardless of
    run_date is look-ahead bias: backfilling a past date would classify it
    using data that did not exist yet."""

    ROWS = [
        {"value": 17.05, "trading_date": "2026-07-22"},
        {"value": 18.50, "trading_date": "2026-07-21"},
        {"value": 19.10, "trading_date": "2026-07-20"},
    ]

    def test_bounds_series_by_as_of_date(self):
        sb = _FakeSupabase(self.ROWS)
        got = _fetch_latest_series(sb, "^VIX", as_of=date(2026, 7, 21))
        assert got == 18.50, "must not see the 2026-07-22 observation"

    def test_applies_lte_filter_on_trading_date(self):
        sb = _FakeSupabase(self.ROWS)
        _fetch_latest_series(sb, "^VIX", as_of=date(2026, 7, 21))
        assert ("trading_date", "2026-07-21") in sb.recorder.get("lte", [])

    def test_without_as_of_returns_newest(self):
        sb = _FakeSupabase(self.ROWS)
        assert _fetch_latest_series(sb, "^VIX") == 17.05

    def test_skips_null_values_within_bound(self):
        rows = [
            {"value": None, "trading_date": "2026-07-21"},
            {"value": 19.10, "trading_date": "2026-07-20"},
        ]
        sb = _FakeSupabase(rows)
        assert _fetch_latest_series(sb, "^VIX", as_of=date(2026, 7, 21)) == 19.10


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
