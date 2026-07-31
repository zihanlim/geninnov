# Andromeda — response to the two questions

**Live system:** https://andromeda-analytics.vercel.app
**Book shown below:** run date 2026-07-30, multi-asset lens. Every figure is read from the
published run, not composed for this document.

---

## Q1 — $100M across long and short trades

The system returns **nine positions: four long, five short**, at **44.4% gross** and
**−7.7% net**. It is not constrained to five a side, and it did not deploy the full $100M.
Both facts are answers rather than omissions, and I take them in turn after the book.

### The book

| | Asset | Weight | Theme | Why |
|---|---|---|---|---|
| **L** | UNH | 5.74% | US Election | Defensive ballast against an AI-heavy long book. Market beta 0.62 — but R² is 0.06, so the beta is decoration and the thesis is event-driven, not factor-driven. |
| **L** | SMH | 4.68% | AI Capex | The cleanest expression of the theme into a late-cycle risk-on backdrop: VIX in contango (17.09 vs VIX3M 19.5), HY OAS tight at 287bp. |
| **L** | GEV | 4.50% | AI Capex | The second leg — electrical equipment for data-centre power. Deliberately a *different factor mix* from SMH (CMA −1.05 against SMH's SMB −0.48 / RMW −0.67), so it diversifies rather than doubling the same bet. |
| **L** | F | 3.43% | Corporate Credit | Value-tilted late-cycle cyclical, beta 1.43, HML +0.34 (R² 0.25). Offsets the tech concentration on a different factor axis. |
| **S** | BABA | 7.50% | China Growth | Strongest expression of the China complex by pool depth (chosen over JD / KWEB / MCHI). |
| **S** | GLD | 5.59% | Geopolitical Risk | Gold at 4166 has run hard into Hormuz tensions; this fades the geopolitical premium. |
| **S** | NOC | 5.13% | Geopolitical Risk | **Paired with the GLD short.** The same view — Hormuz resolves — expressed on the *beneficiary* leg as well as the safe-haven leg. If the view is wrong, both lose together; that is the intended risk, taken knowingly. |
| **S** | PDD | 4.01% | China Growth | Independent of BABA by correlation (not in the BABA/JD/KWEB/MCHI cluster), so it adds breadth to the China short rather than leverage on it. |
| **S** | UNG | 3.81% | AI Capex | Permian oversupply — new pipeline capacity relieving the bottleneck. |

Two structures are worth naming because they are the difference between nine positions and a
book. **GLD short + NOC short** is one view expressed twice, on the safe-haven leg and the
beneficiary leg. **SMH + GEV** is one theme expressed through two different factor
exposures. **BABA + PDD** is deliberately *not* one idea twice: the pair was checked against
the correlation cluster and PDD was included because it sits outside it.

### Why four longs and not five

The screen produced 42 candidates, capped to 30 for the reasoning step. From those 30 the
engine took nine. There is no rule requiring five a side, and manufacturing a fifth long to
match the shape of the question would mean holding a position that did not clear the bar.
The honest count is four.

### Why 44% gross and not 100%

`binding_constraints` on the run reads **`["turnover at cap"]`**, with realised turnover at
exactly **60.0%** against a 60% limit. The day-over-day turnover cap bound. The system
declined to trade through it and held the balance in cash.

This is the mandate working. An earlier version of this book ran at **92.7% mean daily
turnover, peaking at 200%**, which cost ~35%/yr annualised — turning a −1.26% gross result
into −2.01% net. The cap exists because that was measured, and this run is what it looks
like when it binds.

### What the book is *not* exposed to

Per-asset credit betas are estimated against three legs (10y Treasury, IG OAS, and the
HY−IG quality gap), orthogonalised against the equity factors so they do not double-count
market beta, and reported with standard errors. Of the nine held names, **one — GEV —
has a credit beta distinguishable from zero** (t = 2.33, quality leg only).

That is the correct result for an equity-and-commodity book, and it is stated rather than
hidden. A stress scenario that transmitted a credit shock through the other eight would be
reporting arithmetic on noise.

---

## Q2 — a daily process for identifying themes and quantifying hype

**Full answer: [`docs/theme-hype-methodology.md`](../docs/theme-hype-methodology.md)** — data
gathering through to the quantification framework, written against live figures rather than
illustrations, and explicit about what is not yet measurable.

The three failures the design is a response to:

| Failure | What it looks like | Response |
|---|---|---|
| **You only find what you named** | A keyword list returns the themes you already believe in and calls everything else "no signal" | An un-themed corpus is tracked in parallel, so a narrative nobody configured can surface on its own |
| **A score that moves when its peers move** | Cross-sectional normalisation makes "Inflation fell" indistinguishable from "something else rose" | Sub-scores are absolute, not relative to the day's peer group |
| **Attention that means nothing** | A loud narrative that moves no prices is a media artefact, not a market theme | A price-link gate: the brief defines a theme as *"the narrative driving cross-asset moves"*, so attention alone does not qualify |

The last one is the load-bearing constraint. The system tracks phrase-level attention daily,
but will not call a phrase a *theme* until it has enough sessions to test whether attention
and prices move together — and below that floor it reports `insufficient_history` as the
verdict rather than as a caveat on a number it prints anyway.

---

## On the fit to a credit mandate

The engine takes a `lens` parameter that filters the tradeable universe by asset class. The
same run, under the credit lens, produces a different book — and the comparison is the most
useful thing in this document. Both books are live and readable side by side: `/book`,
`/mandate` and `/risk` all take `?lens=credit`, so the credit book can be inspected for
mandate compliance and stress behaviour, not merely for what it holds.

|  | Multi-asset | Credit |
|---|---|---|
| Positions | 9 (4L / 5S) | 3 (long-only: EMB, BIL, BKLN) |
| Gross | 44.4% | 50.0% |
| Net | −7.7% | **+50.0%** |
| Names with a **measurable** credit beta | **1 of 9** | **2 of 3** |

### The credit book is not thin by choice — it is capped out

The most informative line in the credit run is its list of binding constraints:

> `["EMB at single-name cap", "BIL at single-name cap", "Credit at sector cap",`
> `"long::0 at correlation complex cap"]`

Four caps bind at once. Two names sit at the 20% single-name limit, the credit **sector** sits
at its 30% limit, and a correlation complex has absorbed one name's allowance. The book stops
at 50% gross because the mandate's own diversification rules will not let $100M into three
instruments — not because the screen ran out of conviction. Compare the multi-asset book, where
exactly one constraint binds (turnover).

That is the quantitative form of the argument below: **the methodology transfers, the
instrument universe does not yet.** Diversification caps are the right rules, and they are the
rules that a three-ETF universe cannot satisfy.

### And it breaches a limit — which is the governance working

The credit book runs **+50.0% net against a 30% net-exposure limit — 167% of it.** A long-only
book cannot be net-neutral, so this follows directly from having no short side.

It is worth being precise about what kind of breach this is. Net exposure is **monitored, not
enforced**: it is reported, not entered into the optimizer as a solver constraint. Every
*enforced* cap — single name, sector, correlation complex — holds exactly, which is why they
appear in the binding list rather than being violated. So the same run demonstrates both halves
of the distinction: the solver could not breach what it was given to obey, and the system
reports the limit it was not given to obey rather than quietly omitting it.

A credit book I would actually run has a short side and does not have this problem. This one is
published with the breach visible on `/mandate?lens=credit`.

### Why there is no short side at all

The caps explain the size. They do not explain the direction, and the book states that reason
itself. Its published thesis opens:

> *"The book is a long-only credit allocation — no short candidates exist in the pool, so a
> long/short structure is not constructible from this screen."*

That sentence is the honest answer to whether this universe can express a credit book today.
It cannot express a *short* credit book, because every credit instrument in it is an ETF —
there is no single-name bond, no CDS, no sovereign, no convertible.

That the thesis says so at all is the guardrail working: every numeric and positional claim
is checked against the sized book before it is published, and a thesis asserting a position
the book does not hold is cut rather than footnoted. The model does not get to describe a
short side into existence.

So the position I would put to you plainly: the **process** transfers to a credit mandate —
the theme engine, the factor and spread-beta estimation, the sizing discipline, the
guardrails — and the **instrument universe does not yet**. Closing that is an
instrument-coverage problem, not a methodology problem, and it is the first thing I would
build next.

---

## What I would not claim

- **There is no track record.** Forward outcomes are recorded from publication and resolved
  at a fixed 21-trading-day horizon, but the history is short. The credit book has no track
  record at all, deliberately — it is published for inspection and excluded from the
  outcome tables, because letting a second book write into them would corrupt the first
  book's record.
- **A backtest of these weights is not a track record either.** It exists, in its own column,
  labelled as what it is.
- **The attention signal rests on one news provider.** A second was added for history, but
  corroboration across independent sources is not yet a gate.
- **Betas are empirical, not analytic.** A regression coefficient over 252 days is not a
  cash-flow-weighted spread duration, and one estimated over 2023–2026 has seen one broad
  regime.
- **The credit lens does not reach everything on the risk pages.** Realised return, the held
  positions and the forward record have one series each, belonging to the multi-asset book —
  a second book must not write into the first book's record. So on `/risk?lens=credit` the
  stress matrix, VaR, correlation and factor tilt are the credit book's, while a handful of
  panels are still the multi-asset book's. Those are marked on screen, panel by panel, and
  named in a banner at the top. The marking is per panel, not per figure: one or two panels
  put both books' numbers in a single row, distinguished only by each figure's source line.
  `/attribution` offers no lens at all rather than label the multi-asset record as credit.
