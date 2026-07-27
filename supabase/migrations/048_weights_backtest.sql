-- 048_weights_backtest.sql
--
-- What THESE weights would have done, in a column that cannot be mistaken for what we did.
--
-- The book is three sessions old, so every realised path statistic is withheld: Sharpe
-- needs 60 sessions, historical VaR 100, Calmar a full year. The ex-ante figures added in
-- 047 answer the risk question honestly on day one — they borrow history from the
-- CONSTITUENTS — but they are distributional. They say nothing about the path: drawdown
-- depth, downside asymmetry, or behaviour specifically on days the market falls.
--
-- This holds the published weights fixed across 252 days of constituent returns and reads
-- the path statistics off the result.
--
-- WHY IT IS ITS OWN COLUMN AND NOT A ROW IN portfolio_returns. That table is the realised
-- series /risk renders and pick_outcomes scores against. Writing a simulated series into it
-- would assert the book earned returns it did not. scripts/backfill_regime.py already
-- refuses the same move one layer up — "writing it into research_recommendations would
-- assert the system published on days it did not" — and this is that rule applied to the
-- return series.
--
-- THE PAYLOAD CARRIES ITS OWN CAVEATS, deliberately. `selection_caveat` and
-- `method_caveat` are stored strings, not page copy, because this column is reachable
-- through /ask and the MCP server where page copy does not travel. `is_track_record` is
-- stored as literal false for the same reason: a consumer should not have to infer it from
-- the column name.
--
-- The three things it is weaker for than it looks:
--   1. The weights were chosen KNOWING this history — several holdings entered the
--      universe in migration 032 because they screened well recently, so the window that
--      scores them is the window that informed them.
--   2. Fixed weights: no rebalancing, no drift, no transaction costs. It flatters.
--   3. Coverage: `coverage_share` reports how much of book gross the frame could price.
--      A path statistic over 60% of the book is not a path statistic about the book.
--
-- Written by backend/services/q1_agent.finalise_book_analytics over
-- backend/services/weights_backtest.backtest_weights, reusing the returns frame already
-- hoisted for the covariance — no extra fetch.
--
-- See docs/adrs/0112.

BEGIN;

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS weights_backtest JSONB;

COMMENT ON COLUMN research_recommendations.weights_backtest IS
    'Path statistics for the published weights held FIXED over 252 days of constituent '
    'returns. NOT a track record and never derived from portfolio_returns: the weights '
    'were chosen knowing this window, there is no rebalancing and no cost, and '
    'is_track_record is stored false. The forward record is pick_outcomes (ADR-0090).';

ALTER TABLE research_recommendations ENABLE ROW LEVEL SECURITY;

COMMIT;
