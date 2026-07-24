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
    # Accept 0 or 2, deliberately. `load_dotenv()` searches from the SCRIPT's directory
    # upward, so it finds the repo `.env` whatever cwd is and the creds cannot be
    # stripped from a subprocess — locally this runs the real check and exits 0, while
    # in CI (no .env, secrets as env vars) it exits 2. Pinning either number would make
    # the test assert where it happens to run rather than what it is testing, which is
    # that the entry point the workflow uses imports and completes without crashing.
    assert proc.returncode in (0, 2), f"exit={proc.returncode}\n{combined}"


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
