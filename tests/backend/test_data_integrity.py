"""
Tests for the R0 fabricated-data guard (scripts/check_data_integrity.py).

Pins the detection of the seed fingerprint so fabricated portfolio numbers can
never quietly reach production again (RESIDUAL R0).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts.check_data_integrity import (
    detect_fabricated_seed,
    _looks_like_alternating_seed,
)


# The exact metrics the seed script wrote.
FABRICATED_RISK = {
    "concentration_hhi": 1850.0,
    "var_95": 2_500_000.0,
    "cvar_95": 4_000_000.0,
    "sharpe": 1.15,
    "beta": 0.65,
}

# A genuine computed row (HHI ~1000.12, per RESIDUAL R0).
REAL_RISK = {
    "concentration_hhi": 1000.12,
    "var_95": 1_840_000.0,
    "cvar_95": 2_760_000.0,
    "sharpe": 1.42,
    "beta": 0.68,
}


def _ret_rows(values):
    return [{"run_date": f"2026-07-{20 + i}", "daily_return": v} for i, v in enumerate(values)]


def test_detects_fabricated_risk_row():
    flags = detect_fabricated_seed(FABRICATED_RISK, [])
    assert any("portfolio_risk" in f for f in flags)


def test_real_risk_row_is_clean():
    assert detect_fabricated_seed(REAL_RISK, []) == []


def test_single_coincidental_sentinel_does_not_flag():
    # A real book that happens to have beta 0.65 — one match is not enough.
    row = {**REAL_RISK, "beta": 0.65}
    assert detect_fabricated_seed(row, []) == []


def test_detects_alternating_return_series_phase_a():
    rows = _ret_rows([0.0015, -0.0008, 0.0015, -0.0008, 0.0015])
    flags = detect_fabricated_seed(REAL_RISK, rows)
    assert any("portfolio_returns" in f for f in flags)


def test_detects_alternating_return_series_phase_b():
    rows = _ret_rows([-0.0008, 0.0015, -0.0008, 0.0015])
    assert _looks_like_alternating_seed([r["daily_return"] for r in rows])


def test_real_returns_are_clean():
    rows = _ret_rows([0.011, -0.021, 0.004, 0.0032, -0.0075])
    assert detect_fabricated_seed(REAL_RISK, rows) == []


def test_alternating_seed_requires_min_length():
    assert _looks_like_alternating_seed([0.0015, -0.0008]) is False


def test_both_fingerprints_flag_together():
    rows = _ret_rows([0.0015, -0.0008, 0.0015, -0.0008])
    flags = detect_fabricated_seed(FABRICATED_RISK, rows)
    assert len(flags) == 2


# ─────────────────────────────────────────────────────────────────────────────
# check_edge_score_reconciles — a stored score must reproduce from its components
# ─────────────────────────────────────────────────────────────────────────────

_W = {"trend": 0.20, "regime": 0.23, "carry": 0.34, "value": 0.18, "sentiment": 0.05}


def _row(**kw):
    base = {
        "theme_id": "t-1",
        "run_date": "2026-07-25",
        "edge_score": None,
        "trend_signal": None,
        "regime_bias": None,
        "carry_signal": None,
        "value_signal": None,
        "sentiment_signal": None,
    }
    base.update(kw)
    return base


def test_accepts_the_live_row_that_a_naive_sum_rejected():
    """Energy Prices, 2026-07-25 — carry and value not computable.

    The naive sum is 0.169999; the persisted score is 0.354165. Renormalised over
    the 0.48 of weight actually present, they agree. /method printed the naive sum
    and published a RECONCILIATION FAILURE against a correct pipeline (ADR-0064).
    """
    from scripts.check_data_integrity import check_edge_score_reconciles

    rows = [_row(edge_score=0.354165, trend_signal=0.7932,
                 regime_bias=0.0365, sentiment_signal=0.0592)]
    assert check_edge_score_reconciles(rows, _W) == []


def test_flags_a_score_that_does_not_match_its_components():
    from scripts.check_data_integrity import check_edge_score_reconciles

    # Same components, but the stored score is the NAIVE sum — i.e. a pipeline that
    # forgot to renormalise. That is the regression this guard exists to catch.
    rows = [_row(edge_score=0.169999, trend_signal=0.7932,
                 regime_bias=0.0365, sentiment_signal=0.0592)]
    flags = check_edge_score_reconciles(rows, _W)
    assert len(flags) == 1
    assert "renormalise" in flags[0]
    assert "not computable: carry, value" in flags[0]


def test_all_components_present_needs_no_renormalisation():
    from scripts.check_data_integrity import check_edge_score_reconciles

    # Weights sum to 1.00, so renormalising divides by 1 and the naive sum is right.
    expected = 0.20 * 0.5 + 0.23 * 0.4 + 0.34 * 0.3 + 0.18 * 0.2 + 0.05 * 0.1
    rows = [_row(edge_score=expected, trend_signal=0.5, regime_bias=0.4,
                 carry_signal=0.3, value_signal=0.2, sentiment_signal=0.1)]
    assert check_edge_score_reconciles(rows, _W) == []


def test_is_silent_on_an_unscored_theme():
    """A theme that was never scored is not a mismatch."""
    from scripts.check_data_integrity import check_edge_score_reconciles

    assert check_edge_score_reconciles([_row(trend_signal=0.5)], _W) == []


def test_nothing_computable_abstains_at_zero_without_dividing_by_zero():
    from scripts.check_data_integrity import check_edge_score_reconciles

    assert check_edge_score_reconciles([_row(edge_score=0.0)], _W) == []
    flags = check_edge_score_reconciles([_row(edge_score=0.3)], _W)
    assert len(flags) == 1  # claims an edge with no evidence behind it


def test_is_silent_without_rows_or_weights():
    from scripts.check_data_integrity import check_edge_score_reconciles

    assert check_edge_score_reconciles(None, _W) == []
    assert check_edge_score_reconciles([_row(edge_score=0.3, trend_signal=0.5)], None) == []
    assert check_edge_score_reconciles([], _W) == []


# ─────────────────────────────────────────────────────────────────────────────
# check_published_book_claims — re-check what is actually on the page
# ─────────────────────────────────────────────────────────────────────────────

_CANDS = [{"asset": a} for a in ("SLV", "BABA", "PDD", "NOC", "ARKK", "GDX", "KWEB")]


def test_catches_the_availability_lie_that_was_live_on_the_published_page():
    """The exact sentence the 2026-07-25 book carried.

    verify_citations could not have caught it: that book was generated before
    ADR-0061 existed, and nothing re-examined the row already on the page.
    """
    from scripts.check_data_integrity import check_published_book_claims

    rec = {
        "run_date": "2026-07-25",
        "book_view": (
            "The fifth independent short idea per POOL DEPTH, ARKK, is not present in "
            "the tradable candidate pool, so this book deploys four short picks."
        ),
        "independent_ideas": {},
    }
    flags = check_published_book_claims(rec, _CANDS)
    assert len(flags) == 1
    assert "published book 2026-07-25" in flags[0]
    assert "ARKK" in flags[0]


def test_catches_a_restated_idea_count_that_is_wrong():
    from scripts.check_data_integrity import check_published_book_claims

    rec = {
        "run_date": "2026-07-25",
        "book_view": "The short pool yields only four independent ideas this run.",
        "independent_ideas": {"short": {"count": 5}, "long": {"count": 9}},
    }
    flags = check_published_book_claims(rec, _CANDS)
    assert len(flags) == 1
    assert "independent ideas" in flags[0]


def test_passes_the_thesis_actually_published_after_the_guardrail_landed():
    """The real replacement sentence — a reason, not an availability excuse."""
    from scripts.check_data_integrity import check_published_book_claims

    rec = {
        "run_date": "2026-07-25",
        "book_view": (
            "I declined ARKK as the fifth independent short because its high-beta "
            "profile would compound existing market-beta exposure rather than diversify "
            "the short book, and its trade conviction is weaker than the four chosen."
        ),
        "independent_ideas": {"short": {"count": 5}},
    }
    assert check_published_book_claims(rec, _CANDS) == []


def test_is_silent_with_no_row_or_no_thesis():
    from scripts.check_data_integrity import check_published_book_claims

    assert check_published_book_claims(None, _CANDS) == []
    assert check_published_book_claims({"run_date": "d", "book_view": ""}, _CANDS) == []
    assert check_published_book_claims({"run_date": "d", "book_view": None}, _CANDS) == []


def test_guard_runs_as_a_script_not_only_as_a_module():
    """`daily-refresh.yml` invokes `python scripts/check_data_integrity.py`.

    Run that way, sys.path[0] is `scripts/` and the repo root is absent, so the lazy
    `backend.services.q1_agent` import inside check_published_book_claims raised
    ModuleNotFoundError and the guard exited 1 before printing a verdict — while
    passing when run as `python -m scripts.check_data_integrity`, which is how it was
    verified.

    This pins the ENTRY POINT the workflow actually uses. It asserts the import
    resolves in a subprocess with a clean sys.path; it does not touch Supabase, so it
    stays fast and offline (the guard exits 2 without credentials, which is a pass for
    this test's purpose).
    """
    import subprocess
    import sys
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    script = repo / "scripts" / "check_data_integrity.py"
    assert script.exists(), script

    # Strip the creds AND run from a directory with no .env, because main() calls
    # load_dotenv() and would otherwise pick the repo's up and hit the network.
    # sys.path is set from __file__, so the import under test does not need cwd.
    import tempfile

    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY")
    }
    with tempfile.TemporaryDirectory() as elsewhere:
        proc = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
            cwd=elsewhere,
            env=env,
            timeout=120,
        )
    combined = proc.stdout + proc.stderr
    assert "ModuleNotFoundError" not in combined, combined
    assert "No module named 'backend'" not in combined, combined
    # A guard must not die formatting its own verdict, on any console encoding.
    assert "UnicodeEncodeError" not in combined, combined
    assert "Traceback" not in combined, combined
    # Accept 0, 1 or 2, deliberately. This test verifies the ENTRY POINT imports and
    # completes — not that production data is clean.
    #
    # `load_dotenv()` searches from the SCRIPT's directory upward, so it finds the repo
    # `.env` whatever cwd is and the creds cannot be stripped from a subprocess: locally
    # this runs the real check against live data, while in CI (no .env, secrets as env
    # vars) it exits 2. It previously asserted `in (0, 2)` and broke the moment a check
    # legitimately fired on production — a test that fails when a guard CORRECTLY
    # reports a defect is testing the wrong thing.
    #
    # 1 is a guard doing its job. What must never appear is a crash, asserted above.
    assert proc.returncode in (0, 1, 2), f"exit={proc.returncode}\n{combined}"


def test_published_book_check_imports_cleanly_from_a_bare_process():
    """The lazy import must resolve, not just be syntactically present."""
    import subprocess
    import sys
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    code = (
        "import sys; sys.path.insert(0, r'%s');"
        "from scripts.check_data_integrity import check_published_book_claims as c;"
        "print(c({'run_date':'d','book_view':'ARKK is not present in the candidate pool.'},"
        "        [{'asset':'ARKK'}]))" % str(repo)
    )
    proc = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, timeout=120
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "ARKK" in proc.stdout, proc.stdout


# ─────────────────────────────────────────────────────────────────────────────
# check_book_arithmetic — the headline must describe the positions beneath it
# ─────────────────────────────────────────────────────────────────────────────

def _book(**over):
    picks = [
        {"asset": "XLE", "direction": "long", "weight": 0.10,
         "signed_weight": 0.10, "notional": 10_000_000.0},
        {"asset": "SLV", "direction": "short", "weight": 0.06,
         "signed_weight": -0.06, "notional": 6_000_000.0},
    ]
    bm = {
        "gross_exposure": 0.16, "net_exposure": 0.04,
        "long_weight": 0.10, "short_weight": 0.06,
    }
    row = {"run_date": "2026-07-25", "picks": picks, "book_metrics": bm}
    row.update(over)
    return row


def test_a_consistent_book_raises_nothing():
    from scripts.check_data_integrity import check_book_arithmetic
    assert check_book_arithmetic(_book()) == []


def test_catches_a_gross_that_does_not_match_the_picks():
    """The 40-name provisional book behind a 9-name headline was this shape."""
    from scripts.check_data_integrity import check_book_arithmetic
    row = _book()
    row["book_metrics"]["gross_exposure"] = 0.92
    flags = check_book_arithmetic(row)
    assert any("gross_exposure" in f for f in flags)


def test_catches_a_net_that_does_not_match_the_picks():
    from scripts.check_data_integrity import check_book_arithmetic
    row = _book()
    row["book_metrics"]["net_exposure"] = -0.30
    assert any("net_exposure" in f for f in check_book_arithmetic(row))


def test_catches_a_long_short_split_that_does_not_add_up():
    from scripts.check_data_integrity import check_book_arithmetic
    row = _book()
    row["book_metrics"]["short_weight"] = 0.20   # 0.10+0.20 != 0.16
    flags = check_book_arithmetic(row)
    assert any("long_weight" in f for f in flags)


def test_catches_a_notional_that_is_not_weight_times_capital():
    from scripts.check_data_integrity import check_book_arithmetic
    row = _book()
    row["picks"][0]["notional"] = 4_200_000.0
    assert any("notional" in f for f in check_book_arithmetic(row))


def test_catches_a_short_carrying_a_positive_signed_weight():
    """ADR-0016: the sign IS the direction."""
    from scripts.check_data_integrity import check_book_arithmetic
    row = _book()
    row["picks"][1]["signed_weight"] = 0.06
    flags = check_book_arithmetic(row)
    assert any("sign is the direction" in f for f in flags)


def test_accepts_picks_delivered_as_a_json_string():
    from scripts.check_data_integrity import check_book_arithmetic
    import json as _json
    row = _book()
    row["picks"] = _json.dumps(row["picks"])
    assert check_book_arithmetic(row) == []


def test_is_silent_without_a_row_picks_or_book_metrics():
    from scripts.check_data_integrity import check_book_arithmetic
    assert check_book_arithmetic(None) == []
    assert check_book_arithmetic(_book(picks=[])) == []
    assert check_book_arithmetic(_book(book_metrics={})) == []
    assert check_book_arithmetic(_book(picks="not json")) == []


# ─────────────────────────────────────────────────────────────────────────────
# check_stalled_stages — a stage that began and never finished
# ─────────────────────────────────────────────────────────────────────────────

from datetime import datetime, timedelta, timezone  # noqa: E402

_NOW = datetime(2026, 7, 25, 0, 30, tzinfo=timezone.utc)


def _stage(status="partial", minutes_ago=120, stage="L5", run_date="2026-07-24"):
    return {
        "run_date": run_date,
        "stage": stage,
        "status": status,
        "started_at": (_NOW - timedelta(minutes=minutes_ago)).isoformat(),
    }


def test_flags_the_live_l5_that_started_and_never_finished():
    """2026-07-24: L5 started 22:34:58 and never wrote a terminal status.

    No book was published for that date, the site served the previous run's, and
    pipeline_runs simply held 'partial' indefinitely.
    """
    from scripts.check_data_integrity import check_stalled_stages

    flags = check_stalled_stages([_stage(minutes_ago=115)], now=_NOW)
    assert len(flags) == 1
    assert "L5" in flags[0] and "2026-07-24" in flags[0]
    assert "never finished" in flags[0]


def test_a_stage_still_inside_the_window_is_running_not_stalled():
    """Must never fire on a concurrent run — the workflow allows 60 minutes."""
    from scripts.check_data_integrity import check_stalled_stages

    assert check_stalled_stages([_stage(minutes_ago=5)], now=_NOW) == []
    assert check_stalled_stages([_stage(minutes_ago=59)], now=_NOW) == []
    # 60-minute workflow ceiling + 30-minute margin = 90.
    assert check_stalled_stages([_stage(minutes_ago=89)], now=_NOW) == []
    assert check_stalled_stages([_stage(minutes_ago=91)], now=_NOW) != []


def test_terminal_statuses_are_never_flagged():
    from scripts.check_data_integrity import check_stalled_stages

    for st in ("success", "failure"):
        assert check_stalled_stages([_stage(status=st, minutes_ago=10_000)], now=_NOW) == []


def test_is_silent_without_rows_or_a_start_time():
    from scripts.check_data_integrity import check_stalled_stages

    assert check_stalled_stages(None, now=_NOW) == []
    assert check_stalled_stages([], now=_NOW) == []
    row = _stage(); row["started_at"] = None
    assert check_stalled_stages([row], now=_NOW) == []
    row2 = _stage(); row2["started_at"] = "not a timestamp"
    assert check_stalled_stages([row2], now=_NOW) == []


def test_a_naive_timestamp_is_read_as_utc():
    """Postgres can hand back a naive string; treating it as local would shift the age."""
    from scripts.check_data_integrity import check_stalled_stages

    row = _stage(minutes_ago=200)
    row["started_at"] = (_NOW - timedelta(minutes=200)).replace(tzinfo=None).isoformat()
    assert len(check_stalled_stages([row], now=_NOW)) == 1


# ─────────────────────────────────────────────────────────────────────────────
# check_cap_breach_claims — a thesis must not claim a breach the book lacks
# ─────────────────────────────────────────────────────────────────────────────

def _caprow(**over):
    row = {
        "run_date": "2026-07-25",
        "book_view": "Central scenario: late-cycle, risk-on.",
        "book_risks": [],
        "cap_utilisation": {"violations": []},
    }
    row.update(over)
    return row


def test_catches_the_live_false_cap_breach_claim():
    """The exact sentence published on 2026-07-25.

    compute_book_metrics_node runs BEFORE reason_picks over the screened pool with
    EQUAL weights, and the prompt labelled that block "BOOK METRICS". The pool caps at
    30 names, so 20/30 = 66.67% US — exactly the figure quoted. The book's own geo
    weight was 35.00% with violations == [].
    """
    from scripts.check_data_integrity import check_cap_breach_claims

    row = _caprow(book_risks=[
        "US geographic concentration: pre-computed book metrics show US at 66.67% "
        "versus the 35% cap (31.67pp over); UNH, JPM, NUE would worsen this breach."
    ])
    flags = check_cap_breach_claims(row)
    assert len(flags) == 1
    assert "book_risks[0]" in flags[0]
    assert "violations is empty" in flags[0]


def test_stays_silent_when_the_book_genuinely_breaches():
    """A real breach SHOULD be discussed — the check must not suppress it."""
    from scripts.check_data_integrity import check_cap_breach_claims

    row = _caprow(
        cap_utilisation={"violations": ["US 41.20% — 6.20pp over its 35% cap"]},
        book_risks=["US geographic concentration: US is 6.2pp over the 35% cap."],
    )
    assert check_cap_breach_claims(row) == []


def test_ordinary_risk_prose_is_not_flagged():
    from scripts.check_data_integrity import check_cap_breach_claims

    row = _caprow(book_risks=[
        "China policy surprise invalidating both BABA and PDD simultaneously.",
        "VIX spike to >30: SVXY long is directly short-vol and most exposed.",
        "Precious-metals breakout: SLV short disqualified if gold breaks $4200/oz.",
    ])
    assert check_cap_breach_claims(row) == []


def test_catches_the_claim_in_the_thesis_body_too():
    from scripts.check_data_integrity import check_cap_breach_claims

    row = _caprow(book_view="Sector concentration exceeds the 30% cap on Metals.")
    assert len(check_cap_breach_claims(row)) == 1


def test_is_silent_without_a_measurement_or_text():
    from scripts.check_data_integrity import check_cap_breach_claims

    assert check_cap_breach_claims(None) == []
    assert check_cap_breach_claims(_caprow(cap_utilisation=None)) == []
    assert check_cap_breach_claims(_caprow(book_view="", book_risks=[])) == []


# ─────────────────────────────────────────────────────────────────────────────
# check_factor_tilt_claims — a restated tilt must be the BOOK's, not the pool's
# ─────────────────────────────────────────────────────────────────────────────

def _tiltrow(**over):
    row = {
        "run_date": "2026-07-25",
        "book_view": "Late-cycle, risk-on.",
        "book_risks": [],
        "book_metrics": {"factor_tilts": {
            "beta_mkt": -0.5022, "beta_smb": 0.1188, "beta_hml": 0.3235,
            "beta_rmw": 0.4252, "beta_cma": 0.2077, "beta_umd": -0.0642,
        }},
    }
    row.update(over)
    return row


def test_catches_the_live_market_neutral_claim():
    """The 2026-07-25 thesis called a book with beta_mkt -0.5022 "market-neutral".

    Same root cause as ADR-0071: the prompt's metrics block is the equal-weighted
    candidate pool computed BEFORE selection. The pool's Mkt was -0.02; the book's was
    -0.5022 — the headline risk characterisation was wrong by 25x.
    """
    from scripts.check_data_integrity import check_factor_tilt_claims

    row = _tiltrow(book_view=(
        "The book expresses factor tilts favoring value (HML +0.27) and quality "
        "(RMW +0.35) at market-neutral (Mkt -0.02)."
    ))
    flags = check_factor_tilt_claims(row)
    assert len(flags) == 3, flags
    joined = " ".join(flags)
    assert "beta_mkt is -0.5022" in joined
    assert "MKT -0.0200" in joined


def test_a_tilt_stated_correctly_is_not_flagged():
    """The check must not discourage citing the book's real tilts."""
    from scripts.check_data_integrity import check_factor_tilt_claims

    row = _tiltrow(book_view=(
        "Net short the market (Mkt -0.50) with a value tilt (HML +0.32)."
    ))
    assert check_factor_tilt_claims(row) == []


def test_rounding_is_not_a_defect():
    """0.05 in beta units: catch a figure describing a different portfolio, not
    a rounded one. The live miss was 0.48."""
    from scripts.check_data_integrity import check_factor_tilt_claims

    assert check_factor_tilt_claims(_tiltrow(book_view="HML +0.30")) == []
    assert len(check_factor_tilt_claims(_tiltrow(book_view="HML +0.10"))) == 1


def test_one_flag_per_factor_however_it_is_named():
    from scripts.check_data_integrity import check_factor_tilt_claims

    row = _tiltrow(book_view="Mkt -0.02, and the market beta of -0.02 keeps it neutral.")
    assert len(check_factor_tilt_claims(row)) == 1


def test_reads_the_risks_list_as_well_as_the_body():
    from scripts.check_data_integrity import check_factor_tilt_claims

    row = _tiltrow(book_risks=["A momentum reversal: UMD +0.90 would hurt."])
    assert len(check_factor_tilt_claims(row)) == 1


def test_ordinary_prose_with_numbers_is_not_flagged():
    """A ticker, a price and a percentage near no factor name must stay silent."""
    from scripts.check_data_integrity import check_factor_tilt_claims

    row = _tiltrow(book_risks=[
        "VIX spike to >30: SVXY is directly short-vol.",
        "Gold breaking $4200/oz disqualifies the GDX short.",
        "US geographic weight is 35.00% of gross.",
    ])
    assert check_factor_tilt_claims(row) == []


def test_a_factor_the_book_did_not_measure_is_not_checked():
    """Absence is not a value — ADR-0066. A null tilt cannot contradict anything."""
    from scripts.check_data_integrity import check_factor_tilt_claims

    row = _tiltrow(
        book_metrics={"factor_tilts": {"beta_mkt": None}},
        book_view="Mkt -0.02.",
    )
    assert check_factor_tilt_claims(row) == []


def test_is_silent_without_a_row_tilts_or_text():
    from scripts.check_data_integrity import check_factor_tilt_claims

    assert check_factor_tilt_claims(None) == []
    assert check_factor_tilt_claims(_tiltrow(book_metrics={})) == []
    assert check_factor_tilt_claims(_tiltrow(book_view="", book_risks=[])) == []


# ─────────────────────────────────────────────────────────────────────────────
# check_per_pick_tilts_differentiate — one aggregate copied across the book
# ─────────────────────────────────────────────────────────────────────────────

_POOL_TILTS = {"beta_cma": -0.13, "beta_hml": 0.27, "beta_mkt": -0.02,
               "beta_rmw": 0.35, "beta_smb": 0.18, "beta_umd": 0.0}


def test_catches_the_live_ten_identical_tilt_rows():
    """The 2026-07-25 book: all ten positions carried the pool's aggregate."""
    from scripts.check_data_integrity import check_per_pick_tilts_differentiate

    row = {"run_date": "2026-07-25",
           "picks": [{"asset": a, "factor_tilts": dict(_POOL_TILTS)}
                     for a in ("XLE", "SHY", "SVXY", "NUE", "UNH",
                               "BABA", "GDX", "PDD", "NOC", "ARKK")]}
    flags = check_per_pick_tilts_differentiate(row)
    assert len(flags) == 1
    assert "all 10 positions" in flags[0]
    assert "SHY" in flags[0] and "ARKK" in flags[0]


def test_genuinely_measured_betas_pass():
    from scripts.check_data_integrity import check_per_pick_tilts_differentiate

    row = {"run_date": "2026-07-26", "picks": [
        {"asset": "ARKK", "factor_tilts": {"beta_mkt": 1.48955}},
        {"asset": "SHY", "factor_tilts": {"beta_mkt": 0.0146072}},
    ]}
    assert check_per_pick_tilts_differentiate(row) == []


def test_a_single_position_cannot_fail_to_differentiate():
    from scripts.check_data_integrity import check_per_pick_tilts_differentiate

    row = {"run_date": "x", "picks": [{"asset": "XLE", "factor_tilts": _POOL_TILTS}]}
    assert check_per_pick_tilts_differentiate(row) == []


def test_empty_tilts_are_not_a_duplication():
    """A book with no factor data is a different problem, not this one."""
    from scripts.check_data_integrity import check_per_pick_tilts_differentiate

    row = {"run_date": "x", "picks": [{"asset": "A", "factor_tilts": {}},
                                      {"asset": "B", "factor_tilts": {}}]}
    assert check_per_pick_tilts_differentiate(row) == []


def test_reads_picks_delivered_as_a_json_string():
    import json as _json
    from scripts.check_data_integrity import check_per_pick_tilts_differentiate

    row = {"run_date": "x", "picks": _json.dumps(
        [{"asset": "A", "factor_tilts": _POOL_TILTS},
         {"asset": "B", "factor_tilts": _POOL_TILTS}])}
    assert len(check_per_pick_tilts_differentiate(row)) == 1


def test_tilt_spread_is_silent_without_a_row():
    from scripts.check_data_integrity import check_per_pick_tilts_differentiate

    assert check_per_pick_tilts_differentiate(None) == []
    assert check_per_pick_tilts_differentiate({"picks": "not json"}) == []


# ─────────────────────────────────────────────────────────────────────────────
# check_regime_characterisation_claims — a shape word must match the shape
# ─────────────────────────────────────────────────────────────────────────────

_LIVE_REGIME = {"yield_curve_slope": 0.34, "vix_term_diff": -1.93}


def test_catches_the_live_inverted_curve_claim():
    """The published thesis opened by describing an upward slope and naming it
    an inversion — every level cited correctly, the characterisation false."""
    from scripts.check_data_integrity import check_regime_characterisation_claims

    row = {"run_date": "2026-07-25", "book_view":
           "2y at 4.37% sits 74bps above Fed Funds (3.63%) — an inverted curve that "
           "historically resolves via Fed cuts.", "book_risks": []}
    flags = check_regime_characterisation_claims(row, _LIVE_REGIME)
    assert len(flags) == 1
    assert "+34 bps" in flags[0]


def test_catches_the_live_backwardation_claim():
    from scripts.check_data_integrity import check_regime_characterisation_claims

    row = {"run_date": "2026-07-25", "book_view": "",
           "book_risks": ["term structure already in backwardation (VIX3M-VIX = +1.93)"]}
    flags = check_regime_characterisation_claims(row, _LIVE_REGIME)
    assert len(flags) == 1
    assert "contango" in flags[0]


def test_the_opposite_mislabel_is_caught_too():
    from scripts.check_data_integrity import check_regime_characterisation_claims

    row = {"run_date": "x", "book_view": "vol is in contango", "book_risks": []}
    flags = check_regime_characterisation_claims(row, {"vix_term_diff": 2.1})
    assert len(flags) == 1
    assert "backwardation" in flags[0]


def test_a_true_inversion_claim_passes():
    """A real inversion SHOULD be discussed — the check must not suppress it."""
    from scripts.check_data_integrity import check_regime_characterisation_claims

    row = {"run_date": "x", "book_view": "the curve is inverted", "book_risks": []}
    assert check_regime_characterisation_claims(
        row, {"yield_curve_slope": -0.20, "vix_term_diff": -1.0}) == []


def test_correct_shape_words_pass():
    from scripts.check_data_integrity import check_regime_characterisation_claims

    row = {"run_date": "x",
           "book_view": "an upward-sloping curve with vol in contango",
           "book_risks": []}
    assert check_regime_characterisation_claims(row, _LIVE_REGIME) == []


def test_shape_check_is_silent_without_measurements_or_text():
    from scripts.check_data_integrity import check_regime_characterisation_claims

    row = {"run_date": "x", "book_view": "inverted", "book_risks": []}
    assert check_regime_characterisation_claims(row, None) == []
    assert check_regime_characterisation_claims(None, _LIVE_REGIME) == []
    assert check_regime_characterisation_claims(
        {"book_view": "", "book_risks": []}, _LIVE_REGIME) == []


# ─────────────────────────────────────────────────────────────────────────────
# run_book_checks — every check runs; the guard reports all failures, not the first
# ─────────────────────────────────────────────────────────────────────────────

def _three_defect_row():
    """The live 2026-07-25 book, which carried three defects at once.

    They surfaced across three separate iterations only because the guard returned at
    the first one.
    """
    return {
        "run_date": "2026-07-25",
        "book_view": (
            "2y at 4.37% sits 74bps above Fed Funds — an inverted curve. The book shows "
            "factor tilts favoring value (HML +0.27) at market-neutral (Mkt -0.02)."
        ),
        "book_risks": [],
        "book_metrics": {"factor_tilts": {"beta_mkt": -0.5022, "beta_hml": 0.3235}},
        "picks": [{"asset": "SHY", "factor_tilts": {"beta_mkt": -0.02}},
                  {"asset": "ARKK", "factor_tilts": {"beta_mkt": -0.02}}],
        "cap_utilisation": {"violations": []},
    }


def test_all_three_live_defects_are_reported_in_one_pass():
    from scripts.check_data_integrity import run_book_checks

    results = run_book_checks(
        _three_defect_row(), [], {"yield_curve_slope": 0.34, "vix_term_diff": -1.93})
    failing = [headline for headline, flags, _ in results if flags]
    assert len(failing) == 3, failing
    assert any("factor tilt that is not the book's" in h for h in failing)
    assert any("do not differentiate" in h for h in failing)
    assert any("characterises the regime" in h for h in failing)


def test_a_clean_book_reports_every_check_as_passing():
    from scripts.check_data_integrity import run_book_checks

    row = {"run_date": "2026-07-26", "book_view": "An upward-sloping curve.",
           "book_risks": [], "book_metrics": {}, "picks": [], "cap_utilisation": {}}
    results = run_book_checks(row, [], {"yield_curve_slope": 0.34})
    assert all(not flags for _, flags, _ in results)
    assert len(results) == 7


def test_every_check_runs_even_when_an_earlier_one_fails():
    """The property the early-return version could not offer."""
    from scripts.check_data_integrity import run_book_checks

    results = run_book_checks(_three_defect_row(), [], None)
    assert len(results) == 7
    assert all(isinstance(ok, str) and ok for _, _, ok in results)


# ─────────────────────────────────────────────────────────────────────────────────
# Recorded but never graded — the mirror of check_published_claims_are_on_the_record
#
# That guard asks *is every published claim recorded*, and caught 9 of 32 missing on
# 2026-07-27. Nothing asked the reverse until 2026-07-31, when 20 of ~80 live claims
# turned out to be permanently `pending`: the resolver derived its claim set from the
# CURRENT book, so a pick whose book was replaced by a later run on the same run_date was
# never in the set again. Unfalsifiable, on the table whose ADR is titled "a published
# pick must be falsifiable" (ADR-0203, ADR-0205).
#
# Three states, and the reason they are three rather than one is that collapsing them
# would report a spec migration as a data defect.

_ORACLE = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)   # cutoff at grace 7 = 08-25


