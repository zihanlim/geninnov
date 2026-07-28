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

    # timeout: yfinance passes this to the underlying requests call. Without it a
    # stalled Yahoo connection (common when a ticker is delisted and yfinance
    # retries — e.g. DXY) can block the whole daily pipeline indefinitely, since
    # requests has no default timeout. 20s per batch is plenty for a daily job.
    data = yf.download(
        tickers, start=start, end=end, progress=False, auto_adjust=True, timeout=20
    )

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

def correlation_with_mentions(price_df: pd.DataFrame, mention_series: pd.Series, ticker: str) -> float | None:
    """
    Compute Pearson correlation between daily mention count and daily asset return.
    mention_series: pd.Series with date index, int values (mention count per day).

    Returns the correlation coefficient, or **None when it is not measurable** —
    no price history, fewer than 5 overlapping sessions, or a degenerate (constant)
    series. None is not 0.0 and the distinction is load-bearing.

    WHY (ADR-0127): this used to return 0.0 for "not measurable", and the sole
    caller looped over a theme's mapped tickers guarded by ``if not pd.isna(corr)``
    — a test that a 0.0 sentinel can never fail. The loop therefore always took the
    FIRST ticker and broke, even when that ticker had no overlapping sessions and
    seven other mapped instruments did. A third of HypeScore (hype_corr_weight =
    0.30) rested on an arbitrary single instrument, and could be a hard zero while
    the theme was in fact strongly correlated across four asset classes.

    Returning None makes "we could not measure this" un-ignorable at the call site:
    it cannot be averaged, compared, or mistaken for a measured absence of
    correlation.
    """
    if price_df.empty or mention_series.empty:
        return None

    price_ticker = price_df[price_df["ticker"] == ticker][["date", "return"]].set_index("date")["return"]
    if price_ticker.empty or len(price_ticker) < 5:
        return None

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
        return None

    # NaN here means a constant series on one side (zero variance) — Pearson is
    # undefined, not zero. Same contract as the guards above.
    corr = mentions.loc[common_dates].corr(returns.loc[common_dates])
    return None if pd.isna(corr) else float(corr)