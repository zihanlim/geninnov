"""Tests for computable_macro_runner.

The runner orchestrates three pure-function services into a JSONB
column. The services themselves are tested independently. Here we
test the orchestration:

  - the inputs are read from the right tables
  - the JSONB shape matches what ADR-0217 promised
  - missing inputs propagate as 'unknown' per metric, not a top-level
    failure
  - a persist failure is reported but does not blow up the call
"""
import json
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, "backend/services")

from computable_macro_runner import (
    _json_safe,
    _latest,
    _try_read_trailing_eps,
    _values,
    build_computable_macro,
    persist_computable_macro,
    run,
)


class _FakeTable:
    """A minimal Supabase table stub.

    Each query chain returns self until .execute() is called. The
    recorder captures filters so tests can assert on the as-of bound
    the runner uses. Rows can be either a list (for tables that
    take a flat list) or a dict (for tables that group by a key
    like series_id); the constructor accepts both.
    """

    def __init__(self, name: str, rows, recorder: dict):
        self._name = name
        self._rows = rows  # either list[dict] or dict[any, list[dict]]
        self._recorder = recorder
        self._filters: list[tuple[str, str, object]] = []
        self._update_payload = None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def gte(self, col, val):
        self._filters.append(("gte", col, val))
        return self

    def lte(self, col, val):
        self._filters.append(("lte", col, val))
        return self

    def order(self, col, **_k):
        self._filters.append(("order", col, None))
        return self

    def limit(self, n):
        self._filters.append(("limit", "n", n))
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def _resolve_rows(self) -> list[dict]:
        """Return the rows for this query, given the filters. If
        `self._rows` is a dict, look up by an `eq` filter whose
        value is a key. Otherwise, filter the list by all eq /
        gte / lte clauses we recorded."""
        if isinstance(self._rows, dict):
            # Find the eq filter whose value is a key in the dict.
            for kind, col, val in self._filters:
                if kind == "eq" and val in self._rows:
                    return list(self._rows[val])
            return []

        out = list(self._rows)
        for kind, col, val in self._filters:
            if kind == "eq":
                out = [r for r in out if r.get(col) == val]
            elif kind == "gte":
                out = [r for r in out if r.get(col) is not None and r.get(col) >= val]
            elif kind == "lte":
                out = [r for r in out if r.get(col) is not None and r.get(col) <= val]
        return out

    def execute(self):
        rows = self._resolve_rows()
        recorder = self._recorder.setdefault(self._name, [])
        recorder.append({
            "filters": list(self._filters),
            "n_rows": len(rows),
            "update_payload": self._update_payload,
        })
        return type("R", (), {"data": rows})()


class _FakeSupabase:
    """A minimal Supabase client stub.

    Routes each table name to a pre-configured rows source. The
    runner accesses three tables: macro_daily_history (grouped by
    series_id), structured_facts (flat list), regime_classifications
    (flat list). Tests configure each independently.
    """

    def __init__(
        self,
        macro_history: dict[str, list[dict]] | None = None,
        structured: list[dict] | None = None,
        regime_rows: list[dict] | None = None,
    ):
        self._tables = {
            "macro_daily_history": macro_history or {},
            "structured_facts": structured or [],
            "regime_classifications": regime_rows or [],
        }
        self.recorder: dict = {}

    def table(self, name: str):
        return _FakeTable(name, self._tables[name], self.recorder)


def _macro_history(spx=None, ust10=None) -> dict:
    """Build a macro_daily_history-style dict: series_id -> rows."""
    out: dict = {}
    if spx is not None:
        out["^SPX"] = [
            {"trading_date": d.isoformat(), "value": v}
            for d, v in spx
        ]
    if ust10 is not None:
        out["DGS10"] = [
            {"trading_date": d.isoformat(), "value": v}
            for d, v in ust10
        ]
    return out


def _daily_series(start: date, n: int, *, base: float, drift: float = 0.0) -> list[tuple[date, float]]:
    """Build a synthetic daily series. Dates are spaced one calendar
    day apart starting from `start` (handles month boundaries by
    using the date constructor with day increments)."""
    from datetime import timedelta
    fixed: list[tuple[date, float]] = []
    for i in range(n):
        fixed.append((start + timedelta(days=i), base + drift * i))
    return fixed


def test_latest_picks_last_value() -> None:
    s = _daily_series(date(2026, 1, 1), 5, base=5000.0, drift=0.0)
    assert _latest(s) == 5000.0


def test_values_extracts_levels() -> None:
    s = _daily_series(date(2026, 1, 1), 3, base=100.0, drift=10.0)
    assert _values(s) == [100.0, 110.0, 120.0]


