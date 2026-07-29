"""A theme whose news feed never answered must not be scored.

WHAT HAPPENED
-------------
On 2026-07-29 the Brave quota was exhausted mid-run (HTTP 402, spend 4.99 of
4.99). `theme_news` fell from 375 articles across 9 themes to 223 across 6, and
three themes — US Dollar, Geopolitical Risk, AI Capex — collected **zero**
documents.

All three were published with `hype_score = 28.5714`. Identical, because the
number contained no information about any of them:

    volume    = 0.0    the one real signal, correctly zero
    sentiment = 0.5    rescale_vader(0.0), the neutral default over an empty corpus
    momentum  = 0.5    the neutral default
    corr      = None   dropped, remaining weights renormalised over 0.70

    100 * (0.20*0.5 + 0.20*0.5) / 0.70  =  28.571428...

The renormalisation ADR-0036 introduced so that an unmeasurable correlation would
not be scored as zero is what scaled the two placeholders UP. A guard designed to
prevent one silent zero manufactured a different silent number.

WHY IT COULD HAPPEN
-------------------
`brave_client.fetch_news_for_theme` returned `[]` for both "the feed answered and
had nothing" and "the feed did not answer". The Node bridge reported the failure
properly — exit 1, "Brave API returned status 402" on stderr — and the Python
client discarded the return code and the message.

These tests pin the distinction, in both directions. The second direction is the
one that will break first: it is easy to fix an outage-scored-as-quiet by making
everything raise, which would stop a genuinely quiet theme from ever scoring.
"""
from __future__ import annotations

import pytest

from backend.services.hype_calculator import (
    ScoringConfig,
    compute_hype_scores,
    hype_score,
    momentum_subscore,
    rescale_vader,
    volume_subscore,
)


@pytest.fixture
def scoring_cfg() -> ScoringConfig:
    """The live weights, so 28.5714 below is the number production produced."""
    return ScoringConfig(
        hype_volume_weight=0.30, hype_sentiment_weight=0.20,
        hype_corr_weight=0.30, hype_momentum_weight=0.20,
        trade_hype_weight=0.55, trade_sentiment_weight=0.45,
        hype_score_threshold=50.0, total_capital=100_000_000.0,
    )


def _raw(theme_id: str = "t1", **over) -> dict:
    """A raw signal for a theme that collected NOTHING."""
    base = {
        "theme_id": theme_id,
        "run_date": "2026-07-29",
        "mention_count_1d": 0,
        "mention_count_7d_avg": 0.0,
        "mention_count_7d_std": 0.0,
        "avg_sentiment": 0.0,
        "price_corr": None,
        "corr_by_class": {},
        "momentum_raw": 0.0,
        "headlines": [],
        "feed_error": None,
    }
    base.update(over)
    return base


class TestTheRegressionItself:
    def test_the_28_57_is_reproducible(self, scoring_cfg):
        """Pin the exact number, so the regression is testable rather than a story."""
        s = hype_score(
            volume=volume_subscore(0.0),
            sentiment=0.0,
            corr=None,
            momentum=momentum_subscore(0.0),
            cfg=scoring_cfg,
        )
        assert s == pytest.approx(28.5714, abs=1e-3)

    def test_it_is_made_of_two_placeholders(self, scoring_cfg):
        """And that neither placeholder is a measurement of anything."""
        assert rescale_vader(0.0) == 0.5      # no text to score
        assert momentum_subscore(0.0) == 0.5  # no series to compare


