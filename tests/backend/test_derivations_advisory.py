from datetime import datetime, timezone, timedelta
import pytest
from backend.derivations.advisory import AdvisoryDerivation, validate_advisory

NOW = datetime(2026, 1, 16, 16, 30, tzinfo=timezone.utc)
AS_OF = NOW - timedelta(hours=1)

def _verified(body: str = "thesis text", **overrides) -> AdvisoryDerivation:
    base = dict(
        field_id="trade.thesis.body",
        generated_by="l5_q1_agent",
        display_status="verified",
        body=body,
        method_id="l5.q1.reasoning.v3",
        evidence_ids=["cite:1", "cite:2"],
        citation_status="all_verified",
        fallback_used=False,
        computed_at=NOW, as_of=AS_OF,
    )
    base.update(overrides)
    return AdvisoryDerivation(**base)

def test_validate_advisory_accepts_verified():
    validate_advisory(_verified())

def test_validate_advisory_rejects_verified_with_no_evidence():
    with pytest.raises(ValueError):
        validate_advisory(_verified(evidence_ids=[]))

def test_validate_advisory_rejects_verified_with_fallback():
    with pytest.raises(ValueError):
        validate_advisory(_verified(fallback_used=True))

def test_validate_advisory_unavailable_must_be_unavailable():
    with pytest.raises(ValueError):
        validate_advisory(_verified(display_status="unavailable", body="text"))

def test_validate_advisory_partial_requires_partial_status():
    with pytest.raises(ValueError):
        validate_advisory(_verified(citation_status="some_failed_retry_ok", display_status="verified"))

def test_validate_advisory_rejects_human_claiming_verified():
    with pytest.raises(ValueError):
        validate_advisory(_verified(generated_by="human", display_status="verified"))
