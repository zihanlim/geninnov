-- 061_credit_beta_standard_errors.sql
-- Standard errors for the marginal (FF5+UMD-orthogonalised) credit-beta fit.
--
-- marginal_r2 is the JOINT fit's r-squared, dominated by the six equity
-- factors, and stays high even when marginal_beta_ig / marginal_beta_qual are
-- pure noise: residualising a leg against FF5+UMD leaves a SMALL-VARIANCE
-- regressor, and regressing a noisy single-name return on it yields large,
-- imprecisely-estimated coefficients (measured 2026-07-30: 23 of 62 assets
-- carry |marginal_beta_ig| > 10, and none of a hand-checked six-name sample
-- clears |t| >= 2). r2_marginal cannot police this because it never isolates
-- the credit legs' own precision. See ADR-0193.
--
-- The STANDARD ERROR is stored, not the t-statistic: it is the primitive, a
-- t-stat is a derived ratio against a caller-chosen threshold, and storing
-- only the derived quantity would bake in one threshold's choice and discard
-- what a reader needs to compute a confidence interval or pick a different
-- bar. `scenario_analysis.py`'s significance gate divides beta by this SE.

ALTER TABLE credit_rates_exposures
  ADD COLUMN IF NOT EXISTS marginal_se_ig   REAL,
  ADD COLUMN IF NOT EXISTS marginal_se_qual REAL;
