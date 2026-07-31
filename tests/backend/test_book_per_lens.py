"""A CREDIT-lens book coexists with the MULTI-ASSET book on the same run_date.

ADR-0194 / migration 062: `research_recommendations` and `book_holdings` are now
keyed by (run_date, lens) instead of (run_date). This file asserts the property
that migration exists to provide — two lenses' books on one date, independently
readable, neither one silently replacing the other — and the boundary the task
is most insistent on: the credit book must NEVER reach `pick_outcomes`,
`book_signal`, `book_holdings_performance` or `book_revisions`, because those four
are the multi-asset book's forward track record (ADR-0090/0093/0150) and a second
book writing picks for the same date would corrupt a denominator that is supposed
to precede the outcome.

A per-component test of `_persist_to_supabase` cannot fail when the wiring between
"which lens ran" and "which on_conflict key it upserts on" is cut — these assert
the PATH, the same reasoning `test_optimizer_wiring.py` documents for the sizer.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import q1_agent  # noqa: E402

import scripts.daily_refresh as dr  # noqa: E402


# ─── A minimal fake Supabase client with real upsert/delete semantics ────────
#
# Rich enough to prove two lenses coexist rather than collide: upsert respects
# on_conflict as an actual composite key, and delete only removes rows matching
# every .eq() in the chain — the same behaviour that makes migration 062's
# (run_date, lens[, asset]) keys the point of this whole file.


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, store: dict, calls: list, name: str):
        self.store = store
        self.calls = calls
        self.name = name
        self._filters: list[tuple] = []
        self._limit = None

    # ── filter chain (read AND delete both go through here) ──
    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def lt(self, col, val):
        self._filters.append(("__lt__", col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _matches(self, row: dict) -> bool:
        for f in self._filters:
            if f[0] == "__lt__":
                _, col, val = f
                if not (row.get(col) is not None and row[col] < val):
                    return False
            else:
                col, val = f
                if row.get(col) != val:
                    return False
        return True

    # ── writes ──
    def insert(self, rows):
        rows = rows if isinstance(rows, list) else [rows]
        self.calls.append({"table": self.name, "op": "insert", "rows": rows})
        self.store.setdefault(self.name, []).extend(dict(r) for r in rows)
        return self

    def upsert(self, rows, on_conflict=None, **kwargs):
        rows = rows if isinstance(rows, list) else [rows]
        self.calls.append({
            "table": self.name, "op": "upsert",
            "on_conflict": on_conflict, "rows": rows,
        })
        key_cols = (on_conflict or "").split(",") if on_conflict else []
        table = self.store.setdefault(self.name, [])
        for row in rows:
            key = tuple(row.get(c) for c in key_cols) if key_cols else None
            replaced = False
            if key_cols:
                for i, existing in enumerate(table):
                    if tuple(existing.get(c) for c in key_cols) == key:
                        table[i] = {**existing, **row}
                        replaced = True
                        break
            if not replaced:
                table.append(dict(row))
        return self

    def delete(self):
        self._pending_delete = True
        return self

    def execute(self):
        rows = self.store.get(self.name, [])
        matched = [r for r in rows if self._matches(r)]
        if getattr(self, "_pending_delete", False):
            self.calls.append({
                "table": self.name, "op": "delete", "filters": list(self._filters),
            })
            self.store[self.name] = [r for r in rows if not self._matches(r)]
            return _FakeResult(matched)
        if self._limit is not None:
            matched = matched[: self._limit]
        return _FakeResult(matched)


class _FakeClient:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}
        self.calls: list[dict] = []

    def table(self, name):
        return _FakeTable(self.store, self.calls, name)


def _minimal_state(run_date="2026-07-30", lens="multi_asset", picks=None):
    """The smallest state `_persist_to_supabase` accepts.

    Bypasses `size_positions` entirely — picks already carry `signed_weight`, as
    they would coming out of sizing. This file tests PERSISTENCE, not sizing;
    `test_optimizer_wiring.py` already covers the sizer's own path to the row.
    """
    if picks is None:
        picks = [
            {"asset": "LQD", "direction": "long", "signed_weight": 0.10,
             "weight": 0.10, "notional": 10_000_000.0, "theme_id": "t1"},
            {"asset": "HYG", "direction": "short", "signed_weight": -0.08,
             "weight": 0.08, "notional": 8_000_000.0, "theme_id": "t2"},
        ]
    return {
        "run_date": run_date,
        "supabase_url": "https://example.supabase.co",
        "supabase_key": "key",
        "lens": lens,
        "picks": picks,
        "book_view": "",
        "book_risks": [],
        "citations": [],
        "verified": False,
        "retries": 0,
        "advisory_derivation": {"body": None},
    }


@pytest.fixture
def fake_client(monkeypatch):
    client = _FakeClient()
    monkeypatch.setattr(q1_agent, "create_client", lambda *_a, **_k: client)
    return client


# ─── Two lenses coexist ───────────────────────────────────────────────────────


def test_two_lenses_on_the_same_run_date_both_persist_independently(fake_client):
    multi_state = _minimal_state(lens="multi_asset")
    credit_state = _minimal_state(
        lens="credit",
        picks=[
            {"asset": "AGG", "direction": "long", "signed_weight": 0.12,
             "weight": 0.12, "notional": 12_000_000.0},
            {"asset": "EMB", "direction": "short", "signed_weight": -0.09,
             "weight": 0.09, "notional": 9_000_000.0},
        ],
    )

    assert q1_agent._persist_to_supabase(multi_state) is True
    assert q1_agent._persist_to_supabase(credit_state) is True

    recs = fake_client.store["research_recommendations"]
    assert len(recs) == 2, "both lenses' rows must coexist, not collide, for one run_date"
    by_lens = {r["lens"]: r for r in recs}
    assert set(by_lens) == {"multi_asset", "credit"}
    assert {p["asset"] for p in by_lens["multi_asset"]["picks"]} == {"LQD", "HYG"}
    assert {p["asset"] for p in by_lens["credit"]["picks"]} == {"AGG", "EMB"}

    holdings = fake_client.store["book_holdings"]
    by_lens_asset = {(h["lens"], h["asset"]) for h in holdings}
    assert by_lens_asset == {
        ("multi_asset", "LQD"), ("multi_asset", "HYG"),
        ("credit", "AGG"), ("credit", "EMB"),
    }


def test_the_multi_asset_book_is_unchanged_by_a_credit_lens_persist_same_date(fake_client):
    """The sharpest version of the coexistence claim: an OVERLAPPING ticker, held
    at a DIFFERENT weight by each lens, must not let the later write bleed into
    the earlier one."""
    multi_state = _minimal_state(
        lens="multi_asset",
        picks=[{"asset": "AGG", "direction": "long", "signed_weight": 0.05,
                "weight": 0.05, "notional": 5_000_000.0}],
    )
    assert q1_agent._persist_to_supabase(multi_state) is True

    recs_before = [dict(r) for r in fake_client.store["research_recommendations"]]
    holdings_before = [dict(h) for h in fake_client.store["book_holdings"]]

    credit_state = _minimal_state(
        lens="credit",
        picks=[{"asset": "AGG", "direction": "long", "signed_weight": 0.30,
                "weight": 0.30, "notional": 30_000_000.0}],
    )
    assert q1_agent._persist_to_supabase(credit_state) is True

    recs_after = fake_client.store["research_recommendations"]
    holdings_after = fake_client.store["book_holdings"]

    multi_rec_after = next(r for r in recs_after if r["lens"] == "multi_asset")
    multi_rec_before = next(r for r in recs_before if r["lens"] == "multi_asset")
    assert multi_rec_after == multi_rec_before, (
        "the credit persist must not touch the multi_asset research_recommendations row"
    )

    multi_holdings_after = [h for h in holdings_after if h["lens"] == "multi_asset"]
    assert multi_holdings_after == holdings_before, (
        "the credit persist must not touch the multi_asset book_holdings rows, "
        "even when both lenses hold the SAME ticker"
    )
    agg_multi = next(h for h in multi_holdings_after if h["asset"] == "AGG")
    assert agg_multi["signed_weight"] == pytest.approx(0.05), (
        "AGG's multi_asset weight must stay 5%, not the credit book's 30%"
    )
    agg_credit = next(
        h for h in holdings_after if h["lens"] == "credit" and h["asset"] == "AGG"
    )
    assert agg_credit["signed_weight"] == pytest.approx(0.30)


# ─── The four track-record tables stay multi-asset-only ─────────────────────


def test_credit_lens_persist_does_not_write_book_signal_or_book_revisions(fake_client, monkeypatch):
    # Prove the gate is doing work, not merely that these tables are untouched by
    # accident: seed a PRIOR multi_asset row so `_record_book_revisions` would have
    # something to diff against, and put a real `signal` payload on state so
    # `_persist_signal` would have rows to write, if it were called.
    seed = _minimal_state(lens="multi_asset")
    assert q1_agent._persist_to_supabase(seed) is True

    credit_state = _minimal_state(lens="credit")
    credit_state["signal"] = {"signals": [
        {"asset": "LQD", "direction": "long", "edge_score": 0.4, "conviction": 30.0}
    ]}

    assert q1_agent._persist_to_supabase(credit_state) is True

    assert fake_client.store.get("book_signal", []) == [], (
        "book_signal is multi-asset-only (no lens column, UNIQUE(run_date, asset, "
        "direction)) — a credit persist must never write to it"
    )
    assert fake_client.store.get("book_revisions", []) == [], (
        "book_revisions is multi-asset-only — a credit persist must never write to it"
    )
    # book_holdings_performance has no lens column at all and is written only by
    # scripts/daily_refresh.py::extend_held_book, never by _persist_to_supabase —
    # true regardless of lens, asserted here for completeness against this table.
    assert fake_client.store.get("book_holdings_performance", []) == []


def test_multi_asset_persist_still_writes_book_signal_and_book_revisions(fake_client):
    """The gate must be lens == 'multi_asset', not "always off" — confirms the
    previous test is catching a real gate and not a suite-wide table absence."""
    seed = _minimal_state(lens="multi_asset")
    assert q1_agent._persist_to_supabase(seed) is True

    # A materially DIFFERENT book for the same (run_date, lens) — book_revisions'
    # own materiality threshold is one basis point (ARCHITECTURE.md), and an
    # identical replay logs nothing ("No material revision"), which would make
    # this test pass for the wrong reason.
    state = _minimal_state(
        lens="multi_asset",
        picks=[
            {"asset": "LQD", "direction": "long", "signed_weight": 0.25,
             "weight": 0.25, "notional": 25_000_000.0, "theme_id": "t1"},
            {"asset": "HYG", "direction": "short", "signed_weight": -0.08,
             "weight": 0.08, "notional": 8_000_000.0, "theme_id": "t2"},
        ],
    )
    state["signal"] = {"signals": [
        {"asset": "LQD", "direction": "long", "edge_score": 0.4, "conviction": 30.0}
    ]}
    assert q1_agent._persist_to_supabase(state) is True

    assert fake_client.store.get("book_signal"), (
        "a multi_asset persist with a signal payload must still write book_signal"
    )
    assert fake_client.store.get("book_revisions"), (
        "the second multi_asset persist for this run_date changed LQD's weight "
        "materially and must be logged as a revision"
    )


def test_record_published_claims_refuses_a_non_multi_asset_lens(monkeypatch):
    """The other half of the pick_outcomes boundary: `record_published_claims`
    (scripts/daily_refresh.py) is the function that turns published picks into
    `pick_outcomes` commitments. Even though only the primary (multi_asset) flow
    calls it in production, it must refuse a credit-lens result on its own terms.
    """
    calls = []

    class _Tbl:
        def upsert(self, rows, **kw):
            calls.append((rows, kw))
            return self

        def execute(self):
            return _FakeResult([])

    class _SB:
        def table(self, _name):
            return _Tbl()

    monkeypatch.setattr(dr, "supabase", _SB())

    credit_result = {
        "lens": "credit",
        "picks": [{"asset": "LQD", "direction": "long"}],
    }
    n = dr.record_published_claims(credit_result, __import__("datetime").date(2026, 7, 30))

    assert n == 0
    assert calls == [], "a credit-lens result must never reach pick_outcomes"


def test_record_published_claims_still_records_multi_asset(monkeypatch):
    calls = []

    class _Tbl:
        def upsert(self, rows, **kw):
            calls.append((rows, kw))
            return self

        def execute(self):
            return _FakeResult([])

    class _SB:
        def table(self, _name):
            return _Tbl()

    monkeypatch.setattr(dr, "supabase", _SB())

    multi_result = {
        "lens": "multi_asset",
        "picks": [{"asset": "LQD", "direction": "long"}],
    }
    n = dr.record_published_claims(multi_result, __import__("datetime").date(2026, 7, 30))

    assert n == 1
    assert calls, "a multi_asset result must still reach pick_outcomes"
    _rows, kw = calls[0]
    assert kw.get("on_conflict") == "run_date,asset,direction,horizon_days,spec_version"


# ─── on_conflict keys are the new ones ────────────────────────────────────────


def test_on_conflict_keys_are_run_date_lens_and_run_date_lens_asset(fake_client):
    state = _minimal_state(lens="credit")
    assert q1_agent._persist_to_supabase(state) is True

    rec_upserts = [
        c for c in fake_client.calls
        if c["table"] == "research_recommendations" and c["op"] == "upsert"
    ]
    assert rec_upserts, "research_recommendations must be upserted"
    assert rec_upserts[-1]["on_conflict"] == "run_date,lens"

    holdings_upserts = [
        c for c in fake_client.calls
        if c["table"] == "book_holdings" and c["op"] == "upsert"
    ]
    assert holdings_upserts, "book_holdings must be upserted"
    assert holdings_upserts[-1]["on_conflict"] == "run_date,lens,asset"


# ─── A credit-lens L5 failure leaves the multi_asset book intact ─────────────


def test_a_credit_lens_l5_failure_is_caught_and_recorded_never_raises(monkeypatch):
    """run_credit_lens_book is called AFTER the primary multi_asset book has
    already been fully persisted (see scripts/daily_refresh.py::main). The
    function must swallow any exception from the injected agent — a MiniMax 429
    above all — log it, record a pipeline_runs failure, and return None rather
    than propagate and take the process down mid-run."""
    monkeypatch.setenv("RUN_CREDIT_LENS", "1")

    pipeline_calls = []

    def _fake_record_pipeline_run(_sb, _run_id, status, **kw):
        pipeline_calls.append((status, kw))

    monkeypatch.setattr(dr, "record_pipeline_run", _fake_record_pipeline_run)
    monkeypatch.setattr(dr, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(dr, "SUPABASE_KEY", "key")
    monkeypatch.setattr(dr, "load_mandate", lambda: None)

    def _boom(**_kwargs):
        raise RuntimeError("429 Too Many Requests")

    result = dr.run_credit_lens_book(
        run_date=__import__("datetime").date(2026, 7, 30),
        macro_snapshot={},
        regime=None,
        positioned=[],
        risk_metrics={},
        cfg=None,
        _run_q1_agent=_boom,
    )

    assert result is None
    statuses = [status for status, _kw in pipeline_calls]
    assert statuses == ["started", "failure"], (
        f"expected a started+failure pair, got {statuses}"
    )
    assert "429" in pipeline_calls[-1][1].get("error", "")


def test_credit_lens_can_be_disabled_without_touching_anything(monkeypatch):
    monkeypatch.setenv("RUN_CREDIT_LENS", "0")

    called = {"agent": False}

    def _should_not_run(**_kwargs):
        called["agent"] = True

    result = dr.run_credit_lens_book(
        run_date=__import__("datetime").date(2026, 7, 30),
        macro_snapshot={}, regime=None, positioned=[], risk_metrics={}, cfg=None,
        _run_q1_agent=_should_not_run,
    )

    assert result is None
    assert called["agent"] is False, "RUN_CREDIT_LENS=0 must not invoke the agent at all"
