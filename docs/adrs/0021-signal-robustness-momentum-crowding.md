# ADR-0021 — Signal robustness: robust momentum + signed crowding

- Status: accepted
- Date: 2026-07-23
- Tags: analytics, signal-design

## Context

Two signal-construction weaknesses in L1:

1. **Momentum** was a raw 7-day mean/std z-score, `(count_1d - mean_7d) / std_7d`. On a 7-point window a single viral day inflates the mean and a single quiet day shrinks the std, so the momentum term swings on noise; the zero-std case silently produced 0 (indistinguishable from "no change").
2. **Correlation** was folded via `abs()` everywhere. That is correct for *attention* (HypeScore, ADR-0006 — a theme co-moving with the market either way is equally "hot"), but the sign is exactly what a trade/risk view needs: a high-attention positive co-move is a *crowded* consensus (mean-reversion risk), an inverse mover is a natural hedge. The sign was thrown away.

## Decision

1. Replace the mean/std momentum with a **median/MAD robust z-score** (`hype_calculator.robust_momentum`), scaled by 1.4826, clipped to [-4, 4], returning an explicit `degenerate` flag when the window has no spread (logged, not silently zeroed).
2. **Keep** HypeScore's `abs()` folding (ADR-0006 stands) but also persist `signed_corr` and an attention-gated `crowding` label (`crowded` / `hedge` / `neutral`) on `theme_signals_history` (migration 019) for the trade/risk layer via `hype_calculator.crowding_score` / `crowding_label`.

## Consequences

### Positive
- Momentum no longer swings on a single outlier day; degenerate windows are visible.
- The crowding sign is available to trade/risk consumers without disturbing the intentional attention folding.

### Negative
- New columns require migration 019; a guarded fallback writes the base row if it isn't deployed.

## Alternatives considered

- **Winsorized mean/std momentum.** Median/MAD is simpler and equally robust; chosen.
- **Invert HypeScore's `abs()` folding.** Rejected — it would break ADR-0006's attention rationale. Crowding is surfaced *alongside*, not in place of, the folded hype sub-score.

## Links
- `backend/services/hype_calculator.py` (`robust_momentum`, `crowding_score`, `crowding_label`), ADR-0006, `supabase/migrations/019_crowding_signal.sql`
