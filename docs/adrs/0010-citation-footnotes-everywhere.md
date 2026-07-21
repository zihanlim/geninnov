# ADR-0010 — Citation footnotes on every numeric claim

- Status: accepted
- Date: 2026-07-21
- Tags: ux, frontend, ai-safety, research

## Context

The Q1 reasoning pipeline produces a thesis with numeric claims ("HY OAS at 380bps", "8% YTD", "Beta 0.42"). The LLM in L5 can hallucinate these numbers — that's the primary failure mode. The spec's §14.8 `verify_citations` step is a backend guardrail: every numeric claim in the LLM output must cite a FRED series ID or theme key, and the citation is verified against the L0–L4 input snapshot. Un-cited numbers → retry (max 2) → fallback to deterministic picks.

The guardrail is implemented in the backend. But the **UI does not surface the citations**. The reviewer sees a thesis paragraph but cannot see which number was sourced from where, or whether the LLM made up a figure. The auditability is invisible.

This is a problem because the Q1 test deliverable asks the reviewer to evaluate "what are your top 5 long/short, and why?" — the "why" is the thesis, and the "why" is the part most likely to fail audit. Without UI-level citation rendering, the reviewer either has to take the thesis on faith (bad) or read the L5 agent's raw output JSON directly (worse).

The pattern that solves this is borrowed from Perplexity (AI answer engine): every claim has a visible superscript citation ¹-⁵, and a footnote panel at the bottom lists each citation with its source. The pattern is mainstream, recognizable, and has been validated at scale.

## Decision

Render every numeric claim in the Q1 thesis (and in the per-theme card) with a visible **superscript citation** that links to a footnote in a `CitationPanel`. The citation panel is part of the same component — no external navigation, no modal, no popup. Just inline ¹-⁵ marks and a footnotes block at the bottom.

The data layer that powers this is already in place:
- `research_agent_runs.citations` JSONB column stores `{text, source, value}` for each claim
- `theme_signals_history` stores raw signal values that can be back-referenced
- `scoring_config` stores weights and lookback windows
- FRED series IDs are stable identifiers that work as citation keys

The UI just needs to consume these and render them.

### Implementation

A `<CitationList>` component in `frontend/components/` that:
1. Accepts a thesis string with inline `[¹](cite:source-key)` markers
2. Renders the thesis with `<sup>` elements for the citation numbers
3. Renders a footnotes block below with one entry per source key
4. Hover/focus on a citation shows the source value inline (no modal)

The Q1 thesis in the `/research` page is the highest-priority surface. The `<RegimeInputs>` panel in L7 also uses this pattern for the 6 regime inputs.

### Pattern

```
HypeScore 78.4 [14 sources]
Long #1: TLT (15.2%) — Duration overweight into Jackson Hole.
HY OAS at 380bps ¹; 2s10s curve disinverting +18bps over 30d ²;
trade_score +1.42 (hype_momentum ×0.55 + sentiment ×0.45) ³.

[Footnotes]
¹ HY OAS — FRED BAMLH0A0HYM2 — current 380bps (regime: risk-on threshold <350)
² 2s10s slope — FRED T10Y2Y — current +18bps, +18bps Δ from 30d ago
³ TradeScore formula — scoring_config.trade_score_weights = {hype:0.55, sent:0.45}
```

## Consequences

### Positive
- The thesis is auditable in-place — reviewer doesn't need to read raw JSON
- Hallucinated numbers are immediately visible (the citation either resolves or doesn't)
- The L5 agent's `verify_citations` step has a UI mirror — the same evidence is shown to the human
- Perplexity-style provenance is mainstream; users recognize the pattern

### Negative
- More text per thesis paragraph — readers may skim past the citations
- Requires the L5 agent to actually emit structured citations (already implemented via `verify_citations`)
- Some claims don't have clean citations (e.g. "Fed pivots dovish in Q1 2026" is a forecast, not a data point) — these get no citation, which is fine

### Neutral
- Citation keys are stable identifiers (FRED series IDs, theme names) — no new schema needed

## Alternatives considered

### Endnotes only (no inline marks)
What it was: a "Sources" panel at the bottom listing all data sources, with no inline marking.
Why we rejected: too disconnected. The reader has to scroll back and forth to verify each claim. The whole point of citations is to bind the claim to the source at the moment of reading.

### Modal popups on hover
What it was: hover over a number → small popup shows the source.
Why we rejected: popups are easy to miss, hard to scan, and break the reading flow. Inline superscripts + footnotes panel keeps everything in the same viewport.

### Tooltips only
What it was: HTML `title` attribute on numeric spans showing the source.
Why we rejected: tooltips don't render on mobile, don't support formatted content, and have a discoverability problem (the user has to know to hover).

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §14.8 (verify_citations)
- Related: [ADR-0009](0009-research-first-design-philosophy.md), [ADR-0011](0011-theme-derivation-drawer.md)
- Pattern source: https://www.perplexity.ai/finance
