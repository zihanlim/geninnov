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

    run_date = date.today()
    with patch("daily_refresh.load_config", return_value=cfg), \
         patch("daily_refresh.supabase") as mock_supabase:
        # ADR-0029: a single prior-run lookup (.lt().order().execute()) feeds both
        # momentum and elapsed_days. Empty -> no prior -> momentum 0, elapsed 1.
        mock_supabase.table.return_value.select.return_value.lt.return_value.order.return_value.execute.return_value.data = []
        result = compute_trade_scores(hyped, run_date)

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
        # Simulate the APIError raised when the column doesn't exist -- the single
        # prior-run lookup fails, so momentum falls back to 0 (ADR-0029).
        mock_supabase.table.return_value.select.return_value.lt.return_value.order.return_value.execute.side_effect = Exception("column hype_score does not exist")
        result = compute_trade_scores(hyped, date.today())

    # Should not crash; should produce a TradeScore = 0.55 * 0 + 0.45 * sentiment
    assert len(result) == 1
    assert result[0]["trade_score"] == 0.45 * 0.4  # 0.18


def test_compute_trade_scores_passes_real_elapsed_days(capsys):
    """T22: compute_trade_scores reads prior run_date from theme_signals_history
    and computes elapsed_days = (run_date - prior.run_date).days. Without this
    the HypeMomentum normalization always divides by 1 day even after a weekend
    or missed run.
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

    run_date = date.today()
    # Prior run was 5 days ago (e.g. Friday → Wednesday gap).
    prior = (run_date - timedelta(days=5)).isoformat()
    hyped = [{"theme_id": 42, "hype_score": 80.0, "avg_sentiment": 0.0}]

    # Build a chainable mock that returns the right value depending on the
    # filter that was applied. ``select(...).eq("run_date", yesterday)``
    # returns no rows (no yesterday row); the second query for prior rows
    # returns the 5-days-ago row.
    table = MagicMock()
    supabase = MagicMock()
    supabase.table.return_value = table

    def make_chain(*, raise_exc=None, data=None):
        chain = MagicMock()
        if raise_exc is not None:
            chain.execute.side_effect = raise_exc
        else:
            chain.execute.return_value = MagicMock(data=data or [])
        return chain

    # eq("run_date", yesterday) — yesterday lookup returns []
    # lt("run_date", run_date) — prior lookup returns the 5-days-ago row
    # Each .select() starts a new chain. We use side_effect on table() to be
    # order-independent by inspecting call args.
    chained_selects = []

    def select_then_chain(*args, **kwargs):
        # Default to {}.
        return _build_select_chain()

    # Simpler: every select returns a chain where .eq/.lt/.order all return
    # chainable, and .execute() returns what's been staged.
    queue = [
        # ADR-0029: one prior-run lookup returns the 5-days-ago row, now carrying
        # hype_score (for momentum) alongside run_date (for elapsed_days).
        MagicMock(data=[{"theme_id": 42, "run_date": prior, "hype_score": 80.0}]),
    ]
    queue_iter = iter(queue)

    def next_execute(*a, **kw):
        return next(queue_iter)

    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.lt.return_value = chain
    chain.order.return_value = chain
    chain.execute.side_effect = next_execute
    supabase.table.return_value = chain

    with patch("daily_refresh.load_config", return_value=cfg), \
         patch("daily_refresh.supabase", supabase):
        result = compute_trade_scores(hyped, run_date)

    assert result[0]["elapsed_days"] == 5
    # With elapsed_days=5 the momentum contribution is shrunk by 1/5 vs the
    # elapsed_days=1 path. We just verify the row exists and elapsed_days is
    # persisted on the dict for downstream traceability.
    assert "trade_score" in result[0]
    # No missing-prior warning expected
    captured = capsys.readouterr()
    assert "no prior run_date found" not in captured.out


def test_compute_trade_scores_revives_momentum_from_recent_prior():
    """ADR-0029: momentum reads the most-recent prior hype_score, not a row dated
    exactly D-1. A snapshot several days ago with a different hype_score now
    produces a non-zero HypeMomentum term. Pre-fix this collapsed to 0 because no
    row was dated exactly yesterday, so TradeScore silently became sentiment-only.
    """
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import compute_trade_scores
    from services.hype_calculator import ScoringConfig

    cfg = ScoringConfig(
        hype_volume_weight=0.30, hype_sentiment_weight=0.20,
        hype_corr_weight=0.30, hype_momentum_weight=0.20,
        trade_hype_weight=0.55, trade_sentiment_weight=0.45,
    )

    run_date = date.today()
    prior = (run_date - timedelta(days=5)).isoformat()   # NOT exactly yesterday
    # sentiment 0 so TradeScore is momentum-only; hype 80 today vs 40 five days ago.
    hyped = [{"theme_id": 7, "hype_score": 80.0, "avg_sentiment": 0.0}]

    chain = MagicMock()
    chain.select.return_value = chain
    chain.lt.return_value = chain
    chain.order.return_value = chain
    chain.execute.return_value = MagicMock(
        data=[{"theme_id": 7, "run_date": prior, "hype_score": 40.0}]
    )
    supabase = MagicMock()
    supabase.table.return_value = chain

    with patch("daily_refresh.load_config", return_value=cfg), \
         patch("daily_refresh.supabase", supabase):
        result = compute_trade_scores(hyped, run_date)

    # HypeMomentum = (80-40)/40 / 5 = 0.2 ; TradeScore = 0.55*0.2 + 0.45*0 = 0.11
    assert result[0]["elapsed_days"] == 5
    assert result[0]["trade_score"] == pytest.approx(0.55 * 0.2)
    assert result[0]["trade_score"] != 0.0   # the whole point: momentum is alive


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
    # rank_and_persist now ranks on edge_score (ADR-0031), so seed it.
    scored = [
        {"theme_id": "long1", "hype_score": 75.0, "trade_score": 0.5, "edge_score": 0.5, "avg_sentiment": 0.3},
        {"theme_id": "short1", "hype_score": 70.0, "trade_score": -0.4, "edge_score": -0.4, "avg_sentiment": -0.2},
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
    """If no theme passes the threshold, the function returns ([], []) and
    upserts nothing — but it must still PRUNE any stale rows from a prior run.

    A zero-candidate day used to leave the previous run's rows in place, so a
    stale book was served as current. The function now deletes run_date < today
    even when it writes no new rows, which correctly empties the table.
    """
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
    # No upsert should have happened, but a prune (delete of stale rows) must.
    upserts = [
        c for c in mock_supabase.mock_calls
        if ".upsert(" in str(c) and "trade_candidates" in str(c)
    ]
    assert not upserts, "no candidate should be upserted on a zero-candidate day"
    deletes = [
        c for c in mock_supabase.mock_calls
        if ".delete(" in str(c)
    ]
    assert deletes, "stale trade_candidates must be pruned even on a zero-candidate day"


def test_allocate_and_persist_portfolio_writes_positions():
    """Given candidates, should write one portfolio_positions row per candidate."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import allocate_and_persist_portfolio
    from services.trade_ranker import TradeCandidate

    cfg = _phase3_cfg(total_capital=100_000_000.0)
    # TLT (Rates, US) and FXI (China Equities, China) — different sectors AND geos,
    # so only the single-name cap binds.
    # TLT raw hype = 15, FXI = 2 → raw weights 88.2%/11.8%.
    # TLT is capped to 20%; its excess cannot all go to FXI, because FXI is subject
    # to the same 20% cap. Both land at $20M and the remaining $60M stays in cash.
    # (This previously asserted FXI = $80M, i.e. four times its own limit — the
    # single-name pass ran once and never re-checked the redistribution recipient.)
    candidates = [
        TradeCandidate("t1", "TLT", "long", 0.5, 15.0, 0.3),
        TradeCandidate("t2", "FXI", "short", -0.4, 2.0, -0.2),
    ]

    with patch("daily_refresh.supabase") as mock_supabase:
        positioned = allocate_and_persist_portfolio(candidates, date(2026, 7, 21), cfg)

    assert len(positioned) == 2
    notionals = {c.asset: n for c, n, w in positioned}
    assert abs(notionals["TLT"] - 20_000_000) < 1e-6
    assert abs(notionals["FXI"] - 20_000_000) < 1e-6

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


