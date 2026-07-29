"""GDELT client (ADR-0144). Every network call is stubbed; the live behaviour it
encodes was measured separately and is recorded in the module docstring."""
import json
from unittest.mock import patch

import pytest

from backend.data import gdelt_client as gc


class _Resp:
    def __init__(self, body: str, status: int = 200):
        self.content = body.encode("utf-8")
        self.status_code = status


def _articles(*rows):
    return json.dumps({"articles": list(rows)})


def _art(title, seendate="20260728T120000Z", url="https://x/1"):
    return {"title": title, "seendate": seendate, "url": url,
            "domain": "x.com", "language": "English"}


@pytest.fixture(autouse=True)
def _no_sleep_no_state():
    gc._last_call_at = 0.0
    with patch.object(gc.time, "sleep", lambda *_: None):
        yield
    gc._last_call_at = 0.0


class TestShape:
    def test_it_returns_the_market_news_row_shape(self):
        with patch.object(gc.requests, "get", return_value=_Resp(_articles(_art("Stocks rally")))):
            out = gc.fetch_market_news_gdelt(['"stock market"'])
        assert out == [{
            "headline": "Stocks rally", "date": "2026-07-28",
            "url": "https://x/1", "source": "gdelt", "query": '"stock market"',
        }]

    def test_seendate_becomes_an_iso_date(self):
        assert gc._seendate_to_iso("20260714T235959Z") == "2026-07-14"

    def test_an_unreadable_date_is_None_not_today(self):
        """Stamping an unparseable date as current would put the document in the
        wrong bucket of a mention series and bias the newest day upward."""
        for bad in ("", None, "not-a-date", "20261332T000000Z", "2026"):
            assert gc._seendate_to_iso(bad) is None


class TestTheLanguageFilterIsNotOptional:
    def test_sourcelang_english_is_appended_here_not_by_the_caller(self):
        """Without it the corpus fills with French and German market coverage --
        measured live: "L'integrale de BFM Bourse" -- which the tokenizer would
        treat as narrative vocabulary."""
        captured = {}
        def fake_get(url, params=None, **kw):
            captured.update(params or {})
            return _Resp(_articles())
        with patch.object(gc.requests, "get", side_effect=fake_get):
            gc.fetch_market_news_gdelt(['"stock market"'])
        assert captured["query"].endswith("sourcelang:english")


class TestRateLimiting:
    def test_the_pacing_lives_here_not_in_callers(self):
        """A rate limit honoured only when the caller remembers is not a rate
        limit. Server-side floor is 1 request / 5s."""
        assert gc.MIN_SECONDS_BETWEEN_CALLS > 5.0

    def test_it_waits_between_successive_queries(self):
        waits = []
        with patch.object(gc.time, "sleep", lambda s: waits.append(s)), \
             patch.object(gc.requests, "get", return_value=_Resp(_articles())):
            gc.fetch_market_news_gdelt(['"a"', '"b"', '"c"'])
        # First call is free; the next two must be paced.
        assert len([w for w in waits if w > 5.0]) >= 2

    def test_a_throttled_plain_text_body_is_retried_not_parsed(self):
        """GDELT signals throttling with a PLAIN-TEXT body, sometimes under a 200,
        so status alone cannot tell success from throttling and a naive .json()
        raises instead of retrying."""
        throttle = _Resp("Please limit requests to one every 5 seconds", status=200)
        good = _Resp(_articles(_art("Recovered")))
        with patch.object(gc.requests, "get", side_effect=[throttle, good]):
            out = gc.fetch_market_news_gdelt(['"a"'])
        assert [r["headline"] for r in out] == ["Recovered"]

    def test_it_gives_up_rather_than_looping_forever(self, capsys):
        with patch.object(gc.requests, "get", return_value=_Resp("rate limited")):
            out = gc.fetch_market_news_gdelt(['"a"'])
        assert out == []
        assert "gave up" in capsys.readouterr().out

    def test_a_network_error_does_not_crash_the_run(self):
        with patch.object(gc.requests, "get", side_effect=OSError("boom")):
            assert gc.fetch_market_news_gdelt(['"a"']) == []


