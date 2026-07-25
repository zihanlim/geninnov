"""CI coverage for the L5 acceptance battery (`backend/eval`).

None of these tests call an LLM. They answer a narrower question than the battery
itself does — is the battery *working*? — in three parts:

1. **Round-trip.** A mechanically-correct book, built from each fixture, passes every
   check on that case. If this fails, a check is wrong, not the agent.
2. **Rejection.** A book damaged in a known way fails the check that damage targets.
   A check that never fires is indistinguishable from one that always passes, and
   only this half catches that.
3. **Fixture integrity.** Each frozen state is internally consistent — the pool-depth
   block agrees with the candidate list, candidate themes exist in the theme table —
   so a case tests reasoning rather than tolerance for contradictory inputs.

The battery against a real provider lives in `scripts/run_eval.py`; it is not a test
because it costs money and depends on a network.

Run with: pytest tests/backend/test_eval_battery.py -v
"""
from __future__ import annotations

import pytest

from backend.eval import (
    STANDARD_BATTERY,
    CitationsVerify,
    EvalCase,
    EveryPickCited,
    MaxPerSide,
    NetTilt,
    OnePerComplex,
    PicksInPool,
    ProseNumber,
    SideCount,
    aggregate,
    canned_agent_fn,
    drifting_agent_fn,
    run_battery,
    score_book,
)
from backend.eval.battery import case_by_id
from backend.eval.scorer import prose_numbers_for, score_check

CASE_IDS = [c.id for c in STANDARD_BATTERY]


# ─────────────────────────────────────────────────────────────────────────────
# 1. Round-trip — a correct book passes
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("case_id", CASE_IDS)
def test_canned_book_passes_every_check(case_id: str) -> None:
    case = case_by_id(case_id)
    score = score_book(case, canned_agent_fn(case))
    assert score.passed, "canned book failed: " + "; ".join(
        f"{r.label}: {r.detail}" for r in score.failures
    )


def test_battery_run_is_green_against_the_canned_agent() -> None:
    result = run_battery(STANDARD_BATTERY, agent_fn=canned_agent_fn)
    assert result.all_passed, result.summary["failures"]
    assert result.summary["cases_passed"] == len(STANDARD_BATTERY)
    assert result.summary["checks_passed"] == result.summary["checks_total"]


def test_every_case_asserts_something() -> None:
    """A case with no checks passes vacuously and would hide a regression."""
    for case in STANDARD_BATTERY:
        assert case.checks, f"{case.id} declares no checks"
        assert case.rationale.strip(), f"{case.id} has no rationale"


def test_case_ids_are_unique() -> None:
    assert len(CASE_IDS) == len(set(CASE_IDS))


# ─────────────────────────────────────────────────────────────────────────────
# 2. Rejection — a broken book fails
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("case_id", CASE_IDS)
def test_drifting_book_is_rejected(case_id: str) -> None:
    case = case_by_id(case_id)
    score = score_book(case, drifting_agent_fn(case))
    assert not score.passed, f"{case_id}: a deliberately broken book passed every check"


def test_drift_fails_the_checks_it_targets() -> None:
    """Each defect in `drifting_agent_fn` is named against the check it should trip."""
    case = case_by_id("crisis_distinctive_numbers")
    failed = {r.label for r in score_book(case, drifting_agent_fn(case)).failures}
    assert "picks_in_pool" in failed          # invented asset
    assert "every_pick_cited" in failed       # stripped citations
    assert "citations_verify" in failed       # fabricated citation values
    assert any(f.startswith("prose_number") for f in failed)   # shifted macro figures


def test_picks_in_pool_rejects_a_flipped_direction() -> None:
    """ADR-0038: direction belongs to the asset. Shorting a long-only candidate is
    as much a pool violation as inventing the name."""
    case = case_by_id("long_only_pool")
    book = canned_agent_fn(case)
    book["picks"][0] = {**book["picks"][0], "direction": "short"}
    result = score_check(case, book, PicksInPool())
    assert not result.passed
    assert "outside the pool" in result.detail


def test_max_per_side_rejects_six_longs() -> None:
    case = case_by_id("benign_early_cycle")
    book = canned_agent_fn(case)
    longs = [p for p in book["picks"] if p["direction"] == "long"]
    book["picks"] = book["picks"] + [{**longs[0], "asset": longs[0]["asset"] + "-DUP"}]
    assert not score_check(case, book, MaxPerSide(5)).passed


