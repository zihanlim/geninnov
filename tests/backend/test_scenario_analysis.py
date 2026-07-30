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

def test_six_scenarios_defined_covering_both_tails():
    # ADR-0192 added S7_fallen_angel: 6 became 7, name unchanged (both tails is still
    # about S1-S6; S7 is a third TRANSMISSION channel, not a third tail).
    assert len(SCENARIOS) == 7
    names = {s.name for s in SCENARIOS}
    assert names == {
        "S1_vix_spike", "S2_rate_shock", "S3_usd_strength",
        "S4_credit_widening", "S5_melt_up", "S6_supply_shock",
        "S7_fallen_angel",
    }
    # Both tails: at least one risk-off (mkt down) and one risk-on (mkt up) shock, so a
    # net-short book cannot escape stress the way it did when all four were risk-off.
    mkts = [s.factor_shocks.get("mkt", 0.0) for s in SCENARIOS]
    assert any(m < 0 for m in mkts) and any(m > 0 for m in mkts)


def test_melt_up_is_the_stress_case_for_a_short_book():
    """The four risk-off scenarios are tailwinds for a short book; the melt-up is its
    downside. A short in a high-beta name must LOSE when the market rips higher."""
    melt = next(s for s in SCENARIOS if s.name == "S5_melt_up")
    assert melt.factor_shocks["mkt"] > 0
    result = estimate_scenario_pnl(melt, [_pick("ARKK", "short", 0.20)], _bm(gross=0.20), 100_000_000.0)
    assert result.estimated_book_return < 0  # short squeezed


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


# ─── the import path the nightly pipeline actually uses ──────────────────────

def test_module_imports_without_backend_on_sys_path():
    """This file inserts `backend/` on sys.path at line 15, which MASKS a bad sibling
    import. ADR-0088 shipped `from services.book_metrics import SECTOR_MAP`, which only
    resolves with that insert — so all 46 tests here passed while the real chain
    `daily_refresh -> backend.services.q1_agent -> .scenario_analysis` raised
    ModuleNotFoundError. The nightly run would have produced no book.

    A subprocess with only the REPO ROOT on the path is the shape production uses
    (`daily_refresh.py` does `sys.path.insert(0, Path(__file__).parent.parent)`), so this
    pins the entry point rather than the function — the same lesson ADR-0065's follow-up
    recorded for check_data_integrity.
    """
    import subprocess
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    proc = subprocess.run(
        [sys.executable, "-c",
         "from backend.services.q1_agent import run_q1_agent;"
         "from backend.services.scenario_analysis import SCENARIOS;"
         "print('OK', len(SCENARIOS))"],
        cwd=root, capture_output=True, text=True, timeout=180,
    )
    combined = proc.stdout + proc.stderr
    assert "ModuleNotFoundError" not in combined, combined
    assert proc.returncode == 0, combined
    assert "OK 7" in proc.stdout, combined


