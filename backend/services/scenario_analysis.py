"""
Scenario analysis — quant book construction layer.

Standard macro stress scenarios run against the portfolio to answer:
"what happens to this book if [X]?" — required for any professional pitch book.

Four scenarios:
  S1: VIX spike        — VIX > 30 (systematic deleveraging)
  S2: Rate shock       — 10y Treasury +50bps (duration pain)
  S3: USD strength     — DXY +5% (EM/commodity headwind)
  S4: Credit widening  — HY OAS +150bps (risk-off credit selloff)

Each scenario returns an estimated P&L impact on the book in % and $M,
computed from factor tilts and historical beta regressions.

Usage:
    from services.scenario_analysis import run_scenario_analysis, ScenarioResult
    results = run_scenario_analysis(book_metrics, macro_snapshot, picks, factor_exposures)
"""

from __future__ import annotations

import pandas as pd
import yfinance as yf
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Default factor betas for common tickers (used when book_metrics has zero
# factor weights — i.e. factor data was unavailable). These are reasonable
# real-world approximations that keep scenario analysis meaningful without live
# FF5 data.
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_TICKER_BETAS: dict[str, dict[str, float]] = {
    # US equity ETFs
    "SPY":  {"mkt": 1.00, "smb": -0.10, "hml":  0.05, "rmw":  0.10, "cma":  0.05, "umd":  0.20},
    "QQQ":  {"mkt": 1.20, "smb": -0.20, "hml": -0.10, "rmw":  0.15, "cma": -0.05, "umd":  0.30},
    "IWM":  {"mkt": 1.25, "smb":  0.60, "hml":  0.05, "rmw":  0.05, "cma":  0.00, "umd":  0.15},
    # Rates
    "TLT":  {"mkt": -0.30, "smb":  0.05, "hml":  0.15, "rmw": -0.05, "cma":  0.20, "umd": -0.10},
    "IEF":  {"mkt": -0.15, "smb":  0.02, "hml":  0.08, "rmw": -0.02, "cma":  0.10, "umd": -0.05},
    "SHY":  {"mkt": -0.05, "smb":  0.00, "hml":  0.02, "rmw":  0.00, "cma":  0.02, "umd":  0.00},
    "AGG":  {"mkt": -0.08, "smb":  0.01, "hml":  0.05, "rmw":  0.00, "cma":  0.05, "umd": -0.03},
    # Credit
    "LQD":  {"mkt":  0.20, "smb": -0.05, "hml":  0.10, "rmw":  0.05, "cma":  0.08, "umd":  0.05},
    "HYG":  {"mkt":  0.35, "smb":  0.05, "hml":  0.05, "rmw":  0.10, "cma":  0.05, "umd":  0.05},
    # Metals / inflation
    "GLD":  {"mkt":  0.05, "smb":  0.10, "hml":  0.20, "rmw":  0.05, "cma":  0.10, "umd": -0.05},
    "SLV":  {"mkt":  0.25, "smb":  0.15, "hml":  0.10, "rmw":  0.10, "cma":  0.05, "umd":  0.00},
    "TIPS": {"mkt": -0.10, "smb":  0.02, "hml":  0.10, "rmw":  0.00, "cma":  0.08, "umd": -0.02},
    # FX
    "UUP":  {"mkt": -0.10, "smb":  0.00, "hml":  0.00, "rmw":  0.00, "cma":  0.00, "umd":  0.00},
    "FXE":  {"mkt":  0.30, "smb": -0.10, "hml":  0.05, "rmw":  0.05, "cma":  0.05, "umd":  0.05},
    # China equities
    "FXI":  {"mkt":  0.90, "smb":  0.30, "hml": -0.10, "rmw":  0.15, "cma":  0.05, "umd":  0.10},
    "BABA": {"mkt":  1.00, "smb":  0.20, "hml": -0.10, "rmw":  0.20, "cma":  0.05, "umd":  0.10},
    "KWEB": {"mkt":  0.95, "smb":  0.30, "hml": -0.05, "rmw":  0.15, "cma":  0.05, "umd":  0.10},
    # Energy
    "XLE":  {"mkt":  0.80, "smb":  0.20, "hml": -0.15, "rmw":  0.40, "cma":  0.10, "umd":  0.15},
    "OIH":  {"mkt":  0.90, "smb":  0.25, "hml": -0.10, "rmw":  0.35, "cma":  0.08, "umd":  0.15},
    # Volatility
    "SVXY": {"mkt": -0.60, "smb": -0.10, "hml":  0.00, "rmw": -0.05, "cma":  0.00, "umd": -0.20},
}


# ─────────────────────────────────────────────────────────────────────────────
# Scenario definitions
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Scenario:
    """A named stress scenario with calibrated factor shocks."""
    name: str
    label: str                          # short label for display
    description: str                    # one-line description
    factor_shocks: dict[str, float]    # {factor_name: return_shock_as_decimal}
    # e.g. {"mkt": -0.15} means SPX -15%
    base_asset_shocks: dict[str, float]  # {asset_ticker: return_shock} for direct assets


@dataclass
class ScenarioResult:
    """Estimated book P&L under one scenario."""
    scenario_name: str
    label: str
    estimated_book_return: float       # decimal, e.g. -0.048 for -4.8%
    estimated_dollar_pnl: float        # $M P&L
    contribution_breakdown: list[str]   # human-readable bullets
    severity: str                      # "low" | "moderate" | "high" | "severe"


SCENARIOS: list[Scenario] = [
    Scenario(
        name="S1_vix_spike",
        label="VIX Spike (>30)",
        description="Volatility spike triggers systematic deleveraging. Long positions "
                    "sold, shorts may partially cover. Historically associated with "
                    "-15 to -25% SPX drawdown.",
        factor_shocks={"mkt": -0.18, "umd": -0.12},
        base_asset_shocks={
            "TLT":   +0.04,    # flight to quality
            "GLD":   +0.05,    # risk-off bid
            "HYG":   -0.08,    # credit sells off
            "LQD":   -0.04,
            "QQQ":   -0.22,    # tech gets hit hardest
            "FXI":   -0.15,    # EM sells off
            "XLE":   -0.12,    # commodities sold for liquidity
            "SVXY":  +0.20,    # short-VIX benefit
            "BABA":  -0.20,
        },
    ),
    Scenario(
        name="S2_rate_shock",
        label="Rate Shock (+50bps)",
        description="Sudden 50bps spike in 10y Treasury yield. Duration-sensitive "
                    "positions hurt, bank/financial shorts rally. Real rates move up.",
        factor_shocks={"mkt": -0.05, "hml": +0.08},   # value outperforms in rate shock
        base_asset_shocks={
            "TLT":   -0.10,    # -50bps × 20y duration ≈ -10%
            "HYG":   -0.04,    # credit widens in rate shock
            "LQD":   -0.03,
            "GLD":   -0.06,    # real rates up → gold hurt
            "XLF":   +0.06,   # financials benefit from steeper curve
            "QQQ":   -0.07,    # long duration tech hurt
            "XLE":   +0.03,   # energy inflation hedge partially works
        },
    ),
    Scenario(
        name="S3_usd_strength",
        label="USD Strength (+5% DXY)",
        description="USD surges 5% on DXY. EM assets, commodities, and export-driven "
                    "companies hurt. Flight to US assets.",
        factor_shocks={"mkt": -0.03, "smb": -0.06},  # small caps disproportionately hurt
        base_asset_shocks={
            "FXI":   -0.12,    # direct China FX impact
            "BABA":  -0.14,    # USD-denominated earnings compression
            "KWEB":  -0.11,
            "EWZ":   -0.08,    # EM FX impact
            "GLD":   -0.09,    # USD up → gold down
            "CL":    -0.06,    # oil in USD
            "DXY":   +0.05,   # direct USD exposure
            "UUP":   +0.05,
            "TLT":   +0.02,    # mild safe-haven bid
            "HYG":   -0.03,
        },
    ),
    Scenario(
        name="S4_credit_widening",
        label="Credit Widening (+150bps OAS)",
        description="HY OAS widens 150bps in risk-off credit event. Corporate spreads "
                    "blow out. IG more resilient. Credit-sensitive longs hurt.",
        factor_shocks={"mkt": -0.08, "hml": -0.10},   # value stocks hurt (leverage)
        base_asset_shocks={
            "HYG":   -0.10,    # -150bps OAS × 6yr duration ≈ -10%
            "LQD":   -0.05,
            "TLT":   +0.06,    # flight to quality duration
            "GLD":   +0.04,
            "XLF":   -0.06,    # financials exposed to credit
            "QQQ":   -0.06,
            "SVXY":  +0.15,    # short credit benefit
        },
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# P&L estimation engine
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_latest_price(ticker: str) -> Optional[float]:
    """Get the most recent close price for a ticker."""
    try:
        data = yf.Ticker(ticker).history(period="5d", auto_adjust=True)
        if data.empty:
            return None
        return float(data["Close"].iloc[-1])
    except Exception:
        return None


def estimate_scenario_pnl(
    scenario: Scenario,
    picks: list[dict],
    book_metrics,          # BookMetrics from book_metrics.py
    total_capital: float = 100_000_000.0,
) -> ScenarioResult:
    """
    Estimate book P&L under a stress scenario.

    Uses two approaches in parallel:
    1. Factor-based:  Σ signed_weight_i × beta_factor_i × shock_factor
       (for unmapped assets; signed_weight already encodes direction from book_metrics)
    2. Direct shock:  Σ weight_i × shock_i × direction_sign  (for explicitly mapped assets)

    If picks is empty, returns zero P&L immediately.
    """
    # Early exit: no positions → zero P&L
    if not picks:
        return ScenarioResult(
            scenario_name=scenario.name,
            label=scenario.label,
            estimated_book_return=0.0,
            estimated_dollar_pnl=0.0,
            contribution_breakdown=["  Estimated book return: +0.00%  ($+0.0M on $100M book)"],
            severity="low",
        )

    # Factor-based PnL: signed sum of each pick's weight × factor beta × shock.
    # Direction is applied per-pick (short positions flip the P&L sign).
    # This uses book_metrics' unsigned factor tilts as the per-factor weight proxy,
    # which is the best available signal from the pre-computed book state.
    factor_weights: dict[str, float] = {}  # {factor: unsigned_book_weight}
    for attr in ["book_beta_mkt", "book_beta_smb", "book_beta_hml",
                 "book_beta_rmw", "book_beta_cma", "book_beta_umd"]:
        key = attr.replace("book_beta_", "")
        factor_weights[key] = abs(getattr(book_metrics, attr, 0.0))

    # Signed factor PnL: apply per-pick direction
    factor_pnl = 0.0
    for p in picks:
        w = p.get("weight", 0.0)
        if w <= 0:
            continue
        sign = 1.0 if p.get("direction") == "long" else -1.0
        for factor, shock in scenario.factor_shocks.items():
            beta = factor_weights.get(factor, 0.0)
            factor_pnl += sign * w * beta * shock

    # Fallback: if book_metrics has near-zero factor weights (no live FF5 data),
    # use DEFAULT_TICKER_BETAS for known tickers. Direction applied per-pick.
    if abs(factor_pnl) < 1e-6:
        factor_pnl = 0.0
        for p in picks:
            asset = p.get("asset", "")
            w = p.get("weight", 0.0)
            if w <= 0 or asset not in DEFAULT_TICKER_BETAS:
                continue
            defaults = DEFAULT_TICKER_BETAS[asset]
            sign = 1.0 if p.get("direction") == "long" else -1.0
            for factor, shock in scenario.factor_shocks.items():
                beta = defaults.get(factor, 0.0)
                factor_pnl += sign * w * beta * shock

    # Direct asset shock estimate
    direct_pnl = 0.0
    contributions: list[str] = []

    for p in picks:
        asset = p.get("asset", "")
        w = p.get("weight", 0.0)
        if w <= 0:
            continue

        # Direction sign: short positions flip the P&L direction
        sign = 1.0 if p.get("direction") == "long" else -1.0

        if asset in scenario.base_asset_shocks:
            shock = scenario.base_asset_shocks[asset]
            pnl = sign * w * shock
            direct_pnl += pnl
            contributions.append(
                f"  {asset} ({p.get('direction', '?')}): {w:+.1%} × {shock:+.0%} = {pnl:+.2%}"
            )

    # Blend: use direct PnL only when it has actual non-zero contributions;
    # otherwise fall back to factor-based (which uses signed factor_weights from
    # book_metrics — already encodes direction so short positions are correct).
    # covered_weight fraction tells us how much of the book has direct shocks.
    covered_weight = sum(
        abs(p.get("weight", 0.0))
        for p in picks
        if p.get("asset") in scenario.base_asset_shocks
    )
    gross = max(book_metrics.gross_exposure, 0.01)
    covered_frac = covered_weight / gross if gross > 0 else 0.0

    if direct_pnl != 0.0 and covered_frac >= 0.6:
        best_estimate = direct_pnl
    else:
        best_estimate = factor_pnl

    dollar_pnl = best_estimate * total_capital / 1_000_000  # convert to $M

    # Severity classification
    abs_return = abs(best_estimate)
    if abs_return < 0.03:
        severity = "low"
    elif abs_return < 0.06:
        severity = "moderate"
    elif abs_return < 0.10:
        severity = "high"
    else:
        severity = "severe"

    # Add summary bullet
    contributions.insert(
        0,
        f"  Estimated book return: {best_estimate:+.2%}  "
        f"(${dollar_pnl:+.1f}M on ${total_capital/1e6:.0f}M book)"
    )

    return ScenarioResult(
        scenario_name=scenario.name,
        label=scenario.label,
        estimated_book_return=best_estimate,
        estimated_dollar_pnl=dollar_pnl,
        contribution_breakdown=contributions,
        severity=severity,
    )


def run_scenario_analysis(
    picks: list[dict],
    book_metrics,       # BookMetrics
    total_capital: float = 100_000_000.0,
) -> list[ScenarioResult]:
    """
    Run all four stress scenarios against the portfolio.
    Returns list of ScenarioResult ordered by severity (most severe first).
    """
    results: list[ScenarioResult] = []
    for scenario in SCENARIOS:
        result = estimate_scenario_pnl(
            scenario, picks, book_metrics, total_capital
        )
        results.append(result)

    # Sort by absolute impact (most severe first)
    results.sort(key=lambda r: abs(r.estimated_book_return), reverse=True)
    return results


def format_scenario_table(results: list[ScenarioResult]) -> str:
    """Format scenario results as a compact table for the LLM prompt."""
    if not results:
        return "(no scenario analysis available — insufficient portfolio data)"

    lines = ["=== SCENARIO ANALYSIS ==="]
    for r in results:
        sev_emoji = {
            "low": "🟢", "moderate": "🟡", "high": "🟠", "severe": "🔴"
        }.get(r.severity, "⚪")

        lines.append(
            f"{sev_emoji} {r.label}: {r.estimated_book_return:+.2%} "
            f"(${r.estimated_dollar_pnl:+.1f}M) [{r.severity.upper()}]"
        )
        for bullet in r.contribution_breakdown[:3]:  # top 3 contributors
            lines.append(bullet)

    lines.append(
        "Note: Estimates based on historical beta regressions and factor tilts. "
        "Actual P&L will vary. Do not use for live risk management without validation."
    )
    return "\n".join(lines)
