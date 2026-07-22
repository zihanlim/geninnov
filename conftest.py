"""Repo-root conftest: ensure the project root is on sys.path so test
modules can write `from backend.X import Y` regardless of how pytest
is invoked (CI, IDE, etc.)."""
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
