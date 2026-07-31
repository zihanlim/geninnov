# ADR-0197: A lens control belongs on a page where every figure can follow the lens — or where the ones that cannot are marked

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md), [ADR-0015](0015-lens-mode-asset-class.md), [ADR-0084](0084-method-splits-by-reader-question-not-by-copy.md), [ADR-0040](0040-published-book-is-the-book-of-record.md), [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0150](0150-a-recommendation-has-no-pnl.md), [ADR-0082](0082-euler-risk-decomposition-on-the-final-book.md), [ADR-0098](0098-an-absence-must-say-which-kind-of-absence-it-is.md)

## Context

Migration 062 re-keyed `research_recommendations` and `book_holdings` on
`(run_date, lens)`, so one `run_date` now carries both the multi-asset book and the
credit-lens book (ADR-0194). `/book` already resolves `?lens=` and selects the row it
names. `/mandate`, `/risk` and `/attribution` all render ONE component,
`components/risk/RiskBody.tsx`, whose two `research_recommendations` reads were
hardcoded `.eq("lens", "multi_asset")` — correct, and deliberately so, when only one
book could exist per date.

Giving `/mandate` and `/risk` the same control `/book` has reads like a one-line
change: swap the literal for the resolved lens. It is not, and the reason is a
property of `RiskBody` rather than of the lens.

**`RiskBody` makes ~12 reads and they split in two.** The split was verified against
the live 2026-07-30 credit row, not assumed from the migration:

| | tables | under `?lens=credit` |
|---|---|---|
| **Follows the lens** | `research_recommendations` → `book_metrics`, `scenario_results`, `correlation_pairs`, `cap_utilisation`, `picks`, `sanctions_exposure`, `positioning_crowding`, `risk_decomposition`, `monte_carlo_var`, `var_forecast`, `weights_backtest`, `optimizer_result` — **all present on the credit row** | these figures ARE the credit book's |
| **Lens-neutral** | `factor_exposures`, `scoring_config`, `themes`, `theme_signals_history` — per-asset or per-config facts | equally true under any lens; nothing to disclose |
| **CANNOT follow the lens** | `portfolio_risk`, `portfolio_returns`, `portfolio_positions`, `portfolio_cumulative_return`, `book_holdings_performance`, `pick_outcomes`, `benchmark_returns` | still the **multi-asset** book, whatever the URL says |

The second group has no `lens` column because ADR-0194 decided it must not — *"the point
is not 'which lens does this row belong to' but 'this table must not even ADMIT the
question'"*. There is one realised return series, one set of held positions and one
forward track record, and they belong to the book that has published every day since
inception.

**So the naive swap is worse than the pin it replaces.** A page that simply follows the
lens puts the credit book's stress table beside the multi-asset book's VaR headline and
the multi-asset book's drawdown curve, under one page header, with nothing on screen
saying they are two different books. That is one page describing two books — the failure
ADR-0084's "one body, one fetch" exists to prevent for `/method`. Note that ADR-0084
names `MethodBody` and never mentions `RiskBody`: the one-body-one-fetch rule was
extended to `RiskBody` by analogy in `ARCHITECTURE.md` (the `RISKBODY` node reads
"ADR-0040 → ADR-0084"), and this ADR is the first place that extension is argued rather
than asserted. It holds for the same reason and fails in the same way — except that here
the two descriptions would not be two vintages of one run, they would be two books of
the same run, which no reader has any prior reason to suspect.

**Two claims in ADR-0015 are now factually stale and are corrected rather than
restated.** That ADR's frontend section says the `<LensSelector>` *"lives at the top of
`/portfolio` and `/trades`"* — both are retired server redirects to `/book` (ADR-0054,
ADR-0040) — and it characterises the lens as *"a **filter on existing data**, not a
separate backend run"* whose toggle *"just hides rows"*. Since migration 062 the credit
lens IS a separate persisted run (`L5b`), and `?lens=` SELECTS A DIFFERENT PERSISTED ROW
rather than filtering the multi-asset one. ADR-0194 broke that characterisation for the
data; this ADR breaks it for the UI.

What ADR-0015 got right and this does not touch: it rejected a lens click that triggers a
fresh L5 run as *"too slow (LLM call takes 5-30s), too expensive (every click = API
cost)"*. A `?lens=` read of a row the nightly pipeline already published triggers no LLM
call and no write of any kind, so that rejection stands exactly as written.

## Decision

**A lens selector may only appear on a page where every figure can follow the lens — or
where the figures that cannot are visibly marked. `/mandate` and `/risk` get the control
because the marking exists; `/attribution` does not get it because marking could not
save it.**

### 1. The boundary is data, in one module, and it is about tables

`lib/risk/lensScope.ts` owns it. `PANEL_SCOPE` maps every panel `RiskBody` renders to a
scope and the tables its figures come from:

