"""
Tests for backend/services/pick_outcomes.py — the forward track record (ADR-0090).

The traps this pins, in order of how much damage each would do:
  1. a short scored as a long (inverts the verdict)
  2. `void` conflated with `miss` (a pick the spec could not score is not a wrong call)
  3. `pending` conflated with `void` (a pick that has not matured is not unscoreable)
  4. hit_rate rendering 0.0 when nothing has resolved (asserts every call was wrong)
"""

import sys, os
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.pick_outcomes import (
    DEFAULT_HORIZON_DAYS,
    SPEC_VERSION,
    Outcome,
    build_scorecard,
    direction_sign,
    expected_exit_date,
    resolve_pick,
)

import pytest


def _series(start: date, prices: list[float]) -> list[tuple[date, float]]:
    """Consecutive WEEKDAY closes starting at `start`, so 'trading observations' and
    'weekdays' coincide and the test can count them by hand."""
    out, d = [], start
    for p in prices:
        while d.weekday() >= 5:
            d = date.fromordinal(d.toordinal() + 1)
        out.append((d, p))
        d = date.fromordinal(d.toordinal() + 1)
    return out


# ─── the spec ────────────────────────────────────────────────────────────────

def test_horizon_matches_the_backtest_forward_window():
    """21 trading days is not arbitrary: backtest_edge.py computes IC against forward
    1-month returns. If these diverge, /method and the scorecard disagree about what
    'works' means."""
    assert DEFAULT_HORIZON_DAYS == 21
    assert SPEC_VERSION == "v1"


def test_expected_exit_date_skips_weekends_and_is_a_lower_bound():
    # Fri 2026-07-24 + 1 business day = Mon 2026-07-27, not Sat the 25th.
    assert expected_exit_date(date(2026, 7, 24), 1) == date(2026, 7, 27)
    # 21 business days never lands on a weekend.
    assert expected_exit_date(date(2026, 7, 24), 21).weekday() < 5


# ─── direction: the most damaging possible bug ───────────────────────────────

def test_direction_sign_refuses_an_unknown_direction():
    """Defaulting an unrecognised direction to long would invert a short's verdict
    silently. It raises instead."""
    assert direction_sign("long") == 1.0
    assert direction_sign("short") == -1.0
    for bad in ("LONG", "sell", "", None):
        with pytest.raises(ValueError):
            direction_sign(bad)


def test_a_short_that_falls_is_a_hit_and_a_long_that_falls_is_a_miss():
    """Same price path, opposite directions, opposite verdicts — and the signed return
    is symmetric, not merely the same sign."""
    closes = _series(date(2026, 7, 24), [100.0] + [90.0] * 21)  # entry 100, exit 90
    run = date(2026, 7, 24)

    short = resolve_pick(run, "PDD", "short", closes, horizon_days=21)
    long_ = resolve_pick(run, "PDD", "long", closes, horizon_days=21)

    assert short.verdict == "hit" and short.signed_return == pytest.approx(0.10)
    assert long_.verdict == "miss" and long_.signed_return == pytest.approx(-0.10)
    assert short.signed_return == -long_.signed_return


def test_resolution_uses_the_close_on_run_date_as_entry():
    """The pipeline publishes after the US close, so run_date's close is the last price
    observable at publication. Using the NEXT day's open/close would score a book
    against a price it could not have acted on."""
    closes = _series(date(2026, 7, 23), [50.0, 100.0] + [110.0] * 21)
    out = resolve_pick(date(2026, 7, 24), "XLE", "long", closes, horizon_days=21)
    assert out.entry_price == 100.0          # the 24th, not the 23rd's 50.0
    assert out.entry_date == date(2026, 7, 24)


def test_exit_is_counted_in_trading_observations_not_calendar_days():
    """Counting observations avoids needing a market calendar. Horizon 3 must take the
    3rd observation after entry, regardless of the weekend inside it."""
    closes = _series(date(2026, 7, 24), [100.0, 101.0, 102.0, 103.0, 104.0])
    out = resolve_pick(date(2026, 7, 24), "SPY", "long", closes, horizon_days=3)
    assert out.exit_price == 103.0
    assert out.exit_date == closes[3][0]


