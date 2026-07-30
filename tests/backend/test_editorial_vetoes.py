"""
Tests for backend/services/editorial_vetoes.py (ADR-0171).

A veto REMOVES a name from the book. That makes every failure here a silent one —
the name is simply absent, and absence looks identical whether a human refused it,
a rule dropped it, or the code is broken. So the failure modes pinned below are
ordered by how invisible each is:

  1. a veto that does not match the name it names (case, direction) — the PM's
     refusal has no effect and nothing says so
  2. a veto that matches MORE than it names (both-sides bleed, expiry off-by-one) —
     a name is removed that nobody refused
  3. a reasonless veto applied anyway — the funnel cannot say why a name is gone,
     which is the ADR-0025 rule 2 failure
  4. double-counted attrition when two vetoes cover one candidate
  5. order changed by the filter, which would move which names survive the cap-30
"""

import sys, os
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.editorial_vetoes import (
    Veto,
    active_on,
    apply_vetoes,
    funnel_stage,
    parse_vetoes,
)

RD = date(2026, 7, 30)


def cand(asset: str, direction: str, **kw):
    return {"asset": asset, "direction": direction, "hype_score": 50.0, **kw}


def veto(asset="SLV", direction=None, reason="news noise, not signal", **kw):
    return Veto(asset=asset, direction=direction, reason=reason,
                decided_by="pm", **kw)


# ── 1. matching exactly what it names ────────────────────────────────────────

def test_direction_specific_veto_leaves_the_other_side_alone():
    """"this SHORT is crowded" is not "this name is untradeable"."""
    v = veto("SLV", "short")
    assert v.covers("SLV", "short") is True
    assert v.covers("SLV", "long") is False


def test_none_direction_vetoes_both_sides():
    v = veto("SLV", None)
    assert v.covers("SLV", "long") is True
    assert v.covers("SLV", "short") is True


def test_asset_match_is_case_and_whitespace_insensitive():
    # Tickers arrive from several providers with inconsistent casing. A veto that
    # missed because someone typed `slv` would fail with no symptom at all — the
    # name would appear in the book as though nobody had objected.
    v = veto("slv ", None)
    assert v.covers("SLV", "long") is True
    assert v.covers(" slv", "short") is True


def test_a_veto_does_not_cover_a_different_name():
    assert veto("SLV", None).covers("GLD", "long") is False


# ── 2. not matching more than it names ───────────────────────────────────────

def test_expiry_is_inclusive_of_the_expiry_day():
    """"hold off until the 30th" means through the 30th."""
    v = veto(expires_on=date(2026, 7, 30))
    assert active_on([v], date(2026, 7, 30)) == [v]     # still in force
    assert active_on([v], date(2026, 7, 31)) == []      # lapsed the next day


def test_a_veto_with_no_expiry_is_permanent():
    v = veto(expires_on=None)
    assert active_on([v], date(2030, 1, 1)) == [v]


def test_an_already_lapsed_veto_removes_nothing():
    pool = [cand("SLV", "short")]
    lapsed = active_on([veto("SLV", "short", expires_on=date(2026, 1, 1))], RD)
    assert apply_vetoes(pool, lapsed).kept == pool


# ── 3. a reason is mandatory in the code, not only in the schema ─────────────

def test_a_row_with_no_reason_is_skipped_entirely():
    # The DB has a NOT NULL CHECK, but this must not depend on it: applying a
    # reasonless veto would remove a name the funnel cannot explain.
    rows = [
        {"asset": "SLV", "reason": "  ", "decided_by": "pm"},
        {"asset": "SLV", "reason": None, "decided_by": "pm"},
        {"asset": "", "reason": "valid", "decided_by": "pm"},
    ]
    assert parse_vetoes(rows) == []


def test_a_valid_row_parses_with_its_reason_intact():
    rows = [{
        "asset": "SLV", "direction": "short", "reason": "one news cycle",
        "decided_by": "zihan", "decided_at": "2026-07-30T12:00:00Z",
        "expires_on": "2026-08-15",
    }]
    (v,) = parse_vetoes(rows)
    assert (v.asset, v.direction, v.reason, v.decided_by) == (
        "SLV", "short", "one news cycle", "zihan")
    assert v.expires_on == date(2026, 8, 15)
    assert isinstance(v.decided_at, datetime)


def test_an_unrecognised_direction_widens_to_both_rather_than_crashing():
    (v,) = parse_vetoes([{"asset": "SLV", "direction": "sideways",
                          "reason": "r", "decided_by": "pm"}])
    assert v.direction is None


# ── 4. attrition counted once ────────────────────────────────────────────────

def test_two_vetoes_covering_one_candidate_report_it_once():
    pool = [cand("SLV", "short")]
    both = veto("SLV", None, reason="structural")
    side = veto("SLV", "short", reason="crowded")
    res = apply_vetoes(pool, [both, side])
    assert res.kept == []
    assert res.n_dropped == 1          # not 2
    assert res.dropped[0][1] is both   # first match wins


# ── 5. order preserved, because the cap-30 depends on it ────────────────────

def test_order_is_preserved_so_the_cap30_is_unaffected():
    pool = [cand(t, "long") for t in ("A", "B", "C", "D")]
    res = apply_vetoes(pool, [veto("C", None)])
    assert [c["asset"] for c in res.kept] == ["A", "B", "D"]


def test_no_vetoes_is_a_passthrough():
    pool = [cand("A", "long"), cand("B", "short")]
    res = apply_vetoes(pool, [])
    assert res.kept == pool and res.n_dropped == 0


# ── the funnel stage a reader actually sees ──────────────────────────────────

def test_the_stage_renders_even_when_nothing_was_vetoed():
    # A funnel listing only the stages that fired implies the others do not exist.
    s = funnel_stage(apply_vetoes([cand("A", "long")], []), n_active=0)
    assert s["removed"] == 0
    assert s["remaining"] == 1
    assert "No editorial vetoes in force" in s["reason"]


def test_the_stage_says_a_veto_existed_but_did_not_match():
    res = apply_vetoes([cand("A", "long")], [veto("ZZZ", None)])
    s = funnel_stage(res, n_active=1)
    assert s["removed"] == 0
    assert "none matched" in s["reason"]


def test_the_stage_quotes_the_reason_verbatim_and_names_the_author():
    # The reason IS the editorial judgment. Paraphrasing it would put a string in
    # front of a reader that nobody wrote — ADR-0025 rule 1.
    res = apply_vetoes([cand("SLV", "short")],
                       [veto("SLV", "short", reason="one news cycle, not a signal")])
    s = funnel_stage(res, n_active=1)
    assert s["removed"] == 1
    assert s["remaining"] == 0
    assert "one news cycle, not a signal" in s["reason"]
    assert "pm" in s["reason"]
    assert "SLV" in s["reason"]


def test_the_stage_is_attributed_to_its_adr():
    s = funnel_stage(apply_vetoes([], []), n_active=0)
    assert "ADR-0171" in s["stage"]
