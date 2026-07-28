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


# ── Unit contract: FRED gives PERCENT, the classifier is calibrated in BPS ────────
#
# yield_curve_slope (DGS10-DGS2) and hy_oas (BAMLH0A0HYM2) arrive from FRED in
# percent — 0.34, 2.77 — but every threshold and risk_appetite are in basis points.
# The callers (classify(), compute_edge_scores) convert; these pin why they must.
from regime_classifier import risk_appetite  # noqa: E402


class TestPercentVsBpsUnitContract:
    def test_curve_and_hy_signals_reachable_only_in_bps(self):
        # A -60bp inversion with 550bp HY is a recession signal — in basis points.
        assert _classify_cycle(-60, 550, None) == "recession"
        # The identical market handed over in PERCENT (-0.60, 5.5) reaches no
        # curve/HY rule; it lands "late" off real_rate=None fallthrough → "mid".
        assert _classify_cycle(-0.60, 5.5, None) == "mid"

    def test_hy_oas_scale_moves_risk_appetite_materially(self):
        # Live 2026-07-25 inputs. In bp (correct) vs percent (the pre-fix caller).
        correct = risk_appetite(18.58, 277.0, -1.93, 65.0)  # bp
        buggy = risk_appetite(18.58, 2.77, -1.93, 65.0)     # percent
        assert correct is not None and buggy is not None
        assert abs(correct - 0.43) < 0.02
        assert abs(buggy - 0.57) < 0.02
        assert buggy - correct > 0.10  # the bug stood the book risk-on


class _PerSeriesSupabase:
    """A fake returning a distinct latest value per series_id (unlike _FakeSupabase,
    which returns the same rows for every series), and a no-op upsert so classify()
    can persist. Lets us feed realistic FRED-percent inputs and assert conversion."""

    def __init__(self, values):
        self._values = values

    def table(self, _name):
        return _PerSeriesSupabase._Q(self._values)

    class _Q:
        def __init__(self, values):
            self._values = values
            self._series = None

        def select(self, *a, **k):
            return self

        def eq(self, col, val):
            if col == "series_id":
                self._series = val
            return self

        def lte(self, *a, **k):
            return self

        def order(self, *a, **k):
            return self

        def limit(self, *a, **k):
            return self

        def upsert(self, *a, **k):
            return self

        def execute(self):
            v = self._values.get(self._series)
            rows = [{"value": v, "trading_date": "2026-07-25"}] if v is not None else []
            return type("Resp", (), {"data": rows})()


class TestClassifyConvertsUnits:
    """classify() must convert its percent FRED inputs to bp before classifying;
    the discriminating case is a market that only reads 'recession' in bp."""

    def test_percent_inversion_and_hy_blowout_reach_recession(self, monkeypatch):
        import regime_classifier as rc

        # 10y 3.40, 2y 4.00 → slope -0.60% (-60bp); HY OAS 5.50% (550bp);
        # breakeven 1.75 → real rate 1.65%. In bp this is a recession; fed as
        # percent it lands 'late' (yc<0 & rr>1.0) — so this asserts the conversion.
        values = {
            "DGS10": 3.40, "DGS2": 4.00, "BAMLH0A0HYM2": 5.50,
            "T10YIE": 1.75, "^VIX": 30.0, "^VIX3M": 28.0,
        }
        # Takes as_of now: breadth is bounded by run_date like every other input,
        # so that a backfilled row cannot be stamped with today's reading.
        monkeypatch.setattr(rc, "_compute_spx_breadth", lambda as_of=None, hist=None: 30.0)
        clf = rc.RegimeClassifier.__new__(rc.RegimeClassifier)
        clf.supabase = _PerSeriesSupabase(values)

        out = clf.classify(run_date=date(2026, 7, 25))
        assert out.cycle == "recession"          # unreachable if fed percent
        assert out.yield_curve_slope == pytest.approx(-0.60)  # persisted in percent
        assert out.hy_oas == 5.50                # persisted in percent, for the UI


# ── ADR-0139 / ADR-0140: debasement pressure and Fed posture ──────────────────
from datetime import timedelta  # noqa: E402

from regime_classifier import (  # noqa: E402
    DEBASEMENT_MIN_COMOVEMENT_PAIRS,
    POSTURE_SIGN,
    classify_debasement,
    classify_fed_posture,
    _fetch_series_window,
    _value_at_or_before,
)

AS_OF = date(2026, 7, 24)
WINDOW_START = AS_OF - timedelta(weeks=26)


def _daily(start, values):
    """Consecutive daily observations from `start`."""
    return [(start + timedelta(days=i), v) for i, v in enumerate(values)]


