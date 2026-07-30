-- 060_credit_rates_exposures.sql
-- Per-asset sensitivity to duration (DGS10), broad credit (IG OAS) and
-- quality premium (HY-OAS minus IG-OAS). Both an interpretable total
-- (univariate) and an FF5+UMD-orthogonalised marginal variant are stored;
-- see docs/superpowers/specs/2026-07-31-credit-rates-exposures-design.md
-- and ADR-0190.

CREATE TABLE IF NOT EXISTS credit_rates_exposures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset TEXT NOT NULL,
    run_date DATE NOT NULL,
    lookback_days INT NOT NULL DEFAULT 252,

    -- Total (univariate). Percent return per 100bp. NULL when not estimable.
    total_beta_ust10 REAL,
    total_beta_ig    REAL,
    total_beta_qual  REAL,
    total_r2_ust10   REAL,
    total_r2_ig      REAL,
    total_r2_qual    REAL,

    -- Marginal (orthogonalised, joint with FF5+UMD). Percent return per 100bp.
    marginal_beta_ust10 REAL,
    marginal_beta_ig    REAL,
    marginal_beta_qual  REAL,
    marginal_r2         REAL,

    n_obs INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('measured', 'insufficient_history', 'degenerate')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(asset, run_date, lookback_days)
);

ALTER TABLE credit_rates_exposures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON credit_rates_exposures FOR SELECT TO anon USING (true);