def test_one_per_complex_rejects_two_gold_miners() -> None:
    """ADR-0048: five gold names are one bet, so taking two is double-counting."""
    case = case_by_id("thin_short_pool")
    book = canned_agent_fn(case)
    gold = next(p for p in book["picks"] if p["asset"] == "GLD")
    book["picks"] = book["picks"] + [{**gold, "asset": "IAU"}]
    result = score_check(case, book, OnePerComplex())
    assert not result.passed
    assert "GLD" in result.detail and "IAU" in result.detail


def test_side_count_bounds_are_enforced_in_both_directions() -> None:
    case = case_by_id("long_only_pool")
    book = canned_agent_fn(case)
    assert score_check(case, book, SideCount(side="short", at_most=0)).passed
    assert not score_check(case, book, SideCount(side="long", at_least=99)).passed
    assert not score_check(case, book, SideCount(side="long", at_most=0)).passed


def test_net_tilt_detects_a_book_leaning_the_wrong_way() -> None:
    case = case_by_id("wide_credit_risk_off")
    book = canned_agent_fn(case)
    assert score_check(case, book, NetTilt(side="short")).passed
    assert not score_check(case, book, NetTilt(side="long")).passed


def test_citations_verify_rejects_a_fabricated_value() -> None:
    """Delegates to the production guardrail, so this also pins that the delegation
    is live — a stubbed-out check would accept this book."""
    case = case_by_id("wide_credit_risk_off")
    book = canned_agent_fn(case)
    book["citations"] = [
        {"source": "BAMLH0A0HYM2", "text": "HY OAS at 4321.0 bps", "value": 4321.0}
    ]
    assert not score_check(case, book, CitationsVerify()).passed


def test_citations_verify_rejects_an_empty_citation_array() -> None:
    case = case_by_id("wide_credit_risk_off")
    book = canned_agent_fn(case)
    book["citations"] = []
    for pick in book["picks"]:
        pick["citations"] = []
    assert not score_check(case, book, CitationsVerify()).passed


def test_citations_verify_rejects_a_miscounted_pool_claim() -> None:
    """The ADR-0049 case: a wrong count stated only in prose, never in a citation."""
    case = case_by_id("wide_credit_risk_off")
    book = canned_agent_fn(case)
    book["book_view"] += " The short pool yields only two independent ideas."
    result = score_check(case, book, CitationsVerify())
    assert not result.passed
    assert "independent ideas" in result.detail


def test_every_pick_cited_accepts_a_top_level_citation_naming_the_asset() -> None:
    """`reason_picks` aggregates per-pick citations upward, so a book that cites only
    at the top level is well-formed and must not be failed on shape alone."""
    case = case_by_id("wide_credit_risk_off")
    book = canned_agent_fn(case)
    assets = [p["asset"] for p in book["picks"]]
    for pick in book["picks"]:
        pick["citations"] = []
    book["citations"] = [
        {"source": "BAMLH0A0HYM2", "text": f"Applies to {', '.join(assets)}", "value": 620.0}
    ]
    assert score_check(case, book, EveryPickCited()).passed


# ─────────────────────────────────────────────────────────────────────────────
# Prose extraction
# ─────────────────────────────────────────────────────────────────────────────

def test_prose_number_extracts_the_figure_a_label_introduces() -> None:
    text = "High yield OAS at 835.0 bps, the 10-year Treasury at 3.18%, VIX at 41.70."
    assert 835.0 in prose_numbers_for(text, "hy_oas")
    assert 3.18 in prose_numbers_for(text, "dgs10")
    assert 41.70 in prose_numbers_for(text, "vix")


def test_prose_number_takes_only_the_first_number_after_each_mention() -> None:
    """So a scenario figure in a later clause is not read as a competing claim about
    the level: 'VIX at 41.70, a spike to 51.70 would...' quotes one level, not two."""
    text = "VIX at 41.70; a spike to 51.70 would cost the book 6.2%."
    assert prose_numbers_for(text, "vix") == [41.70]


def test_prose_number_passes_when_the_metric_is_never_quoted() -> None:
    """Absence is not a failure — the agent owes no particular figure."""
    case = case_by_id("crisis_distinctive_numbers")
    book = canned_agent_fn(case)
    book["book_view"] = "Spreads are wide and the tape is defensive."
    book["picks"] = []
    result = score_check(case, book, ProseNumber(metric="vix", expected=41.70))
    assert result.passed
    assert "not quoted" in result.detail