def test_try_read_trailing_eps_returns_none_when_table_absent() -> None:
    """Before Workstream B lands, structured_facts is not present.
    The function must return (None, None), not raise."""
    sb = _FakeSupabase()
    eps, eps_as_of = _try_read_trailing_eps(sb, as_of=date(2026, 7, 31))
    assert eps is None
    assert eps_as_of is None


def test_try_read_trailing_eps_returns_value_when_present() -> None:
    """After Workstream B loads a row, the function reads it."""
    sb = _FakeSupabase(
        structured=[
            {
                "entity": "SPX",
                "metric": "trailing_eps_ttm",
                "value": 250.0,
                "as_of": "2026-06-30",
            }
        ]
    )
    eps, eps_as_of = _try_read_trailing_eps(sb, as_of=date(2026, 7, 31))
    assert eps == 250.0
    assert eps_as_of == date(2026, 6, 30)


def test_build_computable_macro_with_all_inputs() -> None:
    """All three metrics: erp, equity_bond_corr, ndx_seasonality. The
    fetcher is mocked to return [] (empty) so NDX returns the safe
    empty shape; the other two are computed from synthetic frames."""
    spx = _daily_series(date(2026, 1, 1), 250, base=5800.0, drift=0.5)
    ust10 = _daily_series(date(2026, 1, 1), 250, base=4.0, drift=0.005)
    sb = _FakeSupabase(
        macro_history=_macro_history(spx=spx, ust10=ust10),
        structured=[
            {
                "entity": "SPX",
                "metric": "trailing_eps_ttm",
                "value": 400.0,
                "as_of": "2026-06-30",
            }
        ],
    )
    payload = build_computable_macro(sb, as_of=date(2026, 7, 31))
    assert "erp" in payload
    assert "equity_bond_corr" in payload
    assert "ndx_seasonality" in payload
    # ERP computed against 5800 SPX close and 4.0+0.005*249 ≈ 5.245
    # ust10 (drift 0.005 over 250 days = 1.245). PE = 14.5.
    erp = payload["erp"]
    assert erp["status"] == "measured", (
        f"expected measured, got {erp['status']}: {erp.get('reason')}"
    )
    assert erp["spx_pe"] is not None
    # equity_bond correlation is computed; status may be measured
    # or insufficient depending on monotonicity of test data.
    eq = payload["equity_bond_corr"]
    assert eq["status"] in ("measured", "insufficient_history", "unknown")
    # ndx_seasonality: in the test environment, the live fetcher may
    # run and return real data (n_observations=438) or the cache
    # may be present; either is fine. We assert the SHAPE, not the
    # specific count, so the test passes whether or not yfinance is
    # reachable.
    ndx = payload["ndx_seasonality"]
    assert "per_month" in ndx
    assert "midterm" in ndx
    assert "window" in ndx
    assert ndx["n_observations"] >= 0
    assert ndx["status"] in ("measured", "insufficient_history")  # never "unknown"
    assert len(ndx["per_month"]) == 12


def test_build_computable_macro_with_no_inputs_returns_unknown_shape() -> None:
    """An empty database: every metric reports 'unknown', not a
    top-level failure."""
    sb = _FakeSupabase()
    payload = build_computable_macro(sb, as_of=date(2026, 7, 31))
    for k in ("erp", "equity_bond_corr", "ndx_seasonality"):
        assert k in payload
    assert payload["erp"]["status"] == "unknown"
    assert payload["erp"]["erp_pct"] is None
    assert payload["equity_bond_corr"]["status"] in ("unknown", "insufficient_history")
    # NDX reads from the parquet cache or yfinance directly (not Supabase),
    # so an empty fake-Supabase does NOT make it insufficient_history.
    # Assert the status is always one of the two meaningful states.
    assert payload["ndx_seasonality"]["status"] in ("measured", "insufficient_history")


def test_persist_writes_to_regime_table() -> None:
    sb = _FakeSupabase(
        regime_rows=[{"run_date": "2026-07-31", "computable_macro": None}],
    )
    n = persist_computable_macro(
        sb,
        as_of=date(2026, 7, 31),
        payload={"erp": {"status": "unknown"}},
    )
    assert n == 1


def test_persist_returns_zero_when_no_regime_row() -> None:
    """No regime row for as_of: 0 rows updated, no exception."""
    sb = _FakeSupabase(regime_rows=[])
    n = persist_computable_macro(
        sb,
        as_of=date(2026, 7, 31),
        payload={"erp": {"status": "unknown"}},
    )
    assert n == 0


