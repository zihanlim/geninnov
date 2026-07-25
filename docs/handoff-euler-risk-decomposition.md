# Handoff — wire the Euler risk decomposition to `/risk`

_Written 2026-07-25 for whoever picks this up next. The pure function is **already on `main`**;
what remains is wiring, persistence and render._

Background: [`docs/jarvis-transfer-study-2026-07-25.md`](jarvis-transfer-study-2026-07-25.md) §T1.1.

---

## What already exists (do not rebuild)

| | |
|---|---|
| `backend/services/risk_decomposition.py` | `decompose_risk(signed_weights, returns, confidence=0.95) -> dict \| None`. Pure, no I/O. |
| `tests/backend/test_risk_decomposition.py` | 21 tests. Pin the Euler identity to 1e-9 and every convention below. |

**Read the module docstring before touching this.** It records *why* each convention is what it
is. The tests will stop you breaking the maths. They will **not** stop you breaking the wiring —
that is what §"Acceptance criteria" exists for.

Returned shape (per position): `asset`, `signed_weight`, `standalone_vol`,
`marginal_contribution`, `contribution_to_vol`, `component_var`, `risk_contribution_pct`.
Book level: `portfolio_vol`, `portfolio_var`, `confidence`, `gross_exposure`, `net_exposure`,
`diversification_ratio`, `n_observations`, `lookback_start`, `lookback_end`, `dropped_assets`.

---

## Step 1 — the prerequisite refactor (do this first, separately)