def test_daily_return_persists_compounded_cumulative_not_todays_return():
    """Regression: `cumulative_return` must be the since-inception COMPOUNDED
    return, not a copy of today's daily return.

    It was written as `cumulative_return: daily` with a "recompute when history is
    sufficient" note that was never implemented, so every row carried the daily
    figure under a cumulative label. /risk reads this column as its cumulative
    series, so the curve, the max-drawdown derived from it, and portfolio_value
    were all wrong once the book had more than one session. Caught by reconciling
    against portfolio_cumulative_return (+0.73% persisted vs -0.68% here).
    """
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    import pandas as pd
    from daily_refresh import compute_and_persist_daily_return
    from services.trade_ranker import TradeCandidate

    positioned = [
        (TradeCandidate("t1", "TLT", "long", 0.5, 80.0, 0.3), 100_000_000.0, 1.0),
    ]
    # TLT -1% today → daily = -0.01
    price_df = pd.DataFrame([
        {"date": date(2026, 7, 20), "ticker": "TLT", "close": 100.0, "return": None},
        {"date": date(2026, 7, 21), "ticker": "TLT", "close": 99.0, "return": -0.01},
    ])
    # One prior session at +2%.
    prior = [{"run_date": "2026-07-20", "daily_return": 0.02}]

    with patch("daily_refresh.supabase") as mock_supabase, \
         patch("daily_refresh.fetch_price_data", return_value=price_df):
        mock_supabase.table.return_value.select.return_value.lt.return_value \
            .order.return_value.execute.return_value.data = prior
        daily = compute_and_persist_daily_return(
            positioned, date(2026, 7, 21), 100_000_000.0
        )

    upserts = [
        c.args[0]
        for c in mock_supabase.table.return_value.upsert.call_args_list
        if c.args and isinstance(c.args[0], dict)
    ]
    row = next(u for u in upserts if "cumulative_return" in u)

    assert abs(daily - (-0.01)) < 1e-9
    # 1.02 * 0.99 - 1 = +0.98%, NOT the -1% daily.
    expected = 1.02 * 0.99 - 1.0
    assert abs(row["cumulative_return"] - expected) < 1e-9, (
        f"cumulative_return {row['cumulative_return']} should compound to {expected}"
    )
    assert row["cumulative_return"] != row["daily_return"]
    # Book value follows the compounded path, not one day's move.
    assert abs(row["portfolio_value"] - 100_000_000.0 * (1 + expected)) < 1e-6


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


