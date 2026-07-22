from datetime import date

from backend.services.pipeline_runs import run_id_for


def test_run_id_is_deterministic():
    a = run_id_for(date(2026, 1, 16), stage="l5")
    b = run_id_for(date(2026, 1, 16), stage="l5")
    assert a == b


def test_run_id_differs_by_stage():
    a = run_id_for(date(2026, 1, 16), stage="l5")
    b = run_id_for(date(2026, 1, 16), stage="l4")
    assert a != b
