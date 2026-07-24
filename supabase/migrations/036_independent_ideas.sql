-- 036_independent_ideas.sql — ADR-0048
--
-- Q1 asks for five long and five short trades. The book has answered with fewer for
-- many iterations and the reason kept moving: first the universe was too narrow,
-- then the attention gate was discarding whole themes (ADR-0046). With the gate
-- fixed the pool reached 39 names — 27 long, 12 short — and the book still came back
-- 4 and 3.
--
-- Measured on 2026-07-25 at the same rho 0.70 the rest of the site uses:
--
--   LONG : 27 candidates -> 13 independent ideas
--            ONE IDEA: AGG, EEM, EFA, EMB, EWJ, IEF, IWM, QQQ, SHY, SPY, SVXY, TLT
--            ONE IDEA: CVX, XLE, XOM
--            ONE IDEA: OIH, SLB
--            + 10 standalone names
--   SHORT: 12 candidates ->  5 independent ideas
--            ONE IDEA: GDX, GLD, IAU, NEM, SLV   (precious metals)
--            ONE IDEA: BABA, FXI, KWEB, MCHI     (China internet)
--            + PDD, NOC, ARKK standalone
--
-- So twelve short candidates were never twelve short ideas — but they ARE five, and
-- five is exactly what Q1 asks for. The pool stopped being the constraint. The agent
-- was told "fewer if the pool is thin" with no way to know whether it was thin, and
-- nothing on the site stated the number either.
--
-- This column stores the measurement the agent reasoned over, so /book answers "why
-- not five and five?" with that number rather than re-deriving it and risking a
-- different answer on the same day.

ALTER TABLE research_recommendations
  ADD COLUMN IF NOT EXISTS independent_ideas jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN research_recommendations.independent_ideas IS
  'ADR-0048: per side, how many genuinely separate bets the candidate pool held — {long|short: {count, names, complexes:[{members,strongest}], standalone:[...]}}. A complex is a connected component of names correlated at or above HIGH_CORR_THRESHOLD over 252 days.';