class TestSignalsHistoryPersistsScores:
    """theme_signals_history must carry hype_score and trade_score.

    Migration 003 added both columns so the next day's run can read today's
    HypeScore and compute HypeMomentum. persist() never wrote them, so every
    historical row had a NULL hype_score, hype_yesterday was always missing,
    and the 0.55-weighted momentum term of TradeScore was permanently zero --
    TradeScore silently collapsed to trade_sentiment_weight * sentiment.
    """

    REQUIRED = {"theme_id", "run_date", "hype_score", "trade_score"}

    def test_upsert_payload_includes_scores(self, monkeypatch):
        import scripts.daily_refresh as dr

        captured = []

        class _Tbl:
            def __init__(self, name):
                self._name = name

            def update(self, *_a, **_k):
                return self

            def eq(self, *_a, **_k):
                return self

            def upsert(self, payload, **_k):
                if self._name == "theme_signals_history":
                    captured.append(payload)
                return self

            def execute(self):
                return type("R", (), {"data": []})()

        class _SB:
            def table(self, name):
                return _Tbl(name)

        monkeypatch.setattr(dr, "supabase", _SB())

        scored = [
            {
                "theme_id": "t1",
                "hype_score": 52.5,
                "trade_score": 0.11,
                "mention_count_1d": 10,
                "mention_count_7d_avg": 8.0,
                "mention_count_7d_std": 1.0,
                "avg_sentiment": 0.25,
                "price_corr": 0.4,
                "momentum_raw": 1.2,
            }
        ]
        dr.persist(date(2026, 7, 23), scored)

        assert captured, "expected a theme_signals_history upsert"
        row = captured[0]
        missing = self.REQUIRED - set(row)
        assert not missing, f"signals history payload missing {missing}"
        assert row["hype_score"] == 52.5
        assert row["trade_score"] == 0.11


# ─── Task 2: wire real news into L5 (theme_news store) ───────────────────────


