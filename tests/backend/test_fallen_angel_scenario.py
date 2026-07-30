"""S: a fallen-angel stress scenario that transmits through MEASURED credit betas.

`credit_rates_exposures.py` (L2b, ADR-0190) shipped SHADOW on 2026-07-30 with an explicit
condition: S (this scenario) and B (the credit-lens book) each opt in deliberately, once L2b
has run in production for at least one day. That run happened; this is the opt-in.

`S7_fallen_angel` inserts a MEASURED tier between `_resolve_shock`'s existing two
(`base_asset_shocks` and `sector_shocks`): a large IG issuer is downgraded to HY, and the
book's per-asset loss is read off `marginal_beta_ig` / `marginal_beta_qual` — never
`total_beta_*`, which double-counts with this scenario's own `mkt` shock (see
`credit_rates_exposures.py`'s unit-convention docstring and ADR-0190/0191).

This file tests, in order: the transmission arithmetic by hand; the four-tier precedence
(override > measured > sector > factor, never a fabricated zero); that the six pre-existing
scenarios are untouched by the new parameter; that `credit_betas=None` is a fully-supported,
required fallback; that coverage is reported (ADR-0097's doctrine) rather than assumed; and
that `q1_agent._load_credit_betas` excludes anything not `status='measured'`, defensively,
even if a caller's query forgot to.
"""
from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.scenario_analysis import (  # noqa: E402
    SCENARIOS,
    Scenario,
    estimate_scenario_pnl,
    _resolve_shock,
    _coverage_tier,
)
from backend.services.book_metrics import BookMetrics, SECTOR_MAP  # noqa: E402
from backend.services import q1_agent  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

def _bm(gross=0.20, net=0.10, long_w=0.15, short_w=0.05, beta_mkt=0.8):
    return BookMetrics(
        book_beta_mkt=beta_mkt, book_beta_smb=0.0, book_beta_hml=0.0,
        book_beta_rmw=0.0, book_beta_cma=0.0, book_beta_umd=0.0,
        gross_exposure=gross, net_exposure=net,
        long_weight=long_w, short_weight=short_w,
        sector_weights={}, geo_weights={},
        sector_violations=[], geo_violations=[], weight_violations=[],
        high_correlation_pairs=[], computed=True,
    )


def _pick(asset, direction, weight):
    return dict(asset=asset, direction=direction, weight=weight)


def _s7() -> Scenario:
    return next(s for s in SCENARIOS if s.name == "S7_fallen_angel")


# ─────────────────────────────────────────────────────────────────────────────
# S7 is registered with the calibration the task specifies
# ─────────────────────────────────────────────────────────────────────────────

def test_s7_is_registered_with_the_specified_calibration():
    s7 = _s7()
    assert s7.credit_leg_shocks == {"d_ig": 60.0, "d_qual": 140.0}
    assert s7.factor_shocks == {"mkt": -0.05}
    # Minimal override list — the demonstration is that MEASURED betas cover the book.
    assert len(s7.base_asset_shocks) <= 2


# ─────────────────────────────────────────────────────────────────────────────
# Transmission arithmetic — worked example
# ─────────────────────────────────────────────────────────────────────────────

def test_transmission_arithmetic_worked_example():
    """By hand: marginal_beta_ig=-6.8, marginal_beta_qual=-2.0 (percent return per
    100bp — credit_rates_exposures.py's unit convention) under +60bp IG / +140bp
    quality-gap:

        shock = (-6.8 * (60/100) + -2.0 * (140/100)) / 100
              = (-4.08 + -2.8) / 100
              = -6.88 / 100
              = -0.0688   (-6.88%)
    """
    scenario = Scenario(
        name="test_transmission", label="test", description="",
        factor_shocks={}, base_asset_shocks={},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )
    credit_betas = {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}

    shock, origin = _resolve_shock(scenario, "LQD", credit_betas)

    assert shock == pytest.approx(-0.0688, abs=1e-9)
    assert origin == " via measured credit beta"


