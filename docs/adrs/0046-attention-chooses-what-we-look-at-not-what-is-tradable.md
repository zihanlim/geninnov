# ADR-0046 — Attention chooses what we look at; a decisive edge earns a look anyway

**Date:** 2026-07-24
**Status:** Accepted
**Relates to:** [0029](0029-two-sided-backfill.md), [0032](0032-edge-stage4-abstention-conviction.md), [0039](0039-scope-by-attention-abstain-by-asset.md), [0042](0042-absolute-hype-subscores.md)

## Context

`GOAL.md` has carried the same open Q1 gap for many iterations: *the ask is five
longs and five shorts; the book holds five and three.* Previous iterations chased it
through L5's selection (ADR-0039), through what the agent is handed at reasoning time,
and through candidate redundancy. Each time the answer moved. This time it was
measured one layer earlier, at the point where the candidate pool is built, and the
constraint is unambiguous.

On 2026-07-24 the eight themes scored:

| Theme | HypeScore | Theme EdgeScore | In the pool? |
|---|---|---|---|
| US Dollar | 71.7 | +0.206 | yes |
| Geopolitical Risk | 67.9 | +0.207 | yes |
| US Election | 58.4 | +0.202 | yes |
| Fed Policy | 56.8 | +0.294 | yes |
| **China Growth** | **46.7** | **−0.264** | **no** |
| Corporate Credit | 42.5 | +0.200 | no |
| **Energy Prices** | **36.4** | **+0.332** | **no** |
| Inflation | 28.9 | +0.116 | no |

Scope is chosen by attention: `eligible = [r for r in scored if hype_score >=
hype_score_threshold]`, threshold 50. Four themes cleared it and the other four were
never expanded into candidates at all — their assets were scored per-asset and then
discarded unread.

Two consequences, both bad:

1. **The only decisively short theme in the system was invisible.** China Growth at
   −0.264 is the most negative signal on the board, and it missed the gate by 3.3
   HypeScore points. The book's three shorts were all taken out of themes whose own
   edge is *positive* — shorts backfilled from long themes, while the actual short
   theme sat outside. That is the five-and-three gap, and it is not L5's selection.
2. **The gate systematically removes the highest-conviction signals.** The four
   themes that cleared it have edges clustered in +0.20…+0.29. The two largest
   magnitudes of the day — Energy Prices +0.332 and China Growth −0.264 — are both
   outside. Attention and conviction are unrelated quantities, so gating one on the
   other discards the tails of the distribution that actually matters.

A third problem is structural rather than about one day. HypeScore is now absolute
(ADR-0042), so 50 is a fixed bar against a quantity whose observed range today was
28.9–71.7. On a quiet news day every theme can sit below it and the pool is empty; on
a loud day all eight pass. **The number of tradable themes is a function of the news
cycle, not of the signal.**

The constraint `GOAL.md` imposes on any fix is explicit: *"Do not lower a threshold to
manufacture a fuller-looking book — widen the candidate universe instead, which is the
honest fix."* Lowering `hype_score_threshold` is exactly the forbidden move; it would
admit Inflation at +0.116 along with everything else, and would make the pool larger
without making any individual name more decisive.

## Decision

Add a **second, stricter door** into the candidate pool. A theme below the attention
gate is expanded anyway when **at least one of its assets carries `|EdgeScore| >=
edge_conviction_override`** (`scoring_config`, default **0.25**).

Four properties make this a widening rather than a loosening:

1. **The bar is above the abstention band, not below it.** `edge_abstain_threshold`
   is 0.15; the override is 0.25, and the implementation takes
   `max(conviction_override, abstain_threshold)` so a misconfigured value can never
   become a back door around abstention. A name has to be *decisive* to earn a look
   its theme's attention did not.
2. **Every admitted candidate still faces abstention on its own edge** in `_expand`.
   The override changes what is *scored*, never what clears.
3. **The test is asset-level, not theme-level.** ADR-0039 established that theme edge
   is a summary statistic that is smallest exactly when a theme's assets disagree —
   so admitting on `|theme edge|` would let in the themes whose names agree and keep
   out the cross-sectionally richest ones, the precise inversion of what is wanted.
4. **It is visible.** Admitted candidates carry `via_conviction = true` through
   `trade_candidates` to `/book`, the screening funnel gains a stage that *adds*
   rather than subtracts, and the not-taken table tags those rows **on edge**.
   "Arrived on attention" and "arrived on conviction" are different claims about why
   a name is on the page and must not render identically.

## Consequences

- The attention premise survives intact for the ordinary case: hype still chooses
  scope, still ranks it, and still sizes it. The override is the documented
  exception, not a replacement.
- A funnel that only ever subtracts implies the pool started complete. It did not,
  and the new stage says so — including when the override admits nothing, which is
  a legitimate and common outcome.
- Q2 is unaffected. HypeScore's job — *identify what is trending and quantify the
  attention* — is untouched. What changes is that a third, unargued job (deciding
  tradability) has been taken away from it.
- **This does not promise a five-and-five book.** China Growth's assets are largely
  one bet (FXI, KWEB, BABA, JD, PDD, MCHI all express China), so admitting the theme
  adds roughly *one* independent short idea, not five. The measured result of the
  first run under this rule is recorded in `PROGRESS.md`; if the override admits
  nothing, that is reported as such rather than tuned until it does.
- The parameter lives in `scoring_config` like every other weight and lookback, so
  changing it is a database edit, not a code change. Setting it to 0 restores the
  pre-ADR-0046 behaviour exactly, and the default in `rank_trade_candidates` is
  `None` so existing callers and tests are unaffected.