class TestEncoding:
    def test_utf8_is_decoded_explicitly(self):
        """Letting requests infer the charset produced mojibake in live titles."""
        body = _articles(_art("L'intégrale de BFM Bourse"))
        with patch.object(gc.requests, "get", return_value=_Resp(body)):
            out = gc.fetch_market_news_gdelt(['"a"'])
        assert out[0]["headline"] == "L'intégrale de BFM Bourse"
        assert "�" not in out[0]["headline"]


class TestDedup:
    def test_the_same_story_across_queries_counts_once(self):
        """The seed queries overlap by design; a duplicate would inflate its own
        share of voice."""
        with patch.object(gc.requests, "get",
                          return_value=_Resp(_articles(_art("Same story")))):
            out = gc.fetch_market_news_gdelt(['"a"', '"b"'])
        assert len(out) == 1

    def test_a_titleless_article_is_dropped(self):
        with patch.object(gc.requests, "get",
                          return_value=_Resp(_articles(_art(""), _art("Real")))):
            out = gc.fetch_market_news_gdelt(['"a"'])
        assert [r["headline"] for r in out] == ["Real"]


class TestNoMockFallback:
    def test_total_failure_returns_empty_never_synthetic(self):
        """Same rule as fetch_market_news: a tracker reading template headlines
        would report the template's vocabulary as an emerging narrative."""
        with patch.object(gc.requests, "get", side_effect=OSError("down")):
            assert gc.fetch_market_news_gdelt(['"a"', '"b"']) == []


class TestDateWindowing:
    """`maxrecords` caps a RESPONSE, not a query.

    One request spanning 45 days therefore returns 250 articles for the whole
    window (~5.5/day) and the rest are never returned at all. Splitting the same
    query into WINDOW_DAYS chunks returns up to 250 EACH. Measured on one live seed
    query, 2026-07-29: 232 articles over 45 days in one request, against 250 over 7
    days in one request -- six times the density (ADR-0154).
    """

    def test_one_query_is_split_into_windows_covering_the_lookback(self):
        seen_ranges = []

        def capture(url, params=None, **_k):
            seen_ranges.append((params["startdatetime"], params["enddatetime"]))
            return _Resp(_articles(_art(f"H{len(seen_ranges)}")))

        with patch.object(gc.requests, "get", side_effect=capture),              patch.object(gc.time, "sleep"):
            gc.fetch_market_news_gdelt(['"a"'], lookback_days=28)

        # 28 days / 7 = 4 requests for ONE query, where the old client sent one.
        assert len(seen_ranges) == 28 // gc.WINDOW_DAYS
        # Contiguous and non-overlapping: each window starts where the last ended,
        # so no day is double-counted into a share and none is skipped.
        for (_, prev_end), (next_start, _) in zip(seen_ranges, seen_ranges[1:]):
            assert prev_end == next_start
        # Oldest first -- a truncated fetch must lose the RECENT end, which Brave
        # already covers densely, rather than tear a hole in the only history there is.
        assert seen_ranges == sorted(seen_ranges)

    def test_a_query_that_fails_on_its_first_window_is_abandoned(self):
        """Not retried once per window.

        `_get` returns None for a MALFORMED query as readily as for an exhausted
        retry ladder, and a malformed one fails identically in all windows. Six more
        doomed requests cost ~45s to learn what the first already said.
        """
        calls = {"n": 0}

        def always_rejected(*_a, **_k):
            calls["n"] += 1
            return _Resp("Queries containing OR'd terms must be surrounded by ()",
                         status=200)

        with patch.object(gc.requests, "get", side_effect=always_rejected),              patch.object(gc.time, "sleep"):
            out = gc.fetch_market_news_gdelt(['"a" OR "b"'], lookback_days=28)

        assert out == []
        assert calls["n"] == 1, "a doomed query must not be retried per window"


