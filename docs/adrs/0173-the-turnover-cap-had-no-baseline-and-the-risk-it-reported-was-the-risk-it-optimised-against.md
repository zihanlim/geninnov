---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0173 — The turnover cap had no baseline, and the risk it reported was the risk it optimised against

## Context

`book_holdings_performance` (ADR-0150) measured what running this book actually
costs: mean daily turnover **92.7%** over 7 observed sessions, peak **200.0%**,
cumulative modelled transaction cost **0.973% ($973k)**, annualising to roughly
**35%/year**. Gross return **−1.26%** over the window became net **−2.01%** after
the cost of reconstituting the book each run. That gap is not a rounding
difference — at that turnover it is close to the entire result.

The capability to fix it already existed and was dormant. `held_book.py`'s own
module docstring named the gap explicitly, unprompted, before this ADR:

> `OptimizerConstraints` has carried a `max_turnover` field since ADR-0107 and
> **nothing has ever set it** — there is no measured basis in this repo for any
> particular number... When someone can justify a budget, it goes in the mandate
> and this function already accepts it.

Two defects sat underneath that dormancy, and fixing the field without finding
both would have fixed nothing.

**The wrong baseline.** The one existing test for the constraint,
`test_turnover_cap_binds`, passed `weights0=start` and asserted the cap bound.
`weights0` is the **conviction book of the same run** — `size_positions`'s own
comment says it is the baseline because `weight_delta` and the frontier's "you are
here" point both need it. So even switched on, the constraint would have capped
the optimizer's **intra-run adjustment**, not day-over-day churn. This is the exact
defect migration 056 documented for `rebalance_cost` one layer along: *"priced the
WRONG delta... the optimizer's adjustment within a single run, not yesterday's book
→ today's."* That migration fixed the **measurement**. The **optimiser was never
re-pointed**.