- **`book`** — every source follows the lens (or is lens-neutral). Under `?lens=credit`
  these figures ARE the credit book's. Nothing to disclose.
- **`published`** — every source is a lens-less table: the multi-asset published record,
  unchanged by the toggle.
- **`mixed`** — both, inside one card, under one heading. The worst case to read and the
  one most needing a marker.

Keyed by COMPONENT NAME, because that is the one identifier stable across the three phase
routes: two panels share the `#limits` section id and three are page chrome belonging to
no section. The module is pure — no React, no Supabase, no rendering — so the boundary can
be tested without a client.

`RiskLimitBoard` is the panel that makes the case: five of its eleven rows are valued from
lens-less tables and six from the lens-following analytics row, in one table, under one
heading, with one OK/BREACH column. `VarMethods` is the second: three of its four VaRs
follow the lens and the published one does not, which would put a multi-asset VaR inside a
four-way comparison of credit VaRs — precisely the "two numbers called VaR" defect
ADR-0082 named.

### 2. An unclassified panel resolves to `mixed`, and that default is the point

`scopeOf` returns `"mixed"` for a panel it has never heard of. The two possible defaults
are **not symmetric**:

- Default to `book` and an unclassified panel presents multi-asset figures under a credit
  heading with nothing on screen to say so — the exact defect this module exists to
  prevent, reintroduced by an omission rather than by a decision.
- Default to `mixed` and the worst case is a note on a panel that did not need one.

Over-disclose. A panel somebody adds next month and forgets to classify gets a marker it
may not need; it never gets silence it has not earned. The same asymmetry governs the
banner's phase filter (an unclassified panel is assumed to be on screen) and the chip's
tooltip, which says in as many words that the panel is unclassified and should be read as
multi-asset until it is.

### 3. Two disclosures, at two altitudes

- **`LensScopeBanner`** — once, under the header: which panels below are the lens the
  reader chose and which are still the multi-asset published book, **naming them**. "Some
  figures below are multi-asset" is a sentence a reader cannot act on, because it does not
  say which. It also names the seven lens-less tables and states ADR-0194's reason, so the
  boundary is learned once at the top instead of inferred from scattered chips.
- **`LensScopeChip`** — a quiet `multi-asset book` label in the card header of each
  affected panel, with the panel's full source list in `title`. Deliberately not loud: a
  bright chip on eight cards is the visual noise the default-lens invariant exists to keep
  off this page in the first place.

Both are `role="note"`, **not** `role="alert"`. Nothing here is broken or degraded — a
page showing the multi-asset drawdown beside the credit book's stress table is working
exactly as designed and saying so. Spending the alert register on context is what trains a
reader to ignore it on the day something really is wrong.

The banner names only the lens-less panels **this phase actually renders**. That mapping
(`PANEL_SECTION`) lives in `RiskBody.tsx` and not in `lensScope.ts` on purpose: it states
a fact about THIS FILE's markup (which section a panel sits in), while `lensScope` states
a fact about the database (which tables a panel reads). They rot at different rates and
for different reasons, so they do not share a home. A disclosure a reader can falsify by
scrolling is worse than no disclosure.

### 4. `/attribution` keeps the pin, inheriting ADR-0194 rather than deciding anything new

Phase 6 asks "was the thesis right?", and it is answered from `pick_outcomes` (the forward
record of published picks, ADR-0090) and `book_holdings_performance` (the held book's
cost-netted series, ADR-0150). Migration 062 gave neither a lens column, and ADR-0194
already recorded why in both cases — *"there is no sense in which '21 trading days
forward' means the same thing for a book that coexists with, rather than replaces, another
book on the same day"*, and *"a credit book has no prior credit-lens holding to rebalance
from and no cost budget of its own; giving it a P&L series would be inventing a return
stream nobody sized for."*

So a lens control on `/attribution` could not change a single figure on the page. It could
only put the word "credit" above the multi-asset book's record — a relabelling, which is
worse than not offering the control: it would manufacture a track record for a book that
has none. ADR-0194 says the frontend equivalent of a `lens` column on those tables would
be admitting the question; a selector here is exactly that. The phase is pinned, the
selector is not rendered, and both reads stay `multi_asset`.

**On a day a second lens has published, the pin is stated on screen.** One tertiary line
in the page header — not an alert, nothing is wrong — because the only route by which a
reader could arrive holding the credit book in mind is `/risk?lens=credit`, and they must
not read this page's forward record as the credit book's. Gated on a second lens actually
existing, which is precisely the condition under which the confusion is reachable.

### 5. The default lens renders NOTHING new. That was the constraint, not a nicety

`/mandate`, `/risk` and `/attribution` with no `?lens=` in the URL must look and behave
exactly as they did before this change: no banner, no chip, no spacing change, no reordered
section. A live submission is being shown from the default page on 2026-08-03.

