"""
Unit tests for the L3 regime backfill (scripts/backfill_regime.py) and the
as-of bound it depends on.

The property under test is LOOK-AHEAD FREEDOM. A backfill is only worth having
if a row stamped 2025-11-14 was computed from what was knowable on 2025-11-14;
otherwise it is today's reading copied 250 times, which is worse than four
honest rows because it looks like history.

`_compute_spx_breadth` was the hole: every other input to `classify()` already
took `as_of` (with a comment explaining why), and breadth did not. These tests
pin the fix against a synthetic price series — no network, no database.
"""
import os
import sys
from datetime import date, timedelta

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.regime_classifier import MIN_UNIVERSE, SECTOR_ETFS, _compute_spx_breadth
from scripts.backfill_regime import MIN_INPUTS, classify_row


def _universe(members: dict[str, list[float]], end: date) -> pd.DataFrame:
    """Daily closes per ticker, oldest first, all the same length."""
    n = len(next(iter(members.values())))
    idx = pd.to_datetime([end - timedelta(days=n - 1 - i) for i in range(n)])
    return pd.DataFrame(members, index=idx)


def _flat_then(last: float, n_members: int, n_above: int, end: date) -> pd.DataFrame:
    """n_members tickers flat at 100 for 200 days; n_above of them close above."""
    members = {}
    for i in range(n_members):
        tail = last if i < n_above else 50.0
        members[f"T{i}"] = [100.0] * 200 + [tail]
    return _universe(members, end)


# ─── breadth is a SHARE, not a flag ─────────────────────────────────────────

def test_breadth_is_a_real_share_of_the_universe():
    end = date(2026, 7, 25)
    # 5 of 11 above → 45.45%, a value the old binary proxy could never produce
    # and one that sits BETWEEN the risk-off (<40) and risk-on (>60) thresholds,
    # so the VIX and credit rules get to decide instead.
    got = _compute_spx_breadth(hist=_flat_then(150.0, 11, 5, end))
    assert got == pytest.approx(45.45, abs=0.01)
    assert 40 <= got <= 60


def test_breadth_spans_the_full_range():
    end = date(2026, 7, 25)
    assert _compute_spx_breadth(hist=_flat_then(150.0, 11, 0, end)) == 0.0
    assert _compute_spx_breadth(hist=_flat_then(150.0, 11, 11, end)) == 100.0


def test_breadth_needs_two_hundred_observations():
    end = date(2026, 7, 25)
    short = _universe({t: [100.0] * 199 for t in SECTOR_ETFS}, end)
    assert _compute_spx_breadth(hist=short) is None


def test_breadth_refuses_a_denominator_that_moved():
    # Fewer members than MIN_UNIVERSE have a full window. A share computed over
    # whichever tickers happened to download is not comparable to yesterday's.
    end = date(2026, 7, 25)
    frame = _flat_then(150.0, MIN_UNIVERSE - 1, MIN_UNIVERSE - 1, end)
    assert _compute_spx_breadth(hist=frame) is None


def test_breadth_as_of_ignores_everything_after_that_date():
    # Members below their average for a stretch, then rocketing above it. Asked
    # "as of" the earlier date, the later rally must not exist — the whole point.
    end = date(2026, 7, 25)
    members = {f"T{i}": [100.0] * 200 + [50.0] * 5 + [400.0] * 5 for i in range(11)}
    hist = _universe(members, end)

    assert _compute_spx_breadth(hist=hist) == 100.0                     # today: the rally counts
    as_of = end - timedelta(days=5)
    assert _compute_spx_breadth(as_of=as_of, hist=hist) == 0.0          # then: it had not happened


def test_breadth_survives_an_empty_frame():
    assert _compute_spx_breadth(hist=pd.DataFrame()) is None


def test_universe_is_the_eleven_sector_spdrs():
    # Named and fixed on purpose: these existed on every date in the backfill
    # range, so a historical reading carries no survivorship bias — which using
    # today's 500 constituents backwards would.
    assert len(SECTOR_ETFS) == 11
    assert "XLK" in SECTOR_ETFS and "XLRE" in SECTOR_ETFS


# ─── the unit conversion the backfill must not skip ──────────────────────────

def test_classify_row_converts_percent_to_basis_points():
    # FRED reports the curve in PERCENT (-0.60 = -60bp) while the cycle rules are
    # calibrated in bp. An inverted curve has to reach the inversion rule; if the
    # conversion were skipped, -0.60 would never be < -50 and the rule would be
    # unreachable — the exact bug the classifier carries a scar comment about.
    inverted = {
        "yield_curve_slope": -0.60,
        "hy_oas": 5.50,
        "vix_level": 30.0,
        "vix_term_diff": 2.0,
        "real_rate": 2.4,
        "spx_breadth": 35.0,
    }
    cycle, sentiment = classify_row(inverted)
    assert cycle in {"late", "recession"}
    assert sentiment == "risk-off"


def test_classify_row_reads_a_benign_tape_as_risk_on():
    benign = {
        "yield_curve_slope": 0.34,
        "hy_oas": 2.77,
        "vix_level": 12.0,
        "vix_term_diff": -2.0,
        "real_rate": 2.45,
        "spx_breadth": 65.0,
    }
    cycle, sentiment = classify_row(benign)
    assert sentiment == "risk-on"
    assert cycle in {"early", "mid", "late", "recession"}


def test_classify_row_tolerates_missing_inputs():
    # Nullable by design: the classifier's own fields are `float | None`, and a
    # backfill hits dates where a FRED series had not posted yet.
    sparse = {k: None for k in ("yield_curve_slope", "hy_oas", "vix_level", "vix_term_diff", "real_rate", "spx_breadth")}
    cycle, sentiment = classify_row(sparse)
    assert isinstance(cycle, str) and isinstance(sentiment, str)


