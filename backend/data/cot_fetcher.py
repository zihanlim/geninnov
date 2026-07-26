"""
CFTC Commitments of Traders — what speculators are already positioned in, and how extreme.

WHY THIS EXISTS. Every crowding signal in this system so far is INTERNAL: HypeScore measures
attention in a corpus we assemble, and `AttentionCrowding` compares themes against each other
inside our own universe. None of it can answer the question a reader actually has — *is
everyone else already in this trade?* COT is the one external positioning series that is
free, official, keyless, and long enough to percentile.

WHAT IT MEASURES. The non-commercial ("speculator") net long minus short in a futures
contract, expressed as its percentile within a trailing window — the conventional COT index.
A high reading means specs are near the top of their own three-year range: crowded long. A
low reading means crowded short. It is a *positioning* measure, not a price forecast, and it
is used here as a RISK input (a book that agrees with a crowded consensus is exposed to that
consensus unwinding), never as a reason to put a trade on.

WHAT IT CANNOT SEE, WHICH IS MOST OF THE BOOK. COT covers exchange-traded futures. A book of
single-name equities and sector ETFs mostly has no contract, and the honest output is
therefore a COVERAGE number first and a crowding number second. See `COT_CONTRACTS` for what
maps and `UNMAPPED_REASON` for why the rest does not. Manufacturing coverage — mapping GDX to
gold futures, or XLE to crude — would be the failure this module exists to avoid.

THE LAG IS STRUCTURAL AND MUST BE CARRIED. Positions are as of TUESDAY and published the
following FRIDAY at 15:30 ET. A reading is therefore never fresher than three days and is up
to ten days old by the time the next one prints. `as_of` is the OBSERVATION date, not the
retrieval date; the two are different facts and are reported separately.

Source: https://publicreporting.cftc.gov/resource/6dca-aqww.json (Socrata, no credential).

See ADR-0097.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable, Optional

# The Socrata endpoint for the legacy futures-only report. "Legacy" is the right one here:
# it carries the commercial / non-commercial split the COT index is defined on. The
# disaggregated report splits specs further (managed money, other reportables), which is more
# precise but has a shorter history and no settled percentile convention.
CFTC_ENDPOINT = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"

# Trailing window for the percentile, in weekly prints. 156 = three years, the conventional
# COT-index lookback.
WINDOW_WEEKS = 156

# Below this many prints the percentile is not meaningful and we return None rather than a
# number computed from a range too short to be a range. A contract that listed last year has
# an UNKNOWN percentile, not a mid-range one.
MIN_WEEKS = 104

# Network budget PER CONTRACT. One request per distinct contract, so the worst case is this
# times the number of mapped contracts a book holds (at most 13 in the current universe, 2 in
# the live book). Kept low deliberately: the nightly pipeline must not be held up by a public
# data portal, and a missing reading degrades to "unobservable" rather than to a wrong number.
DEFAULT_TIMEOUT = 12.0


@dataclass(frozen=True)
class ContractMap:
    """A book asset and the futures contract whose speculator positioning speaks to it."""

    code: str
    name: str
    # True when a LONG position in the asset is a SHORT position in the contract's underlying.
    # SVXY is the case that forces this field to exist: it is a -0.5x inverse VIX product, so
    # long SVXY is short volatility. Matching its direction to the VIX COT reading without the
    # flip yields a crowding verdict that is exactly backwards — confidently wrong, and with
    # no symptom a reader could catch.
    inverse: bool
    # Why this contract tracks this asset, written down so a reader can disagree with the
    # specific claim rather than with an opaque mapping.
    rationale: str


# Assets whose underlying IS the contract's underlying. The bar is deliberately high: the ETF
# must hold, or directly track, the thing the contract settles on. Anything requiring a story
# about correlation belongs in UNMAPPED_REASON instead.
COT_CONTRACTS: dict[str, ContractMap] = {
    "GLD": ContractMap("088691", "GOLD", False,
                       "Physically-backed gold; spot is arbitraged to the COMEX contract."),
    "IAU": ContractMap("088691", "GOLD", False,
                       "Physically-backed gold; spot is arbitraged to the COMEX contract."),
    "SLV": ContractMap("084691", "SILVER", False,
                       "Physically-backed silver; same arbitrage as gold."),
    "CL":  ContractMap("067651", "WTI-PHYSICAL", False,
                       "WTI crude — the contract IS the exposure."),
    "UNG": ContractMap("023651", "NAT GAS NYME", False,
                       "Holds front-month Henry Hub natural gas futures directly."),
    "UUP": ContractMap("098662", "USD INDEX", False,
                       "Tracks the ICE dollar index, the contract's own underlying."),
    "FXE": ContractMap("099741", "EURO FX", False,
                       "Holds euro deposits; the CME contract settles on the same rate."),
    "SHY": ContractMap("042601", "UST 2Y NOTE", False,
                       "1-3y Treasuries — the 2y note contract is the cash leg's hedge."),
    "IEF": ContractMap("043602", "UST 10Y NOTE", False,
                       "7-10y Treasuries against the 10y note contract."),
    "TLT": ContractMap("020601", "UST BOND", False,
                       "20y+ Treasuries against the long-bond contract."),
    "SPY": ContractMap("13874A", "E-MINI S&P 500", False,
                       "Tracks the S&P 500; the e-mini settles on the same index."),
    "QQQ": ContractMap("209742", "NASDAQ MINI", False,
                       "Tracks the Nasdaq-100; the e-mini settles on the same index."),
    "IWM": ContractMap("239742", "RUSSELL E-MINI", False,
                       "Tracks the Russell 2000; the e-mini settles on the same index."),
    "SVXY": ContractMap("1170E1", "VIX FUTURES", True,
                        "A -0.5x INVERSE short-term VIX futures product: long SVXY is a "
                        "SHORT volatility position, so the contract reading is flipped."),
}

# Why an asset has no contract, keyed on the SECTOR_MAP sector so a name added to the universe
# tomorrow inherits a reason the day it appears — the same generalisation the S6 transmission
# and the sanctions jurisdiction map rest on.
#
# These are claims, not shrugs. "We checked and there is no contract" is a different statement
# from "we never looked", and the panel must be able to tell a reader which one it is.
UNMAPPED_REASON: dict[str, str] = {
    "Gold Miners": (
        "Miners are equity claims on a mining business — levered to the metal, but carrying "
        "operating cost, jurisdiction and financing risk the metal does not. Speculator "
        "positioning in gold futures is not positioning in miners, and treating it as such "
        "would manufacture coverage."
    ),
    "Energy": (
        "Energy equities, not crude. Refining margin, capital discipline and buybacks move "
        "them independently of the front-month contract."
    ),
    "Metals": (
        "Industrial-metal equities rather than the metal; the same equity-vs-commodity gap as "
        "the miners."
    ),
    "Credit": (
        "The CFTC publishes no Commitments report for corporate credit. Positioning in HY and "
        "IG is genuinely unobservable in this dataset — not small, not zero, unobservable."
    ),
    "China Equities": "No US futures contract carries meaningful speculator positioning in these names.",
    "EM Equities": "No US futures contract carries meaningful speculator positioning in these names.",
    "Developed Equities": "No US futures contract carries meaningful speculator positioning in these names.",
    "Japan Equities": "No US futures contract carries meaningful speculator positioning in these names.",
    "FX-EM": "No US futures contract carries meaningful speculator positioning in these names.",
    "Disruptive Innovation": "A thematic equity basket with no corresponding futures contract.",
}

# The reason used when the sector itself is unlisted. Single names land here, which is correct:
# there is no single-stock COT.
DEFAULT_UNMAPPED_REASON = (
    "No exchange-traded futures contract tracks this position, so speculator positioning in it "
    "is not observable in the Commitments of Traders report."
)


@dataclass(frozen=True)
class CotReading:
    """One contract's speculator positioning and where it sits in its own range."""

    code: str
    name: str
    net_spec: int
    # 0-100 percentile of `net_spec` within the trailing window, or None when the window is
    # too short to percentile against.
    index: Optional[float]
    # OBSERVATION date — the Tuesday the positions were held, not the day we fetched them.
    as_of: str
    weeks: int
    low: int
    high: int


