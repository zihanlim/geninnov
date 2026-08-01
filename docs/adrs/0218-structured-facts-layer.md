# ADR-0218 — A structured_facts table for the numbers the system has to defend

**Date:** 2026-08-01
**Status:** Accepted
**Relates to:** [0098](0098-three-states-not-two.md), [0010](0010-citation-footnotes-everywhere.md), [0019](0019-citation-value-reconciliation.md), [0217](0217-computable-macro-analytics.md), [0129](0129-promotion-is-manual-the-tracker-proposes.md), [0125](0125-a-ticker-may-appear-under-several-themes.md), design-goals.md §1, §3, §7

## Context

The L5 reasoning agent cites numbers from training data when it should cite numbers from a stored layer. The Q2 test rewards candidates whose systems cite numbers they can defend, with provenance per claim.

The current schema has two close-but-wrong homes for the kind of fact the recap cited:

- **`macro_indicators`** is FRED-shaped: `(series_id, series_name, value, unit, fetch_date)`. It is automated (a fetcher writes it nightly), it expects a single source per series, and the unit is constrained to the FRED vocabulary (`pct`, `index`, `USD`, `pts`). A "MSFT capex FY26" fact does not fit.
- **`theme_signals`** is auto-derived: it is computed from attention, not curated. The tracker proposes; a human maps instruments; a derived score writes. There is no place to land a hand-authored "MSFT capex = $80bn" fact.

The Q2 fact set is small and hand-curated — it is the same discipline as ADR-0129's hand-mapped AI Capex theme (`supabase/migrations/050_ai_capex_theme.sql`), but for cross-entity numbers rather than for tickers.

A third path would be to put these in a free-form JSONB on `regime_classifications` (the same pattern as `computable_macro`, ADR-0217). Rejected: the same JSONB column would carry both derived readings (auto, well-typed) and hand-curated facts (manual, with `source` and `confidence`). The two have different update cadences, different provenance shapes, and different audit needs. Mixing them in one column would lose the discipline each layer enforces.

## Decision

**A new `structured_facts` table** for hand-curated facts the L5 cites, with provenance per claim.

```sql
CREATE TABLE structured_facts (
    id         BIGSERIAL PRIMARY KEY,
    entity     TEXT NOT NULL,         -- 'MSFT' | 'industry:HBM' | 'macro:erp' | 'study:MIT_2025'
    metric     TEXT NOT NULL,         -- 'capex_fy26_bn' | 'trailing_eps_ttm' | 'hbm_market_share_pct'
    value      NUMERIC NOT NULL,      -- the number, in the declared unit
    unit       TEXT NOT NULL,         -- 'USD_bn' | 'years' | 'pct' | 'USD_per_million_tokens' | 'boolean'
    as_of      DATE NOT NULL,         -- the date the fact is true as of
    source     TEXT NOT NULL,         -- 'MSFT 10-Q Q1 FY26' | 'TrendForce Q2 2026'
    source_url TEXT,                  -- optional canonical link
    confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
    category   TEXT NOT NULL,         -- 'ai_capex' | 'china_ai' | 'macro' | 'valuation'
    notes      TEXT,                  -- one line of context
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity, metric, as_of)
);
```

**Five properties that decide the design:**

1. **(entity, metric, as_of) is the unique key.** A quarterly update writes a new row rather than overwriting history; the L5 cites the most recent, but a reader auditing the table can see the trajectory. A change to as_of is a different fact, not an edit of the same one.
2. **`value` is NUMERIC, never TEXT.** A fact that cannot be expressed as a number (e.g. a date as a yyyymmdd integer) does belong here, but a fact that needs prose does not. Prose facts are the L5's job; the table is for *citable numbers*.
3. **`source` is required, `source_url` is optional.** A row without a source defeats the LLM-citation discipline the table exists to enforce. The L5 cites the source name in its thesis; the URL is for a reader who wants to verify.
4. **`confidence` is row-level, declared as `high | medium | low`.** A "low" fact still travels; the L5 cites the confidence alongside the value. Per-row confidence is the discipline that keeps the L5 from citing a single-point estimate with the same weight as an audited 10-Q figure.
5. **Category is open.** New categories land by writing rows, not by altering the table. The seed has four (`ai_capex`, `china_ai`, `macro`, `valuation`); future tests can add without a migration.

**A read API** in `backend/services/structured_facts.py`:

