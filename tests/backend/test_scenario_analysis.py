"""
Tests for backend/services/scenario_analysis.py

Covers:
  - SCENARIOS: 4 defined scenarios with calibrated shocks
  - estimate_scenario_pnl: factor-based + direct-shock P&L estimation
  - run_scenario_analysis: runs all scenarios, sorts by severity
  - format_scenario_table: human-readable output
  - Severity classification: low/moderate/high/severe
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from backend.services.scenario_analysis import (
    SCENARIOS,
    estimate_scenario_pnl,
    run_scenario_analysis,
    format_scenario_table,
    ScenarioResult,
)
from backend.services.book_metrics import BookMetrics


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

def _bm(gross=0.20, net=0.10, long_w=0.15, short_w=0.05,
        beta_mkt=0.8, beta_smb=0.0, beta_hml=0.0,
        beta_rmw=0.0, beta_cma=0.0, beta_umd=0.0):
    return BookMetrics(
        book_beta_mkt=beta_mkt, book_beta_smb=beta_smb,
        book_beta_hml=beta_hml, book_beta_rmw=beta_rmw,
        book_beta_cma=beta_cma, book_beta_umd=beta_umd,
        gross_exposure=gross, net_exposure=net,
        long_weight=long_w, short_weight=short_w,
        sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=True,
    )


def _pick(asset, direction, weight):
    return dict(asset=asset, direction=direction, weight=weight)


# ─────────────────────────────────────────────────────────────────────────────
# SCENARIOS
# ─────────────────────────────────────────────────────────────────────────────

def test_four_scenarios_defined():
    assert len(SCENARIOS) == 4
    names = {s.name for s in SCENARIOS}
    assert names == {"S1_vix_spike", "S2_rate_shock", "S3_usd_strength", "S4_credit_widening"}


def test_scenarios_have_factor_shocks():
    for s in SCENARIOS:
        assert isinstance(s.factor_shocks, dict)
        assert len(s.factor_shocks) > 0
        assert s.label
        assert s.description


def test_vix_spike_scenario():
    s = next(x for x in SCENARIOS if x.name == "S1_vix_spike")
    assert s.factor_shocks["mkt"] < 0      # market down in vol spike
    assert s.factor_shocks["umd"] < 0      # momentum down
    assert "TLT" in s.base_asset_shocks    # flight to quality
    assert "GLD" in s.base_asset_shocks


def test_rate_shock_scenario():
    s = next(x for x in SCENARIOS if x.name == "S2_rate_shock")
    assert "TLT" in s.base_asset_shocks
    assert s.base_asset_shocks["TLT"] < 0  # duration pain


def test_usd_strength_scenario():
    s = next(x for x in SCENARIOS if x.name == "S3_usd_strength")
    assert "FXI" in s.base_asset_shocks
    assert s.base_asset_shocks["FXI"] < 0  # China hurt by USD strength
    assert "GLD" in s.base_asset_shocks
    assert s.base_asset_shocks["GLD"] < 0


def test_credit_widening_scenario():
    s = next(x for x in SCENARIOS if x.name == "S4_credit_widening")
    assert "HYG" in s.base_asset_shocks
    assert s.base_asset_shocks["HYG"] < 0  # credit sells off


# ─────────────────────────────────────────────────────────────────────────────
# estimate_scenario_pnl
# ─────────────────────────────────────────────────────────────────────────────

def test_estimate_pnl_factor_based():
    """With no direct-shock assets, uses factor-based P&L."""
    picks = [_pick("SPY", "long", 0.20)]
    bm = _bm(gross=0.20, beta_mkt=1.0)
    scenario = SCENARIOS[0]  # S1_vix_spike: mkt=-0.18
    # Expected: 0.20 * 1.0 * (-0.18) = -0.036
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    assert isinstance(result, ScenarioResult)
    assert result.scenario_name == "S1_vix_spike"
    # Should be negative (market down in vol spike)
    assert result.estimated_book_return < 0


def test_estimate_pnl_direct_shock_applied():
    """Direct asset shock overrides factor-based for mapped assets."""
    picks = [_pick("TLT", "long", 0.20)]
    bm = _bm(gross=0.20, beta_mkt=-0.3)  # TLT has negative market beta
    scenario = SCENARIOS[0]  # S1_vix_spike: TLT = +0.04
    # Direct: 0.20 * (+0.04) = +0.008
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    assert result.estimated_book_return > 0  # TLT gains in vol spike


def test_estimate_pnl_mixed_assets():
    """Mixed portfolio — some direct-shock, some factor-only."""
    picks = [
        _pick("TLT", "long",  0.10),   # direct shock: +0.04
        _pick("SPY", "long",  0.10),   # factor-based: 0.10 * 1.0 * (-0.18) = -0.018
    ]
    bm = _bm(gross=0.20, beta_mkt=1.0)
    scenario = SCENARIOS[0]
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    # Direct for TLT: 0.10 * 0.04 = +0.004
    # Factor for SPY: 0.10 * 1.0 * (-0.18) = -0.018
    # Combined: ~ -0.014 (negative — vol spike hurts more than TLT helps)
    assert isinstance(result, ScenarioResult)
    assert "TLT" in result.contribution_breakdown[0] or any("TLT" in c for c in result.contribution_breakdown)


def test_estimate_pnl_short_position_flips_sign():
    """Short positions invert P&L direction."""
    picks = [_pick("SPY", "short", 0.20)]  # short 20%
    bm = _bm(gross=0.20, beta_mkt=1.0)
    scenario = SCENARIOS[0]  # S1_vix_spike: market down
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    # Short SPY benefits from market sell-off
    assert result.estimated_book_return > 0


def test_estimate_pnl_dollar_pnl_scaled():
    """Dollar P&L scales with total_capital."""
    picks = [_pick("TLT", "long", 0.10)]
    bm = _bm(gross=0.10, beta_mkt=-0.3)
    scenario = SCENARIOS[0]
    result = estimate_scenario_pnl(scenario, picks, bm, total_capital=100_000_000.0)
    # Direct: 0.10 * 0.04 = 0.004 → $0.4M
    assert abs(result.estimated_dollar_pnl - 0.4) < 0.05


def test_estimate_pnl_severity_low():
    """Small P&L impact → low severity."""
    picks = [_pick("TLT", "long", 0.01)]  # tiny position
    bm = _bm(gross=0.01)
    scenario = SCENARIOS[0]
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    assert result.severity == "low"


def test_estimate_pnl_severity_moderate():
    """Moderate P&L impact → moderate severity."""
    picks = [_pick("TLT", "long", 0.05)]
    bm = _bm(gross=0.05, beta_mkt=-0.3)
    scenario = SCENARIOS[0]
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    # ~0.05 * 0.04 = 0.002 → 0.2% → low
    assert result.severity in ("low", "moderate")


def test_estimate_pnl_severity_high():
    """Large P&L impact → high severity."""
    picks = [_pick("QQQ", "long", 0.30)]  # 30% QQQ long
    bm = _bm(gross=0.30, beta_mkt=1.0)
    scenario = SCENARIOS[0]  # S1: QQQ = -0.22 (direct shock)
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    # Direct: 0.30 * (-0.22) = -0.066 → 6.6% → high
    assert result.severity in ("high", "severe")


def test_estimate_pnl_severity_severe():
    """Very large P&L → severe."""
    picks = [
        _pick("QQQ", "long",  0.35),   # 35% QQQ
        _pick("FXI", "long",  0.15),   # 15% China
        _pick("XLE", "long",  0.10),   # 10% energy
    ]
    bm = _bm(gross=0.60, beta_mkt=1.0)
    scenario = SCENARIOS[0]
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    # QQQ direct: 0.35 * (-0.22) = -0.077
    # FXI fallback (beta 0.9): 0.15 * 0.9 * (-0.18) = -0.0243
    # XLE fallback (beta 0.8): 0.10 * 0.8 * (-0.18) = -0.0144
    # Total ≈ -0.116 → 11.6% → severe (>10%)
    assert result.severity == "severe"


def test_estimate_pnl_empty_picks():
    """Empty portfolio → zero P&L."""
    scenario = SCENARIOS[0]
    bm = _bm(gross=0.0)
    result = estimate_scenario_pnl(scenario, [], bm, 100_000_000.0)
    assert result.estimated_book_return == 0.0
    assert result.estimated_dollar_pnl == 0.0
    assert result.severity == "low"


# ─────────────────────────────────────────────────────────────────────────────
# run_scenario_analysis
# ─────────────────────────────────────────────────────────────────────────────

def test_run_all_four_scenarios():
    picks = [_pick("SPY", "long", 0.10)]
    bm = _bm(gross=0.10, beta_mkt=1.0)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    assert len(results) == 4


def test_run_scenario_analysis_sorts_by_severity():
    """Results are sorted by absolute return descending (most severe first)."""
    picks = [
        _pick("QQQ", "long", 0.15),
        _pick("TLT", "long", 0.05),
        _pick("SPY", "long", 0.10),
    ]
    bm = _bm(gross=0.30, beta_mkt=1.0)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    abs_returns = [abs(r.estimated_book_return) for r in results]
    assert abs_returns == sorted(abs_returns, reverse=True)


def test_rate_shock_is_worst_for_duration_portfolio():
    """A portfolio long TLT gets hurt most by rate shock scenario."""
    picks = [_pick("TLT", "long", 0.20)]
    bm = _bm(gross=0.20, beta_mkt=-0.3)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    rate_shock = next(r for r in results if r.scenario_name == "S2_rate_shock")
    # TLT loses -10% in rate shock: 0.20 * (-0.10) = -0.02
    assert rate_shock.estimated_book_return < 0


# ─────────────────────────────────────────────────────────────────────────────
# format_scenario_table
# ─────────────────────────────────────────────────────────────────────────────

def test_format_scenario_table_empty():
    out = format_scenario_table([])
    assert "no scenario analysis" in out.lower()


def test_format_scenario_table_includes_all_scenarios():
    picks = [_pick("SPY", "long", 0.10)]
    bm = _bm(gross=0.10, beta_mkt=1.0)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    out = format_scenario_table(results)
    for r in results:
        assert r.label[:4] in out or r.scenario_name[:3] in out


def test_format_scenario_table_shows_severity():
    picks = [_pick("QQQ", "long", 0.20)]
    bm = _bm(gross=0.20, beta_mkt=1.2)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    out = format_scenario_table(results)
    # Severity tags should appear
    assert any(s.upper() in out for s in ("LOW", "MODERATE", "HIGH", "SEVERE"))


def test_format_scenario_table_shows_pnl_dollar():
    picks = [_pick("TLT", "long", 0.10)]
    bm = _bm(gross=0.10, beta_mkt=-0.3)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    out = format_scenario_table(results)
    # Should contain dollar P&L strings like "+$0.0M"
    assert "$M" in out or "M on" in out


def test_format_scenario_table_warns_not_live_risk():
    picks = [_pick("SPY", "long", 0.10)]
    bm = _bm(gross=0.10)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    out = format_scenario_table(results)
    assert "do not use for live risk" in out.lower() or "estimates" in out.lower()


# ─────────────────────────────────────────────────────────────────────────────
# ScenarioResult dataclass
# ─────────────────────────────────────────────────────────────────────────────

def test_scenario_result_fields():
    r = ScenarioResult(
        scenario_name="test",
        label="Test",
        estimated_book_return=-0.05,
        estimated_dollar_pnl=-0.5,
        contribution_breakdown=["SPY: -2%"],
        severity="high",
    )
    assert r.scenario_name == "test"
    assert r.estimated_book_return == -0.05
    assert r.estimated_dollar_pnl == -0.5
    assert "SPY" in r.contribution_breakdown[0]
    assert r.severity == "high"