class TestAFailedFeedIsNotScored:
    def test_feed_error_yields_a_null_hype_score(self, scoring_cfg):
        out = compute_hype_scores([_raw(feed_error="Brave 402")], scoring_cfg)
        assert out[0]["hype_score"] is None

    def test_it_is_null_and_not_zero(self, scoring_cfg):
        """0.0 is a score. It would rank, chart, and read as 'nothing going on'.

        ADR-0066's rule is that a value which could not be computed persists as
        NULL, precisely so a consumer cannot mistake it for a low reading.
        """
        out = compute_hype_scores([_raw(feed_error="Brave 402")], scoring_cfg)
        assert out[0]["hype_score"] is None
        assert out[0]["hype_score"] != 0.0

    def test_the_raw_signal_is_preserved_alongside_the_null(self, scoring_cfg):
        """The row still records what was attempted and why it failed."""
        out = compute_hype_scores([_raw(feed_error="Brave 402: Usage limit")], scoring_cfg)
        assert out[0]["feed_error"] == "Brave 402: Usage limit"
        assert out[0]["theme_id"] == "t1"

    def test_only_the_failed_theme_is_nulled(self, scoring_cfg):
        """A quota that dies mid-run leaves the earlier themes fully measurable.

        Nulling the whole run would discard real measurements to punish an
        unrelated failure — the opposite error, and just as wrong.
        """
        rows = [
            _raw("ok", mention_count_1d=12, mention_count_7d_avg=8.0,
                 avg_sentiment=0.2, momentum_raw=1.1),
            _raw("dead", feed_error="Brave 402"),
        ]
        out = {r["theme_id"]: r["hype_score"] for r in compute_hype_scores(rows, scoring_cfg)}
        assert out["dead"] is None
        assert isinstance(out["ok"], float) and out["ok"] > 0


class TestTheWiringInBuildThemeSignals:
    """The tests above set `feed_error` by hand. These prove the pipeline sets it.

    Without this, the guard is provably correct over an input the pipeline might
    never actually produce — which is how the original bug survived a suite of
    1337 passing tests.
    """

    @staticmethod
    def _run(news_side_effect):
        import os
        import sys
        from datetime import date
        from pathlib import Path
        from unittest.mock import MagicMock, patch

        root = Path(__file__).resolve().parents[2]
        sys.path.insert(0, str(root / "scripts"))
        sys.path.insert(0, str(root / "backend"))
        # daily_refresh reads these at IMPORT time (module-level os.environ[...]).
        os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
        os.environ.setdefault("SUPABASE_SERVICE_KEY", "mock-key")
        from daily_refresh import build_theme_signals  # noqa: E402

        with patch("daily_refresh.fetch_news_for_theme", side_effect=news_side_effect), \
             patch("daily_refresh.fetch_posts_for_theme", return_value=[]), \
             patch("daily_refresh.batch_sentiment", return_value=[0.0]), \
             patch("daily_refresh.fetch_price_data", return_value=__import__(
                 "pandas").DataFrame()), \
             patch("daily_refresh.supabase") as sb:
            m = MagicMock()
            m.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
            m.select.return_value.eq.return_value.order.return_value.limit.return_value \
                .execute.return_value.data = []
            sb.table.return_value = m
            return build_theme_signals([{"id": 1, "name": "Fed Policy"}], date.today())

    def test_a_raising_feed_sets_feed_error(self):
        from backend.data.brave_client import ProviderUnavailable

        rows = self._run(ProviderUnavailable("Brave API returned status 402"))
        assert rows[0]["feed_error"] is not None
        assert "402" in rows[0]["feed_error"]

    def test_a_healthy_empty_feed_leaves_feed_error_none(self):
        rows = self._run(lambda *a, **k: [])
        assert rows[0]["feed_error"] is None

    def test_the_run_continues_past_a_dead_feed(self):
        """One theme's outage must not abort the other eight."""
        from backend.data.brave_client import ProviderUnavailable

        rows = self._run(ProviderUnavailable("Brave 402"))
        assert len(rows) == 1 and rows[0]["theme_id"] == 1


class TestAQuietThemeIsStillScored:
    """The direction that will break first if someone "fixes" this too hard."""

    def test_zero_mentions_from_a_HEALTHY_feed_still_scores(self, scoring_cfg):
        out = compute_hype_scores([_raw(feed_error=None)], scoring_cfg)
        assert out[0]["hype_score"] is not None
        assert out[0]["hype_score"] == pytest.approx(28.5714, abs=1e-3)

    def test_absent_feed_error_key_is_treated_as_healthy(self, scoring_cfg):
        """Back-compat: rows built before `feed_error` existed must still score."""
        r = _raw()
        del r["feed_error"]
        out = compute_hype_scores([r], scoring_cfg)
        assert out[0]["hype_score"] is not None
