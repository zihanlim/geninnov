-- market_assets: group the tape, and record which SESSION each quote closed in.
--
-- The homepage tape was five US tickers ordered by a hardcoded list in the
-- frontend (`MarketBar.DISPLAY_ORDER`). Adding Europe / Asia / FX / crypto /
-- futures behind a toggle needs the grouping to live with the data, or the
-- backend's ticker list and the frontend's group map become two lists that
-- must agree and nothing fails when they stop agreeing.
--
-- `as_of` is the TRADING DATE of the `current` close, and it is the column
-- this change most needs. `updated_at` is when the pipeline wrote the row, so
-- every row carries the same timestamp whatever session it came from — fine
-- for one market, actively misleading across six. The Nikkei's close and the
-- S&P's close on the same calendar date are ~15 hours apart; FX and crypto
-- have no close at all and are simply the last print the daily bar carried.
-- `fetch_market_assets` already had this date in hand (`vals[0]["date"]`) and
-- was discarding it.
--
-- Nullable, deliberately (ADR-0066): the four rows already in this table were
-- written before the column existed and their session date is not recoverable
-- from the row. NULL is "not recorded", which is what happened; back-filling
-- them with `updated_at::date` would assert a session the pipeline never
-- stored.

ALTER TABLE market_assets
    ADD COLUMN IF NOT EXISTS market_group TEXT NOT NULL DEFAULT 'US',
    ADD COLUMN IF NOT EXISTS sort_order   INT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS as_of        DATE;

COMMENT ON COLUMN market_assets.market_group IS
    'Tape group the ticker belongs to: US | Europe | Asia | Currencies | Crypto | Futures. Written from RIBBON_GROUPS in backend/data/macro_fetcher.py, which is the single source of both membership and order.';

COMMENT ON COLUMN market_assets.sort_order IS
    'Position within market_group. Ordering is data, not a frontend constant — the display list and the fetch list were otherwise two lists that had to agree.';

COMMENT ON COLUMN market_assets.as_of IS
    'Trading date of the `current` close, from macro_daily_history. NOT updated_at, which is when the pipeline wrote the row and is identical across every market on the tape. NULL where the row predates this column.';

COMMENT ON TABLE market_assets IS
    'Latest close + daily % change per ticker for the homepage tape, grouped by market_group. Daily closes from the 21:30 UTC pipeline run — never live intraday quotes.';