def test_sibling_imports_are_relative_or_fully_qualified():
    """A bare `from services.…` / `from data.…` in backend/ is importable only when
    backend/ happens to be on sys.path. Sibling imports must be relative (`.book_metrics`,
    as q1_agent uses) or absolute (`backend.services.…`, as trade_generator uses).

    Note the trap this closes: the two `from services.…` lines in q1_agent.py and
    scenario_analysis.py are inside DOCSTRINGS as usage examples, which is what made the
    bad form look like the house convention.
    """
    import re
    src = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "services",
                       "scenario_analysis.py")
    with open(src, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    bad = [
        (i + 1, ln) for i, ln in enumerate(lines)
        if re.match(r"^\s*(from|import)\s+(services|data|tools)\b", ln)
    ]
    assert bad == [], f"bare sibling import(s), unimportable without backend/ on path: {bad}"


# ─── S6: transmission by sector dependency, not market beta (ADR-0088) ───────

def _s6():
    return next(s for s in SCENARIOS if s.name == "S6_supply_shock")


def test_only_the_supply_shock_transmits_through_sectors():
    """S1-S5 are all beta-transmitted. If one of them grows a sector_shocks map the
    distinction ADR-0088 rests on has quietly gone, and S6 is no longer measuring a
    channel the others miss."""
    for s in SCENARIOS:
        if s.name == "S6_supply_shock":
            assert s.sector_shocks, "S6 must carry a sector transmission map"
        else:
            assert s.sector_shocks == {}, f"{s.name} unexpectedly transmits by sector"


def test_a_ticker_shock_overrides_its_sector():
    """A per-ticker shock beats its sector's, so a name whose behaviour does not
    resemble its bucket is still stressed correctly.

    This test used to open `assert SECTOR_MAP["SVXY"] == "Rates"` and describe that as
    a fact to work around — SVXY was short-vol filed under rates, and the override was
    what stopped it inheriting the rates bucket's mild negative. That premise was a
    BUG, not a fixture: `asset_class="rates"` also reached `regime_direction_bias`,
    whose risk beta for rates is -1.0, so EdgeScore's regime term favoured SVXY in the
    very tape that takes it to -35% (ADR-0119). SVXY is now classified as equity.

    The property under test never depended on that. It is asserted here against the
    classification SVXY actually has, so the test measures the override rather than
    pinning a misfiling."""
    from backend.services.scenario_analysis import _resolve_shock
    from backend.services.book_metrics import SECTOR_MAP

    assert SECTOR_MAP["SVXY"] == "US Equities"
    sector = _s6().sector_shocks["US Equities"]
    shock, origin = _resolve_shock(_s6(), "SVXY")
    assert shock == _s6().base_asset_shocks["SVXY"]
    assert shock < sector, "the override must be more severe than the bucket default"
    assert origin == "", "an overridden ticker must not claim to come from its sector"


def test_a_sector_inherited_shock_names_its_origin():
    """Design goal 1: a reader must be able to trace the number. XOM is not in
    base_asset_shocks — its shock comes from the Energy row of the transmission map,
    and the breakdown says so."""
    from backend.services.scenario_analysis import _resolve_shock

    shock, origin = _resolve_shock(_s6(), "XOM")
    assert shock == _s6().sector_shocks["Energy"]
    assert origin == " via Energy"

    result = estimate_scenario_pnl(_s6(), [_pick("XOM", "long", 0.20)], _bm(gross=0.20), 1e8)
    assert any("via Energy" in c for c in result.contribution_breakdown)


def test_duration_does_not_hedge_a_supply_shock():
    """The structural difference from every other risk-off scenario. S1 and S4 pay a
    long-duration book (+4%, +6% on TLT) because they are deflationary risk-off. A
    supply shock is INFLATIONARY, so Treasuries fall with equities and a book that
    hedges risk-off with duration is unhedged in exactly this state."""
    assert _s6().base_asset_shocks["TLT"] < 0
    for name in ("S1_vix_spike", "S4_credit_widening"):
        other = next(s for s in SCENARIOS if s.name == name)
        assert other.base_asset_shocks["TLT"] > 0

    picks = [_pick("TLT", "long", 0.20)]
    assert estimate_scenario_pnl(_s6(), picks, _bm(gross=0.20), 1e8).estimated_book_return < 0


def test_supply_shock_stresses_a_position_the_factor_path_cannot_see():
    """The reason S6 exists, measured on the live 2026-07-25 book.

    NOC carries beta_mkt -0.014 and appears in no S1-S5 shock list, so every
    beta-transmitted scenario reads it as ~flat: its worst case across all five was 9
    basis points on a 4.7% short whose entire thesis is geopolitical. A defense short
    is short escalation, and nothing in the suite priced that until the transmission
    ran through the Defense sector instead of through market beta.
    """
    from backend.services.scenario_analysis import _resolve_shock

    for s in SCENARIOS:
        if s.name != "S6_supply_shock":
            assert _resolve_shock(s, "NOC")[0] is None, f"{s.name} now shocks NOC directly"

    fe = {"NOC": {"beta_mkt": -0.0137045}}
    picks = [_pick("NOC", "short", 0.0473)]
    bm = _bm(gross=0.0473)

    pre = max(
        abs(estimate_scenario_pnl(s, picks, bm, 1e8, fe).estimated_book_return)
        for s in SCENARIOS if s.name != "S6_supply_shock"
    )
    s6 = estimate_scenario_pnl(_s6(), picks, bm, 1e8, fe)
    assert pre < 0.002, "precondition: NOC was effectively unstressed pre-S6"
    assert s6.estimated_book_return < -0.004, "a defense short must lose in an escalation"
    assert abs(s6.estimated_book_return) > 3 * pre


def test_supply_shock_covers_every_position_in_the_tier1_universe():
    """Sector transmission generalises where a ticker list does not: a name added to
    SECTOR_MAP is stressed by S6 the day it appears, with no edit to the scenario."""
    from backend.services.scenario_analysis import _resolve_shock
    from backend.services.book_metrics import SECTOR_MAP

    missing = [a for a in SECTOR_MAP if _resolve_shock(_s6(), a)[0] is None]
    assert missing == [], f"S6 has no shock for {missing} — add their sector to the map"


def test_supply_shock_breakdown_reconciles():
    """A sector-transmitted scenario covers 100% of gross, so the direct path wins and
    the per-position legs must still sum to the header."""
    picks = [
        _pick("XLE", "long", 0.061302483263712196),
        _pick("GDX", "short", 0.06395089283902591),
        _pick("NOC", "short", 0.04733485997962091),
        _pick("PDD", "short", 0.0925279954328765),
    ]
    bm = _bm(gross=sum(p["weight"] for p in picks))
    result = estimate_scenario_pnl(_s6(), picks, bm, 1e8)
    assert abs(_breakdown_total(result) - result.estimated_book_return) < 1e-3


def test_subpercent_shock_prints_with_enough_precision_to_multiply_out():
    """SHY takes -0.5%. At the table's old :+.0% that printed "+0%", giving a row whose
    own numbers multiply to zero under a non-zero result."""
    import re

    result = estimate_scenario_pnl(_s6(), [_pick("SHY", "long", 0.20)], _bm(gross=0.20), 1e8)
    row = next(c for c in result.contribution_breakdown if "SHY" in c)
    nums = [float(x) / 100 for x in re.findall(r"([+-]?\d+\.?\d*)%", row)]
    weight, shock, pnl = nums
    assert shock != 0.0, f"shock rounded away to zero in {row!r}"
    assert abs(weight * shock - pnl) < 1e-4, f"row arithmetic does not check out: {row!r}"


def test_sector_shocks_are_persisted_for_the_ui():
    """/risk builds its shock chips from the persisted maps. A sector-transmitted
    scenario that shipped only factor_shocks would render a near-empty chip row under a
    material P&L — a number on the page with its cause left off."""
    from backend.services.scenario_analysis import scenario_results_to_dict

    picks = [_pick("XLE", "long", 0.20)]
    results = run_scenario_analysis(picks, _bm(gross=0.20), 1e8)
    row = next(d for d in scenario_results_to_dict(results) if d["scenario_name"] == "S6_supply_shock")
    assert row["sector_shocks"]["Energy"] > 0
    assert row["description"]


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
    """Mixed portfolio — some direct-shock, some factor-only. With only half the gross
    directly shocked (covered_frac 0.5 < 0.6) the estimate is factor-driven, so the
    breakdown is the factor decomposition and must sum to the book return — not the
    stray TLT direct line that reconciles to nothing."""
    picks = [
        _pick("TLT", "long",  0.10),   # directly shocked in the VIX scenario
        _pick("SPY", "long",  0.10),   # factor-only
    ]
    bm = _bm(gross=0.20, beta_mkt=1.0)
    scenario = SCENARIOS[0]
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    assert isinstance(result, ScenarioResult)
    assert abs(_breakdown_total(result) - result.estimated_book_return) < 1e-3


def test_estimate_pnl_short_position_flips_sign():
    """Short positions invert P&L direction."""
    picks = [_pick("SPY", "short", 0.20)]  # short 20%
    bm = _bm(gross=0.20, beta_mkt=1.0)
    scenario = SCENARIOS[0]  # S1_vix_spike: market down
    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0)
    # Short SPY benefits from market sell-off
    assert result.estimated_book_return > 0


