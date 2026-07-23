"""
Guard against RESIDUAL R0: fabricated portfolio data reaching production.

A gitignored local script (`tests/backend/seed_realistic_data.py`) once deleted
the real `portfolio_risk` rows and inserted hardcoded metrics (hhi=1850,
var_95=2.5M, cvar_95=4M, sharpe=1.15, beta=0.65) plus a synthetic
alternating ±0.0015/-0.0008 return series. Because that script is gitignored it
can't be removed from the repo — but its *fingerprint* can be detected. This
guard flags those sentinels so seeded data can never masquerade as pipeline
output unnoticed.

The detection functions are pure and unit-tested. The CLI reads the live
Supabase tables and exits non-zero when the fingerprint is present, so it can
run in CI or a pre-deploy check.

Run:  python -m scripts.check_data_integrity      # exits 1 if fabricated
"""
from __future__ import annotations

import os
import sys

# Hardcoded metrics the seed script wrote (RESIDUAL R0). The genuine computed
# HHI for the same book is ~1000.12 — nowhere near 1850.
RISK_SENTINELS: dict[str, float] = {
    "concentration_hhi": 1850.0,
    "var_95": 2_500_000.0,
    "cvar_95": 4_000_000.0,
    "sharpe": 1.15,
    "beta": 0.65,
}

# The seed return series: daily_ret = 0.0015 if i % 2 == 0 else -0.0008.
SEED_RET_A = 0.0015
SEED_RET_B = -0.0008


def _close(x, target, rel_tol: float = 1e-3, abs_tol: float = 1e-6) -> bool:
    try:
        x = float(x)
    except (TypeError, ValueError):
        return False
    return abs(x - target) <= max(abs_tol, rel_tol * abs(target))


def _looks_like_alternating_seed(rets: list[float], a: float = SEED_RET_A,
                                 b: float = SEED_RET_B, min_len: int = 4) -> bool:
    """True when the return series is the seed's alternating pattern (either
    phase — the run_date ordering could start on a or b)."""
    if len(rets) < min_len:
        return False

    def matches(first, second) -> bool:
        return all(_close(r, first if i % 2 == 0 else second, abs_tol=1e-6)
                   for i, r in enumerate(rets))

    return matches(a, b) or matches(b, a)


def detect_fabricated_seed(risk_row: dict | None, returns_rows: list[dict] | None,
                           min_sentinels: int = 3) -> list[str]:
    """
    Return a list of red-flag strings (empty == clean).

    Risk sentinels are only flagged when a strong majority match at once
    (>= ``min_sentinels`` of 5), so a single coincidental value (e.g. a real
    beta of 0.65) does not raise a false alarm. The return-series fingerprint is
    specific enough to flag on its own.
    """
    flags: list[str] = []

    if risk_row:
        matched = [k for k, v in RISK_SENTINELS.items()
                   if risk_row.get(k) is not None and _close(risk_row[k], v)]
        if len(matched) >= min_sentinels:
            flags.append(
                f"portfolio_risk matches {len(matched)}/{len(RISK_SENTINELS)} seed "
                f"sentinels {matched} — looks fabricated (RESIDUAL R0)."
            )

    rets = [float(r["daily_return"]) for r in (returns_rows or [])
            if r.get("daily_return") is not None]
    if _looks_like_alternating_seed(rets):
        flags.append(
            "portfolio_returns matches the alternating ±0.0015/-0.0008 seed "
            "pattern — looks fabricated (RESIDUAL R0)."
        )

    return flags


def main() -> int:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY to check live data.")
        return 2
    from supabase import create_client
    sb = create_client(url, key)

    risk_rows = (
        sb.table("portfolio_risk").select("*").order("run_date", desc=True).limit(1).execute().data
    )
    returns_rows = (
        sb.table("portfolio_returns").select("run_date, daily_return").order("run_date").execute().data
    )

    flags = detect_fabricated_seed(risk_rows[0] if risk_rows else None, returns_rows)
    if flags:
        print("✗ DATA INTEGRITY CHECK FAILED — production looks fabricated:")
        for f in flags:
            print(f"  - {f}")
        print("\nFix: re-run scripts/daily_refresh.py against real data to overwrite "
              "the seeded rows, then confirm concentration_hhi is no longer 1850.")
        return 1

    print("✓ Data integrity check passed — no seed fingerprint detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
