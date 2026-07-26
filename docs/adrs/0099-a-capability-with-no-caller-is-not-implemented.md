# ADR-0099: A capability with no caller is not implemented

**Status:** Accepted
**Date:** 2026-07-27
**Supersedes:** —
**Corrects:** [ADR-0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md)
**Related:** [ADR-0088](0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md), [ADR-0093](0093-a-published-book-that-changes-must-say-so.md)

## Context

[ADR-0095](0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md) built three
things so S6 would state whether its shocks had been scaled by a measured disruption reading
or run on the reviewed ADR-0088 calibration:

- `chokepoint_signal.fetch_signal()` — the adapter, degrading to a neutral 1.0 **with a reason**
- `scenario_analysis.run_scenario_analysis_with_scenarios()` — added, in its own words,
  "so a caller can hand the same list to `scenario_results_to_dict` and persist a description
  that matches the shocks the P&L was computed from"
- `scenario_results_to_dict(results, scenarios)` — a second parameter so descriptions resolve
  against the run's scenarios rather than the module constant

**None of the three had a production caller.** `fetch_signal` was referenced only by its own
tests. `run_scenario_analysis_with_scenarios` had zero callers anywhere. Both pipeline sites
called plain `run_scenario_analysis` without a signal and then `scenario_results_to_dict`
with one argument.

Seventeen unit tests passed. Every component was correct in isolation. ADR-0095 recorded the
gap as *"live path implemented but unverified — no credential, so `fetch_signal` has never
returned real data"*, which undersold it: **even with a credential, nothing would have called
it.** The honest statement is that the capability was not implemented, because a capability
with no caller is a library, not a behaviour.

The visible symptom was on `/risk`. `StressScenarios` renders `scenario.description`
verbatim, and S6's description carried no statement of its provenance — exactly the
distinction ADR-0095 said "has to travel with the scenario rather than live in a log".

It was found by asking whether the shipped work was actually on the frontend, not by any
test. That is the point: no unit test could have caught it.

## Decision

**Wire all three, and pin the wiring rather than the parts.**

`_chokepoint_signal()` in `q1_agent` fetches once per run and **never returns `None`**.
`scenarios_for_run(None)` means "do not scale and say nothing", which is precisely the state
that left the calibration unexplained; a neutral signal *with a reason* is a different claim.
It also never raises — a failed fetch degrades to a neutral carrying the exception class as
its reason.

The reading is taken once in node 5 and reused in `finalise_book_analytics` via
`state["chokepoint_signal"]`. Two fetches in one run could return two different disruption
levels, leaving the book stressed by one reading while the page explained the other.

`finalise_book_analytics` now calls `run_scenario_analysis_with_scenarios` and passes the
run's scenarios to `scenario_results_to_dict`, so the persisted description matches the
shocks the P&L came from.

`tests/backend/test_chokepoint_wiring.py` asserts the **path**, not the parts: that a reason
handed in at the top arrives in the dict that gets persisted, and — the sharp one — that
omitting the `scenarios` argument *loses* it. That test fails if anyone disconnects the wiring
again, which no per-component test could.

## Consequences

**The published book carries the disclosure now.** The 2026-07-25 row was backfilled and
logged in `book_revisions` per [ADR-0093](0093-a-published-book-that-changes-must-say-so.md).
The text was **appended** to the published description rather than regenerated, so every
previously published word is preserved byte-for-byte — the logged revision records
`new_value = previous_value || suffix`, which is checkable rather than asserted. The shocks
and P&L are unchanged: no credential is set, so the multiplier is the neutral 1.0. The
backfilled string was verified byte-for-byte against what the wired pipeline now emits, so
the next run reproduces it rather than revising it again. The update is idempotent.

**This is the third guard of the same family in two days**, and they share a shape: a claim
that was true of a *component* but never checked across a *boundary*. The `/risk` select-list
guard (a column added to the type but not the query), the derivation parity test (a comment
claiming two files agree), and now this (a capability with no caller). Each failed silently
and each is now derived from an artefact rather than asserted in prose.

**The general rule:** when work ships behind a credential we do not have, "unverified" is not
a strong enough label. The reachable half — is it *called*, does its output *reach a
surface* — is verifiable today and must be verified today, or the unreachable half hides a
defect that has nothing to do with the credential.

**Still unverified, and genuinely so:** the *measured* branch. With no `WORLDMONITOR_API_KEY`,
`scale_sector_shocks` has never run against a real reading, and worldmonitor's MCP endpoint —
which answered `tools/list` unauthenticated when ADR-0095's adapter was written against its
`outputSchema` — now returns **403** behind a Cloudflare challenge. The contract can no longer
be re-read for free before paying, which weakens the case for buying the tier.
