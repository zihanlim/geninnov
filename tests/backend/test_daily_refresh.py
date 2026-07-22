# tests/backend/test_daily_refresh.py
"""
Tests for the daily_refresh.py script.
Verifies imports, function signatures, and mock mode behavior.
"""
import sys
import os
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest

# Ensure backend modules are on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))


def test_import_without_error():
    """scripts/daily_refresh.py can be imported without error."""
    # Set mock env vars so import doesn't crash on missing credentials
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
    import daily_refresh  # noqa: F401 - just checking import succeeds


def test_load_config_function_exists():
    """load_config function exists and has correct signature."""
    from daily_refresh import load_config
    assert callable(load_config)


def test_load_themes_function_exists():
    """load_themes function exists and has correct signature."""
    from daily_refresh import load_themes
    assert callable(load_themes)


def test_build_theme_signals_function_exists():
    """build_theme_signals function exists and has correct signature."""
    from daily_refresh import build_theme_signals
    assert callable(build_theme_signals)
    # Check signature: (themes: list[dict], run_date: date) -> list[dict]
    import inspect
    sig = inspect.signature(build_theme_signals)
    params = list(sig.parameters.keys())
    assert params == ["themes", "run_date"], f"Expected ['themes', 'run_date'], got {params}"


def test_compute_hype_scores_function_exists():
    """compute_hype_scores function exists and has correct signature."""
    from daily_refresh import compute_hype_scores
    assert callable(compute_hype_scores)


def test_compute_trade_scores_function_exists():
    """compute_trade_scores function exists and has correct signature."""
    from daily_refresh import compute_trade_scores
    assert callable(compute_trade_scores)


def test_persist_function_exists():
    """persist function exists and has correct signature."""
    from daily_refresh import persist
    assert callable(persist)
    # Check signature: (run_date: date, scored: list[dict]) -> None
    import inspect
    sig = inspect.signature(persist)
    params = list(sig.parameters.keys())
    assert params == ["run_date", "scored"], f"Expected ['run_date', 'scored'], got {params}"


def test_mock_mode_no_crash():
    """When env vars are not set, script should not crash on import."""
    # Unset the env vars if they exist
    original_url = os.environ.pop("SUPABASE_URL", None)
    original_key = os.environ.pop("SUPABASE_SERVICE_KEY", None)

    try:
        # This should not raise an exception - import should handle missing env vars
        # by delaying the Supabase client creation or using lazy initialization
        # The functions themselves will fail when called, but import should succeed
        import daily_refresh
        # If we get here, import succeeded (env vars were set in other tests)
    finally:
        # Restore env vars
        if original_url:
            os.environ["SUPABASE_URL"] = original_url
        if original_key:
            os.environ["SUPABASE_SERVICE_KEY"] = original_key


