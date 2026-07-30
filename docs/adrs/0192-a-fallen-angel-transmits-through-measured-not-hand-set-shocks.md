# ADR-0192: A fallen-angel scenario transmits through MEASURED credit betas, not hand-set shocks

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0190](0190-credit-rates-exposures-shadow-on-arrival.md), [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md), [ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md), [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md)

## Context

An external PM critique of this repo was verified claim by claim on 2026-07-30
(`research/20260730_222516_andromeda_pm_review/corrections.md`). Its single highest-praised
recommendation was to "add a fallen-angel scenario that transmits through `SECTOR_MAP` rather
than beta — specific, cheap, uses machinery S6 already proves, and demonstrates the
generalisation claim instead of asserting it." [ADR-0190](0190-credit-rates-exposures-shadow-on-arrival.md)
built the machinery this needs — `backend/services/credit_rates_exposures.py` (L2b), which
measures `marginal_beta_ig` and `marginal_beta_qual` per asset — and shipped it SHADOW with an
explicit condition: *"S (the fallen-angel scenario) and B (the credit-lens book) each opt in
deliberately, in their own ADR, once this has run in production and been checked."* 62 assets
carry `status='measured'` rows for run_date 2026-07-30. That run has happened. This is S — the
opt-in.

`backend/services/scenario_analysis.py` already has six scenarios (S1-S6) and a documented
precedent for exactly this kind of extension: [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md)
added S6, which transmits through `SECTOR_MAP` instead of a factor beta, because a
crude-supply disruption is not a beta event and S1-S5's shared channel made a whole class of
position (short-geopolitical-risk names with unremarkable market betas) invisible to the
entire battery. `_resolve_shock`'s two-tier precedence (`base_asset_shocks` ticker override,
then `sector_shocks` bucket, then the factor path) is the mechanism S6 proved generalises. The
question this ADR answers is narrower than S6's: can the SAME mechanism generalise a second
time, over a MEASURED per-asset quantity instead of a hand-maintained lookup table, without
disturbing the two tiers already there.

## Decision

**Add a third tier to `_resolve_shock`, between `base_asset_shocks` and `sector_shocks`, and
one new scenario — `S7_fallen_angel` — that is the first thing in the repo to use it.**

New precedence (`backend/services/scenario_analysis.py::_resolve_shock`):

1. `base_asset_shocks` — unchanged, still wins. The file's existing doctrine: this is the
   override list for names that do not behave like their bucket.
2. **NEW — measured credit beta.** Only when the scenario declares `credit_leg_shocks`
   (`{"d_ig": bp, "d_qual": bp}`) AND the asset has a `status='measured'` row with both
   `marginal_beta_ig` and `marginal_beta_qual` non-NULL.
3. `sector_shocks` — unchanged.
4. `(None, "")` — the factor path, unchanged.

**Why inserted, not appended.** A ticker override still has to win — S7 keeps a minimal one
(`SVXY: -0.10`) for the same reason S1/S4/S6 do: a leveraged short-vol product whose measured
sensitivity to two OAS legs does not capture the vol spike that accompanies forced selling. But
the measured tier has to outrank the sector bucket, not lose to it, or a name with a real
regression result would be overridden by a coarser lookup table that exists only for names
*without* one — the opposite of what a measurement is for.

**The transmission arithmetic**, legs in bp and betas in percent-return-per-100bp (the unit
convention `credit_rates_exposures.py` itself defines and requires):

```
shock_decimal = (marginal_beta_ig * (d_ig_bp / 100) + marginal_beta_qual * (d_qual_bp / 100)) / 100
```

Worked example, pinned in `tests/backend/test_fallen_angel_scenario.py`: an asset with
`marginal_beta_ig=-6.8`, `marginal_beta_qual=-2.0` under S7's own `+60bp` / `+140bp` legs —
`(-6.8*0.6 + -2.0*1.4)/100 = -6.88/100 = -0.0688`, an -6.88% shock. The trailing `/100` is not
decoration: it is the same percent-to-decimal conversion `credit_rates_exposures.py`'s module
docstring names explicitly, because the first implementation of THAT module regressed decimal
returns against basis-point legs directly and produced a coefficient 10000x off — a defect this
scenario inherits the fix for by using the already-converted, already-tested betas rather than
re-deriving anything.

**Only `marginal_beta_*`, never `total_beta_*`.** S7 also declares `factor_shocks={"mkt":
-0.05}`. `total_beta_ig`/`total_beta_qual` are three separate univariate fits that include
whatever the equity factors — `mkt` among them — would already explain; using them here would
shock the market twice, once through `mkt` and again through the part of `total_beta_ig` that
IS market exposure. `marginal_beta_*` is residualised against FF5+UMD first (ADR-0190), so it
carries only the credit-specific component and composes cleanly with a separate `mkt` shock.
This is the one constraint ADR-0190 stated in advance and could not itself test, because it
shipped with no consumer — S7 is where it first actually binds, and a golden test asserts the
worked example above uses `marginal_beta_ig`/`marginal_beta_qual` by name, not merely "a beta".

