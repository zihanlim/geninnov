-- Seed regime classification for demo (today's date)
-- Will be overwritten by the live regime classifier on next pipeline run
INSERT INTO regime_classifications (
    run_date, cycle, sentiment,
    yield_curve_slope, hy_oas, vix_level, vix_term_diff, real_rate, spx_breadth
) VALUES (
    CURRENT_DATE,
    'mid',
    'neutral',
    20.0,
    320.0,
    18.5,
    -1.2,
    0.75,
    55.0
) ON CONFLICT (run_date) DO UPDATE SET
    cycle = EXCLUDED.cycle,
    sentiment = EXCLUDED.sentiment,
    yield_curve_slope = EXCLUDED.yield_curve_slope,
    hy_oas = EXCLUDED.hy_oas,
    vix_level = EXCLUDED.vix_level,
    vix_term_diff = EXCLUDED.vix_term_diff,
    real_rate = EXCLUDED.real_rate,
    spx_breadth = EXCLUDED.spx_breadth;
