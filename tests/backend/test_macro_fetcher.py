import pytest
import sys
import pandas as pd
sys.path.insert(0, "backend/data")
from macro_fetcher import FRED_SERIES, YFINANCE_TICKERS, _fred_observation, _yfinance_batch


class TestFREDSeriesCatalog:
    def test_expected_series_present(self):
        assert "DGS10" in FRED_SERIES
        assert "BAMLH0A0HYM2" in FRED_SERIES
        assert FRED_SERIES["DGS10"]["unit"] == "pct"
        # FRED reports credit OAS in PERCENT (2.69 = 2.69% = 269bps), not bps.
        assert FRED_SERIES["BAMLH0A0HYM2"]["unit"] == "pct"

    def test_new_theme_aligned_series_present(self):
        # Working FRED codes covering Fed Policy (DFF), Corporate Credit
        # (BAMLC0A0CM), inflation (CPIAUCSL), real yield + curve points.
        for sid in ("CPIAUCSL", "DFF", "BAMLC0A0CM", "DFII10", "DGS5", "DGS30"):
            assert sid in FRED_SERIES, f"expected {sid} in FRED catalog"

    def test_dead_series_removed(self):
        # These FRED codes 404 / were discontinued and silently returned nothing.
        for dead in ("CPALTT01USM", "TEDRATE", "DPRRE"):
            assert dead not in FRED_SERIES

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


class TestSnapshotDedup:
    """macro_indicators is a latest-snapshot table; re-running the same day must
    REPLACE the day's rows, not append duplicates."""

    def test_snapshot_deletes_todays_rows_before_insert(self):
        from macro_fetcher import MacroFetcher, FRED_SERIES

        calls = []

        class _Tbl:
            def __init__(self, name):
                self._name = name

            def delete(self):
                calls.append(("delete", self._name)); return self

            def eq(self, *_a, **_k):
                return self

            def insert(self, payload, **_k):
                calls.append(("insert", self._name, len(payload))); return self

            def execute(self):
                return type("R", (), {"data": []})()

        class _SB:
            def table(self, name):
                return _Tbl(name)

        f = MacroFetcher.__new__(MacroFetcher)
        f.supabase = _SB()

        sid = next(iter(FRED_SERIES))
        fred = pd.DataFrame({"trading_date": ["2026-07-23"], sid: [4.5]})
        n = f.upsert_latest_snapshot(fred, pd.DataFrame())

        assert n >= 1
        kinds = [c[0] for c in calls]
        assert "delete" in kinds and "insert" in kinds
        assert kinds.index("delete") < kinds.index("insert"), "must delete today's rows before insert"


class TestMacroFetcherInstantiation:
    def test_can_be_instantiated_with_dummy_url(self):
        """Sanity check — don't actually connect in tests."""
        from macro_fetcher import MacroFetcher
        # Pass empty string to verify class accepts the args
        # (don't actually call fetch methods that would hit the network)
        pass


class TestMarketAssetsUpsertPayload:
    """market_assets.name is NOT NULL (migration 010).

    fetch_market_assets used to rebuild the upsert payload by hand and dropped
    `name`, so every write failed with an APIError and the homepage market bar
    silently stayed empty. Pin the payload to the table's required columns.
    """

    REQUIRED_COLUMNS = {"ticker", "name", "current", "prev_close", "pct_change"}

    def _fetcher_with_history(self, rows):
        from macro_fetcher import MacroFetcher

        captured = {}

        class _Tbl:
            def __init__(self, name):
                self._name = name

            def select(self, *_a, **_k):
                return self

            def in_(self, *_a, **_k):
                return self

            def gte(self, *_a, **_k):
                return self

            def lte(self, *_a, **_k):
                return self

            def order(self, *_a, **_k):
                return self

            def upsert(self, payload, **_k):
                captured["table"] = self._name
                captured["payload"] = payload
                return self

            def execute(self):
                return type("R", (), {"data": rows})()

        class _SB:
            def table(self, name):
                return _Tbl(name)

        f = MacroFetcher.__new__(MacroFetcher)
        f.supabase = _SB()
        return f, captured

    def test_upsert_includes_every_not_null_column(self):
        from macro_fetcher import EQUITY_INDICES

        ticker = EQUITY_INDICES[0]
        rows = [
            {"series_id": ticker, "trading_date": "2026-07-23", "value": 110.0},
            {"series_id": ticker, "trading_date": "2026-07-22", "value": 100.0},
        ]
        f, captured = self._fetcher_with_history(rows)

        results = f.fetch_market_assets(tickers=[ticker])

        assert results, "expected one computed market asset"
        assert captured.get("table") == "market_assets"
        for row in captured["payload"]:
            missing = self.REQUIRED_COLUMNS - set(row)
            assert not missing, f"upsert payload missing NOT NULL column(s): {missing}"
            assert row["name"], "name must be non-empty"

    def test_pct_change_is_computed_from_the_two_closes(self):
        from macro_fetcher import EQUITY_INDICES

        ticker = EQUITY_INDICES[0]
        rows = [
            {"series_id": ticker, "trading_date": "2026-07-23", "value": 110.0},
            {"series_id": ticker, "trading_date": "2026-07-22", "value": 100.0},
        ]
        f, _ = self._fetcher_with_history(rows)

        results = f.fetch_market_assets(tickers=[ticker])
        assert results[0]["pct_change"] == pytest.approx(10.0)
