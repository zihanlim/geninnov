"""M-new (ADR-0213): Equity-bond rolling correlation.

Computes the rolling 60d correlation between daily SPX returns and daily
DGS10 changes. Surfaces the SocGen-style "stock-bond hedge flips
negative when 10y > 4.5%" signal as a single boolean the L5 agent can
cite. Status follows ADR-0098.

The metric is the rolling Pearson r of two daily series:

    spx_return_t  = (SPX_t - SPX_{t-1}) / SPX_{t-1}
    dgs10_chg_t   = DGS10_t - DGS10_{t-1}     (in percent; 0.01 = 1bp)

A NEGATIVE correlation is the "hedge active" state. Combined with a
yield-curve stress level (DGS10 > 4.5%), this is the SocGen rule the
recap cited verbatim: when 10y yields cross 4.5%, the rolling
correlation flips negative — stocks and bonds hedge each other again.

ADR-0098: returns "unknown" with NULL values, not zeros, when the
window is too short or any input is missing.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any

#: Default rolling window. 60 trading days is the standard "current
#: regime" lookback — short enough to track a recent flip, long enough
#: to be statistically meaningful (r stabilises around n>=30 for daily
#: financial data).
DEFAULT_LOOKBACK_DAYS = 60

#: Minimum sample size for a measured correlation. 20 pairs is the floor
#: below which a Pearson r is unreliable.
MIN_PAIRS = 20

#: SocGen threshold: yields above this level + negative correlation =
#: stock-bond hedge "active".
SOCGEN_YIELD_THRESHOLD_PCT = 4.5


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    """Plain Pearson r; None when either side has no variance."""
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0.0 or syy <= 0.0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return sxy / math.sqrt(sxx * syy)


def _changes(series: list[float]) -> list[float]:
    """First differences; len(result) = len(series) - 1."""
    return [series[i] - series[i - 1] for i in range(1, len(series))]


def _returns(series: list[float]) -> list[float]:
    """Simple returns; len(result) = len(series) - 1."""
    out: list[float] = []
    for i in range(1, len(series)):
        if series[i - 1] == 0:
            continue
        out.append((series[i] - series[i - 1]) / series[i - 1])
    return out


def compute_equity_bond_corr(
    spx_levels: list[float],
    ust10_levels_pct: list[float],
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    min_pairs: int = MIN_PAIRS,
    yield_threshold_pct: float = SOCGEN_YIELD_THRESHOLD_PCT,
    as_of: date | None = None,
) -> dict[str, Any]:
    """Rolling-window equity-bond correlation and SocGen flip flag.

    Args:
        spx_levels: SPX close levels, ascending. The caller is responsible
            for slicing to the relevant window before calling; this
            function takes the tail it needs.
        ust10_levels_pct: DGS10 values, in percent, same dates as
            spx_levels. Same length as spx_levels.
        lookback_days: Window length in trading days. 60 by default.
        min_pairs: Minimum number of paired daily observations to report
            a measurement. 20 by default.
        yield_threshold_pct: DGS10 level above which the "hedge active"
            rule is checked. 4.5% by default.
        as_of: The date the computation is performed on (the run_date).
            Defaults to date.today().

    Returns:
        A dict with keys:

          - ``corr`` (float | None): the rolling Pearson r.
          - ``n_pairs`` (int): how many paired observations were used.
          - ``lookback_days`` (int): the window length that was used.
          - ``ust10_pct`` (float | None): the latest DGS10 in percent.
          - ``socgen_flip_active`` (bool | None): True when corr < 0 AND
            ust10 > yield_threshold_pct. None when status is not
            "measured".
          - ``status`` (str): ``"measured"`` /
            ``"insufficient_history"`` / ``"unknown"``.
          - ``as_of`` (date | None): the computation date.
          - ``reason`` (str | None): explanation when status is not
            "measured".
    """
    as_of = as_of or date.today()  # noqa: DTZ011 — calendar date, not a timestamp
    result: dict[str, Any] = {
        "corr": None,
        "n_pairs": 0,
        "lookback_days": lookback_days,
        "ust10_pct": None,
        "socgen_flip_active": None,
        "status": "unknown",
        "as_of": as_of,
        "reason": None,
    }

    if len(spx_levels) != len(ust10_levels_pct):
        result["reason"] = "spx and ust10 series have different lengths"
        return result
    if len(spx_levels) < 2:
        result["reason"] = "spx series too short to compute changes"
        return result

    # Echo the most recent ust10 reading for the L5 cite.
    last_ust10 = ust10_levels_pct[-1]
    if last_ust10 is None:
        result["reason"] = "latest ust10 is null"
        return result
    result["ust10_pct"] = last_ust10

    spx_ret = _returns(spx_levels)
    dgs10_chg = _changes(ust10_levels_pct)
    n = min(len(spx_ret), len(dgs10_chg))
    if n < min_pairs:
        result["reason"] = (
            f"only {n} paired observations, below min_pairs={min_pairs}"
        )
        result["status"] = "insufficient_history"
        return result

    # Tail: take the last `lookback_days` of each.
    spx_tail = spx_ret[-lookback_days:]
    dgs10_tail = dgs10_chg[-lookback_days:]
    n_used = min(len(spx_tail), len(dgs10_tail))
    if n_used < min_pairs:
        result["reason"] = (
            f"only {n_used} observations after windowing, below "
            f"min_pairs={min_pairs}"
        )
        result["status"] = "insufficient_history"
        return result

    corr = _pearson(spx_tail, dgs10_tail)
    if corr is None:
        result["reason"] = "correlation is undefined (zero variance in one leg)"
        return result

    socgen = (corr < 0.0) and (last_ust10 > yield_threshold_pct)
    result.update(
        corr=corr,
        n_pairs=n_used,
        socgen_flip_active=socgen,
        status="measured",
        reason=None,
    )
    return result
