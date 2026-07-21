# ADR-0014 — Q1 picks hard-filtered to the L5 candidate set (LLM cannot pick outside data)

- Status: accepted
- Date: 2026-07-21
- Tags: ai-safety, q1-pipeline, llm, deterministic-stochastic

## Context

The L5 reasoning agent invokes an LLM at the `reason_picks` node to synthesize the L0–L4 inputs into a structured $100M long-short book. The LLM is free to write any prose it wants, but it has to produce a set of trades — and the trades must be **real instruments** that the deterministic pipeline knows about (factor exposures, price history, asset metadata).

The naive architecture — give the LLM free rein to pick any ticker — invites three failure modes:
1. **Ticker hallucination.** The LLM invents a ticker that doesn't exist or is mis-classified ("long META" when the L2 factor fetcher has no data for META). The result: a trade with no factor exposure, no price history, no risk metric. The reviewer sees a name in a thesis but cannot verify anything about it.
2. **Fictional tickers.** The LLM invents a ticker entirely ("long NVAX" instead of "long NVDA"). The output looks plausible but the ticker doesn't resolve. The portfolio constructor downstream crashes or silently drops the position.
3. **Theme mismatch.** The LLM picks a name that doesn't fit any theme in the L1 data. The thesis cites a theme that doesn't exist; the book coherence collapses.

Each of these is fatal in a quant interview context. A thesis that says "long NVAX" or "long an AI capex theme with factor exposure 1.4 beta 0.3 SMB" when the L1 has no such theme is immediately disqualifying.

The defense: **the LLM cannot pick a name that didn't survive the deterministic `screen_candidates` filter.** The candidate set is computed before the LLM is invoked; the LLM is given that set and told to pick from it. The post-LLM `size_positions` step operates on the same set, so the LLM cannot bypass the filter by naming a different ticker.

## Decision

The L5 agent's `screen_candidates` node computes a **bounded candidate set** before the LLM is invoked. The LLM is given this set as the universe of acceptable picks. Any name in the LLM's output that is not in the candidate set is rejected and the LLM is re-invoked with explicit error feedback.

### screen_candidates filters (applied in order)

```python
def screen_candidates(state: ResearchState, supabase: Client) -> ResearchState:
    cfg = load_config()
    threshold = cfg.hype_score_threshold       # default 50
    
    candidates = []
    for theme in state["theme_scores"]:
        # Filter 1: HypeScore must be above threshold
        if (theme.get("hype_score") or 0) < threshold:
            continue
        # Filter 2: TradeScore must be non-zero (must have a directional signal)
        if theme.get("trade_score", 0) == 0:
            continue
        # Filter 3: For equities, R² ≥ 0.10 vs theme's price signal (liquidity check)
        #   ETFs always pass (R² assumed for liquid ETFs)
        if not _passes_liquidity_check(theme):
            continue
        # Filter 4: Deduplication — same (asset, direction) pair → keep highest HypeScore
        candidates.append(_maybe_add(candidates, theme))
    
    # Filter 5: Cap at 30 candidates (max)
    state["candidates"] = candidates[:30]
    return state
```

The LLM prompt explicitly says: *"Pick from the following candidate set only. Do not invent tickers."* The post-LLM validation in `reason_picks` checks every pick's `asset` field against the candidate set; mismatches → retry.

### Why these 5 filters

1. **HypeScore threshold.** A theme below the threshold has no signal. Including it in the candidate set invites noise.
2. **TradeScore ≠ 0.** A zero trade score means no directional signal (no momentum, no sentiment). No reason to take a position.
3. **Liquidity check (R² ≥ 0.10).** An asset whose returns don't correlate with its own theme's price signal is either illiquid or misclassified. Including it in the book is operational risk.
4. **Deduplication.** A theme can map to multiple assets; multiple themes can map to the same asset. The candidate set has unique (asset, direction) pairs.
5. **30-cap.** The LLM is asked to pick 5+5. A candidate set of 30 gives 6× headroom for the LLM to filter by fit, while bounding the LLM's search space.

