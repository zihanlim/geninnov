"""Tests for the structured_facts service.

The service is a thin read/write layer over the structured_facts
table. The read API is what the L5 calls; the write API is for the
loader. Tests use a fake Supabase client to assert on the SQL the
service emits, since the table's behaviour (RLS, unique constraint)
is the database's, not the service's.
"""
import sys
from datetime import date

sys.path.insert(0, "backend/services")

from structured_facts import (  # noqa: E402
    cite,
    get_fact,
    get_facts_by_category,
    get_facts_for_entities,
    get_fact_trajectory,
    parse_cite,
    upsert_fact,
)


class _FakeQuery:
    """A minimal Supabase query chain that records every method call.

    Most chains terminate on .execute(); tests assert on the recorded
    sequence. The fake data is configured per-test.
    """

    def __init__(self, recorder: dict, table: str, rows: list[dict] | None = None):
        self._recorder = recorder
        self._table = table
        self._rows = rows or []
        self._chain: list[tuple[str, tuple, dict]] = []

    def select(self, *cols):
        self._chain.append(("select", cols, {}))
        return self

    def eq(self, col, val):
        self._chain.append(("eq", (col, val), {}))
        # Apply the filter so the fake executes the same shape the
        # real Supabase would after the chain.
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def neq(self, col, val):
        self._chain.append(("neq", (col, val), {}))
        return self

    def in_(self, col, vals):
        self._chain.append(("in", (col, tuple(vals)), {}))
        self._rows = [r for r in self._rows if r.get(col) in vals]
        return self

    def lte(self, col, val):
        self._chain.append(("lte", (col, val), {}))
        self._rows = [r for r in self._rows
                      if r.get(col) is not None and r.get(col) <= val]
        return self

    def gte(self, col, val):
        self._chain.append(("gte", (col, val), {}))
        return self

    def order(self, col, desc=False):
        self._chain.append(("order", (col,), {"desc": desc}))
        if desc:
            self._rows = sorted(
                self._rows,
                key=lambda r: r.get(col) or "",
                reverse=True,
            )
        return self

    def limit(self, n):
        self._chain.append(("limit", (), {"n": n}))
        self._rows = self._rows[:n]
        return self

    def upsert(self, payload, on_conflict=None):
        self._chain.append(("upsert", (), {"payload": payload,
                                            "on_conflict": on_conflict}))
        # The real service returns the inserted row id; fake it.
        return self

    def execute(self):
        self._recorder.setdefault(self._table, []).append(list(self._chain))
        return type("R", (), {"data": self._rows})()


class _FakeSupabase:
    def __init__(self, rows_by_table: dict[str, list[dict]] | None = None):
        self._rows_by_table = rows_by_table or {}
        self.recorder: dict = {}

    def table(self, name: str):
        return _FakeQuery(self.recorder, name, list(self._rows_by_table.get(name, [])))


def _seed_fact() -> dict:
    return {
        "entity": "MSFT",
        "metric": "capex_fy26_bn",
        "value": 80.0,
        "unit": "USD_bn",
        "as_of": "2026-06-30",
        "source": "MSFT 10-Q Q1 FY26",
        "source_url": "https://www.sec.gov/...",
        "confidence": "high",
        "category": "ai_capex",
        "notes": "FY26 capex guidance midpoint",
        "created_at": "2026-08-01T00:00:00+00:00",
    }


# ---- cite / parse_cite --------------------------------------------------

def test_cite_format() -> None:
    assert cite("MSFT", "capex_fy26_bn") == "[structured_facts:MSFT:capex_fy26_bn]"


def test_cite_format_with_colons_in_metric() -> None:
    """A metric like 'a:b:c' should be preserved verbatim in the cite."""
    s = cite("X", "a:b:c")
    assert s == "[structured_facts:X:a:b:c]"
    # parse_cite splits on the FIRST colon after the prefix.
    assert parse_cite(s) == ("X", "a:b:c")


def test_parse_cite_roundtrip() -> None:
    s = cite("DeepSeek_V4", "params_trillion")
    assert parse_cite(s) == ("DeepSeek_V4", "params_trillion")


def test_parse_cite_rejects_non_structured_facts() -> None:
    assert parse_cite("[macro_indicators:DGS10]") is None
    assert parse_cite("not a citation at all") is None
    assert parse_cite("") is None
    assert parse_cite("[structured_facts:no_metric]") is None
    assert parse_cite("[structured_facts:]") is None


# ---- get_fact -----------------------------------------------------------

def test_get_fact_returns_row_when_present() -> None:
    sb = _FakeSupabase({"structured_facts": [_seed_fact()]})
    out = get_fact(sb, "MSFT", "capex_fy26_bn")
    assert out is not None
    assert out["value"] == 80.0
    assert out["unit"] == "USD_bn"


def test_get_fact_returns_none_when_absent() -> None:
    """ADR-0098: absence is data, not zero."""
    sb = _FakeSupabase({"structured_facts": []})
    assert get_fact(sb, "MSFT", "capex_fy26_bn") is None
    assert get_fact(sb, "DOES_NOT_EXIST", "x") is None


