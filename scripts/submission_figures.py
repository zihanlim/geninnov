#!/usr/bin/env python3
"""Print every figure `email/submission.md` cites, for one run_date.

WHY THIS EXISTS. The submission quotes ~30 numbers and every one of them is read
from a published row rather than composed. The book is republished nightly, so
those numbers go stale on a schedule -- and a document that says "read from the
published run" while quoting a superseded one is worse than one that says
nothing, because it invites a reviewer to check and find a mismatch.

This is the refresh. It reads the same two tables the document does and prints
the figures grouped in the document's own order, so updating it is a diff rather
than an archaeology exercise.

It is ALSO the audit. Run it against the run_date the document currently claims
and every number should match what is written. A mismatch means the document
drifted, and finding that here is much cheaper than a reviewer finding it.

Read-only. It writes nothing, and takes no --apply flag, because there is
nothing here to apply -- the same contract `scripts/watch_phrases.py` has.

    python -m scripts.submission_figures                 # latest run_date
    python -m scripts.submission_figures 2026-07-30      # a specific one
    python -m scripts.submission_figures --compare 2026-07-30 2026-07-31

Needs SUPABASE_URL + SUPABASE_SERVICE_KEY, like every other script here.
"""
from __future__ import annotations

import os
import sys
from typing import Any

# Windows consoles default to cp1252, and this script prints data it does not
# control: `Fallen Angel (IG → HY downgrade)` is a scenario LABEL stored in
# Supabase, and the em-dash below is how absence renders. Without this the run
# dies with UnicodeEncodeError halfway through the credit book -- after printing
# the multi-asset figures, so it looks like a data problem rather than a console
# one. Reconfigure rather than transliterate: the arrow is in the label because
# the label means it.
try:  # pragma: no cover - depends on the host console, not on logic
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is convenience, not a dependency
    pass

from supabase import create_client


def _client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
    return create_client(url, key)


def _pct(x: Any, dp: int = 1) -> str:
    """A ratio as a percent, or an em-dash. NEVER 0.0 for a missing value --
    the whole document depends on absence reading differently from zero."""
    if x is None:
        return "—"
    try:
        return f"{float(x) * 100:.{dp}f}%"
    except (TypeError, ValueError):
        return "—"


def _usd(x: Any) -> str:
    if x is None:
        return "—"
    try:
        return f"${float(x):,.0f}"
    except (TypeError, ValueError):
        return "—"


def _n(x: Any, dp: int = 2) -> str:
    if x is None:
        return "—"
    try:
        return f"{float(x):.{dp}f}"
    except (TypeError, ValueError):
        return "—"


BOOK_COLS = (
    "run_date, lens, picks, book_metrics, optimizer_result, heuristic_weights, "
    "screening_funnel, independent_ideas, scenario_results, correlation_pairs"
)


def latest_run_date(sb) -> str | None:
    r = (
        sb.table("research_recommendations")
        .select("run_date")
        .order("run_date", desc=True)
        .limit(1)
        .execute()
    )
    return r.data[0]["run_date"] if r.data else None


def fetch(sb, run_date: str) -> dict[str, dict]:
    """Both lenses for one run_date, keyed by lens."""
    r = (
        sb.table("research_recommendations")
        .select(BOOK_COLS)
        .eq("run_date", run_date)
        .execute()
    )
    return {row["lens"]: row for row in (r.data or [])}


def fetch_risk(sb, run_date: str) -> dict:
    r = (
        sb.table("portfolio_risk")
        .select("run_date, var_95, cvar_95, beta, concentration_hhi, total_capital")
        .eq("run_date", run_date)
        .limit(1)
        .execute()
    )
    return (r.data or [{}])[0]


