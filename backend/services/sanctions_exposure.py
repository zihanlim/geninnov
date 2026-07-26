"""
Which held names carry sanctions risk, and — the part nobody was saying — on which side.

WHY THIS EXISTS. The 2026-07-25 book was short BABA at 8.7% and short PDD at 9.25% — 17.9
percentage points of book weight, which against 59.3% gross is **30% of gross exposure** in
Chinese ADRs, the most sanctions-exposed names in the Tier-1 universe (HFCAA delisting,
entity-list additions, outbound-investment rules). The two units are easy to conflate and
worth stating separately: 17.9pp is the weight, 30% is the concentration. Being SHORT them means
sanctions escalation is a **tailwind**, and nothing on the site said so.

That is the same shape as the finding S6 produced. ADR-0088 revealed that short GDX plus
short NOC was an unlabelled short-geopolitical-risk bet worth -1.24% in a supply shock. This
is the mirror image on the China sleeve: a *long* geopolitical-risk position, unlabelled,
at 30% of gross. In both cases the exposure was a side effect of picks made on other
grounds, and in neither did the book say it held one.

WHAT IS OURS AND WHAT IS NOT. The exposure itself needs no external data — which names sit
in a sanctions-sensitive jurisdiction, and which side we hold them, is entirely ours. That is
what this module computes, and it works with no credential.

worldmonitor's `get_sanctions_data` (OFAC SDN entities plus per-country pressure scores)
would add the missing dimension: whether pressure is *rising*. It is credential-gated
exactly as `get_chokepoint_status` is — `tools/call` returns `-32001 Authentication required`,
cheapest unlock is the Pro tier at $39.99/mo (ADR-0095). This module is built so that score
scales an exposure we can already state, rather than being the thing that makes it
statable.

THE CLASSIFICATION IS A JUDGEMENT AND IS WRITTEN DOWN. `EXPOSURE_MECHANISM` names the
specific channel per jurisdiction rather than asserting a vague "risk". A reader can disagree
with an entry and see exactly what they are disagreeing with, which is not true of a score.

See ADR-0096.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .book_metrics import GEO_MAP

# The named mechanism by which a jurisdiction's holdings are sanctions-exposed.
#
# Deliberately keyed on GEO_MAP's jurisdictions rather than on tickers: a China ADR added to
# the universe tomorrow is covered the day it appears, the same generalisation argument S6's
# SECTOR_MAP transmission rests on (ADR-0088).
#
# Absence from this map is a claim too — "no identified sanctions channel" — and is why
# `unclassified` is reported rather than silently folded into "not exposed".
EXPOSURE_MECHANISM: dict[str, str] = {
    "China": (
        "US-listed Chinese ADRs: HFCAA delisting risk, Entity List additions, and "
        "outbound-investment restrictions. The most sanctions-exposed jurisdiction in the "
        "Tier-1 universe."
    ),
    "EM": (
        "Broad EM sleeves hold sanctioned-jurisdiction constituents indirectly via index "
        "membership; exposure is real but diluted and not name-specific."
    ),
}

# Jurisdictions with no identified sanctions channel. Listed explicitly so that "we checked
# and found none" is distinguishable from "we never looked" — the same known / unknown split
# ADR-0094 and the freshness verdict work landed on.
NO_IDENTIFIED_CHANNEL = ("US", "Global", "Europe", "Japan", "DM ex-US")


@dataclass
class SanctionsExposure:
    """The book's sanctions-sensitive exposure, by side."""
    long_weight: float = 0.0
    short_weight: float = 0.0
    gross_exposure: float = 0.0
    """Gross of the WHOLE book, so the shares below have a denominator."""
    exposed_gross: float = 0.0
    positions: list[dict] = field(default_factory=list)
    unclassified: list[str] = field(default_factory=list)
    """Held tickers whose jurisdiction is in neither map — cannot be judged either way."""

    @property
    def net_weight(self) -> float:
        """Signed: positive = net long sanctions risk, negative = net short it."""
        return self.long_weight - self.short_weight

    @property
    def share_of_gross(self) -> Optional[float]:
        """Exposed gross as a share of book gross, or None when the book has no gross.

        None rather than 0.0: a share of an empty book is unmeasurable, not zero
        (ADR-0066).
        """
        if self.gross_exposure <= 0:
            return None
        return self.exposed_gross / self.gross_exposure

    @property
    def direction(self) -> str:
        """`long` / `short` / `flat` / `none`, by net sanctions-risk exposure."""
        if self.exposed_gross <= 0:
            return "none"
        if abs(self.net_weight) < 1e-9:
            return "flat"
        return "long" if self.net_weight > 0 else "short"