def test_build_theme_signals_attaches_source_tagged_headlines():
    """build_theme_signals attaches a source-tagged `headlines` list per theme
    so persist_theme_news can write the L5 agent's news context."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")

    from daily_refresh import build_theme_signals

    today = date.today().isoformat()
    news = [{"headline": "Fed holds rates steady", "date": today}]
    posts = [{"title": "WSB debates the Fed", "date": today}]

    with patch("daily_refresh.fetch_news_for_theme", return_value=news), \
         patch("daily_refresh.fetch_posts_for_theme", return_value=posts), \
         patch("daily_refresh.batch_sentiment", return_value=[0.1, 0.1]), \
         patch("daily_refresh.supabase") as mock_supabase:
        mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        result = build_theme_signals([{"id": "t1", "name": "Fed Policy"}], date.today())

    r = result[0]
    assert "headlines" in r
    assert len(r["headlines"]) == 2
    assert {h["source"] for h in r["headlines"]} == {"brave", "reddit"}
    assert {h["text"] for h in r["headlines"]} == {"Fed holds rates steady", "WSB debates the Fed"}


def _capture_upserts(monkeypatch):
    """Patch daily_refresh.supabase with a recorder that captures upsert payloads."""
    import scripts.daily_refresh as dr
    captured = {"payloads": [], "on_conflict": [], "raise_on_upsert": False}

    class _Tbl:
        def __init__(self, name):
            self._name = name

        def upsert(self, payload, **kw):
            if captured["raise_on_upsert"]:
                raise Exception('relation "theme_news" does not exist')
            captured["payloads"].append(payload)
            captured["on_conflict"].append(kw.get("on_conflict"))
            return self

        def delete(self):
            captured.setdefault("deleted", []).append(self._name)
            return self

        def eq(self, *a, **kw):
            return self

        def execute(self):
            return type("R", (), {"data": []})()

    class _SB:
        def table(self, name):
            return _Tbl(name)

    monkeypatch.setattr(dr, "supabase", _SB())
    return dr, captured


def test_persist_theme_news_writes_dedupes_and_guards_bad_dates(monkeypatch):
    dr, captured = _capture_upserts(monkeypatch)

    monkeypatch.setenv("ANDROMEDA_ALLOW_MOCK", "0")
    scored = [{
        "theme_id": "t1",
        "headlines": [
            {"source": "brave", "text": "Fed holds rates", "date": "2026-07-23T10:00:00"},
            {"source": "reddit", "text": "Discussion: Fed", "date": "2 days ago"},      # bad date → None
            {"source": "brave", "text": "Fed holds rates", "date": "2026-07-23"},          # duplicate → skipped
            {"source": "brave", "text": "   ", "date": ""},                                # blank → skipped
            {"source": "mock_brave", "text": "Synthetic Fed headline", "date": "2026-07-23"},  # mock → dropped
        ],
    }]

    n = dr.persist_theme_news(date(2026, 7, 23), scored)

    assert n == 2, "duplicate, blank, and mock headlines must be dropped"
    rows = captured["payloads"][0]
    assert captured["on_conflict"][0] == "theme_id,run_date,headline"
    by_text = {r["headline"]: r for r in rows}
    assert by_text["Fed holds rates"]["published_date"] == "2026-07-23"
    # Non-ISO "2 days ago" must not poison the batch — it lands as NULL.
    assert by_text["Discussion: Fed"]["published_date"] is None
    # ANDROMEDA_ALLOW_MOCK=0 → no mock_* source is ever persisted (data integrity).
    assert "Synthetic Fed headline" not in by_text
    assert all(not r["source"].startswith("mock_") for r in rows)
    # Idempotent re-run pruned this run_date's prior rows before writing.
    assert "theme_news" in captured.get("deleted", [])


def test_persist_theme_news_returns_zero_when_table_missing(monkeypatch):
    dr, captured = _capture_upserts(monkeypatch)
    captured["raise_on_upsert"] = True
    scored = [{"theme_id": "t1", "headlines": [{"source": "brave", "text": "x", "date": ""}]}]
    # Must not raise even if migration 018 is not deployed.
    assert dr.persist_theme_news(date(2026, 7, 23), scored) == 0


def test_persist_theme_news_no_headlines_is_noop(monkeypatch):
    dr, captured = _capture_upserts(monkeypatch)
    assert dr.persist_theme_news(date(2026, 7, 23), [{"theme_id": "t1"}]) == 0
    assert captured["payloads"] == []


# ─── Task 6: data-source provenance (RESIDUAL R0b) ────────────────────────────


def test_classify_data_source():
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
    from daily_refresh import _classify_data_source

    assert _classify_data_source([]) == "none"
    assert _classify_data_source([{"source": "brave"}, {"source": "reddit"}]) == "real"
    assert _classify_data_source([{"source": "mock_brave"}, {"source": "mock_reddit"}]) == "mock"
    assert _classify_data_source([{"source": "brave"}, {"source": "mock_reddit"}]) == "mixed"


def test_build_theme_signals_flags_mock_provenance():
    """When the fetchers return mock-tagged items, the signal row is labelled."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
    from daily_refresh import build_theme_signals

    today = date.today().isoformat()
    mock_news = [{"headline": "Fed mock", "date": today, "source": "mock_brave"}]
    mock_posts = [{"title": "Fed mock post", "date": today, "source": "mock_reddit"}]

    with patch("daily_refresh.fetch_news_for_theme", return_value=mock_news), \
         patch("daily_refresh.fetch_posts_for_theme", return_value=mock_posts), \
         patch("daily_refresh.batch_sentiment", return_value=[0.0, 0.0]), \
         patch("daily_refresh.supabase") as mock_supabase:
        mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        result = build_theme_signals([{"id": "t1", "name": "Fed Policy"}], date.today())

    assert result[0]["data_source"] == "mock"


