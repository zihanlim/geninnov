"""
Book metrics computation — quant book construction layer.

Added after initial review to close the gap between
"LLM narrates HypeScore rankings" and "a coherent risk-controlled portfolio."

Functions:
  compute_book_metrics        — value-weighted factor tilts + net/gross exposure
  compute_correlation_matrix  — 252d Pearson correlation of pick returns, flags high-corr pairs
  fetch_pick_returns          — pull daily close prices for pick assets via yfinance
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf


# ─────────────────────────────────────────────────────────────────────────────
# Asset metadata
# ─────────────────────────────────────────────────────────────────────────────

# Sector and geography mappings for the Tier 1 universe.
# Keyed by ETF/common equity ticker.
SECTOR_MAP: dict[str, str] = {
    # Fixed income
    "TLT":   "Rates",
    "SVXY":  "Rates",
    "IEF":   "Rates",
    "SHY":   "Rates",
    "AGG":   "Rates",
    "LQD":   "Credit",
    "HYG":   "Credit",
    # Metals / inflation
    "GLD":   "Metals",
    "SLV":   "Metals",
    "TIPS":  "Inflation",
    # FX
    "DXY":   "FX",
    "UUP":   "FX",
    "FXE":   "FX",
    "EWZ":   "FX-EM",
    # China equities
    "FXI":   "China Equities",
    "MCHI":  "China Equities",
    "BABA":  "China Equities",
    "KWEB":  "China Equities",
    # Geopolitical / defensive
    "EWJ":   "Japan Equities",
    "EFA":   "Developed Equities",
    "EEM":   "EM Equities",
    # Energy
    "XLE":   "Energy",
    "OIH":   "Energy",
    "CL":    "Energy-Commodity",
    "UNG":   "Energy-NatGas",
    # US election
    "QQQ":   "Tech Growth",
    "XLV":   "Healthcare",
    "XLF":   "Financials",
    "ARKK":  "Disruptive Innovation",
    # US equities (broad market ETFs)
    "SPY":   "US Equities",
    "IWM":   "US Equities",
    "BULL":  "US Equities",
    # Metals / inflation
    "GDX":   "Gold Miners",
    "IAU":   "Gold",
}

GEO_MAP: dict[str, str] = {
    "TLT":   "US",
    "SVXY":  "US",
    "IEF":   "US",
    "SHY":   "US",
    "AGG":   "US",
    "LQD":   "US",
    "HYG":   "US",
    "GLD":   "Global",
    "SLV":   "Global",
    "TIPS":  "US",
    "DXY":   "US",
    "UUP":   "US",
    "FXE":   "Europe",
    "EWZ":   "EM",
    "FXI":   "China",
    "MCHI":  "China",
    "BABA":  "China",
    "KWEB":  "China",
    "EWJ":   "Japan",
    "EFA":   "DM ex-US",
    "EEM":   "EM",
    "XLE":   "US",
    "OIH":   "US",
    "CL":    "Global",
    "UNG":   "Global",
    "QQQ":   "US",
    "XLV":   "US",
    "XLF":   "US",
    "ARKK":  "US",
    "SPY":   "US",
    "IWM":   "US",
    "BULL":  "US",
    "GDX":   "Global",
    "IAU":   "Global",
}

# Risk caps
MAX_SINGLE_NAME_WEIGHT = 0.20      # no single position > 20% of book
MAX_SECTOR_WEIGHT = 0.30           # no single sector > 30%
MAX_GEO_WEIGHT = 0.35             # no single geography > 35%
HIGH_CORR_THRESHOLD = 0.70         # flag pairs with correlation > this
MIN_ADV_Millions = 2.0            # exclude names with ADV < $2M/day


@dataclass
class BookMetrics:
    """Value-weighted factor tilts of the full book."""
    book_beta_mkt: float          # unsigned — direction applied separately in scenario analysis
    book_beta_smb: float          # unsigned
    book_beta_hml: float          # unsigned
    book_beta_rmw: float          # unsigned
    book_beta_cma: float          # unsigned
    book_beta_umd: float          # unsigned
    gross_exposure: float          # sum of abs(weights), 0-200%
    net_exposure: float           # sum of signed weights, -100 to +100%
    long_weight: float            # sum of long notionals / total_capital
    short_weight: float           # sum of short notionals / total_capital
    sector_weights: dict[str, float]   # {sector: weight}
    geo_weights: dict[str, float]       # {geo: weight}
    sector_violations: list[str]        # sectors exceeding cap
    geo_violations: list[str]            # geos exceeding cap
    weight_violations: list[str]         # names exceeding single-name cap
    high_correlation_pairs: list[tuple[str, str, float]]  # [(asset_a, asset_b, corr)]
    computed: bool                 # True if all fields are populated


# ─────────────────────────────────────────────────────────────────────────────
# Factor tilts + net/gross exposure
# ─────────────────────────────────────────────────────────────────────────────

def compute_book_metrics(
    picks: list[dict],
    factor_exposures: dict[str, dict],
    total_capital: float = 100_000_000.0,
) -> BookMetrics:
    """
    Compute value-weighted factor tilts and exposure summary for the book.

    picks: list of pick dicts with keys: asset, direction, notional, weight
           (weight is share of total_capital, signed by direction)
    factor_exposures: {asset: {beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_umd, r_squared}}
    total_capital: used to compute actual notional from fractional weights
    """
    longs = [p for p in picks if p.get("direction") == "long"]
    shorts = [p for p in picks if p.get("direction") == "short"]

    long_w = sum(p.get("weight", 0) for p in longs)
    short_w = sum(p.get("weight", 0) for p in shorts)
    gross = long_w + short_w
    net = long_w - short_w

    # Value-weighted factor exposure
    factors = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_umd"]
    weighted_factors: dict[str, float] = {f: 0.0 for f in factors}
    total_weighted = 0.0

    for p in picks:
        asset = p.get("asset", "")
        weight = p.get("weight", 0.0)  # signed by direction
        fe = factor_exposures.get(asset, {})
        r2 = fe.get("r_squared", 0.0)

        # Only use betas with meaningful R²
        if r2 < 0.10:
            continue

        for f in factors:
            beta = abs(fe.get(f, 0.0) or 0.0)
            # Unsigned: direction is stored separately as net_exposure
            # (scenario_analysis applies direction once using net_exposure)
            weighted_factors[f] += weight * beta
            total_weighted += abs(weight)

    # Normalize by total weight (unsigned — direction applied in scenario analysis)
    book_tilts = {}
    if total_weighted > 0:
        for f in factors:
            book_tilts[f] = weighted_factors[f] / total_weighted
    else:
        for f in factors:
            book_tilts[f] = 0.0

    # Sector and geography aggregation
    sector_weights: dict[str, float] = {}
    geo_weights: dict[str, float] = {}
    sector_violations: list[str] = []
    geo_violations: list[str] = []
    weight_violations: list[str] = []

    for p in picks:
        asset = p.get("asset", "")
        w = p.get("weight", 0.0)
        if w <= 0:
            continue

        sec = SECTOR_MAP[asset]
        geo = GEO_MAP[asset]
        sector_weights[sec] = sector_weights.get(sec, 0.0) + w
        geo_weights[geo] = geo_weights.get(geo, 0.0) + w

        if w > MAX_SINGLE_NAME_WEIGHT:
            weight_violations.append(f"{asset} ({w:.1%} > {MAX_SINGLE_NAME_WEIGHT:.0%})")

    for sec, w in sector_weights.items():
        if w > MAX_SECTOR_WEIGHT:
            sector_violations.append(f"{sec} ({w:.1%} > {MAX_SECTOR_WEIGHT:.0%})")

    for geo, w in geo_weights.items():
        if w > MAX_GEO_WEIGHT:
            geo_violations.append(f"{geo} ({w:.1%} > {MAX_GEO_WEIGHT:.0%})")

    return BookMetrics(
        book_beta_mkt=book_tilts["beta_mkt"],
        book_beta_smb=book_tilts["beta_smb"],
        book_beta_hml=book_tilts["beta_hml"],
        book_beta_rmw=book_tilts["beta_rmw"],
        book_beta_cma=book_tilts["beta_cma"],
        book_beta_umd=book_tilts["beta_umd"],
        gross_exposure=gross,
        net_exposure=net,
        long_weight=long_w,
        short_weight=short_w,
        sector_weights=sector_weights,
        geo_weights=geo_weights,
        sector_violations=sector_violations,
        geo_violations=geo_violations,
        weight_violations=weight_violations,
        high_correlation_pairs=[],   # filled by compute_correlation_matrix
        computed=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Correlation matrix + high-corr pair detection
# ─────────────────────────────────────────────────────────────────────────────

def fetch_pick_returns(
    tickers: list[str],
    lookback_days: int = 252,
) -> pd.DataFrame:
    """
    Fetch daily close returns for a list of tickers via yfinance.
    Returns DataFrame with date index and ticker columns, values = daily return.
    """
    if not tickers:
        return pd.DataFrame()

    end = date.today()
    start = end - timedelta(days=lookback_days + 30)   # extra buffer for missing days

    try:
        data = yf.download(tickers, start=start, end=end, progress=False, auto_adjust=True)
        if data.empty:
            return pd.DataFrame()
        # Handle multi-level columns from yfinance
        if isinstance(data.columns, pd.MultiIndex):
            closes = data["Close"]
        else:
            closes = data[["Close"]].rename(columns={"Close": tickers[0]})
        returns = closes.pct_change().dropna(how="all")
        returns.index = pd.to_datetime(returns.index).date
        return returns
    except Exception:
        return pd.DataFrame()


def compute_correlation_matrix(
    picks: list[dict],
    lookback_days: int = 252,
    threshold: float = HIGH_CORR_THRESHOLD,
) -> list[tuple[str, str, float]]:
    """
    Compute pairwise Pearson correlation of daily returns for pick assets.
    Returns list of (asset_a, asset_b, correlation) for pairs where |corr| > threshold.
    """
    tickers = list({p["asset"] for p in picks if p.get("asset")})
    if len(tickers) < 2:
        return []

    returns = fetch_pick_returns(tickers, lookback_days)
    if returns.empty or len(returns.columns) < 2:
        return []

    # Align: only use tickers that actually have return data
    valid = [c for c in tickers if c in returns.columns]
    if len(valid) < 2:
        return []

    corr_df = returns[valid].corr()

    high_corr: list[tuple[str, str, float]] = []
    seen = set()
    for i, a in enumerate(valid):
        for b in valid[i + 1:]:
            corr_val = corr_df.loc[a, b]
            if pd.isna(corr_val):
                continue
            if abs(corr_val) >= threshold:
                pair = tuple(sorted([a, b]))
                if pair not in seen:
                    seen.add(pair)
                    high_corr.append((a, b, float(corr_val)))

    high_corr.sort(key=lambda x: abs(x[2]), reverse=True)
    return high_corr


def correlation_warning(pairs: list[tuple[str, str, float]]) -> list[str]:
    """Convert high-corr pairs into human-readable warnings."""
    if not pairs:
        return []
    warnings = []
    for a, b, corr in pairs:
        direction = "same-direction" if corr > 0 else "inverse/hedge"
        warnings.append(
            f"{a} and {b} are {direction} correlated ({corr:+.2f}) — "
            "verify this is intentional, not accidental doubling of the same bet."
        )
    return warnings


# ─────────────────────────────────────────────────────────────────────────────
# Format helpers (for LLM prompt injection)
# ─────────────────────────────────────────────────────────────────────────────

def format_book_metrics_summary(bm: BookMetrics, pairs: list[tuple[str, str, float]]) -> str:
    """Format book metrics as a compact table for the LLM prompt."""
    lines = ["=== BOOK METRICS (computed, not estimated) ==="]

    if not bm.computed:
        return "Book metrics not computed (insufficient factor data)."

    lines.append(
        f"  Gross exposure: {bm.gross_exposure:.1%} | "
        f"Net: {bm.net_exposure:+.1%} | "
        f"Long: {bm.long_weight:.1%} | Short: {bm.short_weight:.1%}"
    )

    lines.append(
        f"  Book factor tilts: Mkt={bm.book_beta_mkt:+.2f} "
        f"SMB={bm.book_beta_smb:+.2f} HML={bm.book_beta_hml:+.2f} "
        f"RMW={bm.book_beta_rmw:+.2f} CMA={bm.book_beta_cma:+.2f} UMD={bm.book_beta_umd:+.2f}"
    )

    if bm.sector_weights:
        top_sectors = sorted(bm.sector_weights.items(), key=lambda x: x[1], reverse=True)[:5]
        sec_str = " | ".join(f"{s}:{w:.0%}" for s, w in top_sectors)
        lines.append(f"  Sector weights: {sec_str}")

    if bm.geo_weights:
        top_geos = sorted(bm.geo_weights.items(), key=lambda x: x[1], reverse=True)[:5]
        geo_str = " | ".join(f"{g}:{w:.0%}" for g, w in top_geos)
        lines.append(f"  Geo weights: {geo_str}")

    violations = bm.sector_violations + bm.geo_violations + bm.weight_violations
    if violations:
        lines.append(f"  ⚠ CAP VIOLATIONS: {'; '.join(violations)}")

    if pairs:
        warnings = correlation_warning(pairs)
        lines.append(f"  ⚠ HIGH CORRELATION PAIRS:")
        for w in warnings:
            lines.append(f"    {w}")

    return "\n".join(lines)
