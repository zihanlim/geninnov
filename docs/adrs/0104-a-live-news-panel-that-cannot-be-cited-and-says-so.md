# ADR-0104: A live news panel that cannot be cited, and says so

**Status:** Accepted
**Date:** 2026-07-27
**Amends:** [ADR-0105](0105-most-of-our-tables-record-when-we-asked-not-when-it-happened.md) — which refused this panel
**Related:** [ADR-0009](0009-research-first-design-philosophy.md), [ADR-0084](0084-method-splits-by-reader-question-not-by-copy.md), [ADR-0087](0087-a-chat-that-cannot-do-arithmetic.md)

## Context

[ADR-0105](0105-most-of-our-tables-record-when-we-asked-not-when-it-happened.md) refused a
live news video panel and said: *"if the live panel is ever wanted, it reverses two standing
non-goals and needs its own ADR arguing them down, not a component."* This is that ADR. (Numbered 0104: a concurrent session took 0103 for the themes-page terminal decision while this was being written.)

The owner asked for it, the objections were put twice, and the request was reaffirmed. That
is a decision, not an oversight, and it is recorded here rather than left implicit in a diff.
The two non-goals reversed, in scope:

- **"Real-time / tick-level anything."** The stated harm was that a live-ticking UI
  misrepresents the cadence of a once-daily book.
- **The terminal look** ([ADR-0009](0009-research-first-design-philosophy.md)) — the
  differentiator is the visible rigor of the derivation, not visual fidelity to a terminal.

The sharper objection was neither of those. It was that **a broadcast is the one thing on
this site a reader cannot trace**: every other panel answers "where did this number come
from", and `/ask` ([ADR-0087](0087-a-chat-that-cannot-do-arithmetic.md)) refuses to state a
figure it cannot cite.

## Decision

Ship it, with the objections answered in the build rather than waived.

### The untraceability is stated, not hidden

The panel says, whether open or closed, that these are third-party broadcasts, that nothing
here is fetched, scored or citable, that no figure on the site traces to a stream, and that
`/ask` cannot quote one. The caveat sits **outside** the open/closed branch so collapsing the
panel does not hide it, and a test asserts both the wording and its position.

That is what keeps the traceability standard intact: the exception is *declared*. An
undeclared exception would mean a reader could no longer assume everything on the page is
traceable, which is a far larger loss than one panel.

### The cadence mismatch is answered in place

The book's `run_date` renders inside the same paragraph as the stream: *"a moving picture
beside it does not mean a moving book."* The non-goal's stated harm was misrepresenting
cadence; stating the cadence next to the moving picture addresses the harm directly rather
than by abstention.

### Nothing loads until asked, and that is measured

Collapsed by default with the iframe mounted only on open. A visitor who never opens it makes
**no request to Google at all** — no frame, no cookie, no referrer. Measured, not asserted:
the capture script counts requests matching youtube/ytimg/googlevideo/google.com and
recorded **0 before open, 62 after**. The host is `youtube-nocookie.com`, and this is the
site's only external embed.

### It is a panel, not a fifth destination

It lives on the home page. The top bar stays at four destinations
([ADR-0084](0084-method-splits-by-reader-question-not-by-copy.md)). The picker uses **labelled
buttons**, not station logos — the unlabelled-glyph-rail objection applies equally to a row
of anonymous marks.

### Every channel ID was verified before it was written

A mistyped YouTube channel ID does not error. It renders an empty player, indistinguishable
from a channel that is off air, so it survives review and every manual pass until someone
clicks that one station.

All nine IDs were resolved against `youtube.com/channel/<id>` and matched to their real
channel titles. **The first draft had Al Arabiya as `UCrIsKS1WCsPGTOd4NlnXwXQ`, which returns
a 200 with a blank title — no such channel.** The correct ID was resolved via the
`@AlArabiyaEnglish` handle. That wrong value is now pinned by a test, because it is the kind
of error that looks fine everywhere except on screen.

The embed uses the `live_stream?channel=<id>` form rather than a video ID: a channel's live
video ID changes every broadcast, so an embed built from one works when written and breaks
within a day.

## Consequences

**The site now has an external dependency it did not have.** Streams go off air, channels
change hands, YouTube changes embed rules. When a stream is down the player says so — that is
YouTube reporting, and the panel says as much rather than implying we checked.

**The traceability standard now has exactly one declared exception**, and it is declared in
the place a reader meets it. If a second one is ever added without the same treatment, the
standard is gone, because "everything here is traceable except where stated" only works while
the exceptions are stated.

**`/ask`, the MCP server and the citation guardrail are untouched.** No stream feeds a tool,
no fact derives from one, and nothing in the book's derivation changed. The panel is
adjacent to the product, not part of it.

**What was refused in ADR-0105 stays refused**: the 3D globe, the finance radar over 29
exchanges, and the Country Instability Index. Those fail the triage on *invented data*, which
is a different and unanswerable objection — no amount of framing makes six `GEO_MAP` buckets
into a globe.
