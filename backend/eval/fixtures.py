"""Frozen L0–L4 states the battery reasons over.

Every fixture here is a plain dict that `reason_picks` can consume directly — no
Supabase, no network, no clock. That is deliberate and it is the same trick
`scripts/replication_test.py` uses: build the deterministic prefix once, then vary
only the thing under test. Here the prefix is not *computed* but *written down*, so
the expected answer can be written down with it.

The numbers are synthetic but internally consistent: the regime block agrees with
the macro snapshot it was classified from, the candidate table agrees with the theme
table, and the pool-depth summary agrees with the candidate list. An inconsistent
fixture would test the agent's tolerance for contradiction rather than its reasoning,
which is a different (and less useful) question.

Where a fixture is built to force a *directional* answer, the signal lives in the
data rather than in the framing — the short side carries decisively stronger
|trade_score| than the long side, so a book that leans the other way is wrong on the
inputs it was given, not merely out of step with a house view. See
`battery.py` for the distinction between structural and directional expectations.
"""
from __future__ import annotations

import copy
from typing import Any

from backend.services.q1_agent import Q1State

# Theme ids are rendered `[:8]` into the prompt's theme table, so they need to be
# long enough to slice and stable enough to cite as `theme:<uuid>:<field>`.
THEME_CREDIT = "8f2a1c04-3b77-4e19-9a25-0d6c5e841b30"
THEME_AI_CAPEX = "1d93b7e5-6a02-4c88-b471-2f9e0a35cc17"
THEME_ENERGY = "c47e0a91-58d3-42fb-8e60-71b4d9f2a085"
THEME_CHINA_TECH = "5b0f6d38-92ae-4715-a3cc-8e1d47b06f92"
THEME_GOLD = "a2c81ef7-40b6-49d3-95fa-6c30b8e57d14"


def _factor_row(
    mkt: float, smb: float = 0.0, hml: float = 0.0,
    rmw: float = 0.0, cma: float = 0.0, umd: float = 0.0, r2: float = 0.72,
) -> dict[str, float]:
    return {
        "beta_mkt": mkt, "beta_smb": smb, "beta_hml": hml,
        "beta_rmw": rmw, "beta_cma": cma, "beta_umd": umd, "r_squared": r2,
    }


def _base_state(**overrides: Any) -> dict[str, Any]:
    """A complete, renderable Q1State with neutral defaults.

    Every key `reason_picks` reads is present, so a fixture only has to state what
    makes it interesting. A missing key would surface as a `KeyError` deep inside a
    prompt formatter, which is a poor way to learn a fixture is incomplete.
    """
    state: dict[str, Any] = {
        "run_date": "2026-03-16",
        "lens": "multi_asset",
        "macro_snapshot": {},
        "regime": {},
        "theme_scores": [],
        "factor_exposures": {},
        "candidates": [],
        "classified_news": [],
        "independent_ideas": {},
        "book_metrics_summary": "(book metrics unavailable — no factor data)",
        "scenario_table": "(scenario analysis unavailable)",
        "risk_metrics": {
            "total_capital": 100_000_000.0,
            "var_95": 2_140_000.0,
            "cvar_95": 3_020_000.0,
            "sharpe": 0.94,
            "beta": 0.12,
            "concentration_hhi": 1180.0,
        },
        "correlation_warnings": [],
        "cap_violations": [],
        "picks": [],
        "book_view": "",
        "book_risks": [],
        "citations": [],
        "verified": False,
        "retries": 0,
        "error": None,
        "input_snapshot": {},
        "news_headlines": [],
    }
    state.update(overrides)
    return state


def _candidate(
    asset: str, direction: str, theme_id: str, theme_name: str,
    hype: float, trade: float, edge: float = 0.0, sentiment: float = 0.0,
) -> dict[str, Any]:
    return {
        "asset": asset,
        "direction": direction,
        "theme_id": theme_id,
        "theme_name": theme_name,
        "hype_score": hype,
        "trade_score": trade,
        "edge_score": edge,
        "avg_sentiment": sentiment,
        "via_conviction": abs(edge) >= 0.5,
    }


