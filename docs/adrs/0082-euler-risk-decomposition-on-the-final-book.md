# ADR-0082 — The book's risk decomposes by name, and a hedge is allowed to be negative

**Date:** 2026-07-25
**Status:** Accepted (backend live; render pending)
**Relates to:** [0079](0079-adr-0078-described-a-book-that-had-been-replaced.md), [0071](0071-pool-metrics-are-not-book-metrics.md), [0060](0060-a-hedge-is-negative-not-a-slice.md), [0023](0023-unavailable-is-not-zero.md), [0013](0013-determinism-is-the-product-claim.md)

## Context

`/risk`'s per-position attribution answered *"which trade do I cut?"* with `signed_weight ×
β_mkt`. Iterations 79/81 showed the column sums to **−0.19** while the book's headline market
beta is **−0.50** — the contributions do not sum to the total, so the decomposition is loosely
suggestive rather than exact. The other book-level risk number, `portfolio_risk.var_95`, is
realised from the book's own daily P&L: it is as old as the book, and being a single aggregate
per day it can say *nothing* about which position is responsible.

A [handoff brief](../handoff-euler-risk-decomposition.md) landed the pure function
(`backend/services/risk_decomposition.decompose_risk`, 21 tests) and left the wiring. It answers
a different question from different inputs: given the signed weights the book holds and 252 days
of the *constituents'* covariance, what is the book's ex-ante volatility, and how does it split
by name — exactly, by Euler's theorem, because σ_p is homogeneous of degree 1 in the weights.

## Decision

**Wire `decompose_risk` into `finalise_book_analytics`, persist it as `risk_decomposition`
(migration 038), reusing the frame hoisted in step 1 — no extra fetch.**

- **The contributions sum to the total by construction.** `Σ CCRᵢ = σ_p` and `Σ component
  VaRᵢ = portfolio VaR`, verified on the live book to 1e-9 (portfolio_vol 8.38%, 10/10 priced).
  This is what the `signed_weight × β_mkt` column could not do.
- **It is ex-ante and is NOT `portfolio_risk.var_95`.** Different inputs (covariance vs realised
  series), routinely different numbers. They must render with distinct labels and method ids;
  two contradicting VaRs on one page unlabelled is the regression `PROGRESS.md` records twice.
  Persisted to its own column, never overwriting `var_95`.
- **Signs are load-bearing.** A position whose correlation to the rest of the book makes it a
  hedge carries a **negative** `contribution_to_vol` — on the live book, SVXY and SHY reduce
  portfolio volatility. That is the most useful thing the panel says, and it is why the render
  must use the diverging `ContribBar`, never a share-of-whole bar or pie ([ADR-0060](0060-a-hedge-is-negative-not-a-slice.md)).
- **`None`, not zeros, when the covariance cannot be estimated** (< 60 overlapping sessions or
  < 2 priced names). `dropped_assets` — names the book holds whose history yfinance did not
  return — reaches the reader ([ADR-0023](0023-unavailable-is-not-zero.md)).

## Consequences

- **The data is live now, the render is not.** Steps 1–3 (hoist, wire, persist) are done and the
  live book carries a correct decomposition; step 4 — re-sourcing
  `frontend/components/risk/PositionRiskAttribution.tsx` to feed `ContribBar` from
  `contribution_to_vol`, adding the book-level `portfolio_vol` / `portfolio_var` /
  `diversification_ratio` line, and the `dropped_assets` count — is the remaining work. It waits
  on the other session's active `/risk` frontend WIP (`page.tsx`, `analytics.ts`) rather than
  colliding with it. **Until it renders, the −0.19/−0.50 attribution finding stays live.**
- **This does not inject stochasticity.** The covariance is a deterministic function of the
  returns frame; the layer's determinism claim ([ADR-0013](0013-determinism-is-the-product-claim.md))
  holds. Monte-Carlo VaR was considered and rejected in the brief for exactly that reason.
- **This changes the question the column answers; it does not by itself settle the beta one.**
  The −0.19/−0.50 finding had two parts. The *false reconciliation* — an attribution claiming to
  sum to the book beta while summing to a different number — goes away, because Euler
  contributions sum to σ_p **by construction**. But σ_p is **volatility, not beta**: the deeper
  question the finding raised — that the headline book beta is normalised over the 7 R²-qualifying
  positions while the attribution netted all 10 — is about beta and this decomposition does not
  answer it. Step 4 must decide whether a beta-attribution column stays at all next to the
  volatility one, or whether the beta figure is reconciled separately. Do not let "the
  contributions now sum" read as "the beta question is closed."
- **The pure function was on `main` unused for a day.** Wiring it is a small counter to this
  repo's recurring failure mode — machinery that is built and never run.
