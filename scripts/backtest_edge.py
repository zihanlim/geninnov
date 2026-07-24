"""
Multi-component IC backtest for EdgeScore (Stage 5 — IC-weighting).

For each EdgeScore component we ask: does the component signal, computed as the
production code computes it, predict forward returns? We pool (asset, month-end)
observations and compute the rank information coefficient (Spearman) between the
signal and the forward 1-month return.

Backtestable on data-rich history here:
  - Trend  : 6m price momentum over an ETF panel (Stage 1).
  - Carry  : L0 yield/spread level -> forward return of the matching sleeve
             (credit HY OAS -> HYG; rates real yield -> TLT), via FRED history.
  - Value  : z-score of that level -> forward return of the sleeve.
RegimeFit and the contrarian Sentiment tilt need per-theme history the daily job
is only now accruing, so they are NOT IC-testable yet and stay on priors (flagged).

The result INFORMS the scoring_config weights via shrinkage toward the priors —
weak/thin IC must not overfit (ADR-0022 / ADR-0033). A weak or null result is a
finding, not a failure.

Usage:  python scripts/backtest_edge.py    (needs FRED_API_KEY for carry/value)
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

try:
    import requests
    import yfinance as yf
    from scipy.stats import spearmanr
except ImportError as exc:  # pragma: no cover
    print(f"backtest_edge needs yfinance + scipy + requests ({exc}).")
    sys.exit(1)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from backend.services.edge_signals import carry_signal, value_signal  # noqa: E402

PANEL = [
    "SPY", "QQQ", "IWM", "FXI", "EEM", "EFA",
    "TLT", "IEF", "SHY", "LQD", "HYG",
    "UUP", "GLD", "SLV", "XLE",
]
TREND_WINDOW = 126
FWD_WINDOW = 21
PERIOD = "6y"
Z_WINDOW = 252   # trailing window for the Value z-score (matches the pipeline)

# Carry/Value are macro-level signals; map each to the sleeve it should predict.
#   asset_class, FRED series, ETF whose forward return the signal should predict.
MACRO_SLEEVES = [
    ("credit", "BAMLH0A0HYM2", "HYG"),   # HY OAS -> HY credit
    ("rates", "DFII10", "TLT"),          # 10y real yield -> long duration
]


def _close_panel(tickers: list[str]) -> pd.DataFrame:
    raw = yf.download(tickers, period=PERIOD, interval="1d", auto_adjust=True, progress=False)
    close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
    return close.dropna(how="all")


def _fred_series(series_id: str, api_key: str) -> pd.Series | None:
    try:
        r = requests.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={"series_id": series_id, "api_key": api_key, "file_type": "json",
                    "observation_start": "2018-01-01"},
            timeout=30,
        )
        obs = r.json().get("observations", [])
        idx, val = [], []
        for o in obs:
            if o["value"] in (".", ""):
                continue
            idx.append(pd.Timestamp(o["date"]))
            val.append(float(o["value"]))
        s = pd.Series(val, index=idx).sort_index()
        return s if len(s) > Z_WINDOW else None
    except Exception as exc:
        print(f"  FRED fetch failed for {series_id}: {exc}")
        return None


def _ic(signals: list[float | None], forwards: list[float]) -> dict:
    """Rank IC of a signal against forward returns, dropping NOT-COMPUTABLE points.

    ``carry_signal``/``value_signal`` return None where L0 cannot support the
    component (ADR-0036). Those observations must leave the SAMPLE — scoring them
    as 0.0 would be measuring our data coverage rather than the signal, and would
    drag the IC toward zero exactly where we know least.
    """
    pairs = [(s, f) for s, f in zip(signals, forwards) if s is not None]
    signals = [s for s, _ in pairs]
    forwards = [f for _, f in pairs]
    n = len(signals)
    if n < 30:
        return {"n": n, "ic": float("nan"), "t": float("nan"), "p": float("nan"), "hit": float("nan")}
    ic, p = spearmanr(signals, forwards)
    sig, fwd = np.array(signals), np.array(forwards)
    nz = np.abs(sig) > 1e-9
    hit = float(np.mean(np.sign(sig[nz]) == np.sign(fwd[nz]))) if nz.any() else float("nan")
    t = ic * np.sqrt((n - 2) / max(1e-12, 1 - ic ** 2))
    return {"n": n, "ic": float(ic), "t": float(t), "p": float(p), "hit": hit}


def _trend_ic(close: pd.DataFrame) -> dict:
    month_ends = close.resample("ME").last().index
    sig, fwd = [], []
    for tkr in PANEL:
        if tkr not in close.columns:
            continue
        s = close[tkr].dropna()
        for dt in month_ends:
            hist = s.loc[:dt]
            if len(hist) < TREND_WINDOW + 1:
                continue
            fwd_slice = s.loc[dt:]
            if len(fwd_slice) < FWD_WINDOW + 1:
                continue
            t = hist.iloc[-1] / hist.iloc[-TREND_WINDOW] - 1.0
            f = fwd_slice.iloc[FWD_WINDOW] / fwd_slice.iloc[0] - 1.0
            if np.isfinite(t) and np.isfinite(f):
                sig.append(float(t)); fwd.append(float(f))
    return _ic(sig, fwd)


def _macro_ic(close: pd.DataFrame, api_key: str) -> tuple[dict, dict]:
    """Carry + Value IC pooled across the credit/rates sleeves.

    Carry is EXCESS YIELD OVER FUNDING (ADR-0036), so the backtest has to hand
    carry_signal the same inputs production does — the sleeve's own series PLUS the
    10y nominal yield and the overnight rate. Feeding it only the sleeve series
    returned None for every observation and the script died on the first abs().
    Testing a signal on inputs the production path never sees is worse than not
    testing it, because the number looks like evidence.
    """
    funding = _fred_series("DFF", api_key)
    ust10 = _fred_series("DGS10", api_key)
    if funding is None or ust10 is None:
        print("  skip Carry/Value: need DGS10 + DFF for excess-yield carry")
        return _ic([], []), _ic([], [])

    carry_sig, carry_fwd, value_sig, value_fwd = [], [], [], []
    for asset_class, series_id, etf in MACRO_SLEEVES:
        levels = _fred_series(series_id, api_key)
        if levels is None or etf not in close.columns:
            print(f"  skip {asset_class}/{etf}: no FRED {series_id} or no price")
            continue
        px = close[etf].dropna()
        month_ends = px.resample("ME").last().index
        for dt in month_ends:
            lvl_hist = levels.loc[:dt]
            if len(lvl_hist) < Z_WINDOW + 1:
                continue
            level = float(lvl_hist.iloc[-1])
            window = lvl_hist.iloc[-Z_WINDOW:]
            sd = float(window.std())
            z = (level - float(window.mean())) / sd if sd > 0 else 0.0
            fwd_slice = px.loc[dt:]
            if len(fwd_slice) < FWD_WINDOW + 1:
                continue
            f = float(fwd_slice.iloc[FWD_WINDOW] / fwd_slice.iloc[0] - 1.0)
            if not np.isfinite(f):
                continue
            # As-of values for the two funding inputs, never look-ahead.
            f_hist = funding.loc[:dt]
            u_hist = ust10.loc[:dt]
            if f_hist.empty or u_hist.empty:
                continue
            macro = {
                series_id: {"value": level},
                "DFF": {"value": float(f_hist.iloc[-1])},
                "DGS10": {"value": float(u_hist.iloc[-1])},
            }
            carry_sig.append(carry_signal(asset_class, macro)); carry_fwd.append(f)
            value_sig.append(value_signal(asset_class, {series_id: z})); value_fwd.append(f)
    return _ic(carry_sig, carry_fwd), _ic(value_sig, value_fwd)


def _shrink_weights(ics: dict[str, dict], priors: dict[str, float], alpha: float = 0.5) -> dict[str, float]:
    """IC-informed weights, shrunk toward priors. Measured components are nudged by
    their relative positive IC; unmeasured (nan IC) keep their prior. alpha=0 -> all
    prior; alpha=1 -> all IC. Thin/weak IC -> keep alpha modest. Sums to 1."""
    measured = {k: max(v["ic"], 0.0) for k, v in ics.items() if np.isfinite(v["ic"])}
    budget = sum(priors[k] for k in measured)         # redistribute the measured slice only
    ic_tot = sum(measured.values())
    out = dict(priors)
    if ic_tot > 0 and budget > 0:
        for k in measured:
            ic_share = measured[k] / ic_tot * budget
            out[k] = (1 - alpha) * priors[k] + alpha * ic_share
    total = sum(out.values())
    return {k: round(v / total, 4) for k, v in out.items()}


def main() -> None:
    api_key = os.environ.get("FRED_API_KEY", "")
    print(f"Downloading {len(PANEL)} tickers ({PERIOD})...")
    close = _close_panel(PANEL)

    ics = {"Trend": _trend_ic(close)}
    if api_key:
        ics["Carry"], ics["Value"] = _macro_ic(close, api_key)
    else:
        print("No FRED_API_KEY — skipping Carry/Value IC.")
        ics["Carry"] = ics["Value"] = _ic([], [])
    # Not IC-testable yet (thin per-theme history) — stay on priors, flagged.
    ics["Regime"] = ics["Sentiment"] = {"n": 0, "ic": float("nan"), "t": float("nan"),
                                        "p": float("nan"), "hit": float("nan")}

    print("\n===== EdgeScore component IC (rank IC vs forward 1m return) =====")
    print(f"{'component':<10}{'N':>7}{'IC':>9}{'t':>7}{'p':>8}{'hit':>8}")
    for k in ("Trend", "Regime", "Carry", "Value", "Sentiment"):
        v = ics[k]
        ic = "  n/a  " if not np.isfinite(v["ic"]) else f"{v['ic']:+.4f}"
        t = " n/a " if not np.isfinite(v["t"]) else f"{v['t']:+.2f}"
        p = " n/a " if not np.isfinite(v["p"]) else f"{v['p']:.3f}"
        hit = " n/a " if not np.isfinite(v["hit"]) else f"{v['hit']:.1%}"
        print(f"{k:<10}{v['n']:>7}{ic:>9}{t:>7}{p:>8}{hit:>8}")

    priors = {"Trend": 0.35, "Regime": 0.25, "Carry": 0.20, "Value": 0.20, "Sentiment": 0.05}
    weights = _shrink_weights(ics, priors, alpha=0.5)
    print("\n===== IC-informed weights (shrunk 50% toward priors) =====")
    for k in ("Trend", "Regime", "Carry", "Value", "Sentiment"):
        print(f"  edge_{k.lower()}_weight : {weights[k]:.4f}   (prior {priors[k]:.2f})")
    print("\nRegime + Sentiment keep priors (not IC-testable yet — thin history).")
    print("Copy these into scoring_config (migration) once you're satisfied with N.")

    _persist(ics)


def _persist(ics: dict[str, dict]) -> None:
    """Write the ICs to backtest_results so the site can render them.

    Until now this script only PRINTED. That is why `backtest_results` held nothing
    for EdgeScore and nothing on the site said whether the signal that actually
    decides the trades has any predictive power — the harness existed, was run once,
    and its output lived in a terminal that scrolled away. A validation nobody can
    see is not a validation.
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("[persist] No SUPABASE_URL/SERVICE_KEY — results printed only.")
        return
    try:
        from supabase import create_client
        import json
        from datetime import date

        sb = create_client(url, key)
        today = date.today().isoformat()
        for name, v in ics.items():
            ic = v["ic"]
            # No unique constraint on (metric_name, end_date), so replace rather
            # than upsert — otherwise a re-run unions with itself and the panel
            # would render two ICs for one component.
            sb.table("backtest_results").delete().eq(
                "metric_name", f"edge_ic_{name.lower()}"
            ).eq("end_date", today).execute()
            sb.table("backtest_results").insert(
                {
                    # test_name groups the run (matches the hype_ic convention);
                    # metric_name identifies the component within it.
                    "test_name": "edge_ic",
                    "metric_name": f"edge_ic_{name.lower()}",
                    "start_date": today,
                    # `pass` = did this component clear conventional significance?
                    # Recorded honestly: on 2026-07-24 none of the three testable
                    # components did, and that is the finding.
                    "pass": bool(np.isfinite(v["p"]) and v["p"] < 0.05),
                    "realized_value": None if not np.isfinite(ic) else float(ic),
                    "end_date": today,
                    # Everything a reader needs to judge the number, including the
                    # parts that make it look weak. N and p are not optional context.
                    "notes": json.dumps(
                        {
                            "component": name,
                            "n": int(v["n"]),
                            "t_stat": None if not np.isfinite(v["t"]) else round(float(v["t"]), 3),
                            "p_value": None if not np.isfinite(v["p"]) else round(float(v["p"]), 4),
                            "hit_rate": None if not np.isfinite(v["hit"]) else round(float(v["hit"]), 4),
                            "horizon_days": FWD_WINDOW,
                            "panel": len(PANEL),
                            "testable": bool(np.isfinite(ic)),
                        }
                    ),
                }
            ).execute()
        print(f"[persist] {len(ics)} EdgeScore component ICs written to backtest_results.")
    except Exception as exc:
        print(f"[persist] failed ({exc.__class__.__name__}): {exc}")


if __name__ == "__main__":
    main()