### What the LLM sees

The LLM prompt's `candidates` field contains entries like:
```json
{
    "asset": "TLT",
    "direction": "long",
    "theme_id": "fed-policy",
    "theme_name": "Fed Policy",
    "hype_score": 78.4,
    "trade_score": 1.42,
    "avg_sentiment": 0.64
}
```

The LLM is told: *"The candidate set is closed. Pick from this list. Do not invent tickers. If none of the candidates fit your thesis, explain why in `book_risks` rather than picking outside the set."*

### Post-LLM enforcement

In `reason_picks`, the LLM's output is validated:
```python
candidate_assets = {c["asset"] for c in state["candidates"]}
for pick in state["picks"]:
    if pick["asset"] not in candidate_assets:
        state["error"] = f"LLM picked {pick['asset']} not in candidate set"
        state["retries"] += 1
        return _retry_reason_picks(state, llm)
```

If a retry also fails, `fallback_picks` produces a deterministic top-5 by HypeScore with no LLM involvement.

## Consequences

### Positive
- The LLM cannot pick a name that the deterministic pipeline doesn't know about
- Every name in the L5 output has a corresponding entry in `theme_assets`, `factor_exposures`, and the price history
- The book is internally consistent: theme ↔ asset ↔ factor exposure ↔ thesis
- The reviewer can trace any pick back to its theme's HypeScore, factor data, and price history

### Negative
- The LLM is constrained in its creativity. If the LLM has a great thesis on a ticker that the L1 system doesn't track, it cannot pick it. Mitigated by surfacing "none of the candidates fit" in `book_risks` for human review.
- The 30-cap is somewhat arbitrary. A larger candidate set gives the LLM more headroom but also more noise. A smaller set is more focused but might exclude valid ideas. 30 was chosen as 6× the LLM's required output (5+5 = 10 picks).
- The liquidity check (R² ≥ 0.10) is a heuristic. An asset with R² = 0.09 might still be liquid; an asset with R² = 0.15 might still be illiquid. The threshold is a guardrail, not a guarantee.

### Neutral
- The candidate set is computed once per run and frozen into the input snapshot. The LLM cannot re-compute or filter it.
- The candidate set is part of the L0–L4 deterministic output, so it is auditable independently of the LLM.

## Alternatives considered

### LLM picks any ticker; post-hoc filter and look up factor data
What it was: let the LLM pick anything; after the fact, fetch factor data for the new tickers and integrate them.
Why we rejected: adds a network dependency to the verification path, makes the run non-deterministic (the LLM might pick a different ticker each run), and creates a race condition (what if the post-hoc lookup fails?). The pre-LLM filter is more robust.

### LLM picks from a closed but huge universe (all 500 liquid ETFs)
What it was: give the LLM the full ETF universe; let it filter.
Why we rejected: too much freedom. The LLM will pick tickers that don't fit any tracked theme, breaking the theme ↔ asset ↔ thesis coherence. The 30-candidate set is the right size: enough for fit-based filtering, small enough to keep the LLM grounded.

### No candidate filter; trust the LLM to stay on theme
What it was: prompt the LLM with the theme list; trust it to pick within.
Why we rejected: doesn't work. LLMs pick outside the prompt's intended scope all the time, especially under ambiguity. The hard filter is structural insurance.

### Pre-compute a separate "long-list" of 100 candidates and a "short-list" of 30
What it was: two-tier filter — long-list of 100 (looser), short-list of 30 (tighter) passed to the LLM.
Why we rejected: more complexity for marginal benefit. The single 30-candidate list is sufficient.

## Links
- Spec: `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` §6.2 (Long/Short Ranking) and §14.8 (screen_candidates node)
- Implementation: `backend/services/q1_agent.py` → `screen_candidates` and `reason_picks` nodes
- Related: [ADR-0012](0012-citation-guardrail-llm-defense.md), [ADR-0013](0013-deterministic-stochastic-split.md)
