#!/usr/bin/env python
"""Rebuild the held book from the published recommendation history.

WHAT THIS IS FOR
----------------
`book_holdings` is a series, and a series needs a history. Every published book is
already persisted with its weights and its date, and the held book is a pure
function of that sequence plus prices — so it can be reconstructed rather than
waiting a year for it to accumulate.

WHY THIS IS SAFE TO BACKFILL AND THE L1/L5 STATE IS NOT
-------------------------------------------------------
`scripts/backfill_regime.py` draws the line: a thing may be rebuilt when it is a
pure function of data that is already persisted and was not itself a judgement made
on the day. That holds here. The held book is arithmetic over
`research_recommendations.picks` and adjusted closes — no LLM, no news window, no
scoring decision is being re-made. Contrast the HypeScore and the L5 book, which are
deliberately not backfillable because reconstructing them would invent a state of
knowledge that never existed.

WHAT IT REFUSES TO DO
---------------------
It never writes `portfolio_returns` or `portfolio_cumulative_return`. ADR-0112 drew
that line for the weights backtest — "a simulated series written into it would
assert the book earned returns it did not" — and a reconstructed series is exactly
that. This writes its own tables and the two are compared, never merged.

Dry run by default, like `backfill_regime.py`. `--apply` writes.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.services.held_book import step  # noqa: E402
from backend.services.mandate import DEFAULT_MANDATE  # noqa: E402


def signed_weights(picks) -> dict[str, float]:
    """Signed share of capital per name, from a published picks array."""
    out: dict[str, float] = {}
    for pick in picks or []:
        asset = pick.get("asset")
        if not asset:
            continue
        weight = pick.get("signed_weight")
        if weight is None:
            raw = pick.get("weight")
            if raw is None:
                continue
            weight = -abs(float(raw)) if pick.get("direction") == "short" else abs(float(raw))
        out[asset] = float(weight)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="write to Supabase")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
        return 1

    from supabase import create_client
    import yfinance as yf

    sb = create_client(url, key)
    books = (
        sb.table("research_recommendations")
        .select("run_date, picks")
        .order("run_date", desc=False)
        .execute()
        .data
        or []
    )
    if len(books) < 2:
        print(f"only {len(books)} published book(s) — need at least 2 for a return")
        return 0

    # Every name that has ever been held, priced once.
    assets = sorted({a for b in books for a in signed_weights(b.get("picks"))})
    start, end = books[0]["run_date"], books[-1]["run_date"]
    print(f"pricing {len(assets)} names over {start} .. {end}")
    # yfinance's `end` is EXCLUSIVE, so asking for the last run_date returns
    # everything up to the day before it and the final book silently scores no
    # return. Ask for one day past the end.
    from datetime import date, timedelta

    end_exclusive = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
    prices = yf.download(
        assets, start=start, end=end_exclusive, auto_adjust=True, progress=False
    )["Close"]
    returns = prices.pct_change()

    held: dict[str, float] = {}
    nav = DEFAULT_MANDATE.total_capital
    rows_perf, rows_hold = [], []

    print(f"\n{'date':12} {'turnover':>9} {'cost':>9} {'gross':>9} {'net':>9} {'nav':>14}")
    for book in books:
        run_date = book["run_date"]
        target = signed_weights(book.get("picks"))

        day = returns.loc[run_date].to_dict() if run_date in returns.index else {}
        day = {k: v for k, v in day.items() if v == v}   # drop NaN

        out = step(
            previous_held=held,
            target=target,
            price_returns=day,
            total_capital=DEFAULT_MANDATE.total_capital,
            previous_nav=nav,
        )
        held, nav = out["held"], out["nav"]

        g = out["gross_return"]
        n = out["net_return"]
        print(
            f"{run_date:12} {out['turnover']:>8.1%} {out['cost_pct']:>8.3%} "
            f"{'—' if g is None else format(g, '>8.3%')} "
            f"{'—' if n is None else format(n, '>8.3%')} "
            f"${nav/1e6:>12,.2f}M"
        )

        rows_perf.append({
            "run_date": run_date,
            "turnover": out["turnover"],
            "cost_pct": out["cost_pct"],
            "cost_usd": out["cost_usd"],
            "gross_return": g,
            "net_return": n,
            "nav": nav,
            "tracking_error": out["tracking_error"],
        })
        rows_hold.extend(
            {
                "run_date": run_date,
                "asset": asset,
                "signed_weight": weight,
                "target_weight": target.get(asset),
            }
            for asset, weight in held.items()
        )

    total_cost = sum(r["cost_usd"] for r in rows_perf)
    mean_turnover = sum(r["turnover"] for r in rows_perf) / len(rows_perf)
    print(
        f"\nmean one-way turnover {mean_turnover:.1%} per run · "
        f"total cost ${total_cost:,.0f} · "
        f"final NAV ${nav/1e6:,.2f}M vs ${DEFAULT_MANDATE.total_capital/1e6:,.0f}M start"
    )

    if not args.apply:
        print("\nDRY RUN — pass --apply to write")
        return 0

    sb.table("book_holdings_performance").upsert(rows_perf, on_conflict="run_date").execute()

    # Clear each rebuilt date before inserting, rather than upserting into whatever
    # is already there. An upsert writes the names that ARE held and says nothing
    # about the ones that are not, so a name dropped between two runs of this script
    # keeps its row and the date becomes a union of every book ever written for it.
    for row in rows_perf:
        sb.table("book_holdings").delete().eq("run_date", row["run_date"]).execute()
    for i in range(0, len(rows_hold), 500):
        sb.table("book_holdings").insert(rows_hold[i : i + 500]).execute()
    print(f"\nwrote {len(rows_perf)} performance rows and {len(rows_hold)} holdings rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
