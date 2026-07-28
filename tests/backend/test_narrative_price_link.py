"""Does attention to a narrative move prices? (ADR-0143)

The discrimination this exists to make: `earnings` is the loudest phrase in the
corpus and should correlate with nothing in particular (every listed company
reports); `ai capex` should co-move with the semis and power complex.
"""
from datetime import date, timedelta

import pandas as pd
import pytest

from backend.services.narrative_price_link import (
    MIN_SESSIONS_FOR_VERDICT,
    PriceLink,
    assess_price_link,
    daily_share_series,
    rank_by_link,
)

CLASSES = {"SMH": "equity", "NVDA": "equity", "JNK": "credit",
           "IEF": "rates", "UNG": "commodity"}


def _days(n=24, start=date(2026, 7, 1)):
    return [start + timedelta(days=i) for i in range(n)]


def _prices(tickers, rets_by_ticker, days):
    rows = []
    for t in tickers:
        for d, r in zip(days, rets_by_ticker[t]):
            rows.append({"date": d, "ticker": t, "close": 100.0, "return": r})
    return pd.DataFrame(rows)


class TestDailyShareSeries:
    def test_share_not_raw_count(self):
        """13 stories on a Saturday and 80 on a Monday: a raw count tracks the
        news cycle's volume, not the phrase."""
        dated = ([(date(2026, 7, 1), "ai capex rises")] * 1
                 + [(date(2026, 7, 1), "unrelated")] * 3
                 + [(date(2026, 7, 2), "ai capex rises")] * 2
                 + [(date(2026, 7, 2), "unrelated")] * 6)
        s = daily_share_series(dated, "ai capex")
        # 1/4 and 2/8 are the same share despite the count doubling.
        assert s["2026-07-01"] == pytest.approx(0.25)
        assert s["2026-07-02"] == pytest.approx(0.25)

    def test_it_is_indexed_by_publication_date(self):
        s = daily_share_series([(date(2026, 7, 3), "gold rallies")], "gold")
        assert list(s.index) == ["2026-07-03"]

    def test_an_absent_phrase_is_zero_not_missing(self):
        s = daily_share_series([(date(2026, 7, 1), "something else")], "gold")
        assert s["2026-07-01"] == 0.0

    def test_empty_input_is_an_empty_series(self):
        assert daily_share_series([], "gold").empty


class TestTheDiscrimination:
    def _dated(self, days, phrase_days):
        out = []
        for i, d in enumerate(days):
            out.append((d, f"{phrase_days[i]} filler story"))
            out.append((d, "wholly unrelated market story"))
        return out

    def test_a_phrase_that_moves_one_class_is_LINKED(self):
        days = _days(24)   # >= MIN_SESSIONS_FOR_VERDICT, or every verdict is insufficient_history
        # attention alternates; SMH returns track it exactly.
        pattern = ["ai capex", "nothing"] * 12
        rets = [0.02 if p == "ai capex" else -0.02 for p in pattern]
        px = _prices(["SMH", "IEF"], {"SMH": rets, "IEF": [0.001] * 24}, days)
        link = assess_price_link("ai capex", self._dated(days, pattern), px, CLASSES)
        assert link.verdict == "linked"
        assert "equity" in link.corr_by_class
        assert abs(link.corr_by_class["equity"]) > 0.9

    def test_an_ambient_phrase_moves_nothing_and_says_so(self):
        """The `earnings` case: present every day, correlated with nothing."""
        days = _days(24)   # >= MIN_SESSIONS_FOR_VERDICT, or every verdict is insufficient_history
        pattern = ["earnings"] * 24          # constant attention
        rets = [0.02, -0.01, 0.03, -0.02, 0.01, -0.03, 0.02, 0.00, -0.01, 0.02] * 2 + [0.01, -0.01, 0.02, -0.02]
        px = _prices(["SMH", "IEF"], {"SMH": rets, "IEF": rets[::-1]}, days)
        link = assess_price_link("earnings", self._dated(days, pattern), px, CLASSES)
        # A constant series has no variance, so Pearson is undefined -> unmeasurable,
        # which is honest. What must NOT happen is a confident "linked".
        assert link.verdict in ("ambient", "unmeasurable")
        assert link.material == 0

    def test_a_measurable_but_uncorrelated_phrase_is_AMBIENT_not_linked(self):
        days = _days(24)   # >= MIN_SESSIONS_FOR_VERDICT, or every verdict is insufficient_history
        pattern = ["earnings", "nothing"] * 12
        # Returns orthogonal to the alternating attention pattern.
        rets = [0.01, 0.01, -0.01, -0.01] * 6
        px = _prices(["SMH"], {"SMH": rets}, days)
        link = assess_price_link("earnings", self._dated(days, pattern), px, CLASSES)
        assert link.measured >= 1
        assert link.verdict == "ambient"


