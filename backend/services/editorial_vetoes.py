"""
Editorial judgment — the step where a human declines a candidate.

WHAT THIS IS FOR.
Every other filter in this pipeline is a rule: HypeScore >= threshold, |EdgeScore|
decisive, factor R^2 >= 0.10, lens membership, correlation-complex caps. Rules
cannot express "the attention on this name is a single news cycle, not a signal" —
that is a judgement about whether the measurement means what it appears to mean,
and no threshold encodes it. This module is where that judgement enters, with a
reason attached and an audit trail behind it.

WHY IT ACTS FORWARD ONLY.
`pick_outcomes` anchors `entry` to the close on `run_date` (ADR-0090), and
`scripts/resolve_outcomes.py` re-derives its claim set from the CURRENT `picks` on
every run. So editing a published book to remove a name would (a) stop that name
being resolved at all and (b) let a substitute inherit an entry price from before
the decision — a free look at hindsight. A veto therefore changes what the NEXT
run may choose and never touches a row that has been published. The published book
stays the book of record (ADR-0040).

Pure by construction: every function here takes rows and returns rows. The Supabase
read lives in `fetch_active_vetoes`, which is the only thing in this file that
touches the network, and it is separated so the decision logic can be tested
without one.

See ADR-0171.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable, Optional, Sequence


@dataclass(frozen=True)
class Veto:
    """One active editorial refusal. Mirrors an `editorial_vetoes` row."""

    asset: str
    #: None means both sides — see the migration comment on `direction`.
    direction: Optional[str]
    reason: str
    decided_by: str
    decided_at: Optional[datetime] = None
    expires_on: Optional[date] = None

    def covers(self, asset: str, direction: str) -> bool:
        """Does this veto refuse `(asset, direction)`?

        Asset match is case-insensitive because tickers arrive from several
        providers with inconsistent casing, and a veto that misses because someone
        typed `tlt` would fail silently — the name would simply appear in the book
        as though nobody had objected.
        """
        if self.asset.strip().upper() != asset.strip().upper():
            return False
        return self.direction is None or self.direction == direction


def parse_vetoes(rows: Iterable[dict[str, Any]]) -> list[Veto]:
    """`editorial_vetoes` rows → `Veto` objects, skipping malformed ones.

    A row missing `asset` or `reason` is skipped rather than raising: the daily run
    must not fail because a veto was authored badly, and the alternative — letting
    a reasonless veto through — would remove a name from the book with nothing to
    show a reader who asks why.
    """
    out: list[Veto] = []
    for r in rows:
        asset = (r.get("asset") or "").strip()
        reason = (r.get("reason") or "").strip()
        if not asset or not reason:
            continue
        direction = r.get("direction")
        if direction not in ("long", "short", None):
            direction = None
        out.append(
            Veto(
                asset=asset,
                direction=direction,
                reason=reason,
                decided_by=(r.get("decided_by") or "unattributed").strip(),
                decided_at=_parse_ts(r.get("decided_at")),
                expires_on=_parse_date(r.get("expires_on")),
            )
        )
    return out


def active_on(vetoes: Sequence[Veto], on_date: date) -> list[Veto]:
    """The vetoes in force on `on_date`.

    Expiry is INCLUSIVE of the expiry day: `expires_on = 2026-07-30` means the veto
    still applies to the 07-30 run and not to 07-31. A PM writing "hold off until
    the 30th" means through the 30th, and the off-by-one in the other direction
    silently re-admits a name a day early.

    Revocation is not handled here — `fetch_active_vetoes` filters `revoked_at IS
    NULL` in the query, because a revoked veto should not travel this far.
    """
    return [v for v in vetoes if v.expires_on is None or v.expires_on >= on_date]


@dataclass(frozen=True)
class VetoResult:
    """The outcome of applying vetoes to a candidate pool."""

    kept: list[dict[str, Any]]
    #: (candidate, the veto that refused it) — carried so the funnel stage can name
    #: the reason rather than only the count. A funnel that says "2 removed" without
    #: saying why is the shape ADR-0025 rule 2 exists to prevent.
    dropped: list[tuple[dict[str, Any], Veto]]

    @property
    def n_dropped(self) -> int:
        return len(self.dropped)


def apply_vetoes(
    pool: Sequence[dict[str, Any]],
    vetoes: Sequence[Veto],
) -> VetoResult:
    """Split `pool` into kept and vetoed, preserving order.

    Order is preserved because the caller sorts by conviction and truncates at 30
    (ADR-0046); re-ordering here would change which names survive that cap for a
    reason unrelated to conviction.

    First matching veto wins. Two vetoes can cover one candidate (a both-sides veto
    and a direction-specific one), and reporting it twice would double-count the
    attrition in the funnel.
    """
    kept: list[dict[str, Any]] = []
    dropped: list[tuple[dict[str, Any], Veto]] = []
    for c in pool:
        asset = c.get("asset") or ""
        direction = c.get("direction") or ""
        match = next((v for v in vetoes if v.covers(asset, direction)), None)
        if match is None:
            kept.append(c)
        else:
            dropped.append((c, match))
    return VetoResult(kept=kept, dropped=dropped)


def funnel_stage(result: VetoResult, n_active: int) -> dict[str, Any]:
    """The `screening_funnel` entry describing this stage, for `/book`.

    Shaped like the ADR-0046 conviction-override stage: it appears even when it
    removed nothing, because a funnel that only lists stages which fired implies
    the ones that did not do not exist. A reader should be able to see that
    editorial judgment was available and declined to act.

    The reasons are quoted verbatim. A veto's whole content is its reason, and
    paraphrasing it here would put an authored string in front of a reader that
    nobody actually wrote — the failure ADR-0025 rule 1 forbids.
    """
    if result.n_dropped == 0:
        reason = (
            f"{n_active} editorial veto{'' if n_active == 1 else 'es'} in force; none "
            "matched today's pool."
            if n_active
            else "No editorial vetoes in force. Every candidate the rules admitted was allowed."
        )
    else:
        detail = "; ".join(
            f"{c.get('asset')} {c.get('direction')} — {v.reason} ({v.decided_by})"
            for c, v in result.dropped
        )
        reason = (
            f"{result.n_dropped} candidate{'' if result.n_dropped == 1 else 's'} "
            f"refused by a human, not by a rule: {detail}"
        )
    return {
        "stage": "editorial veto (ADR-0171)",
        "remaining": len(result.kept),
        "removed": result.n_dropped,
        "reason": reason,
    }


def fetch_active_vetoes(supabase_url: str, supabase_key: str, on_date: date) -> list[Veto]:
    """Read the vetoes in force on `on_date`.

    Degrades to an empty list on any failure, with a printed warning. That
    direction is deliberate: an unreachable veto table must not stop the book being
    published, and the alternative default — refusing everything — would empty the
    book on a network blip. The cost is that a veto can silently fail to apply, so
    the warning names the table.
    """
    try:
        from supabase import create_client

        sb = create_client(supabase_url, supabase_key)
        rows = (
            sb.table("editorial_vetoes")
            .select("asset, direction, reason, decided_by, decided_at, expires_on")
            .is_("revoked_at", "null")
            .execute()
            .data
        ) or []
    except Exception as exc:  # noqa: BLE001 — see the docstring
        print(
            "[editorial_vetoes] Could not read editorial_vetoes "
            f"({type(exc).__name__}: {exc}). Proceeding with NO vetoes applied — "
            "any refusal authored there is not in force for this run."
        )
        return []
    return active_on(parse_vetoes(rows), on_date)


def _parse_date(v: Any) -> Optional[date]:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str) and v:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def _parse_ts(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v
    if isinstance(v, str) and v:
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None
