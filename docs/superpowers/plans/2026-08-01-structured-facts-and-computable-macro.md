# Structured Facts + Computable Macro Implementation Plan

> **Context:** The Q2 test (Aug 3, 6pm SGT) is "systematic theme detection framework + prototype." The prototype is strong on detection (L1 narratives, L2 attention-price link) but the LLM cites *training-data* numbers when it should cite *system-stored* numbers. This plan closes the gap in three ways: (a) computable-from-existing-data analytics, (b) a `structured_facts` table for hand-curated fundamentals, (c) CME FedWatch for the one missing macro feed. End state: the L5 thesis cites numbers the *system* can defend, with provenance per claim, and the `/ask` agent can answer "what does the system say about AI capex" without making anything up.

**Architecture summary:** A new `structured_facts` table (entity, metric, value, unit, as_of, source, source_url, confidence) sits beside the macro tables. Three new service modules compute the analytics that *can* be derived from existing data (JPM-style ERP, equity-bond correlation flip, NDX seasonality). A small `fedwatch_fetcher` adds FOMC meeting probabilities. The L5 reasoning agent gains a tool that reads `structured_facts` and the new analytics, and the citation guardrail extends to those sources. The `/ask` console surfaces the new layer in the same shape it surfaces `theme_signals` and `macro_indicators`. Every new number has provenance, every claim is cite-checked, every absence is "unknown, not zero".

**Tech Stack:** Python 3.x, pandas, numpy, supabase-py, pytest, Next.js 14 + TypeScript. No new dependencies. Migration number 064. ADR numbers 0213-0217 (verify at write time).

---

## Strategic context (read this first)

The Q2 test is judging *systematic theme detection* — the discipline of separating **detection from verification**. The current system detects well (L1/L2) and reasons about verification in natural language using the LLM's training data. The test is won or lost on the second half: can the system **cite numbers it didn't generate**? A candidate who says "I detect themes via attention, then verify against a structured fact table, and refuse to claim a relationship I can't measure" demonstrates the discipline of a real quant shop. This plan is that demonstration.

**What this plan is NOT**: a Bloomberg competitor. We are not building earnings transcripts, segment data, or a real-time fundamental feed. The `structured_facts` table is a 50-row hand-curated layer for the specific Q2 question (AI capex / China AI / macro). It is honest about being a snapshot, not a feed. The CME FedWatch is the only true external feed because it is the only one that closes a *system* gap rather than a *coverage* gap.

---

## Time budget

| Slot | Hours | Use |
|---|---:|---|
| Aug 1 (Fri) 09:00 - 14:00 SGT | 5 | A1-A3 (computable analytics) + ADR-0213 |
| Aug 1 (Fri) 14:00 - 22:00 SGT | 8 | B (structured_facts schema + load) + ADR-0214 |
| Aug 2 (Sat) 09:00 - 14:00 SGT | 5 | C (FedWatch) + D (L5 integration) |
| Aug 2 (Sat) 14:00 - 22:00 SGT | 8 | D cont. + E (/ask + UI) |
| Aug 3 (Sun) 09:00 - 16:00 SGT | 7 | F (tests) + G (Q2 prep) + buffer |
| Aug 3 16:00 - 18:00 SGT | 2 | Submit, no code |
| **Total** | **35** | |

40 hours of work time across 2.5 days. Slack is ~5h; if any workstream overruns by >2h, scope trim in section "Trim ladder" below.

---

## Workstream A — Computable-from-existing-data analytics

**Goal:** Add three new metrics that the existing macro + price data already supports. No new feeds, no new tables, pure derivation. These are the cheapest possible wins because they reuse `macro_daily_history` and the price history `factor_fetcher` already loads.

