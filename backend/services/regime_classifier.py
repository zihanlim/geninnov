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
from datetime import date, timedelta
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
    # ADR-0139: dollar-debasement pressure. None = NOT COMPUTABLE, never zero.
    debasement_pressure: float | None = None
    debasement_real_yield_comp: float | None = None
    debasement_dxy_decline_comp: float | None = None
    debasement_gold_rise_comp: float | None = None
    debasement_comovement_comp: float | None = None
    # ADR-0140: Fed posture / pivot. None = NOT COMPUTABLE, never "neutral".
    fed_posture: str | None = None            # hawkish | neutral | dovish
    fed_pivot_delta: int | None = None        # sign(now) − sign(t−13w), dovish=+1
    fed_rate_change_13w_bps: float | None = None
    fed_curve_change_13w_bps: float | None = None
    fed_curve_steepness_bps: float | None = None
    fed_posture_evidence: dict | None = None


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


# ---------------------------------------------------------------------------
# ADR-0139 / ADR-0140: windowed history reads and shared numeric helpers
# ---------------------------------------------------------------------------

def _fetch_series_window(
    supabase: Client,
    series_id: str,
    as_of: date,
    days: int,
    buffer_days: int = 14,
    max_rows: int = 320,
) -> list[tuple[date, float]]:
    """All non-null observations for a series in [as_of − days − buffer, as_of],
    ascending.

    Same as-of discipline as `_fetch_latest_series`: the caller stamps its
    output with run_date, so nothing newer may be read. The buffer exists so
    "the value at the window start" can be the most recent observation on or
    before that date rather than demanding an exact calendar hit — FRED and
    yfinance both skip holidays.
    """
    start = as_of - timedelta(days=days + buffer_days)
    resp = (
        supabase.table("macro_daily_history")
        .select("value, trading_date")
        .eq("series_id", series_id)
        .lte("trading_date", as_of.isoformat())
        .order("trading_date", desc=True)
        .limit(max_rows)
        .execute()
    )
    rows: list[tuple[date, float]] = []
    for r in resp.data:
        if r["value"] is None:
            continue
        d = r["trading_date"]
        if isinstance(d, str):
            d = date.fromisoformat(d[:10])
        if d < start:
            continue
        rows.append((d, float(r["value"])))
    rows.sort(key=lambda t: t[0])
    return rows


def _value_at_or_before(
    history: list[tuple[date, float]], cutoff: date
) -> float | None:
    """Most recent observation dated on or before `cutoff`; None if none
    exists. `history` is ascending."""
    best = None
    for d, v in history:
        if d > cutoff:
            break
        best = v
    return best


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    """Plain Pearson r; None when either side has no variance — a correlation
    against a constant is not a measurement."""
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


# ---------------------------------------------------------------------------
# ADR-0139: dollar-debasement pressure
# ---------------------------------------------------------------------------

#: Window the four components are computed over: one option cycle, one Fed
#: meeting cadence — between L1 momentum (4w) and L3 breadth (200d MA).
#: Changing it is a code change and a re-run of the shadow period.
DEBASEMENT_LOOKBACK_WEEKS = 26

#: Floor for the co-movement correlation, in paired DAILY changes. At weekly
#: frequency (n≈26) the ADR's 0.50 normaliser is reachable by noise alone
#: (SE of r ≈ 0.2); daily changes give ~130 pairs. Below the floor the
#: component — and the composite with it — is None, not zero (ADR-0091).
DEBASEMENT_MIN_COMOVEMENT_PAIRS = 60


@dataclass
class DebasementReading:
    """ADR-0139's composite plus its provenance. None means NOT COMPUTABLE."""

    pressure: float | None          # 0–100
    real_yield_comp: float | None   # each component 0–1
    dxy_decline_comp: float | None
    gold_rise_comp: float | None
    comovement_comp: float | None
    lookback_weeks: int = DEBASEMENT_LOOKBACK_WEEKS


