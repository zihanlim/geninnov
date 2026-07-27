-- 047_optimizer_and_extended_risk.sql
--
-- Sizing provenance + the risk estimators this repo did not have.
--
-- Two separate things, in one migration because they land in the same change and
-- both exist to answer questions the book could not answer before.
--
-- ── 1. WHICH sizing produced this book ──────────────────────────────────────
--
-- `size_positions` now solves a constrained mean-variance problem over the names L5
-- chose, and falls back to the conviction weighting when it cannot. Nothing in the
-- data said which one ran. That is exactly the gap ADR-0053 records: a published book
-- that every surface described as conviction-sized while it was in fact hype-sized,
-- because the method was never persisted beside the weights. `sizing_method` is
-- therefore NOT decoration — it is the field that makes that class of drift visible
-- in the data rather than only in a code review.
--
-- `heuristic_weights` stores the conviction book whether or not it was published, so
-- a reader can SEE what the optimizer changed instead of being told. `rebalance_cost`
-- prices that difference. `efficient_frontier` carries the frontier and the
-- "you are here" point for the published book under the same mu and Sigma.
--
-- ── 2. Risk numbers that are NOT var_95 ─────────────────────────────────────
--
-- Every column below is ADDITIVE. `var_95` stays exactly what it has always been:
-- parametric Gaussian on the book's own realised return series. The new ones are
-- different methods, and in two cases different inputs:
--
--   var_95_historical  empirical quantile of the SAME realised series — no
--                      distributional assumption, so it carries the actual skew
--   es_95_historical   mean of the losses beyond that quantile
--   sortino/calmar/    downside-only ratios and the deepest peak-to-trough on the
--   max_drawdown       compounded path
--   tracking_error/    versus benchmark_returns (ADR-0094), which until now supported
--   information_ratio  a chart line and no measurement
--   monte_carlo_var    ex-ante, from the CONSTITUENTS' covariance, simulated with
--                      Student-t innovations — the only one with a fat tail
--   var_forecast       ex-ante, same covariance, square-root-of-time across
--                      1/5/10/21/63 days. The 21-day point is the horizon a published
--                      pick is actually scored over (ADR-0090) and nothing carried it
--
-- They will disagree with each other, routinely. That is the information. It is also
-- why each is a separate column with its own method id rather than a better value for
-- an existing one — two contradicting VaRs rendered under one label is the regression
-- PROGRESS.md records twice (ADR-0082).
--
-- Note on numbering: 045 is already duplicated across 045_benchmark_returns.sql and
-- 045_sanctions_exposure.sql. 046 is taken. This is 047 — do not add a third collision.
--
-- Written by backend/services/q1_agent._persist_to_supabase and
-- scripts/daily_refresh.compute_and_persist_risk.
--
-- See docs/adrs/0107, 0108, 0109.

BEGIN;

-- ── research_recommendations: sizing provenance ─────────────────────────────

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS sizing_method      TEXT,
    ADD COLUMN IF NOT EXISTS sizing_reason      TEXT,
    ADD COLUMN IF NOT EXISTS optimizer_result   JSONB,
    ADD COLUMN IF NOT EXISTS efficient_frontier JSONB,
    ADD COLUMN IF NOT EXISTS heuristic_weights  JSONB,
    ADD COLUMN IF NOT EXISTS rebalance_cost     JSONB,
    ADD COLUMN IF NOT EXISTS monte_carlo_var    JSONB,
    ADD COLUMN IF NOT EXISTS var_forecast       JSONB;

-- Only the two values the pipeline can produce. A book sized by anything else is a
-- bug, and a free-text column would let it publish silently.
ALTER TABLE research_recommendations
    DROP CONSTRAINT IF EXISTS research_recommendations_sizing_method_check;
ALTER TABLE research_recommendations
    ADD CONSTRAINT research_recommendations_sizing_method_check
    CHECK (sizing_method IS NULL OR sizing_method IN ('optimizer', 'conviction'));

COMMENT ON COLUMN research_recommendations.sizing_method IS
    'Which sizing produced the published weights: optimizer (constrained '
    'mean-variance over L5''s picks) or conviction (|EdgeScore|/vol, ADR-0032). '
    'Persisted because ADR-0053 records a book whose stated sizing and actual '
    'sizing diverged with nothing in the data to catch it.';

COMMENT ON COLUMN research_recommendations.sizing_reason IS
    'Why the optimizer did not run, when it did not. NULL when it did. An absence '
    'must say which kind of absence it is (ADR-0098).';

COMMENT ON COLUMN research_recommendations.heuristic_weights IS
    'The conviction-sized book, stored whether or not it was published, so the '
    'optimizer''s effect is checkable rather than asserted.';

COMMENT ON COLUMN research_recommendations.monte_carlo_var IS
    'Ex-ante, from the constituents covariance, Student-t innovations, seeded so '
    'it is reproducible. NOT portfolio_risk.var_95, which is realised and parametric.';

COMMENT ON COLUMN research_recommendations.var_forecast IS
    'Square-root-of-time VaR fan over 1/5/10/21/63 days. The 21-day point matches '
    'the horizon pick_outcomes scores against (ADR-0090). Assumes IID returns — the '
    'assumption travels in the payload and must be rendered with the number.';

-- ── portfolio_risk: historical, downside and benchmark-relative ─────────────

ALTER TABLE portfolio_risk
    ADD COLUMN IF NOT EXISTS var_95_historical    REAL,
    ADD COLUMN IF NOT EXISTS es_95_historical     REAL,
    ADD COLUMN IF NOT EXISTS sortino              REAL,
    ADD COLUMN IF NOT EXISTS max_drawdown         REAL,
    ADD COLUMN IF NOT EXISTS calmar               REAL,
    ADD COLUMN IF NOT EXISTS tracking_error       REAL,
    ADD COLUMN IF NOT EXISTS information_ratio    REAL,
    ADD COLUMN IF NOT EXISTS benchmark_comparison JSONB,
    ADD COLUMN IF NOT EXISTS conditional_vol      JSONB;

COMMENT ON COLUMN portfolio_risk.conditional_vol IS
    'EWMA (lambda 0.94) and variance-targeted GARCH(1,1) volatility of the book''s '
    'own return series, beside the trailing sample vol for comparison. REPORTING '
    'ONLY: the conviction denominator still uses the sample vol with the ADR-0047 '
    'floor. Swapping the sizing denominator changes every published weight and is a '
    'separate decision.';

COMMENT ON COLUMN portfolio_risk.var_95_historical IS
    'Empirical 95% VaR from the realised series — no normality assumption. A '
    'SEPARATE column from var_95, never a better value for it: the gap between the '
    'two measures how badly the Gaussian assumption fits this book.';

COMMENT ON COLUMN portfolio_risk.max_drawdown IS
    'Deepest peak-to-trough on the compounded path, as a NEGATIVE fraction. '
    'Computed in log space, matching portfolio_cumulative_return.';

COMMENT ON COLUMN portfolio_risk.benchmark_comparison IS
    'Full comparison payload vs benchmark_returns (ADR-0094): active return, '
    'tracking error, IR, beta, correlation, up/down capture, and the n it was '
    'measured over. down_capture is the field that tests the book''s own claim to '
    'be short the market.';

-- Both tables already carry a public-read policy for anon (migrations 027/029 and
-- the table''s own creation); columns inherit it, so no new policy is needed. RLS is
-- asserted here rather than assumed, because a table with RLS disabled would expose
-- the new columns to writes as well as reads.
ALTER TABLE research_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_risk ENABLE ROW LEVEL SECURITY;

COMMIT;
