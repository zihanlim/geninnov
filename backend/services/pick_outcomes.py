"""
Forward track record — resolve published picks against a fixed, pre-declared spec.

Everything else in the repo that validates anything looks BACKWARD at signals:
`backtest_edge.py` and `backtest_hype.py` compute IC on historical panels,
`replication_test.py` measures agent churn on frozen inputs. Nothing scored the books
the platform actually published. This module is the forward half.

THE SPEC (v1), fixed 2026-07-26, while nothing had matured:

    entry   = the close on run_date. The pipeline runs at 21:30 UTC after the US
              close, so run_date's close is the last price observable when the book
              was published, and therefore the only honest entry.
    exit    = the close HORIZON_DAYS trading observations later.
    signed  = (exit / entry - 1) * (+1 long, -1 short)
    verdict = hit if signed > 0, miss if signed < 0, flat if exactly 0,
              void if the series cannot supply both ends.

Deliberately NOT here:

  * A Brier score. It needs a calibrated probability; `conviction` is a sizing input
    (edge / vol), not a probability the call is right. Mapping one to the other would
    be a modelling claim dressed as a metric.
  * `picks[].time_horizon`. It is free text authored by L5 with two fuzzy values, and
    it is not stable for the same position across runs — NOC short read "2-4 weeks" on
    2026-07-24 and "1-3 months" on 2026-07-25. A model that picks its own horizon
    grades its own exam. The horizon is assigned here instead, deterministically.

See ADR-0090.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterable, Optional, Sequence

# 21 trading days ~ one month. Chosen to match `backtest_edge.py`, which already
# computes IC against forward 1-MONTH returns: if /method reports signal IC on one
# window and the scorecard resolves on another, the two instruments disagree about what
# "works" means. Additional horizons are additive — the table is keyed by horizon_days.
DEFAULT_HORIZON_DAYS = 21

SPEC_VERSION = "v1"


@dataclass
class Outcome:
    """One (pick x horizon) verdict. Mirrors a `pick_outcomes` row."""
    run_date: date
    asset: str
    direction: str
    horizon_days: int
    verdict: str                       # pending | hit | miss | flat | void
    spec_version: str = SPEC_VERSION
    void_reason: Optional[str] = None
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    entry_date: Optional[date] = None
    exit_date: Optional[date] = None
    signed_return: Optional[float] = None
    expected_exit_date: Optional[date] = None

    def to_row(self) -> dict:
        """Supabase payload. Dates are ISO strings; None stays None so a missing value
        persists as NULL rather than as a plausible zero (ADR-0066)."""
        def d(v):
            return v.isoformat() if v is not None else None
        return {
            "run_date": d(self.run_date),
            "asset": self.asset,
            "direction": self.direction,
            "horizon_days": self.horizon_days,
            "spec_version": self.spec_version,
            "verdict": self.verdict,
            "void_reason": self.void_reason,
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "entry_date": d(self.entry_date),
            "exit_date": d(self.exit_date),
            "signed_return": self.signed_return,
            "expected_exit_date": d(self.expected_exit_date),
        }


def direction_sign(direction: str) -> float:
    """+1 long, -1 short. Unknown directions raise rather than defaulting to long —
    silently scoring a short as a long would invert its verdict, which is the single
    most damaging error this module could make (compare ADR-0041)."""
    if direction == "long":
        return 1.0
    if direction == "short":
        return -1.0
    raise ValueError(f"unscoreable direction {direction!r}: expected 'long' or 'short'")


def expected_exit_date(run_date: date, horizon_days: int = DEFAULT_HORIZON_DAYS) -> date:
    """Business-day arithmetic from run_date, ignoring market holidays.

    An ESTIMATE, and labelled as one everywhere it surfaces — holidays push the true
    date later, never earlier, so this is a lower bound on when a pick matures. The
    authoritative date is the one taken from the price series.
    """
    d, remaining = run_date, horizon_days
    while remaining > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            remaining -= 1
    return d


def resolve_pick(
    run_date: date,
    asset: str,
    direction: str,
    closes: Sequence[tuple[date, float]],
    horizon_days: int = DEFAULT_HORIZON_DAYS,
) -> Outcome:
    """Resolve one pick against a price series.

    `closes` is (date, close) ascending; it may span any range. The entry is the
    observation ON run_date, and the exit is the `horizon_days`-th observation strictly
    after it, so the count is in TRADING days and needs no market calendar.

    A pick the series cannot score comes back `void` with a reason, or `pending` when it
    simply has not matured yet. Neither is a miss, and conflating either with one would
    flatter or damage the record for a reason that has nothing to do with the call.
    """
    exp = expected_exit_date(run_date, horizon_days)
    base = dict(
        run_date=run_date, asset=asset, direction=direction,
        horizon_days=horizon_days, expected_exit_date=exp,
    )

    sign = direction_sign(direction)
    series = sorted(closes)

    entry = next(((d, p) for d, p in series if d == run_date), None)
    if entry is None:
        # No observation on the publication date at all. Distinguish "the market was
        # shut / this name has no history" from "not matured yet": if later prices
        # exist, the entry is genuinely missing and no future run will supply it.
        if any(d > run_date for d, _ in series):
            return Outcome(**base, verdict="void",
                           void_reason=f"no close on run_date {run_date.isoformat()}")
        return Outcome(**base, verdict="pending")

    entry_date, entry_price = entry
    if entry_price is None or entry_price <= 0:
        return Outcome(**base, verdict="void",
                       void_reason=f"entry close is {entry_price!r}, not a usable price")

    after = [(d, p) for d, p in series if d > run_date]
    if len(after) < horizon_days:
        # Not enough observations YET. Pending, not void — a later run resolves it.
        return Outcome(**base, verdict="pending",
                       entry_price=entry_price, entry_date=entry_date)

    exit_date, exit_price = after[horizon_days - 1]
    if exit_price is None or exit_price <= 0:
        return Outcome(**base, verdict="void",
                       void_reason=f"exit close on {exit_date.isoformat()} is {exit_price!r}",
                       entry_price=entry_price, entry_date=entry_date)

    signed = (exit_price / entry_price - 1.0) * sign
    verdict = "hit" if signed > 0 else "miss" if signed < 0 else "flat"
    return Outcome(**base, verdict=verdict, entry_price=entry_price, entry_date=entry_date,
                   exit_price=exit_price, exit_date=exit_date, signed_return=signed)


@dataclass
class Scorecard:
    """Aggregate over resolved outcomes. Every count is reported, including the ones
    that make the record look worse or thinner than a hit rate alone would suggest."""
    horizon_days: int
    total: int = 0
    resolved: int = 0
    pending: int = 0
    void: int = 0
    hits: int = 0
    misses: int = 0
    flats: int = 0
    hit_rate: Optional[float] = None          # None until something resolves
    mean_signed_return: Optional[float] = None
    void_rate: Optional[float] = None
    first_expected_maturity: Optional[date] = None
    by_direction: dict = field(default_factory=dict)


def build_scorecard(
    outcomes: Iterable[Outcome], horizon_days: int = DEFAULT_HORIZON_DAYS
) -> Scorecard:
    """Aggregate outcomes into the numbers the scorecard renders.

    `hit_rate` is None — never 0.0 — when nothing has resolved. Zero would assert that
    every call was wrong; the honest statement is that the question cannot be answered
    yet, and 0.0 is exactly the plausible-looking value design goal 2 forbids.

    The void rate is denominated in MATURED picks (resolved + void), not in all picks:
    against the total it would drift toward zero purely because pending rows keep being
    added, understating how much of the record the spec could not score.
    """
    rows = [o for o in outcomes if o.horizon_days == horizon_days]
    sc = Scorecard(horizon_days=horizon_days, total=len(rows))

    scored: list[Outcome] = []
    pending_dates: list[date] = []
    for o in rows:
        if o.verdict == "pending":
            sc.pending += 1
            if o.expected_exit_date is not None:
                pending_dates.append(o.expected_exit_date)
        elif o.verdict == "void":
            sc.void += 1
        else:
            scored.append(o)
            sc.hits += o.verdict == "hit"
            sc.misses += o.verdict == "miss"
            sc.flats += o.verdict == "flat"

    sc.resolved = len(scored)
    if pending_dates:
        sc.first_expected_maturity = min(pending_dates)

    matured = sc.resolved + sc.void
    if matured:
        sc.void_rate = sc.void / matured
    if scored:
        sc.hit_rate = sc.hits / len(scored)
        vals = [o.signed_return for o in scored if o.signed_return is not None]
        if vals:
            sc.mean_signed_return = sum(vals) / len(vals)

    for side in ("long", "short"):
        side_rows = [o for o in scored if o.direction == side]
        if side_rows:
            sc.by_direction[side] = {
                "resolved": len(side_rows),
                "hit_rate": sum(o.verdict == "hit" for o in side_rows) / len(side_rows),
            }
    return sc


def commitment_rows(
    run_date: date,
    picks: Sequence[dict],
    horizon_days: int = DEFAULT_HORIZON_DAYS,
) -> list[dict]:
    """The claim, recorded at publication, before any price for it exists.

    ADR-0090's first job is *record the commitment*: every published pick gets a row as
    soon as its book exists, so the denominator is fixed before any outcome is known. A
    scored set assembled after the fact can quietly omit the calls that went wrong.

    That guarantee was **not enforced by the publishing path**. The only writer was
    `scripts/resolve_outcomes.py`, invoked as a sibling step in `daily-refresh.yml`, so
    a book published any other way — a manual `python -m scripts.daily_refresh`, a
    `workflow_dispatch` that failed after the L5 step — published claims nothing ever
    recorded. Measured on 2026-07-27: **9 of 32 published claims (28%) had no row**, and
    they would simply never have been graded.

    Needs no network and no prices, which is the point: `resolve_pick` on an empty series
    already returns `pending`, so recording a commitment cannot fail for the reasons
    fetching prices can. Publication and commitment then succeed or fail together.

    Deduped on (asset, direction): a book upserts on `run_date`, so a name may appear
    once per book, and a duplicate inside one book would double-count the denominator.
    """
    seen: set[tuple[str, str]] = set()
    rows: list[dict] = []
    for pick in picks or []:
        asset, direction = pick.get("asset"), pick.get("direction")
        if not asset or direction not in ("long", "short"):
            continue
        key = (str(asset), str(direction))
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            resolve_pick(run_date, str(asset), str(direction), (), horizon_days).to_row()
        )
    return rows