def report(sb, run_date: str) -> None:
    books = fetch(sb, run_date)
    risk = fetch_risk(sb, run_date)

    print(f"\n{'=' * 78}\nSUBMISSION FIGURES — run_date {run_date}\n{'=' * 78}")
    if not books:
        print("  No published book for this run_date. Nothing to report.")
        return

    for lens in ("multi_asset", "credit"):
        b = books.get(lens)
        print(f"\n{'-' * 78}\nLENS: {lens}")
        if not b:
            # ADR-0194's whole point: a lens with no book is a FACT, and on the
            # day it matters it is the most important line this script prints.
            print("  NO BOOK PUBLISHED FOR THIS LENS ON THIS RUN.")
            if lens == "credit":
                print("  -> the lens selector will not render on /book, /mandate or /risk,")
                print("     and ?lens=credit falls back to the multi-asset book.")
                print("  -> re-run L5b: RUN_CREDIT_LENS=1 python -m scripts.daily_refresh")
            continue

        picks = b.get("picks") or []
        bm = b.get("book_metrics") or {}
        opt = b.get("optimizer_result") or {}
        heur = b.get("heuristic_weights") or {}

        longs = [p for p in picks if p.get("direction") == "long"]
        shorts = [p for p in picks if p.get("direction") == "short"]
        h_long = [a for a, w in heur.items() if isinstance(w, (int, float)) and w > 0]
        h_short = [a for a, w in heur.items() if isinstance(w, (int, float)) and w < 0]

        print(f"  Positions        {len(picks)}  ({len(longs)}L / {len(shorts)}S)")
        print(f"  Gross            {_pct(bm.get('gross_exposure'))}")
        print(f"  Net              {_pct(bm.get('net_exposure'))}")
        cap = risk.get("total_capital")
        if cap and bm.get("gross_exposure") is not None:
            print(f"  Cash             {_usd(cap * (1 - float(bm['gross_exposure'])))}")

        print(f"\n  Agent selected   {len(heur)}  ({len(h_long)}L / {len(h_short)}S)"
              f"{'   <-- MET five-and-five' if len(h_long) >= 5 and len(h_short) >= 5 else ''}")
        dropped = sorted(set(heur) - {p.get("asset") for p in picks})
        if dropped:
            print(f"  Sizer dropped    {', '.join(dropped)}")
        print(f"  zeroed           {opt.get('zeroed')}")
        print(f"  binding          {opt.get('binding_constraints')}")
        print(f"  turnover         {_pct(opt.get('realised_turnover'))} "
              f"against a {_pct(opt.get('turnover_cap'))} cap")
        print(f"  forced exit      {_pct(opt.get('forced_exit_turnover'))}")

        # The funnel, in the order /book draws it.
        stages = b.get("screening_funnel") or []
        removers = [s for s in stages if (s.get("removed") or 0) > 0]
        if stages:
            print(f"\n  Screen           {stages[0].get('remaining')} -> {stages[-1].get('remaining')}")
            for s in removers:
                print(f"    -{s.get('removed'):<4} {s.get('stage')}")
        ideas = b.get("independent_ideas") or {}
        for side in ("long", "short"):
            d = ideas.get(side) or {}
            if d:
                print(f"  {side:<16} {d.get('names')} names -> {d.get('count')} independent ideas")
                sf = d.get("shortfall")
                if sf:
                    print(f"    shortfall      held {sf.get('held')} / available "
                          f"{sf.get('available')}, empty {sf.get('empty_slots')}, "
                          f"named {sf.get('named')}, satisfied {sf.get('satisfied')}")

        print("\n  Positions, by weight:")
        for p in sorted(picks, key=lambda x: -abs(x.get("weight") or 0)):
            print(f"    {'L' if p.get('direction') == 'long' else 'S'} "
                  f"{str(p.get('asset')):<6} {_pct(p.get('weight'), 2):>8}  "
                  f"{p.get('theme_name') or p.get('theme_id') or ''}")

        sc = b.get("scenario_results") or []
        if sc:
            print("\n  Scenarios, worst first:")
            rows = sorted(
                ((s.get("label"), s.get("estimated_book_return")) for s in sc),
                key=lambda r: (r[1] if r[1] is not None else 0),
            )
            for label, ret in rows:
                print(f"    {_pct(ret, 2):>8}  {label}")

        pairs = b.get("correlation_pairs") or []
        print(f"\n  Correlation pairs above threshold: {len(pairs)}")

    print(f"\n{'-' * 78}\nL4 RISK (multi-asset book only — portfolio_risk has no lens column)")
    if risk:
        print(f"  VaR 95% 1d       {_usd(risk.get('var_95'))}")
        print(f"  CVaR 95%         {_usd(risk.get('cvar_95'))}")
        print(f"  Beta (realised)  {_n(risk.get('beta'), 3)}")
        print(f"  HHI              {_n(risk.get('concentration_hhi'), 0)}")
        print("  NOTE: portfolio_risk.beta is the REALISED regression beta. The scenario")
        print("        matrix above is computed from the book's value-weighted FACTOR beta.")
        print("        They are different statistics; do not quote one beside the other.")
    else:
        print("  No portfolio_risk row for this run_date.")
    print()


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sb = _client()
    if "--compare" in sys.argv and len(args) == 2:
        for d in args:
            report(sb, d)
        return
    run_date = args[0] if args else latest_run_date(sb)
    if not run_date:
        sys.exit("No published book found.")
    report(sb, run_date)


if __name__ == "__main__":
    main()
