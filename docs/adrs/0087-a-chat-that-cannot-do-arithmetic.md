# ADR-0087: A chat that cannot do arithmetic

**Date:** 2026-07-26
**Status:** Accepted
**Supersedes:** nothing. **Amends:** `docs/design-goals.md` goal 5 (affordances match capability) and the four-destinations non-goal.

## Context

The ask was an AI agent chat that users can interact with, whose data and
deterministic calculations come from the app's own services.

Andromeda is a product whose entire claim is that a sceptic can follow any
number back to its source. Its first design goal is "no naked numbers"; its
nightly book already runs a citation guardrail (ADR-0012) that rejects a pick
whose figures do not reconcile against the frozen L0–L4 inputs. Bolting a
conventional chatbot onto that would be the single most damaging thing this
codebase could ship: an interface that generates unlimited confident prose full
of figures, at exactly the moment a reader is being most sceptical, with none of
the machinery the rest of the site is built on.

Three constraints shaped the design, and each of them is specific to this
product rather than to chat features in general.

**The frontend had no server.** Every page is a static Next.js route reading
Supabase with the anon key from the browser. There was no route handler, no
server-side secret, and ADRs already refuse FastAPI and a VPS. A request-time
LLM call needs somewhere to hold a key.

**The deterministic calculations are split across two languages.** Python
(`backend/services/`) runs nightly in GitHub Actions and *persists its results*;
TypeScript (`frontend/lib/`) recomputes derivations at render time. Anything the
pages already show — the sizing chain, turnover, the reconciliation, pipeline
health — exists in TS as a tested pure function. Anything they don't — re-running
`scenario_analysis` on a hypothetical shock — is Python-only and unavailable at
request time without reversing the no-backend ADRs.

**One MiniMax key funds both the chat and the book.** The nightly L5 agent runs
on the same quota. A 429 there does not produce an error page; it produces
tomorrow's book as a deterministic template with no thesis. So the chat's spend
is not a billing concern, it is a *publication risk*.

## Decision

**Ship `/ask`: a read-only agent over the published run, in which the model
chooses which facts to fetch and how to explain them, and never computes a
number.**

Five decisions carry that.

**1. Plan → execute → answer → verify, not a tool loop.** The model is called
exactly twice per question: once to choose ≤4 tools (returning JSON), once to
write prose from their results. The tools run in parallel, deterministically,
between those calls. An open agent loop was rejected because its spend is
unbounded and chosen by the model, its latency is unbounded while a reader
waits, and it would not resemble the pipeline the product already documents.
This shape is L5's own — deterministic gather, one constrained synthesis, a
guardrail — moved to request time. A reader who has understood `/method` has
already understood `/ask`.

**2. The tools ARE the page's own functions.** `position_detail` calls
`buildSizingChain`; `book_turnover` calls `turnover`; `pipeline_status` calls
`reconcileToBook` and `assessPipeline`. Not reimplementations — the same
modules, imported. A private copy would drift, and the drift would surface as
the product contradicting itself in front of the one reader who was checking.
`assessPipeline` was extracted from `LiveFeed.tsx` for this, because it had
already caused that exact bug once: the ribbon said "4/4 succeeded" while
`/method` said "last success: never" for two stages, since the denominator lived
in a component rather than in a module.

**3. Every numeral in the answer is adjudicated, in three tiers.** `cited` — it
matches a fact a tool returned, and the reader can hover it for the
`table.column`. `quoted` — it matches no fact but appears verbatim in prose the
tools returned (a thesis) or in the reader's own question; legitimate, but a
quotation rather than a figure, and marked as such. `unverified` — it matches
nothing. One retry names the offending tokens; if the second attempt still
fails, the answer ships with those figures marked in place. That last choice is
deliberate: goal 1 says a number a reader cannot follow back is worse than none,
and the honest response to a model that insists on one anyway is to mark it, not
to hide it or to silently drop the answer.

**4. No streaming.** The guardrail cannot verify a token that is already on
screen. Waiting a few seconds is the honest cost of the citation contract.

**5. The spend guard fails closed, and its counter is sealed.** `chat_usage`
carries RLS with no policies; the only door is `chat_rate_limit()`, a
`SECURITY DEFINER` function granted to `service_role` alone. The obvious
alternative — let the browser check its own budget with the anon key — hands
every visitor the ability to exhaust the global daily allowance with curl, a
denial of service built out of the spend guard itself. Every branch that cannot
prove a request is in budget refuses it, including a missing migration, because
a rate limiter that opens when it breaks protects nothing on the day it matters.

### What this amends

**Goal 5, "affordances match capability", said: "The frontend reads Supabase
directly and writes nothing. So it shows no COMMIT, no RECALCULATE, no SAVE."**
`/ask` adds the first control that triggers server-side work. The goal's
*intent* survives intact and is worth restating precisely: no control on this
site may imply it can change the book. `/ask` cannot. It writes nothing to any
domain table (its only write is a rate-limit counter in a table with no other
purpose), it reads with the anon key — the same rows the browser could already
fetch — and it has no ability to re-run, re-size or re-rank anything. The
capability the affordance implies is "ask a question about the published run",
which is exactly the capability that exists.

**The four-destinations non-goal.** `/ask` is reached from a control in the
TopBar, not from the nav. It is a way of reading the book, not a fifth thing the
product is, and the nav stays four items in both the bar and the rail. If it
ever appears as a nav destination, this decision has been reversed and the
non-goal needs re-arguing.

## Consequences

**What gets better.** The "why is X sized like that" question — the one the
sizing chain on `/book` answers in a table — now has a prose answer that quotes
the same numbers from the same function. A reader can interrogate the run
without knowing which page holds which column. Every answer carries its run
date, so the once-a-day cadence is never implied away.

**What gets worse, or riskier.**

- **Two more paid calls per question, on the book's quota.** Capped at 15 per
  visitor and 200 globally per day, both configurable. The global cap exists to
  protect the nightly book, not the bill.
- **The frontend deployment now holds a service key.** Server-only and used for
  exactly one RPC, but the blast radius of a mistake made with it is the whole
  database. `lib/chat/db.ts` throws if imported into client code.
- **The guardrail is numeric only.** It cannot catch a fabricated *mechanism* —
  and did not, on the first live run, when the model narrated "the cap permitted
  it to expand" about two sizing steps that merely differ. The prompt now
  forbids inventing the link between figures, which is mitigation, not a proof.
- **Latency is real**: two completions from a reasoning model, tens of seconds.
  Non-negotiable given the no-streaming decision.

**What was deliberately not built.** What-if calculation ("stress it at a
different VIX") would need `backend/services` callable at request time, which
means either reversing the no-FastAPI ADRs or porting `scenario_analysis` and
`book_metrics` to TypeScript. Proposing trades would need the candidate
hard-filter and the full L5 guardrail replicated at request time, and would
raise the question of whether its output is distinguishable from the published
book. Both are out of scope by choice; both would need their own ADR.

**How this fails loudly.** `tests/unit/chat-guardrail.test.ts` pins the three
tiers, including the cases a naive guardrail passes: a Sharpe of 1.9 grounding
"1.9%", a thesis laundering an unrelated figure, and a sum the model computed
from two real facts. If someone relaxes the guardrail to make an answer look
tidier, those fail.
