"""
Federal contract awards to names the book holds — revenue before the filing.

**Bar 2, from `docs/GOAL.md`:** *"The alpha is in data neither the quant nor the fundamental
process can use... Test: name one input in this pipeline that a competing desk could not buy
or query this afternoon. Today there is none."*

**An honest correction to that test before answering it.** Taken literally it is close to
unpassable with public data — a competing desk can query almost anything. But look at the
transcript's own examples: scraped state highway-patrol data, hand-mapped fire perimeters.
Neither is *inaccessible*. Both are fragmented, unassembled, and nobody has productised
them. **The edge is in the assembly, not the access.** So the bar this clears is the
defensible one: *an input a competing desk could not reproduce without a week of assembly
work.* Claiming more than that would be the overclaim this repo refuses.

**Why this data.** A DoD contract award is revenue **ahead of the 10-Q**. The quant process
cannot use it — it is not a price series. The fundamental process gets it late — it surfaces
in a filing a quarter later. That is exactly the seam the transcript describes.

**Why USASpending rather than defense.gov.** The daily contract announcements are prose and
would need parsing; USASpending exposes the same awards through a documented REST API, free
and keyless. Verified 2026-07-27: Lockheed Martin is the largest DoD recipient in the
trailing window, and LMT is in this universe. A source that can be revoked is not an edge —
which is why the worldmonitor chokepoint feed, gated behind a paid tier and now returning
403, never produced a measured reading (ADR-0095, ADR-0099).

**THE MAPPING IS THE JUDGEMENT, AND IT HAS ONE HOME.** Recipient strings are messy —
"LOCKHEED MARTIN CORPORATION", "SIKORSKY AIRCRAFT CORP" (Lockheed-owned), "ELECTRIC BOAT
CORPORATION" (General Dynamics). Two rules, and the second is the one that matters:

  * **A subsidiary IS its parent.** Sikorsky's revenue is Lockheed's revenue. Attributing
    it is correct, not generous.
  * **A subcontractor is NOT the prime.** Attributing a sub-tier award to the prime's ticker
    would inflate coverage the same way mapping GDX to gold futures would — the failure
    ADR-0097 refused, in a different market.

Coverage is reported before any verdict, for the same reason it is in
`positioning_crowding`: this can speak to a handful of names, and a signal presented without
its denominator invites a reader to think the book was checked.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

ENDPOINT = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
DEFAULT_TIMEOUT = 20.0

# The endpoint rejects a larger page with a bare 422 and no explanation.
MAX_PAGE_LIMIT = 100

# Contract award types: definitive, purchase order, delivery order, BPA call.
AWARD_TYPE_CODES = ["A", "B", "C", "D"]


@dataclass(frozen=True)
class RecipientMap:
    """One recipient-string prefix and the ticker whose revenue it is."""

    ticker: str
    rationale: str


# The judgement, in one place. Keys are UPPERCASE prefixes matched against the recipient
# name; a name matching no key is UNATTRIBUTED and reported as such, never bucketed into
# the nearest plausible ticker.
RECIPIENT_MAP: dict[str, RecipientMap] = {
    "LOCKHEED MARTIN": RecipientMap("LMT", "the prime itself"),
    "SIKORSKY": RecipientMap("LMT", "Sikorsky is Lockheed-owned; its revenue is Lockheed's"),
    "NORTHROP GRUMMAN": RecipientMap("NOC", "the prime itself"),
    "RAYTHEON": RecipientMap("RTX", "Raytheon is the RTX defence segment"),
    "RTX CORPORATION": RecipientMap("RTX", "the prime itself"),
    "PRATT & WHITNEY": RecipientMap("RTX", "Pratt & Whitney is RTX-owned"),
    "COLLINS AEROSPACE": RecipientMap("RTX", "Collins is RTX-owned"),
}

# Names that recur at the top of DoD awards and are deliberately NOT mapped, because the
# book does not hold them. Listed so a reader can see the refusal is a decision rather than
# an oversight — the same role `cot_fetcher.UNMAPPED_REASON` plays.
KNOWN_UNHELD: dict[str, str] = {
    "ELECTRIC BOAT": "a General Dynamics subsidiary; GD is not in this universe",
    "GENERAL DYNAMICS": "not in this universe",
    "BOEING": "not in this universe",
    "HUNTINGTON INGALLS": "not in this universe",
    "BAE SYSTEMS": "not in this universe, and LSE-listed",
    "L3HARRIS": "not in this universe",
}


@dataclass
class AwardReading:
    """Obligated contract value attributed to one held ticker over a window."""

    ticker: str
    total_obligated: float
    award_count: int
    recipients: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "total_obligated": self.total_obligated,
            "award_count": self.award_count,
            "recipients": sorted(set(self.recipients)),
        }


def attribute(recipient: str) -> Optional[RecipientMap]:
    """Recipient string to the ticker whose revenue it is, or None.

    Prefix-matched on an uppercased name because the API returns several spellings of the
    same entity ("CORPORATION" / "CORP" / trailing division names). Longest key first, so a
    specific subsidiary wins over a broader parent prefix.
    """
    if not recipient:
        return None
    name = recipient.upper().strip()
    for key in sorted(RECIPIENT_MAP, key=len, reverse=True):
        if name.startswith(key) or f" {key}" in name:
            return RECIPIENT_MAP[key]
    return None


def unattributed_reason(recipient: str) -> str:
    """Why a recipient carries no ticker. A reason, never a silent drop."""
    name = (recipient or "").upper().strip()
    for key, why in KNOWN_UNHELD.items():
        if name.startswith(key) or f" {key}" in name:
            return why
    return "no mapping to a held name"


def fetch_awards(
    start_date: str,
    end_date: str,
    limit: int = MAX_PAGE_LIMIT,
    timeout: float = DEFAULT_TIMEOUT,
) -> tuple[list[dict], Optional[str]]:
    """Raw DoD contract awards over a window. Returns (rows, error).

    Never raises: an overlay must not cost the run. The error string travels so an absence
    can say which absence it is (ADR-0098) rather than reading as "no awards".
    """
    body = {
        "filters": {
            "award_type_codes": AWARD_TYPE_CODES,
            "time_period": [{"start_date": start_date, "end_date": end_date}],
            "agencies": [
                {"type": "awarding", "tier": "toptier", "name": "Department of Defense"}
            ],
        },
        "fields": ["Award ID", "Recipient Name", "Award Amount", "Start Date"],
        "sort": "Award Amount",
        "order": "desc",
        # Clamped, not passed through. The endpoint answers 422 above 100 with no body
        # explaining why, so an unclamped caller gets an opaque failure that reads like
        # the service being down rather than like a bad request. Measured: 150 -> 422,
        # 100 -> 100 rows.
        "limit": min(int(limit), MAX_PAGE_LIMIT),
        "page": 1,
    }
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            # Identify the caller. A public API is a courtesy, not an entitlement.
            "User-Agent": "andromeda-research/1.0 (+https://andromeda-analytics.vercel.app)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        return [], f"{exc.__class__.__name__}: {exc}"
    rows = payload.get("results")
    if not isinstance(rows, list):
        return [], "response carried no results array"
    return rows, None


def summarise(rows: list[dict], held_assets: list[str]) -> dict:
    """Attribute awards to held names, leading with what could not be attributed.

    `held_assets` bounds the answer to the book: a reading about a name nobody owns is
    trivia, and counting it would inflate the coverage figure that makes the rest
    meaningful.
    """
    held = {a for a in held_assets if a}
    readings: dict[str, AwardReading] = {}
    unattributed: dict[str, dict] = {}
    total_seen = 0.0

    for row in rows or []:
        recipient = row.get("Recipient Name") or ""
        try:
            amount = float(row.get("Award Amount") or 0.0)
        except (TypeError, ValueError):
            continue
        total_seen += amount

        mapping = attribute(recipient)
        if mapping is None or mapping.ticker not in held:
            reason = (
                unattributed_reason(recipient)
                if mapping is None
                else f"maps to {mapping.ticker}, which the book does not hold"
            )
            bucket = unattributed.setdefault(reason, {"reason": reason, "obligated": 0.0, "n": 0})
            bucket["obligated"] += amount
            bucket["n"] += 1
            continue

        reading = readings.setdefault(mapping.ticker, AwardReading(mapping.ticker, 0.0, 0))
        reading.total_obligated += amount
        reading.award_count += 1
        reading.recipients.append(recipient)

    attributed = sum(r.total_obligated for r in readings.values())
    return {
        # Coverage first, always.
        "held_names_with_awards": sorted(readings),
        "held_names_checked": sorted(held),
        "coverage_count": len(readings),
        "attributed_obligated": attributed,
        "total_obligated_seen": total_seen,
        "attributed_share": (attributed / total_seen) if total_seen > 0 else None,
        "readings": {t: r.to_dict() for t, r in sorted(readings.items())},
        "unattributed": sorted(unattributed.values(), key=lambda b: -b["obligated"]),
        "awards_examined": len(rows or []),
    }
