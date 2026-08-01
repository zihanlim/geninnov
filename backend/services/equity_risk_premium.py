"""M-new (ADR-0213): Equity Risk Premium — JPM-style.

Computes the equity risk premium as ``earnings_yield(SPX) − ust10_yield``:

    ERP = (EPS_TTM / SPX_close) - DGS10/100

The 0.1-percentage-point tolerance on the published JPM-style ERP comes
from the EPS input: a 12-month-trailing EPS is a quarterly walk, so a
fresh recompute lands inside a one-percent band of a static estimate
without needing a daily fundamental feed.

Inputs are passed in by the caller (so this module is a pure function,
not a fetcher) — see ``daily_refresh.py`` for the wiring.

ADR-0098: ABSENCE IS DATA. If the trailing EPS is unknown, the function
returns ``status="unknown"`` with a NULL erp, NOT zero. The shape mirrors
the existing debasement_pressure / fed_posture discipline.
"""
from __future__ import annotations

from datetime import date
from typing import Any

#: Number of percentage points of EPS-staleness the live system tolerates.
#: Beyond this, ERP is reported "unknown" — the published number is then
#: 1+ quarter stale, which is a different epistemic state from "we have
#: today's data and the answer is 2.2%".
EPS_STALENESS_DAYS_MAX = 120


def compute_erp(
    *,
    spx_close: float | None,
    ust10_pct: float | None,
    trailing_eps: float | None,
    eps_as_of: date | None = None,
    as_of: date | None = None,
) -> dict[str, Any]:
    """JPM-style equity risk premium.

    Args:
        spx_close:  Latest SPX close, raw points (e.g. 5234.18).
        ust10_pct:  Latest 10y Treasury yield, in PERCENT (e.g. 4.73 = 4.73%
                    — same unit FRED reports; ADR-0137 declares units, does
                    not assume them).
        trailing_eps: 12-month trailing S&P 500 EPS, hand-curated or sourced
                    from structured_facts. None when the input is not
                    available.
        eps_as_of: The date the trailing_eps figure is true as of. Used to
                    reject stale inputs (see EPS_STALENESS_DAYS_MAX).
        as_of: The date the computation is performed on (the run_date).
                    Defaults to date.today().

    Returns:
        A dict with keys:

          - ``erp_pct`` (float | None): the ERP in percentage points.
          - ``earnings_yield_pct`` (float | None): the SPX earnings yield
            in percent.
          - ``ust10_pct`` (float | None): the input ust10, echoed.
          - ``spx_pe`` (float | None): the SPX trailing P/E.
          - ``status`` (str): one of ``"measured"``,
            ``"insufficient_history"``, ``"unknown"``.
          - ``as_of`` (date | None): the computation date.
          - ``eps_as_of`` (date | None): the EPS date, when used.
          - ``reason`` (str | None): a short human-readable explanation
            when status is not "measured".
    """
    as_of = as_of or date.today()  # noqa: DTZ011 — calendar date, not a timestamp
    result: dict[str, Any] = {
        "erp_pct": None,
        "earnings_yield_pct": None,
        "ust10_pct": ust10_pct,
        "spx_pe": None,
        "status": "unknown",
        "as_of": as_of,
        "eps_as_of": eps_as_of,
        "reason": None,
    }

    # Pre-flight: any missing input is "unknown", not zero.
    if spx_close is None or spx_close <= 0:
        result["reason"] = "spx_close unavailable or non-positive"
        return result
    if ust10_pct is None:
        result["reason"] = "ust10 unavailable"
        return result
    if trailing_eps is None or trailing_eps <= 0:
        result["reason"] = "trailing_eps unavailable (hand-curated input)"
        return result

    # Staleness check: a fresh trailing-EPS is the entire point of this
    # metric, and 1+ quarter stale is a different epistemic state from
    # "the answer is 2.2% today".
    if eps_as_of is not None:
        age_days = (as_of - eps_as_of).days
        if age_days > EPS_STALENESS_DAYS_MAX:
            result["reason"] = (
                f"trailing_eps is {age_days} days stale "
                f"(max {EPS_STALENESS_DAYS_MAX})"
            )
            return result

    # Compute. P/E first, then earnings yield = 1/PE, then ERP.
    spx_pe = spx_close / trailing_eps
    earnings_yield_pct = (1.0 / spx_pe) * 100.0
    erp_pct = earnings_yield_pct - ust10_pct

    result.update(
        spx_pe=spx_pe,
        earnings_yield_pct=earnings_yield_pct,
        erp_pct=erp_pct,
        status="measured",
        reason=None,
    )
    return result