**✅ DONE (iteration 82).** `compute_correlation_matrix` and `candidate_book_correlation` now take
an optional `returns=` frame; `finalise_book_analytics` fetches ONE 252-day frame (book ∪
candidates) and threads it to all three correlation consumers — the two book calls (0.70 and 0.0
threshold) and the candidate call — collapsing three yfinance fetches to one. `moving_average_context`
stays its own fetch (it needs prices, not returns). Behaviour-preserving: verified on live data that
the shared-frame path reproduces the independent-fetch correlation to 0.00e+00 across all 45 book
pairs; `test_correlation_functions_reuse_provided_returns_frame` pins reuse-and-identity.
**Step 2 must pass this same frame to `decompose_risk` (acceptance criterion #4), not re-fetch.**

_Original brief, for context:_ `finalise_book_analytics` reached yfinance **four times per run**
(`moving_average_context`, two `compute_correlation_matrix` calls, `candidate_book_correlation`) —
four independent chances to lose a book to a scraper hiccup. `.corr()` is pairwise-complete, so one
shared frame gives byte-identical correlations.

## Step 2 — wire it

**✅ DONE (iteration 83).** `finalise_book_analytics` calls `decompose_risk` after the
correlation block, signed weights derived from the picks as `compute_book_metrics` does,
reusing the hoisted frame (criterion #4), wrapped in try/except-and-continue. Live book:
portfolio_vol 8.38%, Σ contribution_to_vol = portfolio_vol to 1e-9, SVXY/SHY show negative
(hedge) contributions. `test_finalise_book_analytics_wires_euler_decomposition` pins the
identity and the single-fetch reuse.

_Original:_ Call `decompose_risk` in `finalise_book_analytics`, after `size_positions` has
produced final weights. Signed weights come from the picks the same way `compute_book_metrics`
reads them. Wrap it in the same `try/except`-and-continue as the `correlation_summary` block.

## Step 3 — persist

**✅ DONE (iteration 83).** Migration `038_risk_decomposition.sql` adds the JSONB column (applied
to prod via psycopg2); `_persist_to_supabase` writes `risk_decomposition` alongside `book_metrics`.
The live book's row was back-filled by recompute + PATCH so the data is present ahead of the render.

**One JSONB column, not a new table.** Follow `supabase/migrations/022_book_analytics_surface.sql`
exactly — it is the precedent for every other analytic on this row:

```sql
ALTER TABLE research_recommendations
    ADD COLUMN IF NOT EXISTS risk_decomposition JSONB;

COMMENT ON COLUMN research_recommendations.risk_decomposition IS
    'Written by q1_agent._persist_to_supabase. Source: risk_decomposition.decompose_risk. '
    'Ex-ante covariance VaR — NOT the realised-series VaR in portfolio_risk.var_95.';
```

Next free migration number is **038** — check `supabase/migrations/` before claiming it.
Add to `analytics_row` in `_persist_to_supabase` alongside `book_metrics` / `correlation_pairs`.

## Step 4 — render

**⏸️ DEFERRED / DE-SCOPED (iteration 92, 2026-07-26).** Step 4 assumed the beta column was a flaw to
swap out. The other session's frontend rewrite (`c9042975`) fixed that flaw a cleaner way: the panel
now shows the *consistent* factor-model beta contribution (Σ signed_weight × β_mkt, which does sum to
the book tilt) and **gates the regression book beta** behind `MIN_SESSIONS.beta_abs` (60), so the two
betas are never printed together to be misread. The −0.19-vs-−0.50 question that motivated this whole
handoff is therefore **answered without the Euler render**. Rendering `contribution_to_vol` on top
would add a *second* risk-attribution panel — completeness over legibility, the trade
`docs/design-goals.md` warns against — and can't be verified live while Playwright + WebFetch are both
blocked. So the decomposition **remains a persisted, identity-checked backend asset**
(`research_recommendations.risk_decomposition`); a render is revisited only if a non-duplicative slot
appears *and* live verification is possible. The guidance below is preserved for that future render.

**`frontend/components/risk/PositionRiskAttribution.tsx` should be re-sourced, not replaced.**

Its header says it answers *"which trade do I cut?"* using marginal contribution to book beta
(`signed_weight × β_mkt`) — a column that answers the question loosely and sums to nothing. That
is the part to swap. But the component already contains the right rendering primitive:
`ContribBar` diverges from a centre line, renders negative values leftward, and colours by sign.
That is exactly correct for a signed risk contribution and is **not** to be rebuilt — feed it
`contribution_to_vol` and it works.

Add the book-level line: `portfolio_vol`, `portfolio_var` at its confidence, and
`diversification_ratio`.

---

## Acceptance criteria

The 21 landed tests cover the pure function. **Nothing currently fails if the wiring gets these
wrong**, so add a test for each as you go.

1. **Do not write to `portfolio_risk.var_95`, and never render the two VaRs without distinct
   labels.** Ex-ante covariance VaR and realised-series VaR are different measurements from
   different inputs and disagree routinely. Two contradicting VaRs on one page is a regression
   `PROGRESS.md` already records twice. Distinct `field_id`, distinct `method_id`
   (e.g. `risk.var.euler_exante.v1`), distinct label at render.

2. **Never render `risk_contribution_pct` as a pie or a share-of-whole bar.** It goes negative
   for a genuine hedge — a position whose correlation makes it *reduce* book volatility. That is
   the single most useful thing the panel says, and a share-of-whole chart cannot express it
   (ADR-0060). `ContribBar` already handles this correctly; use it.

3. **`dropped_assets` must reach the reader.** These are names the book *holds* whose price
   history yfinance did not return. Their risk is real and unmeasured. Silently omitting them
   makes the decomposition look complete when it is not — the ADR-0023 failure. Say
   "3 of 10 positions priced" or equivalent on the panel.

4. **Reuse the hoisted returns frame.** If Step 1 landed and Step 2 still calls
   `fetch_pick_returns` again, the refactor bought nothing.

Two more that are cheap to get wrong:

- `decompose_risk` returns **`None`** below 60 overlapping sessions or fewer than two priced
  names. Render `display_status='unavailable'` with the reason — do not substitute zeros.
- Units for `numeric_derivations` are the closed `NumericUnit` Literal at
  `backend/derivations/numeric.py:7`. `usd`, `ratio`, `pct` all already exist; no new unit is
  needed and none should be added.

---

## Doc sync (CLAUDE.md makes this mandatory)

- **A new ADR** — this is a new L4 analytic on the final sized book. **Claim the number at commit
  time by listing `docs/adrs/`, not in advance.** 0078 was claimed twice on 2026-07-25 by two
  concurrent sessions and one had to be renumbered to 0080.
- `ARCHITECTURE.md` — the mermaid block, plus the `## Layers` and `## Supabase Tables` tables.
- `PROGRESS.md` — a dated row.

## Known-blocked, deliberately not in scope

Recorded so they are not rediscovered — reasoning in the study doc:

- **Liquidity-adjusted VaR / horizon bucketing** — no ADV data source, and every bucket collapses
  to `≤1d` on a ~60-name liquid-ETF universe unless the horizons are chosen to make the panel
  look interesting.
- **Monte Carlo VaR** — strictly downstream of this, and nothing consumes the output: no code
  path reads `portfolio_risk.var_95` to gate anything. It also injects a stochastic routine into
  the layer whose product claim is determinism (ADR-0013).
- **Bond math / DV01 / duration** — blocked on an instrument master. `theme_assets` carries
  `(ticker, weight, run_date, asset_class)`; nothing in `supabase/` has a coupon, maturity, face
  or CUSIP, and neither yfinance nor FRED supplies them. An ETF has no maturity.