def test_minimum_inputs_guard_is_a_real_threshold():
    # The guard is what stops a date with almost no data being written with a
    # confident label. If someone lowers it to 0, a row driven entirely by
    # defaults becomes indistinguishable from a measured one.
    assert MIN_INPUTS >= 3


# ─── the fill mode: new columns only, chronological, update-never-upsert ─────
#
# Migrations 052/053 added the ADR-0139/0140 columns to rows the live runs had
# already PUBLISHED. The fill mode's whole contract is that it can change those
# twelve columns and nothing else — re-running classify() would restate the
# published cycle/sentiment, which is the exact thing --overwrite guards.

from scripts.backfill_regime import fill_crosscurrents  # noqa: E402


class _Resp:
    def __init__(self, data):
        self.data = data


class _FillQuery:
    def __init__(self, fake, name):
        self.fake = fake
        self.name = name
        self._eq = {}
        self._lte = {}
        self._update = None
        self._desc = False

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._eq[col] = val
        return self

    def lte(self, col, val):
        self._lte[col] = val
        return self

    def order(self, _col, desc=False):
        self._desc = desc
        return self

    def limit(self, _n):
        return self

    def update(self, cols):
        self._update = dict(cols)
        return self

    def upsert(self, *_a, **_k):
        raise AssertionError("fill-crosscurrents must never upsert — it cannot invent a date")

    def execute(self):
        if self._update is not None:
            rd = self._eq["run_date"]
            self.fake.updates.append((rd, self._update))
            # Reflect the write, so a later date's prior-posture read sees it —
            # the chronological dependency the mode exists to honour.
            for r in self.fake.regime_rows:
                if r["run_date"] == rd:
                    r.update(self._update)
            return _Resp([])
        if self.name == "macro_daily_history":
            sid = self._eq.get("series_id")
            rows = [{"value": v, "trading_date": t} for t, v in self.fake.series.get(sid, [])]
            if "trading_date" in self._lte:
                rows = [r for r in rows if r["trading_date"] <= self._lte["trading_date"]]
            rows.sort(key=lambda r: r["trading_date"], reverse=self._desc)
            return _Resp(rows)
        rows = [dict(r) for r in self.fake.regime_rows]
        if "run_date" in self._lte:
            rows = [r for r in rows if r["run_date"] <= self._lte["run_date"]]
        rows.sort(key=lambda r: r["run_date"], reverse=self._desc)
        return _Resp(rows)


class _FillFake:
    def __init__(self, regime_rows, series):
        self.regime_rows = regime_rows
        self.series = series
        self.updates = []

    def table(self, name):
        return _FillQuery(self, name)


def _fill_fixture():
    """Three published rows. 2026-01-02 steepened +20bps (→ dovish);
    2026-02-06 was already computed (evidence non-NULL) and must be skipped;
    2026-04-10 flattened −20bps (→ hawkish), and its t−13w cutoff (2026-01-09)
    reaches back to the 01-02 row — whose posture exists only because this
    same run wrote it moments earlier."""
    regime_rows = [
        {"run_date": "2026-01-02", "cycle": "late", "sentiment": "neutral",
         "fed_posture": None, "fed_posture_evidence": None},
        {"run_date": "2026-02-06", "cycle": "late", "sentiment": "neutral",
         "fed_posture": "neutral", "fed_posture_evidence": {"already": "computed"}},
        {"run_date": "2026-04-10", "cycle": "late", "sentiment": "neutral",
         "fed_posture": None, "fed_posture_evidence": None},
    ]
    flat_dff = [("2025-10-02", 4.33), ("2026-01-02", 4.33), ("2026-01-09", 4.33), ("2026-04-10", 4.33)]
    flat_2y = [("2025-10-02", 4.00), ("2026-01-02", 4.00), ("2026-01-09", 4.00), ("2026-04-10", 4.00)]
    tens = [("2025-10-02", 4.10), ("2026-01-02", 4.30), ("2026-01-09", 4.30), ("2026-04-10", 4.10)]
    return _FillFake(regime_rows, {"DFF": flat_dff, "DGS2": flat_2y, "DGS10": tens})


def test_fill_updates_only_new_columns_in_chronological_order():
    fake = _fill_fixture()
    assert fill_crosscurrents(fake, None, None, apply_=True, overwrite=False) == 0

    # Ascending, with the already-computed 02-06 row skipped.
    assert [rd for rd, _ in fake.updates] == ["2026-01-02", "2026-04-10"]

    d1 = fake.updates[0][1]
    d3 = fake.updates[1][1]
    # The published record is untouchable from this mode.
    for cols in (d1, d3):
        assert "cycle" not in cols and "sentiment" not in cols and "run_date" not in cols
        assert len(cols) == 12

    assert d1["fed_posture"] == "dovish"        # +20bps steepening, DFF flat
    assert d1["fed_pivot_delta"] is None        # nothing 13 weeks older exists
    assert d3["fed_posture"] == "hawkish"       # −20bps flattening
    assert d3["fed_pivot_delta"] == -2          # read 01-02's JUST-WRITTEN dovish
    # No gold/DXY/DFII10 history in the fixture → NULL, never zero (ADR-0091).
    assert d1["debasement_pressure"] is None


def test_fill_dry_run_writes_nothing():
    fake = _fill_fixture()
    assert fill_crosscurrents(fake, None, None, apply_=False, overwrite=False) == 0
    assert fake.updates == []
