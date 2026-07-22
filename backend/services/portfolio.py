from __future__ import annotations
from typing import Iterable

class MissingReturnError(ValueError):
    """Raised when at least one position lacks a return to compute the book return."""

def _return(price_today: float | None, price_yesterday: float | None) -> float:
    if price_today is None or price_yesterday is None or price_yesterday == 0:
        raise MissingReturnError("missing price for position")
    return price_today / price_yesterday - 1.0

def compute_daily_contributions(positions: Iterable[dict]) -> dict[str, float]:
    out: dict[str, float] = {}
    for p in positions:
        r = _return(p.get("price_today"), p.get("price_yesterday"))
        out[p["ticker"]] = p["weight"] * r
    return out

def compute_daily_return(positions: Iterable[dict]) -> float:
    return sum(compute_daily_contributions(positions).values())

from datetime import date, timedelta
_MAX_DAILY = 1.0  # 100% daily return is the cap; anything larger is rejected

def compute_cumulative_return(daily_returns: list[float], inception: date) -> dict:
    if not daily_returns:
        return {"value": 0.0, "inception": inception, "as_of": inception, "compounded": True}
    for r in daily_returns:
        if abs(r) > _MAX_DAILY:
            raise ValueError(f"daily return {r} exceeds sanity cap {_MAX_DAILY}")
    product = 1.0
    for r in daily_returns:
        product *= 1.0 + r
    return {
        "value": product - 1.0,
        "inception": inception,
        "as_of": inception + timedelta(days=len(daily_returns) - 1),
        "compounded": True,
    }