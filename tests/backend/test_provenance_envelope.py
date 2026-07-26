"""
Tests for the provenance envelope: the epistemic axis and the timestamp roles (ADR-0098).

Two things have to hold, and both are about absences rather than values.

An absence must say WHICH KIND it is. "We could not measure it" and "the question does not
apply here" are different facts, and rendering them alike tells a reader to wait for a number
that is never coming. The default `epistemic="known"` is safe ONLY because a known absence is
rejected — that check is what makes forgetting the field impossible rather than merely
discouraged.

A timestamp must say WHICH ROLE it plays. CFTC positions are observed Tuesday, published
Friday, retrieved whenever we run. Measuring freshness from retrieval reports a five-day-old
reading as two days old, and nothing but a type stops you writing it.
"""

import os, sys
from datetime import datetime, timedelta
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.derivations.numeric import (
    Effective, Epistemic, Freshness, NumericDerivation, Observed, Published, Retrieved,
    SourceRecord, Timestamps, Uncertainty, validate_numeric,
)

AS_OF = datetime(2026, 7, 21, 12, 0, 0)
COMPUTED = datetime(2026, 7, 26, 12, 0, 0)
AGE = int((COMPUTED - AS_OF).total_seconds())


def make(**kw) -> NumericDerivation:
    base = dict(
        field_id="risk.var_95",
        display_status="exact",
        value=1.5,
        unit="pct",
        method_id="m1",
        source_records=[SourceRecord(table="portfolio_risk", id=1, as_of=AS_OF)],
        computed_at=COMPUTED,
        as_of=AS_OF,
        freshness=Freshness(max_age_seconds=86400, observed_age_seconds=AGE),
    )
    base.update(kw)
    return NumericDerivation(**base)


# ---------------------------------------------------------------------------
# The epistemic axis
# ---------------------------------------------------------------------------

def test_a_present_value_is_known_by_default():
    """The common case must stay ergonomic, or authors will work around the field."""
    d = make()
    assert d.epistemic == "known"
    validate_numeric(d)


def test_an_absent_value_cannot_be_known():
    """The check that makes the default safe: forgetting the field on an absence errors."""
    with pytest.raises(ValueError, match="absent value cannot be 'known'"):
        validate_numeric(make(value=None, display_status="unavailable",
                              unavailable_reason="source down"))


def test_the_error_names_both_choices_the_author_skipped():
    """A diagnostic that says only 'invalid' teaches nothing at 2am."""
    with pytest.raises(ValueError) as e:
        validate_numeric(make(value=None, display_status="unavailable",
                              unavailable_reason="source down"))
    assert "unknown" in str(e.value) and "not_applicable" in str(e.value)


def test_a_present_value_cannot_be_unknown():
    """Whatever else is uncertain about a number we have, we HAVE it."""
    with pytest.raises(ValueError, match="present value cannot be"):
        validate_numeric(make(value=1.5, epistemic="unknown",
                              unavailable_reason="whatever"))


@pytest.mark.parametrize("epistemic", ["unknown", "not_applicable"])
def test_both_absences_require_a_reason(epistemic):
    with pytest.raises(ValueError, match="must carry a reason"):
        validate_numeric(make(value=None, display_status="unavailable", epistemic=epistemic,
                              unavailable_reason=None))


@pytest.mark.parametrize("epistemic,reason", [
    # The three cases this axis was created for, from three different modules.
    ("not_applicable", "the book has no gross, so a share of it is undefined (ADR-0066)"),
    ("not_applicable", "GDX has no futures contract, so speculator positioning cannot exist"),
    ("unknown", "the CFTC portal did not answer"),
])
def test_a_typed_absence_validates(epistemic, reason):
    validate_numeric(make(value=None, display_status="unavailable",
                          epistemic=epistemic, unavailable_reason=reason))


def test_an_unavailable_figure_can_never_claim_knowledge():
    """`display_status` is how it is DRAWN; `epistemic` is what we know. Both routes into the
    contradiction are closed, by two rules that were already there — which is why there is no
    third rule saying so directly. Written as a test rather than a comment so that removing
    either underlying rule fails here."""
    # Route 1: drawn unavailable with no value, claiming to know it.
    with pytest.raises(ValueError, match="absent value cannot be 'known'"):
        validate_numeric(make(value=None, display_status="unavailable",
                              unavailable_reason="r", epistemic="known"))
    # Route 2: drawn unavailable while carrying a value.
    with pytest.raises(ValueError, match="unavailable derivation must have value=None"):
        validate_numeric(make(value=1.5, display_status="unavailable",
                              unavailable_reason="r", epistemic="known"))


