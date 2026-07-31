# ADR-0202: A claim about which book is not a table read

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0197](0197-a-lens-control-belongs-where-every-figure-can-follow-it.md), [ADR-0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md), [ADR-0200](0200-a-candidate-the-lens-removed-is-not-a-candidate-the-book-declined.md), [ADR-0201](0201-a-name-the-cap-cut-is-marked-and-a-name-the-lens-removed-is-hidden.md), [ADR-0192](0192-a-fallen-angel-transmits-through-measured-not-hand-set-shocks.md), [ADR-0180](0180-the-note-is-beside-the-board-the-source-is-not.md), [ADR-0087](0087-a-chat-that-cannot-do-arithmetic.md)

## Context

ADR-0197 built the lens-disclosure machinery and ADR-0200/0201 fixed the candidate pool.
Both work on the same axis: **which table did this figure come from, and does that table have
a lens column.** `lib/risk/lensScope.ts` is the register, `LensScopeBanner`/`LensScopeChip`
the rendering, `lens-qualified-reads.test.ts` the guard.

A five-agent audit was then run over `/mandate`, `/` (Alpha), `/book` (Sizing), `/risk` and
`/attribution`, one agent per page, each checking every panel's declared sources against its
actual reads. **The data axis came back clean.** Every panel classified `book` genuinely
follows the lens; every panel reading a lens-less table is chipped or named in the banner;
the classification list matched the real reads panel by panel.

Eleven defects were found anyway, and every one of them is on an axis none of that machinery
can see:

| Kind of claim | Instance | What it said | What was true |
|---|---|---|---|
| A **hardcoded numeral** | `StressScenarios` footnote | "the largest of **six** hypotheticals" | credit carries **seven** ([ADR-0192](0192-a-fallen-angel-transmits-through-measured-not-hand-set-shocks.md)) |
| | `/risk` lede | "**Six** calibrated shocks" | same |
| | `AnswerCards` | "Worst of the **five** stresses" | six and seven — wrong under **both** lenses |
| | `PositioningCrowding` | "**four fifths** of this book" | credit is **3 of 3**; the cap sized *nothing* |
| A **source line** | `/mandate` "Closest to binding" | `scoring_config × portfolio_positions` | `book_metrics.net_exposure` |
| | `/mandate` "Mandate in use" | `book_metrics.gross_exposure` | …× `portfolio_risk.total_capital` |
| A **sentence about existence** | `/attribution` pin note | "no per-lens version of them to show" | `weights_backtest` has one: **+4.13% @ 1.88** vs **+13.23% @ 1.42** |
| An **outbound href** | `/book` → `/risk`, `/mandate` (×5) | "for **this book** are on Risk" | resolves to `DEFAULT_LENS` |
| A **noun** | `/book` → `/workbench` | "edit a copy of **this book**" | seeds multi-asset only, and cannot take a lens |
| | `/` factor panel | "Factor tilt of **book**" | HML **+0.11 → −0.04**, CMA **−0.46 → +0.08** |
| | `LiveFeed`, on **every page** | "Held tickers **9**" | credit holds **3** |
| An **inert guard** | `AbstentionRoster` | `tradedThemeIds` empty ⇒ "nothing traded" | credit picks carry no `theme_id` ⇒ *unknown* |

Read the middle column again: not one of those is a query. `lensScope.ts` cannot see a
literal in JSX, a `source:` string, an `href`, the word "this", or a `Set` that is empty for
two different reasons. **The disclosure machinery reasons about provenance; these are
assertions.** A panel can be perfectly classified, correctly chipped, reading exactly the
table it declares — and still tell a reader the wrong thing in the sentence beside the
figure.

Two of these deserve singling out because they are worse than mislabels.

**The `/mandate` source line inverted its own panel.** `portfolio_positions` is lens-less, so
the scope banner names it among the tables that "are the multi-asset published book, not the
Credit Lens book". The figure above that source line is the credit book's **167% breach** of
the 30% net limit (net 0.50; the multi-asset book sits at 26% and breaches nothing). So the
disclosure machinery, working exactly as designed, was recruited to help a reader **discount
the only breach on the page** as some other book's number. The direction is the inverse of
the contamination the audit was hunting — credit data wearing multi-asset provenance — and
the consequence is worse.