def classify_debasement(
    real_yield_hist: list[tuple[date, float]],
    dxy_hist: list[tuple[date, float]],
    gold_hist: list[tuple[date, float]],
    as_of: date,
    lookback_weeks: int = DEBASEMENT_LOOKBACK_WEEKS,
) -> DebasementReading:
    """Dollar-debasement pressure (ADR-0139): 30/25/25/20 over four bounded
    components. The weights are hand-coded HERE deliberately — per ADR-0013 the
    L0–L4 layer is deterministic and the constant is part of the audit trail;
    moving a weight is a code change and a re-run, not a Supabase update.

    Units, stated because feeding the wrong one saturates a component at 0 or 1
    forever while staying in bounds (ADR-0137): DFII10 arrives IN PERCENT
    (−2% is −2.0); the DXY and gold components are FRACTIONS built from price
    levels.
    """
    window_start = as_of - timedelta(weeks=lookback_weeks)

    # Real yield vs the −2% anchor: −2% or below → 1.0, 0% or above → 0.0.
    ry_now = _value_at_or_before(real_yield_hist, as_of)
    real_yield_comp = _clip01(-ry_now / 2.0) if ry_now is not None else None

    # DXY drawdown from its rolling peak — NOT change vs t−26w: a round trip
    # that ends where it started is not sustained dollar weakness.
    dxy_window = [(d, v) for d, v in dxy_hist if window_start <= d <= as_of]
    dxy_decline_comp = None
    if dxy_window:
        peak = max(v for _, v in dxy_window)
        now = dxy_window[-1][1]
        if peak > 0:
            dxy_decline_comp = _clip01(((peak - now) / peak) / 0.05)

    # Fractional gold return over the window; needs a start value at or before
    # the window opens, else None — absent is not zero.
    gold_now = _value_at_or_before(gold_hist, as_of)
    gold_then = _value_at_or_before(gold_hist, window_start)
    gold_rise_comp = None
    if gold_now is not None and gold_then is not None and gold_then > 0:
        gold_rise_comp = _clip01(((gold_now - gold_then) / gold_then) / 0.20)

    # The diagnostic: gold rising BECAUSE real yields are falling — daily
    # changes on dates where both series printed. This term does NOT remove
    # the mechanical DXY/gold overlap (accepted and disclosed in the ADR); it
    # discounts gold moves that real yields are not driving.
    comovement_comp = None
    ry_by_date = {d: v for d, v in real_yield_hist if window_start <= d <= as_of}
    gold_by_date = {d: v for d, v in gold_hist if window_start <= d <= as_of}
    shared = sorted(set(ry_by_date) & set(gold_by_date))
    d_ry = [ry_by_date[b] - ry_by_date[a] for a, b in zip(shared, shared[1:])]
    d_gold = [gold_by_date[b] - gold_by_date[a] for a, b in zip(shared, shared[1:])]
    if len(d_ry) >= DEBASEMENT_MIN_COMOVEMENT_PAIRS:
        corr = _pearson(d_ry, d_gold)
        if corr is not None:
            comovement_comp = _clip01(-corr / 0.50)

    pressure = None
    if all(
        c is not None
        for c in (real_yield_comp, dxy_decline_comp, gold_rise_comp, comovement_comp)
    ):
        raw = (
            30.0 * real_yield_comp
            + 25.0 * dxy_decline_comp
            + 25.0 * gold_rise_comp
            + 20.0 * comovement_comp
        )
        pressure = round(max(0.0, min(100.0, raw)), 2)

    def _r4(c: float | None) -> float | None:
        return round(c, 4) if c is not None else None

    return DebasementReading(
        pressure=pressure,
        real_yield_comp=_r4(real_yield_comp),
        dxy_decline_comp=_r4(dxy_decline_comp),
        gold_rise_comp=_r4(gold_rise_comp),
        comovement_comp=_r4(comovement_comp),
        lookback_weeks=lookback_weeks,
    )


# ---------------------------------------------------------------------------
# ADR-0140: Fed posture and pivot
# ---------------------------------------------------------------------------

#: One FOMC meeting cadence plus a buffer (eight meetings/year, ~6.5w apart).
POSTURE_WINDOW_WEEKS = 13
#: One FOMC step. STRICT inequality: a single 25bp move over ~2 meetings lands
#: ON the threshold and falls through to the curve test — one cut can be a
#: mid-cycle adjustment; a posture is more than one meeting's move.
POSTURE_RATE_THRESHOLD_BPS = 25.0
#: More than one meeting's worth of 2s10s repricing.
POSTURE_CURVE_THRESHOLD_BPS = 15.0

#: sign() for the pivot delta. Dovish is POSITIVE — the opposite of the
#: hawkish-is-positive many readers assume — so the pivot's sign agrees with
#: the page's directional ink (dovish = easing = --long) and +2 reads
#: hawkish → dovish, the textbook landing (ADR-0140).
POSTURE_SIGN = {"dovish": 1, "neutral": 0, "hawkish": -1}


