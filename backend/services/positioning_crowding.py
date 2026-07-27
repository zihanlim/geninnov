"""
Is the book leaning the same way everyone else already is?

WHY THIS EXISTS. Every crowding measure in this system was internal — HypeScore counts
attention in a corpus we assemble, and `AttentionCrowding` ranks our own themes against each
other. Neither can answer whether the *market* is already positioned the way we are. COT can,
for the slice of the book that trades against a futures contract.

THE HEADLINE IS COVERAGE, NOT CROWDING. On the 2026-07-25 book exactly two of ten positions
map to a contract (SHY and SVXY). A panel that showed only those two rows would invite a
reader to conclude the book had been checked for crowding when four fifths of it had not
been. So `coverage_share` is computed first, reported first, and rendered first; the crowding
verdict is subordinate to it. This is the same rule the freshness and corroboration work
landed on: an absence is a finding, and it is stated rather than filled.

THE INVERSE PRODUCT IS THE TRAP. SVXY is a -0.5x inverse VIX product, so LONG SVXY is a SHORT
volatility position. Comparing its stated direction to the VIX speculator reading without
flipping produces a crowding verdict that is exactly backwards — and, unlike a wrong number,
a wrong side has no symptom a reader could catch. `ContractMap.inverse` exists for this one
case and `effective_side` is the only place direction is resolved.

AGREEING WITH A CROWD IS A RISK, NOT A SIGNAL — AND SINCE ADR-0110 IT IS ALSO A CAP. A
position sitting with an extreme speculator consensus is exposed to that consensus unwinding.
Nothing here recommends a trade or reverses one; what it now does, via `crowding_caps`, is
*limit how much of such a position the book may hold*. That is deliberately the weaker of the
two things it could do. Crowding says the exit is narrow — a liquidity and positioning risk —
so it constrains size rather than adjusting the expected return, which would assert a claim
about future returns that nobody has measured.

ADR-0097 said this module never feeds sizing. ADR-0110 supersedes that clause and only that
clause: coverage-first, the inverse flip, `fetched=False` as a distinct state, and
miners-are-not-the-metal all stand unchanged.

NEUTRALITY IS ABSENCE. `crowding_caps` returns a map containing ONLY the names it tightens.
An unobservable name is absent, so it keeps the base cap and is sized exactly as it would
have been — bit for bit. That is the constraint bar 1 imposes, and it has a cost worth naming
rather than hiding: penalising only what we can see gives a structural advantage to what we
cannot, so the book drifts toward instruments with no contract unless someone watches
`coverage_share` over time. See ADR-0110.

See ADR-0097, ADR-0110.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ..data.cot_fetcher import COT_CONTRACTS, CotReading, unmapped_reason

# Percentile at or above which speculators are treated as crowded long, and at or below which
# crowded short.
#
# 80/20 is the CONVENTIONAL COT-index threshold, not a value we fitted. It is named here
# rather than inlined so that when someone does fit it, the change is visible and the old
# value is in the diff. Nothing downstream tunes on it.
CROWDED_HIGH = 80.0
CROWDED_LOW = 20.0

# What fraction of its normal single-name limit a crowded position may hold.
#
# A JUDGEMENT, NOT A FIT — the same standing as the 80/20 threshold above, and named here for
# the same reason: when someone does fit it, the change is visible and the old value is in the
# diff. Half is chosen because it is decisive enough that a reader can see the effect at equal
# conviction (which is bar 1's own test) without being so severe that a single COT print
# reshapes the book. Nothing tunes on it.
CROWDED_CAP_MULTIPLIER = 0.5

# Why a position could not be observed, as a value rather than as prose. The `reason` string
# is what a reader sees; this is what code branches on. They are written together so they
# cannot disagree.
CAUSE_NO_CONTRACT = "no_contract"
CAUSE_NOT_RETRIEVED = "not_retrieved"
CAUSE_INSUFFICIENT_HISTORY = "insufficient_history"


@dataclass
class PositioningCrowding:
    """What external positioning can see of this book, and what it says where it can."""

    gross_exposure: float = 0.0
    """Gross of the WHOLE book, so both shares below have the same denominator."""

    fetched: bool = True
    """False when readings were never retrieved. Distinct from 'retrieved and nothing mapped'
    — the first is 'we did not look', the second is 'we looked and COT has no contract'."""

    observed_gross: float = 0.0
    """Gross that maps to a contract AND has a usable percentile."""

    agreeing_gross: float = 0.0
    """Gross whose side matches an extreme speculator consensus."""

    rows: list[dict] = field(default_factory=list)
    unobservable: list[dict] = field(default_factory=list)
    """Positions with no contract, each carrying the reason — never a bare omission."""

    as_of: Optional[str] = None
    """The OBSERVATION Tuesday, not the retrieval date."""

    @property
    def coverage_share(self) -> Optional[float]:
        """Share of book gross that COT can speak to at all.

        None rather than 0.0 when the book has no gross: a share of an empty book is
        unmeasurable, not zero (ADR-0066).
        """
        if self.gross_exposure <= 0:
            return None
        return self.observed_gross / self.gross_exposure

    @property
    def crowded_share(self) -> Optional[float]:
        """Share of book GROSS — not of the observed slice — sitting with a crowded consensus.

        Denominated in book gross so it is directly comparable to `coverage_share`, which
        bounds it: `crowded_share <= coverage_share` always, and the gap between them is the
        part of the book that was checked and found uncrowded. Reporting it against the
        observed slice instead would let a single crowded position in a thinly-covered book
        read as "100% crowded".
        """
        if self.gross_exposure <= 0:
            return None
        return self.agreeing_gross / self.gross_exposure


def effective_side(direction: str, inverse: bool) -> str:
    """The side the book holds IN THE CONTRACT'S UNDERLYING.

    The only place the inverse flip happens. Long SVXY is short VIX.
    """
    if not inverse:
        return direction
    return "short" if direction == "long" else "long"


def crowded_side(index: Optional[float]) -> Optional[str]:
    """Which side speculators are crowded on, or None when the reading is mid-range/unknown."""
    if index is None:
        return None
    if index >= CROWDED_HIGH:
        return "long"
    if index <= CROWDED_LOW:
        return "short"
    return None


def assess(
    picks: list[dict],
    gross_exposure: float,
    readings: Optional[dict[str, CotReading]],
) -> PositioningCrowding:
    """Join book positions to COT readings.

    `readings=None` means the fetch was never attempted or failed wholesale — the result is
    marked `fetched=False` and every position is unobservable for THAT reason, which is not
    the same reason as "no contract exists". An empty dict means the fetch succeeded and
    returned nothing usable.

    `gross_exposure` is passed in rather than summed, so the shares are denominated in the
    same gross `book_metrics` reports — deriving it here would let the two disagree.
    """
    out = PositioningCrowding(gross_exposure=gross_exposure, fetched=readings is not None)
    dates: list[str] = []

    for p in picks or []:
        asset = p.get("asset")
        weight = p.get("weight")
        direction = p.get("direction")
        if not asset or not isinstance(weight, (int, float)) or isinstance(weight, bool):
            continue
        if weight <= 0 or direction not in ("long", "short"):
            continue
        w = float(weight)

        cm = COT_CONTRACTS.get(asset)
        if cm is None:
            out.unobservable.append({
                "asset": asset, "direction": direction, "weight": w,
                "reason": unmapped_reason(asset),
                # Structural, beside the prose. Sizing has to distinguish "COT will never
                # cover this" from "COT covers it and we failed to read it today" — the first
                # is permanent and the second is a run-level fault — and parsing the sentence
                # to find out would make the render's wording load-bearing.
                "cause": CAUSE_NO_CONTRACT,
            })
            continue

        reading = (readings or {}).get(asset)
        if reading is None or reading.index is None:
            # Mapped, but no usable percentile — either not fetched, or too short a history.
            # Reported as unobservable so it is never silently counted as uncrowded, with the
            # reason naming which of the two it was.
            not_retrieved = not out.fetched or reading is None
            out.unobservable.append({
                "asset": asset, "direction": direction, "weight": w,
                "reason": (
                    f"Maps to {cm.name}, but no reading was retrieved."
                    if not_retrieved
                    else f"Maps to {cm.name}, but fewer than the minimum weekly prints are "
                         f"available, so its percentile would not be a percentile."
                ),
                "cause": (
                    CAUSE_NOT_RETRIEVED if not_retrieved else CAUSE_INSUFFICIENT_HISTORY
                ),
            })
            continue

        side = effective_side(direction, cm.inverse)
        crowd = crowded_side(reading.index)
        agrees = crowd is not None and crowd == side

        out.observed_gross += w
        if agrees:
            out.agreeing_gross += w
        if reading.as_of:
            dates.append(reading.as_of)

        out.rows.append({
            "asset": asset,
            "direction": direction,
            "weight": w,
            "contract": cm.name,
            "contract_code": cm.code,
            "inverse": cm.inverse,
            "effective_side": side,
            "cot_index": reading.index,
            "net_spec": reading.net_spec,
            "crowded_side": crowd,
            "agrees_with_crowd": agrees,
            "as_of": reading.as_of,
            "rationale": cm.rationale,
        })

    out.rows.sort(key=lambda r: -r["weight"])
    out.unobservable.sort(key=lambda r: -r["weight"])
    # Oldest observation across contracts: a mixed-date panel is only as fresh as its
    # stalest input, and reporting the newest would overstate it.
    out.as_of = min(dates) if dates else None
    return out


def crowding_caps(
    pc: PositioningCrowding,
    base_cap: float,
    multiplier: float = CROWDED_CAP_MULTIPLIER,
) -> tuple[dict[str, float], dict]:
    """Per-name single-name limits, tightened where the book agrees with a crowded consensus.

    Returns `(caps, provenance)`.

    `caps` contains **only the names it tightens**. Everything else — uncrowded, unmapped,
    unretrieved — is absent, and an absent name keeps `base_cap`. That is what "degrade to
    neutral" means operationally: a position COT cannot see is sized exactly as it would have
    been with this function deleted, bit for bit, and a test pins that.

    Why a cap and not a haircut on expected return. Crowding says the exit is narrow. Docking
    `mu` would say the position will *return* less, which is a claim about future returns that
    nothing here has measured; tightening the limit says we will *hold* less of it, which is
    what a positioning extreme actually supports. A cap is also visible — it lands in
    `OptimizationResult.binding_constraints` naming the position it bit — where a `mu`
    adjustment would leave a reader looking at a smaller weight with no way to attribute it.

    `provenance` is the block a caller persists and renders. It leads with coverage, because
    the tightening is only as meaningful as the share of the book it could have applied to,
    and it distinguishes the three reasons nothing was tightened: the fetch failed, nothing
    maps, or everything that maps was checked and found uncrowded. Those are different facts
    and a single "no positions tightened" would collapse them (ADR-0098).
    """
    tightened: dict[str, float] = {}
    detail: list[dict] = []

    for row in pc.rows:
        if not row.get("agrees_with_crowd"):
            continue
        asset = row.get("asset")
        if not asset:
            continue
        cap = base_cap * multiplier
        tightened[asset] = cap
        detail.append({
            "asset": asset,
            "cap": cap,
            "base_cap": base_cap,
            "direction": row.get("direction"),
            # The resolved side, not the book side — long SVXY is short VIX, and a reader
            # comparing "long" against "specs crowded short" would think this was a mistake.
            "effective_side": row.get("effective_side"),
            "inverse": row.get("inverse"),
            "cot_index": row.get("cot_index"),
            "crowded_side": row.get("crowded_side"),
            "contract": row.get("contract"),
        })

    causes: dict[str, int] = {}
    for record in pc.unobservable:
        cause = record.get("cause") or CAUSE_NO_CONTRACT
        causes[cause] = causes.get(cause, 0) + 1

    if tightened:
        reason = None
    elif not pc.fetched:
        reason = (
            "external positioning was not retrieved this run, so no position was tightened — "
            "unknown, not uncrowded"
        )
    elif not pc.rows:
        reason = (
            "no position in the book maps to a futures contract with a usable history, so "
            "crowding could not size anything"
        )
    else:
        reason = (
            f"{len(pc.rows)} observable "
            f"{'position was' if len(pc.rows) == 1 else 'positions were'} checked and none "
            "sits at a speculator extreme"
        )

    provenance = {
        "applied": bool(tightened),
        "reason": reason,
        "multiplier": multiplier,
        "base_cap": base_cap,
        # Coverage first — the tightening means nothing without the share it could reach.
        "coverage_share": pc.coverage_share,
        "crowded_share": pc.crowded_share,
        "observed_positions": len(pc.rows),
        "unobservable_positions": len(pc.unobservable),
        "unobservable_causes": causes,
        "fetched": pc.fetched,
        "as_of": pc.as_of,
        "crowded_high": CROWDED_HIGH,
        "crowded_low": CROWDED_LOW,
        "tightened": detail,
    }
    return tightened, provenance


def describe(pc: PositioningCrowding) -> str:
    """One paragraph, leading with what external positioning can and cannot see."""
    if not pc.fetched:
        return (
            "External positioning was not retrieved for this run, so whether the book leans "
            "with or against the speculative crowd is unknown — not neutral."
        )

    cov = pc.coverage_share
    if not pc.rows:
        return (
            "No position in this book trades against a futures contract with a usable "
            "Commitments of Traders history, so external positioning can say nothing about "
            f"it. That is a gap in coverage, not evidence that the book is uncrowded. "
            f"{len(pc.unobservable)} "
            f"{'position was' if len(pc.unobservable) == 1 else 'positions were'} "
            f"checked and found unobservable."
        )

    cov_txt = (
        f"{cov * 100:.0f}% of this book's gross" if cov is not None
        else "an unmeasurable share of this book's gross"
    )
    agreeing = [r for r in pc.rows if r["agrees_with_crowd"]]
    base = (
        f"COT positioning can see {cov_txt} — {len(pc.rows)} of "
        f"{len(pc.rows) + len(pc.unobservable)} positions map to a futures contract. "
    )

    if not agreeing:
        base += (
            "Within that slice, no position sits at a speculator extreme, so the book is not "
            "leaning with a crowded consensus where we can observe one."
        )
    else:
        names = ", ".join(
            f"{r['direction']} {r['asset']} (specs crowded {r['crowded_side']} at "
            f"{r['cot_index']:.0f})"
            for r in agreeing
        )
        share = pc.crowded_share
        share_txt = f"{share * 100:.1f}% of gross" if share is not None else "an unmeasurable share"
        base += (
            f"{share_txt} agrees with an extreme speculator position ({names}), which is "
            f"exposure to that consensus unwinding rather than confirmation of the view."
        )

    n = len(pc.unobservable)
    if n:
        # Written out rather than "position(s)": this sentence is persisted, rendered on
        # /risk verbatim, and served to /ask and the MCP server, so a lazy plural reads as
        # machine output in all three places at once.
        base += (
            f" The remaining {n} {'position has' if n == 1 else 'positions have'} no "
            f"contract and their crowding is unobservable, not zero."
        )
    if pc.as_of:
        base += (
            f" Positions are as of {pc.as_of}, the CFTC observation date — the report is "
            f"published the following Friday, so this reading is days old by construction."
        )
    return base


def to_row(pc: PositioningCrowding) -> dict:
    """Persisted shape for `research_recommendations.positioning_crowding`.

    Carries the rendered sentence with the numbers, so the page cannot restate the finding in
    different words from the module that computed it (ADR-0095, ADR-0096).
    """
    return {
        "fetched": pc.fetched,
        "gross_exposure": pc.gross_exposure,
        "observed_gross": pc.observed_gross,
        "agreeing_gross": pc.agreeing_gross,
        # None, not 0.0, when the book has no gross (ADR-0066).
        "coverage_share": pc.coverage_share,
        "crowded_share": pc.crowded_share,
        "rows": pc.rows,
        "unobservable": pc.unobservable,
        "as_of": pc.as_of,
        "crowded_high": CROWDED_HIGH,
        "crowded_low": CROWDED_LOW,
        "summary": describe(pc),
    }
