---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0170 — The navigation is the process

**Supersedes the navigation decision in [ADR-0169](0169-the-process-was-real-and-invisible.md).**
That ADR's phase map, its data model and `/method` as the process surface all
stand. Its conclusion — *keep four object-shaped destinations* — does not.

## Context

ADR-0169 surfaced the six-phase workflow on one page and labelled each
destination with a chip, having considered and rejected one tab per phase. Its
rejection rested on three claims:

1. Two phases land on `/risk`, and splitting them breaks the risk picture apart.
2. Phase 5 would be a permanently empty destination.
3. A reader arrives asking *what is moving*, not asking to perform phase three.

The owner directed the six-tab structure anyway, on the grounds that **the
sequence is what the artefact is demonstrating**, and a numbered strip teaches it
before a reader has read a word. That is a judgement about what the product is
FOR, and it outranks the layout convenience the three claims above were
defending.

Two of those claims survive as *costs*. They are paid below, not argued away.

## Decision

**`TopBar` and `SideRail` render `PHASES` in order, numbered.** The nav is
generated from the same array `/method` renders, so the strip and the map cannot
disagree about how many phases there are or what they are called.

```
01 Mandate  02 Alpha  03 Scenario  04 Construction  05 Execution  06 Attribution
```

**`/risk` is split across three routes.** A tab strip cannot mark three of its own
tabs current, and `/risk` answered phases 1, 3 and 6 at once. The body moved to
`components/risk/RiskBody.tsx` and is filtered by `phaseShows` from
`lib/method/phaseSections.ts` — the same shape as `MethodBody` + `chapterOwns`,
and for the same non-negotiable reason: **one `useEffect`, one set of queries**.
Three routes with their own fetches are three chances to describe different
vintages of one run, which is the contradiction ADR-0040 closed and ADR-0084
refused to reopen. `risk-sections.test.ts` asserts the single fetch, that every
section belongs to exactly one phase, and that no phase renders a section its own
nav never names.

Two placements in that split are deliberate and easy to get wrong:

- **`limits` sits with the mandate**, not with stress. The limit board measures
  against the mandate panel directly above it, and separating a constraint from
  the reading of it is what made the caps unreadable before `MandatePanel`.
- **`attribution` (per-position risk decomposition) sits with SCENARIO**, not with
  the phase of the same name. It is ex-ante — which position would hurt most if
  something happened — and phase 6 is ex-post. The shared word disguises two
  different questions.

**`/risk` survives as a fragment-aware hop, not a redirect.** Its anchors now live
on three routes, and a server redirect cannot see a hash — the browser strips it
before the request. So the route reads the fragment client-side and forwards:
`/risk#stress` → `/scenario#stress`, `/risk#limits` → `/mandate#limits`. Bare
`/risk` goes to `/mandate`. In-repo links were repointed directly so they do not
flash-and-hop.

**`/execution` is a route with no figures, on purpose.** A sequence that skips from
4 to 6 reads as a missing page. It is not missing: per ADR-0040 the published book
is a recommendation nobody has paid to put on, so there is no fill, borrow cost or
slippage anywhere in the system, and inventing them would break ADR-0025's rule 1.
The page names what the phase would need instead.

**`/method` and `/risk` leave the nav.** The method chapters explain *every* phase,
so naming them as one would be false. `/method` remains as the process map.

`PhaseChip` is deleted — the numbered tab carries phase identity now.

## Consequences

Positive:
- The process is the first thing a reader sees, before any number.
- Every phase has exactly one route, so a tab can be marked current — pinned by
  `phases.test.ts`, which fails if two phases ever share a route again.
- Where the system stops is a destination, not an omission.
- The nav, the rail and the process map are one array. They cannot drift.

Negative / friction — recorded because they are real:
- **Reading the whole risk picture is three stops rather than one scroll.** This is
  ADR-0169's first objection, now a cost rather than a prediction. Anyone
  comparing stress against cap headroom against realised drawdown now navigates
  between them.
- `/risk` deep links flash a skeleton before hopping. Unavoidable for the same
  reason `LegacyAnchorHop` is: only the browser knows the fragment.
- `SideRail` needed a **third** label. It is 56px and cannot widen (ADR-0086 —
  `/book`'s two-pane layout needs the pixels), leaving ~9 characters at 10px, and
  `Construction` clipped on the live rail. `Phase.short` fixes it with a WORD, not
  a number: the rail's own rule is icon *and* label, so a reader who does not
  recognise the glyph must still be able to read where it goes. Three labels per
  phase (`name`, `tab`, `short`) is a maintenance surface, bounded by a test that
  fails if a rail label exceeds nine characters.
- Six tabs overflow a narrow viewport. The row is `overflow-x-auto`, so it scrolls
  rather than dropping a phase — a sequence that hides its last step is worse than
  one that scrolls.

## Alternatives considered

**Keep four destinations (ADR-0169's decision).** Overridden by the owner. The
argument for it is in ADR-0169 and is not repeated here; what changed is not the
analysis but the priority — the artefact is demonstrating a process, and
navigation that teaches it is worth the split.

**Six tabs scoped to `/method`.** Considered: each phase a route under `/method`,
top-level nav unchanged. Rejected because it leaves the sequence one click deep,
which is most of what ADR-0169 already did.

**Turn the process map's list into a tab strip on one page.** Rejected: no new
routes, but the phases would be tabs on a page rather than the site's own
structure — the version of "clearer" that changes the least.

**Keep `/risk` whole and let two tabs point at it.** Rejected: two tabs current at
once is a lie to a screen reader (`aria-current="page"` twice) and unreadable
visually. The split is the price of the strip.
