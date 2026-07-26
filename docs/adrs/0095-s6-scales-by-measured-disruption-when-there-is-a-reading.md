# ADR-0095 — S6 scales by measured disruption when there is a reading

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [0023](0023-data-provenance-and-fabrication-guard.md), [0066](0066-not-computable-must-persist-as-null.md), [0094](0094-no-corroboration-gate-over-a-single-source.md)

## Context

[ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md) shipped
`S6_supply_shock` with a fixed, documented sector-shock map — Energy +18%, Defense +10%,
China Equities −12%. Defensible and auditable, but constant: the stress table says the same
thing on a day when Hormuz is quiet as on a day when transits have collapsed.

The worldmonitor review identified `GetChokepointStatus` / `GetChokepointHistory` as the
one layer worth ingesting, because a chokepoint disruption **trend** is a slow-moving state
variable and therefore the only cadence a once-daily book can act on.

**What it took to find out whether the data was reachable.** Their REST API is gated —
`api.worldmonitor.app/v1/...` returns the SPA shell, other paths 403. But their **MCP
endpoint is open for discovery**: `initialize` and `tools/list` answer unauthenticated, and
that is how this contract was read (41 tools, including `get_chokepoint_status` and
`get_sanctions_data`). `tools/call`, however, returns:

```
-32001  Authentication required. Use OAuth (/oauth/token) or pass your API key
        via X-WorldMonitor-Key header.
```

So **discovery is free and execution is not.** That also corrects an earlier estimate in
this workstream: the cheapest credential is the **Pro tier at $39.99/mo**, which lists MCP
connectors — not the $99.99/mo API Starter tier.

Crucially, `get_chokepoint_status` declares an **`outputSchema`**. So the integration is
written against a documented contract rather than a guessed shape — which is the line
between building an adapter and inventing data the backend does not have.

## Decision

`backend/services/chokepoint_signal.py` maps a disruption reading to a **multiplier** on
S6's existing calibration, and `scenarios_for_run()` applies it to a **copy**.

**Scale, don't replace.** `BASELINE_DISRUPTION_PCT = 40.0` is the disruption level the
ADR-0088 calibration already represents — S6 was calibrated as a *material* closure, not an
average day. At 40% measured disruption the multiplier is exactly 1.0 and the scenario runs
as reviewed. The signed-off calibration stays the reference point instead of being silently
rescaled.

**Bounded to 0.5×–1.5×.** An upstream reporting 100% disruption must not produce a 2.5×
shock; past the bound the scenario stops being the reviewed calibration and becomes an
extrapolation nobody signed off. Clamping is stated in the description when it binds.

**Magnitude only, never direction.** A worse supply shock hurts importers more and helps
producers more — it reverses nobody. Direction is the calibration's claim about
transmission, and a disruption percentage has no authority to flip it.

**The worst chokepoint binds, not the average.** A supply shock is a tail scenario;
averaging would let a quiet Panama cancel a closed Hormuz.

**Every refusal is stated, and returns the neutral multiplier.** `stale: true`,
`dataAvailable: false`, a missing summary, a non-numeric or out-of-range value, no
credential, a network failure, an upstream error — each returns 1.0 *with a reason*, never a
guess and never a bare 1.0 a reader would mistake for a measurement. Note the upstream
distinguishes **transport freshness** (`stale`) from **content availability**
(`dataAvailable`) — the same split [ADR-0094](0094-no-corroboration-gate-over-a-single-source.md)
and the `assessStaleness` work arrived at independently, and both are honoured: a stale
cache is not a low-disruption reading, and "cannot see" is not "all clear"
([ADR-0066](0066-not-computable-must-persist-as-null.md)).

## Consequences

- **The description travels with the scenario.** A P&L scaled by a live reading and one run
  on a fixed calibration are different claims, and `/risk` renders the description verbatim,
  so `scenarios_for_run` rewrites it either way — including when unmeasured, where it states
  *why* the default calibration ran.
- **`scenario_results_to_dict` now takes the run's scenarios.** Resolving against the module
  constant would persist a scaled run's P&L beside the **unscaled** description and shock
  map — the figure and its stated cause disagreeing on the row `/risk` renders. Defaults to
  `SCENARIOS`, so every existing caller is unaffected;
  `run_scenario_analysis_with_scenarios` returns both halves for callers that want them
  consistent. This was found by writing a comment describing the hazard and then noticing
  the code still had it.
- **`SCENARIOS` is never mutated.** The module constant is the reviewed calibration and has
  to stay readable as such; a run that rescaled it in place would leave the next reader
  unable to tell what was signed off. Pinned by a test.
- **The live path is implemented but unverified.** No credential was available, so
  `fetch_signal` has never returned real data. Everything that does not need one is tested:
  the mapping, the bounds, every refusal, and the no-credential path — which asserts that
  **no network call is made at all** without a key. The worst case is that S6 keeps its
  documented calibration, which is today's behaviour.
- Default behaviour is unchanged: `chokepoint_signal=None` runs the battery exactly as
  before. 17 tests here plus the existing 48 on the battery.

## What this deliberately does not do

It does not consume the 10-minute transit counts the same feed publishes. ADR-0088's closing
note stands: a once-daily book cannot act on an intraday event, and pretending otherwise
would be buying a latency edge a batch job cannot have. Only `disruptionPct`,
`wowChangePct`, `riskLevel` and `incidentCount7d` — the slow-moving fields — are read.
