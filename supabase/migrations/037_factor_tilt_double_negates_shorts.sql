-- portfolio_factor_exposure double-negated short positions.
--
-- The view (migration 022) signs each position's beta contribution with
--     CASE WHEN p.direction = 'short' THEN -p.weight ELSE p.weight END
-- which is only correct if portfolio_positions.weight is stored UNSIGNED. It is not:
-- `reconcile_positions_to_book` in daily_refresh.py writes the pick's SIGNED weight
-- (negative for shorts), so on the reconciled book — the one /book actually
-- publishes — a short's -p.weight becomes -(-0.08) = +0.08. The view therefore added
-- short betas as if they were longs.
--
-- Caught on 2026-07-25: `/`'s FACTOR TILT OF BOOK read MKT-RF +1.00 for a long-short
-- book whose true value-weighted market beta is -0.35 (net short — the China shorts
-- BABA/PDD carry ~1.3 beta and should REDUCE exposure). Every factor was wrong, most
-- with the sign flipped (SMB -0.18 vs +0.25 true, CMA +0.41 vs -0.35 true). A book
-- presented as market-neutral was showing a full unit of market beta.
--
-- Fix: sign by DIRECTION over the magnitude — CASE ... THEN -ABS(p.weight) ELSE
-- ABS(p.weight) — which is correct whether weight is stored signed (reconciled book)
-- or unsigned (the L1 provisional pool the pipeline writes first). Output columns are
-- unchanged, so CREATE OR REPLACE is a metadata-only swap with no window where the
-- view is absent.

CREATE OR REPLACE VIEW portfolio_factor_exposure AS
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
        -- Sign by direction over |weight|, robust to whether weight is stored signed
        -- (reconciled book) or unsigned (L1 pool). See migration header.
        CASE WHEN p.direction = 'short' THEN -ABS(p.weight) ELSE ABS(p.weight) END AS signed_weight,
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
    'Book-level FF5+UMD tilt, one row per portfolio run_date. Signed by DIRECTION over '
    '|weight| (migration 037) so shorts reduce exposure regardless of the stored weight '
    'sign; the original -p.weight double-negated the reconciled book, whose weights are '
    'already signed. Only R^2 >= 0.10 regressions contribute; `coverage` is the share of '
    'gross weight they represent — render the tilt as estimated when coverage < 1. '
    'Queried by frontend/app/page.tsx.';
