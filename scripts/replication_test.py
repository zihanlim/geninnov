"""Would you get the same book twice?

`docs/GOAL.md` has carried this as an open measurement for many iterations: *"run the
pipeline twice on frozen inputs and diff the positions"* — and, explicitly, *"do that
before claiming the book is stable."* Nothing had done it. `/book`'s turnover panel
measures day-over-day churn, but that conflates two very different things: the market
moved, and the agent changed its mind. Only the second is a credibility problem, and
only a frozen-input replication can separate them.

Incidental evidence said the question was worth answering. Four runs stamped
`run_date` 2026-07-25, inside one hour, produced consecutive turnovers of 50%, 77%
and 50% — but the code and prompt changed between some of them, so none of it is
admissible. This script is the admissible version.

METHOD
    Build the L5 state ONCE through the deterministic nodes (aggregate → screen →
    book metrics → scenarios), then call `reason_picks` N times on independent deep
    copies of that identical state. Everything upstream of the LLM is frozen by
    construction: same candidates, same macro, same regime, same book metrics, same
    scenarios, same prompt, same temperature. Any difference in the output is the
    model, not the market.

    Reports per-side Jaccard turnover across every pair, and per-name selection
    frequency — which names are in every sample and which are coin flips.

WHAT TO DO WITH THE ANSWER
    Nothing here re-picks or "fixes" instability. A book that varies run to run may be
    perfectly reasonable when many independent ideas compete for few slots; what is
    not reasonable is *not knowing*. The number belongs on the page next to the book,
    which is what `backtest_results(test_name='book_replication')` is for.

Usage:
    python -m scripts.replication_test [--samples 3] [--no-persist]
"""
from __future__ import annotations

import argparse
import copy
import itertools
import json
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client

from backend.services.q1_agent import (  # noqa: E402
    aggregate_context,
    compute_book_metrics_node,
    reason_picks,
    run_scenario_analysis_node,
    screen_candidates,
)
from backend.services.hype_calculator import ScoringConfig  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def _pick_set(picks: list[dict]) -> set[str]:
    """A book as a set of signed names. Sizes are a separate question — this asks
    whether the same IDEAS come back, the same unit `/book`'s turnover panel uses."""
    return {
        f"{(p.get('direction') or '?')[0].upper()}:{p.get('asset')}"
        for p in picks
        if p.get("asset")
    }


def _turnover(a: set[str], b: set[str]) -> float:
    union = a | b
    return 0.0 if not union else 1.0 - len(a & b) / len(union)


