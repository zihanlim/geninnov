"""
IC backtest for the EdgeScore Trend component (Stage 1).

Question: does the theme-basket trend signal (6-month trailing return, the input
to edge_signals.theme_trend) predict forward returns? We pool (asset, month-end)
observations across a representative ETF panel, and compute the rank information
coefficient between the trend signal and the forward 1-month return.

This validates Stage 1 on price history (data-rich). Stage 2 (RegimeFit) and the
composite accrue significance only as the daily job runs, and are validated live.

Usage:  python scripts/backtest_edge.py
Honest by design: it prints N, IC, p-value and hit-rate — a weak or null result
is a finding, not a failure (ADR-0022 / ADR-0031).
"""
from __future__ import annotations

import sys

import numpy as np
import pandas as pd

try:
    import yfinance as yf
    from scipy.stats import spearmanr
except ImportError as exc:  # pragma: no cover
    print(f"backtest_edge needs yfinance + scipy ({exc}).")
    sys.exit(1)

# A representative multi-asset panel — the ETFs the themes map to (equity, rates,
# credit, fx, commodity), so the panel spans the asset classes EdgeScore covers.
PANEL = [
    "SPY", "QQQ", "IWM", "FXI", "EEM", "EFA",   # equity
    "TLT", "IEF", "SHY", "LQD", "HYG",          # rates + credit
    "UUP", "GLD", "SLV", "XLE",                 # fx + commodity + energy
]

TREND_WINDOW = 126     # ~6 months of trading days (matches EDGE_TREND_WINDOW_DAYS)
FWD_WINDOW = 21        # ~1 month forward return
PERIOD = "6y"


def main() -> None:
    print(f"Downloading {len(PANEL)} tickers ({PERIOD})...")
    raw = yf.download(PANEL, period=PERIOD, interval="1d",
                      auto_adjust=True, progress=False)
    close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
    close = close.dropna(how="all")

    # Month-end sampling to reduce overlap/autocorrelation in the panel.
    month_ends = close.resample("ME").last().index

    signals: list[float] = []
    forwards: list[float] = []
    for ticker in PANEL:
        if ticker not in close.columns:
            continue
        s = close[ticker].dropna()
        for dt in month_ends:
            # need TREND_WINDOW of history to here, and FWD_WINDOW ahead
            hist = s.loc[:dt]
            if len(hist) < TREND_WINDOW + 1:
                continue
            trend = hist.iloc[-1] / hist.iloc[-TREND_WINDOW] - 1.0
            fwd_slice = s.loc[dt:]
            if len(fwd_slice) < FWD_WINDOW + 1:
                continue
            fwd = fwd_slice.iloc[FWD_WINDOW] / fwd_slice.iloc[0] - 1.0
            if np.isfinite(trend) and np.isfinite(fwd):
                signals.append(float(trend))
                forwards.append(float(fwd))

    n = len(signals)
    if n < 30:
        print(f"Insufficient observations (N={n}) — inconclusive.")
        return

    ic, pval = spearmanr(signals, forwards)
    sig = np.array(signals)
    fwd = np.array(forwards)
    # Directional hit rate on non-flat signals.
    nz = np.abs(sig) > 1e-9
    hit = float(np.mean(np.sign(sig[nz]) == np.sign(fwd[nz]))) if nz.any() else float("nan")
    # t-stat of the rank IC.
    t = ic * np.sqrt((n - 2) / max(1e-12, 1 - ic**2))

    print("\n===== EdgeScore Trend — IC backtest =====")
    print(f"panel: {len([t for t in PANEL if t in close.columns])} tickers | "
          f"trend {TREND_WINDOW}d -> forward {FWD_WINDOW}d | month-end sampled")
    print(f"N observations : {n}")
    print(f"rank IC        : {ic:+.4f}")
    print(f"t-stat         : {t:+.2f}")
    print(f"p-value        : {pval:.4f}")
    print(f"hit rate       : {hit:.1%}  (sign(trend) == sign(fwd return))")
    verdict = ("POSITIVE + significant" if (ic > 0 and pval < 0.05)
               else "positive but weak/insignificant" if ic > 0
               else "non-positive — trend does not predict here")
    print(f"verdict        : {verdict}")
    print("Note: Stage-2 RegimeFit and the composite are validated live as the "
          "daily job accrues history; this validates Stage-1 Trend only.")


if __name__ == "__main__":
    main()
