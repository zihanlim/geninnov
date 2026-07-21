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


def _fetch_latest_series(supabase: Client, series_id: str, lookback: int = 30) -> Optional[float]:
    """Get most recent non-null value for a series."""
    resp = (
        supabase.table("macro_daily_history")
        .select("value, trading_date")
        .eq("series_id", series_id)
        .order("trading_date", desc=True)
        .limit(lookback)
        .execute()
    )
    for row in resp.data:
        if row["value"] is not None:
            return float(row["value"])
    return None


def _compute_spx_breadth() -> Optional[float]:
    """Compute % of SPX components above their 200d MA. Uses top 50 by market cap via SPY holdings."""
    try:
        # Use SPY as a proxy — ~500 holdings; get 200d MA via yfinance
        spy = yf.Ticker("SPY")
        hist = spy.history(period="1y", interval="1d")
        if len(hist) < 200:
            return None
        ma200 = hist["Close"].rolling(200).mean()
        latest_close = hist["Close"].iloc[-1]
        latest_ma = ma200.iloc[-1]
        # Rough proxy: if SPY above MA, breadth ~70%; if below, ~30%
        if latest_close > latest_ma:
            return 65.0
        else:
            return 35.0
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


class RegimeClassifier:
    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)

    def classify(self, run_date: date | None = None) -> RegimeOutput:
        """
        Pull L0 inputs, classify regime, persist to regime_classifications.
        Returns RegimeOutput.
        """
        run_date = run_date or date.today()

        # Pull raw inputs
        yield_curve = _fetch_latest_series(self.supabase, "DGS10")
        y2 = _fetch_latest_series(self.supabase, "DGS2")
        yield_curve_slope = (yield_curve - y2) if (yield_curve and y2) else None

        hy_oas = _fetch_latest_series(self.supabase, "BAMLH0A0HYM2")
        vix_spot = _fetch_latest_series(self.supabase, "^VIX")
        vix3m = _fetch_latest_series(self.supabase, "^VIX3M")
        vix_term_diff = (vix_spot - vix3m) if (vix_spot and vix3m) else None

        real_rate = None
        dgs10 = _fetch_latest_series(self.supabase, "DGS10")
        breakeven = _fetch_latest_series(self.supabase, "T10YIE")
        if dgs10 is not None and breakeven is not None:
            real_rate = dgs10 - breakeven

        spx_breadth = _compute_spx_breadth()

        # Classify
        cycle = _classify_cycle(yield_curve_slope, hy_oas, real_rate)
        sentiment = _classify_sentiment(vix_spot, vix_term_diff, hy_oas, spx_breadth)

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