Four mechanisms, deliberately redundant:

1. `showScopeNote(lens, panel)` returns `false` for EVERY panel at `multi_asset` — not
   "usually false", false, asserted over the whole map by test.
2. `LensScopeBanner` and `LensScopeChip` each return `null` at `multi_asset` **checking it
   themselves**, rather than trusting the call site to guard them. "The component only
   renders when the caller remembers" is a habit, not an invariant.
3. `INITIAL.resolvedLens` is `DEFAULT_LENS`, not the URL's value: the first paint of a
   `?lens=credit` page has read nothing yet and must not yet claim to be showing the credit
   book. The banner appears WITH the credit figures, never a beat ahead of them.
4. The effect's dependency is `requestedLens` — the URL's raw value, `null` on every page
   with no lens in it — so the default path re-runs exactly as often as the old `[]` deps
   did: once. The two queries and the markup are unchanged.

The single visible addition a default-lens reader can see is the selector itself, and only
on a day a second lens actually published a book for the run date. A control offering a
book that does not exist is worse than no control; a feature reachable only by a
hand-typed query string is not a feature.

### 6. The fetch was not split, and `?lens=` is not a sub-route

ADR-0084's Decision 2 accepts a known cost — each chapter fires all twelve queries — and
says to **"revisit only behind a shared cache, never by splitting the fetch."** This change
does not split it: one `useEffect`, one `Promise.all`, with the lens resolved before the
batch so both `research_recommendations` reads carry the same key and cannot disagree about
which book the page describes.

ADR-0084's Decision 6 stop rules say a sub-route may only split a top-bar destination by
section, and no sub-route ever appears in the top bar. A `?lens=` query parameter on an
existing route is not a sub-route: it adds no path, no nav entry and no second copy of the
data — it selects which published row the existing page reads. The stop rules are untouched,
and this ADR says so explicitly rather than leaving it to be re-litigated.

### 7. The reconciliation banner is suppressed under a non-default lens

`RiskBody`'s provisional-positions warning compares `portfolio_positions` (lens-less,
always the multi-asset book) against `research_recommendations.picks` (which now follows
the lens). Under `?lens=credit` those are two DIFFERENT BOOKS BY DESIGN, so the comparison
fails on every run and the banner would announce "these are provisional positions" in the
loudest register the page has, about a page working exactly as specified. What replaces it
is not silence: the panel is classified `mixed`, the `LensScopeBanner` names every lens-less
panel on the phase, and each panel computed on `portfolio_positions` carries its own chip.
The split is stated once, correctly, instead of being mis-reported as a breach.

### 8. Discovery is the one lens-unqualified read, and the guard that proves it was leaky

Both `/book` and `RiskBody` now resolve the lens through `lib/book/lensProbe.ts`
(`fetchLensesForLatestRun`), which asks WHICH lenses published a book for the latest
`run_date`. It is the only read of `research_recommendations` in the tree without a lens
filter, and it has to be: filtering it by lens would be circular — it could only confirm
the lens the caller already assumed and could never report one the caller did not think to
ask about, which is the entire question. The exemption is marked in-line
(`LENS-DISCOVERY-EXEMPT`), pinned by test to that ONE file by name, and the exempt set is
asserted to have exactly one member, so copying the comment onto a second unfiltered read
fails the suite rather than joining the exemption. It reads 40 rows rather than 1, because
`limit(1)` would return one of today's books and report "one lens published today" however
many actually did.

Writing that turned up a real hole in `lens-qualified-reads.test.ts`, the guard ADR-0194
relies on. It scanned 1200 characters forward from each matched read and accepted any
`.eq("lens", …)` inside the window — but on a page firing several reads from one
`Promise.all` (RiskBody's twelve, BookBody's five) that window runs straight into the NEXT
query, so **an unfiltered read could pass on its neighbour's filter**: a false pass of
exactly the bug the file exists to catch. The window is now truncated where the sibling
statement begins (`.from(` for a Supabase chain, `.select(` for the `DbReader` form), so
every filter counted is the matched query's own.

## Consequences

- **`/mandate` and `/risk` can be read as the credit book, and every figure that is not
  the credit book says so.** `/risk?lens=credit` is a linkable URL — selection lives in
  the URL exactly as on `/book`, so a reviewer can send someone the page they are looking
  at.
