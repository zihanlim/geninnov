"""
Scenario analysis — quant book construction layer.

Standard macro stress scenarios run against the portfolio to answer:
"what happens to this book if [X]?" — required for any professional pitch book.

Six scenarios:
  S1: VIX spike        — VIX > 30 (systematic deleveraging)
  S2: Rate shock       — 10y Treasury +50bps (duration pain)
  S3: USD strength     — DXY +5% (EM/commodity headwind)
  S4: Credit widening  — HY OAS +150bps (risk-off credit selloff)
  S5: Melt-up          — SPX +10% (the risk-ON tail; see ADR-0074)
  S6: Supply shock     — maritime chokepoint closure (the PHYSICAL tail)

S1-S5 all transmit through the same channel: a factor beta scaled by a market
shock. That makes them differ in sign and size but not in SHAPE, and it means a
book can only be hedged against them one way. S6 transmits through SECTOR
DEPENDENCY instead — a crude-supply disruption is not a beta event, it is an
asymmetric repricing of who buys energy and who sells it. Two consequences no
other scenario reproduces:

  * duration does NOT hedge. A supply shock is inflationary, so Treasuries fall
    with equities rather than rallying against them. In S1 and S4, TLT is +4%
    and +6%; here it is negative. A book that hedges risk-off with duration is
    unhedged in exactly this state.
  * positions that are implicitly SHORT geopolitical risk — short gold, short
    defense — surface as losses. Nothing in S1-S5 reveals them, because their
    market betas are unremarkable.

Each scenario returns an estimated P&L impact on the book in % and $M,
computed from factor tilts and historical beta regressions.

Usage:
    from backend.services.scenario_analysis import run_scenario_analysis, ScenarioResult
    results = run_scenario_analysis(book_metrics, macro_snapshot, picks, factor_exposures)
"""

from __future__ import annotations

import pandas as pd
import yfinance as yf
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

