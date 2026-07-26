# ADR-0100: A guard that lives in a component guards one consumer

**Status:** Accepted
**Date:** 2026-07-27
**Supersedes:** —
**Related:** [ADR-0092](0092-the-book-as-an-mcp-server-over-the-tools-that-already-exist.md), [ADR-0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md), [ADR-0099](0099-a-capability-with-no-caller-is-not-implemented.md)

## Context

`risk_engine.py` declares `MIN_DAYS_FOR_VAR = 30`, `MIN_DAYS_FOR_SHARPE = 60`,
`MIN_DAYS_FOR_BETA = 60` — the sample each estimated statistic needs before it means
anything. A prior decision settled what to do below them: **keep the computed value in
`portfolio_risk` for anyone who queries it, but do not assert it on the page.** That was
right, and `RiskMetricsGrid` implements it, suppressing the tile rather than annotating it.

The rule was then written twice more — `MIN_SESSIONS` in `lib/risk/riskBoard.ts` and
`minSessions` in `RiskMetricsGrid.tsx` — kept in agreement with the Python by a **comment**
saying they mirror each other.

And it was written **zero** times on the surface that reaches the public. `lib/chat/tools.ts`
serves `portfolio_risk` straight through to `/ask`, and through the shared `TOOLS` registry
([ADR-0092](0092-the-book-as-an-mcp-server-over-the-tools-that-already-exist.md)) to the MCP
server, where any external model can call it.

On the live 2026-07-25 book, `portfolio_returns` holds **three rows**. The published risk row
carries `sharpe = 6.32`, `beta = -1.30`, `var_95 = $1,485,840`. A Sharpe of 6.32 from three
observations, against a declared minimum of 60, was quotable as a **cited fact** by an
external model — with the citation guardrail passing it, because it *is* faithfully copied
from the table — while the tile on `/risk` refused to show the identical number.

"Do not assert it" lived in a React component. Every non-React consumer asserted it.

## Decision

**The rule moves to `lib/risk/sampleAdequacy.ts` and every surface reads it from there.**
`MIN_SESSIONS_BY_FIELD` is keyed by `portfolio_risk` column name, so any consumer of that
table can look up the minimum for a field it just read, without knowing which UI concept the
field maps to.

**`risk_metrics` withholds under-sampled statistics, and says so.** A withheld figure is
named in `absence` with its shortfall — "Sharpe (3 sessions of return history, needs 60)" —
and the note instructs the model to say they are *not published at this sample size* and
explicitly **not** that they are unavailable. Those are different claims, and silently
dropping the facts would have produced the wrong one: `/ask` reporting that the book has no
risk figures at all.

**An unknown sample does not withhold.** If the count cannot be read, `sampleAdequacy`
returns `unjudged` and the figure is quoted. Withholding on ignorance would turn a transient
read error into a blackout of every risk number — the opposite failure from the one this
guards, and a strictly worse one. It is a distinct state rather than a silent pass, which is
the [ADR-0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md) rule applied here.

**Only estimated statistics are gated.** `concentration_hhi` and `total_capital` come from
today's weights and need no history; gating them would replace a real number with a blank.

**The thresholds are now checked across the language boundary.**
`risk-thresholds.test.ts` parses `MIN_DAYS_FOR_*` out of `risk_engine.py` and fails if the TS
disagrees, and also checks the risk board's and the tiles' copies against the shared source.
The behaviour is tested through the real `DbReader` seam, not by reading source: three
sessions withhold all four statistics, thirty release VaR and CVaR but not Sharpe or beta,
sixty release everything.

## Consequences

**The live exposure is closed.** `/ask` and the MCP server no longer quote the 2026-07-25
Sharpe, VaR, CVaR or beta, and explain why rather than going quiet.

**Nothing about the stored data changed.** The engine still computes and persists these
figures, per the prior decision. This ADR only extends "do not assert it" to the consumers
that were asserting it.

**One test was fixed for passing for the wrong reason.** The first version of the
unreadable-sample test used the shared fake, which errors *every* table — so
`portfolio_risk` came back empty and the tool short-circuited to "has no rows", never
reaching the branch under test. It now uses a fake that fails one table, and asserts the
figure IS quoted, which can only happen if the branch is reached. The guard was also
negative-tested: disabling it fails three tests.

**Third instance of one pattern in two days**, and the cheapest lesson here:

| Guard | True of | Not checked across |
|---|---|---|
| `/risk` select list | the row type | the query |
| derivation parity | a comment | the two files |
| ADR-0099 chokepoint | three components | the caller |
| this | one React component | every other consumer |

The generalisation: **a rule enforced at a render site is not enforced.** It binds one
consumer of the data and silently exempts the rest, and the exemption is invisible precisely
because the rule visibly works where you are looking. Where a constraint is about what the
*data* can support, it belongs beside the data or in a module both sides import — never in
the thing that draws it.

**What this does not do.** It does not mark the under-sampled figures with ADR-0098's
`epistemic` field, which is where they belong: a Sharpe from three sessions is `unknown` with
a reason. `portfolio_risk` stores bare columns rather than `NumericDerivation`s, so that
conversion is the migration already tracked as the epistemic sweep, not a change to smuggle
in here.