**The undisclosed bias.** `covariance_from_returns` fed both `optimize()`
(minimising `w'Σw`) and the ex-post VaR/Monte-Carlo report — the same call, at two
sites in `q1_agent.py`. Minimising a quadratic form under a noisy sample Σ
systematically favours the directions where Σ **understates** true covariance
(Markowitz's error-maximisation), so the reported risk on an optimised book was
biased low by the same estimator that sized it, and nothing said so. The asymmetry
was the tell: `expected_returns.py` shrinks μ 50% toward zero (ADR-0033,
`IC_SHRINKAGE`) because an unvalidated signal has no alpha; Σ received no
equivalent treatment. The return side was treated as untrustworthy and the risk
side as exact, with no argument for the difference. This morning's Risk answer row
(ADR-0172) disclosed the asymmetry before either half of this ADR fixed it.

## Decision

**Turnover: a second baseline, applied only when it exists.**

`OptimizerInputs` gains `weights_held` — yesterday's **published** book
(`book_holdings.signed_weight`), fetched once in `run_q1_agent` (mirroring
ADR-0171's own pattern) and carried on `state["weights_held"]` so `size_positions`
stays a pure function of state, exercised directly by several unit tests with a
minimal mock carrying no credentials. `weights0` is untouched and keeps its
existing job. The constraint becomes `‖w − w_held‖₁ ≤ max_turnover`, applied **only
when both `max_turnover` and `weights_held` are present** — absence of a prior book
(first day, or an unreachable read) is not evidence the book should hold still, so
it degrades to unconstrained rather than to a zero-weights claim.

`OptimizationResult` now reports **two** figures, never conflated:
`turnover` (intra-run, unchanged) and `realised_turnover` / `turnover_cap`
(day-over-day, new). Two numbers called "turnover" meaning different things is the
ADR-0082 VaR problem again. Fixed as a consequence: `binding_constraints` was
checking `"turnover at cap"` against the **old** intra-run figure even after the
constraint moved to `weights_held` — a defect that would have mislabelled which
quantity was actually binding.

`Mandate.max_turnover = 0.60` — a first cut, an operator decision in the ADR-0037
sense, not a fitted optimum. Chosen against the 7 observed sessions: 30.4%, 47.7%,
51.0%, 57.1%, 72.2% cluster below it and are **unaffected**; the two outliers,
141.6% and 200.0%, are cut roughly in half. Seeded via migration 059, mirroring
054's pattern exactly (idempotent, effective next 21:30 UTC run, never alters a
published book).

**Covariance: shrink toward constant correlation, at a stated intensity, inside the
one function every consumer already calls.**

`covariance_from_returns` shrinks its output toward a **constant-correlation**
target (Ledoit & Wolf 2003) — keep each asset's own sample **variance**, replace
every pairwise **correlation** with the sample's own average off-diagonal
correlation. Variance is kept because `size_positions` and the VaR/MC path both
read per-asset risk contributions off this matrix; flattening it too would move
single-name risk for no diversification reason.

`COV_SHRINKAGE_INTENSITY = 0.25` is a **fixed constant**, not Ledoit-Wolf's
asymptotically-optimal intensity — deriving that needs the paper's
π̂/ρ̂ estimators, a second nontrivial thing to get right for a marginal gain over a
stated operator choice, and `IC_SHRINKAGE` (50%, fixed, stated) is the nearby
precedent for exactly that call. Wired **inside** `covariance_from_returns` rather
than at each call site, so the optimizer and the risk report cannot diverge on
which Σ is "the" covariance — the property that made the original bias possible in
the first place. Reported as `optimizer_result.cov_shrinkage_intensity`: a shrunk Σ
that does not say how much it shrank is another naked number.

The Risk answer row's fourth card (ADR-0172) now reads the **actual** intensity off
the persisted run rather than asserting a constant. A run predating this ADR was
genuinely unshrunk, and the card says so plainly rather than claiming a mitigation
that did not exist for it; a run that has the shrinkage states the real intensity
and is explicit that "narrowed" is not "removed" or "unbiased".

## Consequences

Positive:
- The turnover cap governs the quantity it was always supposed to — verified live:
  the mandate panel now reads `Turnover (day-over-day) — 60% — config`, and the
  currently-published book (which predates this deploy) correctly renders
  `NO DATA`, not a false `0% — OK`.
- The reported ex-ante risk is closer to the risk the book was actually optimised
  under, and the residual bias is disclosed with a number rather than asserted.
- 19 new backend tests, three of them adversarial to the specific historical
  mistake: `test_turnover_cap_binds_on_weights_held_not_weights0` replaces the test
  that used to pin the wrong baseline, `test_turnover_cap_does_not_bind_the_intra_run_figure`
  proves the two figures are genuinely decoupled, and
  `test_no_prior_book_means_no_turnover_constraint` proves absence degrades safely.

Negative / friction:
- **The cap is a first cut, stated as one.** 0.60 is chosen against 7 sessions of
  history — not enough to know whether it costs meaningful expected return on days
  the optimizer would genuinely have wanted to move further. Revisit once the
  constrained series has enough history to show what it actually costs.
- **Shrinkage narrows the bias; it does not remove it.** 0.25 is a stated choice,
  not a proof of adequacy — a future run of actual out-of-sample validation could
  argue for a different intensity, and the card is written to accommodate that
  without becoming stale (it reads the persisted intensity, not a hardcoded claim).
- **Two mandate-limit surfaces needed hand-updating**, not one: `lib/risk/riskBoard.ts`'s
  `DEFAULT_LIMITS`/`ENFORCED_LIMIT_KEYS`/`CONFIG_KEYS`/`defs`, and `MandatePanel.tsx`'s
  separate `ENFORCED_ROWS` table. Both are hand-built lists rather than generated
  from `lib/mandate.ts`'s `ENFORCED` object, which is the same shape of duplication
  every existing cap already carries — not introduced by this change, but not fixed
  by it either.
- `weights_held` requires a second network read per run (`book_holdings` via
  `run_q1_agent`), degrading to `{}` (no constraint) on any failure — the same
  fail-open posture as `fetch_active_vetoes`, for the same reason: an unreachable
  table must not stop a book being published.

## Alternatives considered

**Bind the turnover constraint to `weights0` and call it done.** Rejected — this is
the mistake being fixed, not an alternative to it. It would have made the cap
cosmetically active while continuing to constrain the wrong quantity.

**Ledoit-Wolf's asymptotically-optimal shrinkage intensity**, derived from the
sample rather than stated. Rejected for now: correct in principle, but the paper's
π̂/ρ̂ estimators are a second nontrivial implementation to get right, for a benefit
over a defensible fixed constant that has not been measured. `IC_SHRINKAGE`
already established the fixed-and-stated pattern in this codebase; symmetry argued
for extending it rather than introducing a second philosophy for Σ.

**A sklearn `LedoitWolf` estimator**, available in the ambient environment.
Rejected: it shrinks toward a multiple of the **identity** matrix (constant
variance), not constant correlation — the wrong target for a portfolio context,
since it would also flatten the per-asset variances this repo's own risk
attribution reads. Pulling in a dependency not declared in `requirements.txt` also
risks the exact failure this project has already been bitten by once
(`cvxpy`/`gensim`/`sentence-transformers` missing from `.venv-ci`, silently
degrading a critical-path run to "skip and exit 0") for a formula that is a dozen
lines of numpy either way.

**Gate the turnover row by `returnSessions` like VaR/CVaR/beta.** Rejected: it is a
function of today's weights and yesterday's, needing no return-series history at
all. Gating it would replace a real number with a blank for no statistical reason.
