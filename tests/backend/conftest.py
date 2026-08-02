"""Shared pytest fixtures for the Andromeda backend test suite.

The fixtures here are deliberately small and self-contained so individual
test files can import them without dragging in a Supabase client, network
calls, or any of the L0-L5 pipeline machinery. Tests that need pipeline
state should build it in their own module rather than reaching for
shared fixtures.

Note: this directory intentionally has NO `__init__.py`. Existing test
modules use `sys.path.insert(...)` to import `backend.*` and depend on
the rootdir-based path resolution set up by the repo-root `conftest.py`.
An `__init__.py` here would re-root the test package and break those
imports.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest


@pytest.fixture
def fixed_run_date() -> date:
    """A deterministic run date used by tests that need a calendar anchor."""
    return date(2026, 1, 15)


@pytest.fixture
def fixed_now() -> datetime:
    """A deterministic UTC timestamp for freshness and as_of assertions."""
    return datetime(2026, 1, 16, 16, 30, tzinfo=timezone.utc)


# ── regime_classifier / FOMC_MEETINGS fixtures ──────────────────────────────

@pytest.fixture(autouse=True)
def _fomc_testing_mode():
    """Disable FOMC network/disk I/O for all regime tests.

    ADR-0141 tests inject fixtures directly into `FOMC_MEETINGS` (the
    module-level dict in regime_classifier) and rely on it staying put.
    Without this fixture, a prior production run's disk cache would
    repopulate `FOMC_MEETINGS` between tests, causing fixture-injection
    tests to see stale cached meetings instead of their injected data.

    The fixture sets `regime_classifier._FOM_TESTING = True`, which makes
    `_latest_meeting_on_or_before()` skip the fetch/disk-cache read entirely.
    Individual tests inject their fixtures by directly mutating FOMC_MEETINGS
    and clean up with `.pop()` in their own try/finally blocks.
    """
    import sys
    import os
    # Dynamically add backend/ to sys.path so we can import regime_classifier
    backend_path = os.path.join(os.path.dirname(__file__), "..", "backend")
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)

    import regime_classifier

    # Save prior state (only _FOM_TESTING is restored; FOMC_MEETINGS is left
    # cleared so tests that inject fixtures start from a clean slate).
    saved_testing = regime_classifier._FOM_TESTING
    regime_classifier._FOM_TESTING = True

    yield

    regime_classifier._FOM_TESTING = saved_testing
    # Do NOT restore FOMC_MEETINGS: each test manages its own injection/cleanup.


@pytest.fixture
def make_book():
    """Build a synthetic long/short book for portfolio math tests.

    Returns a callable that takes a mapping of ticker -> signed weight and
    a mapping of ticker -> current price. Yesterday's price is derived
    from today's price as ``price_today / (1 + 0.01)``, giving each
    position a baseline +1% return so that the signed-weights math is
    easy to reason about in tests.
    """
    def _make(weights: dict[str, float], prices: dict[str, float]) -> list[dict]:
        return [
            {
                "ticker": t,
                "weight": w,
                "price_today": prices[t],
                "price_yesterday": prices[t] / 1.01,
            }
            for t, w in weights.items()
        ]
    return _make
