"""Repair the claims that were voided because the market was shut on their run_date.

ONE-OFF, NARROW, AND DELIBERATELY NOT PART OF THE NIGHTLY PATH (ADR-0210).

`resolve_pick` used to take the entry from a bar stamped exactly `run_date`, so a book
published on a day with no session voided its whole claim set. Measured 2026-08-01: all
10 claims from **Saturday 2026-07-25** were `void` with `no close on run_date 2026-07-25`
-- ARKK BABA GDX NOC NUE PDD SHY SVXY UNH XLE, every one a liquid US name holding a
perfectly good Friday 07-24 close. ADR-0210 fixed the rule. This fixes the rows the old
rule already condemned, which the fix alone cannot reach: `void` is terminal, and pass 2
of `resolve_outcomes.py` reads `verdict = 'pending'`.

WHY THIS IS NOT A FLAG ON THE RESOLVER. That `verdict = 'pending'` filter is load-bearing:
it is what stops a yfinance outage writing `pending` with NULL prices over a resolved
`hit` (ADR-0117's rule, applied to the resolver's own upsert). Relaxing it so the nightly
job re-visits terminal rows would re-arm exactly that erasure in order to fix ten rows
once. So the repair is its own act, run once, by hand, with its reasoning attached.

WHAT MAKES IT SAFE TO RUN AT ALL is that the victims are PROVABLE, not guessed. A row
qualifies only if all five hold:

  1. `verdict = 'void'`                    -- a graded claim is never touched
  2. `void_reason` matches the OLD wording `no close on run_date <D>` exactly. The
     post-fix wording is different (`no close for <asset> in <D1>..<D2>`), so this cannot
     match a row written after ADR-0210 -- the predicate expires on its own.
  3. `<D>` in the reason equals the row's own `run_date`
  4. the price series has NO bar on `<D>`      -- the market really was shut
  5. it HAS a bar within ENTRY_LOOKBACK_DAYS before `<D>` -- a prior session really exists

4 and 5 together are the proof. A name whose series merely skips one day, or which stopped
trading before it was picked, fails one of them and is left exactly as it is.

The new verdict is whatever `resolve_pick` says under the fixed rule -- never hand-built.
Today that is `pending` with the Friday entry price, because 07-25's claims mature
2026-08-24; the nightly resolver grades them then, by the ordinary path. If a row comes
back `void` even under the fixed rule it is NOT written: nothing was learned, and
rewriting its reason would churn the record for no gain.

Usage:
    python -m scripts.repair_calendar_voids              # print the diff, write nothing
    python -m scripts.repair_calendar_voids --apply      # write it

Requires SUPABASE_URL + SUPABASE_SERVICE_KEY.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.pick_outcomes import (  # noqa: E402
    ENTRY_LOOKBACK_DAYS,
    SPEC_VERSION,
    resolve_pick,
)
from scripts.resolve_outcomes import CONFLICT_KEY, fetch_closes  # noqa: E402

# The pre-ADR-0210 wording, anchored. Matching the old string is what makes this repair
# self-limiting: the fixed code cannot produce it, so re-running this later finds nothing.
LEGACY_VOID = re.compile(r"^no close on run_date (\d{4}-\d{2}-\d{2})$")


def _as_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def candidates(rows: list[dict]) -> tuple[list[dict], list[tuple[dict, str]]]:
    """Split void rows into (matches the legacy fingerprint, skipped with a reason).

    Pure, so the predicate is testable without a database or a price feed. Rejections are
    RETURNED rather than dropped: a void row this repair declines to touch is a fact worth
    printing, since the whole risk of a repair is touching something it should not.
    """
    take: list[dict] = []
    skip: list[tuple[dict, str]] = []
    for r in rows:
        if r.get("verdict") != "void":
            skip.append((r, f"verdict is {r.get('verdict')!r}, not void"))
            continue
        m = LEGACY_VOID.match((r.get("void_reason") or "").strip())
        if not m:
            skip.append((r, f"void_reason is not the legacy fingerprint: "
                            f"{r.get('void_reason')!r}"))
            continue
        rd = _as_date(r.get("run_date"))
        if rd is None or m.group(1) != rd.isoformat():
            skip.append((r, f"reason names {m.group(1)} but run_date is {r.get('run_date')}"))
            continue
        take.append(r)
    return take, skip


def market_was_shut(run_date: date, series: list[tuple[date, float]]) -> tuple[bool, str]:
    """Did the market really not open on `run_date`, with a session available before it?

    The two halves of the proof. Without the first, a row could be repaired whose series
    simply has a hole. Without the second, a name that stopped trading before it was ever
    picked would be 'repaired' into a claim that still cannot be entered.
    """
    if not series:
        return False, "no price series at all"
    if any(d == run_date for d, _ in series):
        return False, f"a bar EXISTS on {run_date.isoformat()} - void had another cause"
    floor = run_date - timedelta(days=ENTRY_LOOKBACK_DAYS)
    prior = [d for d, _ in series if floor <= d < run_date]
    if not prior:
        return False, (f"no session in {floor.isoformat()}..{run_date.isoformat()} either -"
                       " nothing to enter at")
    return True, f"no bar on {run_date.isoformat()}; prior session {max(prior).isoformat()}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write; default is a dry run")
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.", file=sys.stderr)
        return 2

    from supabase import create_client
    sb = create_client(url, key)

    voids = (
        sb.table("pick_outcomes")
        .select("run_date, asset, direction, horizon_days, spec_version, verdict,"
                " void_reason, entry_price")
        .eq("verdict", "void")
        .order("run_date")
        .execute()
        .data
    ) or []
    print(f"{len(voids)} void rows in the record")

    take, skip = candidates(voids)
    for row, why in skip:
        print(f"  LEAVE {row.get('run_date')} {row.get('asset')}: {why}")
    if not take:
        print("nothing matches the legacy fingerprint - nothing to repair.")
        return 0
    print(f"{len(take)} match the legacy fingerprint")

    run_dates = sorted({_as_date(r["run_date"]) for r in take})
    tickers = sorted({str(r["asset"]) for r in take})
    start = min(run_dates) - timedelta(days=ENTRY_LOOKBACK_DAYS)
    closes = fetch_closes(tickers, start, 21)
    if not closes:
        # Same rule as the resolver: a dead fetch is not evidence about the market.
        print(f"FETCH FAILED: 0 of {len(tickers)} tickers returned data. Writing nothing.",
              file=sys.stderr)
        return 1

    repaired: list[dict] = []
    today = date.today()
    for row in take:
        rd = _as_date(row["run_date"])
        asset, direction = str(row["asset"]), str(row["direction"])
        series = closes.get(asset, [])
        shut, why = market_was_shut(rd, series)
        if not shut:
            print(f"  LEAVE {rd} {asset}: {why}")
            continue
        out = resolve_pick(
            rd, asset, direction, series,
            horizon_days=int(row.get("horizon_days") or 21),
            spec_version=str(row.get("spec_version") or SPEC_VERSION),
            as_of=today,
        )
        if out.verdict == "void":
            print(f"  LEAVE {rd} {asset}: still void under the fixed rule"
                  f" ({out.void_reason})")
            continue
        print(f"  REPAIR {rd} {asset} {direction}: void -> {out.verdict}"
              f" | entry {out.entry_date} @ {out.entry_price} | {why}")
        # `resolved_at` is cleared alongside the verdict: a `pending` row has not been
        # resolved, and leaving a stamp would assert it had.
        repaired.append({**out.to_row(), "resolved_at":
                         today.isoformat() if out.verdict != "pending" else None})

    print(f"\n{len(repaired)} of {len(voids)} void rows repairable")
    if not repaired:
        return 0
    if not args.apply:
        print("dry run: nothing written. Re-run with --apply.")
        return 0

    sb.table("pick_outcomes").upsert(repaired, on_conflict=CONFLICT_KEY).execute()
    print(f"wrote {len(repaired)} repaired rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
