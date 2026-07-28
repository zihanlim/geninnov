# ADR-0149: Request-time sizing calls the real optimizer

**Status:** Accepted
**Date:** 2026-07-29

## Context

[ADR-0147](0147-the-mandate-is-a-parameter-not-an-ambient-fact.md) made the mandate a
parameter, and [ADR-0148](0148-the-signal-is-published-separately-from-the-book.md)
published the signal without one. Both point at the same missing capability: a caller
should be able to size today's signal under **their own** mandate, and a reader should
be able to drop a name and see what the sizer does.

`optimizer.py` is cvxpy. There is no path from a browser to a quadratic program.

## Decision

**Add a Python serverless function that calls the same `optimizer.py` the nightly run
calls, and split it so the logic is testable without deploying anything.**

- `backend/services/compute_api.py` — all sizing logic, all validation, all tests.
  Runs anywhere Python runs; needs no Vercel, no network, no deployment.
- `api/compute/size.py` — a thin HTTP shim. Parses a request, calls one function,
  serialises the answer.

### Why not reimplement the sizer in TypeScript

Because [ADR-0107](0107-the-optimizer-sizes-what-l5-chose.md) records what happened
the last time a sizer was written twice. The implementation `optimizer.py` was read
across from **clips every weight at zero regardless of its own `long_only` flag and
renormalises to sum 1** — which on a long-short book deletes every short. A second
sizer is a second instance of that class of bug, and it would be found by a reader
noticing the workbench disagreeing with the book, which is the worst possible
discoverer.

One sizer, three callers: the nightly run, the workbench, and the MCP `size_book`
tool. They cannot disagree about what a limit is, because they are the same function
reading the same `Mandate`.

### Namespacing

`/api/compute/*`, not `/api/*`. The Next.js app already owns `/api/chat` and
`/api/mcp` as route handlers, and a root-level Python function competing for that
prefix is a routing conflict waiting to happen.

### Dependencies

A root `requirements.txt` scoped to the solve — **not** `backend/requirements.txt`,
which pulls gensim, sentence-transformers, praw and an nltk model download for the
discovery and ingestion stack. None of that is reachable from a quadratic program, and
installing it would put hundreds of megabytes into a serverless bundle to no purpose.

## Consequences

**A caller can bring their own mandate.** Verified over real HTTP against the handler:
the default mandate binds the 20% single-name cap, and a caller mandate of $500M with
an 8% cap binds at 8% and returns $40M notionals. Capital scales notionals and leaves
weights untouched — the proof that a weight is dimensionless and a mandate is a
parameter.

**Refusals are refusals, not clamps.** `max_gross: 99` returns
`400 "must be between 0.0001 and 10.0, got 99.0"`. Silently clamping would size a book
under a mandate the caller did not ask for and would never be told about.

**A name with no EdgeScore enters at `μ = 0`, and is named.** That is *"no view"*, not
a measured zero, and it has a consequence a weight alone cannot show: such a name can
be held only for variance reduction, never for expected return. The payload lists every
asset it applied to. [ADR-0108](0108-expected-returns-are-constructed-not-assumed.md)
refuses to default a μ; this is the same refusal, said out loud.

**An absent covariance falls back to a diagonal and says so.** Assuming zero
correlation systematically understates the risk of a concentrated book, so the
assumption travels in the response rather than being buried.

**The rate limit fails OPEN, where `/ask` fails closed.** A deliberate asymmetry:
`/ask`'s budget is *tomorrow's book*, because it shares L5's MiniMax quota, so
refusing is the safe direction. This endpoint holds no quota and writes no domain
table, so refusing every request would break a working feature to protect a budget
that does not exist.

**`CLAUDE.md` says "No FastAPI, no Redis, no VPS for the backend."** A Vercel Python
function is none of those, but this is the first backend compute in the request path
and the line is being widened rather than quietly stretched. What still holds is the
bar design goal 5 sets and `/ask` cleared: it writes nothing to a domain table, reads
only what the anon key could already fetch, and cannot re-run, re-size or re-publish a
book.

**It is not yet deployed.** The logic is verified locally and in CI; the deployed
behaviour is not, and the first verification on deployment must be that the function
reproduces the published weights bit-for-bit under Andromeda's own mandate. If it
cannot, it is not the same sizer and nothing built on it can be trusted.

## Alternatives considered

**A separate Vercel project for the compute service.** Cleaner dependency separation —
a cvxpy install would not ride on every frontend deploy. Rejected for now because it
needs a second project and a cross-origin call, and the hybrid works within one
deployment. Worth revisiting if the bundle or the build time becomes a problem.

**Precompute a handful of mandate variants nightly.** Rejected: it answers "what would
this look like at $500M" only for the sizes someone thought of in advance, and it
cannot serve the workbench at all, where the name set changes.

**Run the optimizer in a GitHub Actions job on demand.** Rejected on latency. Minutes,
for an interaction that has to feel like an edit.