class TestFetchSeriesWindow:
    ROWS = [
        {"value": 101.0, "trading_date": "2026-07-24"},
        {"value": 100.0, "trading_date": "2026-07-23"},
        {"value": 99.0, "trading_date": "2026-07-25"},   # newer than as_of
        {"value": None, "trading_date": "2026-07-22"},   # null dropped
        {"value": 90.0, "trading_date": "2025-01-01"},   # before window start
    ]

    def test_bounds_filters_and_sorts_ascending(self):
        sb = _FakeSupabase(self.ROWS)
        hist = _fetch_series_window(sb, "DX-Y.NYB", as_of=date(2026, 7, 24), days=182)
        assert hist == [(date(2026, 7, 23), 100.0), (date(2026, 7, 24), 101.0)]

    def test_value_at_or_before_takes_latest_not_newer(self):
        hist = [(date(2026, 7, 20), 1.0), (date(2026, 7, 23), 2.0), (date(2026, 7, 24), 3.0)]
        assert _value_at_or_before(hist, date(2026, 7, 23)) == 2.0
        assert _value_at_or_before(hist, date(2026, 7, 19)) is None


class TestDebasementComponents:
    def test_real_yield_anchor_is_minus_two_percent(self):
        # Stored FRED value is PERCENT: −2% arrives as −2.0 and maps to 1.0.
        # (An earlier ADR draft's formula put 1.0 at −4%; the ADR pins −2%.)
        for stored, expected in [(-2.0, 1.0), (0.0, 0.0), (-1.0, 0.5), (1.5, 0.0), (-3.5, 1.0)]:
            r = classify_debasement([(AS_OF, stored)], [], [], as_of=AS_OF)
            assert r.real_yield_comp == pytest.approx(expected)

    def test_real_yield_percent_units_do_not_saturate(self):
        # −1.85 IN PERCENT must land mid-range. Fed into a decimal anchor it
        # would pin at 1.0 forever — in bounds, invisible to a bounds test
        # (ADR-0137's unit lesson, the reason the shadow can't catch this).
        r = classify_debasement([(AS_OF, -1.85)], [], [], as_of=AS_OF)
        assert 0.0 < r.real_yield_comp < 1.0
        assert r.real_yield_comp == pytest.approx(0.925)

    def test_dxy_is_drawdown_from_peak_not_change(self):
        # Rises mid-window then returns to its start: change-vs-t−26w is 0,
        # but the drawdown from the 110 peak is ~9.1% → component pins at 1.0.
        vals = [100.0] * 30 + [110.0] * 30 + [100.0] * 30
        r = classify_debasement([], _daily(WINDOW_START, vals), [], as_of=AS_OF)
        assert r.dxy_decline_comp == pytest.approx(1.0)

    def test_dxy_at_peak_scores_zero(self):
        vals = [100.0 + i * 0.01 for i in range(60)]  # grinding higher
        r = classify_debasement([], _daily(WINDOW_START, vals), [], as_of=AS_OF)
        assert r.dxy_decline_comp == pytest.approx(0.0)

    def test_gold_return_needs_window_start_value(self):
        # History begins mid-window: no value at or before t−26w → None, and
        # the composite is None with it — absent is not zero (ADR-0091).
        late_start = WINDOW_START + timedelta(days=40)
        r = classify_debasement([], [], _daily(late_start, [3000.0] * 30), as_of=AS_OF)
        assert r.gold_rise_comp is None
        assert r.pressure is None

    def test_gold_twenty_percent_saturates(self):
        gold = [(WINDOW_START, 3000.0), (AS_OF, 3600.0)]
        r = classify_debasement([], [], gold, as_of=AS_OF)
        assert r.gold_rise_comp == pytest.approx(1.0)

    def test_comovement_needs_sixty_pairs(self):
        # n dates → n−1 pairs: build exactly one pair short of the floor.
        n = DEBASEMENT_MIN_COMOVEMENT_PAIRS
        ry_vals, gold_vals = [], []
        ry, gold = 0.0, 3000.0
        for i in range(n):
            ry_vals.append(ry)
            gold_vals.append(gold)
            step = 0.01 if i % 2 == 0 else 0.002
            ry -= step
            gold += step * 500
        r = classify_debasement(
            _daily(WINDOW_START, ry_vals), [], _daily(WINDOW_START, gold_vals), as_of=AS_OF)
        assert r.comovement_comp is None
        assert r.pressure is None

    def test_comovement_antiphase_saturates(self):
        # d_gold = −500 × d_ry exactly → corr −1 → clip(−(−1)/0.5) = 1.0.
        ry_vals, gold_vals = [], []
        ry, gold = 0.0, 3000.0
        for i in range(DEBASEMENT_MIN_COMOVEMENT_PAIRS + 1):
            ry_vals.append(ry)
            gold_vals.append(gold)
            step = 0.01 if i % 2 == 0 else 0.002
            ry -= step
            gold += step * 500
        r = classify_debasement(
            _daily(WINDOW_START, ry_vals), [], _daily(WINDOW_START, gold_vals), as_of=AS_OF)
        assert r.comovement_comp == pytest.approx(1.0)

    def test_composite_is_the_weighted_sum(self):
        n_days = (AS_OF - WINDOW_START).days + 1  # 183 daily observations
        ry_vals, gold_vals = [], []
        ry, gold = -0.2, 3000.0
        for i in range(n_days):
            ry_vals.append(ry)
            gold_vals.append(gold)
            step = 0.008 if i % 2 == 0 else 0.002
            ry -= step
            gold += step * 400
        dxy_vals = [100.0 - 2.0 * i / n_days for i in range(n_days)]

        r = classify_debasement(
            _daily(WINDOW_START, ry_vals),
            _daily(WINDOW_START, dxy_vals),
            _daily(WINDOW_START, gold_vals),
            as_of=AS_OF,
        )
        comps = (r.real_yield_comp, r.dxy_decline_comp, r.gold_rise_comp, r.comovement_comp)
        assert None not in comps
        expected = 30 * comps[0] + 25 * comps[1] + 25 * comps[2] + 20 * comps[3]
        assert r.pressure == pytest.approx(expected, abs=0.02)
        assert 0.0 <= r.pressure <= 100.0

    def test_missing_dxy_nulls_composite_but_not_other_comps(self):
        r = classify_debasement(
            [(AS_OF, -1.0)], [], [(WINDOW_START, 3000.0), (AS_OF, 3300.0)], as_of=AS_OF)
        assert r.real_yield_comp == pytest.approx(0.5)
        assert r.gold_rise_comp == pytest.approx(0.5)
        assert r.dxy_decline_comp is None
        assert r.pressure is None