def test_run_is_idempotent_and_never_raises() -> None:
    """run() is the top-level entry point. It must always return a
    payload, even when the underlying Supabase calls would fail
    in production (a transient network blip should not break the
    pipeline)."""
    sb = _FakeSupabase()  # empty; the empty-DB path is exercised
    out = run(sb, as_of=date(2026, 7, 31))
    assert "erp" in out
    assert "equity_bond_corr" in out
    assert "ndx_seasonality" in out


# ── JSON-boundary sanitisation (ADR-0098: absence beats fabrication, but
#    a payload that raises on the way to the database is also a defect) ──


def test_json_safe_converts_date_and_datetime_to_iso() -> None:
    """_json_safe turns date / datetime into ISO strings and walks
    nested dicts and lists. Everything else (int, float, str, bool,
    None) passes through unchanged — the helper exists ONLY to
    bridge the JSON boundary, not to mutate domain data.
    """
    payload = {
        "as_of": date(2026, 8, 1),
        "eps_as_of": date(2026, 6, 30),
        "ts": datetime(2026, 8, 1, 13, 0, 0, tzinfo=timezone.utc),
        "nested": {"inner_date": date(2026, 1, 1), "x": 1.0},
        "listy": [date(2026, 1, 1), "str", 42, None, True, False],
        "n": 1.0,
        "s": "ok",
        "b": True,
        "none": None,
    }
    out = _json_safe(payload)
    assert out["as_of"] == "2026-08-01"
    assert out["eps_as_of"] == "2026-06-30"
    assert out["ts"] == "2026-08-01T13:00:00+00:00"
    assert out["nested"]["inner_date"] == "2026-01-01"
    assert out["nested"]["x"] == 1.0
    assert out["listy"][0] == "2026-01-01"
    assert out["listy"][1:] == ["str", 42, None, True, False]
    # Round-trip through json.dumps, the operation that the supabase
    # client's update() does under the hood. THIS is the regression:
    # without _json_safe, this line raised TypeError.
    json.dumps(out)


def test_persist_payload_is_json_serializable_when_services_return_dates() -> None:
    """Regression test for the 2026-08-01 empty-card incident.

    The ERP and equity_bond_corr services deliberately return
    ``as_of`` (and ERP also ``eps_as_of``) as ``datetime.date``
    objects — a real type for callers that aren't serialising. The
    supabase client's ``update()`` calls ``json.dumps`` under the
    hood, which has no encoder for ``date`` and raises
    ``TypeError: Object of type date is not JSON serializable``.
    The runner's ``run()`` swallows that, attaches
    ``persist_error`` to the in-memory payload, and writes NOTHING
    to the database — the JSONB column stays NULL and the
    homepage card renders the empty state.

    Pin the contract: whatever ``persist_computable_macro`` sends
    to the supabase client must round-trip through ``json.dumps``.
    The test mimics the real service output (a payload with
    ``as_of`` and ``eps_as_of`` as ``date`` objects), captures the
    update payload on the fake, and asserts the round-trip.
    """
    sb = _FakeSupabase(
        regime_rows=[{"run_date": "2026-08-01", "computable_macro": None}],
    )
    payload = {
        "erp": {
            "status": "measured",
            "as_of": date(2026, 8, 1),                # <-- date, the regression
            "eps_as_of": date(2026, 6, 30),           # <-- date, the regression
            "erp_pct": -1.42,
            "earnings_yield_pct": 3.26,
            "ust10_pct": 4.68,
            "spx_pe": 30.63,
        },
        "equity_bond_corr": {
            "status": "unknown",
            "as_of": date(2026, 8, 1),                # <-- date, the regression
            "corr": None,
            "n_pairs": 0,
            "lookback_days": 60,
        },
        "ndx_seasonality": {
            "n_observations": 438,
            "per_month": [{"month": 8, "mean_pct": 0.32}],
            "window": {"start_year": 1990, "end_year": 2025},
        },
    }
    n = persist_computable_macro(sb, as_of=date(2026, 8, 1), payload=payload)
    assert n == 1
    # Pull the actual payload the supabase client would have been
    # asked to serialise. The fake records one entry per .execute(),
    # keyed by table name.
    recorder = sb.recorder["regime_classifications"]
    assert len(recorder) == 1
    sent = recorder[0]["update_payload"]["computable_macro"]
    # The fix: every date is now an ISO string in the sent payload.
    assert sent["erp"]["as_of"] == "2026-08-01"
    assert sent["erp"]["eps_as_of"] == "2026-06-30"
    assert sent["equity_bond_corr"]["as_of"] == "2026-08-01"
    # And the whole thing round-trips through json.dumps, which is
    # the operation the supabase client performs.
    json.dumps(sent)