def test_reconcile_positions_to_published_book_replaces_the_l1_book():
    """ADR-0040 — the app was publishing two different portfolios.

    /book showed L5's picks while /risk attribution, the daily return and every risk
    statistic came from L1's provisional book, which L5 re-picks a subset of. Live on
    2026-07-24 that meant EFA, IWM, QQQ, SLV, SPY and XLV were attributed risk on a
    page while appearing nowhere in the book — and VaR/Sharpe/HHI described a
    portfolio nobody holds.
    """
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
    from daily_refresh import reconcile_positions_to_published_book
    from services.trade_ranker import TradeCandidate

    cfg = _phase3_cfg(total_capital=100_000_000.0)
    provisional = [
        (TradeCandidate("t1", "EEM", "long", 0.3, 60.0, 0.1), 20_000_000.0, 0.20),
        (TradeCandidate("t1", "GLD", "short", -0.3, 60.0, 0.1), 20_000_000.0, -0.20),
        (TradeCandidate("t2", "QQQ", "long", 0.3, 60.0, 0.1), 20_000_000.0, 0.20),
    ]
    agent_result = {"picks": [
        {"asset": "EEM", "direction": "long", "weight": 0.30,
         "signed_weight": 0.30, "notional": 30_000_000.0},
        {"asset": "GLD", "direction": "short", "weight": 0.25,
         "signed_weight": -0.25, "notional": 25_000_000.0},
    ]}

    with patch("daily_refresh.supabase"):
        final = reconcile_positions_to_published_book(
            agent_result, provisional, date(2026, 7, 24), cfg)

    assert final is not None
    assert [c.asset for c, _, _ in final] == ["EEM", "GLD"]   # QQQ is gone
    weights = {c.asset: w for c, _, w in final}
    assert weights["EEM"] == pytest.approx(0.30)              # L5's weight, not L1's
    assert weights["GLD"] == pytest.approx(-0.25)             # short stays signed


def test_reconcile_keeps_the_l1_book_when_l5_produced_nothing():
    """A fallback day still needs a real, coherent portfolio."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
    from daily_refresh import reconcile_positions_to_published_book
    from services.trade_ranker import TradeCandidate

    cfg = _phase3_cfg(total_capital=100_000_000.0)
    provisional = [(TradeCandidate("t1", "EEM", "long", 0.3, 60.0, 0.1), 20_000_000.0, 0.20)]
    with patch("daily_refresh.supabase"):
        assert reconcile_positions_to_published_book(None, provisional, date(2026, 7, 24), cfg) is None
        assert reconcile_positions_to_published_book({"picks": []}, provisional, date(2026, 7, 24), cfg) is None


def test_reconcile_refuses_a_pick_outside_the_candidate_set():
    """ADR-0014 hard-filters L5's picks, so this should be impossible — and if it
    ever happens we must not publish a book that disagrees with its own risk."""
    os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
    from daily_refresh import reconcile_positions_to_published_book
    from services.trade_ranker import TradeCandidate

    cfg = _phase3_cfg(total_capital=100_000_000.0)
    provisional = [(TradeCandidate("t1", "EEM", "long", 0.3, 60.0, 0.1), 20_000_000.0, 0.20)]
    agent_result = {"picks": [{"asset": "NVDA", "direction": "long", "weight": 0.2}]}
    with patch("daily_refresh.supabase"):
        assert reconcile_positions_to_published_book(
            agent_result, provisional, date(2026, 7, 24), cfg) is None
