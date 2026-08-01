"""Run computable_macro_runner for the most recent regime row.

This is a one-shot backfill: migration 065 added the JSONB column but the
existing regime rows have NULL. The runner computes the three analytics
(ERP, equity-bond correlation, NDX seasonality) and writes them to the
column. The fact_extraction Tier 1 then mirrors the JSONB into
structured_facts.

Usage:
    python -m scripts.backfill_computable_macro
"""
from __future__ import annotations

import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client

from backend.services.computable_macro_runner import run as run_computable_macro


def main() -> int:
    url = os.environ.get("SUPABASE_URL", "")
    key = (
        os.environ.get("SUPABASE_SERVICE_KEY", "")
        or os.environ.get("SUPABASE_KEY", "")
    )
    if not url or not key:
        print(
            "[backfill_computable_macro] SUPABASE_URL and SUPABASE_SERVICE_KEY "
            "must be set",
            file=sys.stderr,
        )
        return 1
    supabase = create_client(url, key)
    # Find the most recent regime row.
    resp = (
        supabase.table("regime_classifications")
        .select("run_date")
        .order("run_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        print("[backfill_computable_macro] no regime rows found", file=sys.stderr)
        return 1
    run_date_str = rows[0].get("run_date")
    if not run_date_str:
        print("[backfill_computable_macro] latest regime row has no run_date", file=sys.stderr)
        return 1
    as_of = date.fromisoformat(run_date_str[:10])
    payload = run_computable_macro(supabase, as_of=as_of)
    erp = payload.get("erp", {}).get("status", "unknown")
    eq = payload.get("equity_bond_corr", {}).get("status", "unknown")
    ndx = payload.get("ndx_seasonality", {}).get("status", "unknown")
    print(
        f"[backfill_computable_macro] wrote JSONB for run_date={as_of}. "
        f"erp={erp}, equity_bond_corr={eq}, ndx_seasonality={ndx}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