# ─── pending vs void: two different absences ─────────────────────────────────

def test_an_immature_pick_is_pending_not_void_and_not_a_miss():
    closes = _series(date(2026, 7, 24), [100.0, 101.0, 102.0])   # only 2 observations after
    out = resolve_pick(date(2026, 7, 24), "SHY", "long", closes, horizon_days=21)
    assert out.verdict == "pending"
    assert out.signed_return is None and out.exit_price is None
    assert out.void_reason is None, "pending is not an unscoreable pick"
    assert out.entry_price == 100.0, "the entry is known even before maturity"


def test_a_missing_entry_with_later_prices_is_void_with_a_reason():
    """No close on run_date but the series continues: the entry is genuinely absent and
    no future run will supply it. That is void, and it must say why."""
    closes = _series(date(2026, 7, 27), [100.0] * 25)
    out = resolve_pick(date(2026, 7, 24), "DELISTED", "long", closes, horizon_days=21)
    assert out.verdict == "void"
    assert "no close on run_date" in out.void_reason


def test_an_empty_series_is_pending_not_void():
    """Nothing known yet at all — including the entry — is still 'ask again later'."""
    out = resolve_pick(date(2026, 7, 24), "NEW", "long", [], horizon_days=21)
    assert out.verdict == "pending" and out.void_reason is None


def test_a_nonpositive_price_is_void_rather_than_a_division():
    closes = _series(date(2026, 7, 24), [0.0] + [10.0] * 21)
    out = resolve_pick(date(2026, 7, 24), "BROKEN", "long", closes, horizon_days=21)
    assert out.verdict == "void" and "not a usable price" in out.void_reason


def test_an_exactly_flat_pick_is_not_a_hit():
    closes = _series(date(2026, 7, 24), [100.0] + [100.0] * 21)
    out = resolve_pick(date(2026, 7, 24), "BIL", "long", closes, horizon_days=21)
    assert out.verdict == "flat"
    assert out.signed_return == 0.0


def test_to_row_keeps_nulls_null():
    """A pending row must persist NULL, not 0.0 — 'not computable' and 'zero' are
    different claims (ADR-0066)."""
    row = resolve_pick(date(2026, 7, 24), "SHY", "long", [], horizon_days=21).to_row()
    assert row["signed_return"] is None and row["exit_price"] is None
    assert row["verdict"] == "pending"
    assert row["run_date"] == "2026-07-24"       # ISO, not a date object
    assert row["expected_exit_date"] is not None


# ─── scorecard ───────────────────────────────────────────────────────────────

def _o(verdict, direction="long", signed=None, reason=None, exp=None, horizon=21):
    return Outcome(
        run_date=date(2026, 7, 24), asset="X", direction=direction,
        horizon_days=horizon, verdict=verdict, signed_return=signed,
        void_reason=reason, expected_exit_date=exp,
    )


def test_hit_rate_is_none_not_zero_before_anything_resolves():
    """0.0 would assert every call was wrong. The honest value is 'cannot say yet' —
    exactly the plausible-looking zero design goal 2 forbids."""
    sc = build_scorecard([_o("pending", exp=date(2026, 8, 20)) for _ in range(10)])
    assert sc.total == 10 and sc.pending == 10 and sc.resolved == 0
    assert sc.hit_rate is None
    assert sc.mean_signed_return is None
    assert sc.void_rate is None
    assert sc.first_expected_maturity == date(2026, 8, 20)


def test_void_is_excluded_from_hit_rate_and_reported_separately():
    """Two hits, one miss, one void: the hit rate is 2/3 of the SCORED picks, and the
    void is still visible rather than dropped."""
    sc = build_scorecard([
        _o("hit", signed=0.05), _o("hit", signed=0.02),
        _o("miss", signed=-0.03),
        _o("void", reason="no close on run_date"),
    ])
    assert sc.resolved == 3 and sc.void == 1
    assert sc.hit_rate == pytest.approx(2 / 3)
    assert sc.void_rate == pytest.approx(0.25)   # 1 of 4 MATURED


