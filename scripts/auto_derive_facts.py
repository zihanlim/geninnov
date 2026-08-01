"""Run fact_extraction.derive_auto_facts for the latest as_of.

Usage:
    python -m scripts.auto_derive_facts

The Tier 1 auto-derive mirrors what's already in the database into the
structured_facts shape, so the L5 can cite it and /facts can render
it. The four sources are read in this order:

  1. macro_indicators (FRED + yfinance latest)
  2. regime_classifications.computable_macro
  3. regime_classifications scalar columns
  4. themes per-theme scores

Each row is upserted with `confidence = medium` and
`source = "auto-derived: <table>"`. Hand-curated rows (confidence
`high`) are untouched — the unique key (entity, metric, as_of) is
different by construction.
"""
from __future__ import annotations

import os
import sys
from datetime import date

from supabase import create_client

# Repo root on sys.path so `from backend.services.fact_extraction` works
# whether the script is invoked as a module or directly.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.fact_extraction import derive_auto_facts


def main() -> int:
    url = os.environ.get("SUPABASE_URL", "")
    key = (
        os.environ.get("SUPABASE_SERVICE_KEY", "")
        or os.environ.get("SUPABASE_KEY", "")
    )
    if not url or not key:
        print(
            "[auto_derive_facts] SUPABASE_URL and SUPABASE_SERVICE_KEY "
            "must be set",
            file=sys.stderr,
        )
        return 1
    supabase = create_client(url, key)
    as_of = date.today()
    n = derive_auto_facts(supabase, as_of=as_of)
    print(f"[auto_derive_facts] wrote {n} auto-derived rows for as_of={as_of}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