class TestTimeBudget:
    """A degraded provider must not become a stalled pipeline. The retry ladder
    is 15+30+60s over 6.5s pacing, so one throttled query can burn ~131s and ten
    ~22 minutes -- against a daily run that takes about ten in total."""

    def test_it_stops_starting_queries_past_the_budget(self, capsys):
        clock = {"t": 0.0}
        def creeping(*_):
            clock["t"] += 100.0
            return clock["t"]
        with patch.object(gc.time, "monotonic", side_effect=creeping), \
             patch.object(gc.requests, "get", return_value=_Resp(_articles(_art("A")))):
            gc.fetch_market_news_gdelt(['"a"', '"b"', '"c"', '"d"'], time_budget_s=150.0)
        assert "not run" in capsys.readouterr().out

    def test_it_returns_what_it_gathered_rather_than_nothing(self):
        clock = {"t": 0.0}
        def creeping(*_):
            clock["t"] += 80.0
            return clock["t"]
        with patch.object(gc.time, "monotonic", side_effect=creeping), \
             patch.object(gc.requests, "get", return_value=_Resp(_articles(_art("Kept")))):
            out = gc.fetch_market_news_gdelt(['"a"', '"b"', '"c"'], time_budget_s=150.0)
        assert [r["headline"] for r in out] == ["Kept"]

    def test_a_short_corpus_reports_its_shortfall(self, capsys):
        """GOAL.md's no-silent-caps rule: a corpus that looks complete when it is
        not is unrecoverable; one that says so is."""
        clock = {"t": 0.0}
        def creeping(*_):
            clock["t"] += 500.0
            return clock["t"]
        with patch.object(gc.time, "monotonic", side_effect=creeping), \
             patch.object(gc.requests, "get", return_value=_Resp(_articles())):
            gc.fetch_market_news_gdelt(['"a"', '"b"'], time_budget_s=100.0)
        out = capsys.readouterr().out
        assert "of 2 queries not run" in out


class TestQueryDialect:
    """GDELT requires OR'd terms in parentheses; Brave does not, and the seed
    queries are written in Brave's dialect. Caught only by a live run -- the
    stubbed responses in this file could never have surfaced it."""

    def test_ord_terms_are_wrapped(self):
        assert gc.gdelt_query('"a" OR "b"') == '("a" OR "b")'

    def test_a_single_term_is_left_alone(self):
        assert gc.gdelt_query('"stock market"') == '"stock market"'

    def test_it_is_idempotent(self):
        already = '("a" OR "b")'
        assert gc.gdelt_query(already) == already

    def test_the_real_seed_queries_all_become_valid(self):
        from backend.data.brave_client import MARKET_SEED_QUERIES
        for q in MARKET_SEED_QUERIES:
            out = gc.gdelt_query(q)
            if " OR " in q.upper():
                assert out.startswith("(") and out.endswith(")"), q

    def test_the_translated_form_reaches_the_api(self):
        captured = {}
        def fake_get(url, params=None, **kw):
            captured.update(params or {})
            return _Resp(_articles())
        with patch.object(gc.requests, "get", side_effect=fake_get):
            gc.fetch_market_news_gdelt(['"a" OR "b"'])
        assert captured["query"].startswith('("a" OR "b")')


class TestPermanentErrorsAreNotRetried:
    """The live run spent the full 105s ladder on a query that could never
    succeed, and logged it as throttling -- so the real cause never surfaced."""

    def test_a_rejected_query_returns_immediately(self):
        bad = _Resp("Queries containing OR'd terms must be surrounded by ().", status=200)
        calls = {"n": 0}
        def counting(*a, **k):
            calls["n"] += 1
            return bad
        with patch.object(gc.requests, "get", side_effect=counting):
            out = gc.fetch_market_news_gdelt(['"a"'])
        assert out == []
        assert calls["n"] == 1, "a permanent error must not be retried"

    def test_it_reports_the_real_cause_not_throttling(self, capsys):
        bad = _Resp("Queries containing OR'd terms must be surrounded by ().", status=200)
        with patch.object(gc.requests, "get", return_value=bad):
            gc.fetch_market_news_gdelt(['"a"'])
        out = capsys.readouterr().out
        assert "REJECTED QUERY" in out
        assert "throttled" not in out

    def test_genuine_throttling_is_still_retried(self):
        throttle = _Resp("Please limit requests to one every 5 seconds", status=429)
        good = _Resp(_articles(_art("Recovered")))
        with patch.object(gc.requests, "get", side_effect=[throttle, good]):
            out = gc.fetch_market_news_gdelt(['"a"'])
        assert [r["headline"] for r in out] == ["Recovered"]
