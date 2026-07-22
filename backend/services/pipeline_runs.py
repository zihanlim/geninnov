from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone


def run_id_for(run_date: date, *, stage: str) -> str:
    h = hashlib.sha256(f"{run_date.isoformat()}|{stage}".encode()).hexdigest()
    return f"run_{h[:16]}"


def record_pipeline_run(
    supabase,
    run_id: str,
    status: str,
    *,
    run_date: date,
    stage: str,
    duration_s: float | None = None,
    source_freshness: dict | None = None,
    error: str | None = None,
) -> None:
    """Upsert a stage execution status into pipeline_runs.

    The CHECK constraint on `status` only allows ('success','failure','partial').
    The internal "started" sentinel maps to 'partial' (a run that has begun
    but not yet finished) and updates the row to its terminal status on
    the next call.
    """
    now = datetime.now(timezone.utc).isoformat()
    db_status = "partial" if status == "started" else status
    row = {
        "run_id": run_id,
        "run_date": run_date.isoformat(),
        "stage": stage,
        "status": db_status,
    }
    if status == "started":
        row["started_at"] = now
    else:
        row["finished_at"] = now
    if duration_s is not None:
        row["duration_s"] = duration_s
    if source_freshness is not None:
        row["source_freshness"] = source_freshness
    if error is not None:
        row["error"] = error
    supabase.table("pipeline_runs").upsert(row, on_conflict="run_id").execute()