def test_transmission_arithmetic_flows_into_pnl():
    """The same worked example, through the P&L engine: a 10% long position shocked
    -6.88% costs the book -0.688% (0.10 * -0.0688)."""
    scenario = Scenario(
        name="test_transmission", label="test", description="",
        factor_shocks={}, base_asset_shocks={},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )
    credit_betas = {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}
    picks = [_pick("LQD", "long", 0.10)]
    bm = _bm(gross=0.10)

    result = estimate_scenario_pnl(scenario, picks, bm, 100_000_000.0, credit_betas=credit_betas)

    assert result.estimated_book_return == pytest.approx(0.10 * -0.0688, abs=1e-9)
    assert any("measured credit beta" in line for line in result.contribution_breakdown)


# ─────────────────────────────────────────────────────────────────────────────
# Four-tier precedence: override > measured > sector > factor
# ─────────────────────────────────────────────────────────────────────────────

def test_measured_beta_beats_sector_shock():
    scenario = Scenario(
        name="test_precedence", label="test", description="",
        factor_shocks={"mkt": -0.05}, base_asset_shocks={},
        sector_shocks={"Credit": -0.30},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )
    credit_betas = {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}

    # LQD sits in the "Credit" sector bucket AND has a measured beta. Measured wins.
    assert SECTOR_MAP.get("LQD") == "Credit"
    shock, origin = _resolve_shock(scenario, "LQD", credit_betas)

    assert origin == " via measured credit beta"
    assert shock != scenario.sector_shocks["Credit"]
    assert shock == pytest.approx(-0.0688, abs=1e-9)


def test_base_asset_override_beats_measured_beta():
    scenario = Scenario(
        name="test_precedence", label="test", description="",
        factor_shocks={"mkt": -0.05}, base_asset_shocks={"HYG": -0.99},
        sector_shocks={"Credit": -0.30},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )
    # HYG has a measured beta too — the override must still win.
    credit_betas = {"HYG": {"marginal_beta_ig": -1.0, "marginal_beta_qual": -1.0}}

    shock, origin = _resolve_shock(scenario, "HYG", credit_betas)

    assert shock == -0.99
    assert origin == ""


def test_no_measured_beta_falls_through_to_sector_then_factor():
    """No zeros invented: an asset with neither an override nor a measured beta falls to
    its sector shock; an asset matching none of the three tiers returns (None, "") so the
    factor path runs — never a fabricated shock."""
    scenario = Scenario(
        name="test_fallthrough", label="test", description="",
        factor_shocks={"mkt": -0.05}, base_asset_shocks={},
        sector_shocks={"Credit": -0.30},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )
    credit_betas = {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}

    # JNK: also "Credit" sector, but absent from credit_betas -> sector tier.
    assert SECTOR_MAP.get("JNK") == "Credit"
    shock, origin = _resolve_shock(scenario, "JNK", credit_betas)
    assert shock == -0.30
    assert origin == " via Credit"

    # A ticker in none of the three maps -> factor path, not a guessed zero.
    shock, origin = _resolve_shock(scenario, "NOT_A_REAL_TICKER", credit_betas)
    assert shock is None
    assert origin == ""


# ─────────────────────────────────────────────────────────────────────────────
# The six pre-existing scenarios are untouched
# ─────────────────────────────────────────────────────────────────────────────

