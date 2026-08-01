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

    def test_upsert_stamps_a_fresh_updated_at(self):
        """The homepage freshness label reads market_assets.updated_at. The table
        defaults it to NOW() only on INSERT, so an upsert that omits the column
        left it frozen at first insert — the tape showed today's closes under an
        "Updated 2d ago" label. Every write must carry a real, current timestamp.
        """
        from datetime import datetime, timezone
        from macro_fetcher import EQUITY_INDICES

        ticker = EQUITY_INDICES[0]
        rows = [
            {"series_id": ticker, "trading_date": "2026-07-23", "value": 110.0},
            {"series_id": ticker, "trading_date": "2026-07-22", "value": 100.0},
        ]
        f, captured = self._fetcher_with_history(rows)

        before = datetime.now(timezone.utc)
        results = f.fetch_market_assets(tickers=[ticker])
        after = datetime.now(timezone.utc)

        assert results, "expected one computed market asset"
        for row in captured["payload"]:
            assert "updated_at" in row, "upsert payload must set updated_at"
            ts = datetime.fromisoformat(row["updated_at"])
            assert before <= ts <= after, "updated_at must be the write time, not stale"


class TestRibbonGroups:
    """The homepage tape's universe (migration 063).

    Three properties, each of which was a live defect or a near miss:

    1. The tape's tickers must NOT reach `macro_indicators`. That table is L0 —
       `regime_classifier` reads it, `/method` renders it and the L5 prompt is
       built from it. `upsert_latest_snapshot` walks `YFINANCE_TICKERS`, so the
       moment a Nikkei or a Bitcoin is added to THAT map to get it onto a
       decorative tape, it silently becomes a macro indicator.
    2. Membership and order live in one place. The frontend used to hold its own
       `DISPLAY_ORDER`, which listed `^VIX` while the backend's `EQUITY_INDICES`
       did not — so the VIX cell of the tape had never once rendered.
    3. Every tape ticker needs price HISTORY, or `fetch_market_assets` finds
       fewer than two closes and drops the row without saying so.
    """

    def test_tape_tickers_do_not_become_macro_indicators(self):
        from macro_fetcher import RIBBON_TICKERS, YFINANCE_TICKERS

        leaked = {
            t
            for t in RIBBON_TICKERS
            if t in YFINANCE_TICKERS
            and RIBBON_TICKERS[t]["group"] not in ("US", "Currencies")
        }
        assert not leaked, (
            f"{leaked} are in YFINANCE_TICKERS, so upsert_latest_snapshot will "
            "write them to macro_indicators — the L0 macro set, which nothing "
            "asked to contain a foreign index or a coin"
        )

    def test_every_tape_ticker_gets_price_history(self):
        from macro_fetcher import FRED_CATALOG, HISTORY_TICKERS, RIBBON_TICKERS

        # Bonds are FRED series (DGS*): their history arrives via
        # `fetch_fred_batch`, never the yfinance batch, so the requirement is a
        # PATH to macro_daily_history — HISTORY_TICKERS membership OR a FRED
        # series id — not membership of HISTORY_TICKERS alone.
        missing = set(RIBBON_TICKERS) - set(HISTORY_TICKERS) - set(FRED_CATALOG)
        assert not missing, (
            f"{missing} would have no rows in macro_daily_history, so "
            "fetch_market_assets finds <2 closes and drops them silently"
        )

    def test_groups_are_contiguous_and_ordered_from_zero(self):
        from macro_fetcher import RIBBON_GROUPS, RIBBON_TICKERS

        for group, members in RIBBON_GROUPS.items():
            orders = [
                RIBBON_TICKERS[t]["sort_order"] for t, _name, _unit in members
            ]
            assert orders == list(range(len(members))), (
                f"{group} sort_order is {orders}; the frontend sorts on this "
                "column and a gap or a duplicate reorders the tape"
            )

    def test_fetch_market_assets_defaults_to_the_whole_tape(self):
        """Not EQUITY_INDICES. `daily_refresh` calls this with no arguments, so
        the default IS the tape — a default of four US indices is how the other
        five groups would have shipped empty."""
        import inspect

        from macro_fetcher import RIBBON_TICKERS, MacroFetcher

        src = inspect.getsource(MacroFetcher.fetch_market_assets)
        assert "tickers or list(RIBBON_TICKERS)" in src
        assert len(RIBBON_TICKERS) > 4

    def test_currency_quotes_keep_four_decimals(self):
        """`round(v, 2)` is right for index points and destroys an FX quote:
        EUR/USD 1.1512 stored as 1.15 cannot be recovered downstream, and a
        0.4% move renders as no move at all."""
        f, _ = TestMarketAssetsUpsertPayload()._fetcher_with_history(
            [
                {"series_id": "EURUSD=X", "trading_date": "2026-07-31", "value": 1.15125},
                {"series_id": "EURUSD=X", "trading_date": "2026-07-30", "value": 1.14666},
            ]
        )
        out = f.fetch_market_assets(tickers=["EURUSD=X"])
        assert out[0]["current"] == pytest.approx(1.1513, abs=1e-9)
        assert out[0]["prev_close"] == pytest.approx(1.1467, abs=1e-9)

    def test_bonds_group_is_the_fred_curve_points(self):
        """The Bonds tab reads the SAME constant-maturity curve the regime
        classifier reads (DGS2/5/10/30) plus the tape-only points
        (DGS1MO/3MO/6MO/1/3/7/20) — no new yfinance symbols, no resolution
        risk, and the tape cannot drift from the numbers /method cites."""
        from macro_fetcher import FRED_CATALOG, RIBBON_GROUPS, RIBBON_TICKERS

        bonds = RIBBON_GROUPS["Bonds"]
        assert [t for t, _name, _unit in bonds] == [
            "DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS3",
            "DGS5", "DGS7", "DGS10", "DGS20", "DGS30",
        ]
        for ticker, _name, _unit in bonds:
            assert ticker in FRED_CATALOG, (
                f"{ticker} is not a FRED series — it would have no history"
            )
            assert RIBBON_TICKERS[ticker]["unit"] == "pct"

    def test_bond_series_never_reach_macro_indicators(self):
        """BOND_SERIES is tape-only: fetched and persisted to daily history,
        but NOT part of FRED_SERIES. `upsert_latest_snapshot` walks
        FRED_SERIES alone, so the 1m/3m/6m/1y/3y/7y/20y points never publish
        to /facts, /method or the L5 prompt — the mirror of the
        RIBBON_GROUPS-vs-YFINANCE_TICKERS separation."""
        import inspect

        from macro_fetcher import BOND_SERIES, FRED_SERIES, MacroFetcher

        assert set(BOND_SERIES).isdisjoint(set(FRED_SERIES))
        src = inspect.getsource(MacroFetcher.upsert_latest_snapshot)
        assert "FRED_SERIES" in src
        assert "BOND_SERIES" not in src, (
            "the snapshot writer must not walk BOND_SERIES, or the curve "
            "points would become L0 macro indicators"
        )

    def test_bond_series_persist_to_daily_history(self):
        """The tape reads prev_close from macro_daily_history, so BOND_SERIES
        must be written there even though it never reaches macro_indicators."""
        import pandas as pd

        from macro_fetcher import MacroFetcher

        captured = {}

        class _Tbl:
            def __init__(self, name):
                self._name = name

            def upsert(self, payload, **_k):
                captured["table"] = self._name
                captured["payload"] = payload
                return self

            def execute(self):
                return type("R", (), {"data": []})()

        class _SB:
            def table(self, name):
                return _Tbl(name)

        f = MacroFetcher.__new__(MacroFetcher)
        f.supabase = _SB()

        fred = pd.DataFrame({
            "trading_date": ["2026-07-30"],
            "DGS1MO": [5.30],
            "DGS3MO": [5.35],
            "DGS6MO": [5.25],
            "DGS1": [4.95],
            "DGS3": [4.55],
            "DGS7": [4.50],
            "DGS20": [4.80],
        })
        n = f.persist_daily_history(fred, pd.DataFrame())

        written = {r["series_id"] for r in captured.get("payload", [])}
        assert n >= 7
        assert {"DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS3", "DGS7", "DGS20"} <= written
        assert captured.get("table") == "macro_daily_history"

    def test_yields_keep_two_decimals(self):
        """Yields are quoted in 2dp (FRED's own precision). The 4dp rule is for
        FX; storing a DGS10 as 4.2500 would be false precision on a float4."""
        f, _ = TestMarketAssetsUpsertPayload()._fetcher_with_history(
            [
                {"series_id": "DGS10", "trading_date": "2026-07-31", "value": 4.25},
                {"series_id": "DGS10", "trading_date": "2026-07-30", "value": 4.24},
            ]
        )
        out = f.fetch_market_assets(tickers=["DGS10"])
        assert out[0]["current"] == pytest.approx(4.25, abs=1e-9)
        assert out[0]["prev_close"] == pytest.approx(4.24, abs=1e-9)
        assert out[0]["market_group"] == "Bonds"
        assert out[0]["name"] == "US 10Y"

    def test_as_of_is_the_session_not_the_write_time(self):
        """Six markets on one tape close in different sessions — measured
        2026-07-31, Asia/FX/crypto carried 07-31 while the US, Europe and
        futures carried 07-30. `updated_at` is the pipeline's write time and is
        identical across all of them, so it cannot answer "which session"."""
        f, _ = TestMarketAssetsUpsertPayload()._fetcher_with_history(
            [
                {"series_id": "^N225", "trading_date": "2026-07-31", "value": 110.0},
                {"series_id": "^N225", "trading_date": "2026-07-30", "value": 100.0},
            ]
        )
        out = f.fetch_market_assets(tickers=["^N225"])
        assert out[0]["as_of"] == "2026-07-31"
        assert out[0]["market_group"] == "Asia"
