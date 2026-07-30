# ADR-0190: A credit and duration factor, in two variants, arrives as a shadow signal

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md), [ADR-0093](0093-a-published-book-that-changes-must-say-so.md), [ADR-0055](0055-an-acceptance-battery-for-the-model-that-writes-the-book.md), [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0143](0143-the-price-link-gate-and-what-it-refuses-to-say.md), [ADR-0015](0015-lens-mode-asset-class.md)

## Context

An external PM critique of this repo was verified claim by claim on 2026-07-30
(`research/20260730_222516_andromeda_pm_review/corrections.md`). About a third of it was
false, stale, or cited ADRs that do not exist. Two claims survived verification. The first —
the tradeable universe cannot express a credit book, every credit instrument is an ETF — is
not addressed here. The second is finding #10, and the corrections file says it plainly:

> `factor_fetcher.py` is FF5+UMD only. No credit or rates factor exists anywhere in the repo.
> **TRUE.** ... The deepest structural gap, and the critique buries it in a sub-paragraph.
> Every credit position enters risk, sizing, scenarios and attribution as an equity-beta
> object. No lens change produces a spread beta.

Concretely: TLT is described today by a market beta, an SMB tilt and an HML tilt. All three
are measured correctly and none is useful. Its duration — the number that actually explains
its returns — is measured nowhere. Switching the L5 `lens` to `credit` ([ADR-0015](0015-lens-mode-asset-class.md))
filters the candidate pool; it does not change the risk model under the names it admits.

This is the enabling piece for two decisions that follow and are deliberately not made here:
a fallen-angel stress scenario that transmits through a measured spread beta rather than a
hand-set per-asset shock, and publishing the credit-lens book with its risk stated in credit
terms instead of SMB and HML. Both need a spread and duration beta to exist before either can
be decided.

## Decision

**Build `backend/services/credit_rates_exposures.py` (L2b) and `credit_rates_exposures`
(migration 060): three legs, two variants, NULL-with-a-status, sizing nothing.**

**Why a credit factor at all.** Finding #10 is the reason, not a general appetite for more
factors. A credit PM's first question about any position — what is its spread and rate
sensitivity — currently has no answer anywhere in the stack, and no lens change produces one.
Three legs are estimated: `d_ust10` (DGS10, level/duration), `d_ig` (IG OAS, broad credit
risk premium), `d_qual` (HY OAS minus IG OAS, the distress/quality premium — a gap, not a
third raw series, because HY and IG OAS move together at ~0.9 correlation and including both
raw reproduces the exact collinearity the marginal variant exists to remove). All three are
differenced day-over-day and expressed in basis points, signed so positive means worse for a
bondholder.

**Why a duration leg at all, when the critique asked for credit.** Three reasons, and the
third is decisive. The rates sleeve is currently invisible to the risk model and is a large
part of any credit book. Credit ETF returns are jointly driven by rates and spreads, so
estimating spread sensitivity without controlling for rates attributes rate moves to spreads.
And duration is the only leg with a **known correct answer** — TLT's ~17-year effective
duration, IEF's ~7.5, SHY's ~1.9 — which is what makes the acceptance fixture (spec §9,
below) possible at all. A spread beta has no external anchor to check a regression against;
duration does.

**Why total and marginal, both, stored together.** This is the `frontend/lib/risk/varMethods.ts`
pattern ([ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md)): several numbers
that all answer "what is the risk here" and differ by method, shown side by side rather than
collapsed into one. `total_beta_*` is three separate univariate fits (`r = alpha + beta*leg +
epsilon`) — the number a credit PM recognises and can check against published fund data, but
it includes whatever the equity factors would also have explained, so it double-counts with
`beta_mkt` in any scenario that shocks both. `marginal_beta_*` residualises each leg on
FF5+UMD first, then enters the three residuals into one joint fit alongside the six equity
factors — statistically clean, stable, and the variant a future stress scenario must transmit
through. Neither variant alone is both interpretable and safe to compose with the existing
equity-factor risk model; both are kept, each carrying its own method and basis, exactly as
the four VaRs on `/risk` do.

**Why orthogonalised rather than raw.** Appending the three raw legs to the existing FF5+UMD
regression would shift every published `beta_mkt`, `beta_smb`, etc. in `factor_exposures` —
an [ADR-0093](0093-a-published-book-that-changes-must-say-so.md) event, since that table's
values change and no consumer expects them to move today. Residualising each leg on FF5+UMD
first and fitting the residuals means the joint regression adds no new factor to the equity
block: nothing in it is re-estimated, so the published betas stay bit-identical. This is the
obligation **avoided**, not discharged — the equity block genuinely does not move, rather
than moving with a revision recorded after the fact.

**Why the duration leg is what makes this falsifiable.** The acceptance fixture (design spec
§9) writes seven assertions down before the code runs: TLT/IEF/SHY total-duration betas
against their known values, HYG vs LQD on the quality leg, LQD and SPY loading on IG. The
**last row is load-bearing**: `SPY.marginal_beta_ig` must sit near zero (`|b| < 0.3`) while
`SPY.total_beta_ig` is materially negative. If total and marginal did not diverge for SPY, the
residualisation would not be doing anything and the entire two-variant design would be
decoration — a spread beta alone has no external anchor to check against, so without the
duration leg's known answer this entire acceptance test has nothing to be wrong against.

