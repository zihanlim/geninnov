from __future__ import annotations

from collections import defaultdict
from typing import Iterable


def gross_exposure(positions: Iterable[dict]) -> float:
    return sum(abs(p["weight"]) for p in positions)


def net_exposure(positions: Iterable[dict]) -> float:
    return sum(p["weight"] for p in positions)


def leverage(positions: Iterable[dict], capital: float) -> float:
    if capital <= 0:
        raise ValueError("capital must be positive")
    return gross_exposure(positions) / capital


def sector_concentration(positions: Iterable[dict]) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for p in positions:
        out[p["sector"]] += abs(p["weight"])
    return dict(out)


def geo_concentration(positions: Iterable[dict]) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for p in positions:
        out[p["geo"]] += abs(p["weight"])
    return dict(out)
