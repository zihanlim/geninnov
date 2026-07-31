"""The calendar-void repair touches ONLY provable victims (ADR-0210).

A repair script's whole risk is what it touches by mistake. `resolve_pick`'s fix cannot
reach the rows the old rule already condemned -- `void` is terminal and pass 2 reads
`verdict = 'pending'` -- so a one-off repair is needed; but a repair that over-reaches
would rewrite the record on a guess.

The predicate is therefore five conjunctions (see the module docstring), and these tests
attack it from the direction that matters: what must it REFUSE?
"""

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.services.pick_outcomes import ENTRY_LOOKBACK_DAYS  # noqa: E402
from scripts.repair_calendar_voids import (  # noqa: E402
    LEGACY_VOID,
    candidates,
    market_was_shut,
)

SAT = date(2026, 7, 25)
FRI = date(2026, 7, 24)


def _row(**kw):
    base = {
        "run_date": SAT.isoformat(), "asset": "XLE", "direction": "long",
        "horizon_days": 21, "spec_version": "v1", "verdict": "void",
        "void_reason": f"no close on run_date {SAT.isoformat()}",
    }
    base.update(kw)
    return base


def _weekdays(start: date, n: int, skip: set[date] = frozenset()):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5 and d not in skip:
            out.append((d, 100.0))
        d = date.fromordinal(d.toordinal() + 1)
    return out


# ── the fingerprint ─────────────────────────────────────────────────────────────

def test_the_live_ten_are_selected():
    rows = [_row(asset=a) for a in
            ("ARKK", "BABA", "GDX", "NOC", "NUE", "PDD", "SHY", "SVXY", "UNH", "XLE")]
    take, skip = candidates(rows)
    assert len(take) == 10 and not skip


def test_a_graded_claim_is_never_a_candidate():
    """The one thing this script must never do is disturb a verdict."""
    for verdict in ("hit", "miss", "flat", "pending"):
        take, skip = candidates([_row(verdict=verdict)])
        assert not take and len(skip) == 1


def test_a_void_with_any_other_reason_is_left_alone():
    """The other void causes are real and must survive: a genuinely unpriceable name, a
    short series, a bad print. Only the calendar fingerprint qualifies."""
    for reason in (
        "only 5 of 21 observations after 2026-07-25; series ends 2026-08-01",
        "entry close is 0.0, not a usable price",
        "no price observations for OLD on or after 2026-07-25 as of 2026-08-20",
        "no close for XLE in 2026-07-21..2026-07-25 (entry window ending run_date)",
        None,
        "",
    ):
        take, skip = candidates([_row(void_reason=reason)])
        assert not take, f"claimed a row it should not: {reason!r}"
        assert len(skip) == 1


def test_the_post_fix_wording_can_never_match_so_the_repair_expires():
    """The predicate is anchored to the OLD string. ADR-0210's code cannot emit it, so
    re-running this after the repair finds nothing -- which is what keeps a one-off script
    from becoming a standing licence to rewrite terminal rows."""
    post_fix = "no close for XLE in 2026-07-21..2026-07-25 (entry window ending run_date)"
    assert LEGACY_VOID.match(post_fix) is None
    assert LEGACY_VOID.match(f"no close on run_date {SAT.isoformat()}") is not None


def test_a_reason_naming_a_different_date_than_run_date_is_rejected():
    take, skip = candidates([_row(void_reason="no close on run_date 2026-07-20")])
    assert not take and "but run_date is" in skip[0][1]


def test_the_fingerprint_is_anchored_not_a_substring_search():
    """An unanchored match would accept a longer reason that merely CONTAINS the phrase."""
    assert LEGACY_VOID.match(
        f"no close on run_date {SAT.isoformat()} (and the ticker was delisted)") is None


# ── the proof: the market really was shut ───────────────────────────────────────

def test_the_saturday_case_is_proven_shut():
    series = _weekdays(date(2026, 7, 20), 25)          # weekdays only: no 07-25 bar
    shut, why = market_was_shut(SAT, series)
    assert shut and FRI.isoformat() in why


def test_a_bar_on_run_date_means_the_void_had_another_cause():
    """The decisive refusal. If the market DID open, this row was void for some other
    reason and repairing it would be inventing a diagnosis."""
    series = _weekdays(date(2026, 7, 20), 25) + [(SAT, 50.0)]
    shut, why = market_was_shut(SAT, series)
    assert not shut and "a bar EXISTS" in why


def test_a_name_that_stopped_trading_before_the_pick_is_not_repaired():
    """No bar on run_date AND no session within the look-back: there is nothing to enter
    at, so this claim is correctly void and must stay void. Without this half of the proof
    the repair would resurrect exactly the claims that cannot be graded."""
    stale = _weekdays(date(2026, 6, 1), 5)             # ends ~7 weeks before run_date
    shut, why = market_was_shut(SAT, stale)
    assert not shut and "nothing to enter at" in why


def test_an_empty_series_is_not_evidence_the_market_was_shut():
    shut, why = market_was_shut(SAT, [])
    assert not shut and "no price series" in why


def test_the_proof_reaches_exactly_as_far_as_the_entry_rule():
    """The look-back here and in `resolve_pick` must agree. If the proof reached further
    than the entry rule, a row could pass the proof and then still fail to be entered."""
    bar = SAT - timedelta(days=ENTRY_LOOKBACK_DAYS)
    assert market_was_shut(SAT, [(bar, 100.0)])[0] is True
    just_past = SAT - timedelta(days=ENTRY_LOOKBACK_DAYS + 1)
    assert market_was_shut(SAT, [(just_past, 100.0)])[0] is False
