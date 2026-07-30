# ADR-0193: A measured credit beta must clear its own standard error before it can stress the book

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0190](0190-credit-rates-exposures-shadow-on-arrival.md), [ADR-0192](0192-a-fallen-angel-transmits-through-measured-not-hand-set-shocks.md), [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md), [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md)

## Context

[ADR-0192](0192-a-fallen-angel-transmits-through-measured-not-hand-set-shocks.md) wired
`S7_fallen_angel` to transmit through `marginal_beta_ig` / `marginal_beta_qual`
(`backend/services/credit_rates_exposures.py`, L2b) unconditionally: any asset with a
`status='measured'` row and both legs non-NULL had its beta multiplied straight into the
scenario's P&L. That measurement was never tested for whether it is distinguishable from
zero, and it should have been — the marginal variant is constructed in a way that makes
noise, not signal, the likely outcome for most assets.

**The mechanism.** `compute_marginal_betas` residualises each credit leg (`d_ig`, `d_qual`)
against FF5+UMD before the joint fit, specifically so the coefficient does not double-count
with the equity factors (ADR-0190's stated reason for the marginal variant existing at all).
Residualising removes the leg's shared variance with six factors that explain most of a
typical asset's daily return — what remains is a SMALL-VARIANCE regressor. Regressing a
noisy single-name equity return on a small-variance regressor is exactly the setup that
produces a large, imprecisely-estimated coefficient: the point estimate can be big because
the denominator (the regressor's own variance) is small, not because the relationship is real.

**Measured, by hand, on the live 2026-07-30 rows** (t = beta / se):

| asset | beta_ig | std_err | t |
|---|---:|---:|---:|
| GEV | -24.09 | 18.45 | -1.31 |
| GLD | +16.90 | 11.03 | +1.53 |
| JD  | +14.28 | 13.26 | +1.08 |
| SMH | -13.03 |  7.52 | -1.73 |
| UNG | -12.62 | 26.24 | -0.48 |
| SPY |  -0.33 |  0.37 | -0.91 |

Not one of the six clears |t| = 2. More broadly: **23 of the 62 assets with a `status='measured'`
row carry |marginal_beta_ig| > 10** — a claim that a 100bp move in IG spreads moves that equity
more than 10%, which is not a credible magnitude for any of these names. S7_fallen_angel was
computing a stress P&L from these numbers as if they were established sensitivities.

**Why `marginal_r2` cannot be the gate.** It is tempting to reach for the r² already stored on
the row. It cannot serve: `marginal_r2` is the r² of the JOINT fit — six equity factors plus
three credit-leg residuals — and is dominated by the equity block. A fit can have `marginal_r2`
near 1.0 (the equity factors alone explain almost all the variance) while the two credit
coefficients inside that same fit are pure noise around zero, because the equity block's
explanatory power says nothing about the precision of a specific coefficient buried inside a
joint model. A dedicated statistic — the coefficient's own standard error — is required.

## Decision

**Compute and persist the standard error of `marginal_beta_ig` / `marginal_beta_qual`; gate
`S7_fallen_angel`'s transmission on `|beta / se| >= 2.0`, per leg; treat a beta that fails the
gate exactly as if the row did not exist, never as a zero.**

1. **`backend/data/_ols_core.py::ols_window`** now returns a namespaced `_se` key:
   `se = sqrt(diag(s2 * pinv(X'X)))`, `s2 = RSS / (n - k)`, `k` = design-matrix columns
   including the intercept. `np.linalg.pinv` (not `inv`), wrapped in `try/except`, so a
   near-singular covariance degrades the SE to NaN rather than raising — the coefficient fit
   can still be trusted even when its own precision cannot be estimated.
   `backend/data/factor_fetcher.py::rolling_regression` builds its output dict by explicitly
   picking legacy keys, so `_se` does not leak into it; the pre-existing golden bit-identical
   test (`tests/backend/test_factor_fetcher.py::TestRollingRegressionExtraction`) still passes
   unchanged, and a new test pins the containment property directly.

2. **Migration 061** adds `marginal_se_ig` / `marginal_se_qual` (both `REAL`, nullable) to
   `credit_rates_exposures`. `compute_marginal_betas` returns `se_ig` / `se_qual` from the same
   joint fit the betas already come from (no extra regression, no extra network cost);
   `assemble_row` writes them, NULL on a NaN input, exactly like the betas themselves.

   **The STANDARD ERROR is stored, not the t-statistic.** The SE is the primitive
   measurement; a t-stat is a derived ratio against a threshold someone else picks. Storing
   only the t would bake in `CREDIT_BETA_T_THRESHOLD`'s specific value as the only question
   the stored data can answer, and would discard what a future reader needs to compute a
   confidence interval or apply a different bar. Every consumer — today only
   `scenario_analysis.py` — divides beta by SE itself.

3. **`scenario_analysis.py` gates `_measured_credit_shock`** with a new
   `_credit_beta_significant(beta, se)` predicate and a named module constant,
   `CREDIT_BETA_T_THRESHOLD = 2.0` (approximately the two-sided 95% critical value). The gate
   is applied **per leg**, not per asset: a name can have a believable `beta_ig` and an
   unbelievable `beta_qual` (or vice versa), and only the legs that pass contribute to the
   transmitted shock. A `NULL` or missing SE — a row written before migration 061, before any
   SE was ever computed for it — fails **closed**: treated as not-believable, never as
   significant, never defaulted to some assumed precision.

   **An asset whose beta(s) fail the gate is never assigned a 0.0 shock.** `_measured_credit_shock`
   returns `None` when neither leg clears the bar, and `_resolve_shock` falls through to the
   next tier (`sector_shocks`, then the factor path) exactly as it would for an asset L2b never
   measured at all. Substituting zero would assert "this name has no credit exposure" — the
   opposite of what an insignificant estimate establishes, which is simply that this
   measurement cannot distinguish the exposure from zero.

4. **Coverage now reports two counts, not one.** The existing coverage line
   (`estimate_scenario_pnl`'s `contribution_breakdown`) said "N of M held names measured" —
   true, but no longer the useful number, since "measured" and "distinguishable from zero" can
   now diverge completely. It now reports **both**: how many held names have a `status='measured'`
   row with both legs non-NULL (the old count, renamed to make clear what it does and does not
   claim), and how many of those clear the significance gate and actually transmit ("believed").
   ADR-0097's coverage-first doctrine — state the denominator, don't let a partial signal read
   as complete — applied to the fact that "measured" alone now overstates what the book can act
   on.

## Consequences

- **The honest result on the live multi-asset book is 1 of 9 held names clearing the gate.**
  Re-running `refresh_credit_rates_exposures` and checking `|beta/se| >= 2` on the 2026-07-30
  rows, per leg, for the 9 names in the published book (GLD, BABA, UNG, ARKK, MSFT, SMH, GEV,
  NUE, JD): only **GEV**'s quality-gap leg clears the bar (`marginal_beta_qual=12.12`,
  `marginal_se_qual=5.20`, t=+2.33) — its own IG leg does not (`marginal_beta_ig=-24.09`,
  `marginal_se_ig=18.45`, t=-1.31), a live instance of exactly the per-leg divergence this ADR's
  design anticipated. The other 8 held names transmit through neither leg and fall back to
  `sector_shocks`/the factor path. Zoomed out to the full 62-asset universe `credit_rates_exposures`
  covers, 16 assets clear the gate on at least one leg (11 via IG, 9 via quality) — and they are
  overwhelmingly literal bond/credit ETFs (LQD, HYG, JNK, ANGL, EMB, AGG, IEF, SHY, BIL) where
  genuine spread and duration sensitivity is the expected result of the fit, not the
  equities/commodities the hand-checked six-asset sample above happened to draw from. This is a
  finding, not a regression, and the threshold was not tuned to manufacture or suppress it;
  ADR-0192's own worked example (`marginal_beta_ig=-6.8`, `marginal_beta_qual=-2.0`, both
  fabricated for the test, not drawn from a live row) remains a valid regression fixture for the
  arithmetic, not a claim about which live assets transmit.
- **S7_fallen_angel's `base_asset_shocks` override (`SVXY: -0.10`) is unaffected** — the override
  tier is checked before the measured tier and never reads a beta or an SE.
- **The six pre-existing scenarios (S1–S6) are untouched.** None declares `credit_leg_shocks`, so
  `_measured_credit_shock` short-circuits before ever calling `_credit_beta_significant`.
- **`total_beta_*` gets no stored SE.** Only the two legs S7 transmits through
  (`marginal_beta_ig`/`marginal_beta_qual`) needed one to make this scenario's transmission
  honest; the total (univariate) variant is documented as never driving a scenario in the first
  place (ADR-0190), so a standard error for it would answer a question nothing asks.
- **What remains open.** If a future consumer (B, the credit-lens book publication) wants to size
  by a marginal credit beta, it inherits this same gate rather than re-deciding significance —
  but that opt-in is still a separate, undecided ADR, per ADR-0190's and ADR-0192's own deferral.

## Alternatives considered

- **Gate on `marginal_r2` instead of a dedicated SE.** Rejected — explained above: the joint
  fit's r² is dominated by the equity block and does not isolate the credit legs' own precision.
  A fit with `marginal_r2 = 0.85` driven entirely by `beta_mkt` would pass any r² floor while its
  `beta_ig`/`beta_qual` remain indistinguishable from zero.
- **Store the t-statistic instead of the SE.** Rejected — a derived quantity bakes in one
  threshold and cannot be recomputed at a different bar or turned into a confidence interval;
  the SE is the primitive and t is one line of arithmetic away from it for any consumer that
  wants it.
- **Zero out an insignificant beta rather than falling through.** Rejected — this asserts a
  specific, false claim ("no credit exposure") in place of an honest "not established", and
  would silently change S7's coverage numerator without any of it being visible in
  `contribution_breakdown`.
- **Gate per-asset (both legs must pass) rather than per-leg.** Rejected — the task's own
  measurement shows this can differ leg-to-leg for the same name, and an asset with one
  believable leg should transmit that leg's real signal rather than being held to an
  all-or-nothing standard that discards it.
