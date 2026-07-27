# ADR-0119: SVXY is equity risk, and the taxonomy called it a haven

**Status:** Accepted
**Date:** 2026-07-27
**Related:** [ADR-0036](0036-not-computable-is-not-zero.md), [ADR-0067](0067-the-regime-label-is-a-summary-not-a-dial.md), [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md), [ADR-0115](0115-a-complex-is-one-idea.md), [ADR-0118](0118-a-complex-is-capped-in-risk-because-capital-is-not-neutral.md)

## Context

Found while evaluating whether to re-land [ADR-0116](0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md)'s menu widening. The question was "why does the book keep expressing long equity beta through SVXY?" — and the answer turned out to be upstream of everything the sizer does.

**SVXY was classified `rates`, in four places.** `SECTOR_MAP` filed it under `Rates` beside AGG, BIL, IEF, SHY and TLT; `theme_assets.asset_class` held `rates`; and `LENS_TICKER_FALLBACK` listed it under both the rates and credit lenses.

`edge_signals.regime_direction_bias` reads `ASSET_CLASS_RISK_BETA`, where `rates = -1.0` — a **haven**, something that rallies when risk is sold. So EdgeScore's regime component scored SVXY:

| tape | regime bias, as filed | what the same repo measures |
|---|---|---|
| risk-**off** | **+0.55 — favour it** | VIX Spike scenario: **−35%** |
| neutral | −0.25 | — |
| risk-**on** | **−1.00 — fade it** | Melt-up: **+18%** |

Inverted on both ends, on the term carrying the largest prior weight in EdgeScore (0.25), for what was the book's **second-largest position at 10.79%**.

The repo already held every fact needed to know better: measured market beta **+2.08** ([ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md)'s table), the −35% vol-spike shock, and `cot_fetcher` mapping it to VIX FUTURES with `inverse=True` ([ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md)). Nothing reconciled them against the taxonomy.

## Decision

**Classify SVXY as equity, everywhere.** Short volatility is a levered long-equity risk premium — it is paid for bearing the risk that equities fall, and it falls when they do. `SECTOR_MAP` → `US Equities`, `theme_assets.asset_class` → `equity` (migration 049), and it leaves the rates and credit lens fallbacks.

**`US Equities` is also the conservative reading of the sector cap.** SPY, QQQ and a short-vol position are one risk, and now share one 30% limit instead of SVXY borrowing headroom from a bond bucket. The alternative — a new `Volatility` sector — was rejected: with one member, a sector cap can never bind (one name at 20% against a 30% limit), so it would look like a control while being none.

**No new asset class.** The schema constrains `asset_class` to rates/credit/equity/fx/commodity/crypto/other, and `ASSET_CLASS_RISK_BETA` has no volatility entry. Adding one would need a signed risk beta, and the sign depends on whether the instrument is long or short vol — VXX and SVXY would need opposite betas under one class. The direction already lives on the position, so the class does not need to carry it.

## Consequences

**On the live 2026-07-27 regime the effect is small, and in the opposite direction to the motivation.** With `cycle=late`, `sentiment=risk-on`, appetite **+0.688**, the Fed Policy theme's regime bias moves **−0.1254 → 0.0000**, so EdgeScore rises about **+0.031** on a published 0.374 — roughly 8% *more* attractive. That is correct: short-vol *should* be favoured in a risk-on tape, and it was being penalised. Stating it plainly because the change was motivated by wanting *less* SVXY, and today it argues for slightly more.

**The value is the other tape.** In risk-off the bias swings **−1.10**, from +0.55 (favour) to −0.55 (fade) — and that is the tape in which the position loses 35%. The bug was harmless while the market was calm and would have been most expensive exactly when it mattered.

**This is the third SVXY defect on one day**, and they share a root cause: an instrument slotted into a taxonomy with no volatility bucket, then trusted by every consumer of that taxonomy. The other two were the stress-sign error (S1 `+0.20` → `−0.35`, S4 `+0.15` → `−0.15`) and the market beta (`−0.60` → `+2.08`). **The lesson is not "check SVXY."** It is that a classification is an input, and this repo validates its computations far more carefully than its inputs — `check_data_integrity` has seven checks on the published book and none asserting that an asset's class is consistent with its own measured beta. That check is worth building and is not built here.

**A test was pinning the bug.** `test_a_ticker_shock_overrides_its_sector` opened with `assert SECTOR_MAP["SVXY"] == "Rates"`, describing the misfiling as a fact to work around. The property it tests — a per-ticker shock beats its sector's — never depended on it, and it now asserts the classification SVXY actually has. A precondition that encodes a defect makes the defect permanent.

**It does not settle the menu-widening question, it dissolves part of it.** [ADR-0115](0115-a-complex-is-one-idea.md)'s motivating case was SVXY being selected to express equity beta. Part of that selection pressure was this bug. Whether the remainder justifies re-landing the widening should be judged against a correctly-scored book, which does not exist until the next run.
