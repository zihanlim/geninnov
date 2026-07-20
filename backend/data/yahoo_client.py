import pandas as pd
import yfinance as yf
from datetime import date, timedelta

def fetch_price_data(tickers: list[str], lookback_days: int = 30) -> pd.DataFrame:
    """
    Fetch adjusted close prices for tickers.
    Returns DataFrame with date, ticker, close, return columns.
    return = pct_change from previous close.
    """
    if not tickers:
        return pd.DataFrame(columns=["date", "ticker", "close", "return"])

    end = date.today()
    start = end - timedelta(days=lookback_days + 10)  # extra days for return calc

    data = yf.download(tickers, start=start, end=end, progress=False, auto_adjust=True)

    if data.empty:
        return pd.DataFrame(columns=["date", "ticker", "close", "return"])

    close = data["Close"].dropna(how="all")
    returns = close.pct_change().dropna()

    rows = []
    for ticker in close.columns:
        for dt, val in close[ticker].items():
            if pd.isna(val):
                continue
            ret = returns.loc[dt, ticker] if ticker in returns.columns and dt in returns.index else None
            rows.append({
                "date": dt.date() if hasattr(dt, "date") else dt,
                "ticker": ticker,
                "close": val,
                "return": ret,
            })

    return pd.DataFrame(rows)

def correlation_with_mentions(price_df: pd.DataFrame, mention_series: pd.Series, ticker: str) -> float:
    """
    Compute Pearson correlation between daily mention count and daily asset return.
    mention_series: pd.Series with date index, int values (mention count per day).
    Returns correlation coefficient or 0.0 if insufficient data.
    """
    if price_df.empty or mention_series.empty:
        return 0.0

    price_ticker = price_df[price_df["ticker"] == ticker][["date", "return"]].set_index("date")["return"]
    if price_ticker.empty or len(price_ticker) < 5:
        return 0.0

    # Align by date
    common_dates = mention_series.index.intersection(price_ticker.index)
    if len(common_dates) < 5:
        return 0.0

    mentions_aligned = mention_series.loc[common_dates]
    returns_aligned = price_ticker.loc[common_dates]

    return mentions_aligned.corr(returns_aligned)