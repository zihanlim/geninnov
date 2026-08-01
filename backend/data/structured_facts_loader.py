"""Loader for the structured_facts seed JSON. Idempotent: re-runs
upsert on the (entity, metric, as_of) unique key.

Usage:
    python -m backend.data.structured_facts_loader \\
        --path data/structured_facts_seed.json

The seed lives at the repo root under data/. The loader reads it,
validates each row's required fields, and upserts into Supabase.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from supabase import create_client

REQUIRED_FIELDS = (
    "entity", "metric", "value", "unit", "as_of",
    "source", "confidence", "category",
)
ALLOWED_CONFIDENCE = {"high", "medium", "low"}


def _validate_row(row: dict[str, Any], idx: int) -> None:
    """Raise ValueError on the first invalid row. The error message
    includes the row index so a 50-row batch can be debugged."""
    missing = [f for f in REQUIRED_FIELDS if f not in row]
    if missing:
        raise ValueError(
            f"row[{idx}] missing required fields: {missing}. "
            f"row={row!r}"
        )
    conf = row.get("confidence")
    if conf not in ALLOWED_CONFIDENCE:
        raise ValueError(
            f"row[{idx}] confidence must be one of {ALLOWED_CONFIDENCE}, "
            f"got {conf!r}"
        )
    if not isinstance(row.get("value"), (int, float)):
        raise TypeError(
            f"row[{idx}] value must be numeric, got "
            f"{type(row['value']).__name__}: {row['value']!r}"
        )


def load_seed(
    supabase,
    rows: list[dict[str, Any]],
    *,
    dry_run: bool = False,
) -> tuple[int, int]:
    """Upsert the seed rows. Returns (n_written, n_skipped). The
    n_skipped count is for rows that failed validation — the loader
    continues past a bad row to surface ALL errors in one run."""
    n_written = 0
    n_skipped = 0
    for idx, row in enumerate(rows):
        try:
            _validate_row(row, idx)
        except ValueError as exc:
            print(f"[structured_facts_loader] SKIP row[{idx}]: {exc}",
                  file=sys.stderr)
            n_skipped += 1
            continue
        if dry_run:
            print(f"[structured_facts_loader] DRY row[{idx}]: "
                  f"{row['entity']}/{row['metric']} = {row['value']} "
                  f"{row['unit']} @ {row['as_of']}")
            n_written += 1
            continue
        # Reuse the service so the loader and the L5 cite path stay
        # in lockstep. The service validates the same fields.
        from backend.services.structured_facts import upsert_fact
        upsert_fact(supabase, row)
        n_written += 1
    return n_written, n_skipped


def main() -> int:
    p = argparse.ArgumentParser(description="Load structured_facts seed")
    p.add_argument(
        "--path", default="data/structured_facts_seed.json",
        help="Path to the seed JSON",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Validate and print without writing",
    )
    args = p.parse_args()

    if not os.path.exists(args.path):
        print(f"[structured_facts_loader] seed file not found: {args.path}",
              file=sys.stderr)
        return 1

    with open(args.path, encoding="utf-8") as f:
        rows = json.load(f)
    if not isinstance(rows, list):
        print(f"[structured_facts_loader] seed must be a JSON array, "
              f"got {type(rows).__name__}", file=sys.stderr)
        return 1

    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "") or os.environ.get(
        "SUPABASE_KEY", ""
    )
    if not args.dry_run and (not supabase_url or not supabase_key):
        print("[structured_facts_loader] SUPABASE_URL and "
              "SUPABASE_SERVICE_KEY must be set (or use --dry-run)",
              file=sys.stderr)
        return 1

    supabase = create_client(supabase_url, supabase_key) if not args.dry_run else None
    n_written, n_skipped = load_seed(supabase, rows, dry_run=args.dry_run)
    print(f"[structured_facts_loader] wrote {n_written} rows, "
          f"skipped {n_skipped} of {len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
