"""Backfill macro_daily_history to ~3 years for the credit/rates legs."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from datetime import date  # noqa: E402
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


class TestSeriesScoping:
    """`--series` must actually scope what gets written.

    `fetch_fred_batch()` returns the whole 12-series FRED catalog in one wide
    frame no matter what was requested, and `persist_daily_history` writes
    every column handed to it. Without narrowing, `--series DGS10` writes
    twelve series -- a backfill doing more than its own flag says.
    """

    def _wide(self):
        import pandas as pd
        from datetime import date
        return pd.DataFrame({
            "trading_date": [date(2026, 1, 5), date(2026, 1, 6)],
            "DGS10": [4.30, 4.35],
            "BAMLC0A0CM": [1.50, 1.52],
            "BAMLH0A0HYM2": [3.20, 3.25],
            "UNRATE": [4.1, 4.1],
            "CPIAUCSL": [310.0, 310.5],
        })

    def test_only_requested_columns_survive(self):
        df, missing = backfill_macro.keep_requested_series(self._wide(), ("DGS10",))
        assert list(df.columns) == ["trading_date", "DGS10"]
        assert missing == []

    def test_the_three_credit_rates_series_are_kept_together(self):
        df, missing = backfill_macro.keep_requested_series(
            self._wide(), backfill_macro.DEFAULT_SERIES)
        assert set(df.columns) == {"trading_date", "DGS10", "BAMLC0A0CM", "BAMLH0A0HYM2"}
        assert "UNRATE" not in df.columns
        assert missing == []

    def test_a_series_fred_did_not_return_is_reported_not_dropped_silently(self):
        df, missing = backfill_macro.keep_requested_series(
            self._wide(), ("DGS10", "NOTAREALSERIES"))
        assert list(df.columns) == ["trading_date", "DGS10"]
        assert missing == ["NOTAREALSERIES"], "a requested series with no data must be reported"


class TestOverwriteGuard:
    """Without `--overwrite`, an already-published (series, date) must be left
    exactly as it is. The existing rows are the PUBLISHED record produced by
    live runs; a backfill that quietly restates them is the failure
    `backfill_regime.py`'s identical guard exists to prevent.
    """

    def _frame(self):
        import pandas as pd
        from datetime import date
        return pd.DataFrame({
            "trading_date": [date(2026, 1, 5), date(2026, 1, 6), date(2026, 1, 7)],
            "DGS10": [4.30, 4.35, 4.40],
            "BAMLC0A0CM": [1.50, 1.52, 1.55],
        })

    def test_published_dates_are_nulled_so_persist_skips_them(self):
        import pandas as pd
        from datetime import date
        existing = {"DGS10": {date(2026, 1, 5), date(2026, 1, 6)}}
        out = backfill_macro.mask_already_published(
            self._frame(), ("DGS10", "BAMLC0A0CM"), existing)
        # The two published DGS10 cells are gone; the new one survives.
        assert pd.isna(out.loc[0, "DGS10"])
        assert pd.isna(out.loc[1, "DGS10"])
        assert out.loc[2, "DGS10"] == 4.40

    def test_a_series_with_no_published_rows_is_untouched(self):
        existing = {"DGS10": {date(2026, 1, 5)}}
        out = backfill_macro.mask_already_published(
            self._frame(), ("DGS10", "BAMLC0A0CM"), existing)
        # BAMLC0A0CM had no existing rows, so every value must remain.
        assert list(out["BAMLC0A0CM"]) == [1.50, 1.52, 1.55]

    def test_the_input_frame_is_not_mutated(self):
        """The caller may still need the unmasked frame; masking returns a copy."""
        from datetime import date
        original = self._frame()
        backfill_macro.mask_already_published(
            original, ("DGS10",), {"DGS10": {date(2026, 1, 5)}})
        assert original.loc[0, "DGS10"] == 4.30, "mask_already_published mutated its argument"