POSTURE_THEN = AS_OF - timedelta(weeks=13)


def _ends(v_then, v_now):
    """A series observed at exactly the window's two ends."""
    return [(POSTURE_THEN, v_then), (AS_OF, v_now)]


class TestFedPosture:
    def test_active_hiking_is_hawkish_regardless_of_curve(self):
        # +50bp of DFF decides alone — even against a massively steepened
        # (dovish-leg) curve.
        r = classify_fed_posture(
            _ends(4.33, 4.83), _ends(4.0, 3.5), _ends(4.2, 4.4), as_of=AS_OF)
        assert r.posture == "hawkish"
        assert r.rate_change_13w_bps == pytest.approx(50.0)

    def test_active_cutting_is_dovish(self):
        r = classify_fed_posture(
            _ends(4.75, 4.25), _ends(4.0, 4.0), _ends(4.2, 4.2), as_of=AS_OF)
        assert r.posture == "dovish"

    def test_single_25bp_step_falls_through_to_curve(self):
        # 4.50 − 4.25 = exactly +25bp: strict > keeps the rate leg silent, and
        # the flat curve reads neutral — one step can be a mid-cycle adjustment.
        r = classify_fed_posture(
            _ends(4.25, 4.50), _ends(4.0, 4.0), _ends(4.2, 4.2), as_of=AS_OF)
        assert r.rate_change_13w_bps == pytest.approx(25.0)
        assert r.posture == "neutral"

    def test_steepening_reads_dovish(self):
        # THE sign fix (ADR-0140): DFF on hold, 2s10s steepened 38bp — the
        # market pricing cuts. The inverted draft mapping called this hawkish,
        # and with DFF inside the ±25bp band most days the curve leg decides
        # most days.
        r = classify_fed_posture(
            _ends(4.33, 4.33), _ends(4.00, 3.70), _ends(4.10, 4.18), as_of=AS_OF)
        assert r.curve_change_13w_bps == pytest.approx(38.0)
        assert r.posture == "dovish"

    def test_flattening_reads_hawkish(self):
        r = classify_fed_posture(
            _ends(4.33, 4.33), _ends(3.70, 4.00), _ends(4.18, 4.10), as_of=AS_OF)
        assert r.posture == "hawkish"

    def test_missing_any_input_nulls_posture_not_neutral(self):
        # DGS10 absent → no curve → posture None (never a default of neutral,
        # ADR-0091), while the provenance that IS computable survives.
        r = classify_fed_posture(
            _ends(4.33, 4.33), _ends(4.0, 4.0), [], as_of=AS_OF)
        assert r.posture is None
        assert r.rate_change_13w_bps is not None
        assert r.curve_steepness_bps is None

    def test_pivot_sign_convention(self):
        # Dovish is +1 (agrees with the page's directional ink), so the
        # textbook landing hawkish → dovish is +2 — written down because it is
        # the opposite of what a hawkish=+1 reader assumes.
        assert POSTURE_SIGN["dovish"] - POSTURE_SIGN["hawkish"] == 2
        assert POSTURE_SIGN["hawkish"] - POSTURE_SIGN["dovish"] == -2
        assert POSTURE_SIGN["neutral"] == 0
