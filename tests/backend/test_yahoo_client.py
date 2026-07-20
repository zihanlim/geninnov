import pandas as pd
import pytest
from backend.data.yahoo_client import fetch_price_data, correlation_with_mentions


class TestFetchPriceData:
    def test_empty_ticker_list_returns_empty_dataframe_with_correct_columns(self):
        result = fetch_price_data([])
        assert result.empty
        assert list(result.columns) == ["date", "ticker", "close", "return"]


class TestCorrelationWithMentions:
    def test_returns_zero_when_price_df_is_empty(self):
        mention_series = pd.Series([1, 2, 3], index=pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]))
        result = correlation_with_mentions(pd.DataFrame(columns=["date", "ticker", "close", "return"]), mention_series, "AAPL")
        assert result == 0.0

    def test_returns_zero_when_fewer_than_5_common_dates(self):
        price_df = pd.DataFrame({
            "date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
            "ticker": ["AAPL", "AAPL", "AAPL"],
            "close": [100.0, 101.0, 102.0],
            "return": [0.01, 0.01, 0.01],
        })
        mention_series = pd.Series([10, 20], index=pd.to_datetime(["2024-01-01", "2024-01-02"]))
        result = correlation_with_mentions(price_df, mention_series, "AAPL")
        assert result == 0.0