- **Design goal 2 gains a third state it did not have.** "Absence is stated, never filled"
  covers a null; a multi-asset VaR under the credit lens is not absent and not zero — it
  is A DIFFERENT BOOK'S FIGURE, a third kind of thing, and it now has a name on screen
  (ADR-0098's "an absence must say which kind of absence it is", one category wider).
- **Design goal 5's test is answered concretely.** For every control, name the code path
  it triggers, and if it reaches a server, name what it can change. The lens control calls
  `router.push` on a query parameter, which re-runs a client-side read of rows the nightly
  pipeline already published. It changes **nothing in the book** — no write, no LLM call,
  no pipeline invocation.
- **The classification is hand-maintained, and only half of it is enforced.** The tests
  check the map against itself — every `published` panel names only lens-less tables, no
  `book` panel names a lens-less table, every `mixed` panel really names both kinds — but
  nothing parses the components to check that a panel's declared `sources` are the queries
  it actually reads. A panel whose data source changes without its entry changing will be
  disclosed wrongly and no test will notice. `scopeOf`'s over-disclosing default protects
  against a MISSING entry, not a STALE one.
- **The banner lists panels, so it grows with the page.** On `/risk` under a non-default
  lens it currently names six. A phase that acquires many more lens-less panels will need
  the disclosure re-thought (grouped, or moved into the section headers) rather than
  extended — a list nobody finishes reading is the same failure as no list.
- **`/attribution` remains the page that cannot answer its own question for the credit
  book.** This ADR does not fix that and must not be read as deferring it further than
  ADR-0194 already did: starting a credit track record is a real design question about a
  second concurrent denominator, named there as a deliberate debt.
- **ADR-0015's "display filter, not a re-run" characterisation is superseded for `/book`,
  `/mandate` and `/risk`.** Its `<LensSelector>` section also names `/portfolio` and
  `/trades` as the control's hosts; both are retired redirects. The ADR body stays as
  written (it is the record of what was decided in July), and this is the correction a
  reader arriving at it should be pointed to.
- **Two more surfaces now depend on the credit run having happened.** If `RUN_CREDIT_LENS`
  is switched off or L5b fails on a MiniMax 429, the selector simply does not render and
  all three pages are the multi-asset book — the same degradation ADR-0194 designed, now
  visible in one more place.

## Alternatives considered

- **Swap the hardcoded lens and ship nothing else.** The one-line change. Rejected: it is
  the defect this ADR is about — credit stress scenarios beside a multi-asset VaR headline
  and drawdown curve, with nothing marking the difference. Strictly worse than the honest
  hardcoded pin it would replace, because the pin never claimed to be anything else.
- **Give `/attribution` the selector too, for consistency across the three phase routes.**
  Rejected: it could not change a figure on the page, only the word above it. Consistency
  of controls is not worth a manufactured track record, and ADR-0194 closed exactly this
  door at the schema level for the same reason.
- **Hide the lens-less panels entirely under a non-default lens.** Tempting — no wrong
  figure can be misread if it is not on screen. Rejected on design goal 2: a panel that
  vanishes makes "this book has no realised series" indistinguishable from "this feature
  does not exist", and the multi-asset drawdown IS a fact worth having beside the credit
  book, once it is labelled. State the boundary; do not delete the content.
- **Split `RiskBody`'s fetch so each phase queries only what it renders, then vary the lens
  per phase.** Rejected by ADR-0084 Decision 2 in advance: *"revisit only behind a shared
  cache, never by splitting the fetch."* A lens is not the exception that justifies it, and
  three fetches would be three chances to describe different vintages — on top of the two
  books this change already has to keep apart.
- **A separate `/mandate/credit` and `/risk/credit` route pair instead of a query
  parameter.** Rejected: ADR-0084's stop rules allow a sub-route only to split a
  destination BY SECTION, never by copy of the same data, and two routes rendering one body
  against two rows is the definition of a copy. It would also double the surface that has to
  keep the default page byte-identical.
- **Classify unknown panels as `book` and require an explicit entry to disclose.** Rejected
  — see Decision 2. Silence by omission is the failure mode; a redundant note is not.

## Links

- Boundary: `frontend/lib/risk/lensScope.ts` (`PANEL_SCOPE`, `scopeOf`, `showScopeNote`,
  `lensLessPanels`, `LENS_LESS_TABLES`, `LENS_NEUTRAL_TABLES`)
- Disclosures: `frontend/components/risk/LensScope.tsx` (`LensScopeBanner`,
  `LensScopeChip`)
- Call site: `frontend/components/risk/RiskBody.tsx` (`lensEnabled`, `PANEL_SECTION`,
  `ScopeNote`, `resolvedLens`)
- Discovery: `frontend/lib/book/lensProbe.ts` — the one lens-unqualified read, also now used
  by `frontend/components/book/BookBody.tsx`
- Tests: `frontend/tests/unit/lens-scope.test.ts` (20 cases),
  `frontend/tests/unit/lens-scope-components.test.tsx` (14),
  `frontend/tests/unit/lens-qualified-reads.test.ts` (+2, including the truncated-window
  fix) — 38 passing across the three files
- Prior decision this rests on: [ADR-0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md) §2 (the four
  track-record tables get NO lens column) and §3 (`book_holdings` gets a write from every
  lens)