def cot_index(net_series: Iterable[int]) -> Optional[float]:
    """Percentile of the latest net spec position within its own trailing range.

    `net_series` is ordered NEWEST FIRST, matching the API's `$order=... DESC`.

    None — never a number — when there are too few prints, or when the range is degenerate.
    A flat series has no percentile; returning 50.0 for it would invent a mid-range reading
    out of no information at all.
    """
    net = list(net_series)
    if len(net) < MIN_WEEKS:
        return None
    lo, hi = min(net), max(net)
    if hi == lo:
        return None
    return 100.0 * (net[0] - lo) / (hi - lo)


def unmapped_reason(asset: str, sector_map: Optional[dict[str, str]] = None) -> str:
    """Why `asset` has no COT contract, by sector, falling back to the general case."""
    if sector_map is None:
        from ..services.book_metrics import SECTOR_MAP as _sm

        sector_map = _sm
    sector = sector_map.get(asset)
    if sector is None:
        return DEFAULT_UNMAPPED_REASON
    return UNMAPPED_REASON.get(sector, DEFAULT_UNMAPPED_REASON)


def _fetch_contract(code: str, timeout: float) -> Optional[CotReading]:
    """One contract's trailing window, or None if the portal does not answer."""
    query = urllib.parse.urlencode({
        "$select": (
            "report_date_as_yyyy_mm_dd,noncomm_positions_long_all,"
            "noncomm_positions_short_all"
        ),
        "$where": f"cftc_contract_market_code='{code}'",
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": WINDOW_WEEKS,
    })
    req = urllib.request.Request(
        f"{CFTC_ENDPOINT}?{query}",
        headers={"Accept": "application/json", "User-Agent": "andromeda/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        print(f"[cot_fetcher] {code}: fetch failed ({exc.__class__.__name__}: {exc})")
        return None
    if not rows:
        return None

    net: list[int] = []
    for r in rows:
        try:
            net.append(
                int(r["noncomm_positions_long_all"]) - int(r["noncomm_positions_short_all"])
            )
        except (KeyError, TypeError, ValueError):
            # A malformed print is dropped, not zero-filled: a zero would enter the range and
            # move the percentile.
            continue
    if not net:
        return None

    return CotReading(
        code=code,
        name="",  # filled by the caller, which knows the mapping's display name
        net_spec=net[0],
        index=cot_index(net),
        as_of=str(rows[0].get("report_date_as_yyyy_mm_dd", ""))[:10],
        weeks=len(net),
        low=min(net),
        high=max(net),
    )


def fetch_readings(
    assets: Iterable[str],
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, CotReading]:
    """COT readings for whichever of `assets` map to a contract.

    Returns only assets that BOTH map and fetched successfully. An asset missing from the
    result is not "uncrowded" — the caller must distinguish unmapped from unfetched, which is
    why `positioning_crowding.assess` takes the mapping into account itself rather than
    inferring absence from this dict.

    One request per distinct contract, so two assets on the same contract (GLD and IAU) cost
    one call.
    """
    wanted: dict[str, list[str]] = {}
    for a in assets:
        cm = COT_CONTRACTS.get(a)
        if cm is not None:
            wanted.setdefault(cm.code, []).append(a)

    out: dict[str, CotReading] = {}
    for code, asset_list in wanted.items():
        reading = _fetch_contract(code, timeout)
        if reading is None:
            continue
        for a in asset_list:
            cm = COT_CONTRACTS[a]
            out[a] = CotReading(
                code=reading.code,
                name=cm.name,
                net_spec=reading.net_spec,
                index=reading.index,
                as_of=reading.as_of,
                weeks=reading.weeks,
                low=reading.low,
                high=reading.high,
            )
    return out
