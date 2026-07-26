"""
The provenance envelope for a single number.

TWO AXES, NOT ONE. `display_status` says how a figure should be PRESENTED (exact, estimated,
stale, unavailable, unverified). `epistemic` says what we actually KNOW about it. They are
not the same question, and collapsing them is what let a whole class of claim go untyped:
`unavailable` was doing the work of at least three different statements.

  - "we tried to measure it and could not"                  -> unknown
  - "the question does not apply to this subject"           -> not_applicable
  - "we never looked"                                       -> unknown, different reason

Those are different facts about the world and a reader deserves to be told which one. The
distinction turned up three separate times in one week and each time had to be hand-argued in
a docstring: `share_of_gross` on a book with no gross is NOT_APPLICABLE (a share of nothing
is a malformed question, not a failed measurement, ADR-0066); a COT reading for GDX is
NOT_APPLICABLE (no futures contract exists to be positioned in, ADR-0097); a COT reading when
the portal 500s is UNKNOWN. Typing the axis makes the argument once, here, and makes it
checkable.

An absent value can never be `known`. That is the whole point: validation rejects
`value=None, epistemic="known"`, so an absence cannot slip through untyped even when the
author forgets to think about it.

TIMESTAMPS HAVE ROLES AND THE ROLES ARE TYPES. A single `as_of` was quietly serving as four
different dates. CFTC Commitments of Traders is the case that proves they are different:
positions are OBSERVED on Tuesday, PUBLISHED the following Friday, and RETRIEVED whenever the
pipeline runs. Measuring freshness from retrieval says "two days old"; measuring from
observation says "five". Only the second is honest, and nothing in the type system stopped
you from writing the first.

So each role is its own frozen wrapper type and `Timestamps` isinstance-checks them at
construction. Passing a `Retrieved` where an `Observed` belongs raises — it is not merely
discouraged by a type checker that never runs in production.

See ADR-0098.
"""

from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

NumericStatus = Literal["exact", "estimated", "stale", "unavailable", "unverified"]
NumericUnit = Literal["pct", "usd_m", "usd", "ratio", "count", "score", "duration", "basis_points"]
UncertaintyMethod = Literal["bootstrap", "analytical", "heuristic"]

# What we know about the claim, independent of how it is drawn.
#
# `not_applicable` is NOT a softer `unknown`. Unknown says the answer exists and we failed to
# get it — try again, fix the source, buy the credential. Not-applicable says there is no
# answer to get, because the question does not apply to this subject. Rendering them alike
# tells a reader to wait for a number that is never coming.
Epistemic = Literal["known", "unknown", "not_applicable"]


# ─────────────────────────────────────────────────────────────────────────────
# Timestamp roles
# ─────────────────────────────────────────────────────────────────────────────
#
# Four wrappers rather than four `datetime` fields, so that a mix-up is a TypeError at
# construction instead of a plausible-looking number on a page. The cost is one attribute
# access; the thing it buys is that "as_of" can no longer silently mean whichever of these
# the last author had in mind.

@dataclass(frozen=True)
class Observed:
    """When the world was in the state this value describes.

    Freshness is measured from HERE. For CFTC COT this is the Tuesday, not the Friday it
    printed and not the Sunday we fetched it.
    """
    at: datetime


@dataclass(frozen=True)
class Published:
    """When the source first made the value available to anyone.

    Distinct from observation wherever a source reports on a lag, which is most official
    statistics. The gap between the two is the part a reader cannot act on.
    """
    at: datetime


@dataclass(frozen=True)
class Retrieved:
    """When WE fetched it. Says nothing about the value's age — only about our copy's."""
    at: datetime


@dataclass(frozen=True)
class Effective:
    """The period the value APPLIES to, where that differs from when it was observed.

    A revision published today can be effective for last quarter. Deliberately unordered
    against the others for exactly that reason.
    """
    at: datetime