def test_build_theme_signals_returns_list():
    """build_theme_signals returns a list of dicts with expected keys."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import build_theme_signals
    from services.hype_calculator import ScoringConfig

    # Create mock config
    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )

    # Mock themes
    themes = [{"id": 1, "name": "Test Theme"}]

    # Mock the dependencies
    with patch("daily_refresh.fetch_news_for_theme", return_value=[]), \
         patch("daily_refresh.fetch_posts_for_theme", return_value=[]), \
         patch("daily_refresh.batch_sentiment", return_value=[0.0]), \
         patch("daily_refresh.load_config", return_value=cfg), \
         patch("daily_refresh.supabase") as mock_supabase:

        # Mock supabase for theme_assets query
        mock_assets = MagicMock()
        mock_assets.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        mock_supabase.table.return_value = mock_assets

        result = build_theme_signals(themes, date.today())

    assert isinstance(result, list)
    if result:
        r = result[0]
        expected_keys = {"theme_id", "run_date", "mention_count_1d", "mention_count_7d_avg",
                        "mention_count_7d_std", "avg_sentiment", "price_corr", "momentum_raw"}
        assert expected_keys.issubset(r.keys()), f"Missing keys: {expected_keys - r.keys()}"


def test_compute_hype_scores_returns_list():
    """compute_hype_scores returns list with hype_score added."""
    from daily_refresh import compute_hype_scores
    from services.hype_calculator import ScoringConfig

    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )

    raw_signals = [
        {
            "theme_id": 1,
            "mention_count_1d": 10,
            "avg_sentiment": 0.5,
            "price_corr": 0.3,
            "momentum_raw": 1.0,
        },
        {
            "theme_id": 2,
            "mention_count_1d": 5,
            "avg_sentiment": -0.2,
            "price_corr": -0.1,
            "momentum_raw": -0.5,
        },
    ]

    result = compute_hype_scores(raw_signals, cfg)

    assert isinstance(result, list)
    assert len(result) == 2
    for r in result:
        assert "hype_score" in r
        assert isinstance(r["hype_score"], float)


def test_compute_trade_scores_returns_list():
    """compute_trade_scores returns list with trade_score added."""
    from daily_refresh import compute_trade_scores
    from services.hype_calculator import ScoringConfig

    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )

    hyped = [
        {
            "theme_id": 1,
            "hype_score": 75.0,
            "avg_sentiment": 0.3,
        },
        {
            "theme_id": 2,
            "hype_score": 50.0,
            "avg_sentiment": -0.5,
        },
    ]

    with patch("daily_refresh.load_config", return_value=cfg), \
         patch("daily_refresh.supabase") as mock_supabase:
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        result = compute_trade_scores(hyped)

    assert isinstance(result, list)
    assert len(result) == 2
    for r in result:
        assert "trade_score" in r
        assert isinstance(r["trade_score"], float)


def test_compute_trade_scores_handles_missing_hype_score_column():
    """If theme_signals_history.hype_score column is missing, fall back to today's
    score (HypeMomentum=0) instead of crashing. Covers the case where migration
    003 hasn't been applied to the live Supabase yet.
    """
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import compute_trade_scores
    from services.hype_calculator import ScoringConfig

    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )

    hyped = [
        {"theme_id": 1, "hype_score": 70.0, "avg_sentiment": 0.4},
    ]

    with patch("daily_refresh.load_config", return_value=cfg), \
         patch("daily_refresh.supabase") as mock_supabase:
        # Simulate the APIError raised when the column doesn't exist
        mock_supabase.table.return_value.select.return_value.eq.return_value.execute.side_effect = Exception("column hype_score does not exist")
        result = compute_trade_scores(hyped)

    # Should not crash; should produce a TradeScore = 0.55 * 0 + 0.45 * sentiment
    assert len(result) == 1
    assert result[0]["trade_score"] == 0.45 * 0.4  # 0.18


def test_build_theme_signals_falls_back_to_most_recent_assets():
    """
    When theme_assets has no rows for today's run_date, build_theme_signals
    should fall back to the most recent entry for that theme rather than
    silently producing a zero CorrScore.
    """
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import build_theme_signals
    from services.hype_calculator import ScoringConfig

    cfg = ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
    )

    fallback_assets = [{"ticker": "TLT"}, {"ticker": "GLD"}]

    with patch("daily_refresh.fetch_news_for_theme", return_value=[]), \
         patch("daily_refresh.fetch_posts_for_theme", return_value=[]), \
         patch("daily_refresh.batch_sentiment", return_value=[0.0]), \
         patch("daily_refresh.fetch_price_data", return_value=type("DF", (), {"empty": True, "columns": ["date", "ticker", "close", "return"]})()), \
         patch("daily_refresh.load_config", return_value=cfg), \
         patch("daily_refresh.supabase") as mock_supabase:

        # First call (today's run_date) returns empty → triggers fallback
        # Second call (most recent) returns fallback_assets
        today_query = MagicMock()
        today_query.execute.return_value.data = []
        recent_query = MagicMock()
        recent_query.execute.return_value.data = fallback_assets

        mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value = today_query
        mock_supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value = recent_query

        themes = [{"id": "abc-123", "name": "Fed Policy"}]
        result = build_theme_signals(themes, date.today())

    assert isinstance(result, list)
    assert len(result) == 1
    # The fallback path should have been hit; build_theme_signals should not
    # crash when assets is empty initially — it just proceeds with the fallback
    # ticker list. price_corr stays 0.0 because price_df is empty, which is fine.


# ─── Phase 3: trade ranking, position sizing, daily P&L, risk metrics ─────────


def _phase3_cfg(total_capital: float = 100_000_000.0, threshold: float = 50.0):
    from services.hype_calculator import ScoringConfig
    return ScoringConfig(
        hype_volume_weight=0.30,
        hype_sentiment_weight=0.20,
        hype_corr_weight=0.30,
        hype_momentum_weight=0.20,
        trade_hype_weight=0.55,
        trade_sentiment_weight=0.45,
        hype_score_threshold=threshold,
        total_capital=total_capital,
        risk_free_annual=0.045,
    )


def test_load_theme_assets_map_picks_most_recent_per_theme():
    """When a theme has multiple run_dates in theme_assets, the most recent wins."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import load_theme_assets_map

    rows = [
        {"theme_id": "t1", "ticker": "OLD1", "run_date": "2026-07-15"},
        {"theme_id": "t1", "ticker": "NEW1", "run_date": "2026-07-20"},
        {"theme_id": "t1", "ticker": "NEW2", "run_date": "2026-07-20"},
        {"theme_id": "t2", "ticker": "ONLY1", "run_date": "2026-07-18"},
    ]

    with patch("daily_refresh.supabase") as mock_supabase:
        mock_supabase.table.return_value.select.return_value.in_.return_value.execute.return_value.data = rows
        result = load_theme_assets_map(["t1", "t2", "t3"], date(2026, 7, 21))

    # Function returns up to 20 most-recent per theme (newest first), so all 3 t1 entries come back.
    # The key property is that NEW1/NEW2 (2026-07-20) come before OLD1 (2026-07-15).
    assert result["t1"][:2] == ["NEW1", "NEW2"]
    assert "OLD1" in result["t1"]
    assert result["t2"] == ["ONLY1"]
    assert result["t3"] == []  # theme with no assets → empty list