def test_void_rate_is_denominated_in_matured_picks_not_all_picks():
    """Against the total it would drift toward zero as pending rows accumulate,
    understating how much of the record the spec could not score."""
    rows = [_o("hit", signed=0.01), _o("void", reason="r")] + [_o("pending")] * 98
    sc = build_scorecard(rows)
    assert sc.void_rate == pytest.approx(0.5), "1 void of 2 matured, not 1 of 100"


def test_mean_signed_return_can_be_negative_while_hit_rate_is_high():
    """A book can be right often and still lose money. Both numbers are reported so one
    cannot stand in for the other."""
    sc = build_scorecard([
        _o("hit", signed=0.01), _o("hit", signed=0.01), _o("hit", signed=0.01),
        _o("miss", signed=-0.20),
    ])
    assert sc.hit_rate == 0.75
    assert sc.mean_signed_return < 0


def test_scorecard_splits_by_direction():
    """A book that is only right on its longs is a different book from one that is right
    on both, and the aggregate hides it."""
    sc = build_scorecard([
        _o("hit", "long", 0.05), _o("hit", "long", 0.04),
        _o("miss", "short", -0.02), _o("miss", "short", -0.03),
    ])
    assert sc.hit_rate == 0.5
    assert sc.by_direction["long"]["hit_rate"] == 1.0
    assert sc.by_direction["short"]["hit_rate"] == 0.0


def test_scorecard_ignores_other_horizons():
    """The table holds one row per (pick x horizon); a 63d row must not contaminate the
    21d scorecard."""
    sc = build_scorecard([_o("hit", signed=0.05), _o("miss", signed=-0.05, horizon=63)],
                         horizon_days=21)
    assert sc.total == 1 and sc.hit_rate == 1.0


# ─────────────────────────────────────────────────────────────────────────────────
# `as_of` — the clock that tells "not matured yet" from "matured and unpriceable"
#
# ADR-0204. `resolve_pick` was a pure function with no notion of now, so it could only
# ever answer `pending` for a claim whose price series never arrives: an empty series, or
# one that stops short of the horizon. A name delisted five days into a 21-day horizon has
# five observations forever. The row therefore sat `pending` in perpetuity — recorded,
# counted in `total`, and permanently ungradeable, which is the precise failure ADR-0090's
# title forbids.
#
# The parameter is OPTIONAL and defaults to None, and these tests pin that hardest: with
# no clock the behaviour must be byte-identical, because `commitment_rows` calls
# `resolve_pick` with an empty series at publication and DEPENDS on getting `pending`.
# Recording a claim as void the moment it is published would be catastrophic.

from backend.services.pick_outcomes import (  # noqa: E402
    VOID_GRACE_DAYS,
    commitment_rows,
    eligible_for_resolution,
    earliest_run_date,
    is_gradeable,
)

RUN = date(2026, 7, 30)
EXP = expected_exit_date(RUN)                      # business-day estimate


def _past_grace(exp: date = EXP) -> date:
    """One day past the void grace window — the earliest date a void is allowed."""
    return date.fromordinal(exp.toordinal() + VOID_GRACE_DAYS + 1)


def _inside_grace(exp: date = EXP) -> date:
    """Matured, but still inside the tolerance. A slow day must not void a claim."""
    return date.fromordinal(exp.toordinal() + 1)


def test_no_clock_means_no_void_so_publication_is_unchanged():
    # The property `commitment_rows` rests on. An empty series and no `as_of` is the
    # publication call, and it must stay `pending` forever regardless of how old the
    # run_date is.
    out = resolve_pick(RUN, "ARKK", "short", ())
    assert out.verdict == "pending"
    assert out.void_reason is None
    # And through the real publication path, which passes five positional args.
    rows = commitment_rows(RUN, [{"asset": "ARKK", "direction": "short"}])
    assert [r["verdict"] for r in rows] == ["pending"]
    assert rows[0]["void_reason"] is None


