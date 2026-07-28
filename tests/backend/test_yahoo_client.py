import pandas as pd
import pytest
from backend.data.yahoo_client import fetch_price_data, correlation_with_mentions


class TestFetchPriceData:
    def test_empty_ticker_list_returns_empty_dataframe_with_correct_columns(self):
        result = fetch_price_data([])
        assert result.empty
        assert list(result.columns) == ["date", "ticker", "close", "return"]


class TestCorrelationWithMentions:
    """`None` means NOT MEASURABLE and 0.0 means measured-and-uncorrelated.

    They were the same value until ADR-0127, which is what let the caller's
    `if not pd.isna(corr)` guard pass on an unmeasurable ticker and break out of
    the loop over the theme's other mapped instruments.
    """

    def test_returns_none_when_price_df_is_empty(self):
        mention_series = pd.Series([1, 2, 3], index=pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]))
        result = correlation_with_mentions(pd.DataFrame(columns=["date", "ticker", "close", "return"]), mention_series, "AAPL")
        assert result is None

    def test_returns_none_when_fewer_than_5_common_dates(self):
        price_df = pd.DataFrame({
            "date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
            "ticker": ["AAPL", "AAPL", "AAPL"],
            "close": [100.0, 101.0, 102.0],
            "return": [0.01, 0.01, 0.01],
        })
        mention_series = pd.Series([10, 20], index=pd.to_datetime(["2024-01-01", "2024-01-02"]))
        result = correlation_with_mentions(price_df, mention_series, "AAPL")
        assert result is None

    def test_returns_none_not_zero_on_a_constant_series(self):
        """A flat mention series has zero variance, so Pearson is undefined.
        Undefined is not "no correlation" — returning 0.0 here would let a theme
        with no attention spread claim a measured, uncorrelated reading."""
        dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"]
        price_df = pd.DataFrame({
            "date": [pd.to_datetime(d).date() for d in dates],
            "ticker": ["AAPL"] * 6,
            "close": [100, 101, 103, 102, 105, 104],
            "return": [0.00, 0.01, 0.02, -0.01, 0.03, -0.01],
        })
        flat = pd.Series({d: 4.0 for d in dates})
        assert correlation_with_mentions(price_df, flat, "AAPL") is None

    def test_a_measured_zero_correlation_is_still_zero(self):
        """The other side of the contract: when the data IS there and the two
        series genuinely do not co-move, that is a 0.0 reading, not a None."""
        dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04",
                 "2024-01-05", "2024-01-08", "2024-01-09", "2024-01-10"]
        # returns alternate +1/-1; mentions are +1/+1/-1/-1 — orthogonal by construction
        price_df = pd.DataFrame({
            "date": [pd.to_datetime(d).date() for d in dates],
            "ticker": ["AAPL"] * 8,
            "close": [100] * 8,
            "return": [1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0],
        })
        mentions = pd.Series(dict(zip(dates, [1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0])))
        result = correlation_with_mentions(price_df, mentions, "AAPL")
        assert result is not None
        assert result == pytest.approx(0.0, abs=1e-9)

    def test_correlates_despite_string_vs_date_index_mismatch(self):
        """Regression: build_theme_signals keys the mention series with ISO
        STRINGS while price dates are datetime.date. A raw intersection of the two
        types was always empty → correlation silently 0 for every theme. Both
        indices must be coerced to a common type."""
        dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"]
        price_df = pd.DataFrame({
            "date": [pd.to_datetime(d).date() for d in dates],   # datetime.date
            "ticker": ["AAPL"] * 6,
            "close": [100, 101, 103, 102, 105, 104],
            "return": [0.00, 0.01, 0.02, -0.01, 0.03, -0.01],
        })
        # mention series keyed by ISO STRINGS, perfectly correlated with returns
        mention_series = pd.Series(
            {d: r for d, r in zip(dates, [0.0, 1.0, 2.0, -1.0, 3.0, -1.0])}
        )
        result = correlation_with_mentions(price_df, mention_series, "AAPL")
        assert result != 0.0
        assert result == pytest.approx(1.0, abs=0.05)   # near-perfect positive corr