def _pending(asset="ARKK", exp="2026-08-20", spec=None, verdict="pending",
             run="2026-07-30", direction="short"):
    from backend.services.pick_outcomes import SPEC_VERSION
    return {
        "run_date": run, "asset": asset, "direction": direction,
        "spec_version": SPEC_VERSION if spec is None else spec,
        "verdict": verdict, "expected_exit_date": exp,
    }


def test_flags_the_live_20_claims_that_matured_and_were_never_graded():
    from scripts.check_data_integrity import check_matured_claims_were_resolved

    rows = [_pending(asset=a) for a in ("ARKK", "JD", "MSFT", "NUE")]
    flags = check_matured_claims_were_resolved(rows, now=_ORACLE)
    assert len(flags) == 1
    assert "4 recorded claim(s)" in flags[0]
    for a in ("ARKK", "JD", "MSFT", "NUE"):
        assert a in flags[0]
    # Names the repair, like its forward sibling does.
    assert "resolve_outcomes" in flags[0]


def test_a_claim_inside_the_grace_window_is_slow_not_stalled():
    # A void is terminal, so the guard must not cry before the price feed has had a
    # reasonable chance. Grace here (7) is deliberately shorter than the resolver's void
    # tolerance (10), so a human sees the stall while the claim can still be graded.
    from scripts.check_data_integrity import check_matured_claims_were_resolved

    assert check_matured_claims_were_resolved([_pending(exp="2026-08-28")], now=_ORACLE) == []


