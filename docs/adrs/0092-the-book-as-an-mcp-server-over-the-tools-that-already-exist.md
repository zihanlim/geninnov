# ADR-0092 — The book as an MCP server, over the tools that already exist

**Date:** 2026-07-26
**Status:** Accepted
**Relates to:** [0087](0087-a-chat-that-cannot-do-arithmetic.md), [0010](0010-citation-footnotes-everywhere.md), [0066](0066-not-computable-must-persist-as-null.md)

## Context

[ADR-0087](0087-a-chat-that-cannot-do-arithmetic.md) built a set of read-only tools that
import the **same modules the pages render** — `buildSizingChain`, `turnover`,
`reconcileToBook`, `assessPipeline` — so an answer cannot disagree with the page it
describes. That was the expensive part, and it was reachable only through our own LLM.

The worldmonitor review made the gap concrete: it serves `/docs/llms.txt` and a 39-tool
MCP server, and that `llms.txt` let **one fetch** enumerate ~200 documented operations
across 37 service groups where crawling the HTML would have taken many. An agent pointed
at Andromeda today has to guess which pages exist and what a number on them means — and
if it guesses by scraping, it gets figures stripped of the `table.column` that makes them
citable.

## Decision

Serve two surfaces, both generated from what already exists.

**`POST /api/mcp`** — MCP Streamable HTTP, protocol `2025-06-18` (`2025-03-26` also
accepted), exposing the same `TOOLS` registry `/ask` uses. Deliberately the minimum shape
the spec permits:

- **POST only; `GET` returns 405.** The spec explicitly allows refusing the
  server-initiated stream, and it is the honest answer: the registry is a module-level
  constant, so there are no notifications to send and `listChanged` is not declared.
- **`application/json`, not SSE.** Also explicitly allowed. A tool call is a handful of
  selects, not a long job with progress to report.
- **Stateless — no `Mcp-Session-Id`.** A MAY in the spec. Nothing to expire, nothing held
  between calls.
- **`Origin` validated** — a MUST for this transport. Without it a page the reader merely
  visits could drive the endpoint from their machine. A request with no `Origin` is
  allowed, because the attack needs a browser and a browser always sends one.

**`/llms.txt`** — a machine-readable index: the reading contract, the pages, the tables,
the ADRs that change how a number should be read, and the tool list. The tool list is
**generated from `TOOLS`**, so a tool added tomorrow appears without anyone remembering
to edit a text file. The prose is hand-written because it states a contract, not an
inventory.

**No rate limit, and that is a decision rather than an omission.** `/ask` is spend-capped
because it plans with a model funded from the same MiniMax quota that writes the nightly
book — an exhausted quota does not break the chat, it publishes tomorrow's book as a
template with no thesis. Here the caller brings their own model and we only execute tools,
so there is no quota to protect. The reads are anon-key reads of public-read rows, which
is what the static pages already serve to any visitor.

**Every tool declares an `outputSchema`,** because the entire point of the surface is that
a figure arrives *with* its source: `{key, label, value, source, unit, runDate}`. A client
validating against it cannot silently accept a bare number. The schema also has to admit
the absence case — `facts: []` with `absence` set — since the spec requires a declared
output schema always be satisfied, and an honest "we cannot see that" must not read as a
schema violation.

## Consequences

- **Goal 5 holds, by the same argument `/ask` used.** `supabaseReader()` exposes `select`
  and nothing else; the anon key cannot write a domain table under RLS; no path re-runs,
  re-sizes, re-ranks or re-publishes anything. The capability the affordance implies is
  "read the published run", which is exactly the capability that exists.
- **An unknown tool is a JSON-RPC protocol error (`-32602`), not a result with
  `isError`.** Asking for something that does not exist is a different fault from a tool
  that ran and could not answer.
- **A stated absence returns `isError: false`.** Flagging it would invite a client to
  retry a question that was fully answered by "we cannot see that" — the same
  goal-2 distinction, now on a wire protocol. `runTool` never throws; it converts a
  failure into an absence, so this stays false.
- **`inputSchema` is generated from each `ToolSpec.args`,** and nothing is marked
  `required`: every tool resolves its own default (the latest run, the largest position),
  and declaring a false requirement would make a client ask its model for an argument it
  does not need.
- **`displayFact` moved from module-private to exported** so the MCP text block renders a
  figure exactly as the LLM prompt does. This was not theoretical: the first version of
  the renderer appended `f.unit` as a suffix and emitted
  `Positions in the book: 10 count` and `Gross exposure: 0.5933244069596506 pct`. `unit`
  is a **type tag**, not a display suffix — which is only obvious once you have the
  function that turns one into the other. Two surfaces disagreeing about one figure's
  display form is the exact defect `lib/chat/tools.ts` opens by warning about.
- Verified against the live book through the full client handshake: `initialize`
  (negotiated `2025-06-18`), `notifications/initialized` → 202, `tools/list` → 9 tools,
  `tools/call book_summary` → 33 facts, `position_detail{asset:"largest_short"}` → PDD
  with 23 facts and its thesis prose, unknown tool → `-32602`.
- 25 tests pin protocol conformance (version negotiation both ways, notification 202,
  batch rejection, bad JSON, missing `jsonrpc`, method-not-found, the `Origin` guard, the
  `GET` 405) plus the two safety properties and the unit-tag regression.

## What this does not do

No `resources` and no `prompts` capability. Both would be additive surfaces with their own
semantics, and neither is needed to answer a question about the book — the tools already
carry the facts and the prose. No authentication: there is nothing to protect that the
pages do not already serve, and adding a key would imply the data is privileged when it is
not.
