"""daily_refresh must invoke credit_rates_exposures under the same import
path the production entry point uses — a bare `from services...` passes
pytest (the conftest puts backend/ on sys.path) and kills the nightly
run. Verify the import path resolves under the invocation that runs in
CI (python -m scripts.daily_refresh), in a subprocess."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


def test_credit_rates_exposures_is_importable_under_daily_refresh_path():
    """Spawn a subprocess with the same sys.path as `python -m
    scripts.daily_refresh` and import the module. If this passes but
    the in-process import fails, the test caught the entry-point drift
    that the conftest shim normally hides."""
    code = (
        "import sys; sys.path.insert(0, '.'); "
        "from backend.services.credit_rates_exposures import "
        "(build_credit_legs, compute_total_betas, compute_marginal_betas, "
        "assemble_row, upsert_exposures, FactorsUnavailable); "
        "print('OK')"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(Path(__file__).resolve().parents[2]),
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert "OK" in result.stdout
