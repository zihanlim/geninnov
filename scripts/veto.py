"""
Author, list and revoke editorial vetoes — the operator side of ADR-0171.

WHY THIS SCRIPT EXISTS AT ALL. `editorial_vetoes` is service-role-write by RLS,
because authoring a refusal is an operator action rather than something a page
visitor does. Without a way to write one, the table is schema nobody can use — so
this is the interface, and it is deliberately a CLI and not a UI: a veto is an
infrequent, considered act, and the review it deserves is a command you have to
type rather than a button beside a position.

WHAT IT REFUSES TO DO, and why each refusal matters more than the feature:

  * It never edits a published book. A veto acts on the NEXT run. `pick_outcomes`
    anchors `entry` to the close on `run_date` (ADR-0090), so substituting a name
    into an already-published book would score the substitute from a price that
    preceded the decision — a track record an operator could launder by editing
    history. (This once cited a second harm, that a replaced name would quietly
    stop being resolved; ADR-0205 made resolution read the RECORD rather than the
    current picks, so that no longer happens. The hindsight-price harm stands.)
  * It never DELETES a veto. `--revoke` sets `revoked_at` and demands a reason, so
    "why is this name back?" stays answerable.
  * It will not write a veto with no reason. The DB enforces this too; the check
    here exists so the failure is a readable message rather than a constraint
    violation, and so a typo is caught before it reaches the table.

Usage:

    # what is in force right now
    python -m scripts.veto list

    # refuse a name on one side, until a date
    python -m scripts.veto add SLV --short \\
        --reason "attention is one news cycle, not a signal" \\
        --by zihan --until 2026-08-15

    # refuse it on both sides, permanently (until revoked)
    python -m scripts.veto add SLV --reason "..." --by zihan

    # put it back
    python -m scripts.veto revoke <id> --reason "spread normalised; objection spent"

    # see what today's pool WOULD lose, writing nothing
    python -m scripts.veto dry-run

Requires SUPABASE_URL and SUPABASE_SERVICE_KEY.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.editorial_vetoes import (  # noqa: E402
    active_on,
    apply_vetoes,
    parse_vetoes,
)


def _client():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not (url and key):
        print("[veto] SUPABASE_URL and SUPABASE_SERVICE_KEY are required.")
        sys.exit(1)
    from supabase import create_client

    return create_client(url, key)


def cmd_list(args) -> int:
    sb = _client()
    rows = (
        sb.table("editorial_vetoes")
        .select("id, asset, direction, reason, decided_by, decided_at, expires_on, "
                "revoked_at, revoked_reason")
        .order("decided_at", desc=True)
        .execute()
        .data
    ) or []
    if not rows:
        print("No vetoes have ever been authored.")
        return 0

    today = date.today()
    live = parse_vetoes([r for r in rows if not r.get("revoked_at")])
    in_force = {(v.asset.upper(), v.direction) for v in active_on(live, today)}

    print(f"{len(rows)} veto(es) on record. Active on {today.isoformat()}:\n")
    for r in rows:
        key = ((r.get("asset") or "").upper(), r.get("direction"))
        if r.get("revoked_at"):
            state = f"REVOKED  ({r.get('revoked_reason')})"
        elif key in in_force:
            state = "ACTIVE"
        else:
            # Authored, not revoked, but its expiry has passed. Distinguished from
            # ACTIVE and from REVOKED because "it lapsed" and "I withdrew it" are
            # different decisions and the record should not blur them.
            state = f"LAPSED   (expired {r.get('expires_on')})"
        side = r.get("direction") or "both"
        print(f"  [{state:<28}] {r['asset']:<6} {side:<5}  {r['reason']}")
        print(f"      by {r.get('decided_by')} at {r.get('decided_at')}   id={r['id']}")
    return 0


def cmd_add(args) -> int:
    reason = (args.reason or "").strip()
    if not reason:
        print("[veto] --reason is required and cannot be blank. The reason IS the "
              "editorial judgment; without it an absent name is indistinguishable "
              "from a screen bug.")
        return 1
    if args.long and args.short:
        print("[veto] Pass --long, --short, or neither (neither = both sides). "
              "Passing both is ambiguous: say nothing to mean both.")
        return 1

    direction = "long" if args.long else "short" if args.short else None
    row = {
        "asset": args.asset.strip().upper(),
        "direction": direction,
        "reason": reason,
        "decided_by": args.by.strip(),
    }
    if args.until:
        row["expires_on"] = args.until

    sb = _client()
    out = sb.table("editorial_vetoes").insert(row).execute().data
    vid = (out or [{}])[0].get("id", "?")
    side = direction or "both sides"
    until = f" until {args.until}" if args.until else " (permanent until revoked)"
    print(f"Vetoed {row['asset']} {side}{until}.")
    print(f"  reason: {reason}")
    print(f"  id:     {vid}")
    print("\nThis takes effect on the NEXT pipeline run. No published book changed.")
    return 0


def cmd_revoke(args) -> int:
    reason = (args.reason or "").strip()
    if not reason:
        print("[veto] --reason is required to revoke. An unexplained reinstatement "
              "leaves a hole exactly where a reader asks 'so why is it back?'.")
        return 1
    sb = _client()
    out = (
        sb.table("editorial_vetoes")
        .update({"revoked_at": "now()", "revoked_reason": reason})
        .eq("id", args.id)
        .execute()
        .data
    )
    if not out:
        print(f"[veto] No veto with id {args.id}.")
        return 1
    print(f"Revoked {out[0].get('asset')}. The row is retained, not deleted.")
    return 0


def cmd_dry_run(args) -> int:
    """Show what today's live candidate pool would lose. Writes nothing."""
    sb = _client()
    vetoes = active_on(
        parse_vetoes(
            (
                sb.table("editorial_vetoes")
                .select("asset, direction, reason, decided_by, decided_at, expires_on")
                .is_("revoked_at", "null")
                .execute()
                .data
            )
            or []
        ),
        date.today(),
    )
    if not vetoes:
        print("No active vetoes -- nothing would be removed.")
        return 0

    # The pool as the last published run saw it. This is an approximation of what
    # the NEXT run will screen, not a prediction of it: the pool is rebuilt daily
    # from fresh scores, so a name absent today may be present tomorrow. Said
    # plainly rather than implied, because a dry run that looks authoritative about
    # tomorrow would be the more misleading of the two options.
    rows = (
        sb.table("trade_candidates")
        .select("asset, direction, run_date")
        .order("run_date", desc=True)
        .limit(200)
        .execute()
        .data
    ) or []
    if not rows:
        print(f"{len(vetoes)} active veto(es), but trade_candidates is empty -- "
              "nothing to test them against.")
        return 0

    latest = rows[0]["run_date"]
    pool = [r for r in rows if r["run_date"] == latest]
    res = apply_vetoes(pool, vetoes)
    print(f"Against the {latest} candidate pool ({len(pool)} names):")
    if not res.dropped:
        print(f"  {len(vetoes)} veto(es) in force; none match. Nothing removed.")
    for c, v in res.dropped:
        print(f"  - {c['asset']} {c['direction']}: {v.reason} ({v.decided_by})")
    print("\nApproximate: the pool is rebuilt from fresh scores each run, so "
          "tomorrow's may differ. Nothing was written.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(prog="veto", description=__doc__.split("\n")[1])
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="every veto on record, with its state")

    a = sub.add_parser("add", help="refuse a candidate on the next run")
    a.add_argument("asset")
    a.add_argument("--long", action="store_true", help="refuse the LONG side only")
    a.add_argument("--short", action="store_true", help="refuse the SHORT side only")
    a.add_argument("--reason", required=True)
    a.add_argument("--by", required=True, help="who decided")
    a.add_argument("--until", metavar="YYYY-MM-DD",
                   help="expiry, inclusive. Omit for permanent-until-revoked.")

    r = sub.add_parser("revoke", help="retire a veto (never deletes it)")
    r.add_argument("id")
    r.add_argument("--reason", required=True)

    sub.add_parser("dry-run", help="what the latest pool would lose; writes nothing")

    args = p.parse_args()
    return {
        "list": cmd_list,
        "add": cmd_add,
        "revoke": cmd_revoke,
        "dry-run": cmd_dry_run,
    }[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