def test_short_contribution_row_arithmetic_is_self_consistent():
    """A directly-shocked short's breakdown row must print a SIGNED weight so its own
    numbers multiply to its own result. With an unsigned weight the sign flip is
    invisible and the row reads '+9.0% x -20% = +1.80%' — a product that does not equal
    what it claims, the first thing a reviewer poking a stress row would catch."""
    import re

    scenario = next(s for s in SCENARIOS if s.base_asset_shocks)
    asset = next(iter(scenario.base_asset_shocks))
    result = estimate_scenario_pnl(
        scenario, [_pick(asset, "short", 0.20)], _bm(gross=0.20), 100_000_000.0
    )
    row = next(c for c in result.contribution_breakdown if asset in c and "×" in c)
    nums = [float(x) / 100 for x in re.findall(r"([+-]?\d+\.?\d*)%", row)]
    assert len(nums) == 3, f"expected weight, shock, pnl in {row!r}"
    weight, shock, pnl = nums
    assert weight < 0, f"short weight should print negative in {row!r}"
    assert abs(weight * shock - pnl) < 1e-4, f"row arithmetic does not check out: {row!r}"


def _breakdown_total(result):
    """Sum the '= X%' result on each breakdown line — what a reviewer totalling the
    displayed decomposition would get."""
    import re
    tot = 0.0
    for line in result.contribution_breakdown:
        m = re.search(r"=\s*([-+]?\d+\.?\d*)%\s*$", line)
        if m:
            tot += float(m.group(1)) / 100.0
    return tot


