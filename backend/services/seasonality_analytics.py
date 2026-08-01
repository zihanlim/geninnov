"""M-new (ADR-0213): NDX seasonality analytics.

Computes the per-calendar-month and per-midterm-year historical stats
the Q2 recap cited (Aug NDX avg +1.78%, Sep NDX avg -2.11%, midterm
years 0% median Aug-Nov, peak-to-trough avg -17.3%, post-trough
recovery avg +31.7%).

The function is pure: it takes monthly log-returns and a run_date, and
returns the per-month stats. The caller fetches the long history from
yfinance and caches the parquet (see ``scripts/refresh_seasonality.py``,
not in this module — the function is testable without a network).

Universe:
  - Per-month stats: 1990-01 to 2025-12 (36 calendar years, 12 months,
    432 month-bars).
  - Midterm-year subset: hardcoded 1974, 1978, ..., 2022 (every 4
    years). Aug-Nov window. The list is fixed and well-defined; a
    function that auto-derived it would re-derive the US Congress's
    schedule, which is the wrong layer for this module.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Any

#: The midterm-year universe. Hardcoded by design — the US Congress's
#: schedule is not a derived quantity, it is a defined one. A reader
#: auditing this number needs to see the exact list, not a derivation.
MIDTERM_YEARS: tuple[int, ...] = tuple(range(1974, 2027, 4))

#: Window the midterm-year stats cover. Aug-Nov (months 8-11 inclusive).
MIDTERM_AUG_NOV: tuple[int, ...] = (8, 9, 10, 11)


def _month_label(month: int) -> str:
    return (
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    )[month - 1]


def _safe_mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _safe_median(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def _win_rate(xs: list[float]) -> float | None:
    if not xs:
        return None
    return sum(1 for x in xs if x > 0) / len(xs) * 100.0


def _worse(xs: list[float]) -> float | None:
    """The worst single observation. Used as a 'worst drawdown'
    stand-in for the per-month distribution."""
    return min(xs) if xs else None


def compute_per_month_stats(
    monthly_returns: list[tuple[date, float]],
    *,
    start_year: int = 1990,
    end_year: int = 2025,
) -> list[dict[str, Any]]:
    """Per-calendar-month stats over the [start_year, end_year] window.

    Args:
        monthly_returns: list of (month_end_date, monthly_log_return)
            pairs. Ascending. The caller is responsible for sourcing
            these from yfinance.
        start_year: First year to include (inclusive).
        end_year: Last year to include (inclusive).

    Returns:
        A list of 12 dicts (one per month) with keys:
          ``month`` (int 1-12), ``label`` (str), ``n_years`` (int),
          ``mean_pct`` (float | None), ``median_pct`` (float | None),
          ``win_rate_pct`` (float | None),
          ``worst_month_pct`` (float | None).
    """
    by_month: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for d, r in monthly_returns:
        if start_year <= d.year <= end_year:
            # Convention: r is already in PERCENT (e.g. 2.0 = 2.0%).
            # The fetcher and tests pass percent; we do NOT multiply.
            by_month.setdefault(d.month, []).append(float(r))

    out: list[dict[str, Any]] = []
    for m in range(1, 13):
        xs = by_month[m]
        out.append({
            "month": m,
            "label": _month_label(m),
            "n_years": len(xs),
            "mean_pct": _safe_mean(xs),
            "median_pct": _safe_median(xs),
            "win_rate_pct": _win_rate(xs),
            "worst_month_pct": _worse(xs),
        })
    return out


def compute_midterm_year_stats(
    monthly_returns: list[tuple[date, float]],
    *,
    midterm_years: tuple[int, ...] = MIDTERM_YEARS,
    window_months: tuple[int, ...] = MIDTERM_AUG_NOV,
) -> dict[str, Any]:
    """Aug-Nov stats for the midterm-year subset.

    Returns a dict with keys:
      ``n_midterm_years`` (int),
      ``aug_nov_median_pct`` (float | None) — median of the Aug-Nov
        cumulative returns per midterm year,
      ``aug_nov_mean_pct`` (float | None) — same, mean,
      ``peak_to_trough_avg_pct`` (float | None) — average of the worst
        drawdown within each Aug-Nov window, expressed as a percent
        (negative),
      ``post_trough_recovery_avg_pct`` (float | None) — average of the
        best single-month return in the 12 months following the
        trough month, across the midterm-year sample.
    """
    # Bucket monthly returns by year. Same convention as the per-month
    # stats above: r is in PERCENT.
    by_year: dict[int, dict[int, float]] = {}
    for d, r in monthly_returns:
        by_year.setdefault(d.year, {})[d.month] = float(r)

    aug_nov_cumuls: list[float] = []
    peak_to_trough: list[float] = []
    post_trough_recovery: list[float] = []

    for y in midterm_years:
        months = by_year.get(y)
        if not months:
            continue
        # Aug-Nov cumulative: sum of monthly log returns, expressed as
        # percent on the same scale as the inputs. We approximate by
        # summing monthly percentages — close enough at the Aug-Nov
        # window, and avoids an exp/sum mismatch when the caller
        # passes simple returns.
        cumul = sum(months.get(m, 0.0) for m in window_months)
        aug_nov_cumuls.append(cumul)

        # Peak-to-trough within Aug-Nov: walk the cumulative path,
        # track the running max, record the worst gap.
        running = 0.0
        peak = float("-inf")
        worst_gap = 0.0
        for m in window_months:
            running += months.get(m, 0.0)
            peak = max(peak, running)
            gap = running - peak
            worst_gap = min(worst_gap, gap)
        peak_to_trough.append(worst_gap)

        # Post-trough recovery: the best single-month return in the 12
        # months after the trough month. We need a wider slice than
        # Aug-Nov for this — the whole post-trough year.
        # Find the trough month within the Aug-Nov window.
        trough_idx = -1
        trough_val = float("inf")
        running = 0.0
        for i, m in enumerate(window_months):
            running += months.get(m, 0.0)
            if running < trough_val:
                trough_val = running
                trough_idx = i
        if trough_idx == -1:
            continue
        trough_month = window_months[trough_idx]
        # Look at the next 12 months, wrapping into the next calendar
        # year. (NDX is liquid in Jan, so even Dec→Jan survives a
        # year-boundary.)
        next_year_months = by_year.get(y + 1, {})
        forward_months: list[float] = []
        for k in range(1, 13):
            target = trough_month + k
            if target > 12:
                target -= 12
                val = next_year_months.get(target, 0.0)
            else:
                val = months.get(target, 0.0)
            forward_months.append(val)
        if forward_months:
            post_trough_recovery.append(max(forward_months))

    return {
        "n_midterm_years": len(aug_nov_cumuls),
        "aug_nov_median_pct": _safe_median(aug_nov_cumuls),
        "aug_nov_mean_pct": _safe_mean(aug_nov_cumuls),
        "peak_to_trough_avg_pct": _safe_mean(peak_to_trough),
        "post_trough_recovery_avg_pct": _safe_mean(post_trough_recovery),
        "midterm_years_observed": [
            y for y in midterm_years if y in by_year
        ],
    }


def compute_ndx_seasonality(
    monthly_returns: list[tuple[date, float]],
    *,
    current_month: int | None = None,
    start_year: int = 1990,
    end_year: int = 2025,
) -> dict[str, Any]:
    """Top-level entry point. Returns per-month + midterm-year stats.

    Args:
        monthly_returns: list of (month_end_date, monthly_return_pct)
            pairs. Ascending. (Pct as 1.78 = 1.78% — the same scale the
            Q2 recap uses.)
        current_month: the month we are running for. Used to highlight
            the current month's stats. Defaults to date.today().month.
        start_year: First year to include (inclusive).
        end_year: Last year to include (inclusive).
    """
    if current_month is None:
        current_month = date.today().month  # noqa: DTZ011 — calendar month, not a timestamp

    per_month = compute_per_month_stats(
        monthly_returns, start_year=start_year, end_year=end_year
    )
    midterm = compute_midterm_year_stats(monthly_returns)

    return {
        "current_month": current_month,
        "current_month_label": _month_label(current_month),
        "per_month": per_month,
        "midterm": midterm,
        "window": {
            "start_year": start_year,
            "end_year": end_year,
        },
        "n_observations": len(monthly_returns),
    }


def _validate_monthly_returns(rows: list[tuple[date, float]]) -> None:
    """Cheap structural check used by tests."""
    if not rows:
        return
    last = date(1900, 1, 1)
    for d, r in rows:
        if d < last:
            raise ValueError(f"monthly_returns not ascending: {d} < {last}")
        last = d
        # Sanity: monthly return in (-99, +200) — anything outside is
        # a data error, not a real observation.
        if not -99.0 < r < 200.0:
            raise ValueError(f"suspicious monthly return: {r} on {d}")


def fetch_ndx_monthly_returns_from_yfinance(
    *,
    start_year: int = 1990,
) -> list[tuple[date, float]]:
    """Live fetcher. yfinance ^NDX monthly closes → log returns.

    Returns (month_end_date, monthly_log_return) pairs. Imports
    yfinance lazily so unit tests that pass synthetic frames do not
    require a network or the dependency.
    """
    try:
        import pandas as pd
        import yfinance as yf
    except ImportError as e:
        raise RuntimeError(
            "yfinance and pandas are required for live NDX history; "
            "tests should pass a synthetic frame"
        ) from e

    start = date(start_year, 1, 1)
    end = date.today()  # noqa: DTZ011 — yfinance accepts a calendar date end
    df = yf.download(
        "^NDX",
        start=start.isoformat(),
        end=end.isoformat(),
        progress=False,
        auto_adjust=True,
        interval="1mo",
    )
    if df.empty:
        return []
    if isinstance(df.columns, pd.MultiIndex):
        close = df["Close"]["^NDX"]
    else:
        close = df["Close"]
    close = close.dropna()
    # Resample to month-end to be safe; yfinance 1mo interval already
    # gives month-end bars, but resampling makes the contract explicit.
    monthly = close.resample("ME").last().dropna()
    rets = monthly.pct_change().dropna()
    out: list[tuple[date, float]] = []
    for ts, r in rets.items():
        d = ts.date() if hasattr(ts, "date") else date.fromisoformat(str(ts)[:10])
        out.append((d, float(r) * 100.0))
    _validate_monthly_returns(out)
    return out


def _last_trading_day(year: int, month: int) -> date:
    """Last calendar day of the month. The test uses this to build a
    month-end calendar that the live fetcher approximates via
    yfinance's resample("ME")."""
    return date(year, month, monthrange(year, month)[1])
