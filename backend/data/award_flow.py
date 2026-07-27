"""
Is a held name winning more federal work than usual? — the COT-index shape, on awards.

Bar 2's signal. `defense_awards` establishes WHO an award belongs to; this asks whether
the flow to that name is high or low **against its own history**, which is the only
comparison that means anything: Lockheed books ~$10bn a quarter and Northrop ~$2bn, so a
cross-sectional comparison would measure company size, not news.

**Deliberately the same construction as `cot_fetcher.cot_index`** — range position over a
trailing window, `None` rather than 50 when the window is too short or degenerate. Two
signals in one product that both answer "is this unusually high for this thing?" should not
answer it two different ways, and reusing the shape means the crowding panel's hard-won
discipline (coverage first, an absence with a reason) transfers without re-argument.

**THE INCOMPLETE QUARTER IS THE TRAP.** Measured 2026-07-27: Lockheed's trailing quarters
run ~$8–14bn, and the current one reads **$26m** — not a collapse, a quarter four weeks
old. Percentiling a partial bucket against complete ones produces a confident 0 and would
read as the most extreme negative signal in the series. So the final bucket is **always
dropped**, and the index describes the last COMPLETE quarter. That costs up to three months
of timeliness and is not negotiable: the alternative is a signal that screams every time a
quarter turns over.

**AND THE LATENCY MAY NOT FIT THIS PRODUCT — stated rather than buried.** Because two
trailing buckets are unusable, the reading describes a quarter that closed three to six
months ago. This book publishes on a 21-trading-day horizon (ADR-0090). A signal that stale
can inform a structural view of who is winning work; it cannot inform a three-week trade,
and nobody should let its presence in the pipeline imply otherwise. Whether it earns a
place in sizing is a separate decision, and on this evidence the honest default is no.

**What this is not.** It is not a forecast, and award value is not revenue — a multi-year
IDIQ ceiling books at award and is delivered over years. It says a name is winning more or
less work than it usually does, which is a fact about order flow, and leaves the reading
to the reasoner (the same line `position_dossier` draws).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

ENDPOINT = "https://api.usaspending.gov/api/v2/search/spending_over_time/"
DEFAULT_TIMEOUT = 20.0
AWARD_TYPE_CODES = ["A", "B", "C", "D"]

# Trailing window. Twelve complete quarters is three years — the same span
# `cot_fetcher.WINDOW_WEEKS` covers, chosen for the same reason: long enough that a range
# position means something, short enough that it still describes the current regime.
WINDOW_QUARTERS = 12

# Below this the range is being set by too few points for a position within it to be a
# percentile. Mirrors `cot_fetcher.MIN_WEEKS` in intent.
MIN_QUARTERS = 8

# HOW MANY TRAILING BUCKETS ARE UNUSABLE. Not one — two.
#
# The current quarter is obviously partial. The one before it is ALSO materially
# under-reported, because agencies submit to USASpending on a lag of weeks to months.
# Measured 2026-07-27, four weeks after FY2026Q3 closed:
#
#     LMT   FY2026Q2 $16.4bn -> FY2026Q3  $6.7bn   (41% of prior)
#     NOC   FY2026Q2  $5.1bn -> FY2026Q3  $0.78bn  (15% of prior)
#
# An 85% collapse in Northrop's award flow would be extraordinary news, not a quiet data
# point — and all three mapped primes printed at or near a 12-quarter LOW simultaneously,
# which is the tell. A signal that fires "record low" every time the data has not finished
# arriving is worse than no signal, because it fires hardest exactly when it is least
# informed.
#
# The cost is timeliness and it is severe: the reading describes a quarter that closed
# three to six months ago. See the module docstring on whether that fits this product.
SETTLEMENT_LAG_BUCKETS = 2


@dataclass(frozen=True)
class FlowReading:
    """Award flow for one ticker, positioned against its own trailing history."""

    ticker: str
    index: Optional[float]          # 0-100 range position, None when unusable
    latest_obligated: float
    latest_period: str
    quarters: int
    low: float
    high: float
    reason: Optional[str] = None    # why `index` is None, when it is

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "index": self.index,
            "latest_obligated": self.latest_obligated,
            "latest_period": self.latest_period,
            "quarters": self.quarters,
            "low": self.low,
            "high": self.high,
            "reason": self.reason,
        }


def flow_index(amounts: list[float]) -> Optional[float]:
    """Range position of the most recent value within its own trailing window.

    Identical construction to `cot_fetcher.cot_index`, including its refusals: `None` on a
    short window and `None` on a flat one, never 50.0. A degenerate range has no position
    within it, and returning the midpoint would invent a reading.
    """
    if len(amounts) < MIN_QUARTERS:
        return None
    low, high = min(amounts), max(amounts)
    if high == low:
        return None
    return 100.0 * (amounts[-1] - low) / (high - low)


def _period_label(bucket: dict) -> str:
    period = bucket.get("time_period") or {}
    return f"FY{period.get('fiscal_year')}Q{period.get('quarter')}"


def fetch_flow(
    ticker: str,
    recipient_search: list[str],
    start_date: str,
    end_date: str,
    timeout: float = DEFAULT_TIMEOUT,
) -> FlowReading:
    """Quarterly award flow for one ticker, indexed against its own history.

    Server-side aggregation: one request per ticker rather than paginating thousands of
    individual awards at 100 a page. Never raises — an overlay must not cost the run, and
    the failure travels as a `reason` so an absence says which absence it is (ADR-0098).
    """
    body = {
        "group": "quarter",
        "filters": {
            "award_type_codes": AWARD_TYPE_CODES,
            "time_period": [{"start_date": start_date, "end_date": end_date}],
            "recipient_search_text": recipient_search,
        },
    }
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "andromeda-research/1.0 (+https://andromeda-analytics.vercel.app)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        return FlowReading(ticker, None, 0.0, "", 0, 0.0, 0.0,
                           reason=f"fetch failed ({exc.__class__.__name__})")

    buckets = payload.get("results")
    if not isinstance(buckets, list) or not buckets:
        return FlowReading(ticker, None, 0.0, "", 0, 0.0, 0.0,
                           reason="the API returned no quarterly buckets")

    return reading_from_buckets(ticker, buckets)


def reading_from_buckets(ticker: str, buckets: list[dict]) -> FlowReading:
    """Turn API buckets into a reading. Split out so the trap below is testable offline."""
    ordered = list(buckets)

    # DROP THE FINAL BUCKET, ALWAYS. See the module docstring: a quarter in progress reads
    # as a near-total collapse against completed ones, which is the single most misleading
    # thing this signal could say.
    if len(ordered) <= SETTLEMENT_LAG_BUCKETS:
        return FlowReading(
            ticker, None, 0.0, "", 0, 0.0, 0.0,
            reason=f"only {len(ordered)} quarters returned, and the trailing "
                   f"{SETTLEMENT_LAG_BUCKETS} are still settling",
        )
    complete = ordered[:-SETTLEMENT_LAG_BUCKETS][-WINDOW_QUARTERS:]

    amounts: list[float] = []
    for bucket in complete:
        value = bucket.get("aggregated_amount")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            amounts.append(float(value))

    if not amounts:
        return FlowReading(ticker, None, 0.0, "", 0, 0.0, 0.0,
                           reason="no quarter carried a usable amount")

    index = flow_index(amounts)
    reason = None
    if index is None:
        reason = (
            f"{len(amounts)} complete quarters, against the {MIN_QUARTERS} a range "
            "position needs"
            if len(amounts) < MIN_QUARTERS
            else "every quarter in the window carried the same value, so there is no "
                 "range to position within"
        )

    return FlowReading(
        ticker=ticker,
        index=index,
        latest_obligated=amounts[-1],
        latest_period=_period_label(complete[-1]),
        quarters=len(amounts),
        low=min(amounts),
        high=max(amounts),
        reason=reason,
    )