def test_breakdown_reconciles_on_factor_driven_scenario():
    """When the estimate is factor-driven (few/no names directly shocked), the breakdown
    must decompose factor_pnl — not list direct-shock legs that sum to a different number.
    VIX Spike used to show legs summing to ~+1.8% under a +3.4% header (ADR-flagged)."""
    vix = next(s for s in SCENARIOS if s.name == "S1_vix_spike")
    picks = [_pick("MSFT", "long", 0.10), _pick("JPM", "short", 0.08)]  # not directly shocked
    fe = {"MSFT": {"beta_mkt": 1.2, "beta_umd": 0.3},
          "JPM": {"beta_mkt": 1.1, "beta_umd": -0.2}}
    result = estimate_scenario_pnl(vix, picks, _bm(gross=0.18), 100_000_000.0, factor_exposures=fe)
    assert any("shock" in c for c in result.contribution_breakdown), "expected factor lines"
    assert abs(_breakdown_total(result) - result.estimated_book_return) < 1e-3


def test_breakdown_reconciles_on_direct_driven_scenario():
    """A scenario whose covered names dominate keeps its per-position breakdown, which
    must still sum to the book return."""
    melt = next(s for s in SCENARIOS if s.name == "S5_melt_up")
    asset = next(iter(melt.base_asset_shocks))
    result = estimate_scenario_pnl(melt, [_pick(asset, "short", 0.20)], _bm(gross=0.20), 100_000_000.0)
    assert abs(_breakdown_total(result) - result.estimated_book_return) < 1e-3


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

def test_run_all_scenarios():
    picks = [_pick("SPY", "long", 0.10)]
    bm = _bm(gross=0.10, beta_mkt=1.0)
    results = run_scenario_analysis(picks, bm, 100_000_000.0)
    assert len(results) == 7   # ADR-0192 added S7_fallen_angel


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


# ─── Factor path uses PER-ASSET betas, not the book tilt (2026-07-24) ─────────