def test_six_existing_scenarios_unchanged_when_credit_betas_passed():
    """None of S1-S6 declare `credit_leg_shocks`, so a rich `credit_betas` dict covering
    their own tickers must change neither the estimated return nor a single printed line."""
    credit_betas = {
        t: {"marginal_beta_ig": -3.0, "marginal_beta_qual": -2.0}
        for t in ("TLT", "HYG", "LQD", "SVXY", "SPY", "QQQ", "GLD", "XLE",
                  "FXI", "BABA", "IEF", "SHY", "CL", "UNG", "TIPS", "UUP", "NOC")
    }
    picks = [
        _pick("SPY", "long", 0.10), _pick("HYG", "short", 0.08),
        _pick("TLT", "long", 0.06), _pick("SVXY", "long", 0.05),
        _pick("XLE", "short", 0.04),
    ]
    bm = _bm(gross=0.33, beta_mkt=0.5)

    non_s7 = [s for s in SCENARIOS if s.name != "S7_fallen_angel"]
    assert len(non_s7) == 6
    for scenario in non_s7:
        assert scenario.credit_leg_shocks == {}
        without = estimate_scenario_pnl(scenario, picks, bm, 1e8, factor_exposures={})
        with_ = estimate_scenario_pnl(
            scenario, picks, bm, 1e8, factor_exposures={}, credit_betas=credit_betas
        )
        assert without.estimated_book_return == with_.estimated_book_return, scenario.name
        assert without.estimated_dollar_pnl == with_.estimated_dollar_pnl, scenario.name
        assert without.contribution_breakdown == with_.contribution_breakdown, scenario.name
        assert without.severity == with_.severity, scenario.name


# ─────────────────────────────────────────────────────────────────────────────
# credit_betas=None is a fully-supported, required fallback
# ─────────────────────────────────────────────────────────────────────────────

def test_credit_betas_none_matches_omitting_the_argument():
    s7 = _s7()
    picks = [_pick("LQD", "long", 0.10), _pick("XLE", "short", 0.05)]
    bm = _bm(gross=0.15)

    omitted = estimate_scenario_pnl(s7, picks, bm, 1e8)
    explicit_none = estimate_scenario_pnl(s7, picks, bm, 1e8, credit_betas=None)

    assert omitted.estimated_book_return == explicit_none.estimated_book_return
    assert omitted.contribution_breakdown == explicit_none.contribution_breakdown


def test_credit_betas_none_degrades_pnl_to_no_measured_tier_at_all():
    """The required fallback: with no measured betas for the run, S7's P&L number is
    exactly what it would be if the measured tier did not exist at all (override +
    factor path only) — 'every scenario degrades to exactly today's behaviour.'"""
    s7 = _s7()
    s7_no_tier = replace(s7, credit_leg_shocks={})
    picks = [
        _pick("LQD", "long", 0.10), _pick("XLE", "short", 0.05), _pick("SVXY", "long", 0.03),
    ]
    bm = _bm(gross=0.18)

    degraded = estimate_scenario_pnl(s7, picks, bm, 1e8, credit_betas=None)
    baseline = estimate_scenario_pnl(s7_no_tier, picks, bm, 1e8, credit_betas=None)

    assert degraded.estimated_book_return == baseline.estimated_book_return
    assert degraded.estimated_dollar_pnl == baseline.estimated_dollar_pnl
    assert degraded.severity == baseline.severity


# ─────────────────────────────────────────────────────────────────────────────
# Coverage is reported, not assumed (ADR-0097's doctrine)
# ─────────────────────────────────────────────────────────────────────────────

def test_coverage_reported_and_correct_partial_measurement():
    scenario = Scenario(
        name="test_coverage", label="test", description="",
        factor_shocks={"mkt": -0.05}, base_asset_shocks={"HYG": -0.99},
        sector_shocks={"Credit": -0.30},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )
    credit_betas = {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}
    picks = [
        _pick("LQD", "long", 0.10),     # measured
        _pick("HYG", "short", 0.08),    # override
        _pick("JNK", "long", 0.05),     # sector (Credit, no measured beta)
        _pick("NOTATICKER", "short", 0.02),  # unresolved -> factor path
    ]
    bm = _bm(gross=0.25)

    result = estimate_scenario_pnl(scenario, picks, bm, 1e8, credit_betas=credit_betas)

    coverage_line = next(
        l for l in result.contribution_breakdown if "Credit-beta coverage" in l
    )
    assert coverage_line == (
        "  Credit-beta coverage: 1 of 4 held names measured (40% of gross); "
        "1 override, 1 via sector, 1 unresolved (factor path)"
    )


