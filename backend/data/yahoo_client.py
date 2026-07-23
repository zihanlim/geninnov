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

    # Normalize BOTH indices to datetime.date before aligning. The mention series
    # is keyed by ISO strings ("2026-07-23") while price dates are datetime.date;
    # intersecting the two types is ALWAYS empty, so this silently returned 0 for
    # every theme — the 30% correlation weight was dead. (ADR-0028 root cause.)
    def _as_date_index(s: pd.Series) -> pd.Series:
        out = s.copy()
        out.index = pd.to_datetime(out.index, errors="coerce").date
        return out

    mentions = _as_date_index(mention_series)
    returns = _as_date_index(price_ticker)

    common_dates = mentions.index.intersection(returns.index)
    if len(common_dates) < 5:
        return 0.0

    corr = mentions.loc[common_dates].corr(returns.loc[common_dates])
    return 0.0 if pd.isna(corr) else float(corr)