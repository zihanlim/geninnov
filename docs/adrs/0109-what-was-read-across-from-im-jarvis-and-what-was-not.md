# ADR-0109: What was read across from im-Jarvis, and what was deliberately not

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md), [ADR-0101](0101-delete-the-unwired-duplicate-rather-than-wiring-it.md), [ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md), [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md)

## Context

`C:\Users\zihan\ERP-AI\im-Jarvis` is a multi-tenant investment-management platform by the same author. Its `backend/app/services/` holds ~9,400 lines across 49 modules of quantitative code that is unusually clean: almost every quant module is a pure function library over `Decimal` with dataclass in/out and **zero** SQLAlchemy, FastAPI or auth imports, backed by ~10,000 lines of tests including a pandas/scipy golden-master oracle asserting parity to `rel 1e-9`.

Andromeda already borrowed from it once. `backend/services/risk_decomposition.py` carries the comment *"im-Jarvis, where this decomposition was read from, uses 260; matching the local convention matters more than matching the source, or the same book reports two vols."*

The instruction was to bring the whole quant layer across. Roughly half of it has no data here to run on, and porting that half would manufacture exactly the situation [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md) and [ADR-0101](0101-delete-the-unwired-duplicate-rather-than-wiring-it.md) were written about — plausible, well-named, well-tested code that no production path can call, sitting where a future author will search for it.

## Decision

**Read across what has data and a caller. Document the rest by name, with the specific data it would need.**

The rule from ADR-0101 governs: *wire an uncalled capability when it is the only implementation of a behaviour you want; delete it when a live implementation already exists.* Extended to a cross-repo port, that becomes: **port it when this repo's real data flows through it.**

### Ported and wired (10)

| Module | Adds |
|---|---|
| `optimizer.py` | Constrained mean-variance / min-CVaR / MAD + efficient frontier. **Reimplemented, not lifted** — see [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md) |
| `expected_returns.py` | **Not a port.** Grinold–Kahn μ from the measured IC — [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md) |
| `monte_carlo.py` | Student-t MC VaR, seeded. The only VaR here with a fat tail |
| `var_forecast.py` | Square-root-of-time fan over 1/5/10/21/63d. The **21d** point matches ADR-0090's scoring horizon, which nothing carried |
| `volatility_models.py` | EWMA + variance-targeted GARCH(1,1) |
| `benchmark_compare.py` | Tracking error, IR, beta, up/down capture against `benchmark_returns` |
| `cost_model.py` | Linear TC. Prices the turnover ADR-0045/0050 already measures |
| `risk_engine.py` *(extended)* | Historical VaR/ES beside the parametric, Sortino, Calmar, max drawdown |

### Skipped as duplicates (4)

Per ADR-0101, the tie-breaker is not which code is nicer but which one the system's real data flows through.

- `risk_decomposition` — **already** read across.
- `correlation_service` — `book_metrics.compute_correlation_matrix` is live and does more (clustering, thresholds).
- `market_regime_service` — a realised-vol bucketer, strictly weaker than the L3 classifier.
- `stress_service` — a shock library, weaker than the reviewed six-scenario ADR-0074/0088 calibration.

### Not ported — no data in this repo (22)

Each would be dead on arrival. Named with what it would need:

| Modules | Missing input |
|---|---|
| `bond_math`, `yield_curve`, `credit_spread`, `fixed_income_service`, `bond_attribution` | Per-bond cashflows, coupons, maturities. **Andromeda holds bond ETFs (TLT/HYG/SHY/LQD), not bonds** — there is no CUSIP anywhere in the schema |
| `private_markets`, `pacing`, `illiquid_risk`, `liquidity`, `total_portfolio_service` | Private-asset positions, commitments, sleeves. None exist |
| `fx_attribution`, `fx` | A local-vs-reporting currency split. The book is USD-denominated throughout |
| `performance_service`, `backtest_service`, `scenario_service` | A trade blotter with share quantities and dividends. The book stores weights |
| `sector_attribution`, `benchmark_service`, `custom_benchmark_service` | Index constituent weights |
| `compliance_service`, `order_service`, `holdings_import` | Orders, tenancy, an approval gate. Andromeda routes nothing |
| `factor_service` | A fundamentals feed (P/E, P/B, EV/EBITDA, dividend history) |

`backtest_service` is the most tempting and the most misleading: it would run, and it would backtest a strategy whose live book is two days old.

### Two conventions changed at the boundary

**Float, not `Decimal`.** im-Jarvis is Decimal-throughout because it routes orders and its columns are `NUMERIC` (its ADR-0004). Andromeda routes nothing and its Supabase columns are `REAL`. Introducing a Decimal convention for eight modules — and the float/Decimal boundary discipline that makes it worth having — is worse than a consistent float layer.

**252, not 260.** Same reason `risk_decomposition` chose it: a book annualised two ways reports two volatilities.

## Consequences

**The signed/unsigned trap is the thing to watch, and it is not hypothetical.** ADR-0101 records `exposure.py` — five green tests over `{ticker, weight, sector, geo}` with signed weights, while real picks are `{asset, direction, weight}` with **unsigned** weights and the side in a separate field. The optimizer's clip is the same trap in a different repo. Every ported module here takes signed weights and says so in its docstring, and `test_quant_ports.py` asserts the sign behaviour on the ones where it can go wrong silently.

**Three VaR numbers now exist and must never be rendered as one.** Realised parametric (`portfolio_risk.var_95`), realised historical (`var_95_historical`), and two ex-ante reads from the constituents' covariance (`risk_decomposition`, `monte_carlo_var`) plus the fan. They disagree routinely — that *is* the information — and each carries a distinct method id. [ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md) had to say this when there were two; `PROGRESS.md` records the regression twice.

**82 tests were added and the suite went 790 → 872.** The two that earn their place are `test_shorts_stay_short_and_gross_never_exceeds_one` and the wiring file, which caught a real defect no unit test could: μ built from the model's pick dicts instead of the candidates, yielding a 0%-gross book from a green solve.

**A finding about the source, recorded because it travels.** `im-Jarvis/backend/app/services/volatility_models.py` imports `scipy.optimize` at module top while `pyproject.toml` declares scipy in the **dev** group only. Same for numpy, imported by `monte_carlo_service`, `optimizer_service` and `volatility_models`. That is a latent packaging bug there; it does not travel here, because scipy and numpy are already runtime dependencies in `backend/requirements.txt`.

**This ADR is the index.** If a future author wonders whether some piece of im-Jarvis maths is available here, the table above answers it — including the answer "no, and here is exactly what would have to exist first."