def test_coverage_absent_for_scenarios_with_no_credit_leg_shocks():
    """The six pre-existing scenarios must get no new line at all — a scenario that
    never declares `credit_leg_shocks` has nothing to report coverage over."""
    scenario = next(s for s in SCENARIOS if s.name == "S1_vix_spike")
    picks = [_pick("SPY", "long", 0.10)]
    bm = _bm(gross=0.10)

    result = estimate_scenario_pnl(
        scenario, picks, bm, 1e8,
        credit_betas={"SPY": {"marginal_beta_ig": -1.0, "marginal_beta_qual": -1.0}},
    )

    assert not any("Credit-beta coverage" in line for line in result.contribution_breakdown)


def test_coverage_tier_helper_matches_resolve_shock():
    """`_coverage_tier` must never disagree with `_resolve_shock` about what resolved
    an asset's shock — they are read by the same P&L row and the same coverage line."""
    scenario = Scenario(
        name="test_coverage_tier", label="test", description="",
        factor_shocks={"mkt": -0.05}, base_asset_shocks={"HYG": -0.99},
        sector_shocks={"Credit": -0.30},
        credit_leg_shocks={"d_ig": 60.0, "d_qual": 140.0},
    )
    credit_betas = {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}

    assert _coverage_tier(scenario, "HYG", credit_betas) == "override"
    assert _coverage_tier(scenario, "LQD", credit_betas) == "measured"
    assert _coverage_tier(scenario, "JNK", credit_betas) == "sector"
    assert _coverage_tier(scenario, "NOT_A_REAL_TICKER", credit_betas) is None


# ─────────────────────────────────────────────────────────────────────────────
# q1_agent._load_credit_betas: status='measured' only, defensively
# ─────────────────────────────────────────────────────────────────────────────

class _CreditChain:
    def __init__(self, data):
        self._data = data

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def execute(self):
        return type("R", (), {"data": self._data})()


class _CreditSB:
    def __init__(self, data):
        self._chain = _CreditChain(data)

    def table(self, name):
        assert name == "credit_rates_exposures"
        return self._chain


def test_load_credit_betas_excludes_non_measured_and_partial_rows():
    """A fake client that (unlike real PostgREST) does not actually apply `.eq(...)`
    filters — so this pins that `_load_credit_betas` ALSO filters `status == 'measured'`
    on the rows it gets back, rather than trusting the query alone. A `degenerate` row
    and a partial-fit `measured` row (FF5+UMD unavailable, so a marginal beta is NULL)
    must both be excluded — never guessed, never entered as if fully measured."""
    rows = [
        {"asset": "LQD", "marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0,
         "status": "measured"},
        {"asset": "PARTIAL", "marginal_beta_ig": None, "marginal_beta_qual": None,
         "status": "measured"},
        {"asset": "BADFIT", "marginal_beta_ig": -1.0, "marginal_beta_qual": -1.0,
         "status": "degenerate"},
        {"asset": "THIN", "marginal_beta_ig": -1.0, "marginal_beta_qual": -1.0,
         "status": "insufficient_history"},
    ]

    out = q1_agent._load_credit_betas(_CreditSB(rows), "2026-07-30")

    assert out == {"LQD": {"marginal_beta_ig": -6.8, "marginal_beta_qual": -2.0}}


def test_load_credit_betas_returns_empty_on_no_rows_or_error():
    out_empty = q1_agent._load_credit_betas(_CreditSB([]), "2026-07-30")
    assert out_empty == {}

    class _RaisingSB:
        def table(self, name):
            raise RuntimeError("relation \"credit_rates_exposures\" does not exist")

    out_error = q1_agent._load_credit_betas(_RaisingSB(), "2026-07-30")
    assert out_error == {}