**The scenario itself.** A large IG issuer is downgraded to HY: forced selling by IG-mandated
holders regardless of view, IG spreads widen modestly (`d_ig +60bp`) on the general risk-off
tone, and the HY/IG quality gap widens sharply (`d_qual +140bp`, so HY OAS +200bp total) as the
forced supply concentrates in the newly-HY name and its comparables. `factor_shocks={"mkt":
-0.05}` is real but deliberately secondary — a larger equity component would let market beta
carry the loss and collapse S7 into a smaller S1/S4, defeating the point that the credit leg
does the work. `base_asset_shocks` holds exactly one entry (`SVXY`), because the whole
demonstration is that measured betas cover the book — a long override list would quietly
re-introduce the hand-set-shock design S6 and now S7 both exist to replace.

**`_resolve_shock` stays pure**, per its own docstring's existing constraint that the P&L loop
and the `covered_frac` gate must not be able to disagree about what "covered" means. No
Supabase call was added inside it. `credit_betas: dict[str, dict] | None` is threaded in as a
parameter — `estimate_scenario_pnl(..., credit_betas=...)` — exactly as `factor_exposures`
already is, fetched once by `q1_agent.aggregate_context` (a new `_load_credit_betas` helper,
mirroring `_load_edge_ic`'s shape: try the query, return `{}` never raise) and carried on state
as `state["credit_betas"]`, then passed into both `run_scenario_analysis_node` (node 5, the
pre-selection pass) and `finalise_book_analytics` (node 9, the persisted book) — the same
snapshot both times, for the same reason `chokepoint_signal` is fetched once and reused: two
reads of `credit_rates_exposures` in one run could return two different snapshots and stress
the book by one while the page explained the other.

**Coverage is reported, not assumed** ([ADR-0097](0097-external-positioning-can-see-a-fifth-of-the-book.md)'s
doctrine, applied to a new signal). `estimate_scenario_pnl` classifies every held name into
`override` / `measured` / `sector` / unresolved via a `_coverage_tier` helper that re-derives
its answer from the SAME two checks `_resolve_shock` itself makes, so the two cannot disagree,
and prints a line — `"N of M held names measured (X% of gross); ... override, ... via sector,
... unresolved (factor path)"` — as the first content row of `contribution_breakdown`, gated on
`scenario.credit_leg_shocks` being non-empty so the six pre-existing scenarios get no new line
at all. A scenario that silently covered 3 of 10 names would read as authoritative; this one
states its own denominator.

**The required fallback.** `q1_agent` passes `credit_betas=None` whenever
`credit_rates_exposures` has no `status='measured'` rows for the run_date — a missing table,
an empty run, a network failure. `_measured_credit_shock` returns `None` immediately when
`credit_betas` is falsy, so S7 degrades to exactly its override-and-factor-path behaviour: no
exception, no fabricated beta, no silently-zero shock. `_load_credit_betas` additionally
filters `status == 'measured'` a second time on the rows it receives, not trusting the `.eq`
query alone — the same defence-in-depth this repo applies elsewhere (a `degenerate` row or a
partial fit where `marginal_beta_*` is NULL despite `status='measured'`, per ADR-0190's
partial-success case, must fall through exactly as an absent row would, never enter as a
guessed number).

## Consequences

- **The six pre-existing scenarios are provably bit-identical.** None of S1-S6 declares
  `credit_leg_shocks`, so `_measured_credit_shock` short-circuits to `None` for all of them
  regardless of what `credit_betas` contains — pinned by a test that runs all six with a
  `credit_betas` dict covering their own tickers and asserts the estimated return, dollar P&L,
  severity, and every printed line are unchanged.
- **`SCENARIOS` grows from 6 to 7.** Two pre-existing tests asserted the count and name set
  directly (`test_six_scenarios_defined_covering_both_tails`,
  `test_module_imports_without_backend_on_sys_path`'s subprocess-printed count) and were updated
  in this change — not weakened, the same assertions with the new number.
- **L2b is no longer fully shadow.** `credit_rates_exposures` still sizes nothing and no
  optimizer/expected-returns/book_metrics path reads it — only a stress scenario does. ADR-0190's
  "shadow on arrival" description is updated in `ARCHITECTURE.md` to name S7 as the first reader,
  while the "sizes nothing" property, which is a stronger and still-true claim, stays exactly as
  written.
- **What this is not.** An empirical 252-day regression beta, not analytic spread duration;
  ETF-level, not issuer-level (the same limits ADR-0190 stated for the underlying measurement,
  inherited here rather than re-argued). The scenario answers "does the credit leg carry the
  loss for names we can measure", not "what happens to an actual defaulted single-name credit
  position" — the tradeable-universe gap the PM critique's first surviving claim named is still
  open and is not addressed by this ADR.
- **What remains open.** Whether B (the credit-lens book publication) opts in is a separate
  decision, deliberately not made here, per ADR-0190's own deferral.
