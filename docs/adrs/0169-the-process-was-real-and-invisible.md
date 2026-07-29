---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0169 — The process was real, and invisible

## Context

`task.md` Q1 asks for five long and five short trades "and why". The answer written
up in `email/tasks_q1_ans.md` is not a list — it is a six-phase portfolio manager's
workflow, and the picks are its output:

| Phase | Question it answers |
|---|---|
| 1 Mandate & risk architecture | What am I solving for, and inside which limits? |
| 2 Alpha sourcing | What is moving, and what does consensus not see yet? |
| 3 Catalyst & scenario | What proves the thesis right, and what do the other paths cost? |
| 4 Construction & sizing | Given the edge and the budget, what weights? |
| 5 Execution & microstructure | Can this be put on without the impact eating the thesis? |
| 6 Attribution & feedback | Was the thesis right, or was the sizing wrong? |

This system already performs five of those six. The problem is that **it never says
so.**

[ADR-0025](0025-book-centric-information-architecture.md) chose the four destinations
"ordered as a PM's morning", and `TopBar.tsx` repeats it: *what's moving → what we'd
put on → what could go wrong → how it was derived*. That ordering is deliberate,
load-bearing, and written **only in a code comment**. A reader landing on `/` cannot
see that Themes feeds Book feeds Risk. No surface states the sequence. The workflow
was real and unreadable — which for an artefact whose whole purpose is to demonstrate
process is the expensive kind of invisible.

A phase-per-tab navigation was the obvious response and was considered first.

## Decision

**Give the process one surface and one label. Leave navigation organised by object.**

Three parts:

1. **`frontend/lib/method/phases.ts`** — the phase map as data: number, name, the
   question it answers, the route + anchor that answers it, coverage, and a note.
   Two consumers read it, so it is data for the same reason `anchors.ts` is: written
   twice they drift, and the failure is silent — a chip claiming "Phase 3" on a page
   the map sends Phase 4 to.

2. **`/method` becomes the process map.** The build chapter moves to `/method/build`;
   `/method/evidence` is unchanged. The map is a server component with **no Supabase
   query**, deliberately not routed through `MethodBody` — which fires all twelve of
   its queries on every chapter on purpose ([ADR-0084](0084-method-is-two-chapters-not-one-document.md)),
   a trade that is right for two chapters of live figures and wrong for a page with
   no figure to be inconsistent about. The built page is 95.8 kB against
   `/method/build`'s 194 kB.

3. **A `PhaseChip` eyebrow on each destination header**, derived from the same map.
   `/risk` renders two.

Inbound `/method#<id>` deep links from ADRs and `PROGRESS.md` keep resolving: the
fragment never reaches the server, so `LegacyAnchorHop` already had to do the hop
client-side off `routeForAnchor()`. Repointing `CHAPTER_ROUTE.build` is the whole fix.

**Phase 5 renders its reason, not a blank.** Per [ADR-0040](0040-published-book-is-the-book-of-record.md)
the published book is a recommendation — nobody has paid to put it on — so there is
no fill, no borrow cost and no slippage. An empty row reads as an unfinished product;
a stated boundary reads as a decision. Inventing the figures instead would break
ADR-0025's rule 1 outright.

## Consequences

Positive:
- The question that precedes both existing chapters — *what are the steps, and which
  does this system perform?* — has a surface for the first time.
- The ordering that lived in a comment since ADR-0025 is now readable, and a reader
  standing on any destination can see where it sits without going to look.
- Where the system stops is stated rather than inferred from an absence.
- `phases.test.ts` asserts every phase anchor is an id some component actually
  renders, so the map cannot rot into links that scroll to the top of a page.

Negative / friction:
- `/method` no longer renders the build chapter. Every documented deep link still
  resolves through the hop, but the **canonical** URL for a formula changed, and docs
  citing bare `/method` for the arithmetic now land one click away.
- A fourth `/method` route to keep in step with `CHAPTER_ROUTE`. Mitigated by
  `method-anchors.test.ts`, which now also asserts no chapter route collides with
  `/method` itself — a collision would make `LegacyAnchorHop`'s no-op branch strand
  a reader on the map.
- The phase map is prose about the system rather than a live query, so it can go
  stale in a way the rest of `/method` cannot. The anchor test bounds this: it
  catches a dead target, not a misleading description.

## Alternatives considered

**One tab per phase (six destinations).** Rejected, and it is the strongest
alternative. It would make the process unmissable — an evaluator would read the
workflow before reading a number — and the two obvious objections are weaker than
they look: Phase 1 is not thin if built properly, and Phase 5's emptiness is a
statement rather than a gap. It fails on a third point instead. **Two phases land on
`/risk`** — the mandate a book is measured against, and the scenarios that stress it
— and separating them to satisfy the numbering breaks the risk picture apart to serve
the narrative. ADR-0025 rejected splitting risk for a cadence reason that has weakened
since; this is a different reason and has not. Navigation by object also survives the
system being *used*, not only evaluated: a reader arrives asking *what is moving*, not
asking to perform phase three.

**A persistent phase stepper across all pages.** Rejected: a stepper implies linear
progress through the pages, which is not how any reader moves through them, and it
spends permanent vertical space on every route to say what a chip says in one line.

**Rename the four destinations to phase names.** Rejected as cosmetic — it loses the
plain-language labels a reader scans for and still does not state the sequence.

**Leave it, and let `tasks_q1_ans.md` carry the process.** Rejected: the document is
not part of the product, and the gap being fixed is precisely that the product does
not say what it does.