class TestSampleHonesty:
    def test_the_session_count_travels_with_the_reading(self):
        days = _days(24)   # >= MIN_SESSIONS_FOR_VERDICT, or every verdict is insufficient_history
        pattern = ["ai capex", "nothing"] * 12
        rets = [0.02 if p == "ai capex" else -0.02 for p in pattern]
        px = _prices(["SMH"], {"SMH": rets}, days)
        link = assess_price_link("ai capex", TestTheDiscrimination()._dated(days, pattern), px, CLASSES)
        assert link.sessions == 24

    def test_a_thin_sample_is_marked_provisional(self):
        """ADR-0059's lesson: a single-date IC turned a panel green. Computing a
        correlation and BELIEVING it are different thresholds."""
        assert PriceLink("x", sessions=6).provisional is True
        assert PriceLink("x", sessions=MIN_SESSIONS_FOR_VERDICT).provisional is False

    def test_the_believe_floor_is_higher_than_the_compute_floor(self):
        # correlation_with_mentions computes at 5; this refuses to trust until 20.
        assert MIN_SESSIONS_FOR_VERDICT > 5

    def test_no_price_data_never_reads_as_a_finding(self):
        """With no prices there are zero sessions, so the sample floor answers
        first. `unmeasurable` is reserved for the rarer case where enough
        sessions DID exist and no asset class could still be measured -- a
        different fact, and one worth being able to tell apart."""
        link = assess_price_link("ai", [(date(2026, 7, 1), "ai story")],
                                 pd.DataFrame(), CLASSES)
        assert link.verdict == "insufficient_history"
        assert link.subscore is None
        assert link.material == 0

    def test_unmeasurable_is_reserved_for_enough_sessions_and_no_class(self):
        empty = PriceLink("x", corr_by_class={}, measured=0, subscore=None,
                          sessions=MIN_SESSIONS_FOR_VERDICT)
        assert empty.verdict == "unmeasurable"


class TestRanking:
    def test_linked_outranks_the_loudest_ambient_phrase(self):
        loud = PriceLink("earnings", {"equity": 0.05}, material=0, measured=1,
                         subscore=0.1, sessions=30)
        quiet = PriceLink("ai capex", {"equity": 0.7, "credit": 0.4},
                          material=2, measured=2, subscore=0.9, sessions=30)
        assert [l.phrase for l in rank_by_link([loud, quiet])] == ["ai capex", "earnings"]

    def test_breadth_outranks_magnitude(self):
        broad = PriceLink("a", material=3, measured=3, subscore=0.6, sessions=30)
        deep = PriceLink("b", material=1, measured=1, subscore=0.95, sessions=30)
        assert [l.phrase for l in rank_by_link([broad, deep])] == ["a", "b"]

    def test_unmeasurable_sinks_below_ambient(self):
        amb = PriceLink("amb", {"equity": 0.05}, material=0, measured=1, subscore=0.1)
        unk = PriceLink("unk")
        assert [l.phrase for l in rank_by_link([unk, amb])] == ["amb", "unk"]


class TestInsufficientHistoryIsTheDefaultAnswer:
    """Forced by the first live run, not chosen in advance.

    On 5 overlapping sessions the gate returned `linked` for ALL FOURTEEN phrases
    tested -- scores 0.84 to 1.00, 4-5 of 5 asset classes "material" -- including
    `earnings`, `wall`, `q2` and `analysts`. At n=5 a Pearson r is near +/-1 by
    chance, so it was measuring sample size. Putting that behind an opt-in
    `provisional` flag is how ADR-0059's single-date IC turned a panel green.
    """

    def test_a_thin_sample_cannot_report_linked_however_strong(self):
        thin = PriceLink("earnings", {"equity": 0.99, "credit": 0.98},
                         material=2, measured=2, subscore=1.0, sessions=5)
        assert thin.verdict == "insufficient_history"
        assert thin.verdict != "linked"

    def test_the_raw_numbers_stay_on_the_record(self):
        """Refusing a verdict is not hiding the measurement."""
        thin = PriceLink("earnings", {"equity": 0.99}, material=1, measured=1,
                         subscore=1.0, sessions=5)
        assert thin.subscore == 1.0
        assert thin.corr_by_class == {"equity": 0.99}
        assert thin.sessions == 5

    def test_the_verdict_appears_once_history_exists(self):
        fat = PriceLink("ai capex", {"equity": 0.7}, material=1, measured=1,
                        subscore=0.9, sessions=MIN_SESSIONS_FOR_VERDICT)
        assert fat.verdict == "linked"

    def test_insufficient_history_sinks_to_the_bottom_of_the_ranking(self):
        good = PriceLink("ai", {"equity": 0.7}, material=1, measured=1,
                         subscore=0.9, sessions=30)
        thin = PriceLink("earnings", {"equity": 0.99}, material=1, measured=1,
                         subscore=1.0, sessions=5)
        assert [l.phrase for l in rank_by_link([thin, good])] == ["ai", "earnings"]
