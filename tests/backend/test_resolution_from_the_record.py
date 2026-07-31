"""
Resolution reads the RECORD of what was claimed, not what is still published (ADR-0205).

THE DEFECT THIS PINS, and the fixture is the live one that exposed it.

`scripts/resolve_outcomes.py` used to re-derive its claim set from
`research_recommendations.picks` — from whatever book is CURRENTLY published for a
run_date. The pipeline is invoked more than once on some dates (measured: 3 L5
invocations/day for 2026-07-27..30), and `research_recommendations` upserts on
`(run_date, lens)` while `pick_outcomes` accumulates the union. So a pick whose book was
replaced by a later run on the same date was never in the claim set again: it stayed
`pending` past its expected exit, forever, and could permanently pin
`first_expected_maturity`.

On 2026-07-30: 13 recorded claims against a 9-name published book. ARKK, JD, MSFT and NUE
were published, served on the live site for ~14 hours, then superseded — and were
unfalsifiable, on the table whose ADR is titled "a published pick must be falsifiable".
Across 07-27..07-30 it was 20 of ~80 claims, a quarter of the denominator.

ADR-0203 decided those claims are NOT removed (a pick cannot leave the denominator once
it looks bad, or a re-run becomes a laundering channel). This file pins the other half:
they are GRADED.

Two properties, and the second is the one a future refactor is most likely to break:
  1. a claim absent from the current book still resolves;
  2. a TERMINAL row is never in the write payload — which is what stops a yfinance outage
     writing `pending` with NULL prices over a resolved `hit` (ADR-0117's rule, applied to
     the resolver's own upsert for the first time).
"""

import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest  # noqa: E402

from backend.services.pick_outcomes import (  # noqa: E402
    SPEC_VERSION,
    VOID_GRACE_DAYS,
    expected_exit_date,
)
import scripts.resolve_outcomes as ro  # noqa: E402

RUN = "2026-07-30"
RUN_D = date(2026, 7, 30)
PUBLISHED = ["BABA", "F", "GEV", "GLD", "NOC", "PDD", "SMH", "UNG", "UNH"]
SUPERSEDED = ["ARKK", "JD", "MSFT", "NUE"]
CONFLICT = "run_date,asset,direction,horizon_days,spec_version"


# ── A supabase double that records what was asked and what was written ───────────
# Deliberately thin: it answers the three chains the resolver makes and captures every
# write with its `on_conflict` / `ignore_duplicates`, because the WRITE DISCIPLINE is half
# of what this change is about and a fake that only stored rows would not see it.

class _Result:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, name, store, reads, writes):
        self.name, self.store, self.reads, self.writes = name, store, reads, writes
        self.filters: dict = {}
        self.rng = None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def range(self, lo, hi):
        self.rng = (lo, hi)
        return self

    def upsert(self, rows, on_conflict=None, ignore_duplicates=False):
        self.writes.append({
            "table": self.name,
            "rows": rows if isinstance(rows, list) else [rows],
            "on_conflict": on_conflict,
            "ignore_duplicates": ignore_duplicates,
        })
        # A write chain ends in .execute() too. Mark it, so the read log stays a log of
        # READS — otherwise every upsert appends a filter-less entry and any assertion
        # about "every read carried filter X" is false for a reason that is not the code's.
        self._is_write = True
        return self

    def execute(self):
        if getattr(self, "_is_write", False):
            return _Result([])
        rows = list(self.store.get(self.name, []))
        for col, val in self.filters.items():
            rows = [r for r in rows if r.get(col) == val]
        self.reads.append({"table": self.name, "filters": dict(self.filters),
                           "range": self.rng, "n": len(rows)})
        if self.rng is not None:
            lo, hi = self.rng
            rows = rows[lo:hi + 1]
        return _Result(rows)


class _Client:
    def __init__(self, store):
        self.store, self.reads, self.writes = store, [], []

    def table(self, name):
        return _Table(name, self.store, self.reads, self.writes)


def _claim(asset, direction="long", verdict="pending", spec=SPEC_VERSION, run=RUN,
           horizon=21, exp=None):
    return {
        "run_date": run, "asset": asset, "direction": direction,
        "horizon_days": horizon, "spec_version": spec, "verdict": verdict,
        "expected_exit_date": (exp or expected_exit_date(RUN_D, horizon)).isoformat()
        if not isinstance(exp, str) else exp,
    }