**Files:**
- Create: `backend/services/equity_risk_premium.py`
- Create: `backend/services/equity_bond_correlation.py`
- Create: `backend/services/seasonality_analytics.py`
- Create: `tests/backend/test_equity_risk_premium.py`
- Create: `tests/backend/test_equity_bond_correlation.py`
- Create: `tests/backend/test_seasonality_analytics.py`
- Create: `docs/adrs/0213-computable-macro-analytics.md`

**Interfaces:**

```python
# equity_risk_premium.py
def compute_erp(
    spx_history: pd.DataFrame,   # SPX daily close + earnings_yield column
    ust10_history: pd.Series,    # DGS10 from macro_daily_history
    *, trailing_eps: float | None = None,  # hand-curated; None = "unknown"
) -> dict[str, Any]:
    """JPM-style ERP = (1/spx_pe) - ust10_yield.

    Returns {"erp_pct": float, "spx_pe": float, "ust10_pct": float,
             "as_of": date, "trailing_eps_source": str | None}
    Status follows ADR-0098: known / unknown / not_applicable.
    """
```

```python
# equity_bond_correlation.py
def compute_equity_bond_corr(
    spx_returns: pd.Series,
    ust10_changes_bp: pd.Series,
    *, lookback_days: int = 60,
) -> dict[str, Any]:
    """Rolling 60d correlation. Returns {"corr_60d": float,
    "ust10_pct": float, "threshold_crossed": bool,
    "socgen_flip_active": bool, "as_of": date}.
    socgen_flip_active = corr < 0 AND ust10 > 4.5 (SocGen threshold).
    """
```

```python
# seasonality_analytics.py
def compute_ndx_seasonality(
    ndx_monthly_returns: pd.DataFrame,  # NDX monthly log returns, 1990+
    *, current_month: int,
) -> dict[str, Any]:
    """Returns per-month historical stats:
    {"month": int, "mean_pct": float, "median_pct": float,
     "win_rate_pct": float, "n_years": int, "worst_drawdown_pct": float}.
    Plus midterm_year subset:
    {"midterm_aug_nov_median_pct": float, "n_midterm_years": int,
     "peak_to_trough_avg_pct": float, "post_trough_recovery_avg_pct": float}.
    """
```

