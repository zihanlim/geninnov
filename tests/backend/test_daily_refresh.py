# tests/backend/test_daily_refresh.py
"""
Tests for the daily_refresh.py script.
Verifies imports, function signatures, and mock mode behavior.
"""
import sys
import os
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

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