- `get_fact(supabase, entity, metric, as_of=None)` — one row, the most recent by default.
- `get_facts_by_category(supabase, category, as_of=None, limit=200)` — the L5's "everything we know about ai_capex" call.
- `get_facts_for_entities(supabase, entities, metrics=None, as_of=None)` — bulk read for thesis construction; the agent says "give me capex_fy26_bn for MSFT/META/GOOGL/AMZN/ORCL" in one call.
- `get_fact_trajectory(supabase, entity, metric, limit=20)` — all rows for a (entity, metric) pair, most recent first; used by the `/facts` page to show the trajectory of one quantity.
- `upsert_fact(supabase, fact)` — one insert/update; the loader uses this, the L5 does not.
- `cite(entity, metric)` and `parse_cite(citation)` — the canonical `[structured_facts:<entity>:<metric>]` cite string and its parser. Kept as functions so the L5 prompt and the citation guardrail cannot drift.

**A loader script** in `backend/data/structured_facts_loader.py`:

- Reads `data/structured_facts_seed.json` (50 rows for the Q2 question).
- Validates each row's required fields and the `confidence` enum; **continues past a bad row to surface ALL errors in one run** (rather than failing on the first).
- Upserts via the service so the loader and the L5 cite path stay in lockstep.
- Idempotent on re-run: the unique key is `(entity, metric, as_of)`, so a re-load updates in place.

**A 50-row seed** at `data/structured_facts_seed.json`, hand-curated from the Q2 recap. Four categories, ~12-15 rows each. The values are the recap's reported numbers; the `source` column is the recap's cited source; the `as_of` is the date the source was published.

**Citation format**: `[structured_facts:<entity>:<metric>]` — same shape as `[regime_classifications:<colname>]`, parsed by `parse_cite()`. The L5 prompt lists this format; the citation guardrail (Workstream D) verifies the (entity, metric) pair exists in the table.

**Failure mode**: a fact the system does not have is `None`, not zero. The L5 cites the absence as an absence. This is the same discipline as `compute_erp` (ADR-0217), `debasement_pressure` (m052), and `fed_posture` (m053).

## Consequences

- **Positive**: the L5 cites numbers the system stores, with a single source-of-truth row per (entity, metric, as_of) tuple. The discipline of "row without source does not enter" is enforced at the column level (`source TEXT NOT NULL`).
- **Positive**: the runner in `computable_macro_runner.py` reads from this table when the trailing EPS is needed, and it already silently handles a missing table (ADR-0217) — so Workstream B lands as a pure addition with no Workstream A change required.
- **Positive**: the loader's row-by-row validation continues past errors, so a 50-row seed with one typo surfaces all 50 errors in one run rather than 50 separate runs. The validate-then-upsert split also means a `--dry-run` mode can verify the seed without writing.
- **Positive**: the L5 can pull a thesis-worth of facts in a single `get_facts_by_category('ai_capex')` call rather than 25 separate `get_fact()` calls. Cost is one Supabase read, not 25.
- **Negative**: the table is hand-curated, so it can drift. The `confidence` enum is the first line of defense (a "low" fact has to be cited with its confidence), but the discipline is also human. The trajectory view in `/facts` makes drift visible.
- **Negative**: a 50-row table is the floor, not the ceiling. As more facts land, the seed file grows. The loader is a one-shot, not an ETL — for sustained curation, a small admin UI is the next step (out of scope for this plan).
- **Negative**: the `entity` namespace is open (`'industry:HBM'`, `'study:MIT_2025'`), which is flexible but easy to typo. A reader auditing the table must grep `entity` for typos; a future schema could enforce an enum, at the cost of an ALTER per new entity.

## Refused alternatives

- **JSONB column on `regime_classifications`** (alongside `computable_macro`): rejected. Mixing auto-derived readings (regime, debasement, fed posture) with hand-curated facts in one column loses each layer's discipline. Different update cadence, different provenance shape.
- **A free-form TEXT column with prose citations**: rejected. A TEXT field cannot be parsed by the citation guardrail; the whole point of the table is that the L5 cites a structured token.
- **A `value TEXT` column to support dates and strings**: rejected. NUMERIC is the constraint that makes the table mean what it says; a "value" stored as text is a fact the system cannot sum, threshold, or otherwise compute on. A yyyymmdd-as-integer is the right encoding for a date-as-fact.
- **Auto-update from an external feed**: rejected. The Q2 test rewards a system whose facts are *defended* — an auto-update defeats the discipline. A future milestone can layer a feed on top, but the table starts hand-curated.
