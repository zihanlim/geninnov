-- 059: the turnover cap becomes a live constraint, not a dormant field.
--
-- WHAT WAS WRONG
-- --------------
-- `OptimizerConstraints.max_turnover` has existed in optimizer.py since ADR-0107
-- and nothing has ever set it. `backend/services/held_book.py`'s own module
-- docstring named the gap explicitly: "A turnover budget is a real
-- portfolio-construction decision that changes what the book IS, and its value
-- would have to come from somewhere... there is no measured basis in this repo
-- for any particular number... When someone can justify a budget, it goes in the
-- mandate and this function already accepts it."
--
-- The cost of leaving it unset was measured on `book_holdings_performance`: mean
-- daily turnover 92.7% over 7 observed sessions, peak 200.0%, cumulative modelled
-- transaction cost 0.973% of capital ($973k), annualising to roughly 35%/year.
-- Gross return -1.26% over that window became net -2.01% after the cost of
-- reconstituting the book. That gap is not a rounding difference; at that
-- turnover it is close to the entire result.
--
-- WHY THIS VALUE AND NOT ANOTHER
-- -------------------------------
-- 0.60 (60%) is a FIRST CUT, an operator decision in the ADR-0037 sense — "the
-- limit values are unchanged... re-specifying them is an operator decision, not
-- an implementation one" — not a fitted optimum. Chosen against the 7 observed
-- sessions: 30.4%, 47.7%, 51.0%, 57.1% and 72.2% cluster below it and are
-- UNAFFECTED by this cap; the two outliers, 141.6% and 200.0%, are cut roughly in
-- half. The cap sits above the typical band on purpose — a constraint that binds
-- on an ordinary day would be indistinguishable from a bug — and the finding this
-- fixes is the outliers, whose cost dominates the mean turnover the 35%/yr drag
-- was computed from.
--
-- WHAT CHANGING IT DOES
-- ----------------------
-- Nothing until the next 21:30 UTC run, same as every other mandate row (migration
-- 054). The constraint applies ONLY when a prior book exists to measure against
-- (`book_holdings`) — a first published day, or a run where that read failed, is
-- unconstrained rather than treated as a claim the book started from cash.
--
-- See ADR-0173.

INSERT INTO scoring_config (param_name, value) VALUES
    -- Day-over-day distance from yesterday's published book, signed weights
    -- summed absolute. NOT the intra-run figure (this solve vs the conviction
    -- book), which nothing constrains and never has.
    ('max_turnover', '0.60')
-- Idempotent, matching migration 054: this states the value the code now
-- enforces, and must not overwrite an operator's deliberate change to it.
ON CONFLICT (param_name) DO NOTHING;

COMMENT ON TABLE scoring_config IS
    'Tunable scoring weights, lookbacks and MANDATE LIMITS. Read once per run by '
    'daily_refresh.py. The mandate rows (max_single_name_weight, max_sector_weight, '
    'max_geo_weight, max_gross, max_complex_weight, crowded_cap_multiplier, '
    'max_turnover) are mirrored by backend/services/mandate.py, which is the single '
    'source of truth for their fallbacks; mandate-drift.test.ts fails if the frontend '
    'disagrees. Changing one takes effect on the next 21:30 UTC run and never alters '
    'a book already published.';