def _bm_for(picks, fe):
    from backend.services.book_metrics import compute_book_metrics
    return compute_book_metrics(picks, fe, 100_000_000.0)


def _vix():
    from backend.services.scenario_analysis import SCENARIOS
    return next(s for s in SCENARIOS if s.name == "S1_vix_spike")


def test_factor_path_scales_with_gross_not_net_exposure():
    """estimate_scenario_pnl substituted book_metrics' BOOK-LEVEL factor tilt for
    every pick's beta, and took abs() of it.

    Pushing a book-level tilt inside the per-pick loop computes
    beta_book × Σ(±wᵢ) × shock — that is beta_book × NET exposure — when the exposure
    a shock acts on is GROSS. Live on 2026-07-24 the book ran 48.7% gross against
    0.6% net, so every scenario collapsed by ~80x and the worst case (a VIX spike the
    row itself calls "historically associated with -15 to -25% SPX drawdown") printed
    -0.02%: twenty-one thousand dollars on a $100M book. A stress test that says the
    book cannot lose money is worse than none, because it is reassuring.

    XLF/XLV are used because neither carries a DIRECT shock in S1, so this isolates
    the factor path.
    """
    from backend.services.scenario_analysis import estimate_scenario_pnl

    picks = [
        {"asset": "XLF", "direction": "long", "weight": 0.20},
        {"asset": "XLV", "direction": "short", "weight": 0.20},
    ]
    # Identical betas on opposite sides: net exposure zero, gross 40%, genuinely
    # hedged against a market shock. A book-tilt proxy cannot represent this.
    same = {"XLF": {"beta_mkt": 1.0, "r_squared": 0.9},
            "XLV": {"beta_mkt": 1.0, "r_squared": 0.9}}
    hedged = estimate_scenario_pnl(_vix(), picks, _bm_for(picks, same), 1e8, same)
    assert abs(hedged.estimated_book_return) < 0.01

    # Same weights, but the short is now low-beta: the book is net long beta and the
    # SAME shock must produce a real loss, sized by gross rather than net.
    directional = {"XLF": {"beta_mkt": 1.0, "r_squared": 0.9},
                   "XLV": {"beta_mkt": 0.0, "r_squared": 0.9}}
    exposed = estimate_scenario_pnl(
        _vix(), picks, _bm_for(picks, directional), 1e8, directional
    )
    assert exposed.estimated_book_return < -0.02
    assert exposed.estimated_book_return < hedged.estimated_book_return


def test_factor_path_respects_the_sign_of_a_beta():
    """abs() on the tilt destroyed direction, so a negative-beta book could not gain
    in a selloff. The live confirmation of the fix was that the scenario finally
    agreed with the per-position beta attribution already on /risk: Σβ = -0.09 into a
    -18% shock gave +1.63%."""
    from backend.services.scenario_analysis import estimate_scenario_pnl

    picks = [{"asset": "XLV", "direction": "long", "weight": 0.30}]
    fe = {"XLV": {"beta_mkt": -0.8, "r_squared": 0.9}}
    out = estimate_scenario_pnl(_vix(), picks, _bm_for(picks, fe), 1e8, fe)
    assert out.estimated_book_return > 0


def test_missing_beta_for_an_asset_contributes_nothing_rather_than_zero_beta():
    """An asset with no factor row must be skipped, not scored as beta 0 — the
    difference between "we cannot measure this exposure" and "this has no exposure"."""
    from backend.services.scenario_analysis import estimate_scenario_pnl

    picks = [{"asset": "XLF", "direction": "long", "weight": 0.20}]
    with_beta = {"XLF": {"beta_mkt": 1.0, "r_squared": 0.9}}
    a = estimate_scenario_pnl(_vix(), picks, _bm_for(picks, with_beta), 1e8, with_beta)
    b = estimate_scenario_pnl(_vix(), picks, _bm_for(picks, with_beta), 1e8, {})
    assert a.estimated_book_return < b.estimated_book_return


# ─── Candidate-vs-book correlation (2026-07-24) ───────────────────────────────

