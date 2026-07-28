"""
Does attention to this narrative move prices? (ADR-0143)

THE ARGUMENT
============
[ADR-0142](../../docs/adrs/0142-frequency-cannot-tell-a-narrative-from-a-register.md)
rejected TF-IDF, background-lift and capitalisation as ways to tell a narrative
from the register of financial writing, and concluded that the problem was being
attacked as linguistics when the definition is economic. The brief says a market
theme is *"a narrative driving cross-asset moves"*. That is a testable claim about
prices, and no amount of text statistics substitutes for testing it.

So: `earnings` appears in 27.6% of headlines and is the loudest phrase in the
corpus, but attention to it should correlate with nothing in particular — every
listed company reports, so it is ambient. `ai capex` should co-move with the
semiconductor and power complex. **That difference is measurable**, and it is the
one signal here that does not care how a phrase is spelled.

WHAT THIS REUSES RATHER THAN REBUILDS
=====================================
Nothing here is a new statistic. It is [ADR-0127](../../docs/adrs/0127-the-cross-asset-term-measured-one-asset.md)'s
cross-asset correlation — `correlation_with_mentions`, `per_class_corr`,
`cross_asset_corr_subscore`, `corr_breadth` — pointed at a narrative phrase's
mention series instead of an anchor theme's. One formula, one place (ADR-0064).
A phrase that passes is being judged by exactly the test the nine live themes are
judged by, which is what makes the two comparable.

WHAT IT DOES NOT CLAIM
======================
A correlation between attention and returns is **not** causation, and this cannot
tell the two apart: prices moving may be what *generates* the coverage. What it
does establish is the weaker, sufficient claim — that a phrase's attention series
has *something* to do with a tradeable asset, as against being ambient vocabulary.
Ambient is what it is built to exclude, and ambient is most of the board.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

from backend.data.yahoo_client import correlation_with_mentions
from backend.services.hype_calculator import (
    CORR_MATERIAL,
    corr_breadth,
    cross_asset_corr_subscore,
    per_class_corr,
    representative_corr,
)
from backend.services.narrative_tracker import phrases_in

#: Trading sessions below which a correlation is reported but NOT trusted.
#:
#: `correlation_with_mentions` refuses under 5 — that is the floor for computing
#: anything at all. This is the higher bar for *believing* it: at n=6 a Pearson r
#: needs |r| > 0.81 for p < 0.05, so anything short of near-perfect is noise
#: wearing a decimal point. 20 sessions is about a trading month.
#:
#: The distinction matters because ADR-0059 is the standing lesson here: a
#: single-date IC turned a panel green on one observation. A reading below this
#: floor is marked `provisional` and must not gate anything.
MIN_SESSIONS_FOR_VERDICT = 20


@dataclass(frozen=True)
class PriceLink:
    """Whether a phrase's attention co-moves with any asset class."""
    phrase: str
    #: Signed correlation per asset class, measured classes only.
    corr_by_class: dict[str, float] = field(default_factory=dict)
    #: (classes moving materially, classes measured).
    material: int = 0
    measured: int = 0
    #: Magnitude-and-breadth score in [0, 1]; None when nothing was measurable.
    subscore: float | None = None
    #: Strongest signed reading — the one number, kept for direction.
    representative: float | None = None
    #: Overlapping trading sessions the correlation rests on. Travels with every
    #: reading because the verdict is meaningless without it.
    sessions: int = 0

    @property
    def provisional(self) -> bool:
        """True when there is not yet enough history to believe this."""
        return self.sessions < MIN_SESSIONS_FOR_VERDICT

    @property
    def verdict(self) -> str:
        """`insufficient_history` | `linked` | `ambient` | `unmeasurable`.

        **`insufficient_history` outranks every other answer**, and that ordering
        was forced by the first live run rather than chosen in advance. On 8
        publication days — 5 overlapping trading sessions — this returned `linked`
        for **all fourteen** phrases tested, at scores 0.84 to 1.00 with 4-5 of 5
        asset classes "material". `earnings`, `wall`, `q2` and `analysts` all
        looked like market themes moving the entire book. At n=5 a Pearson r is
        near ±1 by chance, so the gate was measuring sample size.

        Reporting that as `linked` with a separate `provisional` flag would have
        put the true answer behind an opt-in a caller must remember to check —
        which is how ADR-0059's single-date IC turned a validation panel green.
        The honest answer is now the DEFAULT one, and the raw numbers stay on the
        record for inspection.

        `ambient` is the discrimination this exists to make, once there is enough
        history to make it: the phrase WAS measurable against the book's assets
        and moved none of them.
        """
        if self.sessions < MIN_SESSIONS_FOR_VERDICT:
            return "insufficient_history"
        if self.subscore is None or self.measured == 0:
            return "unmeasurable"
        return "linked" if self.material > 0 else "ambient"


