"""
HypeScore validation harness — does HypeScore actually predict returns?

This is the validation spine the review flagged as missing. Without it,
HypeScore is a heuristic labelled as a signal. The harness measures the
Information Coefficient (IC) of HypeScore against forward asset returns over
several horizons (the IC-vs-horizon sweep IS the signal-decay curve), so the
scoring weights and the hype>=50 threshold can be judged against forward
returns instead of asserted.

Design:
  * Pure, unit-tested core: spearman_ic / cross_sectional_ic / forward_return.
    These carry the methodology and are tested with synthetic data.
  * Thin data layer: run_backtest reads theme_signals_history (historical
    HypeScores) + yfinance prices, assembles a panel, and reports IC per
    horizon. Degrades gracefully when history is thin or offline.
  * Optional persistence to the backtest_results table (already in the schema).

Interpretation (rule of thumb for a cross-sectional equity/macro signal):
  |mean IC| >= 0.03 is economically interesting; IC information ratio
  (mean/std across dates) >= 0.3 is a reasonably stable signal. A near-zero or
  negative IC means HypeScore, as weighted today, is not predictive — which is
  itself a publishable, honest result.

Run:  python -m scripts.backtest_hype --horizons 1 5 20 [--persist]
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import date, timedelta

import numpy as np

# Fallback theme → representative asset (mirrors q1_agent._theme_default_assets).
# Used only when theme_assets has no ticker for a theme.
THEME_PRIMARY_ASSET: dict[str, str] = {
    "Fed Policy": "TLT",
    "Inflation": "GLD",
    "China Growth": "FXI",
    "US Dollar": "UUP",
    "Geopolitical Risk": "GLD",
    "Corporate Credit": "HYG",
    "Energy Prices": "XLE",
    "US Election": "QQQ",
}


# ─────────────────────────────────────────────────────────────────────────────
# Pure core (unit-tested)
# ─────────────────────────────────────────────────────────────────────────────

def spearman_ic(signal_vals, fwd_vals, min_n: int = 3):
    """
    Spearman rank IC between a signal and forward returns.

    Returns a float in [-1, 1], or None when the sample is too small or has no
    variance (IC is undefined for a constant vector).
    """
    s = np.asarray(list(signal_vals), dtype=float)
    f = np.asarray(list(fwd_vals), dtype=float)
    if s.shape != f.shape or s.size < min_n:
        return None
    mask = np.isfinite(s) & np.isfinite(f)
    if mask.sum() < min_n:
        return None
    s, f = s[mask], f[mask]
    if np.all(s == s[0]) or np.all(f == f[0]):
        return None
    from scipy.stats import spearmanr
    rho, _ = spearmanr(s, f)
    if rho is None or not np.isfinite(rho):
        return None
    return float(rho)


def cross_sectional_ic(panel, min_names: int = 3) -> dict:
    """
    Standard cross-sectional IC: for each date, rank-correlate the signal
    against forward returns across names, then summarise across dates.

    panel: iterable of dicts with keys {date, asset, signal, fwd_return}.

    Returns {mean_ic, ic_std, ic_ir, hit_rate, n_dates, per_date}. The IC
    information ratio (ic_ir = mean/std across dates) is the stability measure —
    a high mean IC with an unstable sign is not tradeable.
    """
    by_date: dict[object, list[tuple[float, float]]] = defaultdict(list)
    for row in panel:
        by_date[row["date"]].append((row["signal"], row["fwd_return"]))

    per_date: dict[object, float] = {}
    for d, pairs in by_date.items():
        if len(pairs) < min_names:
            continue
        ic = spearman_ic([p[0] for p in pairs], [p[1] for p in pairs], min_n=min_names)
        if ic is not None:
            per_date[d] = ic

    ics = list(per_date.values())
    if not ics:
        return {"mean_ic": None, "ic_std": None, "ic_ir": None,
                "hit_rate": None, "n_dates": 0, "per_date": {}}

    arr = np.asarray(ics, dtype=float)
    mean_ic = float(arr.mean())
    ic_std = float(arr.std(ddof=1)) if arr.size > 1 else 0.0
    ic_ir = float(mean_ic / ic_std) if ic_std > 0 else None
    hit_rate = float((arr > 0).mean())
    return {"mean_ic": mean_ic, "ic_std": ic_std, "ic_ir": ic_ir,
            "hit_rate": hit_rate, "n_dates": len(ics), "per_date": per_date}


def pooled_ic(panel, min_n: int = 5):
    """Pooled (all date×asset pairs) Spearman IC — a coarse single number when
    per-date cross-sections are too thin (the 8-theme universe is small)."""
    rows = [(r["signal"], r["fwd_return"]) for r in panel]
    return spearman_ic([r[0] for r in rows], [r[1] for r in rows], min_n=min_n)


def forward_return(price_series, entry_date, horizon_days: int):
    """
    Forward return P[t+h]/P[t]-1 using the close at (or the first trading row at
    or after) ``entry_date`` and the close ``horizon_days`` trading rows later.

    price_series: a pandas Series indexed by date. Returns None on insufficient
    data. No look-ahead: the entry close is the signal date's close and the exit
    is strictly in the future.
    """
    import pandas as pd
    if price_series is None or len(price_series) == 0:
        return None
    s = price_series.sort_index()
    entry = pd.Timestamp(entry_date)
    pos = int(s.index.searchsorted(entry))
    fwd_pos = pos + horizon_days
    if pos >= len(s) or fwd_pos >= len(s):
        return None
    p0 = float(s.iloc[pos])
    p1 = float(s.iloc[fwd_pos])
    if not np.isfinite(p0) or not np.isfinite(p1) or p0 <= 0:
        return None
    return p1 / p0 - 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Data layer + orchestration (not unit-tested — needs live Supabase + yfinance)
# ─────────────────────────────────────────────────────────────────────────────

def _load_signal_history(sb) -> list[dict]:
    """Read (theme_id, run_date, hype_score) from theme_signals_history."""
    rows = (
        sb.table("theme_signals_history")
        .select("theme_id, run_date, hype_score")
        .order("run_date")
        .execute()
        .data
    )
    return [r for r in rows if r.get("hype_score") is not None]


def _theme_asset_map(sb, theme_ids: list[str]) -> dict[str, str]:
    """theme_id → representative ticker (first theme_assets ticker, else fallback
    by theme name)."""
    names = {
        t["id"]: t["name"]
        for t in sb.table("themes").select("id, name").execute().data
    }
    out: dict[str, str] = {}
    ta = (
        sb.table("theme_assets")
        .select("theme_id, ticker, run_date")
        .in_("theme_id", theme_ids)
        .execute()
        .data
        if theme_ids else []
    )
    latest: dict[str, tuple[str, str]] = {}
    for r in ta:
        tid, tk, rd = r["theme_id"], r["ticker"], r.get("run_date", "")
        if tid not in latest or rd > latest[tid][0]:
            latest[tid] = (rd, tk)
    for tid in theme_ids:
        if tid in latest:
            out[tid] = latest[tid][1]
        else:
            out[tid] = THEME_PRIMARY_ASSET.get(names.get(tid, ""), "SPY")
    return out


def _fetch_prices(tickers: list[str], start: date, end: date):
    """{ticker: pd.Series of adjusted closes}. yfinance; empty on failure."""
    import pandas as pd
    import yfinance as yf
    out: dict[str, "pd.Series"] = {}
    for tk in sorted(set(tickers)):
        try:
            df = yf.download(tk, start=start.isoformat(), end=end.isoformat(),
                             progress=False, auto_adjust=True)
        except Exception:
            continue
        if df is None or df.empty or "Close" not in df:
            continue
        close = df["Close"]
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]
        out[tk] = close.dropna()
    return out


def build_panel(signal_history: list[dict], asset_map: dict[str, str],
                prices: dict, horizon_days: int) -> list[dict]:
    """Assemble {date, asset, signal, fwd_return} rows for one horizon."""
    panel: list[dict] = []
    for r in signal_history:
        asset = asset_map.get(r["theme_id"])
        if not asset or asset not in prices:
            continue
        fr = forward_return(prices[asset], r["run_date"], horizon_days)
        if fr is None:
            continue
        panel.append({
            "date": r["run_date"], "asset": asset,
            "signal": float(r["hype_score"]), "fwd_return": fr,
        })
    return panel


def run_backtest(sb, horizons=(1, 5, 20), persist: bool = False) -> dict:
    """Full harness: read history → fetch prices → IC per horizon → report."""
    history = _load_signal_history(sb)
    if len(history) < 10:
        print(f"[backtest] Only {len(history)} scored rows in history - need more "
              f"daily runs before IC is meaningful. Reporting what exists.")
    theme_ids = sorted({r["theme_id"] for r in history})
    asset_map = _theme_asset_map(sb, theme_ids)

    dates = [date.fromisoformat(r["run_date"]) for r in history] or [date.today()]
    start, end = min(dates) - timedelta(days=5), max(dates) + timedelta(days=max(horizons) * 3 + 10)
    prices = _fetch_prices(list(asset_map.values()), start, end)

    report: dict = {"n_history": len(history), "n_assets": len(prices), "horizons": {}}
    for h in horizons:
        panel = build_panel(history, asset_map, prices, h)
        cs = cross_sectional_ic(panel)
        report["horizons"][h] = {
            "n_obs": len(panel),
            "cross_sectional": cs,
            "pooled_ic": pooled_ic(panel),
        }

    _print_report(report)
    if persist:
        _persist_report(sb, report, min(dates), max(dates))
    return report


def _print_report(report: dict) -> None:
    print("\n=== HypeScore IC backtest ===")
    print(f"history rows: {report['n_history']} | assets priced: {report['n_assets']}")
    print(f"{'horizon':>8} | {'n_obs':>6} | {'mean_IC':>8} | {'IC_IR':>7} | "
          f"{'hit_rate':>8} | {'pooled_IC':>9}")
    for h, res in report["horizons"].items():
        cs = res["cross_sectional"]
        mean_ic = cs["mean_ic"]
        ir = cs["ic_ir"]
        hr = cs["hit_rate"]
        pooled = res["pooled_ic"]
        print(f"{h:>7}d | {res['n_obs']:>6} | "
              f"{(f'{mean_ic:+.3f}' if mean_ic is not None else '   n/a'):>8} | "
              f"{(f'{ir:+.2f}' if ir is not None else '  n/a'):>7} | "
              f"{(f'{hr:.0%}' if hr is not None else '  n/a'):>8} | "
              f"{(f'{pooled:+.3f}' if pooled is not None else '   n/a'):>9}")
    # ASCII only: this line printed to a cp1252 stdout (Windows) raised
    # UnicodeEncodeError and aborted the whole harness — and it runs BEFORE
    # _persist_report, so a crash here means the IC never got written. That is how
    # the panel came to show stale all-null rows while the harness could in fact
    # compute a real IC.
    print("Reading: IC>0 -> higher HypeScore preceded higher forward returns. "
          "IC~0 or <0 -> not (currently) predictive.\n")


def _persist_report(sb, report: dict, start: date, end: date) -> None:
    rows = []
    for h, res in report["horizons"].items():
        cs = res["cross_sectional"]
        rows.append({
            "test_name": "hype_ic",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "metric_name": f"mean_ic_h{h}",
            "realized_value": cs["mean_ic"],
            "pass": (cs["mean_ic"] is not None and cs["mean_ic"] >= 0.03),
            "notes": json.dumps({"ic_ir": cs["ic_ir"], "hit_rate": cs["hit_rate"],
                                 "n_dates": cs["n_dates"], "n_obs": res["n_obs"],
                                 "pooled_ic": res["pooled_ic"]}),
        })
    try:
        # Idempotent: replace this end_date's rows rather than stacking a new set on
        # every re-run, so the panel reads one clean set per date.
        sb.table("backtest_results").delete().eq("test_name", "hype_ic").eq(
            "end_date", end.isoformat()
        ).execute()
        sb.table("backtest_results").insert(rows).execute()
        print(f"[backtest] Persisted {len(rows)} IC rows to backtest_results.")
    except Exception as exc:
        print(f"[backtest] WARN: could not persist ({exc.__class__.__name__}).")


def main() -> None:
    ap = argparse.ArgumentParser(description="HypeScore IC backtest")
    ap.add_argument("--horizons", type=int, nargs="+", default=[1, 5, 20])
    ap.add_argument("--persist", action="store_true", help="write results to backtest_results")
    args = ap.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY to run the backtest.")
    from supabase import create_client
    sb = create_client(url, key)
    run_backtest(sb, horizons=tuple(args.horizons), persist=args.persist)


if __name__ == "__main__":
    main()