@dataclass
class PostureReading:
    """ADR-0140's posture with its provenance. None means NOT COMPUTABLE,
    never 'neutral' (ADR-0091). The pivot delta is not here: it needs the
    t−13w row from regime_classifications, which is the caller's to read."""

    posture: str | None                 # hawkish | neutral | dovish
    rate_change_13w_bps: float | None
    curve_change_13w_bps: float | None
    curve_steepness_bps: float | None
    dff_pct: float | None               # inputs, for the evidence blob —
    dgs2_pct: float | None              # levels in PERCENT (ADR-0137)
    dgs10_pct: float | None


def classify_fed_posture(
    dff_hist: list[tuple[date, float]],
    dgs2_hist: list[tuple[date, float]],
    dgs10_hist: list[tuple[date, float]],
    as_of: date,
    window_weeks: int = POSTURE_WINDOW_WEEKS,
) -> PostureReading:
    """Fed posture (ADR-0140) from what is on disk: DFF trajectory and 2s10s
    repricing over one FOMC cycle. |ΔDFF| > 25bps decides alone; otherwise the
    curve does — steepening reads DOVISH (the market pricing cuts), flattening
    HAWKISH. Thresholds compare the ROUNDED bps values so the published number
    always justifies the published label.
    """
    then = as_of - timedelta(weeks=window_weeks)

    dff_now = _value_at_or_before(dff_hist, as_of)
    dff_then = _value_at_or_before(dff_hist, then)
    dgs2_now = _value_at_or_before(dgs2_hist, as_of)
    dgs2_then = _value_at_or_before(dgs2_hist, then)
    dgs10_now = _value_at_or_before(dgs10_hist, as_of)
    dgs10_then = _value_at_or_before(dgs10_hist, then)

    rate_change = (
        round(100.0 * (dff_now - dff_then), 2)
        if dff_now is not None and dff_then is not None
        else None
    )
    steep_now = (
        round(100.0 * (dgs10_now - dgs2_now), 2)
        if dgs10_now is not None and dgs2_now is not None
        else None
    )
    steep_then = (
        round(100.0 * (dgs10_then - dgs2_then), 2)
        if dgs10_then is not None and dgs2_then is not None
        else None
    )
    curve_change = (
        round(steep_now - steep_then, 2)
        if steep_now is not None and steep_then is not None
        else None
    )

    posture = None
    if rate_change is not None and curve_change is not None:
        if rate_change > POSTURE_RATE_THRESHOLD_BPS:
            posture = "hawkish"
        elif rate_change < -POSTURE_RATE_THRESHOLD_BPS:
            posture = "dovish"
        elif curve_change > POSTURE_CURVE_THRESHOLD_BPS:
            posture = "dovish"      # steepening: the market is pricing cuts
        elif curve_change < -POSTURE_CURVE_THRESHOLD_BPS:
            posture = "hawkish"     # flattening: hikes, or a longer hold
        else:
            posture = "neutral"

    return PostureReading(
        posture=posture,
        rate_change_13w_bps=rate_change,
        curve_change_13w_bps=curve_change,
        curve_steepness_bps=steep_now,
        dff_pct=dff_now,
        dgs2_pct=dgs2_now,
        dgs10_pct=dgs10_now,
    )


def _fetch_prior_posture(supabase: Client, run_date: date) -> str | None:
    """`fed_posture` on the most recent row dated on or before run_date − 13
    weeks (ADR-0140: the pivot is the net change over one FOMC cycle, not a
    day-over-day flip flag — against yesterday it would be non-zero only on
    the single day a label flips). None when no row that old exists, or when
    the posture columns predate migration 053 — "no prior posture" is not
    "no pivot", and the two are different absences."""
    cutoff = (run_date - timedelta(weeks=POSTURE_WINDOW_WEEKS)).isoformat()
    try:
        rows = (
            supabase.table("regime_classifications")
            .select("fed_posture, run_date")
            .lte("run_date", cutoff)
            .order("run_date", desc=True)
            .limit(1)
            .execute()
            .data
        )
    except Exception:
        # Pre-migration schema: the column does not exist yet. "No prior
        # posture" is the honest reading either way.
        return None
    if not rows:
        return None
    return rows[0].get("fed_posture")


# The universe breadth is measured ACROSS. The eleven GICS sector SPDRs cover
# the whole S&P 500 by construction and partition it without overlap, so "how
# many of these are above their own 200-day average" is a real breadth reading
# of the index rather than a restatement of the index itself.
#
# WHY NOT THE 500 CONSTITUENTS, which would be the truer measure: there is no
# constituent list in this repo, and using TODAY's membership to measure a 2025
# date imports survivorship bias into a historical series — the backfill would
# be measuring the index that exists now, backwards. Eleven ETFs have no
# membership question: they existed on every date in the range and still do.
# The cost is granularity — the reading moves in steps of 1/11 ≈ 9.1 points —
# and that is disclosed rather than smoothed.
SECTOR_ETFS = ["XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLRE", "XLU", "XLC"]