def test_candidate_correlation_finds_the_closest_held_position():
    """Answers "why isn't X in the book?" with evidence rather than a proxy.

    /book first answered it with theme overlap, which is close to worthless: one
    theme routinely holds four positions across four sectors and both directions.
    Measured on the live book, the two shorts the agent passed over scored
    GDX -> SLV +0.82 and GLD -> SLV +0.84 — the same precious-metals bet already held
    — while BIL -> TLT -0.18 is genuinely independent.
    """
    import numpy as np
    import pandas as pd
    from unittest.mock import patch
    from backend.services.book_metrics import candidate_book_correlation

    rng = np.random.default_rng(3)
    base = rng.normal(0, 0.01, 300)
    idx = pd.bdate_range("2025-01-01", periods=300)
    df = pd.DataFrame(
        {
            "SLV": base,
            "GDX": base * 0.95 + rng.normal(0, 0.002, 300),   # near-duplicate of SLV
            "TLT": rng.normal(0, 0.01, 300),                  # unrelated
            "BIL": rng.normal(0, 0.0005, 300),                # unrelated, tiny vol
        },
        index=idx,
    )
    with patch("backend.services.book_metrics.fetch_pick_returns", return_value=df):
        out = candidate_book_correlation(["GDX", "BIL"], ["SLV", "TLT"])

    assert out["GDX"]["closest"] == "SLV"
    assert out["GDX"]["corr"] > 0.9
    # BIL matches something, but weakly — the point is the MAGNITUDE separates a
    # duplicate from an independent idea.
    assert abs(out["BIL"]["corr"]) < 0.3


def test_candidate_correlation_omits_a_name_with_no_returns():
    """A candidate with no usable history is OMITTED, not given 0.0. An unmeasurable
    correlation is not an absent one — silent zeros are the recurring bug here."""
    import numpy as np
    import pandas as pd
    from unittest.mock import patch
    from backend.services.book_metrics import candidate_book_correlation

    idx = pd.bdate_range("2025-01-01", periods=100)
    df = pd.DataFrame({"SLV": np.random.default_rng(1).normal(0, 0.01, 100)}, index=idx)
    with patch("backend.services.book_metrics.fetch_pick_returns", return_value=df):
        out = candidate_book_correlation(["NOPRICE"], ["SLV"])
    assert "NOPRICE" not in out


# ─── Correlation clusters, not pairwise spam (2026-07-24) ────────────────────

def test_correlation_warnings_cluster_instead_of_listing_every_pair():
    """correlation_warning emitted ONE VERBOSE SENTENCE PER PAIR.

    On the live 23-name candidate pool that was 31 near-identical lines in the
    reasoning prompt, each ending with the same "verify this is intentional, not
    accidental doubling of the same bet" — a wall of text where the useful content is
    WHICH NAMES FORM ONE BET. Pairwise is also the wrong shape: nobody reasons about
    TLT-IEF, TLT-AGG, IEF-AGG and IEF-SHY separately, they reason about the duration
    complex.
    """
    from backend.services.book_metrics import correlation_warning, correlation_clusters

    pairs = [
        ("IEF", "AGG", 0.97), ("TLT", "AGG", 0.91), ("IEF", "TLT", 0.91),
        ("IEF", "SHY", 0.87),                      # one duration complex
        ("GDX", "SLV", 0.82), ("GLD", "SLV", 0.84),  # one metals complex
    ]
    clusters = correlation_clusters(pairs)
    assert ["AGG", "IEF", "SHY", "TLT"] in clusters
    assert ["GDX", "GLD", "SLV"] in clusters

    lines = correlation_warning(pairs)
    one_bet = [l for l in lines if l.startswith("ONE BET")]
    assert len(one_bet) == 2, "six pairs are two bets, and should read as two"
    assert len(lines) < len(pairs) + 6      # far tighter than one line per pair


