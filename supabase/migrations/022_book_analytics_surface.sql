-- 022_book_analytics_surface.sql
--
-- Make the book-construction analytics reachable from the frontend.
--
-- Three defects this closes, all found by auditing the live deployment:
--
-- (1) `/research` renders "No Q1 recommendations yet" unconditionally, even
--     when a row exists. The page selects `book_metrics_summary` and
--     `scenario_table`, neither of which is a column on
--     research_recommendations, so PostgREST rejects the whole select with
--     400/42703 and the row is never delivered. Rather than add the two text
--     blobs the frontend asked for, we add the STRUCTURED artefacts the agent
--     already computes — a chart cannot be drawn from a preformatted string.
--
-- (2) q1_agent computes book factor tilts, sector/geo cap utilisation, a 252d
--     correlation matrix and four stress scenarios on every run, formats them
--     into strings for the LLM prompt, and then discards them. They are the
--     most decision-relevant quant output in the system and have never been
--     persisted. These columns are their home.
--
-- (3) `/` and `/portfolio` both query `portfolio_factor_exposure`, which does
--     not exist (404/PGRST205), so both factor panels render "Awaiting factor
--     run..." while 36 rows of real betas sit in factor_exposures. The view
--     below is that missing aggregate: one row per run_date carrying the
--     book-weighted FF5+UMD tilt.

BEGIN;

-- ── (1)+(2) structured book analytics on the recommendation row ─────────────

ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS book_metrics JSONB,
    ADD COLUMN IF NOT EXISTS scenario_results JSONB,
    ADD COLUMN IF NOT EXISTS correlation_pairs JSONB,
    ADD COLUMN IF NOT EXISTS cap_utilisation JSONB,
    ADD COLUMN IF NOT EXISTS screening_funnel JSONB,
    ADD COLUMN IF NOT EXISTS lens TEXT;

COMMENT ON COLUMN research_recommendations.book_metrics IS
    'Structured BookMetrics for the FINAL SIZED book: book_beta_* (FF5+UMD), '
    'gross/net exposure, long/short weight, sector_weights, geo_weights. '
    'Written by q1_agent._persist_to_supabase. Source: book_metrics.compute_book_metrics.';

COMMENT ON COLUMN research_recommendations.scenario_results IS
    'Array of 4 stress scenarios: [{scenario_name, label, description, '
    'estimated_book_return, estimated_dollar_pnl, severity, contribution_breakdown}]. '
    'Source: scenario_analysis.run_scenario_analysis.';

COMMENT ON COLUMN research_recommendations.correlation_pairs IS
    'Array of [{asset_a, asset_b, corr}] for |rho| >= HIGH_CORR_THRESHOLD over a '
    '252d lookback. Source: book_metrics.compute_correlation_matrix.';

COMMENT ON COLUMN research_recommendations.cap_utilisation IS
    'Cap headroom for the risk UI: {single_name: [{key, weight, cap, utilisation}], '
    'sector: [...], geo: [...], violations: [str]}. Derived from BookMetrics '
    'against MAX_SINGLE_NAME_WEIGHT / MAX_SECTOR_WEIGHT / MAX_GEO_WEIGHT.';

COMMENT ON COLUMN research_recommendations.screening_funnel IS
    'Candidate attrition per screen_candidates filter: [{stage, remaining, removed, reason}]. '
    'Answers "what did the system reject, and why" — the first question asked of any '
    'systematic book.';

COMMENT ON COLUMN research_recommendations.lens IS
    'Asset-class lens the book was constructed under (ADR-0015): multi_asset | credit | '
    'rates | equity | fx | commodity. NULL for rows written before lens plumbing.';

-- ── (3) the book-level factor aggregate the frontend has always queried ─────
--
-- One row per portfolio run_date. Betas are weighted by SIGNED weight, so a
-- short position contributes negative exposure — this is a book tilt, not a
-- sum of absolute exposures. Only assets with a usable regression (R^2 >= 0.10)
-- contribute; `coverage` reports what fraction of gross weight that represents
-- so the UI can label a thinly-covered tilt as estimated rather than exact.

DROP VIEW IF EXISTS portfolio_factor_exposure;

CREATE VIEW portfolio_factor_exposure AS
WITH latest_factor AS (
    -- Most recent regression per asset.
    SELECT DISTINCT ON (asset)
        asset, run_date, beta_mkt, beta_smb, beta_hml,
        beta_rmw, beta_cma, beta_umd, r_squared
    FROM factor_exposures
    ORDER BY asset, run_date DESC
),
positioned AS (
    SELECT
        p.run_date,
        p.asset,
        CASE WHEN p.direction = 'short' THEN -p.weight ELSE p.weight END AS signed_weight,
        ABS(p.weight) AS gross_weight,
        f.beta_mkt, f.beta_smb, f.beta_hml,
        f.beta_rmw, f.beta_cma, f.beta_umd,
        f.r_squared,
        f.run_date AS factor_run_date
    FROM portfolio_positions p
    LEFT JOIN latest_factor f ON f.asset = p.asset
)
SELECT
    run_date,
    -- Book tilt: signed-weighted mean beta over the covered sleeve.
    SUM(signed_weight * beta_mkt) FILTER (WHERE r_squared >= 0.10)
        / NULLIF(SUM(gross_weight) FILTER (WHERE r_squared >= 0.10), 0) AS beta_mkt,
    SUM(signed_weight * beta_smb) FILTER (WHERE r_squared >= 0.10)
        / NULLIF(SUM(gross_weight) FILTER (WHERE r_squared >= 0.10), 0) AS beta_smb,
    SUM(signed_weight * beta_hml) FILTER (WHERE r_squared >= 0.10)
        / NULLIF(SUM(gross_weight) FILTER (WHERE r_squared >= 0.10), 0) AS beta_hml,
    SUM(signed_weight * beta_rmw) FILTER (WHERE r_squared >= 0.10)
        / NULLIF(SUM(gross_weight) FILTER (WHERE r_squared >= 0.10), 0) AS beta_rmw,
    SUM(signed_weight * beta_cma) FILTER (WHERE r_squared >= 0.10)
        / NULLIF(SUM(gross_weight) FILTER (WHERE r_squared >= 0.10), 0) AS beta_cma,
    SUM(signed_weight * beta_umd) FILTER (WHERE r_squared >= 0.10)
        / NULLIF(SUM(gross_weight) FILTER (WHERE r_squared >= 0.10), 0) AS beta_umd,
    -- Provenance for the UI: how much of the book the tilt actually describes.
    COALESCE(
        SUM(gross_weight) FILTER (WHERE r_squared >= 0.10) / NULLIF(SUM(gross_weight), 0),
        0
    ) AS coverage,
    COUNT(*) FILTER (WHERE r_squared >= 0.10) AS assets_covered,
    COUNT(*) AS assets_total,
    MAX(factor_run_date) AS factor_run_date
FROM positioned
GROUP BY run_date;

COMMENT ON VIEW portfolio_factor_exposure IS
    'Book-level FF5+UMD tilt, one row per portfolio run_date. Signed-weighted so '
    'shorts reduce exposure. Only R^2 >= 0.10 regressions contribute; `coverage` is '
    'the share of gross weight they represent — render the tilt as estimated when '
    'coverage < 1. Queried by frontend/app/page.tsx and app/portfolio/page.tsx, '
    'which previously 404d against a table that never existed.';

-- Views inherit RLS from their base tables when created by a non-superuser, but
-- be explicit for the anon read path the frontend uses.
GRANT SELECT ON portfolio_factor_exposure TO anon;

COMMIT;
