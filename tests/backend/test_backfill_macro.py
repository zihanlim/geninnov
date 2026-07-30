"""Backfill macro_daily_history to ~3 years for the credit/rates legs."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts import backfill_macro  # noqa: E402


def test_parse_args_default_is_dry_run():
    args = backfill_macro._parse_args([])
    assert args.apply is False
    assert args.overwrite is False
    assert args.lo is None and args.hi is None


def test_parse_args_accepts_apply_and_overwrite():
    args = backfill_macro._parse_args(["--apply", "--overwrite", "--from", "2024-01-01"])
    assert args.apply is True
    assert args.overwrite is True
    assert args.lo == date(2024, 1, 1)


def test_default_series_are_the_three_required_for_credit_rates_exposures():
    """DGS10 / BAMLC0A0CM / BAMLH0A0HYM2 — the legs build_credit_legs requires."""
    assert set(backfill_macro.DEFAULT_SERIES) == {"DGS10", "BAMLC0A0CM", "BAMLH0A0HYM2"}


def test_main_returns_one_when_supabase_env_missing(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    assert backfill_macro.main([]) == 1