**The `/book` links were correct when written and became false later.** They pointed at bare
`/risk` and `/mandate`, which were pinned to multi_asset at the time; ADR-0197 gave both a
working `?lens=` control, and from that commit the sentence "stress scenarios for THIS BOOK
are on Risk" was wrong. Nothing changed in either file. **A cross-page link is the one place
a lens can be dropped with no figure changing to give it away** — and because the destination
has no `?lens=` in its URL, `showScopeNote` is false for every panel there, so neither end
of the journey says the book changed.

## Decision

**A page may only assert a numeral it derived and a book it is actually showing. Where a
figure cannot be derived, the count comes out of the copy; where a destination cannot follow
the lens, the sentence names the book instead of the lens carrying it.**

Seven rules — one per kind of claim, plus the two that say what NOT to do:

### 1. A numeral in copy is read from the payload, or it is not written

`rows.length` for the scenario footnote; `x.unobservable.length` of `total` for the crowding
sentence. Where the value genuinely is not reachable — the `/risk` lede is a static string in
a phase-config map with no access to the fetched row — **the count is removed, not
approximated**. A numeral that cannot be derived does not belong in copy that outlives the
run it described. Same for `AnswerCards`: threading a count prop through `BookBody` for a set
the reader can see enumerated on `/risk` buys nothing, so the sentence names the scenario and
drops the number.

### 2. A source line names what was read, dynamically where the source varies

"Closest to binding" now reads the **tightest row's own** `LimitDef.source` (ADR-0180), so
the card and the row it links to cannot disagree and a limit added later needs no edit in
this file. Its sibling declares both tables it spends. This is the same move ADR-0198 made
for the worked-example lineage — a `sourceColumn` is the one field a reader takes as a
citation, so a stale one is not a documentation defect, it is a false citation.

### 3. A link carries the lens exactly as far as the destination honours it

`lensHref(path, lens)` in `lib/book/lensView.ts`. Three properties, all tested:

- returns the path **by identity** for the default lens, an unknown lens, or null — so every
  href on the default site is byte-for-byte unchanged, provable by reference equality rather
  than string equality;
- re-appends the fragment **after** the query, because `/risk#stress?lens=credit` is a
  fragment named `stress?lens=credit` — a dead anchor *and* a dropped lens from one wrong
  concatenation;
- refuses a value that is not a real lens, so `?lens=garbage` is not forwarded as though it
  named a published book.

**Only for destinations that honour it.** `/method` is a process map with no book figure and
`/workbench` cannot take a lens at all — a parameter in a URL the page discards **looks
answered**, which is worse than none.

**Navigation is deliberately excluded.** `SideRail` and the phase strip are destination
lists; they claim nothing about "this book", and three of their six targets (`/`,
`/execution`, `/attribution`) ignore the lens. Landing on the default book from a nav click
is defensible in a way that landing there from "stress scenarios for *this book*" is not.

### 4. Where the lens cannot be carried, the noun states which book

`/workbench` seeds multi_asset and cannot be handed a lens, so `/book`'s sentence names the
multi-asset book under a non-default lens and `/workbench` says so in its own seeding line
**unconditionally** — that page has no lens in its URL to gate on, and the ambiguity is in
the noun rather than in the state.

`/ask` is the sharpest case: `lib/chat/tools.ts` pins it to multi_asset (ADR-0194 — the
credit book has no track record), and `AskDock` mounts the console in the TopBar of **every**
page. So a reader on `/book?lens=credit` could take Ask's own suggested question — *"Why is
the largest position sized the way it is?"* — and get an answer about a book with different
positions, in a window floating over the one they were reading. **Not a fix to the pin, which
is deliberate; a fix to the silence around it.** The note appears only when the URL asserts
another lens.

### 5. Conditional on a non-default lens, everywhere it is a *state* and not a *noun*

`LiveFeed`'s "(multi-asset)" and the homepage's "the multi-asset book" render **only** when
`?lens=` names a real non-default lens — the same gate `showScopeNote` uses, and for the same
reason ADR-0197 gave: with one book there is nothing to disambiguate, and a qualifier on
every page of the default site is noise on the one view a submission is read from.

