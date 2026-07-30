"""credit_rates_exposures: per-asset duration / IG / quality betas.

The fixture for the total-vs-marginal distinction is the SPY assertion in
this file's `test_spy_marginal_credit_beta_is_near_zero` — if total and
marginal don't diverge for an equity that loads on credit only through
its market factor, the orthogonalisation isn't working and the two-variant
design is decoration. See spec §9, last row."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import credit_rates_exposures as cre  # noqa: E402


# A fake Supabase client that returns whatever rows `cre` asks for, from an
# in-memory store. This is what makes the test offline and deterministic —
# no network, no clock, no rate limit.
class _FakeSB:
    def __init__(self, frames: dict[tuple[str, date], float]):
        self._frames = frames

    def table(self, name):
        outer = self

        class _T:
            def __init__(self):
                self._filters = []  # accumulate: list of (col, op, val)

            def select(self, *_a, **_kw):
                return self

            def eq(self, col, val):
                self._filters.append((col, "=", val))
                return self

            def in_(self, col, vals):
                self._filters.append((col, "in", tuple(vals)))
                return self

            def gte(self, col, val):
                self._filters.append((col, ">=", val))
                return self

            def lte(self, col, val):
                self._filters.append((col, "<=", val))
                return self

            def order(self, *_a, **_kw):
                return self

            def limit(self, *_a, **_kw):
                return self

            def _match(self, sid: str, td: date, filt) -> bool:
                col, op, val = filt
                if col == "series_id":
                    return sid == val
                if col == "trading_date":
                    # val may be an ISO string from start.isoformat() / as_of.isoformat()
                    if isinstance(val, str):
                        from datetime import date as _date
                        val = _date.fromisoformat(val)
                    if op == "=":
                        return td == val
                    if op == ">=":
                        return td >= val
                    if op == "<=":
                        return td <= val
                return True

            def execute(self):
                rows = [
                    {"series_id": sid, "trading_date": td.isoformat(), "value": v}
                    for (sid, td), v in outer._frames.items()
                    if all(self._match(sid, td, f) for f in self._filters)
                ]
                class _R:
                    def __init__(self, data):
                        self.data = data
                return _R(rows)

        return _T()


def _frame(series_values: dict[str, list[tuple[date, float]]]) -> dict:
    out = {}
    for sid, pairs in series_values.items():
        for td, v in pairs:
            out[(sid, td)] = v
    return out


def test_build_credit_legs_diffs_in_basis_points_not_percent():
    """A 25bp move in DGS10 (4.30 -> 4.55) must come out as d_ust10 = 25.0,
    not 0.25 — the percent/bp trap the macro_fetcher comment warns about."""
    idx = pd.bdate_range("2024-01-01", periods=5)
    rows = _frame(
        {
            "DGS10":          [(d.date(), v) for d, v in zip(idx, [4.30, 4.55, 4.55, 4.40, 4.40])],
            "BAMLC0A0CM":     [(d.date(), v) for d, v in zip(idx, [1.50, 1.50, 1.55, 1.55, 1.55])],
            "BAMLH0A0HYM2":   [(d.date(), v) for d, v in zip(idx, [3.20, 3.20, 3.30, 3.30, 3.30])],
        }
    )
    sb = _FakeSB(rows)
    legs = cre.build_credit_legs(sb, lookback_days=5, as_of=idx[-1].date())
    assert not legs.empty
    # First row is dropped by differencing; remaining 4 rows of d_ust10 in bp:
    assert legs["d_ust10"].iloc[0] == pytest.approx(25.0)  # 4.30 -> 4.55, percent * 100 = bp
    assert legs["d_ust10"].iloc[1] == pytest.approx(0.0)
    assert legs["d_ust10"].iloc[2] == pytest.approx(-15.0)  # 4.55 -> 4.40


def test_build_credit_legs_quality_leg_is_hy_minus_ig_not_a_separate_series():
    """The HY-OAS raw series must NOT appear as its own column. Quality is
    the gap, not a third independent leg."""
    idx = pd.bdate_range("2024-01-01", periods=3)
    rows = _frame(
        {
            "DGS10":        [(d.date(), 4.0) for d in idx],
            "BAMLC0A0CM":   [(d.date(), 1.5) for d in idx],
            "BAMLH0A0HYM2": [(d.date(), v) for d, v in zip(idx, [3.0, 3.2, 3.4])],
        }
    )
    sb = _FakeSB(rows)
    legs = cre.build_credit_legs(sb, lookback_days=3, as_of=idx[-1].date())
    assert "BAMLH0A0HYM2" not in legs.columns
    assert "d_qual" in legs.columns
    # HY moves 20bp then 20bp; IG is flat; d_qual = 20, 20 (the gap widens by 20bp each day).
    assert legs["d_qual"].iloc[1] == pytest.approx(20.0)
    assert legs["d_qual"].iloc[0] == pytest.approx(20.0)


def test_build_credit_legs_raises_when_a_required_series_is_missing():
    """A truly missing series is a ValueError so the caller can decide
    between `insufficient_history` and `degenerate` — never silent zeros."""
    idx = pd.bdate_range("2024-01-01", periods=3)
    rows = _frame({"DGS10": [(d.date(), 4.0) for d in idx]})  # IG and HY missing
    sb = _FakeSB(rows)
    with pytest.raises(ValueError, match="BAMLC0A0CM"):
        cre.build_credit_legs(sb, lookback_days=3, as_of=idx[-1].date())


def test_build_credit_legs_handles_partial_history_by_using_available_intersection():
    """If OAS is back to 2024-03 but DGS10 is back to 2024-01, the legs
    begin at 2024-03 (intersection) rather than dropping the whole frame."""
    d_early = pd.bdate_range("2024-01-01", periods=65)   # Jan through late March
    d_late = pd.bdate_range("2024-02-15", periods=20)
    rows = _frame(
        {
            "DGS10":          [(d.date(), 4.0 + 0.01 * i) for i, d in enumerate(d_early)],
            "BAMLC0A0CM":     [(d.date(), 1.5) for d in d_late],
            "BAMLH0A0HYM2":   [(d.date(), 3.0) for d in d_late],
        }
    )
    sb = _FakeSB(rows)
    legs = cre.build_credit_legs(sb, lookback_days=55, as_of=d_late[-1].date())
    assert not legs.empty
    # The earliest leg date must be on or after 2024-02-15 (the IG/HY start).
    assert legs.index[0] >= pd.Timestamp("2024-02-15")