def assess(picks: list[dict], gross_exposure: float) -> SanctionsExposure:
    """Classify a book's sanctions exposure.

    `gross_exposure` is passed in rather than summed from `picks` so the share is denominated
    in the same gross `book_metrics` reports; deriving it here would let the two disagree.
    """
    out = SanctionsExposure(gross_exposure=gross_exposure)

    for p in picks or []:
        asset = p.get("asset")
        weight = p.get("weight")
        if not asset or not isinstance(weight, (int, float)) or isinstance(weight, bool):
            continue
        if weight <= 0:
            continue

        geo = GEO_MAP.get(asset)
        if geo is None or (geo not in EXPOSURE_MECHANISM and geo not in NO_IDENTIFIED_CHANNEL):
            # Neither exposed nor cleared. Reported so a reader knows the assessment is
            # incomplete rather than negative.
            out.unclassified.append(asset)
            continue
        if geo not in EXPOSURE_MECHANISM:
            continue

        direction = p.get("direction")
        if direction not in ("long", "short"):
            # A position whose side we cannot read cannot be attributed to either side, and
            # guessing `long` would invert the book's stated posture.
            out.unclassified.append(asset)
            continue

        w = float(weight)
        out.exposed_gross += w
        if direction == "long":
            out.long_weight += w
        else:
            out.short_weight += w
        out.positions.append({
            "asset": asset,
            "direction": direction,
            "weight": w,
            "jurisdiction": geo,
            "mechanism": EXPOSURE_MECHANISM[geo],
        })

    out.positions.sort(key=lambda r: -r["weight"])
    return out


def describe(exp: SanctionsExposure) -> str:
    """One paragraph naming the exposure and which way it cuts.

    States the DIRECTION explicitly, because that is the part the book never said: holding
    sanctions-exposed names short means escalation helps, and a reader scanning a China-heavy
    book will assume the opposite.
    """
    share = exp.share_of_gross
    if exp.direction == "none":
        base = "The book holds no positions in a jurisdiction with an identified sanctions channel."
    else:
        pct = f"{share * 100:.1f}% of gross" if share is not None else "an unmeasurable share of gross"
        names = ", ".join(f"{p['direction']} {p['asset']}" for p in exp.positions)
        if exp.direction == "short":
            base = (
                f"The book is NET SHORT sanctions risk: {pct} sits in sanctions-exposed "
                f"jurisdictions ({names}), held net short by "
                f"{abs(exp.net_weight) * 100:.1f}pp. Sanctions escalation is therefore a "
                f"TAILWIND for this book, not a risk to it — the opposite of what a "
                f"China-heavy position list suggests at a glance."
            )
        elif exp.direction == "long":
            base = (
                f"The book is NET LONG sanctions risk: {pct} sits in sanctions-exposed "
                f"jurisdictions ({names}), held net long by {exp.net_weight * 100:.1f}pp. "
                f"Escalation is a direct headwind."
            )
        else:
            base = (
                f"The book holds {pct} in sanctions-exposed jurisdictions ({names}) but is "
                f"flat on net, so escalation is roughly neutral at the book level while "
                f"remaining live per name."
            )

    if exp.unclassified:
        base += (
            f" {len(exp.unclassified)} position(s) could not be classified "
            f"({', '.join(sorted(set(exp.unclassified)))}) — their sanctions exposure is "
            f"unknown, not absent."
        )
    return base


def to_row(exp: SanctionsExposure) -> dict:
    """Persisted shape for `research_recommendations.sanctions_exposure`.

    Carries the rendered sentence alongside the numbers so the page cannot restate the
    direction differently from the module that computed it — the same reason
    `scenario_results_to_dict` carries each scenario's own description (ADR-0095).
    """
    return {
        "direction": exp.direction,
        "long_weight": exp.long_weight,
        "short_weight": exp.short_weight,
        "net_weight": exp.net_weight,
        "exposed_gross": exp.exposed_gross,
        "gross_exposure": exp.gross_exposure,
        # None, not 0.0, when the book has no gross (ADR-0066).
        "share_of_gross": exp.share_of_gross,
        "positions": exp.positions,
        "unclassified": sorted(set(exp.unclassified)),
        "summary": describe(exp),
    }
