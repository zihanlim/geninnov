"""
M3: Macro Regime Classifier (L3)
Rule-based, deterministic, auditable.

Inputs (all from L0 macro_indicators):
  - Yield curve slope: 10y - 2y Treasury
  - HY credit OAS: BAMLH0A0HYM2 (bps)
  - VIX spot: ^VIX
  - VIX term: VIX - VIX3M  (contango vs backwardation)
  - Real rate: 10y - breakeven inflation
  - SPX breadth: % SPX above 200d MA (computed from price data)

Output: (cycle, sentiment) tuple
  cycle: early | mid | late | recession
  sentiment: risk-on | neutral | risk-off

Thresholds are hand-coded. Upgradable to ML later.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
import math
from typing import Optional

import pandas as pd
import yfinance as yf
from supabase import Client, create_client


@dataclass
class RegimeOutput:
    cycle: str          # early | mid | late | recession
    sentiment: str      # risk-on | neutral | risk-off
    # Audit trail
    yield_curve_slope: float | None
    hy_oas: float | None
    vix_level: float | None
    vix_term_diff: float | None
    real_rate: float | None
    spx_breadth: float | None


def _fetch_latest_series(
    supabase: Client,
    series_id: str,
    lookback: int = 30,
    as_of: Optional[date] = None,
) -> Optional[float]:
    """Most recent non-null value for a series, as known on `as_of`.

    `as_of` bounds the lookup to observations dated on or before that day. It
    is required for correctness whenever the caller stamps its output with a
    run_date: without the bound, classifying (or backfilling) a past date would
    read observations that did not exist yet, which is look-ahead bias. Omit it
    only for genuine "what is true right now" reads.
    """
    query = (
        supabase.table("macro_daily_history")
        .select("value, trading_date")
        .eq("series_id", series_id)
    )
    if as_of is not None:
        query = query.lte("trading_date", as_of.isoformat())
    resp = query.order("trading_date", desc=True).limit(lookback).execute()
    for row in resp.data:
        if row["value"] is not None:
            return float(row["value"])
    return None


_SPY_HISTORY_CACHE: Optional["pd.DataFrame"] = None


def _spy_history(period: str = "3y") -> Optional["pd.DataFrame"]:
    """SPY daily closes, fetched once per process.

    Cached because the backfill asks for breadth on ~250 separate dates off the
    same series; downloading it 250 times would be 250 identical round trips.
    """
    global _SPY_HISTORY_CACHE
    if _SPY_HISTORY_CACHE is None:
        try:
            _SPY_HISTORY_CACHE = yf.Ticker("SPY").history(period=period, interval="1d")
        except Exception:
            return None
    return _SPY_HISTORY_CACHE


def _compute_spx_breadth(
    as_of: Optional[date] = None,
    hist: Optional["pd.DataFrame"] = None,
) -> Optional[float]:
    """SPX breadth proxy: is SPY above its own 200-day moving average.

    ``as_of`` truncates the price history to that date, and it is not optional
    in spirit — every OTHER input to `classify()` is already bounded by
    `run_date` (see `_fetch_latest_series`), and this one was not. Classifying a
    past date therefore mixed as-of macro readings with TODAY's breadth: a
    look-ahead leak, and the one input capable of flipping the sentiment label.
    It was invisible while the only caller was "classify right now"; a backfill
    makes it wrong 250 times.

    ``hist`` is injectable so the logic can be tested against a synthetic series
    without touching the network.

    HONEST ABOUT WHAT THIS IS: despite the name and the "%" unit the UI gives it,
    this returns 65.0 or 35.0 and nothing in between. It is a BINARY
    SPY-above-its-MA flag wearing a percentage, not the share of index members
    above their own 200d MA. Left as-is here because changing what the number
    MEANS is a separate decision from fixing when it is measured — but a reader
    who sees "S&P breadth 65%" is reading a flag, and that deserves its own fix.
    """
    try:
        frame = hist if hist is not None else _spy_history()
        if frame is None or frame.empty:
            return None
        if as_of is not None:
            # Index is tz-aware from yfinance; compare on calendar dates.
            frame = frame[[d.date() <= as_of for d in frame.index]]
        if len(frame) < 200:
            return None
        ma200 = frame["Close"].rolling(200).mean()
        latest_close = frame["Close"].iloc[-1]
        latest_ma = ma200.iloc[-1]
        if latest_ma != latest_ma:  # NaN — fewer than 200 usable observations
            return None
        return 65.0 if latest_close > latest_ma else 35.0
    except Exception:
        return None


def _classify_cycle(
    yield_curve_slope: float | None,
    hy_oas: float | None,
    real_rate: float | None,
) -> str:
    """
    Cycle: early | mid | late | recession
    """
    yc = yield_curve_slope
    hy = hy_oas
    rr = real_rate

    # Recession signals
    if yc is not None and yc < -50 and hy is not None and hy > 500:
        return "recession"
    if yc is not None and yc < -100:
        return "recession"
    if hy is not None and hy > 600:
        return "recession"

    # Early cycle: curve steepening, credit normalizing, real rates low/negative
    if yc is not None and yc > 50 and rr is not None and rr < 0.5:
        return "early"
    if yc is not None and yc > 80:
        return "early"

    # Late cycle: curve flat/inverted, real rates restrictive, credit wide
    if yc is not None and yc < 0 and rr is not None and rr > 1.0:
        return "late"
    if yc is not None and yc < 30 and hy is not None and hy > 350:
        return "late"
    if rr is not None and rr > 1.5:
        return "late"

    # Mid cycle: default
    return "mid"


def _classify_sentiment(
    vix_level: float | None,
    vix_term_diff: float | None,
    hy_oas: float | None,
    spx_breadth: float | None,
) -> str:
    """
    Sentiment: risk-on | neutral | risk-off
    """
    vix = vix_level
    vix_term = vix_term_diff
    hy = hy_oas
    breadth = spx_breadth

    # Risk-off signals
    if vix is not None and vix > 25:
        return "risk-off"
    if vix is not None and vix > 20 and hy is not None and hy > 400:
        return "risk-off"
    if vix_term is not None and vix_term > 5:
        # Backwardation: stress
        return "risk-off"
    if hy is not None and hy > 500:
        return "risk-off"
    if breadth is not None and breadth < 40:
        return "risk-off"

    # Risk-on signals
    if vix is not None and vix < 15 and (hy is None or hy < 300):
        return "risk-on"
    if vix_term is not None and vix_term < -3 and vix is not None and vix < 18:
        # Contango + low VIX: complacent risk-on
        return "risk-on"
    if hy is not None and hy < 250 and vix is not None and vix < 15:
        return "risk-on"
    if breadth is not None and breadth > 60:
        return "risk-on"

    return "neutral"


def risk_appetite(
    vix_level: float | None,
    hy_oas: float | None,
    vix_term_diff: float | None,
    spx_breadth: float | None,
) -> float | None:
    """Continuous risk appetite in [-1, +1]. Positive = risk-on. None = no inputs.

    The discrete label above is a good SUMMARY and a terrible DIAL. It is a step
    function, and EdgeScore multiplies it by each asset class's risk beta, so a label
    change swings an equity's regime component from +0.5*beta to -0.5*beta — a full
    1.0*beta move on a term carrying 0.23 of the score. That is enough to invert the
    whole book.

    It did. Two runs hours apart on 2026-07-24 produced opposite books (4 long / 2
    short at net +26.7%, then 2 long / 3 short at net -20%) because the label went
    risk-on -> neutral. With VIX at 18.6 (failing the <15 and <18 rules) and HY OAS
    at 268bp (failing <250), the ONLY rule that could return risk-on was
    `breadth > 60` — so $100M of positioning hung on one breadth statistic crossing a
    single integer. 61 and 59 are not different market states.

    Each input contributes a smooth tanh term centred on its own neutral level, and
    the available ones are averaged. Crossing any threshold now moves the score by a
    little rather than inverting it, while the ordering and the sign are unchanged
    where the signal is genuinely strong.
    """
    terms: list[float] = []
    # VIX: calm below ~19, stressed above. Scale 6 keeps 13 and 25 near +/-0.7.
    if vix_level is not None:
        terms.append(-math.tanh((vix_level - 19.0) / 6.0))
    # HY OAS in bp: 350 is the long-run middle of the range we see.
    if hy_oas is not None:
        terms.append(-math.tanh((hy_oas - 350.0) / 150.0))
    # VIX term structure: contango (negative) is calm, backwardation is stress.
    if vix_term_diff is not None:
        terms.append(-math.tanh(vix_term_diff / 4.0))
    # Breadth: 50% is neutral participation.
    if spx_breadth is not None:
        terms.append(math.tanh((spx_breadth - 50.0) / 15.0))

    if not terms:
        return None
    return max(-1.0, min(1.0, sum(terms) / len(terms)))


class RegimeClassifier:
    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)

    def classify(self, run_date: date | None = None) -> RegimeOutput:
        """
        Pull L0 inputs, classify regime, persist to regime_classifications.
        Returns RegimeOutput.
        """
        run_date = run_date or date.today()

        # Pull raw inputs. Every read is bounded by run_date: this row is
        # persisted under run_date, so reading anything newer would attribute
        # future information to a past classification.
        yield_curve = _fetch_latest_series(self.supabase, "DGS10", as_of=run_date)
        y2 = _fetch_latest_series(self.supabase, "DGS2", as_of=run_date)
        yield_curve_slope = (yield_curve - y2) if (yield_curve and y2) else None

        hy_oas = _fetch_latest_series(self.supabase, "BAMLH0A0HYM2", as_of=run_date)
        vix_spot = _fetch_latest_series(self.supabase, "^VIX", as_of=run_date)
        vix3m = _fetch_latest_series(self.supabase, "^VIX3M", as_of=run_date)
        vix_term_diff = (vix_spot - vix3m) if (vix_spot and vix3m) else None

        real_rate = None
        dgs10 = yield_curve
        breakeven = _fetch_latest_series(self.supabase, "T10YIE", as_of=run_date)
        if dgs10 is not None and breakeven is not None:
            real_rate = dgs10 - breakeven

        # Bounded by run_date like every other input above. Passing nothing here
        # is what let a backfilled 2025 row carry today's breadth.
        spx_breadth = _compute_spx_breadth(as_of=run_date)

        # FRED reports the curve slope (DGS10-DGS2) and HY OAS (BAMLH0A0HYM2) in
        # PERCENT — 0.34, 2.77 — but every threshold below and in risk_appetite is
        # calibrated in BASIS POINTS ("yc < -50", "HY OAS in bp: 350"). Passing the
        # percent values made the yield-curve and HY rules unreachable (0.34 is never
        # < -50, 2.77 never > 350), so cycle fell to real_rate alone and sentiment to
        # VIX/breadth alone — the two headline inputs of a credit-cycle model were dead.
        # Convert here; persist the percent values the UI formats (34bps, 2.77%).
        yc_bps = yield_curve_slope * 100 if yield_curve_slope is not None else None
        hy_bps = hy_oas * 100 if hy_oas is not None else None

        # Classify
        cycle = _classify_cycle(yc_bps, hy_bps, real_rate)
        sentiment = _classify_sentiment(vix_spot, vix_term_diff, hy_bps, spx_breadth)

        output = RegimeOutput(
            cycle=cycle,
            sentiment=sentiment,
            yield_curve_slope=yield_curve_slope,
            hy_oas=hy_oas,
            vix_level=vix_spot,
            vix_term_diff=vix_term_diff,
            real_rate=real_rate,
            spx_breadth=spx_breadth,
        )

        # Persist
        self.supabase.table("regime_classifications").upsert(
            {
                "run_date": run_date.isoformat(),
                "cycle": cycle,
                "sentiment": sentiment,
                "yield_curve_slope": yield_curve_slope,
                "hy_oas": hy_oas,
                "vix_level": vix_spot,
                "vix_term_diff": vix_term_diff,
                "real_rate": real_rate,
                "spx_breadth": spx_breadth,
            },
            on_conflict="run_date",
        ).execute()

        return output


if __name__ == "__main__":
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if url and key:
        clf = RegimeClassifier(url, key)
        r = clf.classify()
        print(f"Regime: cycle={r.cycle}, sentiment={r.sentiment}")
        print(f"  YC slope={r.yield_curve_slope}, HY OAS={r.hy_oas}, VIX={r.vix_level}")
    else:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
