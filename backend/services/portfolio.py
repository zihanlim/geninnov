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