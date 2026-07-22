-- 014_cumulative_return.sql
-- One row per as_of date with the full compounded cumulative return since
-- inception. Populated by scripts/daily_refresh.py after the L4 stage via
-- backend.services.portfolio.compute_cumulative_return.

BEGIN;

CREATE TABLE IF NOT EXISTS portfolio_cumulative_return (
    as_of                  DATE         PRIMARY KEY,
    inception_date         DATE         NOT NULL,
    cumulative_value       NUMERIC      NOT NULL,
    compounded             BOOLEAN      NOT NULL DEFAULT TRUE,
    daily_returns_count    INT          NOT NULL,
    source_first_run_id    TEXT,
    source_last_run_id     TEXT,
    computed_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portfolio_cumulative_return_inception_date_idx
    ON portfolio_cumulative_return (inception_date);

COMMENT ON TABLE portfolio_cumulative_return IS
    'L4-derived cumulative portfolio return since inception, one row per '
    'as_of date. Upserted daily by scripts/daily_refresh.py.';

COMMIT;