def test_prose_number_accepts_a_unit_converted_restatement() -> None:
    """835 bps stated as 8.35% is correct finance and must not be flagged."""
    case = case_by_id("crisis_distinctive_numbers")
    book = canned_agent_fn(case)
    book["picks"] = []
    book["book_view"] = "High yield OAS at 8.35%."
    assert score_check(case, book, ProseNumber(metric="hy_oas", expected=835.0)).passed


def test_prose_number_rejects_a_misquoted_level() -> None:
    case = case_by_id("crisis_distinctive_numbers")
    book = canned_agent_fn(case)
    book["picks"] = []
    book["book_view"] = "VIX at 38.20."
    result = score_check(case, book, ProseNumber(metric="vix", expected=41.70))
    assert not result.passed
    assert "38.2" in result.detail


# ─────────────────────────────────────────────────────────────────────────────
# 3. Fixture integrity
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("case_id", CASE_IDS)
def test_candidate_themes_exist_in_the_theme_table(case_id: str) -> None:
    case = case_by_id(case_id)
    known = {t["theme_id"] for t in case.state["theme_scores"]}
    for candidate in case.state["candidates"]:
        assert candidate["theme_id"] in known, (
            f"{case_id}: candidate {candidate['asset']} cites an unknown theme"
        )


@pytest.mark.parametrize("case_id", CASE_IDS)
def test_pool_depth_agrees_with_the_candidate_list(case_id: str) -> None:
    """The POOL DEPTH block is prompt input the agent is told to trust. If it
    disagreed with the candidate table the case would be testing contradiction."""
    case = case_by_id(case_id)
    for side in ("long", "short"):
        depth = case.state["independent_ideas"].get(side) or {}
        actual = [c for c in case.state["candidates"] if c["direction"] == side]
        assert depth.get("names") == len(actual), f"{case_id}/{side}: name count disagrees"

        members = {m for cx in depth.get("complexes", []) for m in cx["members"]}
        assets = {c["asset"] for c in actual}
        assert members <= assets, f"{case_id}/{side}: complex names a non-candidate"
        assert depth["count"] == len(assets - members) + len(depth.get("complexes", [])), (
            f"{case_id}/{side}: independent-idea count disagrees with the complexes"
        )


@pytest.mark.parametrize("case_id", CASE_IDS)
def test_regime_block_agrees_with_the_macro_snapshot(case_id: str) -> None:
    """A fixture whose regime contradicted its own macro inputs would be testing
    the agent's response to inconsistency rather than to a market state."""
    case = case_by_id(case_id)
    macro, regime = case.state["macro_snapshot"], case.state["regime"]
    if "^VIX" in macro:
        assert regime["vix_level"] == pytest.approx(macro["^VIX"]["value"])
    if "BAMLH0A0HYM2" in macro:
        assert regime["hy_oas"] == pytest.approx(macro["BAMLH0A0HYM2"]["value"])
    if "DGS10" in macro and "DGS2" in macro:
        slope_bps = (macro["DGS10"]["value"] - macro["DGS2"]["value"]) * 100
        assert regime["yield_curve_slope"] == pytest.approx(slope_bps, abs=1.0)


# ─────────────────────────────────────────────────────────────────────────────
# Runner behaviour
# ─────────────────────────────────────────────────────────────────────────────

def test_a_raising_agent_is_scored_as_a_failure_not_a_crash() -> None:
    """A provider that dies on case 2 must not discard the results from cases 1, 3-5."""
    def exploding(case: EvalCase) -> dict:
        if case.id == "thin_short_pool":
            raise TimeoutError("provider stalled")
        return canned_agent_fn(case)

    result = run_battery(STANDARD_BATTERY, agent_fn=exploding)
    assert not result.all_passed
    assert result.summary["cases_passed"] == len(STANDARD_BATTERY) - 1
    assert any(f["case"] == "thin_short_pool" for f in result.summary["failures"])


def test_aggregate_reports_per_check_totals() -> None:
    scores = [score_book(c, canned_agent_fn(c)) for c in STANDARD_BATTERY]
    summary = aggregate(scores)
    assert summary["per_check"]["picks_in_pool"]["total"] == len(STANDARD_BATTERY)
    assert summary["per_check"]["citations_verify"]["passed"] == len(STANDARD_BATTERY)
    assert summary["failures"] == []