def test_get_fact_with_as_of_binds_query() -> None:
    sb = _FakeSupabase({"structured_facts": [_seed_fact()]})
    get_fact(sb, "MSFT", "capex_fy26_bn", as_of=date(2026, 7, 31))
    chains = sb.recorder["structured_facts"]
    # The lte('as_of', '2026-07-31') filter must appear in the chain.
    assert any(
        op == "lte" and args == ("as_of", "2026-07-31")
        for op, args, _ in chains[0]
    )


# ---- get_facts_by_category ----------------------------------------------

def test_get_facts_by_category_returns_all_rows() -> None:
    rows = [
        _seed_fact(),
        {
            "entity": "META", "metric": "capex_fy26_bn", "value": 64.0,
            "unit": "USD_bn", "as_of": "2026-06-30", "source": "META 10-Q",
            "confidence": "high", "category": "ai_capex",
            "created_at": "2026-08-01T00:00:00+00:00",
        },
        {
            "entity": "DeepSeek_V4", "metric": "params_trillion", "value": 1.6,
            "unit": "trillion_params", "as_of": "2026-04-30",
            "source": "DeepSeek V4 technical report", "confidence": "high",
            "category": "china_ai",
            "created_at": "2026-08-01T00:00:00+00:00",
        },
    ]
    sb = _FakeSupabase({"structured_facts": rows})
    out = get_facts_by_category(sb, "ai_capex")
    assert len(out) == 2
    assert all(r["category"] == "ai_capex" for r in out)


def test_get_facts_by_category_orders_by_as_of_desc() -> None:
    """The L5 cites the most recent — the chain must order by as_of DESC."""
    sb = _FakeSupabase({"structured_facts": [_seed_fact()]})
    get_facts_by_category(sb, "ai_capex")
    chains = sb.recorder["structured_facts"]
    # Find the order call.
    order_calls = [(args, kw) for op, args, kw in chains[0] if op == "order"]
    assert order_calls, "expected an order() call"
    op, args, kw = [(op, args, kw) for op, args, kw in chains[0]
                     if op == "order"][0]
    assert args == ("as_of",)
    assert kw.get("desc") is True


# ---- get_facts_for_entities --------------------------------------------

def test_get_facts_for_entities_with_metrics() -> None:
    """The L5 calls this with a list of entities and a list of metrics."""
    rows = [
        _seed_fact(),
        {
            "entity": "META", "metric": "capex_fy26_bn", "value": 64.0,
            "unit": "USD_bn", "as_of": "2026-06-30", "source": "META 10-Q",
            "confidence": "high", "category": "ai_capex",
            "created_at": "2026-08-01T00:00:00+00:00",
        },
    ]
    sb = _FakeSupabase({"structured_facts": rows})
    out = get_facts_for_entities(
        sb, ["MSFT", "META"], metrics=["capex_fy26_bn"]
    )
    assert len(out) == 2


def test_get_facts_for_entities_empty_list_returns_empty() -> None:
    """An empty entities list is a no-op, not an error."""
    sb = _FakeSupabase({"structured_facts": [_seed_fact()]})
    out = get_facts_for_entities(sb, [])
    assert out == []


# ---- get_fact_trajectory -----------------------------------------------

def test_get_fact_trajectory_returns_all_rows_for_a_pair() -> None:
    rows = [
        {**_seed_fact(), "as_of": "2026-06-30", "value": 80.0},
        {**_seed_fact(), "as_of": "2025-12-31", "value": 60.0},
    ]
    sb = _FakeSupabase({"structured_facts": rows})
    out = get_fact_trajectory(sb, "MSFT", "capex_fy26_bn")
    assert len(out) == 2
    # The fake orders and limits as a function of the input; what
    # matters here is that the chain included the right eq filters.
    chains = sb.recorder["structured_facts"]
    eq_filters = [args for op, args, _ in chains[0] if op == "eq"]
    assert ("entity", "MSFT") in eq_filters
    assert ("metric", "capex_fy26_bn") in eq_filters


# ---- upsert_fact -------------------------------------------------------

def test_upsert_fact_validates_required_fields() -> None:
    """A row missing required fields raises ValueError BEFORE any
    Supabase call is made."""
    sb = _FakeSupabase()
    try:
        upsert_fact(sb, {"entity": "MSFT", "metric": "x"})
    except ValueError as exc:
        assert "value" in str(exc) or "missing" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError for missing required fields")


def test_upsert_fact_filters_unwanted_keys() -> None:
    """The upsert payload must only contain known columns — an
    unexpected key would 400 from PostgREST."""
    sb = _FakeSupabase()
    upsert_fact(sb, {
        **_seed_fact(),
        "evil_column": "DROP TABLE structured_facts;",
    })
    chains = sb.recorder["structured_facts"]
    upsert_calls = [
        kw for op, args, kw in chains[0] if op == "upsert"
    ]
    assert upsert_calls, "expected an upsert() call"
    payload = upsert_calls[0]["payload"]
    assert "evil_column" not in payload


def test_upsert_fact_uses_unique_constraint() -> None:
    """The on_conflict argument must match the migration's UNIQUE
    constraint, or re-loads will create duplicates."""
    sb = _FakeSupabase()
    upsert_fact(sb, _seed_fact())
    chains = sb.recorder["structured_facts"]
    upsert_calls = [
        kw for op, args, kw in chains[0] if op == "upsert"
    ]
    assert upsert_calls[0]["on_conflict"] == "entity,metric,as_of"