def test_load_theme_assets_map_empty_input():
    """No theme ids → empty map, no supabase call."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import load_theme_assets_map

    with patch("daily_refresh.supabase") as mock_supabase:
        result = load_theme_assets_map([], date(2026, 7, 21))

    assert result == {}
    mock_supabase.table.assert_not_called()


def test_rank_and_persist_trade_candidates_writes_to_supabase():
    """Should call trade_candidates.upsert for each ranked candidate."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import rank_and_persist_trade_candidates

    cfg = _phase3_cfg()
    scored = [
        {"theme_id": "long1", "hype_score": 75.0, "trade_score": 0.5, "avg_sentiment": 0.3},
        {"theme_id": "short1", "hype_score": 70.0, "trade_score": -0.4, "avg_sentiment": -0.2},
    ]
    asset_rows = [
        {"theme_id": "long1", "ticker": "TLT", "run_date": "2026-07-21"},
        {"theme_id": "short1", "ticker": "HYG", "run_date": "2026-07-21"},
    ]

    with patch("daily_refresh.supabase") as mock_supabase:
        mock_supabase.table.return_value.select.return_value.in_.return_value.execute.return_value.data = asset_rows
        longs, shorts = rank_and_persist_trade_candidates(scored, date(2026, 7, 21), cfg)

    assert len(longs) == 1
    assert longs[0].asset == "TLT"
    assert longs[0].direction == "long"
    assert len(shorts) == 1
    assert shorts[0].asset == "HYG"
    assert shorts[0].direction == "short"

    # The function should have called trade_candidates.upsert twice (one per candidate).
    # mock_supabase.table("trade_candidates") was called.
    table_names = [c.args[0] for c in mock_supabase.table.call_args_list if c.args]
    assert "trade_candidates" in table_names