**Implementation notes:**
- `spx_history` is read from `macro_daily_history` series_id='^SPX'. EPS for the P/E ratio is read from a small `eps_quarterly` table (one row per quarter, manually maintained — see Workstream B for the pattern).
- `ndx_monthly_returns` is computed once from `^NDX` closes in `macro_daily_history`, then cached as a parquet under `backend/data/cache/seasonality.parquet` (gitignored). Cache invalidates on first day of quarter.
- The "SocGen stock-bond correlation flip" is just `corr_60d < 0 AND ust10 > 4.5`. We persist the boolean; the L5 thesis cites both inputs.
- Midterm-year stats use the canonical set: 1974, 1978, 1982, ..., 2022 (every 4 years since 1974). Hard-code the list, don't auto-derive — the universe is small and well-defined.
- All three functions return `None` for missing inputs (per ADR-0098). No zeros.
- The three services are wired into `daily_refresh.py` after L3, recording `pipeline_runs` rows L3a, L3b, L3c. Status `measured` / `insufficient_history` / `not_applicable`. Persist to a new JSONB column on `regime_classifications` named `computable_macro` (avoids new table; follows ADR-0194's "no new tables" precedent for derived data).

**Behaviours that must NOT change:**
- The existing `regime_classifications` schema, the existing `regime_classifier.classify()` signature, and the existing daily refresh order.
- The persistence format for `cycle`, `sentiment`, `debasement_pressure`, `fed_posture` — these are unchanged.

**Acceptance criteria (gate before Workstream B):**
- [ ] `compute_erp` returns a sensible value on the live data (the 2.2% in the Q2 recap is the right ballpark; ±50bp tolerance is fine for a hand-curated EPS)
- [ ] `compute_equity_bond_corr` reproduces the rolling correlation on a 5-year synthetic fixture to 1e-10
- [ ] `compute_ndx_seasonality` reproduces Aug/Sep NDX averages on a 1990-2025 fixture to 1e-9
- [ ] The new JSONB column on `regime_classifications` populates after a daily refresh run
- [ ] All 3 new test files pass
- [ ] ADR-0213 documents the three metrics and their status semantics

---

## Workstream B — `structured_facts` table + initial load

**Goal:** A small, hand-curated, dated fact table that the L5 agent cites. Designed to look like `macro_indicators` (point-in-time per series) but flexible enough to hold fundamentals, supply-chain data, and external research findings. The schema is generic on purpose — when the next test asks "tell me about X", the table is already shaped to take it.

**Files:**
- Create: `supabase/migrations/064_structured_facts.sql`
- Create: `backend/services/structured_facts.py`
- Create: `backend/data/structured_facts_loader.py` (CSV/JSON → DB writer)
- Create: `data/structured_facts_seed.json` (initial 50 rows from the Q2 recap)
- Create: `tests/backend/test_structured_facts.py`
- Create: `docs/adrs/0214-structured-facts-layer.md`

**Schema (migration 064):**

```sql
-- 064_structured_facts.sql
--
-- Hand-curated facts the L5 reasoning agent cites, with provenance.
-- Per ADR-0214. Distinct from macro_indicators (which is FRED-shaped)
-- and from theme_signals (which is auto-derived). This table is HUMAN-AUTHORED
-- and is honest about it: source is required, as_of is required, confidence
-- is required. Zeros are forbidden by CHECK; absence is "unknown".
--
-- The entity/metric pair is the lookup key. (entity, metric, as_of) is unique
-- so a quarterly update writes a new row rather than overwriting history —
-- the L5 cites the most recent row, but a reader can see the trajectory.
--
-- RLS: public read (same as macro_indicators). Writes only via service_role.

BEGIN;

CREATE TABLE structured_facts (
    id              BIGSERIAL PRIMARY KEY,
    entity          TEXT NOT NULL,            -- 'MSFT', 'SK Hynix', 'industry:HBM', 'macro:erp'
    metric          TEXT NOT NULL,            -- 'capex_2026_bn', 'hbm_market_share_pct', 'equity_risk_premium'
    value           NUMERIC NOT NULL,         -- numeric, never text
    unit            TEXT NOT NULL,            -- 'USD_bn', 'years', 'pct', 'USD_per_million_tokens'
    as_of           DATE NOT NULL,            -- the date the fact is true as of
    source          TEXT NOT NULL,            -- 'MSFT 10-Q 2026Q1', 'TrendForce Q2 2026', 'JPM Equity Strategy 2026-07-15'
    source_url      TEXT,                     -- optional canonical link
    confidence      TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
    category        TEXT NOT NULL,            -- 'ai_capex', 'china_ai', 'macro', 'valuation'
    notes           TEXT,                     -- one line of context (e.g. "FY2026 guidance midpoint")
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity, metric, as_of)
);

CREATE INDEX idx_structured_facts_lookup
    ON structured_facts (entity, metric, as_of DESC);
CREATE INDEX idx_structured_facts_category
    ON structured_facts (category, as_of DESC);

ALTER TABLE structured_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON structured_facts
    FOR SELECT USING (true);

COMMIT;
```

**Initial load — 50 rows from the Q2 recap.** Group by category:

```json
// data/structured_facts_seed.json (illustrative subset, full set has 50)
[
  {"entity": "MSFT", "metric": "capex_fy26_bn", "value": 80.0, "unit": "USD_bn",
   "as_of": "2026-06-30", "source": "MSFT 10-Q Q1 FY26", "source_url": "...",
   "confidence": "high", "category": "ai_capex",
   "notes": "FY26 guidance midpoint"},
  {"entity": "META", "metric": "capex_fy26_bn", "value": 64.0, ...},
  {"entity": "GOOGL", "metric": "capex_fy26_bn", "value": 75.0, ...},
  {"entity": "AMZN", "metric": "capex_fy26_bn", "value": 105.0, ...},
  {"entity": "ORCL", "metric": "capex_fy26_bn", "value": 25.0, ...},
  ...
  {"entity": "industry:hyperscaler", "metric": "capex_2026_total_bn", "value": 725.0, ...},
  {"entity": "industry:hyperscaler", "metric": "capex_cfo_ratio_2026_pct", "value": 93.0, ...},
  {"entity": "industry:hyperscaler", "metric": "capex_cfo_ratio_2023_pct", "value": 33.0, ...},
  {"entity": "industry:hyperscaler", "metric": "depreciation_cliff_2028_bn_per_year", "value": 176.0, ...},
  ...
  {"entity": "Azure_AI", "metric": "yoy_growth_pct", "value": 123.0, ...},
  {"entity": "Google_Cloud", "metric": "yoy_growth_pct", "value": 63.0, ...},
  ...
  {"entity": "MSFT", "metric": "cash_runway_years", "value": 4.0, ...},
  ...
  {"entity": "DeepSeek_V4", "metric": "params_trillion", "value": 1.6, ...},
  {"entity": "Kimi_K3", "metric": "params_trillion", "value": 2.8, ...},
  {"entity": "OpenRouter", "metric": "china_share_jan25_pct", "value": 4.5, ...},
  {"entity": "OpenRouter", "metric": "china_share_jul26_pct", "value": 46.0, ...},
  ...
  {"entity": "macro:erp_jpm_style", "metric": "value_pct", "value": 2.2, ...},
  {"entity": "macro:equity_bond_corr", "metric": "socgen_flip_active", "value": 1.0, "unit": "boolean", ...},
  ...
  {"entity": "study:MIT_2025", "metric": "genai_zero_pnl_pct", "value": 95.0, ...},
  {"entity": "study:Bain_2026", "metric": "ai_revenue_required_2030_trillion", "value": 2.0, ...}
]
```

(Full seed has 50 rows; this subset shows the shape. The actual file is a JSON array — 50 entries total, all five categories represented.)

**Service interface:**

```python
# backend/services/structured_facts.py
from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Any

def get_fact(
    sb, entity: str, metric: str,
    *, as_of: date | None = None,
) -> dict[str, Any] | None:
    """Read one fact. as_of=None returns the most recent. Returns None when
    the fact doesn't exist (NOT zero). Status is per ADR-0098: known /
    unknown / not_applicable."""

def get_facts_by_category(
    sb, category: str,
    *, as_of: date | None = None, limit: int = 100,
) -> list[dict[str, Any]]:
    """All facts in a category, ordered by as_of DESC. The L5 agent uses
    this to pull 'everything we know about ai_capex' in one read."""

def get_facts_for_entities(
    sb, entities: list[str], metrics: list[str] | None = None,
    *, as_of: date | None = None,
) -> list[dict[str, Any]]:
    """Bulk read for L5 thesis construction. The agent says 'give me
    capex_fy26_bn for MSFT/META/GOOGL/AMZN/ORCL'."""

def upsert_fact(sb, fact: dict[str, Any]) -> int:
    """One insert. Used by the loader script. Returns the row id."""
```

**Acceptance criteria (gate before Workstream D):**
- [ ] Migration applies cleanly on a fresh DB and on the live DB
- [ ] All 50 seed rows load via `structured_facts_loader.py` (idempotent on re-run)
- [ ] `get_fact` returns the most recent row for (entity, metric) when `as_of=None`
- [ ] `get_facts_by_category('ai_capex')` returns the 25 capex-related facts
- [ ] RLS blocks `anon` writes (test with anon key)
- [ ] ADR-0214 documents the schema, the discipline, and the "absence is unknown" rule
- [ ] All tests pass

---

## Workstream C — CME FedWatch fetcher

**Goal:** The one missing macro feed that the L5 thesis needs to defend: implied FOMC meeting probabilities. The CME publishes Fed Funds futures implied probabilities. There is no clean free API, but a small `requests` + JSON parse of the public CME page works, with a fallback to the Federal Reserve's H.4.1 release schedule for cross-validation.

**Files:**
- Create: `backend/data/fedwatch_fetcher.py`
- Create: `tests/backend/test_fedwatch_fetcher.py`
- Modify: `backend/data/macro_fetcher.py` (call into fedwatch_fetcher)
- Create: `docs/adrs/0215-fedwatch-fetcher.md`

**Data source:**
- Primary: CME FedWatch Tool public JSON endpoint (`https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html.api`). Returns meeting-by-meeting probability of each target range.
- Fallback: parse the table from the public HTML page if the JSON endpoint changes.

**Schema:** Add rows to `macro_indicators` with `series_id` like `FEDWATCH_MEETING_2026-09-17_PROB_HOLD`, `FEDWATCH_MEETING_2026-09-17_PROB_CUT_25`, `FEDWATCH_MEETING_2026-09-17_PROB_HIKE_25`. Naming convention lets the L5 cite by meeting date.

**Service interface:**

```python
# backend/data/fedwatch_fetcher.py
def fetch_fedwatch() -> list[dict[str, Any]]:
    """Returns one row per (meeting_date, action, probability).
    [{meeting_date: date, action: 'hold'|'cut_25'|'cut_50'|'hike_25',
      probability_pct: float, as_of: date, source: 'CME FedWatch'}]
    Returns [] on any fetch failure (not an exception)."""

def _parse_cme_json(payload: dict) -> list[dict]:
    """Internal: JSON shape changed twice in 2024, so guard against
    both 'meetingProbabilities' and 'meetings' shapes."""
```

**Acceptance criteria (gate before Workstream D):**
- [ ] Live fetch returns probabilities for the next 4 FOMC meetings
- [ ] Probabilities sum to 100% ± 0.5% per meeting (sanity check)
- [ ] A row appears in `macro_indicators` after the next daily refresh
- [ ] ADR-0215 documents the source, the parsing strategy, and the failure mode

---

## Workstream D — L5 reasoning agent integration

**Goal:** The L5 agent cites numbers from `structured_facts` and the new computable analytics (Workstream A's JSONB on `regime_classifications`). The citation guardrail extends to the new sources. The thesis now reads like: *"SMH is over-extended: industry:hyperscaler capex_2026_total_bn = 725 [structured_facts:ai_capex] AND industry:hyperscaler capex_cfo_ratio_2026_pct = 93 [structured_facts:ai_capex], versus debasement_pressure 65 [regime_classifications:debasement]."*

**Files:**
- Modify: `backend/services/q1_agent.py` (add `read_structured_facts` tool)
- Modify: `backend/services/q1_agent.py` (add `read_computable_macro` tool)
- Modify: `backend/services/q1_agent.py` (extend L5 prompt)
- Modify: `backend/services/derivations/numeric.py` (if needed — fact provenance is the same shape as macro provenance)
- Modify: `backend/eval/...` (extend the L5 eval battery with 2 fixtures that require a structured_facts cite)
- Create: `docs/adrs/0216-l5-structured-facts-citation.md`

**L5 prompt patch:**

Add two new tool descriptions to the existing tool block (the L5 prompt already lists every read tool; we just add two more):

```
- read_structured_facts(category: str, entity: str | None = None,
                        metric: str | None = None, as_of: date | None = None)
  → returns [{entity, metric, value, unit, as_of, source, source_url, confidence}]
  Cite as: [structured_facts:<entity>:<metric>]
  ABSENCE IS DATA. An empty list means the fact is unknown; do not invent a
  number. The fact might be quarterly, not real-time — that's fine, cite as_of.

- read_computable_macro(metric: 'erp' | 'equity_bond_corr' | 'ndx_seasonality')
  → returns {value, as_of, method, source_components}
  Cite as: [regime_classifications:computable_macro:<metric>]
  These are DERIVED from data the system already has. They are not opinions.
```

**Citation guardrail extension:**

The existing `verify_citations` step in `q1_agent.py` matches `[table:column]` patterns. Extend the regex to:
- `[structured_facts:<entity>:<metric>]` — must match an existing `(entity, metric)` pair in the table
- `[regime_classifications:computable_macro:<metric>]` — must match one of the three known metric keys

**Eval battery extension:**
- Add fixture `eval/l5_fixtures/structured_facts_required.json` — a thesis that *must* cite at least one `structured_facts` row, with a known good answer.
- Add fixture `eval/l5_fixtures/absence_honored.json` — a question that has no answer in the system, and the expected response is "unknown" not a hallucination.

**Acceptance criteria (gate before Workstream E):**
- [ ] L5 produces a thesis that cites at least one `structured_facts` row when run on the ai_capex theme
- [ ] `verify_citations` rejects a hallucinated `structured_facts` cite (unit test)
- [ ] `verify_citations` accepts a valid `structured_facts` cite (unit test)
- [ ] L5 produces "unknown" (not a hallucinated number) when asked about a metric not in the table
- [ ] Both new eval fixtures pass
- [ ] All existing eval fixtures still pass (no regression)
- [ ] ADR-0216 documents the prompt changes, the citation format, and the eval fixtures

---

## Workstream E — `/ask` + UI surfacing

**Goal:** The `/ask` agent (which reads from the published book) can answer questions about the new layer. The user-facing UI shows the new layer somewhere discoverable.

**Files:**
- Modify: `backend/services/ask_service.py` (or wherever /ask lives — verify path)
- Modify: `frontend/app/ask/page.tsx` (add structured_facts to the "active context" display)
- Create: `frontend/components/facts/StructuredFactsPanel.tsx` (new panel)
- Create: `frontend/app/facts/page.tsx` (a `/facts` page that lists everything in the table, grouped by category)
- Add to `frontend/lib/method/phases.ts`: a "06.5 Facts" entry between Attribution and the next phase, OR fold it into the existing Attribution phase. Decision deferred to the UI owner.

**`/facts` page design:**
- Title: "Structured Facts — what's in the system, by category"
- Four sections: AI Capex, China AI, Macro, Valuation
- Each section: a table of `(entity, metric, value, unit, as_of, source, confidence)`
- Each row links to the source URL when present
- A small "Last updated" timestamp per section
- A "How to read" callout: "These are hand-curated facts the L5 reasoning agent cites. The system will refuse to claim a number not in this table."

**`/ask` integration:**
- The active context display (already shows the multi-asset book) gains a small "Facts available" line: "AI Capex: 25 facts · China AI: 12 facts · Macro: 8 facts · Valuation: 5 facts" with a link to `/facts`.
- The `AskConsole` tool list (already includes `read_theme_signals`, `read_macro_indicators`) gains `read_structured_facts` and `read_computable_macro`.

**Acceptance criteria:**
- [ ] `/facts` page renders all 50 seed rows, grouped correctly
- [ ] `/ask` agent can answer "what does the system know about MSFT capex?" with at least one `structured_facts` cite
- [ ] `/ask` agent refuses to answer "what was the OpenRouter share in 2024?" with a number (the fact is not in the table)
- [ ] UI tests pass (the project has frontend tests — verify with `npm test`)
- [ ] TypeScript compiles clean (`tsc --noEmit`)

---

## Workstream F — Tests + verification

**Goal:** Everything wired up, nothing broken, all new code has tests, all existing tests still pass.

**Checklist:**
- [ ] All `tests/backend/test_*.py` files pass (existing + 5 new)
- [ ] `python -m pytest --tb=short` clean
- [ ] `ruff check backend/` clean
- [ ] `mypy --strict backend/services/structured_facts.py backend/services/equity_risk_premium.py backend/services/equity_bond_correlation.py backend/services/seasonality_analytics.py backend/data/fedwatch_fetcher.py` clean
- [ ] `npm test` in `frontend/` clean
- [ ] `tsc --noEmit` in `frontend/` clean
- [ ] Live daily refresh run completes, all pipeline stages report `success` or `measured`
- [ ] The `L2b` and `L3a/b/c` pipeline_runs rows appear
- [ ] `regime_classifications.computable_macro` populates
- [ ] `structured_facts` has all 50 seed rows
- [ ] L5 eval battery passes on the live state (not just unit tests)
- [ ] `/ask` smoke test: 3 questions, 3 expected answers

---

## Workstream G — Q2 test prep (Aug 3 09:00-14:00 SGT)

**Goal:** Use the system to produce the actual test answer. Not write more code; demonstrate what's there.

**Output: a single markdown file `q2_submission.md`** with:
1. **Framework diagram** (mermaid, copy from ARCHITECTURE.md L0-L6)
2. **Detection layer (L1-L2)** — what it does, what it doesn't, with a live example: pick the current highest-velocity narrative and show its 30-day share + attention-price link
3. **Verification layer (new, this plan)** — the structured_facts table, the computable macro analytics, with 3 example cites from the live system
4. **Q1 thesis example** — a thesis the L5 produced using the new cites
5. **What the system refuses to claim** — examples of "unknown" responses (a list of 5 things the system *cannot* answer from stored data)
6. **What we'd add next with 1 more week** — 3 items, in priority order

**Time:** 4 hours. Then 2 hours of buffer for the test format.

---

## Trim ladder (if any workstream overruns)

| Overrun | Trim |
|---|---|
| Workstream A takes >8h | Drop `seasonality_analytics.py` from this sprint. Add it to the next leg. The Q2 test doesn't require it. |
| Workstream B takes >10h | Reduce seed to 30 rows (drop the "study:*" and "macro:equity_bond_corr" rows that overlap with Workstream A). |
| Workstream C blocks | Defer FedWatch. The L5 cites "CME FedWatch: 57% Sept hold" from training data with an `[external]` marker. Acceptable interim. |
| Workstream D takes >8h | Ship only `read_structured_facts` tool. Defer `read_computable_macro` to next sprint. |
| Workstream E takes >6h | Skip the new `/facts` page. The `/ask` integration is the only must-have; the page is a nice-to-have. |

---

## Hard "don't do" list

These are tempting and we are NOT doing them in this sprint:

1. **Don't add a fundamental data API (Koyfin, FactSet, Refinitiv).** Multi-month build, paid feed, duplicates Bloomberg. The Q2 test is not asking for this.
2. **Don't build a personal portfolio tracker.** The recap's Section 4 (Tiger positions) is a real gap, but it's a *different* system. Out of scope for this 2.5-day window.
3. **Don't auto-update `structured_facts`.** Hand-curated by design. The discipline of a small, dated, sourced fact table is the point. Automation breaks the discipline.
4. **Don't add a sentiment-scoring layer to `structured_facts`.** It's not a number, it's a fact. Sentiment lives in `narrative_signals`.
5. **Don't reformat `macro_indicators` to look like `structured_facts`.** They are different on purpose: `macro_indicators` is FRED-shaped (series, value, unit, fetch_date) and updates nightly. `structured_facts` is human-shaped (entity, metric, value, unit, as_of, source, confidence) and updates on a different cadence. The two are read by the same L5 tool but stored separately.
6. **Don't change the L5 fallback path.** The current fallback (deterministic picks if the LLM retries exhaust) is a safety property. The new tools come BEFORE the fallback, not as a replacement for it.

---

## Coordination notes (the two-session / merge pattern)

This worktree may have parallel sessions. Standard rules from the existing plan templates:

- Commit per task in ONE bash call: `git add -- $NEW && git commit --only -F - -- $NEW $MOD`. `--only` builds the commit from HEAD + the listed paths.
- Never `git stash`. If recovery needed: `git stash list` then `git stash apply` (never `pop`).
- Before claiming an ADR number, `ls docs/adrs/`. As of this plan, 0212 is the latest. This plan claims 0213-0216 (verify at write time; if a parallel session took one, renumber).
- After committing, verify: `git show HEAD:<file> | grep <your text>`.
- When resolving conflicts in shared append-only docs (`PROGRESS.md`, `ARCHITECTURE.md`, `docs/adrs/README.md`), keep every entry from both sides.
- No co-author trailer in commits.
- New module verification: `cd /c/Users/zihan/projects/andromeda && python -c "from backend.services.equity_risk_premium import compute_erp; print(compute_erp.__doc__)"` rather than relying on pytest collection.

---

## Definition of done

The plan is "done" when ALL of the following are true:

- [ ] All 5 new test files pass
- [ ] All existing tests pass (no regression)
- [ ] `ruff`, `mypy --strict`, `tsc --noEmit` all clean
- [ ] Live daily refresh completes with the new pipeline stages populated
- [ ] `structured_facts` has 50 rows
- [ ] `computable_macro` JSONB populates with all three metrics
- [ ] L5 eval battery passes including the 2 new fixtures
- [ ] `/ask` correctly handles one "what does the system know" question AND one "what does the system NOT know" question
- [ ] `/facts` page renders
- [ ] ADRs 0213, 0214, 0215, 0216 are all written, indexed in `docs/adrs/README.md`, and referenced in `ARCHITECTURE.md`
- [ ] `q2_submission.md` is drafted using the live system
- [ ] `PROGRESS.md` has a "Completed" entry for each of the 4 new ADRs

The plan is NOT done when code compiles. The plan is done when a third party can pick up the system, run the daily refresh, ask `/ask` a question, and get a number that traces back to a row in `structured_facts` with a source URL.

---

## Appendix: ADR outline (drafter, not yet written)

### ADR-0213 — Computable macro analytics belong in regime_classifications, not in a new table
**Context:** Three new metrics (JPM-style ERP, equity-bond correlation, NDX seasonality) need a home. They are derived from `macro_daily_history` and recomputed nightly, but the L5 needs to cite them. New table is overkill.
**Decision:** JSONB column on `regime_classifications` named `computable_macro`, populated by three service modules after L3. Each metric is `known` / `unknown` / `not_applicable` per ADR-0098.

### ADR-0214 — A structured_facts table for the numbers the system has to defend
**Context:** The L5 cites numbers from training data. The Q2 test rewards candidates whose systems cite numbers they *store*. The current schema (`macro_indicators`, `theme_signals`) doesn't fit fundamentals.
**Decision:** New `structured_facts` table, hand-curated, 50 rows for the Q2 question, cite-checked, RLS public read. New service `backend/services/structured_facts.py` with `get_fact`, `get_facts_by_category`, `get_facts_for_entities`, `upsert_fact`.

### ADR-0215 — CME FedWatch as a derived macro_indicators feed
**Context:** The L5 thesis on Fed policy needs implied probabilities. No clean free API, but CME publishes them.
**Decision:** `backend/data/fedwatch_fetcher.py` parses the public JSON. Rows land in `macro_indicators` with `series_id` like `FEDWATCH_MEETING_<date>_PROB_<action>`. Failure mode: empty list, not exception.

### ADR-0216 — L5 cites structured_facts and computable_macro, with provenance
**Context:** The L5 reasoning agent should cite from the new layer, with the same citation discipline as `macro_indicators` and `theme_signals`. The guardrail extends to the new formats.
**Decision:** Two new L5 tools (`read_structured_facts`, `read_computable_macro`), two new citation formats, two new eval fixtures, prompt updated. Fallback path unchanged.
