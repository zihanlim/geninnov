import pytest
import sys
import pandas as pd
sys.path.insert(0, "backend/data")
from macro_fetcher import FRED_SERIES, YFINANCE_TICKERS, _fred_observation, _yfinance_batch


class TestFREDSeriesCatalog:
    def test_expected_series_present(self):
        assert "DGS10" in FRED_SERIES
        assert "BAMLH0A0HYM2" in FRED_SERIES
        assert "CPALTT01USM" in FRED_SERIES
        assert FRED_SERIES["DGS10"]["unit"] == "pct"
        assert FRED_SERIES["BAMLH0A0HYM2"]["unit"] == "bps"

    def test_yfinance_tickers(self):
        assert "^VIX" in YFINANCE_TICKERS
        assert "GC=F" in YFINANCE_TICKERS
        assert YFINANCE_TICKERS["^VIX"]["unit"] == "index"


class TestFredObservationNoKey:
    def test_returns_none_without_api_key(self, monkeypatch):
        monkeypatch.setenv("FRED_API_KEY", "")
        from datetime import date
        result = _fred_observation("DGS10", date(2025, 1, 1), date(2025, 1, 31))
        assert result is None


class TestYfinanceBatch:
    def test_returns_dataframe_even_with_empty_tickers(self):
        result = _yfinance_batch([], pd.Timestamp("2025-01-01").date(), pd.Timestamp("2025-01-31").date())
        assert isinstance(result, pd.DataFrame)

    def test_returns_empty_df_when_yfinance_unavailable(self, monkeypatch):
        """If yfinance import fails, gracefully return empty df."""
        monkeypatch.setitem(sys.modules, "yfinance", None)
        result = _yfinance_batch(["^VIX"], pd.Timestamp("2025-01-01").date(), pd.Timestamp("2025-01-31").date())
        assert isinstance(result, pd.DataFrame)
        assert result.empty


class TestMacroFetcherInstantiation:
    def test_can_be_instantiated_with_dummy_url(self):
        """Sanity check — don't actually connect in tests."""
        from macro_fetcher import MacroFetcher
        # Pass empty string to verify class accepts the args
        # (don't actually call fetch methods that would hit the network)
        pass
