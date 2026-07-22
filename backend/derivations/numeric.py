from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

NumericStatus = Literal["exact", "estimated", "stale", "unavailable", "unverified"]
NumericUnit = Literal["pct", "usd_m", "usd", "ratio", "count", "score", "duration", "basis_points"]
UncertaintyMethod = Literal["bootstrap", "analytical", "heuristic"]

@dataclass(frozen=True)
class SourceRecord:
    table: str
    id: str | int
    as_of: datetime

@dataclass(frozen=True)
class Freshness:
    max_age_seconds: int
    observed_age_seconds: int

@dataclass(frozen=True)
class Uncertainty:
    band_low: Optional[float] = None
    band_high: Optional[float] = None
    confidence: Optional[float] = None
    method: UncertaintyMethod = "analytical"

@dataclass(frozen=True)
class NumericDerivation:
    field_id: str
    display_status: NumericStatus
    value: Optional[float]
    unit: NumericUnit
    method_id: str
    source_records: list[SourceRecord]
    computed_at: datetime
    as_of: datetime
    freshness: Freshness
    uncertainty: Optional[Uncertainty] = None
    unavailable_reason: Optional[str] = None

    def is_present(self) -> bool:
        return self.value is not None

_VALID_UNITS: set[str] = set(NumericUnit.__args__)

def validate_numeric(d: NumericDerivation) -> None:
    if d.unit not in _VALID_UNITS:
        raise ValueError(f"invalid unit: {d.unit}")
    if d.computed_at < d.as_of:
        raise ValueError("computed_at must be >= as_of")
    expected_age = int((d.computed_at - d.as_of).total_seconds())
    if abs(expected_age - d.freshness.observed_age_seconds) > 1:
        raise ValueError("freshness.observed_age_seconds does not match computed_at - as_of")
    if d.display_status == "unavailable":
        if d.value is not None:
            raise ValueError("unavailable derivation must have value=None")
        if not d.unavailable_reason:
            raise ValueError("unavailable derivation must have unavailable_reason")
    if d.display_status == "stale":
        if d.value is None:
            raise ValueError("stale derivation must carry the last known value")
    if d.display_status == "estimated":
        if d.uncertainty is None:
            raise ValueError("estimated derivation must include uncertainty")
        if d.value is None:
            raise ValueError("estimated derivation must have a value")
    if d.uncertainty is not None:
        lo, hi, v = d.uncertainty.band_low, d.uncertainty.band_high, d.value
        if v is not None and lo is not None and hi is not None and not (lo <= v <= hi):
            raise ValueError("value outside uncertainty band")