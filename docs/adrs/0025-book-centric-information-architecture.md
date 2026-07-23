---
status: accepted
date: 2026-07-23
deciders: platform owner
---

# ADR-0025 — Book-centric information architecture

## Context

The frontend had four pages. Three of them — `/trades`, `/portfolio`, `/research` — were partial views of **the same ten positions**, each reading a different table, each showing a different subset, with no cross-links:

| Page | Table | Shows | Missing |
|---|---|---|---|
| `/trades` | `trade_candidates` | TradeScore, HypeScore, notional | thesis, risk, sizing rationale |
| `/portfolio` | `portfolio_positions` | notional, weight, risk scalars | why, thesis, stress |
| `/research` | `research_recommendations` | thesis, counter-thesis, catalysts | sizing, risk, exposure |

A portfolio manager asking *"why am I short KWEB at 8%?"* had to visit all three and still could not assemble an answer: the sizing rationale lived on one page, the thesis on another, and the risk contribution nowhere.

Two further gaps sat outside all four pages:

- **Risk had no home.** VaR/CVaR/Sharpe/β/HHI were five scalars in a corner of `/portfolio`, with no decomposition, no limits, no stress and no correlation. The stress and correlation data was computed daily and discarded (see [ADR-0024](0024-persist-book-analytics-not-prompt-strings.md)).
- **The method was undocumented in the product.** The platform's second design question is explicitly *"explain how you would do this, from data gathering to the quantification framework."* That explanation existed only in `docs/`.

## Decision

**Reorganise around the object a PM actually reasons about — the book — and give risk and method their own surfaces.**

Primary navigation, ordered as a PM's morning:

| Route | Answers |
|---|---|
| `/` — Themes | What is moving, and how much attention is it attracting? |
| `/book` — The $100M Book | What do we hold, why, and sized how? |
| `/risk` — Risk & Stress | What kills this book, and where are the limits? |
| `/method` — Method & Lineage | How was every number derived, and is the pipeline healthy? |

`/book` renders one expandable row per position. Collapsed: direction, ticker, theme, weight, notional, HypeScore, TradeScore, single-name cap utilisation. Expanded: thesis with citation footnotes, counter-thesis, catalysts, the **full sizing chain** (raw HypeScore/100 → normalise → cap enforcement → final notional), factor tilts, and per-scenario stress contribution. Below the positions sits the screening funnel.

`/trades`, `/portfolio` and `/research` are **retained in a secondary nav group**, not deleted. They are load-bearing for the existing Playwright suite and for anyone with a bookmark, and the consolidation should be proven before the originals are removed.

Two cross-cutting rules adopted at the same time:

1. **No investor-facing string may be authored in the frontend.** Either it arrives from the pipeline with a `NumericDerivation` / `AdvisoryDerivation`, or the surface renders an explicit unavailable state. This formalises what [ADR-0010](0010-citation-footnotes-everywhere.md) and [ADR-0018](0018-provenance-read-model-seam.md) already implied, and which the codebase had been violating: hardcoded per-theme investment theses, a "synthetic but stable" sub-score attribution, an invented Kelly sizing formula, fabricated per-source counts, and a permanently-green "Pipeline healthy" indicator.
2. **Every empty state names its cause and its remedy**, via a shared `EmptyState` component rather than by discipline. Not "No positions" but "0 of 8 themes cleared the HypeScore 50 threshold; highest is 45.7, short by 4.3."

Rule 2 is not cosmetic. The current production state *is* the empty state — no theme clears the threshold, so `trade_candidates` and `portfolio_positions` are empty — and the previous generic strings left a broken pipeline, a quiet market and a mis-set threshold indistinguishable.

## Consequences

Positive:
- The "why am I in this position at this size" question is answerable from one screen.
- Risk becomes a first-class surface rather than five scalars, and it needed no new computation — only [ADR-0024](0024-persist-book-analytics-not-prompt-strings.md)'s persistence.
- `/method` answers the platform's second design question inside the product, driven by live `pipeline_runs` and `scoring_config` rather than prose.
- The fabrication ban is enforceable by grep, and is now part of the verification checklist.

Negative / friction:
- Seven nav entries until the legacy three are retired. The secondary group is visually de-emphasised, but this is transitional clutter and should be removed once `/book` is proven.
- `/book` and `/portfolio` now both read position data by different routes and can disagree if one is updated without the other. The retirement of `/portfolio` closes this; until then it is a known duplication.
- Deep links to `/research#pick-3` and similar do not carry over.

## Alternatives considered

**Enrich the three existing pages in place.** Rejected: it preserves the split that causes the problem. The pages are not three concerns, they are three projections of one object, and no amount of enrichment makes cross-page reasoning work.

**Delete `/trades`, `/portfolio`, `/research` immediately.** Rejected as premature: the e2e suite targets them, and the consolidation is unproven against a populated book (production currently has none). Retire them once a real run exercises `/book`.

**Put risk inside `/book` as a tab.** Rejected: risk is consumed on a different cadence. Position rationale is read when a position changes; stress and limits are monitored continuously and reviewed independently of any single name.