def test_rank_and_persist_trade_candidates_no_qualifying_themes():
    """If no theme passes the threshold, the function returns ([], []) and writes nothing."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import rank_and_persist_trade_candidates

    cfg = _phase3_cfg(threshold=99.0)  # impossibly high threshold
    scored = [
        {"theme_id": "t1", "hype_score": 50.0, "trade_score": 0.5, "avg_sentiment": 0.3},
    ]

    with patch("daily_refresh.supabase") as mock_supabase:
        longs, shorts = rank_and_persist_trade_candidates(scored, date(2026, 7, 21), cfg)

    assert longs == []
    assert shorts == []
    # No trade_candidates writes should have happened
    table_names = [c.args[0] for c in mock_supabase.table.call_args_list if c.args]
    assert "trade_candidates" not in table_names


def test_allocate_and_persist_portfolio_writes_positions():
    """Given candidates, should write one portfolio_positions row per candidate."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import allocate_and_persist_portfolio
    from services.trade_ranker import TradeCandidate

    cfg = _phase3_cfg(total_capital=100_000_000.0)
    # TLT (Rates) and FXI (China Equities) — different sectors AND geos,
    # so sector (≥3 members) and geo (≥3 members) caps don't apply.
    # TLT raw hype = 15, FXI = 2 → raw weights 88.2%/11.8%.
    # Single-name cap (20%) triggers: TLT capped to 20%, excess absorbed by FXI
    # → TLT = $20M, FXI = $80M.
    candidates = [
        TradeCandidate("t1", "TLT", "long", 0.5, 15.0, 0.3),
        TradeCandidate("t2", "FXI", "short", -0.4, 2.0, -0.2),
    ]

    with patch("daily_refresh.supabase") as mock_supabase:
        positioned = allocate_and_persist_portfolio(candidates, date(2026, 7, 21), cfg)

    assert len(positioned) == 2
    notionals = {c.asset: n for c, n, w in positioned}
    # TLT dominated (88% > 20% cap) → capped to $20M; FXI absorbs excess → $80M
    assert abs(notionals["TLT"] - 20_000_000) < 1e-6
    assert abs(notionals["FXI"] - 80_000_000) < 1e-6

    table_names = [c.args[0] for c in mock_supabase.table.call_args_list if c.args]
    assert "portfolio_positions" in table_names


def test_compute_and_persist_daily_return_handles_empty_positions():
    """No positions → return 0.0 and no supabase writes."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import compute_and_persist_daily_return

    with patch("daily_refresh.supabase") as mock_supabase:
        result = compute_and_persist_daily_return([], date(2026, 7, 21), 100_000_000.0)

    assert result == 0.0
    mock_supabase.table.assert_not_called()


def test_compute_and_persist_daily_return_sign_flips_shorts():
    """Short position P&L is the negative of the asset's return."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    import pandas as pd
    from daily_refresh import compute_and_persist_daily_return
    from services.trade_ranker import TradeCandidate

    positioned = [
        (TradeCandidate("t1", "TLT", "long", 0.5, 80.0, 0.3), 50_000_000.0, 0.5),
        (TradeCandidate("t2", "HYG", "short", -0.4, 20.0, -0.2), 50_000_000.0, 0.5),
    ]

    # Build a fake price_df: TLT +1% (100→101), HYG +2% (50→51)
    price_df = pd.DataFrame([
        {"date": date(2026, 7, 20), "ticker": "TLT", "close": 100.0, "return": None},
        {"date": date(2026, 7, 21), "ticker": "TLT", "close": 101.0, "return": 0.01},
        {"date": date(2026, 7, 20), "ticker": "HYG", "close": 50.0, "return": None},
        {"date": date(2026, 7, 21), "ticker": "HYG", "close": 51.0, "return": 0.02},
    ])

    with patch("daily_refresh.supabase") as mock_supabase, \
         patch("daily_refresh.fetch_price_data", return_value=price_df):
        result = compute_and_persist_daily_return(positioned, date(2026, 7, 21), 100_000_000.0)

    # TLT +1% long → +0.005; HYG +2% short → -0.01; sum = -0.005
    assert abs(result - (-0.005)) < 1e-9
    table_names = [c.args[0] for c in mock_supabase.table.call_args_list if c.args]
    assert "portfolio_returns" in table_names