@pytest.fixture
def store():
    """The live 2026-07-30 shape: a 9-name book, 13 recorded claims."""
    return {
        "research_recommendations": [
            {"run_date": RUN, "lens": "multi_asset",
             "picks": [{"asset": a, "direction": "long"} for a in PUBLISHED]},
            # The credit book for the same date. It must never reach pick_outcomes.
            {"run_date": RUN, "lens": "credit",
             "picks": [{"asset": a, "direction": "long"} for a in ("EMB", "BKLN", "BIL")]},
        ],
        "pick_outcomes": [_claim(a) for a in PUBLISHED + SUPERSEDED],
    }


def _prices(assets, start, horizon):
    """A full, resolvable series for every asset asked for — enough observations that
    every claim matures, so a `pending` result means the code chose it."""
    out = {}
    for a in assets:
        series, d, price = [], RUN_D, 100.0
        for i in range(horizon + 5):
            while d.weekday() >= 5:
                d = date.fromordinal(d.toordinal() + 1)
            series.append((d, price + i))          # monotonically up -> long = hit
            d = date.fromordinal(d.toordinal() + 1)
        out[a] = series
    return out


@pytest.fixture
def past_grace():
    return date.fromordinal(expected_exit_date(RUN_D).toordinal() + VOID_GRACE_DAYS + 1)


# ─────────────────────────────────────────────────────────────────────────────────
# THE PROPERTY THIS CHANGE EXISTS FOR

def test_a_claim_absent_from_the_current_book_still_resolves(monkeypatch, store, past_grace):
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    sb = _Client(store)

    ro.resolve_pass(sb, 21, past_grace, dry_run=False)

    written = {r["asset"]: r["verdict"] for w in sb.writes for r in w["rows"]}
    for asset in SUPERSEDED:
        assert asset in written, f"{asset} was published and recorded but never graded"
        assert written[asset] != "pending", f"{asset} is still pending after resolution"


def test_no_matured_claim_is_left_pending(monkeypatch, store, past_grace):
    # The generalisation, asserted over the whole payload rather than one row: given a
    # working fetch and a clock past maturity, every graded claim is terminal.
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    sb = _Client(store)

    ro.resolve_pass(sb, 21, past_grace, dry_run=False)

    verdicts = [r["verdict"] for w in sb.writes for r in w["rows"]]
    assert len(verdicts) == 13
    assert "pending" not in verdicts
    assert set(verdicts) <= {"hit", "miss", "flat", "void"}


def test_the_denominator_does_not_shrink(monkeypatch, store, past_grace):
    # ADR-0203's decisive property, from the write side: resolution writes a verdict onto
    # every recorded claim and removes none. 13 in, 13 out.
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    sb = _Client(store)

    ro.resolve_pass(sb, 21, past_grace, dry_run=False)

    assert sum(len(w["rows"]) for w in sb.writes) == len(store["pick_outcomes"])


# ── Write discipline ────────────────────────────────────────────────────────────

def test_a_terminal_row_is_never_in_the_payload(monkeypatch, store, past_grace):
    # The ADR-0117 erasure, pinned. A resolved `hit` must be invisible to the resolver, so
    # a night where its ticker does not price cannot write `pending` with NULL prices over
    # the verdict.
    #
    # The fetch must SUCCEED here. An earlier version of this test returned {} for
    # everything, which aborts the pass before any write — so the assertion passed because
    # nothing at all was written, not because the terminal row was excluded. A guard that
    # cannot fail has not been tested. So: every published/superseded name prices, and
    # OLD's ticker is the only one that does not.
    store["pick_outcomes"].append(_claim("OLD", verdict="hit", run="2026-07-24"))
    monkeypatch.setattr(
        ro, "fetch_closes",
        lambda t, s, h: {a: v for a, v in _prices(t, s, h).items() if a != "OLD"},
    )
    sb = _Client(store)

    ro.resolve_pass(sb, 21, past_grace, dry_run=False)

    assert sb.writes, "the pass must have written, or this asserts nothing"
    assert all(r["asset"] != "OLD" for w in sb.writes for r in w["rows"])
    # And the exclusion was made by the QUERY, not by a post-filter — which is what keeps
    # the download window and the ticker set from growing with the whole history.
    pending_reads = [r for r in sb.reads if r["table"] == "pick_outcomes"]
    assert pending_reads and all(r["filters"].get("verdict") == "pending"
                                 for r in pending_reads)