def test_stale_is_known_because_it_carries_the_last_value():
    """Stale is about AGE, not about knowledge — the two axes are genuinely independent."""
    validate_numeric(make(display_status="stale", value=1.5, epistemic="known"))


def test_an_invalid_epistemic_is_rejected():
    with pytest.raises(ValueError, match="invalid epistemic"):
        validate_numeric(make(value=None, epistemic="probably", unavailable_reason="r"))


def test_the_three_states_are_exactly_three():
    assert set(Epistemic.__args__) == {"known", "unknown", "not_applicable"}


# ---------------------------------------------------------------------------
# Timestamp roles
# ---------------------------------------------------------------------------

TUE = datetime(2026, 7, 21, 15, 30)   # CFTC observation
FRI = datetime(2026, 7, 24, 15, 30)   # CFTC publication
SUN = datetime(2026, 7, 26, 21, 30)   # our retrieval


def test_the_cftc_case_records_three_distinct_dates():
    ts = Timestamps(observed=Observed(TUE), published=Published(FRI), retrieved=Retrieved(SUN))
    assert ts.observed.at == TUE
    assert ts.published.at == FRI
    assert ts.retrieved.at == SUN
    # Three days between the world and being told about it.
    assert ts.publication_lag_seconds == 3 * 86400


def test_a_role_cannot_be_substituted_for_another():
    """The point of the wrappers. A serializer that puts retrieval in the observation slot
    must raise, not produce a page that understates the age by five days."""
    with pytest.raises(TypeError, match="not interchangeable"):
        Timestamps(observed=Retrieved(SUN))
    with pytest.raises(TypeError, match="not interchangeable"):
        Timestamps(observed=Observed(TUE), published=Retrieved(SUN))


def test_a_bare_datetime_is_not_a_role():
    """The failure mode this replaces: four datetimes, any of which fits any field."""
    with pytest.raises(TypeError, match="not interchangeable"):
        Timestamps(observed=TUE)


def test_publication_cannot_precede_observation():
    with pytest.raises(ValueError, match="published cannot precede observed"):
        Timestamps(observed=Observed(FRI), published=Published(TUE))


def test_retrieval_cannot_precede_publication():
    """We cannot have fetched it before it existed."""
    with pytest.raises(ValueError, match="retrieved cannot precede"):
        Timestamps(observed=Observed(TUE), published=Published(SUN), retrieved=Retrieved(FRI))


def test_retrieval_is_checked_against_observation_when_publication_is_unrecorded():
    with pytest.raises(ValueError, match="retrieved cannot precede"):
        Timestamps(observed=Observed(FRI), retrieved=Retrieved(TUE))


def test_effective_may_run_backwards_because_revisions_do():
    """A revision published today can be effective for last quarter — deliberately exempt
    from the ordering the other three obey."""
    ts = Timestamps(observed=Observed(SUN), effective=Effective(TUE))
    assert ts.effective.at < ts.observed.at


def test_publication_lag_is_none_not_zero_when_unrecorded():
    """Zero would assert instant publication, which is a measurement we did not make."""
    assert Timestamps(observed=Observed(TUE)).publication_lag_seconds is None


def test_observation_is_required():
    with pytest.raises(ValueError, match="observed is required"):
        Timestamps(observed=None)


def test_as_of_must_agree_with_the_observation_role():
    """Two sources for the date freshness is measured from would put a wrong age on screen."""
    with pytest.raises(ValueError, match="as_of must equal timestamps.observed.at"):
        validate_numeric(make(timestamps=Timestamps(observed=Observed(FRI))))


def test_a_derivation_carrying_agreeing_roles_validates():
    validate_numeric(make(timestamps=Timestamps(
        observed=Observed(AS_OF), published=Published(AS_OF + timedelta(days=3)),
        retrieved=Retrieved(COMPUTED),
    )))


def test_timestamps_stay_optional_so_existing_call_sites_keep_working():
    d = make()
    assert d.timestamps is None
    validate_numeric(d)


# ---------------------------------------------------------------------------
# The pre-existing contract still holds
# ---------------------------------------------------------------------------

def test_estimated_still_requires_uncertainty():
    with pytest.raises(ValueError, match="must include uncertainty"):
        validate_numeric(make(display_status="estimated", value=1.0))


def test_value_outside_its_band_is_still_rejected():
    with pytest.raises(ValueError, match="outside uncertainty band"):
        validate_numeric(make(display_status="estimated", value=9.0,
                              uncertainty=Uncertainty(band_low=0.0, band_high=1.0)))


def test_freshness_must_still_match_the_dates():
    with pytest.raises(ValueError, match="does not match"):
        validate_numeric(make(freshness=Freshness(max_age_seconds=1, observed_age_seconds=7)))
