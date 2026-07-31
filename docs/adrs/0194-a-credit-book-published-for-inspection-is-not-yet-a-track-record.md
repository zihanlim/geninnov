# ADR-0194: A credit book published for inspection is not yet a track record

**Status:** Accepted
**Date:** 2026-07-31
**Related:** [ADR-0015](0015-lens-mode-asset-class.md), [ADR-0190](0190-credit-rates-exposures-shadow-on-arrival.md), [ADR-0193](0193-a-beta-must-clear-its-own-standard-error-before-it-can-stress-the-book.md), [ADR-0090](0090-a-published-pick-must-be-falsifiable.md), [ADR-0093](0093-a-published-book-that-changes-must-say-so.md), [ADR-0150](0150-a-recommendation-has-no-pnl.md)

## Context

An external PM critique's one surviving claim, after everything else was measured and
closed, was that the tradeable universe cannot express a credit book. ADR-0190/0193 built
the missing measurement: `credit_rates_exposures` now carries a per-asset credit beta
**with its own standard error**, gated on `|beta/se| >= 2` before anything is allowed to call
it believable. That gate produced a number, not an opinion:

| | tickers in universe | clears `|beta/se| >= 2` on either leg |
|---|---:|---:|
| **CREDIT lens** (`LENS_TICKER_FALLBACK["credit"]`, 2026-07-30 rows) | 12 | **9** — LQD t=8.25, SHY 7.28, JNK 3.84, IEF 3.70, ANGL 3.61, AGG 3.15, HYG 3.15, EMB 2.55, BIL 2.06 |
| **Published multi-asset book** (2026-07-30: BABA, F, GEV, GLD, NOC, PDD, SMH, UNG, UNH) | 9 held | **1** — GEV, quality leg only (t=+2.33; its own IG leg does not clear, t=-1.31) |

The engine can produce a book with real, measurable credit risk. The book that actually
publishes every night does not, because it runs under the multi-asset lens and the credit
names it could hold (LQD, HYG, JNK, ANGL, EMB, AGG, IEF, SHY, BIL) never win a slot against
equity/commodity candidates competing on the same EdgeScore. The fix ADR-0015 designed for
exactly this — a `lens` parameter that filters the candidate pool and re-frames the LLM
prompt — has existed since 2026-07-21 and has never been run in production. ADR-0015 §"How
to invoke a non-default lens" already anticipated the schema gap: *"Multiple lens runs can
coexist on the same date — distinguished by the lens field in `raw_output` or **a future
`lens` column**."* This ADR is that column landing.

**The blocker.** `research_recommendations` had `UNIQUE (run_date)`
(`q1_recommendations_run_date_key`) with `lens` as a plain nullable column (migration 022) —
one row, 2026-07-22, predates lens plumbing entirely and was still NULL. `book_holdings` had
`UNIQUE (run_date, asset)` and no `lens` column at all. Calling `run_q1_agent(lens="credit")`
for the same `run_date` as the primary run would either violate the constraint outright or
silently upsert over the published multi-asset book — the exact failure mode ADR-0093 built
`book_revisions` to catch for a *single* book, not for two different mandates colliding on
one date.

## Decision

**Let a CREDIT-lens book coexist with the MULTI-ASSET book on the same `run_date`, in its own
tables keyed by `(run_date, lens[, asset])` — and draw a hard, explicit line: the credit book
is published for inspection, and does not enter the forward track record.**

### 1. Schema (migration 062)

- `book_holdings`: `lens TEXT NOT NULL DEFAULT 'multi_asset'`, backfilling every existing row
  automatically. Drops `book_holdings_run_date_asset_key`; adds
  `UNIQUE (run_date, lens, asset)`.
- `research_recommendations`: the existing nullable `lens` column becomes `NOT NULL DEFAULT
  'multi_asset'` (the one 2026-07-22 NULL row backfilled first, or the `NOT NULL` ALTER fails
  and leaves the migration half-applied). Drops `q1_recommendations_run_date_key`; adds
  `UNIQUE (run_date, lens)`.
- Applied live and verified via `pg_constraint`: old constraints gone, new ones present, zero
  NULL `lens` rows remaining.

### 2. The four track-record tables get NO lens column and NO schema change

`pick_outcomes`, `book_signal`, `book_holdings_performance`, `book_revisions` are untouched by
migration 062 and must **stay multi-asset-only**:

- **`pick_outcomes`** (ADR-0090) — the falsifiable forward record. Its entire premise is that
  the denominator is fixed at publication, before any price exists for it. A second book
  writing picks for the same date would let either book's misses hide behind the other's
  count, and there is no sense in which "21 trading days forward" means the same thing for a
  book that coexists with, rather than replaces, another book on the same day.
