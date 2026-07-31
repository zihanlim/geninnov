"""Resolve published picks against the pre-declared spec, and record the pending ones.

Idempotent and safe to re-run: it upserts on
(run_date, asset, direction, horizon_days, spec_version), so a `pending` row becomes a
verdict when the horizon matures and a resolved row is never re-scored into a different
answer by a later run.

Two jobs, and the first matters more today than the second:

  1. RECORD THE COMMITMENT. Every published pick gets a row as soon as its book exists,
     so the denominator is fixed before any outcome is known. A scored set assembled
     after the fact can quietly omit the calls that went wrong; this cannot.
  2. RESOLVE WHAT HAS MATURED. Nothing matures until ~2026-08-20 (the earliest book is
     2026-07-22 and the horizon is 21 trading days), so on first run every row is
     `pending` — which is the correct output, not an empty result.

Usage:
    python -m scripts.resolve_outcomes                # all books, 21d
    python -m scripts.resolve_outcomes --dry-run      # print, write nothing
    python -m scripts.resolve_outcomes --horizon 63   # a second horizon, additive

Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (the table is anon-read-only).
See ADR-0090.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.pick_outcomes import (  # noqa: E402
    DEFAULT_HORIZON_DAYS,
    SPEC_VERSION,
    build_scorecard,
    resolve_pick,
)


def _parse_date(v) -> date | None:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return datetime.fromisoformat(v[:10]).date()
        except ValueError:
            return None
    return None


def fetch_closes(tickers: list[str], start: date, horizon_days: int) -> dict[str, list[tuple[date, float]]]:
    """Daily closes per ticker from `start` to today.

    Uses auto_adjust=True so the series is total-return-adjusted: an unadjusted series
    would score a dividend payment as a price fall and turn a flat long into a miss.
    """
    import pandas as pd
    import yfinance as yf

    # Pad the window generously — horizon_days is in TRADING days, and the caller may be
    # resolving a book published months ago.
    end = date.today() + timedelta(days=1)
    out: dict[str, list[tuple[date, float]]] = {}
    if not tickers:
        return out

    raw = yf.download(
        tickers=" ".join(sorted(set(tickers))),
        start=start.isoformat(),
        end=end.isoformat(),
        auto_adjust=True,
        progress=False,
        group_by="ticker",
        threads=True,
    )
    if raw is None or len(raw) == 0:
        return out

    for t in sorted(set(tickers)):
        try:
            col = raw[t]["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw["Close"]
        except (KeyError, TypeError):
            continue
        series: list[tuple[date, float]] = []
        for idx, val in col.items():
            if pd.isna(val):
                continue
            d = idx.date() if hasattr(idx, "date") else _parse_date(idx)
            if d is not None:
                series.append((d, float(val)))
        if series:
            out[t] = sorted(series)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=DEFAULT_HORIZON_DAYS)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY.", file=sys.stderr)
        return 2

    from supabase import create_client
    sb = create_client(url, key)

    # ADR-0194 (migration 062): a run_date can now carry a second, non-multi_asset
    # row (e.g. the credit lens), which coexists with but is NEVER entered into
    # pick_outcomes — ADR-0090's falsifiable track record is multi-asset only, and
    # its whole premise is that the denominator is fixed BEFORE any outcome is
    # known. Scoped here, not only at the point picks are first recorded: this
    # script derives its own claim set independently from `research_recommendations`
    # rather than reading back `pick_outcomes`, so an unscoped read would resolve
    # (and upsert) outcomes for credit-lens picks that were never committed as
    # pending in the first place.
    books = (
        sb.table("research_recommendations")
        .select("run_date, picks")
        .eq("lens", "multi_asset")
        .order("run_date")
        .execute()
        .data
    ) or []

    # (run_date, asset, direction) -> deduped. A book upserts on run_date, so a name can
    # legitimately appear once per book; duplicates within one book would double-count.
    claims: set[tuple[date, str, str]] = set()
    for b in books:
        rd = _parse_date(b.get("run_date"))
        if rd is None:
            continue
        for p in b.get("picks") or []:
            asset, direction = p.get("asset"), p.get("direction")
            if asset and direction in ("long", "short"):
                claims.add((rd, asset, direction))

    if not claims:
        print("No published picks found - nothing to record.")
        return 0

    earliest = min(rd for rd, _, _ in claims)
    closes = fetch_closes(sorted({a for _, a, _ in claims}), earliest, args.horizon)

    outcomes = [
        resolve_pick(rd, asset, direction, closes.get(asset, []), horizon_days=args.horizon)
        for rd, asset, direction in sorted(claims)
    ]

    sc = build_scorecard(outcomes, horizon_days=args.horizon)
    by_verdict: dict[str, int] = defaultdict(int)
    for o in outcomes:
        by_verdict[o.verdict] += 1

    # ASCII only, and every print sits BEFORE the upsert. A Unicode separator here
    # raises UnicodeEncodeError on a cp1252 stdout and kills the run before it writes —
    # the same defect ADR-0059 hit in backtest_hype (froze the /method IC panel) and
    # ADR-0065's follow-up hit in check_data_integrity. Twice is enough.
    print(f"spec {SPEC_VERSION} | horizon {args.horizon} trading days | {sc.total} claims")
    print("  " + " | ".join(f"{k}={v}" for k, v in sorted(by_verdict.items())))
    print(f"  hit_rate={sc.hit_rate if sc.hit_rate is not None else 'not yet answerable'}"
          f" | void_rate={sc.void_rate if sc.void_rate is not None else 'n/a'}")
    if sc.first_expected_maturity:
        print(f"  first expected maturity {sc.first_expected_maturity.isoformat()} (business-day estimate)")
    for o in outcomes:
        if o.verdict == "void":
            print(f"  VOID {o.run_date} {o.asset} {o.direction}: {o.void_reason}")

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return 0

    rows = [o.to_row() for o in outcomes]
    sb.table("pick_outcomes").upsert(
        rows, on_conflict="run_date,asset,direction,horizon_days,spec_version"
    ).execute()
    print(f"\nUpserted {len(rows)} rows into pick_outcomes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