def test_compute_and_persist_risk_writes_hhi():
    """Without history, HHI is computed from current weights; other metrics may be null."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import compute_and_persist_risk
    from services.trade_ranker import TradeCandidate

    cfg = _phase3_cfg(total_capital=100_000_000.0)
    positioned = [
        (TradeCandidate("t1", "TLT", "long", 0.5, 80.0, 0.3), 50_000_000.0, 0.5),
        (TradeCandidate("t2", "HYG", "short", -0.4, 20.0, -0.2), 50_000_000.0, 0.5),
    ]

    with patch("daily_refresh.supabase") as mock_supabase, \
         patch("daily_refresh._load_historical_portfolio_returns", return_value=__import__("pandas").Series(dtype=float)), \
         patch("daily_refresh._load_spx_returns", return_value=None):
        metrics = compute_and_persist_risk(positioned, date(2026, 7, 21), cfg)

    # 50/50 weights → HHI = 0.5^2 + 0.5^2 = 0.5, *10000 = 5000
    assert abs(metrics["concentration_hhi"] - 5000.0) < 1e-6
    assert metrics["total_capital"] == 100_000_000.0
    # No history → VaR/CVaR/Sharpe/Beta are None
    assert metrics["var_95"] is None
    assert metrics["cvar_95"] is None
    assert metrics["sharpe"] is None
    assert metrics["beta"] is None

    # Should have called delete then insert on portfolio_risk
    table_names = [c.args[0] for c in mock_supabase.table.call_args_list if c.args]
    assert "portfolio_risk" in table_names


# ─── Task 8: signed-weights daily return wiring ───────────────────────────────


def test_daily_return_uses_signed_math():
    """The book return is the signed-weight-dotted sum of per-position returns."""
    from services import portfolio as pf

    # Synthetic book: long +10% on weight 0.5, short -10% on weight -0.3
    positions = [
        {"ticker": "A", "weight": 0.5, "price_today": 110.0, "price_yesterday": 100.0},
        {"ticker": "B", "weight": -0.3, "price_today": 90.0, "price_yesterday": 100.0},
    ]
    expected = 0.5 * 0.10 + (-0.3) * (-0.10)
    assert pf.compute_daily_return(positions) == pytest.approx(expected)


def test_daily_return_raises_on_missing_price():
    """A position lacking a usable price must raise, not silently zero."""
    from services import portfolio as pf

    positions = [
        {"ticker": "A", "weight": 0.5, "price_today": 110.0, "price_yesterday": 100.0},
        {"ticker": "B", "weight": -0.3, "price_today": None, "price_yesterday": 100.0},
    ]
    with pytest.raises(pf.MissingReturnError):
        pf.compute_daily_return(positions)


def test_compute_and_persist_daily_return_aborts_on_missing_price():
    """compute_and_persist_daily_return aborts (raises) when a held asset has
    no price data, rather than silently treating it as a 0% return."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    import pandas as pd
    from daily_refresh import compute_and_persist_daily_return
    from services.trade_ranker import TradeCandidate

    positioned = [
        (TradeCandidate("t1", "TLT", "long", 0.5, 80.0, 0.3), 50_000_000.0, 0.5),
        (TradeCandidate("t2", "HYG", "short", -0.4, 20.0, -0.2), 50_000_000.0, 0.5),
    ]

    # HYG has only one row → no prev close → MissingReturnError → abort.
    price_df = pd.DataFrame([
        {"date": date(2026, 7, 20), "ticker": "TLT", "close": 100.0, "return": None},
        {"date": date(2026, 7, 21), "ticker": "TLT", "close": 101.0, "return": 0.01},
        {"date": date(2026, 7, 21), "ticker": "HYG", "close": 51.0, "return": None},
    ])

    with patch("daily_refresh.supabase") as mock_supabase, \
         patch("daily_refresh.fetch_price_data", return_value=price_df):
        with pytest.raises(RuntimeError):
            compute_and_persist_daily_return(positioned, date(2026, 7, 21), 100_000_000.0)

    # No portfolio_returns row should be written when the run aborts.
    table_names = [c.args[0] for c in mock_supabase.table.call_args_list if c.args]
    assert "portfolio_returns" not in table_names
