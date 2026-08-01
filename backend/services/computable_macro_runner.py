"""Orchestrates the three computable-macro analytics (ADR-0217) into
the `regime_classifications.computable_macro` JSONB column.

This module is the orchestration layer; the three pure-function
services (``equity_risk_premium``, ``equity_bond_correlation``,
``seasonality_analytics``) are the source of truth for the math. The
runner reads the inputs from `macro_daily_history` and (once Workstream
B lands) `structured_facts`, calls the services, and writes the JSONB.

Status discipline (ADR-0098): every metric carries its own status. A
"measured" entry is one the system can defend; "unknown" means the
inputs were unavailable and the value is NULL, not zero. A row of
all-unknown computable_macro is itself a valid state and tells a
reader that the system has looked and found nothing to publish.

Failure mode: a failure here is BEST-EFFORT, like the rest of the
post-L3 read paths. The regime row is already written by L3; this
function augments it. An exception here must not abort the pipeline
(ADR-0091: a guard in one consumer guards one consumer).
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import pandas as pd

from backend.services.equity_bond_correlation import compute_equity_bond_corr
from backend.services.equity_risk_premium import compute_erp
from backend.services.seasonality_analytics import (
    compute_ndx_seasonality,
    fetch_ndx_monthly_returns_from_yfinance,
)

_log = logging.getLogger(__name__)

#: Lookback for SPX and DGS10 windows used by ERP and equity-bond
#: correlation. 1 year is more than enough for a 60d rolling corr and
#: the SPX P/E denominator.
DEFAULT_LOOKBACK_DAYS = 365

#: Where the NDX history parquet cache lives. Gitignored.
NDX_CACHE_PATH = "backend/data/cache/seasonality.parquet"

#: How stale the NDX cache can be before we re-fetch.
NDX_CACHE_MAX_AGE_DAYS = 90


def _read_series(
    supabase,
    series_id: str,
    *,
    as_of: date,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> list[tuple[date, float]]:
    """Read one series from macro_daily_history as (date, value) pairs,
    ascending. Bounded by as_of (no look-ahead bias, ADR-0069)."""
    start = (as_of - timedelta(days=lookback_days + 14)).isoformat()
    resp = (
        supabase.table("macro_daily_history")
        .select("trading_date, value")
        .eq("series_id", series_id)
        .gte("trading_date", start)
        .lte("trading_date", as_of.isoformat())
        .order("trading_date", desc=False)
        .execute()
    )
    out: list[tuple[date, float]] = []
    for r in resp.data or []:
        v = r.get("value")
        if v is None:
            continue
        d_raw = r["trading_date"]
        if isinstance(d_raw, str):
            d = date.fromisoformat(d_raw[:10])
        else:
            d = d_raw
        out.append((d, float(v)))
    return out


def _latest(series: list[tuple[date, float]]) -> float | None:
    """The most recent non-null value."""
    if not series:
        return None
    return series[-1][1]


def _values(series: list[tuple[date, float]]) -> list[float]:
    return [v for _, v in series]


def _try_read_trailing_eps(
    supabase,
    *,
    as_of: date,
) -> tuple[float | None, date | None]:
    """Read the trailing SPX EPS from `structured_facts` (Workstream B
    table). Returns (eps, eps_as_of) — both None when the table is
    absent or the row is not yet populated. The runner is built to
    work BEFORE B ships; the function's contract is to degrade
    gracefully, not to require the table.

    This function silently does nothing if the table doesn't exist,
    so the runner can ship with Workstream A in isolation. A future
    migration (Workstream B) introduces the table and the same
    function reads it without code changes here.
    """
    try:
        resp = (
            supabase.table("structured_facts")
            .select("value, as_of")
            .eq("entity", "SPX")
            .eq("metric", "trailing_eps_ttm")
            .order("as_of", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return (None, None)
        v = rows[0].get("value")
        d_raw = rows[0].get("as_of")
        if v is None or d_raw is None:
            return (None, None)
        d = date.fromisoformat(d_raw[:10]) if isinstance(d_raw, str) else d_raw
        return (float(v), d)
    except Exception:  # noqa: BLE001 — table not present (pre-B) is expected
        # Table not present, RLS denied, or query failed. Treat as
        # "EPS unavailable" — the ERP function will report 'unknown'.
        return (None, None)


def _load_ndx_monthly_returns(
    *,
    as_of: date,
) -> list[tuple[date, float]]:
    """Load the NDX monthly return series. Tries a parquet cache first
    (re-fetches if older than NDX_CACHE_MAX_AGE_DAYS), then the live
    yfinance fetcher. Returns [] on any failure.

    The cache is best-effort; a missing cache file, a stale cache, a
    network failure, or a pandas error all fall through to the empty
    list. The seasonality service handles [] correctly (all stats None).
    """
    # Try the parquet cache first.
    try:
        import os
        from datetime import datetime, timezone
        if os.path.exists(NDX_CACHE_PATH):
            mtime = datetime.fromtimestamp(
                os.path.getmtime(NDX_CACHE_PATH), tz=timezone.utc
            ).date()
            if (as_of - mtime).days <= NDX_CACHE_MAX_AGE_DAYS:
                df = pd.read_parquet(NDX_CACHE_PATH)
                return [
                    (row.date(), float(row["return_pct"]))
                    for _, row in df.iterrows()
                ]
    except Exception as exc:  # noqa: BLE001 — cache miss is a non-fatal fallback
        # Stale cache, missing columns, or any read error: fall
        # through to the live fetch. The exception is intentionally
        # silenced because the cache is best-effort, not a contract.
        _log.debug("NDX cache read failed: %s", exc)

    # Live fetch.
    try:
        rows = fetch_ndx_monthly_returns_from_yfinance()
    except Exception as exc:  # noqa: BLE001 — yfinance outages are best-effort
        _log.debug("NDX live fetch failed: %s", exc)
        return []

    # Best-effort cache write. Failure here is silent — the live
    # result is already in hand.
    try:
        import os
        os.makedirs(os.path.dirname(NDX_CACHE_PATH), exist_ok=True)
        df = pd.DataFrame(rows, columns=["date", "return_pct"])
        df.to_parquet(NDX_CACHE_PATH)
    except Exception as exc:  # noqa: BLE001 — cache write is best-effort
        _log.debug("NDX cache write failed: %s", exc)

    return rows


def build_computable_macro(
    supabase,
    *,
    as_of: date,
) -> dict[str, Any]:
    """Compute the three analytics and return a JSONB-ready dict.

    Returns a dict with keys ``erp``, ``equity_bond_corr``,
    ``ndx_seasonality``. Each carries its own status. The whole
    function never raises; an empty/insufficient input is reported
    via the per-metric status, not a top-level exception.
    """
    # --- 1. ERP --------------------------------------------------------
    spx_hist = _read_series(supabase, "^SPX", as_of=as_of)
    ust10_hist = _read_series(supabase, "DGS10", as_of=as_of)
    spx_close = _latest(spx_hist)
    ust10_pct = _latest(ust10_hist)
    trailing_eps, eps_as_of = _try_read_trailing_eps(supabase, as_of=as_of)
    erp = compute_erp(
        spx_close=spx_close,
        ust10_pct=ust10_pct,
        trailing_eps=trailing_eps,
        eps_as_of=eps_as_of,
        as_of=as_of,
    )

    # --- 2. Equity-bond correlation ------------------------------------
    # Use the 1y lookback so the 60d rolling window has at least 60
    # paired observations.
    spx_vals = _values(spx_hist)
    ust10_vals = _values(ust10_hist)
    eq_bond = compute_equity_bond_corr(
        spx_vals,
        ust10_vals,
        as_of=as_of,
    )

    # --- 3. NDX seasonality --------------------------------------------
    ndx_monthly = _load_ndx_monthly_returns(as_of=as_of)
    ndx = compute_ndx_seasonality(ndx_monthly, current_month=as_of.month)

    return {
        "erp": erp,
        "equity_bond_corr": eq_bond,
        "ndx_seasonality": ndx,
    }


def persist_computable_macro(
    supabase,
    *,
    as_of: date,
    payload: dict[str, Any],
) -> int:
    """Write the computable_macro JSONB onto the regime row for as_of.

    Returns 1 on success, 0 if no row was updated (e.g. as_of has no
    regime row). The function is idempotent — re-running replaces
    the column rather than appending.
    """
    resp = (
        supabase.table("regime_classifications")
        .update({"computable_macro": payload})
        .eq("run_date", as_of.isoformat())
        .execute()
    )
    return len(resp.data or [])


def run(supabase, *, as_of: date) -> dict[str, Any]:
    """Top-level entry point: build the payload, persist it, return
    the payload. Never raises; errors are returned in the per-metric
    status (the call to ``build_computable_macro`` does not raise)."""
    payload = build_computable_macro(supabase, as_of=as_of)
    try:
        persist_computable_macro(supabase, as_of=as_of, payload=payload)
    except Exception as exc:  # noqa: BLE001 — best-effort persist
        # The function already returned a payload with status='unknown'
        # on individual metrics when the underlying data is missing.
        # A failure here is a PERSIST failure, not a compute failure.
        for v in payload.values():
            if isinstance(v, dict):
                v.setdefault("status", "unknown")
                v["persist_error"] = str(exc)
    return payload
