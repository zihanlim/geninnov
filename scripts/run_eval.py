"""Run the L5 acceptance battery against a real provider.

`q1_agent._select_provider` resolves to whichever of MiniMax / Anthropic / Gemini
has a key present, at import time, silently. That is the right behaviour for a daily
job that must produce a book — but it means the identity of the model writing the
book is ambient state, and a missing key or a deprecated model id changes it with no
signal anywhere. The citation guardrail still runs, so the book still looks verified;
it is just written by someone else.

This script is the check you run before changing `LLM_PROVIDER`, a model id, or the
`reason_picks` prompt — and after, to see what moved. It calls the real node on the
frozen fixtures in `backend/eval/fixtures.py`, so the only variable is the model.

    python -m scripts.run_eval                          # whichever provider is configured
    python -m scripts.run_eval --provider gemini        # pin one
    python -m scripts.run_eval --case thin_short_pool   # one case, while iterating
    python -m scripts.run_eval --json                   # machine-readable
    python -m scripts.run_eval --persist                # write to backtest_results

Exit code is 0 when every **structural** check passes. Directional checks — the ones
encoding a market judgment rather than a system constraint — are reported and never
fail the run; see `battery.is_directional` for why the line sits where it does.

Comparing two providers is two runs and a diff:

    python -m scripts.run_eval --provider minimax --json > /tmp/minimax.json
    python -m scripts.run_eval --provider gemini  --json > /tmp/gemini.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", choices=["minimax", "anthropic", "gemini", "auto"],
                    help="pin LLM_PROVIDER for this run (default: whatever the environment says)")
    ap.add_argument("--case", action="append", dest="cases",
                    help="run only this case id; repeatable")
    ap.add_argument("--canned", action="store_true",
                    help="use the no-LLM canned agent — for checking the harness, not the model")
    ap.add_argument("--json", action="store_true", help="emit the full result as JSON")
    ap.add_argument("--persist", action="store_true",
                    help="upsert the summary into backtest_results(test_name='l5_eval_battery')")
    return ap.parse_args()


def _print_report(result, provider: str, model: str) -> None:
    print(f"\n[eval] provider={provider} model={model}")
    print(f"[eval] {result.summary['cases_passed']}/{result.summary['cases_total']} cases, "
          f"{result.summary['checks_passed']}/{result.summary['checks_total']} checks\n")

    for score in result.scores:
        mark = "PASS" if score.passed else ("STRUCT-OK" if score.structurally_passed else "FAIL")
        print(f"  [{mark:>9}] {score.case_id}  "
              f"({score.longs} long / {score.shorts} short)")
        for check in score.results:
            if check.passed:
                continue
            tag = "opinion" if check.directional else "DEFECT "
            print(f"              {tag} · {check.label}: {check.detail}")

    structural = [f for f in result.summary["failures"] if not f["directional"]]
    directional = [f for f in result.summary["failures"] if f["directional"]]
    print(f"\n[eval] {len(structural)} structural failure(s), {len(directional)} directional")
    if not structural:
        print("[eval] every constraint the system promises to enforce held.")


def _persist(result, provider: str, model: str) -> None:
    """Land the summary next to the other measured properties of the book.

    Same table and shape as `scripts/replication_test.py` uses — the two answer
    adjacent questions (is the book stable? is it right?) and belong side by side.
    """
    from supabase import create_client

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("[eval] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping persist.")
        return

    summary = result.summary
    structural = [f for f in summary["failures"] if not f["directional"]]
    notes = json.dumps({
        "provider": provider,
        "model": model,
        "cases": [
            {"id": s.case_id, "passed": s.passed, "structurally_passed": s.structurally_passed,
             "longs": s.longs, "shorts": s.shorts}
            for s in result.scores
        ],
        "failures": summary["failures"],
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "method": "reason_picks run against backend/eval fixtures; deterministic prefix written down, not computed.",
    })
    rows = [
        {
            "test_name": "l5_eval_battery",
            "metric_name": name,
            "realized_value": value,
            "end_date": date.today().isoformat(),
            "pass": None if name == "checks_passed_ratio" else (len(structural) == 0),
            "notes": notes,
        }
        for name, value in (
            ("cases_passed_ratio", summary["cases_passed"] / max(1, summary["cases_total"])),
            ("structural_pass_ratio", summary["cases_structurally_passed"] / max(1, summary["cases_total"])),
            ("checks_passed_ratio", summary["checks_passed"] / max(1, summary["checks_total"])),
        )
    ]
    try:
        # `backtest_results` has no unique constraint on (test_name, metric_name,
        # end_date), so upsert(on_conflict=...) raises 42P10. Clear the day's rows
        # and insert — the same shape replication_test.py and persist_theme_news use.
        sb = create_client(url, key)
        today = date.today().isoformat()
        sb.table("backtest_results").delete().eq(
            "test_name", "l5_eval_battery"
        ).eq("end_date", today).execute()
        sb.table("backtest_results").insert(rows).execute()
        print("[eval] persisted to backtest_results(test_name='l5_eval_battery')")
    except Exception as exc:  # pragma: no cover - network
        print(f"[eval] persist failed ({exc.__class__.__name__}): {exc}")


def main() -> int:
    args = _parse_args()

    # LLM_PROVIDER and every API key are read into module-level constants when
    # q1_agent is imported, so --provider has to land in the environment before the
    # import below. This is why the imports are not at the top of the file.
    if args.provider:
        os.environ["LLM_PROVIDER"] = args.provider

    from backend.eval import STANDARD_BATTERY, canned_agent_fn, llm_agent_fn, run_battery
    from backend.eval.battery import case_by_id
    from backend.services.q1_agent import _active_model_id, _select_provider

    cases = tuple(case_by_id(c) for c in args.cases) if args.cases else STANDARD_BATTERY
    agent_fn = canned_agent_fn if args.canned else llm_agent_fn
    provider = "canned" if args.canned else _select_provider()
    model = "(none)" if args.canned else _active_model_id()

    if provider == "none":
        print("[eval] no LLM provider configured — set MINIMAX_API_KEY, ANTHROPIC_API_KEY "
              "or GEMINI_API_KEY, or pass --canned to exercise the harness alone.")
        return 2

    print(f"[eval] running {len(cases)} case(s) against {provider} ({model})")
    result = run_battery(cases, agent_fn=agent_fn)

    if args.json:
        print(json.dumps({
            "provider": provider,
            "model": model,
            "summary": result.summary,
            "cases": [
                {
                    "id": s.case_id,
                    "passed": s.passed,
                    "structurally_passed": s.structurally_passed,
                    "picks": s.picks, "longs": s.longs, "shorts": s.shorts,
                    "checks": [
                        {"label": r.label, "passed": r.passed,
                         "directional": r.directional, "detail": r.detail}
                        for r in s.results
                    ],
                }
                for s in result.scores
            ],
        }, indent=2))
    else:
        _print_report(result, provider, model)

    if args.persist:
        _persist(result, provider, model)

    return 0 if all(s.structurally_passed for s in result.scores) else 1


if __name__ == "__main__":
    raise SystemExit(main())
