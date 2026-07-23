# ADR-0030 — Unify the L5 candidate pool with L1 (screen_candidates consumes rank_trade_candidates)

- Status: accepted
- Date: 2026-07-23
- Tags: architecture, trade-generation, deduplication
- Related: [ADR-0029](0029-two-sided-book-decouple-direction-revive-momentum.md) (two-sided book), [ADR-0014](0014-candidate-set-hard-filter.md) (candidate hard filter)

## Context

The system had **two independent implementations of the long/short direction
rule**, and they did not share code:

- **L1 (`rank_trade_candidates`, `scripts/daily_refresh.py`)** produced the
  candidate pool for the `trade_candidates` and `portfolio_positions` tables
  (rendered on `/trades`, `/portfolio`). ADR-0029 added the two-sided backfill
  here.
- **L5 (`screen_candidates`, `backend/services/q1_agent.py`)** produced the pool
  for the LLM book in `research_recommendations` (rendered on `/book`,
  `/research` — the actual Q1 deliverable).

`run_q1_agent` *received* the L1 pool (`candidates=positioned`) and stored it in
`state["candidates"]`, but `screen_candidates` then **overwrote it**, rebuilding
the pool from `theme_scores` with its *own* `HypeScore >= threshold AND
sign(TradeScore)` logic and **no backfill**. Consequences:

1. **ADR-0029's two-sided fix never reached the L5 book.** It fixed the L1 tables
   only. A two-sided L5 book happened solely by luck — when a theme drifted above
   the hype gate on its own (observed: US Election at 49.9 one run, 52.0 the next,
   flipping the book from all-short to two-sided for a reason unrelated to the
   fix).
2. **Two asset-mapping sources.** L1 expanded themes via `load_theme_assets_map`
   (the DB `theme_assets` table); L5 used a hardcoded `_theme_default_assets`
   map. The L5 book could trade a different universe than the L1 book for the
   same themes.
3. **A silent divergence risk.** Any future change to the direction rule had to be
   made in two places or the two books would disagree.

## Decision

**`screen_candidates` now filters the L1 pool it is handed, instead of rebuilding
one.** It reads `state["candidates"]` (the L1 pool from `rank_trade_candidates`,
already hype-gated, directioned by `sign(TradeScore)`, and two-sided via the
ADR-0029 backfill) and applies only the **L5-specific** filters L1 doesn't:

1. **Lens filter** — keep only in-lens assets when `lens != multi_asset`.
2. **Factor R² ≥ 0.10** for equities (ETFs exempt — stable liquid histories).
3. **Dedupe** `(asset, direction)`, keep the highest-HypeScore entry.
4. **Cap at 30** for the LLM context window.

The hype gate, the direction rule, and the two-sided guarantee are **inherited**
from L1, not re-derived. `theme_name` (which L1 leaves blank on the flattened
candidate) is backfilled from `theme_scores`. The `screening_funnel` now opens
with an "L1 ranked candidates" stage that names the upstream gate/direction/
backfill, then shows lens → R² → dedupe → cap attrition.

## Consequences

### Positive
- **One direction rule, one place.** The L5 book inherits ADR-0029's
  two-sidedness for real — a backfilled sub-threshold long now survives into the
  LLM pool (regression-tested). The luck dependency is gone.
- **One asset-mapping source.** The L5 universe is the DB `theme_assets` mapping
  L1 already uses, so `/book` and `/trades` reason over the same tickers.
- **Less code, less drift.** The theme→asset expansion and the hype/sign gate are
  deleted from L5; there is no second copy to keep in sync.

### Negative / caveat (honest)
- **The L5 universe is now whatever L1/`theme_assets` contains.** A curated ETF in
  the old hardcoded `_theme_default_assets` that is *not* in `theme_assets` will
  no longer appear in the L5 book. This is intentional — the DB mapping is now
  authoritative — but it means `theme_assets` coverage directly governs the L5
  book's breadth. (L1 already filters to classified tickers via `is_classified`,
  so the pool remains safe for the hard-indexed `book_metrics`.)
- **The deterministic fallback ranks the SAME screened L1 pool.** It no longer
  rebuilds a divergent universe from `theme_scores` via `_theme_default_assets`
  (adversarial review caught this): that path had **no ADR-0029 backfill** and
  could fabricate a *one-sided* book on an LLM failure, quietly defeating the
  unification. An empty screened pool now yields an honest **empty** book, not
  invented picks. `_theme_default_assets` remains in the module but is no longer
  used by the production path — only by test scaffolding that simulates L1's
  asset expansion.

## Alternatives considered

- **Add the ADR-0029 backfill to `screen_candidates` too (keep both paths).**
  Fixes the symptom but preserves two copies of the direction rule and two asset
  sources — the divergence recurs on the next change. Rejected in favour of
  unification.
- **Have L5 skip screening entirely and trade the L1 pool as-is.** Drops the
  L5-specific lens and R² filters, which are genuine quality gates the L1 book
  doesn't need. Rejected — L5 still needs those, just not a second direction rule.

## Links
- `backend/services/q1_agent.py` (`screen_candidates`, `run_q1_agent`),
  `scripts/daily_refresh.py` (`rank_trade_candidates`, `allocate_and_persist_portfolio`),
  ADR-0029, ADR-0014, ADR-0024.