- **`book_signal`** (ADR-0148) — `UNIQUE (run_date, asset, direction)`, no lens column. Two
  lenses holding the same ticker on the same side would collide on this key or silently
  overwrite each other's signal row.
- **`book_holdings_performance`** (ADR-0150) — the multi-asset held book's turnover/cost/NAV
  series. A credit book has no prior credit-lens holding to rebalance from and no cost budget
  of its own; giving it a P&L series would be inventing a return stream nobody sized for.
- **`book_revisions`** (ADR-0093) — diffs "the published book" against its own history. With
  two books on one date, "the published book" stops meaning one thing; diffing across lenses
  would report a lens SWITCH as a revision of figures that were never the same book.

**Why not schema-gate instead of application-gate?** These four could each have taken a
`lens` column exactly like the two tables above did. Rejected: it would answer the wrong
question. The point is not "which lens does this row belong to" but "this table must not
even ADMIT the question" — a `lens` column invites a future write path to reason "well, this
row has a lens, so writing a credit one must be fine", which is precisely the leak this ADR
closes. The boundary is enforced in code (`q1_agent._persist_to_supabase`,
`scripts/daily_refresh.py`), checked in five places once migration 062 made a second row per
`run_date` possible:

1. `q1_agent._persist_to_supabase` gates `_record_book_revisions` (→ `book_revisions`) and
   `_persist_signal` (→ `book_signal`) on `state["lens"] == "multi_asset"` — both are called
   from the ONE persist path both lenses run through, so this is the load-bearing gate, not a
   call-site convention.
2. `scripts/daily_refresh.py::record_published_claims` (→ `pick_outcomes`) checks
   `agent_result["lens"]` and refuses anything but `multi_asset`, belt-and-suspenders on top
   of the credit call site never invoking it at all.
3. `scripts/daily_refresh.py::extend_held_book` (→ `book_holdings_performance`, and the
   MULTI-ASSET `book_holdings` rows specifically) scopes every one of its four
   `book_holdings`/`research_recommendations` queries to `lens='multi_asset'` explicitly.
   Before this, `.eq("run_date", ...)` alone was safe because only one row per date could
   exist; migration 062 made that assumption false, and an unscoped read or delete here could
   silently borrow the credit book's holdings as "yesterday's" multi-asset baseline, or wipe
   its rows outright.
4. `q1_agent._fetch_previous_held_weights` takes the run's own `lens` and filters
   `book_holdings` by it, so the turnover-cap baseline (ADR-0173) is never borrowed across
   mandates.
5. Three offline scripts that read `research_recommendations` or write `book_holdings` without
   ever expecting two rows per date — `resolve_outcomes.py` (which independently re-derives
   its own claim set from `research_recommendations.picks`, so an unscoped read would resolve
   and upsert `pick_outcomes` rows for credit-lens picks that were never committed as pending
   in the first place), `rebuild_held_book.py`, and `check_data_integrity.py` — are all scoped
   to `lens='multi_asset'` too. None of these three is named in the task that opened this ADR;
   all three were found by tracing every existing reader of the two tables migration 062
   changed, because "the credit run must never damage the primary book" is a property of the
   whole codebase, not just the code path that was written this session.

### 3. `book_holdings` gets a write from EVERY lens, on purpose