def _side(names: set[str], side: str) -> set[str]:
    return {n for n in names if n.startswith(side)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--no-persist", action="store_true")
    args = ap.parse_args()

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    run_date = date.today()

    cfg_rows = sb.table("scoring_config").select("param_name, value").execute().data or []
    cfg = ScoringConfig.from_db_rows(cfg_rows)

    # The candidate pool the last real run screened. Reading it back rather than
    # re-ranking keeps this test about the LLM: re-running L1 would refetch prices
    # and quietly change the inputs, which is exactly the confound being removed.
    cand_rows = (
        sb.table("trade_candidates")
        .select("asset, direction, theme_id, hype_score, trade_score, edge_score, via_conviction")
        .eq("run_date", run_date.isoformat())
        .execute()
        .data
        or []
    )
    if not cand_rows:
        print(f"[replication] no trade_candidates for {run_date}; run the pipeline first.")
        return 1

    state = {
        "run_date": run_date.isoformat(),
        "supabase_url": SUPABASE_URL,
        "supabase_key": SUPABASE_KEY,
        "cfg": cfg,
        "lens": "multi_asset",
        "candidates": [
            {
                "asset": c["asset"],
                "direction": c["direction"],
                "theme_id": c.get("theme_id"),
                "theme_name": "",
                "hype_score": c.get("hype_score") or 0.0,
                "trade_score": c.get("trade_score") or 0.0,
                "avg_sentiment": 0.0,
                "edge_score": c.get("edge_score") or 0.0,
                "via_conviction": bool(c.get("via_conviction")),
            }
            for c in cand_rows
        ],
        "macro_snapshot": {},
        "regime": {},
        "risk_metrics": {},
        "picks": [],
        "book_view": "",
        "book_risks": [],
        "citations": [],
        "verified": False,
        "retries": 0,
        "input_snapshot": {},
        "error": None,
        "theme_scores": [],
        "factor_exposures": {},
        "news_headlines": [],
    }

    # Deterministic prefix — run ONCE. Everything the prompt renders is fixed here.
    state = aggregate_context(state)
    state = screen_candidates(state)
    state = compute_book_metrics_node(state)
    state = run_scenario_analysis_node(state)

    pool = state.get("independent_ideas") or {}
    print(f"[replication] frozen pool: {len(state.get('candidates') or [])} candidates, "
          f"{(pool.get('long') or {}).get('count')} long ideas / "
          f"{(pool.get('short') or {}).get('count')} short ideas")

    books: list[set[str]] = []
    fell_back = 0
    for i in range(args.samples):
        s = copy.deepcopy(state)
        s = reason_picks(s)
        picks = s.get("picks") or []
        names = _pick_set(picks)
        # A sample that fell back is NOT a sample of the model.
        #
        # reason_picks sets state["error"] and returns fallback_picks() on a timeout,
        # a decode failure or a provider error, and the fallback is DETERMINISTIC —
        # so two fallbacks agree perfectly and the harness would report 0% turnover.
        # That is not stability, it is the same template twice, and publishing it as
        # "the agent reproduces its book exactly" would be a correct number meaning
        # something entirely different from what it appears to mean. It nearly
        # happened: the 2026-07-25 run timed out on both samples at a 300s deadline
        # and printed a flawless 0%.
        err = s.get("error")
        if err:
            fell_back += 1
            print(f"[replication] sample {i + 1}/{args.samples}: FELL BACK — {err}")
            print("[replication]   discarded: the fallback is deterministic, so "
                  "including it would manufacture agreement.")
            continue
        books.append(names)
        print(f"[replication] sample {i + 1}/{args.samples}: {len(names)} picks — "
              f"{', '.join(sorted(names)) or '(none)'}")

    usable = [b for b in books if b]
    if len(usable) < 2:
        print(f"[replication] {len(usable)} model sample(s) usable "
              f"({fell_back} fell back) — nothing to compare, and nothing persisted. "
              f"Raise LLM_TIMEOUT_SECONDS or retry when the provider is quicker.")
        return 1

    pairs = list(itertools.combinations(range(len(usable)), 2))
    overall = [_turnover(usable[i], usable[j]) for i, j in pairs]
    longs = [_turnover(_side(usable[i], "L"), _side(usable[j], "L")) for i, j in pairs]
    shorts = [_turnover(_side(usable[i], "S"), _side(usable[j], "S")) for i, j in pairs]

    def mean(xs):
        return sum(xs) / len(xs) if xs else 0.0

    # Which names survive every sample, and which are coin flips?
    every = set.intersection(*usable)
    any_ = set.union(*usable)
    print("\n[replication] RESULT on frozen inputs")
    print(f"  samples                : {len(usable)}")
    print(f"  mean turnover overall  : {mean(overall):.0%}")
    print(f"  mean turnover LONG     : {mean(longs):.0%}")
    print(f"  mean turnover SHORT    : {mean(shorts):.0%}")
    print(f"  in every sample        : {', '.join(sorted(every)) or '(none)'}")
    print(f"  in some but not all    : {', '.join(sorted(any_ - every)) or '(none)'}")

    if args.no_persist:
        return 0

    rows = [
        {
            "test_name": "book_replication",
            "metric_name": name,
            "realized_value": value,
            "end_date": run_date.isoformat(),
            "pass": None,
            "notes": json.dumps(
                {
                    "samples": len(usable),
                    "fell_back_discarded": fell_back,
                    "stable_names": sorted(every),
                    "unstable_names": sorted(any_ - every),
                    "long_ideas": (pool.get("long") or {}).get("count"),
                    "short_ideas": (pool.get("short") or {}).get("count"),
                    "computed_at": datetime.now(timezone.utc).isoformat(),
                    "method": (
                        "reason_picks called N times on deep copies of one frozen "
                        "state; everything upstream of the LLM identical."
                    ),
                }
            ),
        }
        for name, value in (
            ("turnover_overall", mean(overall)),
            ("turnover_long", mean(longs)),
            ("turnover_short", mean(shorts)),
        )
    ]
    try:
        # backtest_results has no unique constraint on (test_name, metric_name,
        # end_date), so upsert(on_conflict=...) fails with 42P10. Clear the day's
        # rows and insert, the same shape persist_theme_news uses.
        sb.table("backtest_results").delete().eq(
            "test_name", "book_replication"
        ).eq("end_date", run_date.isoformat()).execute()
        sb.table("backtest_results").insert(rows).execute()
        print("[replication] persisted to backtest_results(test_name='book_replication')")
    except Exception as exc:   # pragma: no cover - network
        print(f"[replication] persist failed ({exc.__class__.__name__}): {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