# The sector taxonomy the book is already capped and reported against. S6 shocks
# THROUGH it rather than through a per-ticker list, so a scenario stays correct as
# the universe changes: a new energy name added to SECTOR_MAP is stressed by S6 the
# day it appears, with no edit here. book_metrics does not import this module, so
# there is no cycle.
from .book_metrics import SECTOR_MAP


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
    # Measured 2026-07-27: beta_mkt +2.08, R2 0.68. The prior -0.60 had the SIGN
    # backwards as well as the magnitude: SVXY is a leveraged RISK-ON proxy — vol falls
    # when the market rallies, so it rises with it. This table is only the fallback for
    # a missing FF5 row, but a fallback that contradicts the measurement is worse than
    # no fallback, because it fires exactly when nobody is checking.
    "SVXY": {"mkt": +2.08, "smb": -0.10, "hml":  0.00, "rmw": -0.05, "cma":  0.00, "umd": -0.20},
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
    # {SECTOR_MAP sector: return_shock} — the fallback applied to any pick whose
    # ticker is absent from base_asset_shocks. Ticker beats sector, so a name that
    # behaves unlike its bucket keeps an override: SVXY is filed under "Rates" but
    # is short-vol, and inherits nothing sensible from a rates shock.
    sector_shocks: dict[str, float] = field(default_factory=dict)


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
            # SVXY is a -0.5x INVERSE VIX product: long SVXY is SHORT volatility, so a
            # VIX spike is the event that destroys it, not one it benefits from. It fell
            # ~90% in Feb 2018. The prior "+0.20 # short-VIX benefit" read "we are short
            # VIX, this is a VIX scenario, so we gain" — confusing short-VOL with short
            # THE SCENARIO. Measured beta_mkt is +2.08 (R2 0.68), and this scenario's own
            # description is a -15 to -25% SPX drawdown, so the factor path implies about
            # -37%; -0.35 is that, held slightly conservative. See ADR-0114.
            "SVXY":  -0.35,    # short-vol is CRUSHED by a vol spike
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
            # Same sign error as S1, with a rationale that does not survive inspection:
            # SVXY has no credit exposure at all. Credit widening is a risk-off event,
            # vol rises, and a short-vol position loses. mkt -0.08 x beta 2.08 ~ -0.17.
            "SVXY":  -0.15,    # risk-off lifts vol; short-vol loses
        },
    ),
    Scenario(
        name="S5_melt_up",
        label="Melt-up / Squeeze (SPX +10%)",
        description="Risk-on melt-up: SPX rallies ~10%, VIX collapses, credit tightens, "
                    "and high-beta / innovation names squeeze higher. This is the stress "
                    "case for a NET-SHORT or defensively-hedged book — the other four are "
                    "risk-off shocks such a book gains from, so without this the worst "
                    "case reads a misleading ~0. Both tails, not just the crash.",
        factor_shocks={"mkt": +0.10, "umd": +0.08},   # market up, momentum leads
        base_asset_shocks={
            "ARKK":  +0.25,    # innovation/high-beta rips hardest in a squeeze
            "QQQ":   +0.12,    # tech leads
            "IWM":   +0.10,    # small-cap short squeeze
            "BABA":  +0.15,    # China risk assets rally
            "PDD":   +0.15,
            "KWEB":  +0.15,
            "FXI":   +0.12,
            "SVXY":  +0.18,    # short-VIX rips as VIX collapses
            "XLE":   +0.06,    # cyclicals participate
            "GDX":   -0.07,    # gold/miners sold as the hedge bid unwinds
            "GLD":   -0.05,
            "TLT":   -0.06,    # duration sold in risk-on
            "HYG":   +0.04,    # credit tightens
        },
    ),
    Scenario(
        name="S6_supply_shock",
        label="Supply Shock (chokepoint closure)",
        description="A maritime chokepoint closes and crude supply is disrupted. Energy "
                    "producers and defense re-rate up; energy-importing economies, long-duration "
                    "equity and autos re-rate down. Unlike the other risk-off shocks this one is "
                    "INFLATIONARY, so Treasuries fall alongside equities instead of hedging them. "
                    "Transmission is by sector dependency, not by market beta.",
        # Deliberately sparse. The market-beta channel is what the other five already
        # measure; routing S6 through it too would collapse it into a smaller S1. The
        # small negative keeps broad equity from being unshocked, and the sector map
        # below carries the actual asymmetry.
        factor_shocks={"mkt": -0.04},
        base_asset_shocks={
            # Ticker overrides where a name does not behave like its sector bucket.
            "SVXY":  -0.18,    # filed under "Rates" but is short-vol; VIX spikes here
            "TLT":   -0.07,    # 20y duration against an inflationary shock
            "IEF":   -0.03,    # intermediate duration, same sign, less of it
            "SHY":   -0.005,   # ~2y duration — nearly immune, and must not read as immune-by-omission
            "CL":    +0.25,    # the disrupted commodity itself, not a producer of it
            "UNG":   +0.20,    # gas bid as the crude substitute
            "TIPS":  +0.03,    # breakevens widen faster than real yields rise
            "UUP":   +0.04,    # dollar catches the haven bid
        },
        sector_shocks={
            # Supply side — gains from the disruption
            "Energy":               +0.18,
            "Energy-Commodity":     +0.25,
            "Energy-NatGas":        +0.20,
            "Defense":              +0.10,   # escalation premium
            "Gold Miners":          +0.12,   # miners lever the metal
            "Gold":                 +0.08,
            "Inflation":            +0.03,
            "FX":                   +0.04,
            "FX-EM":                +0.02,   # commodity exporters partly insulated
            # Demand side — pays for it, scaled by energy-import dependence
            "China Equities":       -0.12,   # largest crude importer; most chokepoint-exposed
            "Japan Equities":       -0.11,   # near-total energy import dependence
            "EM Equities":          -0.10,
            "Developed Equities":   -0.09,   # Europe carries the import exposure
            "Tech Growth":          -0.09,   # long duration meets input costs
            "Disruptive Innovation":-0.14,   # highest duration, least pricing power
            "Autos":                -0.13,   # input costs plus supply chain, no pass-through
            "US Equities":          -0.07,   # energy self-sufficient: least exposed equity bloc
            "Financials":           -0.05,
            "Credit":               -0.05,
            "Metals":               -0.04,   # industrial demand fear outweighs supply tightness
            "Rates":                -0.02,   # inflationary: duration does not hedge
            "Healthcare":           -0.02,   # defensive
        },
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# P&L estimation engine
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_shock(scenario: Scenario, asset: str) -> tuple[Optional[float], str]:
    """The direct shock for one asset, and where it came from.

    Ticker beats sector: ``base_asset_shocks`` is the override list for names that do
    not behave like their bucket. Returns ``(None, "")`` when the scenario calibrates
    neither, which is what the factor path is for.

    Both the P&L loop and the ``covered_frac`` gate call this. They used to be able to
    disagree about what "covered" meant, and a gate that counts an asset the P&L loop
    skips silently picks the wrong estimator.
    """
    if asset in scenario.base_asset_shocks:
        return scenario.base_asset_shocks[asset], ""
    sector = SECTOR_MAP.get(asset)
    if sector is not None and sector in scenario.sector_shocks:
        return scenario.sector_shocks[sector], f" via {sector}"
    return None, ""


def _fmt_shock(shock: float) -> str:
    """Percent with enough precision that the row's own arithmetic checks out.

    The breakdown rows are self-checking by design — a reader multiplies the two
    printed numbers and must get the printed result. At ``:+.0%`` a sub-1% shock
    prints as "+0%", so SHY's -0.5% would read as an unshocked position that
    nonetheless multiplies to a non-zero P&L.
    """
    return f"{shock:+.1%}" if abs(shock) < 0.01 else f"{shock:+.0%}"


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
    factor_exposures: dict[str, dict] | None = None,
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

    # Factor-based PnL: Σ signed_weight_i × THIS ASSET'S beta × shock.
    #
    # It used to substitute book_metrics' BOOK-LEVEL tilt for every pick's beta,
    # and take abs() of it. Both are wrong, and together they made the stress test
    # useless: pushing the book tilt inside the per-pick loop computes
    #     beta_book × Σ(±wᵢ) × shock  =  beta_book × NET exposure × shock
    # when the exposure that matters is GROSS. On 2026-07-24 the book ran 48.7%
    # gross against 0.6% net, so every scenario collapsed by ~80x: the worst case,
    # a VIX spike the row itself describes as "historically associated with -15 to
    # -25% SPX drawdown", came out at -0.02% — twenty-one thousand dollars on a
    # $100M book. A stress test that says the book cannot lose money is worse than
    # no stress test, because it is reassuring.
    #
    # The docstring above always specified per-asset betas; only the code disagreed.
    # factor_exposures is the same table /risk already renders per-position betas
    # from, and its market betas reconcile against known benchmarks (SPY 0.99 at
    # R^2 1.00) — so there is no reason to proxy them.
    fe = factor_exposures or {}

    # Accumulate the signed, gross-weighted book beta per factor alongside the P&L, so
    # the factor branch can print a breakdown that SUMS to factor_pnl. Without this the
    # displayed breakdown (direct-shock lines below) described a different number for
    # every factor-driven scenario — see the branch at `best_estimate = factor_pnl`.
    factor_pnl = 0.0
    factor_book_beta: dict[str, float] = {}
    for p in picks:
        w = p.get("weight", 0.0)
        if w <= 0:
            continue
        sign = 1.0 if p.get("direction") == "long" else -1.0
        betas = fe.get(p.get("asset", ""), {})
        for factor, shock in scenario.factor_shocks.items():
            beta = betas.get(f"beta_{factor}")
            if beta is None:
                continue
            factor_pnl += sign * w * float(beta) * shock
            factor_book_beta[factor] = factor_book_beta.get(factor, 0.0) + sign * w * float(beta)

    # Fallback: if book_metrics has near-zero factor weights (no live FF5 data),
    # use DEFAULT_TICKER_BETAS for known tickers. Direction applied per-pick.
    if abs(factor_pnl) < 1e-6:
        factor_pnl = 0.0
        factor_book_beta = {}
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
                factor_book_beta[factor] = factor_book_beta.get(factor, 0.0) + sign * w * beta

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

        shock, origin = _resolve_shock(scenario, asset)
        if shock is not None:
            pnl = sign * w * shock
            direct_pnl += pnl
            # Show the SIGNED weight so the line's own arithmetic checks out. A short
            # gains when its name falls, so with the unsigned weight the row read
            # "+9.0% × -20% = +1.80%" — a product that does not equal its result, the
            # first thing a reviewer poking a stress row would catch. -9.0% × -20% does.
            #
            # `origin` names the sector when the shock was inherited rather than set on
            # the ticker, so a reader can trace the number to the row of the transmission
            # map it came from instead of wondering why NUE moved.
            contributions.append(
                f"  {asset} ({p.get('direction', '?')}){origin}: "
                f"{sign * w:+.1%} × {_fmt_shock(shock)} = {pnl:+.2%}"
            )

    # Blend: use direct PnL only when it has actual non-zero contributions;
    # otherwise fall back to factor-based (which uses signed factor_weights from
    # book_metrics — already encodes direction so short positions are correct).
    # covered_weight fraction tells us how much of the book has direct shocks.
    covered_weight = sum(
        abs(p.get("weight", 0.0))
        for p in picks
        if _resolve_shock(scenario, p.get("asset", ""))[0] is not None
    )
    gross = max(book_metrics.gross_exposure, 0.01)
    covered_frac = covered_weight / gross if gross > 0 else 0.0

    if direct_pnl != 0.0 and covered_frac >= 0.6:
        best_estimate = direct_pnl
    else:
        best_estimate = factor_pnl
        # The direct-shock lines built above sum to direct_pnl, NOT factor_pnl — so on a
        # factor-driven scenario the breakdown a reviewer totals would miss the book
        # return (VIX Spike showed legs summing to +1.8% under a +3.4% header). Rebuild it
        # from the factor decomposition, which sums to factor_pnl exactly: each line is
        # shock × the book's signed gross-weighted beta to that factor.
        # Compute each line's result from the DISPLAYED (2dp) beta, so the row's own
        # numbers multiply to its own result — the same self-consistency the direct rows
        # keep. The per-line rounding leaves the sum within ~0.01pp of the header, exactly
        # as the direct breakdown already does (melt-up sums to -1.98% under a -1.99% head).
        contributions = []
        for factor, shock in scenario.factor_shocks.items():
            if factor not in factor_book_beta:
                continue
            bb = round(factor_book_beta[factor], 2)
            contributions.append(
                f"  {factor.upper()} shock {shock:+.0%} × book β {bb:+.2f} = {shock * bb:+.2%}"
            )

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


def scenarios_for_run(chokepoint_signal=None) -> list[Scenario]:
    """The scenario battery for one run, with S6 scaled by measured disruption if there is any.

    Returns a NEW list and a NEW S6 rather than mutating `SCENARIOS`: the module constant is
    the reviewed ADR-0088 calibration and has to stay readable as such — a run that rescaled
    it in place would leave the next reader unable to tell what was signed off.

    The description is rewritten either way. A stress number scaled by a live reading and one
    run on a fixed calibration are different claims, and /risk renders that description
    verbatim, so the distinction has to travel with the scenario rather than live in a log
    (design goal 1).
    """
    if chokepoint_signal is None:
        return list(SCENARIOS)

    from .chokepoint_signal import scale_sector_shocks

    out: list[Scenario] = []
    for s in SCENARIOS:
        if s.name != "S6_supply_shock":
            out.append(s)
            continue
        measured = getattr(chokepoint_signal, "measured", False)
        mult = getattr(chokepoint_signal, "multiplier", 1.0)
        out.append(
            Scenario(
                name=s.name,
                label=s.label,
                description=f"{s.description} {chokepoint_signal.reason}",
                factor_shocks=dict(s.factor_shocks),
                base_asset_shocks=(
                    scale_sector_shocks(s.base_asset_shocks, mult) if measured
                    else dict(s.base_asset_shocks)
                ),
                sector_shocks=(
                    scale_sector_shocks(s.sector_shocks, mult) if measured
                    else dict(s.sector_shocks)
                ),
            )
        )
    return out


def run_scenario_analysis(
    picks: list[dict],
    book_metrics,       # BookMetrics
    total_capital: float = 100_000_000.0,
    factor_exposures: dict[str, dict] | None = None,
    chokepoint_signal=None,
) -> list[ScenarioResult]:
    """
    Run the stress battery against the portfolio.
    Returns list of ScenarioResult ordered by severity (most severe first).

    `chokepoint_signal` (a `chokepoint_signal.ChokepointSignal`, optional) scales S6 by
    measured maritime disruption. Omitted or unmeasured, S6 runs on its documented ADR-0088
    calibration — which is what every caller did before ADR-0095 and remains the default.
    """
    results: list[ScenarioResult] = []
    for scenario in scenarios_for_run(chokepoint_signal):
        result = estimate_scenario_pnl(
            scenario, picks, book_metrics, total_capital, factor_exposures
        )
        results.append(result)

    # Sort by absolute impact (most severe first)
    results.sort(key=lambda r: abs(r.estimated_book_return), reverse=True)
    return results


def run_scenario_analysis_with_scenarios(
    picks: list[dict],
    book_metrics,
    total_capital: float = 100_000_000.0,
    factor_exposures: dict[str, dict] | None = None,
    chokepoint_signal=None,
) -> tuple[list[ScenarioResult], list[Scenario]]:
    """`run_scenario_analysis`, plus the scenario objects it actually used.

    Exists so a caller can hand the same list to `scenario_results_to_dict` and persist a
    description that matches the shocks the P&L was computed from. Without it, a scaled run
    silently persists the unscaled story.
    """
    scenarios = scenarios_for_run(chokepoint_signal)
    results: list[ScenarioResult] = [
        estimate_scenario_pnl(s, picks, book_metrics, total_capital, factor_exposures)
        for s in scenarios
    ]
    results.sort(key=lambda r: abs(r.estimated_book_return), reverse=True)
    return results, scenarios


def scenario_results_to_dict(
    results: list[ScenarioResult],
    scenarios: list[Scenario] | None = None,
) -> list[dict]:
    """Structured scenario results for persistence and rendering.

    ``format_scenario_table`` renders these as a string for the LLM prompt; that
    string is a dead end for the UI. This is the machine-readable twin persisted
    to ``research_recommendations.scenario_results`` and rendered on /risk.

    ``description`` is carried through from the Scenario definition so the UI can
    explain what each shock assumes without duplicating the calibration.
    """
    # Keyed off the scenarios THIS RUN used, not the module constant.
    #
    # A run whose S6 was scaled by measured disruption (ADR-0095) carries a different
    # description and different shocks from the constant. Resolving against SCENARIOS would
    # persist the scaled P&L beside the UNSCALED description and shock map — the figure and
    # its stated cause disagreeing, on the row /risk renders verbatim, which is precisely
    # the defect design goal 1 exists to prevent. Defaults to the constant so every existing
    # caller is unaffected.
    by_name = {s.name: s for s in (scenarios if scenarios is not None else SCENARIOS)}
    out: list[dict] = []
    for r in results:
        scenario = by_name.get(r.scenario_name)
        out.append({
            "scenario_name": r.scenario_name,
            "label": r.label,
            "description": scenario.description if scenario else "",
            "factor_shocks": dict(scenario.factor_shocks) if scenario else {},
            # Emitted so /risk can show what S6 actually did. The UI builds its shock
            # chips from these two maps; a sector-transmitted scenario that shipped only
            # factor_shocks would render a near-empty chip row under a material P&L —
            # a number on the page with its cause left off (design goal 1).
            "sector_shocks": dict(scenario.sector_shocks) if scenario else {},
            "estimated_book_return": r.estimated_book_return,
            "estimated_dollar_pnl": r.estimated_dollar_pnl,
            "severity": r.severity,
            # First entry is the summary line; the rest are per-position rows.
            "contribution_breakdown": list(r.contribution_breakdown[1:]),
        })
    return out


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
