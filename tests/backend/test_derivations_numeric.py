from datetime import datetime, timezone, timedelta
import pytest
from backend.derivations.numeric import NumericDerivation, SourceRecord, Freshness, Uncertainty, validate_numeric

NOW = datetime(2026, 1, 16, 16, 30, tzinfo=timezone.utc)
AS_OF = NOW - timedelta(hours=1)

def _exact(value: float, **overrides) -> NumericDerivation:
    base = dict(
        field_id="portfolio.daily_return",
        display_status="exact",
        value=value,
        unit="pct",
        method_id="portfolio.signed_attribution.v1",
        source_records=[SourceRecord(table="portfolio_returns", id="abc", as_of=AS_OF)],
        computed_at=NOW, as_of=AS_OF,
        freshness=Freshness(max_age_seconds=86400, observed_age_seconds=3600),
    )
    base.update(overrides)
    return NumericDerivation(**base)

def test_validate_numeric_accepts_exact():
    validate_numeric(_exact(0.0123))

def test_validate_numeric_rejects_unavailable_with_value():
    with pytest.raises(ValueError):
        validate_numeric(_exact(display_status="unavailable", value=0.0))

def test_validate_numeric_requires_uncertainty_for_estimated():
    with pytest.raises(ValueError):
        validate_numeric(_exact(0.01, display_status="estimated", uncertainty=None))

def test_validate_numeric_requires_unit_from_enum():
    with pytest.raises(ValueError):
        validate_numeric(_exact(0.01, unit="weird"))

def test_validate_numeric_rejects_time_inversion():
    with pytest.raises(ValueError):
        validate_numeric(_exact(0.01, computed_at=AS_OF, as_of=NOW))

def test_validate_numeric_enforces_uncertainty_band():
    bad = Uncertainty(band_low=0.05, band_high=0.10, confidence=0.9, method="analytical")
    with pytest.raises(ValueError):
        validate_numeric(_exact(0.20, display_status="estimated", uncertainty=bad))