Unlike the four gated tables, `book_holdings` is not multi-asset-only — the schema explicitly
admits a `lens` dimension. `q1_agent._persist_book_holdings` (new) writes a snapshot —
`signed_weight == target_weight`, no turnover-cost tracking, no NAV — for whichever lens just
ran, upserted on `(run_date, lens, asset)`. For `multi_asset`,
`scripts/daily_refresh.py::extend_held_book` runs afterwards in the same daily run and
overwrites these rows with the real held-book accounting (cost-aware rebalancing, NAV
compounding) — the values happen to match today, since the held book currently fully
rebalances to target every run (`held_book.py`'s documented behaviour), but the two writes are
allowed to diverge once a turnover budget exists. **For every other lens, this snapshot is the
only thing `book_holdings` ever gets** — a credit book published for inspection has weights
worth showing on `/book`, but no carried-forward position and no P&L series, because starting
one is exactly the track-record decision this ADR defers.

### 4. `scripts/daily_refresh.py::run_credit_lens_book`

Runs L5 a second time under `lens="credit"`, as its own `pipeline_runs` stage (`L5b`),
mirroring the L2/L2b phase shape. Deliberately minimal — no `record_published_claims`, no
`reconcile_positions_to_published_book` / risk-and-return recompute (those describe the
PUBLISHED `portfolio_positions` book, which stays multi-asset), no `extend_held_book`. Wrapped
so **any** exception — a MiniMax 429 above all, since L5b shares the day's LLM quota with the
primary run and with `/ask` — is logged, recorded as a `pipeline_runs` failure, and otherwise
ignored: the primary multi-asset book is already fully persisted by the time this runs and
must be untouched by a failure here. Gated by `RUN_CREDIT_LENS` (default enabled) so the
second LLM call can be switched off without a code change if quota gets tight.

## Consequences

- **Both books now exist for 2026-07-30 and are independently readable** —
  `research_recommendations` and `book_holdings` each carry one row/set per lens, verified by
  SQL after the live run (not merely by the migration file existing).
- **The multi-asset book is provably unaffected.** Its `research_recommendations` row and
  `book_holdings` rows are byte-identical to the pre-credit-run snapshot
  (`.superpowers/sdd/2026-07-31-credit-rates-exposures/booksnap/`), including on an
  OVERLAPPING ticker held at a different weight by each lens — the sharpest version of the
  coexistence claim, and the one the test suite asserts directly rather than by absence of an
  error.
- **This is a debt, taken on deliberately, not an oversight.** The credit book has no forward
  track record. It cannot yet be asked "was this book right?" the way `/method`'s
  ADR-0090 panel asks it of the multi-asset book. Starting one means a `pick_outcomes`-shaped
  table (or a `lens` column added to the existing one, with all four of ADR-0090's guarantees
  re-derived for a second concurrent denominator) — a real design question, not a follow-on
  line item, and explicitly NOT decided here.
- **This doubles the nightly L5 LLM spend.** Both runs draw on the same MiniMax quota `/ask`
  shares (see CLAUDE.md); `RUN_CREDIT_LENS=0` is the release valve if that becomes a problem
  before a per-lens budget is designed.
- **`held_book.py`'s "fully rebalances to target" property is now load-bearing in two places**
  (ADR-0150 documented it for one). If a turnover budget for the multi-asset book is ever
  implemented, `_persist_book_holdings`'s target-weight snapshot and `extend_held_book`'s
  actual-held write will diverge for `multi_asset` between the moment L5 persists and the
  moment `extend_held_book` runs later in the same daily run — a narrow, same-run-only window
  during which the row is the target rather than the rebalanced position. Not a live gap
  today; worth re-checking the day that budget exists.

## Alternatives considered

- **A `lens` column on all six tables, not just two.** Rejected — see "why not schema-gate
  instead of application-gate" above. Admitting the dimension is exactly the leak this ADR
  closes for the four track-record tables.
- **A separate `credit_pick_outcomes` table, started now, alongside this change.** Rejected
  for scope: the measurement this ADR responds to is "can the engine produce a credit book at
  all", not "does the credit book perform" — conflating the two would mean this change ships
  a track record for a book that has run exactly once. ADR-0090's own falsifiability guarantee
  depends on every published pick getting a row FROM THE START; retrofitting one after the
  fact for a book with no history would violate the guarantee it exists to provide.
- **Replace the multi-asset book with the credit book, since the credit book has the better
  measured betas.** Rejected — the mandate comparison is the point (ADR-0015's "demoware /
  interview context" reason for lens mode existing at all), and Andromeda Capital's stated
  mandate is credit-and-rates, not a reason to stop demonstrating the platform's multi-asset
  capability. Publishing both side by side is the deliverable; picking a winner is not this
  task's decision to make.
- **Gate `book_holdings` to multi-asset only as well, and give the credit lens no persisted
  weights at all.** Rejected — a credit book that cannot be inspected on `/book` is not
  "published", it is computed and discarded. The whole point of running it is to show the
  weights a credible credit book would hold; `book_holdings` is where a reader looks for that,
  independent of whether it also earns a P&L.

## Links

- Migration: `supabase/migrations/062_book_per_lens.sql`
- Implementation: `backend/services/q1_agent.py` (`_persist_book_holdings`,
  `_record_book_revisions`, `_persist_signal`, `_fetch_previous_held_weights`),
  `scripts/daily_refresh.py` (`run_credit_lens_book`, `record_published_claims`,
  `extend_held_book`), `scripts/resolve_outcomes.py`, `scripts/rebuild_held_book.py`,
  `scripts/check_data_integrity.py`
- Tests: `tests/backend/test_book_per_lens.py`
- Prior art this ADR completes: [ADR-0015](0015-lens-mode-asset-class.md)'s "How to invoke a
  non-default lens" section, written 2026-07-21, naming the future `lens` column this
  migration adds
