-- 056: the held book -- what a portfolio running this research would actually own.
--
-- WHAT WAS WRONG
-- --------------
-- backend/services/portfolio.py:
--
--     def compute_daily_return(positions):
--         return sum(compute_daily_contributions(positions).values())
--
-- Weight x price return, no cost term, and compute_cumulative_return chains those
-- unmodified. The published book reconstitutes itself every run: measured turnover
-- between 2026-07-27 and 2026-07-28 was 51.0% one-way, and the observed range runs
-- to 77%.
--
-- Priced with this repo's OWN cost model (cost_model.py: 10bps commission + 5bps
-- half-spread), 51% daily turnover costs 0.0765%/day -- about 19% per YEAR. At 77%
-- it is roughly 29%/yr. The series on /risk was not overstated by a rounding
-- difference; it was overstated by more than most strategies earn.
--
-- rebalance_cost already existed and priced the WRONG delta -- the optimizer's
-- adjustment within a single run (conviction book -> published book), not
-- yesterday's book -> today's. Nothing measured the cost of running this.
--
-- WHAT THIS TABLE IS
-- ------------------
-- A recommendation has no P&L. A portfolio does. This is the book that is HELD:
-- carried across runs, moved toward each day's recommendation, charged for the
-- move, with a NAV that compounds.
--
-- WHY tracking_error IS CURRENTLY ZERO
-- -----------------------------------
-- The held book fully rebalances to the target, because a turnover BUDGET is a
-- portfolio-construction decision whose value would have to come from somewhere.
-- OptimizerConstraints has carried a max_turnover field since ADR-0107 and nothing
-- has ever set it -- there is no measured basis in this repo for any number.
-- Choosing one to make the held book look more realistic would be fitting a
-- parameter to an aesthetic, which ADR-0047 warns turns a threshold into a
-- statement about the day's numbers rather than about the rule.
--
-- So the real defect (a return series that pretends trading is free) is fixed, and
-- the modelling choice that needs its own argument is left as a parameter with no
-- invented value. held_book.rebalance() already accepts a budget when one is
-- justified. tracking_error is stored anyway, at zero: a column that appears only
-- when non-zero is a column nobody knows to look for.
--
-- WHAT IT DOES NOT TOUCH
-- ----------------------
-- portfolio_returns and portfolio_cumulative_return are left alone. ADR-0112 drew
-- this line for the weights backtest -- "a simulated series written into it would
-- assert the book earned returns it did not" -- and the same rule binds here. This
-- is a NEW series in its own table, and the two are compared rather than merged.
--
-- See ADR-0150.

CREATE TABLE IF NOT EXISTS book_holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date DATE NOT NULL,

    -- SIGNED share of capital: negative for shorts. Signed rather than a magnitude
    -- plus a side, because turnover is computed by differencing these and a
    -- direction flip must read as the full distance travelled. Unsigned weights
    -- would price a +10% -> -6% flip as 4% of turnover instead of 16% (ADR-0101).
    asset TEXT NOT NULL,
    signed_weight REAL NOT NULL,

    -- What the recommendation asked for on this date, kept beside what was held so
    -- the gap is auditable rather than inferred by joining two tables.
    target_weight REAL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (run_date, asset)
);

CREATE INDEX IF NOT EXISTS idx_book_holdings_run_date ON book_holdings (run_date DESC);

-- One row per run: the P&L of the held book on that date.
CREATE TABLE IF NOT EXISTS book_holdings_performance (
    run_date DATE PRIMARY KEY,

    -- One-way turnover as a share of capital, and what it cost. This is the figure
    -- that was missing entirely.
    turnover REAL,
    cost_pct REAL,
    cost_usd REAL,

    -- BOTH are stored. A reader comparing this to portfolio_returns needs to see
    -- exactly what the cost term removed, and a single net figure hides it.
    gross_return REAL,
    net_return REAL,

    -- Compounds. NOT total_capital * (1 + cumulative), which is what
    -- portfolio_returns.portfolio_value recomputes each day.
    nav REAL,

    -- Distance between the held book and the recommendation, in summed absolute
    -- weight. Zero while the book fully rebalances -- see the note above.
    tracking_error REAL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE book_holdings IS
    'The HELD book: signed weights actually owned on each run_date, carried forward '
    'and rebalanced toward the published recommendation. Distinct from '
    'research_recommendations.picks, which is what was RECOMMENDED. See ADR-0150.';

COMMENT ON TABLE book_holdings_performance IS
    'Daily P&L of the held book, NET of transaction costs priced on the real '
    'day-over-day weight delta. Distinct from portfolio_returns, which is gross of '
    'costs on a book that reconstitutes itself every run -- measured turnover 51%% '
    'one-way, costing roughly 19%% a year at cost_model.py assumptions. The two '
    'series are compared, never merged (ADR-0112''s rule). NAV compounds.';

COMMENT ON COLUMN book_holdings_performance.gross_return IS
    'Before costs. Stored so the cost term is visible rather than only its effect.';

COMMENT ON COLUMN book_holdings_performance.tracking_error IS
    'Summed |held - target|. Zero while the book fully rebalances; stored anyway so '
    'the field exists before there is a turnover budget to make it non-zero.';

ALTER TABLE book_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON book_holdings
    FOR SELECT TO anon USING (true);

ALTER TABLE book_holdings_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON book_holdings_performance
    FOR SELECT TO anon USING (true);