### 6. An empty set that means two things is marked

`AbstentionRoster`'s `tradedThemeIds` arrives empty under credit — L5's credit picks carry no
`theme_id` and the `portfolio_positions` fallback holds only multi-asset names — and the
roster read that as "nothing below the bar traded". The guard that stops it listing a theme as
"scored, not traded" beside that theme's own position was **inert and looked live**. Nothing
false renders today; the first credit book that trades a sub-threshold theme would have been
told it held out of it. `tradedKnown` marks it.

### 7. What was NOT changed, and why the audit was wrong about it

`WeightsBacktest` is classified `book` in `lensScope.ts`, and an agent proposed reclassifying
it `published` with a `(pinned)` source because the panel reads a lens-keyed column on a
pinned page. **Rejected, and the reasoning matters.** `book` means "these figures ARE this
lens's book". On `/attribution` `resolvedLens` is always the default, so `showScopeNote`
short-circuits and no chip is correct; and if the lens were ever enabled the read would
follow it, so the figure would genuinely be the credit book's and *still* need no chip.
Marking it `(pinned)` would make the chip **actively false** in the one scenario it exists
for. The real defect there was the page's sentence, not the classification.

`tests/unit/lens-scope.test.ts` asserts the `(pinned)` entitlement list by name specifically
so that adding one "fails here with the panel's name, which is the conversation that ought to
happen". It happened, and the answer was no.

## Consequences

**Good.**

- Every "this book" on the site now refers to the book the reader is looking at, or names the
  one it actually means.
- The scenario count, the crowding coverage and the pool figures agree with the funnel and
  with each other under both lenses — verified on screen: credit reads 7 / 7 / 3-of-3,
  default reads 6 / 6 / 7-of-9.
- The default site is unchanged, provably: `lensHref` returns by identity and the outbound
  hrefs were diffed under both lenses (`/risk`, `/risk#stress`, `/mandate`, `/mandate#limits`
  bare on default; `?lens=credit` forms on credit).
- `/attribution` states the one exception to its own pin, with the figures that make it
  checkable.
- `tests/unit/lens-href.test.ts` guards the link discipline by parsing the three components
  that render book figures and link out, plus a non-vacuity assertion so a guard that passes
  because the pattern is absent everywhere cannot pass silently.

**Costs, stated.**

- **The numeral rules are not enforced by anything.** A new hardcoded count in copy is
  invisible to every test in the repo. A guard would have to parse JSX prose for number words
  and know which are derivable — plausible for `six|seven|five` beside the word "scenario",
  not plausible in general. This ADR is the record; there is no gate.
- **Source lines are still hand-written** except the one now reading `LimitDef.source`.
  ADR-0198's migration-parsed allowlist checks that a cited table/column EXISTS, not that it
  is the one this figure came from.
- **Two new `<Suspense>` boundaries** (`LiveFeed`, and the Ask note) — required, not
  stylistic: a client component reading `useSearchParams` under the ROOT layout bails static
  rendering out for every route. Scoped as tightly as possible, and the Ask one wraps the
  note rather than the console precisely so a late-arriving boundary cannot delay a composer.
- **`/ask` still answers about one book.** Disclosed, not fixed. Making the chat lens-aware
  means a lens-parameterised tool layer and a second book's worth of guardrail surface, and
  ADR-0194's reason for the pin (the credit book is published for inspection) has not
  changed.
- **`/workbench` still cannot seed another lens.** Named on screen instead.
- Nav does not carry the lens, so a reader who navigates rather than clicking a figure will
  silently change books. Judged correct in §3; it remains the one place the lens is dropped
  on purpose.

**Rejected.**

- Reclassifying `WeightsBacktest` (§7).
- Propagating `?lens=` into `SideRail`/phase-strip nav, or into `/method` and `/workbench`
  (§3).
- Threading a scenario count into `AnswerCards` (§1).
- Making the `LiveFeed` and homepage qualifiers unconditional — noise on the default site,
  which is the view a submission is read from.
- Fixing `/ask`'s pin rather than its silence.
