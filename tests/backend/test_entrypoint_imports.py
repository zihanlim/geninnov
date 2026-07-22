"""Entry-point scripts must import cleanly in a bare interpreter.

The rest of the suite imports `backend.*` with the repo root already on
sys.path (see the repo-root conftest.py). That masks import errors that only
appear when a script bootstraps its own path, which is how the scheduled job
actually runs.

A real outage came from exactly this gap: scripts/daily_refresh.py put
backend/ on sys.path, so `backend` itself was unimportable, and modules inside
backend/ that import each other absolutely (`from backend.services...`) blew up
with ModuleNotFoundError at import time. Every unit test still passed.

These tests run each entry point in a subprocess with a clean sys.path so the
script's own bootstrapping is what gets exercised.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

ENTRYPOINTS = [
    "scripts/daily_refresh.py",
    "scripts/theme_discovery.py",
]


def _import_only(script: Path) -> subprocess.CompletedProcess:
    """Import the script without executing its __main__ block."""
    code = (
        "import importlib.util, sys\n"
        f"spec = importlib.util.spec_from_file_location('_entrypoint', r'{script}')\n"
        "mod = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(mod)\n"
    )
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=180,
    )


@pytest.mark.parametrize("relpath", ENTRYPOINTS)
def test_entrypoint_imports_without_module_not_found(relpath: str):
    script = REPO_ROOT / relpath
    if not script.exists():
        pytest.skip(f"{relpath} not present")

    result = _import_only(script)
    stderr = result.stderr

    # A missing third-party package or absent env var is an environment
    # problem, not the wiring defect this test guards. ModuleNotFoundError for
    # a first-party package ('backend', 'services', 'data', 'tools') is the bug.
    for pkg in ("backend", "services", "data", "tools", "derivations"):
        assert f"No module named '{pkg}'" not in stderr, (
            f"{relpath} cannot resolve first-party package '{pkg}' when run as a "
            f"script. Its sys.path bootstrapping is wrong.\n\n{stderr}"
        )