def test_an_unmatured_claim_is_not_flagged():
    from scripts.check_data_integrity import check_matured_claims_were_resolved

    assert check_matured_claims_were_resolved([_pending(exp="2026-12-01")], now=_ORACLE) == []


def test_a_terminal_verdict_is_never_flagged():
    from scripts.check_data_integrity import check_matured_claims_were_resolved

    rows = [_pending(verdict=v) for v in ("hit", "miss", "flat", "void")]
    assert check_matured_claims_were_resolved(rows, now=_ORACLE) == []


def test_a_retired_spec_is_reported_but_is_not_a_failure():
    # It needs a resolver for that spec, not a re-run, so calling it a data defect would
    # send an operator to the wrong repair.
    from scripts.check_data_integrity import check_matured_claims_were_resolved

    flags = check_matured_claims_were_resolved([_pending(spec="v0")], now=_ORACLE)
    assert len(flags) == 1
    assert flags[0].startswith("NOTE")
    assert "v0" in flags[0]


def test_a_missing_expected_exit_date_is_reported_as_unknown_not_skipped():
    # Every row pick_outcomes.to_row writes has one, so a NULL is a hand-inserted row —
    # the single case where silence would hide the whole class.
    from scripts.check_data_integrity import check_matured_claims_were_resolved

    flags = check_matured_claims_were_resolved([_pending(exp=None)], now=_ORACLE)
    assert len(flags) == 1
    assert "no expected_exit_date" in flags[0]
    assert "ARKK" in flags[0]


def test_no_rows_is_not_a_failure():
    from scripts.check_data_integrity import check_matured_claims_were_resolved

    assert check_matured_claims_were_resolved([], now=_ORACLE) == []
    assert check_matured_claims_were_resolved(None, now=_ORACLE) == []