def test_an_empty_series_inside_the_grace_window_is_still_pending():
    # Matured on paper but only just. Voiding here would destroy a live claim because a
    # price feed was a day late, and a void is terminal.
    out = resolve_pick(RUN, "ARKK", "short", (), as_of=_inside_grace())
    assert out.verdict == "pending"


def test_an_empty_series_past_the_grace_window_is_void_naming_the_asset():
    out = resolve_pick(RUN, "ARKK", "short", (), as_of=_past_grace())
    assert out.verdict == "void"
    # The reason has to be checkable, not just present: it names the asset, the date from
    # which no observation exists, and the clock that made the call.
    assert "ARKK" in out.void_reason
    assert RUN.isoformat() in out.void_reason
    assert _past_grace().isoformat() in out.void_reason


def test_a_series_that_stops_short_past_grace_is_void_stating_the_shortfall():
    # Priced at entry, then delisted: 5 of 21 observations, forever.
    series = _series(RUN, [100.0] + [101.0] * 5)
    out = resolve_pick(RUN, "DEAD", "long", series, as_of=_past_grace())
    assert out.verdict == "void"
    assert "5 of 21" in out.void_reason
    # Entry survives on a void — it is the price the claim would have been measured from.
    assert out.entry_price == 100.0
    assert out.entry_date == series[0][0]


def test_a_series_that_stops_short_inside_grace_is_pending_not_void():
    series = _series(RUN, [100.0] + [101.0] * 5)
    out = resolve_pick(RUN, "SLOW", "long", series, as_of=_inside_grace())
    assert out.verdict == "pending"
    assert out.entry_price == 100.0


def test_a_matured_pick_resolves_normally_even_past_grace():
    # `as_of` must only ever convert pending->void. A claim the series CAN score is scored,
    # and the clock has no say in the verdict.
    # Entry + 21 observations after it, the last one higher.
    series = _series(RUN, [100.0] + [100.0] * 20 + [110.0])
    out = resolve_pick(RUN, "UP", "long", series, as_of=_past_grace())
    assert out.verdict == "hit"
    assert out.signed_return > 0


# ── spec_version travels with the row ────────────────────────────────────────────
# It is part of the table's conflict key. Re-stamping a row with today's constant would,
# the day SPEC_VERSION becomes "v2", grade a v1 claim with v2 arithmetic AND write it as a
# new row — abandoning the v1 row as permanently pending. The same defect, by a new route.

def test_the_rows_own_spec_is_echoed_not_replaced_by_the_module_constant():
    out = resolve_pick(RUN, "AAA", "long", (), spec_version="v0")
    assert out.spec_version == "v0"
    assert out.to_row()["spec_version"] == "v0"


def test_spec_defaults_to_the_module_constant_when_not_supplied():
    assert resolve_pick(RUN, "AAA", "long", ()).spec_version == SPEC_VERSION


def test_a_foreign_spec_is_declined_and_reported_not_silently_dropped():
    rows = [
        {"run_date": "2026-07-30", "asset": "A", "spec_version": SPEC_VERSION},
        {"run_date": "2026-07-29", "asset": "B", "spec_version": "v0"},
        {"run_date": "2026-07-28", "asset": "C"},          # absent -> assumed current
    ]
    gradeable, skipped = eligible_for_resolution(rows)
    assert [r["asset"] for r in gradeable] == ["A", "C"]
    assert [r["asset"] for r in skipped] == ["B"]
    assert is_gradeable(rows[0]) and not is_gradeable(rows[1])


def test_earliest_run_date_scopes_the_price_window_to_the_claims_being_graded():
    rows = [
        {"run_date": "2026-07-30"},
        {"run_date": date(2026, 7, 22)},                   # a date object, not a string
        {"run_date": None},
        {"run_date": "not-a-date"},
    ]
    assert earliest_run_date(rows) == date(2026, 7, 22)
    assert earliest_run_date([]) is None
    assert earliest_run_date([{"run_date": None}]) is None
