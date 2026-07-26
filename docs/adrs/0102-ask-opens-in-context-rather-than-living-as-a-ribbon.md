# ADR-0102 — `/ask` opens in context, rather than living as a ribbon

**Status:** Proposed (2026-07-27) — drafted for the owner of the chat surface and the
maintainer to accept or reject. Not implemented. Supersedes nothing; it refines the
placement decision recorded inline in `TopBar.tsx` and constrained by
[ADR-0054](0054-a-daily-publication-not-a-scanner.md).

## Context

The question raised: should the "Ask the book" AI be a **ribbon persistent over every
page** rather than its current separate `/ask` page?

The current design is deliberate on three axes, and any change has to clear all three:

1. **`/ask` is a control, not a destination.** It sits *outside* the four-destination
   nav (`themes · book · risk · method`), styled as a button in the top bar. The inline
   rationale in `TopBar.tsx`: "adding 'Ask' to that list would claim the chat is a peer
   of the book rather than **a way of reading it**." The four-destination rule is in
   `docs/design-goals.md`; [ADR-0054](0054-a-daily-publication-not-a-scanner.md) frames
   the whole product as a daily research **publication, not a chat-first tool** — which
   is also the practitioner transcript's explicit complaint about AI tooling
   (`GOAL.md` §"four bars", item under "what already clears the bar").
2. **`/ask` is a scrolling document, not a chat-app shell** (goal 7, stated at the top
   of `app/ask/page.tsx`): an `h-screen` inner scroller breaks Ctrl+F, deep links and
   long transcripts, and photographs badly. The conversation grows *down the page*.
3. **`/ask` does not stream.** The citation guardrail cannot verify a figure that is
   still being typed, so answers arrive whole and checked. This is load-bearing: it is
   the same guardrail that stopped `/ask` quoting a Sharpe of 6.32 from three
   observations (commit `cd301ca2`).

**The one real weakness of the status quo** is not that `/ask` is a page — it is that
the page is *context-blind*. A reader on `/book` studying the BABA short who wonders "why
is this the size it is?" must navigate away from the very row the question is about, and
retype which name they mean. The stated intent — chat as "a way of reading *it*" — is
undercut the moment answering requires leaving *it*.

## Decision (proposed)

**Do not make `/ask` a ribbon.** A ribbon — an always-open chat panel over every page —
is the chat-first model this product deliberately rejects: it makes the conversation
compete with the publication for attention, and functionally becomes the fifth
destination the nav rule exists to prevent. That is an off-philosophy regression, not an
improvement.

**Instead, make the existing Ask control open *in context*.** Keep it an *invoked*
control (a button, and/or `⌘K`), but on pages with a focusable subject have it open a
**lightweight, dismissible overlay pre-seeded with what the reader is looking at** — the
current route, and the focused position/theme if one is open — so the first question is
"why is *this* the size it is?" with *this* already resolved. The overlay:

- **inherits the no-stream guardrail unchanged** — answers arrive whole and citation-checked;
- **is not a destination and not persistent** — it opens on invocation and closes on `Esc`
  or click-away, so the nav stays four items and the page stays the primary surface;
- **carries an "open full session" affordance** that deep-links to `/ask` with the same
  context, because the full scrolling page remains the right home for long, multi-turn,
  copy-and-share research (goal 7). The overlay is for the quick "about this"; the page is
  for the session.

In short: the fix for context-blindness is **context-awareness**, delivered by an invoked
overlay — not by an always-on ribbon, and not by keeping a context-blind page.

## Consequences

- **Serves the stated intent better than today.** "A way of reading it" becomes literal:
  the question is asked from, and answered against, the thing on screen.
- **Preserves every guardrail that matters.** No streaming, no fifth destination, no
  chat-app shell. The overlay is a thinner presentation of the same checked, whole answers.
- **New surface to get right.** An overlay must itself pass the UI bar — no horizontal
  scroll at 375, dismissible via keyboard, focus-trapped, and it must **degrade to the
  plain `/ask` link on routes with no focusable subject** rather than open an empty-context
  box. On a page that is one datum, both forms should coexist.
- **Coordination.** The chat surface (`frontend/lib/chat/*`, `app/ask/`) is the other
  session's active workstream (`cd301ca2`). This ADR is a proposal for them to land or
  reject, not a change to their code. If accepted, the seam is small: a context object
  `{route, focusedAsset?, focusedTheme?}` passed into the existing agent call, plus an
  overlay wrapper around the existing (non-streaming) answer renderer.
- **Rejected alternative — the ribbon.** Recorded here so it is not re-proposed without a
  new argument, per the `GOAL.md` discipline: an always-open chat ribbon is rejected
  because it inverts the publication/tool relationship ADR-0054 fixes.