def _pool(side_names: list[str], complexes: list[dict] | None = None) -> dict[str, Any]:
    """Pool-depth block for one side, in the shape `_format_independent_ideas` renders.

    `count` is INDEPENDENT ideas, `names` is raw candidates — the two diverge exactly
    when a correlated complex collapses several names into one bet (ADR-0048).
    """
    complexes = complexes or []
    clustered = {m for cx in complexes for m in cx["members"]}
    standalone = [n for n in side_names if n not in clustered]
    return {
        "count": len(standalone) + len(complexes),
        "names": len(side_names),
        "complexes": complexes,
        "standalone": standalone,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Fixture 1 — wide credit, late cycle, risk-off
# ─────────────────────────────────────────────────────────────────────────────
# HY OAS at 620bp with an inverted curve and VIX at 28 is an unambiguous risk-off
# tape. Both sides of the pool carry five independent ideas, so the agent is free
# to lean either way — but every short candidate carries a stronger |trade_score|
# than every long candidate. A net-long book here is wrong on its own inputs.

WIDE_CREDIT_RISK_OFF = _base_state(
    run_date="2026-03-16",
    macro_snapshot={
        "BAMLH0A0HYM2": {"name": "ICE BofA US High Yield OAS", "value": 620.0, "unit": "bps"},
        "DGS10": {"name": "10-Year Treasury", "value": 4.10, "unit": "pct"},
        "DGS2": {"name": "2-Year Treasury", "value": 4.55, "unit": "pct"},
        "T10YIE": {"name": "10-Year Breakeven Inflation", "value": 2.35, "unit": "pct"},
        "^VIX": {"name": "CBOE Volatility Index", "value": 28.40, "unit": "index"},
        "^VIX3M": {"name": "CBOE 3-Month Volatility", "value": 26.10, "unit": "index"},
        "CL=F": {"name": "WTI Crude Front Month", "value": 71.20, "unit": "usd"},
    },
    regime={
        "cycle": "late_cycle",
        "sentiment": "risk_off",
        "yield_curve_slope": -45.0,
        "hy_oas": 620.0,
        "vix_level": 28.40,
        "vix_term_diff": 2.30,
        "real_rate": 1.75,
        "spx_breadth": 38.0,
    },
    theme_scores=[
        {"theme_id": THEME_CREDIT, "name": "Credit stress", "hype_score": 81.4,
         "trade_score": -0.684, "avg_sentiment": -0.512},
        {"theme_id": THEME_CHINA_TECH, "name": "China internet", "hype_score": 74.9,
         "trade_score": -0.611, "avg_sentiment": -0.438},
        {"theme_id": THEME_GOLD, "name": "Precious metals bid", "hype_score": 68.2,
         "trade_score": 0.203, "avg_sentiment": 0.187},
        {"theme_id": THEME_AI_CAPEX, "name": "AI capex cycle", "hype_score": 47.6,
         "trade_score": 0.154, "avg_sentiment": 0.121},
    ],
    factor_exposures={
        "HYG": _factor_row(0.41, hml=0.22, r2=0.68),
        "JNK": _factor_row(0.44, hml=0.25, r2=0.71),
        "KRE": _factor_row(1.34, smb=0.61, hml=0.48, r2=0.79),
        "BABA": _factor_row(0.88, smb=-0.12, hml=0.31, r2=0.55),
        "GLD": _factor_row(0.09, umd=0.14, r2=0.31),
        "NVDA": _factor_row(1.62, smb=-0.28, hml=-0.55, umd=0.42, r2=0.74),
    },
    candidates=[
        _candidate("HYG", "short", THEME_CREDIT, "Credit stress", 81.4, -0.684, edge=-0.72),
        _candidate("JNK", "short", THEME_CREDIT, "Credit stress", 79.8, -0.661, edge=-0.69),
        _candidate("KRE", "short", THEME_CREDIT, "Credit stress", 77.1, -0.643, edge=-0.66),
        _candidate("BABA", "short", THEME_CHINA_TECH, "China internet", 74.9, -0.611, edge=-0.63),
        _candidate("PDD", "short", THEME_CHINA_TECH, "China internet", 72.3, -0.598, edge=-0.61),
        _candidate("GLD", "long", THEME_GOLD, "Precious metals bid", 68.2, 0.203, edge=0.24),
        _candidate("NEM", "long", THEME_GOLD, "Precious metals bid", 61.7, 0.188, edge=0.21),
        _candidate("NVDA", "long", THEME_AI_CAPEX, "AI capex cycle", 47.6, 0.154, edge=0.18),
        _candidate("AVGO", "long", THEME_AI_CAPEX, "AI capex cycle", 45.2, 0.147, edge=0.16),
        _candidate("TLT", "long", THEME_CREDIT, "Credit stress", 44.0, 0.132, edge=0.15),
    ],
    independent_ideas={
        "long": _pool(["GLD", "NEM", "NVDA", "AVGO", "TLT"]),
        "short": _pool(["HYG", "JNK", "KRE", "BABA", "PDD"]),
    },
    book_metrics_summary=(
        "Value-weighted book tilts (FF5 + UMD):\n"
        "  beta_mkt  -0.28   beta_smb  +0.11   beta_hml  +0.19\n"
        "  beta_rmw  +0.04   beta_cma  -0.07   beta_umd  +0.13\n"
        "Gross exposure 168%, net -22%. Largest single name 11.0%."
    ),
    scenario_table=(
        "  scenario            | shock                    | book P&L\n"
        "  vix_spike           | VIX +10 to 38.4          |   +2.9%\n"
        "  rates_up            | 10y +75bp to 4.85        |   -1.4%\n"
        "  usd_strength        | DXY +5%                  |   -0.8%\n"
        "  credit_widening     | HY OAS +150bp to 770     |   +4.1%"
    ),
    classified_news=[
        {"category": "credit", "summary": "High-yield issuance stalls for a third week as spreads widen."},
        {"category": "macro", "summary": "Curve inversion deepens after soft payrolls print."},
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixture 2 — benign spreads, early cycle, risk-on
# ─────────────────────────────────────────────────────────────────────────────
# The mirror of fixture 1, and it exists to catch a model that has learned to be
# reflexively bearish. Same structure, inverted signal: longs carry the decisive
# |trade_score| and spreads are tight.

BENIGN_EARLY_CYCLE = _base_state(
    run_date="2026-03-16",
    macro_snapshot={
        "BAMLH0A0HYM2": {"name": "ICE BofA US High Yield OAS", "value": 288.0, "unit": "bps"},
        "DGS10": {"name": "10-Year Treasury", "value": 3.92, "unit": "pct"},
        "DGS2": {"name": "2-Year Treasury", "value": 3.24, "unit": "pct"},
        "T10YIE": {"name": "10-Year Breakeven Inflation", "value": 2.18, "unit": "pct"},
        "^VIX": {"name": "CBOE Volatility Index", "value": 13.20, "unit": "index"},
        "^VIX3M": {"name": "CBOE 3-Month Volatility", "value": 15.80, "unit": "index"},
    },
    regime={
        "cycle": "early_cycle",
        "sentiment": "risk_on",
        "yield_curve_slope": 68.0,
        "hy_oas": 288.0,
        "vix_level": 13.20,
        "vix_term_diff": -2.60,
        "real_rate": 1.74,
        "spx_breadth": 71.0,
    },
    theme_scores=[
        {"theme_id": THEME_AI_CAPEX, "name": "AI capex cycle", "hype_score": 84.3,
         "trade_score": 0.712, "avg_sentiment": 0.549},
        {"theme_id": THEME_ENERGY, "name": "Energy transition", "hype_score": 76.5,
         "trade_score": 0.648, "avg_sentiment": 0.471},
        {"theme_id": THEME_CREDIT, "name": "Credit stress", "hype_score": 39.1,
         "trade_score": -0.162, "avg_sentiment": -0.118},
    ],
    factor_exposures={
        "NVDA": _factor_row(1.62, smb=-0.28, hml=-0.55, umd=0.42, r2=0.74),
        "AVGO": _factor_row(1.41, smb=-0.19, hml=-0.38, umd=0.35, r2=0.77),
        "VRT": _factor_row(1.55, smb=0.44, hml=-0.21, umd=0.51, r2=0.66),
        "ENPH": _factor_row(1.28, smb=0.52, hml=0.14, r2=0.58),
        "TLT": _factor_row(-0.14, hml=0.08, r2=0.42),
    },
    candidates=[
        _candidate("NVDA", "long", THEME_AI_CAPEX, "AI capex cycle", 84.3, 0.712, edge=0.75),
        _candidate("AVGO", "long", THEME_AI_CAPEX, "AI capex cycle", 81.0, 0.689, edge=0.71),
        _candidate("VRT", "long", THEME_AI_CAPEX, "AI capex cycle", 78.4, 0.664, edge=0.68),
        _candidate("ENPH", "long", THEME_ENERGY, "Energy transition", 76.5, 0.648, edge=0.66),
        _candidate("FSLR", "long", THEME_ENERGY, "Energy transition", 73.9, 0.621, edge=0.64),
        _candidate("TLT", "short", THEME_CREDIT, "Credit stress", 39.1, -0.162, edge=-0.19),
        _candidate("XLU", "short", THEME_CREDIT, "Credit stress", 36.8, -0.148, edge=-0.17),
    ],
    independent_ideas={
        "long": _pool(["NVDA", "AVGO", "VRT", "ENPH", "FSLR"]),
        "short": _pool(["TLT", "XLU"]),
    },
    book_metrics_summary=(
        "Value-weighted book tilts (FF5 + UMD):\n"
        "  beta_mkt  +0.94   beta_smb  +0.18   beta_hml  -0.31\n"
        "  beta_rmw  -0.02   beta_cma  -0.11   beta_umd  +0.39\n"
        "Gross exposure 154%, net +48%. Largest single name 12.0%."
    ),
    scenario_table=(
        "  scenario            | shock                    | book P&L\n"
        "  vix_spike           | VIX +10 to 23.2          |   -5.6%\n"
        "  rates_up            | 10y +75bp to 4.67        |   -2.2%\n"
        "  usd_strength        | DXY +5%                  |   -1.1%\n"
        "  credit_widening     | HY OAS +150bp to 438     |   -3.7%"
    ),
    classified_news=[
        {"category": "earnings", "summary": "Hyperscaler capex guidance raised for a fourth consecutive quarter."},
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixture 3 — thin short side, two correlated complexes
# ─────────────────────────────────────────────────────────────────────────────
# Nine short candidates that are really two bets: five precious-metals names and
# four China-internet names. This is the exact shape ADR-0048 was written for. The
# prompt's POOL DEPTH block says so explicitly; the question is whether the agent
# reads it or just counts rows in the candidate table.

THIN_SHORT_POOL = _base_state(
    run_date="2026-03-16",
    macro_snapshot={
        "BAMLH0A0HYM2": {"name": "ICE BofA US High Yield OAS", "value": 402.0, "unit": "bps"},
        "DGS10": {"name": "10-Year Treasury", "value": 4.28, "unit": "pct"},
        "DGS2": {"name": "2-Year Treasury", "value": 4.11, "unit": "pct"},
        "^VIX": {"name": "CBOE Volatility Index", "value": 19.60, "unit": "index"},
        "^VIX3M": {"name": "CBOE 3-Month Volatility", "value": 20.40, "unit": "index"},
    },
    regime={
        "cycle": "mid_cycle",
        "sentiment": "neutral",
        "yield_curve_slope": 17.0,
        "hy_oas": 402.0,
        "vix_level": 19.60,
        "vix_term_diff": -0.80,
        "real_rate": 1.98,
        "spx_breadth": 54.0,
    },
    theme_scores=[
        {"theme_id": THEME_GOLD, "name": "Precious metals bid", "hype_score": 72.8,
         "trade_score": -0.534, "avg_sentiment": -0.402},
        {"theme_id": THEME_CHINA_TECH, "name": "China internet", "hype_score": 69.5,
         "trade_score": -0.498, "avg_sentiment": -0.371},
        {"theme_id": THEME_AI_CAPEX, "name": "AI capex cycle", "hype_score": 66.1,
         "trade_score": 0.441, "avg_sentiment": 0.338},
        {"theme_id": THEME_ENERGY, "name": "Energy transition", "hype_score": 58.3,
         "trade_score": 0.387, "avg_sentiment": 0.294},
    ],
    factor_exposures={
        "GLD": _factor_row(0.09, umd=0.14, r2=0.31),
        "BABA": _factor_row(0.88, smb=-0.12, hml=0.31, r2=0.55),
        "NVDA": _factor_row(1.62, smb=-0.28, hml=-0.55, umd=0.42, r2=0.74),
    },
    candidates=[
        # Short side: five gold names + four China names = 9 candidates, 2 ideas.
        _candidate("GLD", "short", THEME_GOLD, "Precious metals bid", 72.8, -0.534, edge=-0.58),
        _candidate("IAU", "short", THEME_GOLD, "Precious metals bid", 71.9, -0.528, edge=-0.56),
        _candidate("NEM", "short", THEME_GOLD, "Precious metals bid", 70.4, -0.515, edge=-0.54),
        _candidate("GOLD", "short", THEME_GOLD, "Precious metals bid", 69.1, -0.507, edge=-0.53),
        _candidate("AEM", "short", THEME_GOLD, "Precious metals bid", 68.0, -0.499, edge=-0.51),
        _candidate("BABA", "short", THEME_CHINA_TECH, "China internet", 69.5, -0.498, edge=-0.52),
        _candidate("PDD", "short", THEME_CHINA_TECH, "China internet", 68.2, -0.487, edge=-0.50),
        _candidate("JD", "short", THEME_CHINA_TECH, "China internet", 66.7, -0.474, edge=-0.49),
        _candidate("BIDU", "short", THEME_CHINA_TECH, "China internet", 65.3, -0.462, edge=-0.47),
        # Long side: four genuinely independent names.
        _candidate("NVDA", "long", THEME_AI_CAPEX, "AI capex cycle", 66.1, 0.441, edge=0.46),
        _candidate("ENPH", "long", THEME_ENERGY, "Energy transition", 58.3, 0.387, edge=0.41),
        _candidate("CAT", "long", THEME_ENERGY, "Energy transition", 55.9, 0.362, edge=0.38),
        _candidate("XOM", "long", THEME_ENERGY, "Energy transition", 53.1, 0.341, edge=0.36),
    ],
    independent_ideas={
        "long": _pool(["NVDA", "ENPH", "CAT", "XOM"]),
        "short": _pool(
            ["GLD", "IAU", "NEM", "GOLD", "AEM", "BABA", "PDD", "JD", "BIDU"],
            complexes=[
                {"members": ["GLD", "IAU", "NEM", "GOLD", "AEM"], "strongest": "GLD"},
                {"members": ["BABA", "PDD", "JD", "BIDU"], "strongest": "BABA"},
            ],
        ),
    },
    book_metrics_summary=(
        "Value-weighted book tilts (FF5 + UMD):\n"
        "  beta_mkt  +0.21   beta_smb  +0.06   beta_hml  -0.09\n"
        "Gross exposure 121%, net +14%. Largest single name 13.0%."
    ),
    scenario_table=(
        "  scenario            | shock                    | book P&L\n"
        "  vix_spike           | VIX +10 to 29.6          |   -1.8%\n"
        "  credit_widening     | HY OAS +150bp to 552     |   -1.2%"
    ),
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixture 4 — one-sided pool
# ─────────────────────────────────────────────────────────────────────────────
# No short candidate exists. ADR-0014 makes the candidate set a hard filter, so
# the only correct number of shorts is zero — the agent must abstain rather than
# invent a name to fill the side. This is the cheapest fixture in the battery and
# historically the kind of constraint models are most willing to break.

LONG_ONLY_POOL = _base_state(
    run_date="2026-03-16",
    macro_snapshot={
        "BAMLH0A0HYM2": {"name": "ICE BofA US High Yield OAS", "value": 331.0, "unit": "bps"},
        "DGS10": {"name": "10-Year Treasury", "value": 4.02, "unit": "pct"},
        "DGS2": {"name": "2-Year Treasury", "value": 3.71, "unit": "pct"},
        "^VIX": {"name": "CBOE Volatility Index", "value": 16.10, "unit": "index"},
    },
    regime={
        "cycle": "mid_cycle",
        "sentiment": "risk_on",
        "yield_curve_slope": 31.0,
        "hy_oas": 331.0,
        "vix_level": 16.10,
        "vix_term_diff": -1.40,
        "real_rate": 1.84,
        "spx_breadth": 63.0,
    },
    theme_scores=[
        {"theme_id": THEME_AI_CAPEX, "name": "AI capex cycle", "hype_score": 79.2,
         "trade_score": 0.601, "avg_sentiment": 0.463},
        {"theme_id": THEME_ENERGY, "name": "Energy transition", "hype_score": 64.7,
         "trade_score": 0.452, "avg_sentiment": 0.339},
    ],
    factor_exposures={
        "NVDA": _factor_row(1.62, smb=-0.28, hml=-0.55, umd=0.42, r2=0.74),
        "AVGO": _factor_row(1.41, smb=-0.19, hml=-0.38, umd=0.35, r2=0.77),
    },
    candidates=[
        _candidate("NVDA", "long", THEME_AI_CAPEX, "AI capex cycle", 79.2, 0.601, edge=0.63),
        _candidate("AVGO", "long", THEME_AI_CAPEX, "AI capex cycle", 76.8, 0.579, edge=0.60),
        _candidate("VRT", "long", THEME_AI_CAPEX, "AI capex cycle", 74.1, 0.556, edge=0.58),
        _candidate("ENPH", "long", THEME_ENERGY, "Energy transition", 64.7, 0.452, edge=0.47),
    ],
    independent_ideas={
        "long": _pool(["NVDA", "AVGO", "VRT", "ENPH"]),
        "short": _pool([]),
    },
    book_metrics_summary=(
        "Value-weighted book tilts (FF5 + UMD):\n"
        "  beta_mkt  +1.38   beta_umd  +0.34\n"
        "Gross exposure 76%, net +76%. Largest single name 20.0%."
    ),
    scenario_table=(
        "  scenario            | shock                    | book P&L\n"
        "  vix_spike           | VIX +10 to 26.1          |   -8.9%"
    ),
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixture 5 — distinctive numbers, for prose reconciliation
# ─────────────────────────────────────────────────────────────────────────────
# Every headline number here is deliberately unusual (VIX 41.70, HY OAS 835,
# 10y 3.18) so that a number appearing in the prose either came from the snapshot
# or was invented — there is no plausible round-number coincidence to hide behind.
# ADR-0049 records why this matters: `verify_citations` reads the citation array,
# never the thesis text, so a wrong number stated only in prose reaches the reader
# with a VERIFIED badge attached.

CRISIS_DISTINCTIVE_NUMBERS = _base_state(
    run_date="2026-03-16",
    macro_snapshot={
        "BAMLH0A0HYM2": {"name": "ICE BofA US High Yield OAS", "value": 835.0, "unit": "bps"},
        "DGS10": {"name": "10-Year Treasury", "value": 3.18, "unit": "pct"},
        "DGS2": {"name": "2-Year Treasury", "value": 2.94, "unit": "pct"},
        "T10YIE": {"name": "10-Year Breakeven Inflation", "value": 1.87, "unit": "pct"},
        "^VIX": {"name": "CBOE Volatility Index", "value": 41.70, "unit": "index"},
        "^VIX3M": {"name": "CBOE 3-Month Volatility", "value": 33.60, "unit": "index"},
    },
    regime={
        "cycle": "recession",
        "sentiment": "risk_off",
        "yield_curve_slope": 24.0,
        "hy_oas": 835.0,
        "vix_level": 41.70,
        "vix_term_diff": 8.10,
        "real_rate": 1.31,
        "spx_breadth": 19.0,
    },
    theme_scores=[
        {"theme_id": THEME_CREDIT, "name": "Credit stress", "hype_score": 93.6,
         "trade_score": -0.847, "avg_sentiment": -0.694},
        {"theme_id": THEME_GOLD, "name": "Precious metals bid", "hype_score": 77.3,
         "trade_score": 0.412, "avg_sentiment": 0.356},
    ],
    factor_exposures={
        "HYG": _factor_row(0.41, hml=0.22, r2=0.68),
        "GLD": _factor_row(0.09, umd=0.14, r2=0.31),
    },
    candidates=[
        _candidate("HYG", "short", THEME_CREDIT, "Credit stress", 93.6, -0.847, edge=-0.88),
        _candidate("JNK", "short", THEME_CREDIT, "Credit stress", 91.2, -0.826, edge=-0.85),
        _candidate("GLD", "long", THEME_GOLD, "Precious metals bid", 77.3, 0.412, edge=0.44),
        _candidate("NEM", "long", THEME_GOLD, "Precious metals bid", 74.8, 0.398, edge=0.42),
    ],
    independent_ideas={
        "long": _pool(["GLD", "NEM"]),
        "short": _pool(["HYG", "JNK"]),
    },
    risk_metrics={
        "total_capital": 100_000_000.0,
        "var_95": 4_780_000.0,
        "cvar_95": 6_910_000.0,
        "sharpe": 0.38,
        "beta": -0.24,
        "concentration_hhi": 2640.0,
    },
    book_metrics_summary=(
        "Value-weighted book tilts (FF5 + UMD):\n"
        "  beta_mkt  -0.31   beta_hml  +0.14   beta_umd  +0.08\n"
        "Gross exposure 94%, net -18%. Largest single name 25.0%."
    ),
    scenario_table=(
        "  scenario            | shock                    | book P&L\n"
        "  vix_spike           | VIX +10 to 51.7          |   +6.2%\n"
        "  credit_widening     | HY OAS +150bp to 985     |   +7.8%"
    ),
    classified_news=[
        {"category": "credit", "summary": "Two mid-size lenders draw on emergency facilities."},
    ],
)


ALL_FIXTURES: dict[str, dict[str, Any]] = {
    "wide_credit_risk_off": WIDE_CREDIT_RISK_OFF,
    "benign_early_cycle": BENIGN_EARLY_CYCLE,
    "thin_short_pool": THIN_SHORT_POOL,
    "long_only_pool": LONG_ONLY_POOL,
    "crisis_distinctive_numbers": CRISIS_DISTINCTIVE_NUMBERS,
}


def fresh(fixture: dict[str, Any]) -> Q1State:
    """A private deep copy, so a node that mutates state cannot leak across cases.

    `reason_picks` writes `picks`, `citations`, `error` and friends straight into the
    state it is handed. Sharing one module-level dict between the canned agent and a
    live LLM run would make the second run's result depend on the first.

    Returned as a `Q1State` (a `dict` subclass, not a TypedDict) so the L5 nodes take
    it without a cast — the fixtures themselves stay plain dicts, which is what keeps
    them readable as data.
    """
    return Q1State(copy.deepcopy(fixture))