#: A reading needs most of the universe present. Below this many members with a
#: full 200-day window, the share is being computed over whichever tickers
#: happened to download, and a breadth number whose denominator moved is not
#: comparable to the day before it.
MIN_UNIVERSE = 8

_BREADTH_HISTORY_CACHE: Optional["pd.DataFrame"] = None


def _universe_history(
    tickers: Optional[list[str]] = None, period: str = "3y"
) -> Optional["pd.DataFrame"]:
    """Daily closes for the breadth universe, fetched once per process.

    Cached because the backfill asks for breadth on ~250 separate dates off the
    same series; downloading it per date would be 250 identical round trips.
    """
    global _BREADTH_HISTORY_CACHE
    if _BREADTH_HISTORY_CACHE is None:
        try:
            raw = yf.download(
                tickers or SECTOR_ETFS,
                period=period,
                interval="1d",
                progress=False,
                auto_adjust=True,
            )
            if raw is None or raw.empty:
                return None
            _BREADTH_HISTORY_CACHE = (
                raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]]
            )
        except Exception:
            return None
    return _BREADTH_HISTORY_CACHE


def _compute_spx_breadth(
    as_of: Optional[date] = None,
    hist: Optional["pd.DataFrame"] = None,
) -> Optional[float]:
    """Share of the breadth universe trading above its own 200-day average, 0–100.

    ``as_of`` truncates the price history to that date. It is not optional in
    spirit: every OTHER input to `classify()` is bounded by `run_date` (see
    `_fetch_latest_series`), and this one was not, so classifying a past date
    mixed as-of macro readings with TODAY's breadth — a look-ahead leak, on the
    input most able to flip the sentiment label.

    ``hist`` is injectable so the logic is testable against a synthetic frame
    without touching the network. Columns are tickers, rows are daily closes.

    WHAT THIS REPLACED, and why it mattered more than a label. The previous
    implementation asked one question — is SPY above its own 200d MA — and
    returned 65.0 for yes, 35.0 for no. Nothing in between, ever. Read against
    `_classify_sentiment`, whose rules are `breadth < 40 → risk-off` and
    `breadth > 60 → risk-on`, those two constants sit deliberately either side
    of both thresholds: whenever breadth resolved it fired one rule or the
    other, "neutral" became unreachable, and a four-input sentiment model was in
    practice a one-bit switch on SPY. The number was not merely mislabelled; it
    was deciding the answer while looking like a supporting detail.

    A real share can land at 45 or 55 and let the VIX, term-structure and credit
    rules do their work — which is what those rules were written for.
    """
    try:
        frame = hist if hist is not None else _universe_history()
        if frame is None or frame.empty:
            return None
        if as_of is not None:
            # yfinance indexes tz-aware; compare on calendar dates.
            frame = frame[[d.date() <= as_of for d in frame.index]]
        if len(frame) < 200:
            return None

        window = frame.tail(200)
        above = 0
        counted = 0
        for ticker in frame.columns:
            series = window[ticker].dropna()
            if len(series) < 200:
                continue  # not a full window for this member — exclude, don't guess
            last = float(series.iloc[-1])
            ma = float(series.mean())
            if ma != ma or last != last:
                continue
            counted += 1
            if last > ma:
                above += 1

        if counted < MIN_UNIVERSE:
            # Say nothing rather than divide by a denominator that moved.
            return None
        return round(100.0 * above / counted, 2)
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

        # ── ADR-0139 / ADR-0140: windowed readings, same as_of discipline ──
        ry_hist = _fetch_series_window(
            self.supabase, "DFII10", run_date, days=DEBASEMENT_LOOKBACK_WEEKS * 7)
        dxy_hist = _fetch_series_window(
            self.supabase, "DX-Y.NYB", run_date, days=DEBASEMENT_LOOKBACK_WEEKS * 7)
        gold_hist = _fetch_series_window(
            self.supabase, "GC=F", run_date, days=DEBASEMENT_LOOKBACK_WEEKS * 7)
        debasement = classify_debasement(ry_hist, dxy_hist, gold_hist, as_of=run_date)

        dff_hist = _fetch_series_window(
            self.supabase, "DFF", run_date, days=POSTURE_WINDOW_WEEKS * 7)
        dgs2_hist = _fetch_series_window(
            self.supabase, "DGS2", run_date, days=POSTURE_WINDOW_WEEKS * 7)
        dgs10_hist = _fetch_series_window(
            self.supabase, "DGS10", run_date, days=POSTURE_WINDOW_WEEKS * 7)
        posture = classify_fed_posture(dff_hist, dgs2_hist, dgs10_hist, as_of=run_date)

        prior_posture = _fetch_prior_posture(self.supabase, run_date)
        fed_pivot_delta = None
        if posture.posture is not None and prior_posture in POSTURE_SIGN:
            fed_pivot_delta = POSTURE_SIGN[posture.posture] - POSTURE_SIGN[prior_posture]

        posture_evidence = {
            "inputs": {
                "dff_pct": posture.dff_pct,
                "dgs2_pct": posture.dgs2_pct,
                "dgs10_pct": posture.dgs10_pct,
            },
            "components": {
                "rate_change_13w_bps": posture.rate_change_13w_bps,
                "curve_change_13w_bps": posture.curve_change_13w_bps,
                "curve_steepness_bps": posture.curve_steepness_bps,
            },
            "prior_posture": prior_posture,
            "thresholds": {
                "rate_threshold_bps": POSTURE_RATE_THRESHOLD_BPS,
                "curve_threshold_bps": POSTURE_CURVE_THRESHOLD_BPS,
                "window_weeks": POSTURE_WINDOW_WEEKS,
            },
        }

        output = RegimeOutput(
            cycle=cycle,
            sentiment=sentiment,
            yield_curve_slope=yield_curve_slope,
            hy_oas=hy_oas,
            vix_level=vix_spot,
            vix_term_diff=vix_term_diff,
            real_rate=real_rate,
            spx_breadth=spx_breadth,
            debasement_pressure=debasement.pressure,
            debasement_real_yield_comp=debasement.real_yield_comp,
            debasement_dxy_decline_comp=debasement.dxy_decline_comp,
            debasement_gold_rise_comp=debasement.gold_rise_comp,
            debasement_comovement_comp=debasement.comovement_comp,
            fed_posture=posture.posture,
            fed_pivot_delta=fed_pivot_delta,
            fed_rate_change_13w_bps=posture.rate_change_13w_bps,
            fed_curve_change_13w_bps=posture.curve_change_13w_bps,
            fed_curve_steepness_bps=posture.curve_steepness_bps,
            fed_posture_evidence=posture_evidence,
        )

        # Persist. The ADR-0139/0140 columns ship behind migrations 052/053;
        # if the schema predates them, keep the L3 write alive on the base row
        # and say so — degraded with a warning, never silent, never fabricated.
        base_row = {
            "run_date": run_date.isoformat(),
            "cycle": cycle,
            "sentiment": sentiment,
            "yield_curve_slope": yield_curve_slope,
            "hy_oas": hy_oas,
            "vix_level": vix_spot,
            "vix_term_diff": vix_term_diff,
            "real_rate": real_rate,
            "spx_breadth": spx_breadth,
        }
        adr_row = {
            "debasement_pressure": debasement.pressure,
            "debasement_real_yield_comp": debasement.real_yield_comp,
            "debasement_dxy_decline_comp": debasement.dxy_decline_comp,
            "debasement_gold_rise_comp": debasement.gold_rise_comp,
            "debasement_comovement_comp": debasement.comovement_comp,
            "debasement_lookback_weeks": debasement.lookback_weeks,
            "fed_posture": posture.posture,
            "fed_pivot_delta": fed_pivot_delta,
            "fed_rate_change_13w_bps": posture.rate_change_13w_bps,
            "fed_curve_change_13w_bps": posture.curve_change_13w_bps,
            "fed_curve_steepness_bps": posture.curve_steepness_bps,
            "fed_posture_evidence": posture_evidence,
        }
        try:
            self.supabase.table("regime_classifications").upsert(
                {**base_row, **adr_row}, on_conflict="run_date",
            ).execute()
        except Exception as exc:
            print(
                f"[regime] debasement/posture columns not persisted "
                f"({exc.__class__.__name__}: {exc}) — apply migrations 052/053; "
                f"writing base regime row only"
            )
            self.supabase.table("regime_classifications").upsert(
                base_row, on_conflict="run_date",
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
        print(f"  Debasement={r.debasement_pressure}, FedPosture={r.fed_posture}, "
              f"PivotDelta={r.fed_pivot_delta}")
    else:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