@dataclass(frozen=True)
class Timestamps:
    """The four roles, with only observation required.

    Ordering is checked where it is meaningful: the world is observed before a source can
    publish it, and it is published before we can retrieve it. `effective` is exempt, since a
    revision legitimately runs backwards.
    """
    observed: Observed
    published: Optional[Published] = None
    retrieved: Optional[Retrieved] = None
    effective: Optional[Effective] = None

    def __post_init__(self) -> None:
        # The isinstance checks are the point of the wrappers. Without them the roles are
        # documentation, and documentation does not survive a serializer round-trip that
        # happens to put the retrieval date in the observation slot.
        for name, expected in (
            ("observed", Observed), ("published", Published),
            ("retrieved", Retrieved), ("effective", Effective),
        ):
            got = getattr(self, name)
            if got is None:
                if name == "observed":
                    raise ValueError("observed is required: a value with no observation time "
                                     "cannot have its age judged")
                continue
            if not isinstance(got, expected):
                raise TypeError(
                    f"{name} must be {expected.__name__}, got {type(got).__name__} — "
                    f"timestamp roles are not interchangeable"
                )
        if self.published is not None and self.published.at < self.observed.at:
            raise ValueError("published cannot precede observed")
        if self.retrieved is not None:
            latest_source = self.published.at if self.published is not None else self.observed.at
            if self.retrieved.at < latest_source:
                raise ValueError("retrieved cannot precede the value becoming available")

    @property
    def publication_lag_seconds(self) -> Optional[int]:
        """How long the world waited to be told. None when publication is unrecorded."""
        if self.published is None:
            return None
        return int((self.published.at - self.observed.at).total_seconds())


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
    # Defaults to `known`, which is safe ONLY because validation rejects a known absence.
    # An author who forgets this field and has a real value is correct by default; one who
    # forgets it and has None gets an error naming the choice they skipped.
    epistemic: Epistemic = "known"
    # Optional so existing call sites keep working. When present it must AGREE with `as_of`,
    # which is what stops the two from drifting into separate answers.
    timestamps: Optional[Timestamps] = None

    def is_present(self) -> bool:
        return self.value is not None

_VALID_UNITS: set[str] = set(NumericUnit.__args__)
_VALID_EPISTEMIC: set[str] = set(Epistemic.__args__)

def validate_numeric(d: NumericDerivation) -> None:
    if d.unit not in _VALID_UNITS:
        raise ValueError(f"invalid unit: {d.unit}")
    if d.epistemic not in _VALID_EPISTEMIC:
        raise ValueError(f"invalid epistemic: {d.epistemic}")
    if d.computed_at < d.as_of:
        raise ValueError("computed_at must be >= as_of")
    expected_age = int((d.computed_at - d.as_of).total_seconds())
    if abs(expected_age - d.freshness.observed_age_seconds) > 1:
        raise ValueError("freshness.observed_age_seconds does not match computed_at - as_of")

    # ── the epistemic axis ──────────────────────────────────────────────────
    # An absence must say WHICH KIND of absence it is. This is the check that makes the
    # default of "known" safe rather than a silent mislabel.
    if d.value is None and d.epistemic == "known":
        raise ValueError(
            "an absent value cannot be 'known': set epistemic to 'unknown' (we could not "
            "measure it) or 'not_applicable' (the question does not apply here)"
        )
    if d.value is not None and d.epistemic != "known":
        raise ValueError(
            f"a present value cannot be '{d.epistemic}': it is known, whatever else is "
            f"uncertain about it"
        )
    if d.epistemic != "known" and not d.unavailable_reason:
        raise ValueError(f"'{d.epistemic}' derivation must carry a reason")
    # No separate "unavailable cannot be known" rule: `unavailable` requires value=None (see
    # below), and an absent value is already refused the `known` label above. A third rule
    # covering the same ground could only ever fire in a state another rule rejects, and
    # would shadow the more useful message with a vaguer one.

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

    # ── timestamp roles ─────────────────────────────────────────────────────
    # Freshness is defined against OBSERVATION, so if the roles are recorded, the legacy
    # `as_of` must be the observation one. Anything else means the age on the page is
    # measured from a date the reader was not shown.
    if d.timestamps is not None and d.timestamps.observed.at != d.as_of:
        raise ValueError(
            "as_of must equal timestamps.observed.at — freshness is measured from "
            "OBSERVATION, and two disagreeing sources of that date put a wrong age on screen"
        )