def daily_share_series(
    dated_headlines: list[tuple[date, str]],
    phrase: str,
) -> pd.Series:
    """Share of voice for one phrase, per publication date.

    SHARE, not raw count, for the reason ADR-0128 gives: the number of stories
    collected varies by day (13 on a Saturday, 80 on a Monday here), so a raw
    count correlates with the news cycle's volume rather than with the phrase.
    Dividing by that day's document total removes the common factor that would
    otherwise make every phrase correlate with every other.

    Indexed by ISO date string, which is what `correlation_with_mentions` expects
    and normalises.
    """
    per_day_total: dict[date, int] = defaultdict(int)
    per_day_hits: dict[date, int] = defaultdict(int)

    for day, headline in dated_headlines:
        if day is None:
            continue
        per_day_total[day] += 1
        if phrase in phrases_in(headline):
            per_day_hits[day] += 1

    if not per_day_total:
        return pd.Series(dtype=float)

    return pd.Series({
        day.isoformat(): per_day_hits[day] / per_day_total[day]
        for day in sorted(per_day_total)
    })


def assess_price_link(
    phrase: str,
    dated_headlines: list[tuple[date, str]],
    price_df: pd.DataFrame,
    asset_class_of: dict[str, str],
    tickers: list[str] | None = None,
) -> PriceLink:
    """Correlate one phrase's attention against every mapped asset, per class.

    Deliberately the SAME path an anchor theme takes (ADR-0127): measure every
    ticker, drop the unmeasurable rather than scoring them zero, collapse to one
    signed reading per asset class, then score magnitude and breadth together.
    """
    series = daily_share_series(dated_headlines, phrase)
    if series.empty or price_df.empty:
        return PriceLink(phrase=phrase)

    universe = tickers if tickers is not None else sorted(asset_class_of)
    measured: dict[str, float | None] = {
        t: correlation_with_mentions(price_df, series, t) for t in universe
    }

    by_class = per_class_corr(measured, asset_class_of)
    material, measured_n = corr_breadth(by_class, threshold=CORR_MATERIAL)

    # Overlapping sessions: what the correlation actually rests on. Taken from
    # the price frame's own dates so a weekend in the mention series cannot be
    # counted as a session that never traded.
    sessions = 0
    if not price_df.empty and "date" in price_df.columns:
        price_days = {
            d.isoformat() if hasattr(d, "isoformat") else str(d)
            for d in price_df["date"].dropna().unique()
        }
        sessions = len(price_days & set(series.index))

    return PriceLink(
        phrase=phrase,
        corr_by_class=by_class,
        material=material,
        measured=measured_n,
        subscore=cross_asset_corr_subscore(by_class),
        representative=representative_corr(by_class),
        sessions=sessions,
    )


def rank_by_link(links: list[PriceLink]) -> list[PriceLink]:
    """Linked phrases first, by breadth then magnitude; ambient after; then the
    unmeasurable.

    This is the ordering the board should eventually use in place of share. A
    narrative that moves three asset classes outranks one that moves one, and both
    outrank the loudest phrase in the corpus if that phrase moves nothing.
    """
    order = {"linked": 0, "ambient": 1, "unmeasurable": 2, "insufficient_history": 3}
    return sorted(
        links,
        key=lambda l: (order[l.verdict], -l.material, -(l.subscore or 0.0), l.phrase),
    )