def test_the_absent_book_test_is_not_vacuous(monkeypatch, store, past_grace):
    # Proves the suite's headline assertion can fail: restrict the claim set to the
    # currently-published names — which is precisely what the old resolver did — and the
    # superseded four go ungraded.
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    published_only = {
        "research_recommendations": store["research_recommendations"],
        "pick_outcomes": [r for r in store["pick_outcomes"] if r["asset"] in PUBLISHED],
    }
    sb = _Client(published_only)

    ro.resolve_pass(sb, 21, past_grace, dry_run=False)

    graded = {r["asset"] for w in sb.writes for r in w["rows"]}
    assert not (graded & set(SUPERSEDED)), (
        "with the superseded claims absent from the record they cannot be graded — "
        "which is the old behaviour this file exists to keep out"
    )


def test_a_fetch_that_returns_nothing_writes_nothing_and_fails(monkeypatch, store, past_grace):
    # One yfinance outage past the grace window would otherwise void the entire matured
    # set permanently. Zero tickers back is a broken fetch, not a dead market.
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: {})
    sb = _Client(store)

    rc = ro.resolve_pass(sb, 21, past_grace, dry_run=False)

    assert rc < 0, "a total fetch failure must signal failure"
    assert sb.writes == [], "a total fetch failure must not write"


def test_dry_run_writes_nothing(monkeypatch, store, past_grace):
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    sb = _Client(store)
    ro.resolve_pass(sb, 21, past_grace, dry_run=True)
    assert sb.writes == []


def test_a_foreign_spec_is_skipped_and_not_written(monkeypatch, store, past_grace):
    store["pick_outcomes"].append(_claim("V0NAME", spec="v0"))
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    sb = _Client(store)

    ro.resolve_pass(sb, 21, past_grace, dry_run=False)

    assert all(r["asset"] != "V0NAME" for w in sb.writes for r in w["rows"])


def test_the_rows_own_spec_is_written_back(monkeypatch, store, past_grace):
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    sb = _Client(store)
    ro.resolve_pass(sb, 21, past_grace, dry_run=False)
    assert {r["spec_version"] for w in sb.writes for r in w["rows"]} == {SPEC_VERSION}


def test_resolved_at_is_stamped_on_a_verdict(monkeypatch, store, past_grace):
    # The column has existed since migration 043 and nothing ever wrote it.
    monkeypatch.setattr(ro, "fetch_closes", lambda t, s, h: _prices(t, s, h))
    sb = _Client(store)
    ro.resolve_pass(sb, 21, past_grace, dry_run=False)
    stamps = {r["resolved_at"] for w in sb.writes for r in w["rows"]}
    assert stamps == {past_grace.isoformat()}


# ── Pass 1 keeps the two jobs dropping it would have retired ─────────────────────

def test_pass_one_records_from_the_book_and_stays_lens_scoped(store):
    sb = _Client(store)
    ro.record_pass(sb, 21, dry_run=False)

    reads = [r for r in sb.reads if r["table"] == "research_recommendations"]
    assert reads, "pass 1 must read the published book"
    # ADR-0194: the credit book must never enter pick_outcomes. The gate lives on THIS
    # pass now, because pass 1 is the only pass that creates rows.
    assert all(r["filters"].get("lens") == "multi_asset" for r in reads)

    written = {r["asset"] for w in sb.writes for r in w["rows"]}
    assert written == set(PUBLISHED)
    assert not (written & {"EMB", "BKLN", "BIL"})


def test_pass_one_writes_pending_only_and_never_overwrites(store):
    # Insert-if-absent. A repair for a book whose horizon has already matured must not
    # insert a fully RESOLVED row that never existed as pending (ADR-0117).
    sb = _Client(store)
    ro.record_pass(sb, 21, dry_run=False)

    assert len(sb.writes) == 1
    w = sb.writes[0]
    assert w["ignore_duplicates"] is True
    assert w["on_conflict"] == CONFLICT
    assert {r["verdict"] for r in w["rows"]} == {"pending"}
    assert all(r["entry_price"] is None for r in w["rows"])


def test_pass_one_is_what_makes_a_second_horizon_possible(store):
    # `daily_refresh` only ever writes 21d, so `--horizon 63` has nothing to resolve
    # until pass 1 creates the rows (ADR-0090: "a 63-day companion is a row, not a
    # migration"). Dropping the book read would have silently retired this.
    sb = _Client(store)
    ro.record_pass(sb, 63, dry_run=False)
    assert {r["horizon_days"] for w in sb.writes for r in w["rows"]} == {63}


def test_pass_one_dry_run_writes_nothing(store):
    sb = _Client(store)
    assert ro.record_pass(sb, 21, dry_run=True) == 0
    assert sb.writes == []