def test_inverse_correlation_is_a_hedge_not_a_duplicated_bet():
    """A -0.8 pair is a HEDGE. Folding it into a "these are the same" cluster would
    invert the meaning — the most damaging thing this panel could say."""
    from backend.services.book_metrics import correlation_warning, correlation_clusters

    pairs = [("SPY", "VIXY", -0.85), ("QQQ", "SPY", 0.93)]
    clusters = correlation_clusters(pairs)
    assert clusters == [["QQQ", "SPY"]], "the inverse pair must not form a cluster"

    lines = correlation_warning(pairs)
    assert any(l.startswith("HEDGE") and "VIXY" in l for l in lines)
    assert not any(l.startswith("ONE BET") and "VIXY" in l for l in lines)


def test_no_pairs_means_no_warnings():
    from backend.services.book_metrics import correlation_warning
    assert correlation_warning([]) == []


# ─── An inverse product's sign, across every scenario ────────────────────────


def test_short_vol_loses_in_every_risk_off_scenario():
    """SVXY had the sign backwards in two of six scenarios, and right in a third.

    `S1_vix_spike` carried `SVXY: +0.20 # short-VIX benefit` and `S4_credit_widening`
    carried `+0.15 # short credit benefit`, while `S6` correctly carried `-0.18` with the
    note "filed under 'Rates' but is short-vol; VIX spikes here". Same file, same asset,
    contradictory — and the measured beta settles it: **beta_mkt +2.08, R2 0.68**, a
    leveraged RISK-ON proxy. A scenario whose own description is a "-15 to -25% SPX
    drawdown" cannot pay a +20% gain on it.

    This mattered more than an ordinary calibration slip: SVXY is the second-largest
    position in the live book, and the stress table was telling a reader the book GAINS on
    it in a vol spike. ADR-0097 said it exactly — "a wrong side has no symptom. It renders
    cleanly, reads plausibly, and is simply false." That ADR fixed the sign in the COT
    mapping; nobody checked the scenario table for the same error.
    """
    from backend.services.scenario_analysis import SCENARIOS

    by_name = {s.name: s for s in SCENARIOS}
    risk_off = ["S1_vix_spike", "S2_rate_shock", "S3_usd_strength",
                "S4_credit_widening", "S6_supply_shock", "S7_fallen_angel"]

    for name in risk_off:
        scenario = by_name.get(name)
        if scenario is None:
            continue
        shock = (scenario.base_asset_shocks or {}).get("SVXY")
        if shock is None:
            continue
        assert shock < 0, (
            f"{name} pays SVXY {shock:+.0%}. SVXY is a -0.5x INVERSE VIX product — long "
            "SVXY is SHORT volatility, and every risk-off shock raises volatility. A "
            "positive number here is the Feb-2018 trade wearing a hedge's clothes."
        )

    # And the one scenario where it genuinely gains: vol collapses in a melt-up.
    melt_up = (by_name["S5_melt_up"].base_asset_shocks or {}).get("SVXY")
    assert melt_up is not None and melt_up > 0, (
        "short-vol rips when VIX collapses; S5 is the scenario that should pay it"
    )


def test_the_fallback_beta_table_agrees_in_SIGN_with_the_measured_universe():
    """The fallback fires exactly when live FF5 data is missing — i.e. when nobody is
    checking. `SVXY` sat at `mkt: -0.60` against a measured `+2.08`: not merely stale,
    the opposite direction.

    Sign only, not magnitude: the table is a documented approximation and pinning its
    values to a moving measurement would make it fail on ordinary drift.
    """
    from backend.services.scenario_analysis import DEFAULT_TICKER_BETAS

    # Leveraged long-equity proxies: market beta must be positive.
    for ticker in ("SVXY", "QQQ", "SPY", "ARKK", "IWM"):
        entry = DEFAULT_TICKER_BETAS.get(ticker)
        if entry is None or "mkt" not in entry:
            continue
        assert entry["mkt"] > 0, (
            f"{ticker} has a negative fallback market beta ({entry['mkt']}), which says it "
            "rises when the market falls"
        )
