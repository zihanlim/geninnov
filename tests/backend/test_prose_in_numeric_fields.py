"""A model answering ANY numeric field in prose must not throw the book away.

b62a2ba0 fixed this for six score fields at one site, and the same defect class
recurred the SAME DAY (22:33 UTC) from a different line — a stale traceback against a
since-reverted file version, unattributable after the fact. So instead of chasing the
line, these tests feed prose into EVERY model-controlled numeric field and require the
whole sizing and persist path to survive. Any remaining unguarded float(), present or
future, fails here rather than at 21:30 UTC with a verified thesis already paid for.
"""
from __future__ import annotations

from backend.services import q1_agent

PROSE = "N/A — ARKK not mapped to L1 theme set"


def _junk_pick(asset: str, direction: str) -> dict:
    """Every numeric field a model could plausibly answer in prose."""
    return {
        "asset": asset,
        "direction": direction,
        "theme": "Fed Policy",
        "theme_id": "t1",
        "thesis": "...",
        "counter_thesis": "...",
        "trade_score": PROSE,
        "hype_score": PROSE,
        "avg_sentiment": PROSE,
        "edge_score": PROSE,
        "vol": PROSE,
        "conviction": PROSE,
        "weight": PROSE,
        "signed_weight": PROSE,
        "notional": PROSE,
    }


def _junk_candidate(asset: str, direction: str) -> dict:
    return {
        "asset": asset, "direction": direction, "theme_id": "t1",
        "trade_score": PROSE, "hype_score": PROSE, "avg_sentiment": PROSE,
        "edge_score": 0.4, "vol": 0.2, "conviction": 2.0,
    }


class TestSizePositionsSurvivesProse:
    def test_prose_in_every_pick_field_still_sizes_a_book(self):
        state = {
            "run_date": "2026-07-27",
            "picks": [_junk_pick("SPY", "long"), _junk_pick("TLT", "short")],
            "candidates": [_junk_candidate("SPY", "long"),
                           _junk_candidate("TLT", "short")],
            "independent_ideas": {},
            "edge_ic": None,          # no IC -> conviction path; no network needed
            "factor_exposures": {},
            "cot_readings": None,
            "cfg": None,
        }
        out = q1_agent.size_positions(dict(state))
        assert out["picks"], "prose in numeric fields must degrade, not empty the book"
        for pick in out["picks"]:
            assert isinstance(pick["weight"], float)
            assert isinstance(pick["signed_weight"], float)
            assert isinstance(pick["notional"], float)

    def test_prose_in_candidates_too(self):
        """The candidate is the authoritative source (ADR-0053) — junk there must
        degrade the same way, not crash the resolution."""
        cands = [dict(_junk_candidate("SPY", "long"),
                      edge_score=PROSE, vol=PROSE, conviction=PROSE)]
        state = {
            "run_date": "2026-07-27",
            "picks": [_junk_pick("SPY", "long")],
            "candidates": cands,
            "independent_ideas": {},
            "edge_ic": None,
            "factor_exposures": {},
            "cot_readings": None,
            "cfg": None,
        }
        out = q1_agent.size_positions(dict(state))
        assert out["picks"]


class TestBookOfRecordSurvivesProse:
    def test_reconcile_coerces_prose_weight_and_notional(self):
        """The persist seam: a pick with prose in weight/signed_weight/notional must
        produce a numeric book row, not a ValueError while writing the book of record."""
        import importlib, os, sys
        # daily_refresh builds its Supabase client at import; the established
        # pattern (test_daily_refresh.py) is mock env + the scripts/ path.
        os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
        os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
        dr = importlib.import_module("daily_refresh")
        from backend.services.trade_ranker import TradeCandidate

        cand = TradeCandidate(theme_id="t1", asset="SPY", direction="long",
                              trade_score=0.4, hype_score=60.0, avg_sentiment=0.1,
                              edge_score=0.4, vol=0.2, conviction=2.0)
        positioned = [(cand, 5_000_000.0, 0.05)]
        agent_result = {"picks": [_junk_pick("SPY", "long")]}

        class _Cfg:
            total_capital = 100_000_000.0

        # The function's DB writes come after `final` is built; a coercion crash
        # happens before any network call, so reaching the upsert (which fails
        # against the stub client) proves coercion held. Passing a None supabase
        # would conflate the two, so use a stub that records the attempt.
        calls = {}
        class _Table:
            def __init__(self, name): self.name = name
            def delete(self): return self
            def upsert(self, rows, **kw):
                calls[self.name] = rows
                return self
            def eq(self, *a): return self
            def execute(self): return type("R", (), {"data": []})()
            def select(self, *a): return self
            def insert(self, rows, **kw):
                calls[self.name] = rows
                return self
        class _SB:
            def table(self, name): return _Table(name)

        original = dr.supabase
        dr.supabase = _SB()
        try:
            from datetime import date
            dr.reconcile_positions_to_published_book(
                agent_result, positioned, date(2026, 7, 27), _Cfg()
            )
        finally:
            dr.supabase = original

        rows = calls.get("portfolio_positions")
        assert rows, "the book of record was never written"
        for row in rows:
            for key in ("notional", "weight"):
                if key in row:
                    assert isinstance(row[key], (int, float)), (key, row[key])
