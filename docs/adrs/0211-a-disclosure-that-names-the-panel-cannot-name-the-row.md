# ADR-0211 — A disclosure that names the panel cannot name the row

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0194](0194-a-credit-book-published-for-inspection-is-not-yet-a-track-record.md), [0197](0197-a-lens-control-belongs-where-every-figure-can-follow-it.md), [0207](0207-a-limit-that-cannot-be-satisfied-is-not-a-limit.md), [0208](0208-a-nine-name-hhi-says-nothing-about-three-names.md), [0162](0162-a-mark-you-can-see-but-cannot-name.md), [0180](0180-the-note-is-beside-the-board-the-source-is-not.md), design-goals.md §1, §3, §7, §8

## Context

Migration 062 keyed `research_recommendations` on `(run_date, lens)` and deliberately
gave no lens column to `portfolio_risk`, `portfolio_returns`, `portfolio_positions`,
`pick_outcomes` and four others — ADR-0194: a second book must not write into the first
book's record. `lensScope.ts` classifies each panel against that boundary, and the
risk-limit board on `/mandate` is the worst case it names: `scope: "mixed"`.

Measured live on `/mandate?lens=credit`, 2026-08-01:

| | rows | verdicts on this run |
|---|---:|---|
| valued from lens-less tables | **5** | HHI OK, drawdown OK, VaR/CVaR/β `NO DATA` |
| valued from `research_recommendations` | **6** | 3 caps NEAR, gross OK, net N/A, turnover `NO DATA` |

Eleven rows, one heading, one OK/BREACH column. `LensScopeBanner` already said the board
was **part multi-asset** and sent the reader here to find out which half — *"Which rows
are which is in each panel's own marker"* — and the marker was `LensScopeChip`, which
names the panel's TABLES and stops. The banner made a promise the chip did not keep.

A determined reader could still get there. ADR-0180 split `LimitDef.source` out of the
prose note precisely so every row prints its own `table.column`, and those strings do
carry the answer: `portfolio_risk.var_95 / total_capital` is lens-less,
`book_metrics.gross_exposure` is not. But reading them that way requires a fact that is
nowhere on screen — that `portfolio_risk` has no lens column while `book_metrics` is a
JSONB **field** of one that does. `book_metrics` looks exactly like a table name. The
provenance was published (goal 1) and the *interpretation* of it was not, which is the
same shape as ADR-0162: an encoding that a reader can see but cannot name.

What made this worth fixing rather than tolerating is the direction the error runs.
ADR-0208 established it on this very board: a diversification figure borrowed from a
nine-name book reads as **reassurance** about a three-name one. The mandate page's
question is *"am I inside my limits"* and its answer is a verdict column, so an unmarked
OK on a row whose measurement is another book's is a compliance claim the credit book
never earned.

## Decision

**Provenance is disclosed at the granularity the reader has to act on it — the row.**

`lib/risk/lensScope.ts` gains `sourceProvenance(source)` over the source strings the
rows already carry, returning `published | book | unclassified`, and
`showSourceScopeNote(lens, source)` — the row-level twin of `showScopeNote`, holding the
identical contract: **false for every source under `multi_asset`**, so `/mandate` with no
`?lens=` renders byte-for-byte as it did before row tagging existed. That invariant is
asserted over the live board's whole source set, not spot-checked, and again as a
render-equality test between the prop omitted and the prop set to the default.

Three choices inside it:

- **Tokenised, not prefix-matched.** The VaR row is a ratio over two columns of one
  table (`portfolio_risk.var_95 / total_capital`). Splitting on the first `.` works here
  by accident and breaks the first time a row cites a denominator from elsewhere.
- **`published` wins a tie.** A source naming both a lens-less table and a lens-following
  field is a row that is itself part multi-asset, and leaving it unmarked asks the reader
  to hold that unmarked — the thing being fixed.
- **`unclassified` is marked, not passed.** Same asymmetry `scopeOf` runs on: default to
  "book" and a new lens-less row ships unmarked under a credit heading. A test asserts no
  row the live board builds is unclassified today, so the backstop is not the shipping
  state.

The board renders the tag **beside the source it qualifies**, between the source and the
limit — it qualifies the measurement on its left, not the limit on its right, and the
limit governs this book either way. It states the split as a count in its intro
(*"5 of these 11 rows…"*) **before** the reader meets the first tag, because a per-row
tag with no total leaves a reader unable to tell a board they have finished checking from
one they have only partly read.

**Neutral ink, deliberately.** `text-text-secondary`, one step out of the source line's
tertiary — measured 9.39:1 on the card and 8.50:1 on the hovered row, against goal 8's
4.5:1 floor. Not `--warning`: nothing here is broken, a limit measured on the multi-asset
book is ADR-0194 working as designed, and goal 3 fences the attention register for the day
something really is wrong. Rendering in prose type beside the mono source also stops the
two reading as one string. Five loud chips down a quarter-width column is the noise goal 7
warns about — and unnecessary, because the banner has already sent the reader here
*looking* for the marks.

`lensLabel` moves from `LensScope.tsx` into `LensSelector.tsx`. Three surfaces now name a
lens in prose, and a second copy of that lookup is a second place "Credit Lens" can come
to disagree with the control the reader clicked.

## Consequences

- **The banner's promise is now kept for one panel, not all of them.** `MandateAnswerRow`,
  `VarMethods`, `PositionRiskAttribution` and `PositionRiskScatter` are still `mixed` with
  panel-level disclosure only. They differ from the limit board in that none of them
  renders a per-row verdict column, so the unmarked-OK failure does not arise the same
  way — but the sentence *"which rows are which is in each panel's own marker"* is an
  overclaim until they carry one. Stated here rather than quietly left.
- **The header count still mixes books.** *"0 breached · 3 near · 3 ok · 4 no-data"* spans
  both, and a second breakdown in a 280px header would cost more than it buys. The intro's
  split and the row tags are what a reader resolves it with.
- **The tags make an unflattering reading visible, which is the point.** On the 2026-08-01
  credit book every row with a *risk* verdict is either the multi-asset book's (HHI,
  drawdown) or `NO DATA` (VaR, CVaR, β). The credit book has no risk-metric verdict of its
  own on the page at all. That was true before this change and could not be seen.
- **Two vocabularies to keep current, not one.** `LENS_FOLLOWING_FIELDS` lists the JSONB
  payload columns of `research_recommendations` and must grow when a new one is cited. The
  `unclassified` default and its test are what make the omission loud rather than silent,
  but a list is still a list. A disjointness test stops a name appearing in both, which
  would let the tie-break decide provenance by list order — a decision nobody made.
- **Rejected: a chip beside the status badge.** It marks the element actually making the
  false claim, and it puts five badges down a quarter-width column beside eleven existing
  ones. The verdict is not wrong — VaR 1.7% against a 6.0% limit *is* OK, for the book it
  was measured on — so the correction belongs with the provenance, not the verdict.
- **Rejected: suppressing the lens-less rows under a non-default lens.** It would leave a
  reader on `/mandate?lens=credit` with no VaR, no drawdown and no β at all, and a limit a
  PM cannot see is a limit they cannot manage — the rule the board is built on. Showing
  another book's risk number, labelled, beats showing none.
- **Rejected: giving `portfolio_risk` a lens column.** That is ADR-0194, and it is a
  decision about the record, not about a disclosure.