**Why a generic OLS extraction came first.** The original plan text said this module "imports
`rolling_regression` from `backend/data/factor_fetcher.py`." That claim was unsupportable as
written: `rolling_regression` is specialised to the FF5+UMD coefficient names
(`beta_mkt`, `beta_smb`, ...) and returns exactly that shape, while this module needs a
generic single- or multi-column fit under caller-chosen names, called both on raw returns
(total variant) and again inside `_residualise` (marginal variant's own internal regression
against FF5+UMD). So `backend/data/_ols_core.py` was extracted first: `ols_window` +
`rolling_ols`, the one OLS implementation in the repo. `rolling_regression` is now a thin
wrapper that maps the generic coefficient names back onto the legacy `beta_*` shape, and is
pinned bit-identical to its pre-extraction output by a golden snapshot test at `1e-10` across
all eight keys (`tests/backend/test_factor_fetcher.py`) — so `factor_exposures`, the table
every existing consumer reads, provably did not move underneath this change.

**Why shadow on arrival.** This is how every new signal has entered this repo:
`narrative_tracker` ships "Shadow: sizes nothing" ([ADR-0128](0128-a-theme-we-did-not-name-in-advance.md));
`discovered_themes` persists as `status='shadow'` with no auto-promotion; `volatility_models`
is wired in as reporting-only, deliberately not the conviction denominator. `daily_refresh.py`
calls this service after L2, writes rows, and stops there. There is no call site in
`scenario_analysis.py`, `book_metrics.py`, `optimizer.py` or `expected_returns.py`. The
benefit is the same each time: the measurement is independently verifiable — against a
fixture and a SQL query — before any consumer's behaviour depends on it being right. S (the
fallen-angel scenario) and B (the credit-lens book) each opt in deliberately, in their own
ADR, once this has run in production and been checked.

**Betas are NULL-with-a-status, never 0.0.** Precedent: `expected_returns.py`
([ADR-0108](0108-expected-returns-are-constructed-not-assumed.md)) — no measured IC means no
mu, never a defaulted IC of zero — and `narrative_price_link.py`
([ADR-0143](0143-the-price-link-gate-and-what-it-refuses-to-say.md)) — below the session
floor, `insufficient_history` is the verdict itself. A zero beta here would assert "this
asset is insensitive to rates," which is false for exactly the assets most likely to fail
estimation (too little history, a singular design matrix). `status` is
`measured` / `insufficient_history` / `degenerate`, a CHECK constraint on the table, and it
travels with the row to every future consumer rather than living in a side channel that one
consumer could forget to check.

**The explicit deferral of the TS map entry.** The design spec (§7) called for registering
`MIN_SESSIONS = 252` in `frontend/lib/risk/sampleAdequacy.ts`'s `MIN_SESSIONS_BY_FIELD`
alongside the Python constant, per [ADR-0100](0100-a-guard-that-lives-in-a-component-guards-one-consumer.md).
That was **not done**, and the omission is deliberate rather than a miss: that map is keyed by
`portfolio_risk` columns, and credit betas live in a different table
(`credit_rates_exposures`) that nothing on the frontend reads today. Adding an entry for a
field with no reader would be a guard with nothing to guard. More importantly, the in-row
`status` column already travels with the data to **every** future consumer — `/ask`, MCP, a
future `/risk` panel — which is a *stronger* guarantee than a lookup table a caller must
remember to consult, and it cannot be forgotten the way a second copy in a TS map can drift
from the Python source it mirrors. The TS entry is left for sub-project B, if and when these
betas are served to a reader without their `status` travelling alongside them.

## Consequences

- **A defect was found and is worth recording, because it is the kind this repo keeps
  finding.** The first implementation regressed DECIMAL asset returns (`close.pct_change()`)
  directly against BASIS-POINT legs (`diff() * 100`). For a 17-year bond the fitted
  coefficient came out as **-0.0017** — arithmetically correct and, to anyone who does not
  know the convention, indistinguishable from "no rate sensitivity." The plan text itself
  carried the same defect. The first attempt at a fix moved it the other way: dividing the bp
  leg by 100 recovers -0.17, and removing the division entirely recovers -17 — from a
  generating process in which a **one basis point move costs 1700%** of the bond's value.
  **Both of those made the test assertion pass. Neither was the physics.** The fix converts
  both sides at the fit through two named constants, `_PCT_PER_DECIMAL` and `_BP_PER_100BP`,
  rather than one bare `10000` nobody could dimension-check by reading it, and a regression
  test states the fact about the world rather than about the code: a 25bp move on a 17-year
  bond costs it ~4.25% (`test_a_realistic_daily_move_produces_a_realistic_daily_return`), so
  the recovered beta must land at -17 and the implied one-day loss at ~-4.25% — not 0.04% and
  not 425%.
- **`factor_exposures` is provably untouched.** The golden snapshot test on
  `rolling_regression` and the residualisation design together mean two different guarantees
  compose: the OLS engine changed under the hood, and the equity factor block that consumes
  it did not move.
- **The table is independently verifiable before it drives anything.** All seven §9
  assertions pass against a frozen 2026-07-31 fixture, including the load-bearing SPY
  divergence. `scripts/backfill_macro.py` (mirroring `backfill_regime.py`'s dry-run /
  `--apply` / `--overwrite` contract) extends `macro_daily_history` to ~3 years for the three
  FRED legs, because at the live ~255-observation depth a 252-day lookback was one bad
  intersection away from unusable and would have succeeded on some assets while silently
  skipping others.
- **No UI reads this table today, and none is built here.** Building a `/risk` panel now
  means building it twice once B restructures those surfaces around the credit lens.
- **What this is not, and must keep being stated wherever these figures render:** an
  empirical regression beta over 252 days, not analytic cash-flow-weighted spread duration;
  ETF-level, not issuer-level; one macro regime (2023-2026), not a duration through a full
  credit cycle. None of this narrows the critique's first surviving claim — the universe still
  cannot express a single-name credit book. It answers the second.
- **What remains open.** Whether S transmits through `marginal_beta_*` and whether B publishes
  a credit-lens book that states its risk in these terms are both separate decisions, each
  needing its own ADR, deliberately not made by this one.
