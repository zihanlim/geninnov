# ADR-0107: The optimizer sizes what L5 chose

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0013](0013-deterministic-stochastic-split.md), [ADR-0032](0032-edge-carry-value-abstention-sizing.md), [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md), [ADR-0053](0053-the-published-book-was-sized-by-hype.md), [ADR-0101](0101-delete-the-unwired-duplicate-rather-than-wiring-it.md), [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md)

## Context

Andromeda had **no optimizer**. A grep for `cvxpy|scipy.optimize|mean_variance|efficient_frontier|risk_parity|black_litterman|kelly` across `backend/`, `scripts/` and `tests/` returned nothing. Position sizing was `conviction = |EdgeScore| / max(vol, floor)`, normalised, then pushed through a fixed-point cap-clamping loop in `trade_ranker.allocate_portfolio`.

That loop reaches *a* feasible book, not the best one. It also means the covariance matrix and the Euler decomposition — both already computed on every run — are pure reporting: they describe the book after the fact and never influence a weight. The book therefore had no answer to "why these sizes and not others?" beyond "proportional to conviction, then clamped until nothing breached."

`C:\Users\zihan\ERP-AI\im-Jarvis` has a constraint-aware optimizer: mean-variance, min-CVaR, MAD, efficient frontier, cvxpy, well tested. It is the same repo `risk_decomposition.py` was already read across from — that module still carries the comment naming its source and explaining why it kept 252 rather than im-Jarvis's 260.

**But it cannot be lifted.** Three defects, each fatal on this repo's data:

1. **It deletes shorts.** `_quantise_weights` does `clipped = [max(x, 0.0) for x in raw]` — unconditionally, *not* gated on its own `long_only` flag — then divides through so the weights sum to exactly 1. Passing `long_only=False` removes the `w >= lo` constraint and leaves both the clip and the sum. A long-short book goes in; a long-only, fully-invested book comes out, structurally valid and silently wrong. This is [ADR-0101](0101-delete-the-unwired-duplicate-rather-than-wiring-it.md)'s trap exactly: code correct in its own repo, confidently wrong on a data shape it never saw.
2. **`sum(w) == 1` contradicts [ADR-0037](0037-position-limits-bind-and-the-rest-is-cash.md).** For a long-short book that constraint binds the *net*, so a book could satisfy it at 300% gross. And renormalising to it is precisely what erased the caps once already.
3. **There is no μ.** Mean-variance needs annualised expected returns; EdgeScore is a ranking signal in [−1, 1]. That gap is [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md).

There is also a stated position to answer. The design spec §941 says *"The AI agent reasons, it doesn't optimize... A pure quant screen picks by score; the AI agent picks by fit"*, and [ADR-0013](0013-deterministic-stochastic-split.md) explicitly rejected the pure-quant-screen architecture.

## Decision

**L5 chooses the names and the sides. The optimizer chooses only the magnitudes.**

This is not the pure quant screen ADR-0013 rejected, and it is not a repeal of §941. The agent still does the thing §941 says it does — weighing crowding, regime fit, catalyst timing, narrative coherence — to decide *what is in the book and which way*. What it was never doing well is arithmetic on a covariance matrix, and that is the only thing handed over.

`backend/services/optimizer.py` is a reimplementation, not a port. Every difference from the source is a defect if omitted:

- **Signs survive.** No clip, no renormalisation. `_round_weights` rounds, zeroes dust below 1e-6 (on $100M, that is $100), and clamps a solver hair back onto the pinned side — and does nothing else.
- **`gross <= 1`, never `sum(w) == 1`.** What the limits refuse stays cash, per ADR-0037.
- **The caps are solver constraints**, binding on the group *total* for sector and geography. This is the substantive upgrade over the clamping loop.
- **Direction is pinned** by `s_i · w_i >= 0`. A solve cannot flip a long into a short.

The pin buys a linear problem: because `s_i` is fixed, the magnitude `m_i = s_i · w_i` is a non-negative *affine* expression rather than `|w_i|`, so gross, the single-name cap and both group caps are all linear. Mean-variance stays a QP; min-CVaR and MAD stay LPs.

**`risk_parity` and `black_litterman` are not ported.** Risk parity's convex form uses a `log(w)` barrier requiring `w > 0` — structurally long-only, with no honest long-short version of that formulation. Black-Litterman's reverse optimisation needs market-capitalisation weights this repo has no source for. Shipping either as a stub that silently degrades is worse than not shipping it.

**Cash falls out of the objective.** `max μ'w − (γ/2) w'Σw` under `gross <= 1` has an interior optimum: the book deploys until the marginal return stops paying for the marginal variance. A weak signal produces a *smaller* book rather than the same book held with less conviction — ADR-0037's principle arrived at from the other direction.

**The conviction book remains, as both fallback and baseline.** `allocate_portfolio` is computed on every run. It is the fallback whenever the optimizer cannot run — no IC, no covariance, infeasible, solver error, or an optimal book that funds nothing — and the reason is recorded and persisted. It is also the `weights0` the optimizer measures against, so `weight_delta`, the rebalance cost, and the frontier's "you are here" point all answer the question a reader actually has: *what did the optimizer change, and what did it buy?*

The book is never left unsized. Same contract as ADR-0013's constraint 4.

## Consequences

**Measured on the published 2026-07-25 book** (10 positions, all priced, IC +0.0745 raw → +0.0373 shrunk):

| | published | optimizer |
|---|---|---|
| gross | 59.3% | 56.1% |
| net | −5.4% | +1.6% |
| ex-ante vol | 8.39% | 7.44% |
| expected return | +0.675% | +0.728% |
| return / vol | 0.080 | 0.098 |

More expected return at less risk, inside the same limits — the geography cap binds at the solution. Rebalancing costs 36.3% turnover and $54,412.

**Two results deserve scrutiny rather than celebration.** SHY is zeroed: at 0.09% daily vol its μ is +0.04%, so the optimizer declines to spend gross on it. And **SVXY goes from 3.94% to 16.07%** — a fourfold increase in an inverse-VIX ETF, inside the 20% single-name cap but concentrated in an instrument whose tail is exactly what a covariance estimated on 252 calm-ish days will understate. This is the error-maximisation failure of mean-variance showing up on the first live input, and it is an argument for the turnover cap and for watching the published `optimizer_result` rather than trusting it.

**`sizing_method` is persisted, and that is load-bearing.** [ADR-0053](0053-the-published-book-was-sized-by-hype.md) records a book that every surface described as conviction-sized while it was in fact hype-sized — because nothing in the data said which path ran. Storing the method beside the weights makes that class of drift visible in the data rather than only in a code review. Migration 047 constrains the column to `optimizer | conviction`.

**A wiring bug was caught by the wiring test, not by any unit test.** The first implementation passed `state["picks"]` to `build_mu`. Those are the model's own dicts and have never carried `edge_score`, so every μ came back 0.0 and the optimizer correctly deployed **nothing** — a 0% gross book from a green solve. That is ADR-0053's seam one layer along. `tests/backend/test_optimizer_wiring.py` asserts the path end to end and would have failed; the sixteen tests in `test_optimizer.py` all construct their inputs by hand and could not.

**cvxpy is now on the daily critical path** and must be in `requirements.txt`, `ci.yml` *and* `daily-refresh.yml` — the last two pip-install explicit lists rather than the requirements file. Missing the third does not fail the run; it silently reverts sizing to conviction, which is the kind of degradation nobody notices.
