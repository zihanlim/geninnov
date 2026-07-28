# ADR-0127: The cross-asset term measured one asset

**Status:** Accepted
**Date:** 2026-07-28
**Related:** [ADR-0006](0006-hype-score-formula.md), [ADR-0028](0028-absolute-correlation-subscore.md), [ADR-0036](0036-edge-renormalisation.md), [ADR-0042](0042-absolute-subscores.md), [ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md)

## Context

The brief defines a market theme as *"the narratives driving **cross-asset** moves"*. `hype_corr_weight` is **0.30** — a third of HypeScore — and is the only term in the formula that claims to measure that.

It measured one instrument.

```python
price_corr = 0.0
if not price_df.empty and not mention_series.empty:
    for ticker in tickers:
        corr = correlation_with_mentions(price_df, mention_series, ticker)
        if not pd.isna(corr):
            price_corr = corr
            break
```

The loop reads as "try each mapped ticker until one yields a measurable correlation". It never did that, because `correlation_with_mentions` returns **`0.0`** for every unmeasurable case — empty frame, fewer than five overlapping sessions, degenerate series — and **never `NaN`**. `not pd.isna(0.0)` is `True`. The loop therefore always took the **first** ticker and broke.

Two consequences, both live:

1. **Fed Policy is mapped to eight instruments spanning rates, commodities and equity.** Its cross-asset correlation was whichever one `theme_assets` returned first under `order("run_date", desc=True).limit(20)` — an ordering nobody chose and nothing pins. A theme that moved four asset classes together and a theme that tracked a single ETF produced the same number.
2. **An unmeasurable first ticker scored a hard 0.0** while seven mapped instruments had full history. The theme then read as uncorrelated — a 30-point deduction — for a gap in our data.

The second is the more serious, and it is the same defect class as [ADR-0121](0121-the-fix-missed-the-map-that-mattered-and-the-guard-said-clean.md): **a guard that cannot fail is worse than no guard**, because it reads as a check that passed.

## Decision

**`correlation_with_mentions` returns `None` for "not measurable", never `0.0`.**

`None` is not a number. It cannot be averaged, compared, or mistaken for a measured absence of correlation, which makes the distinction un-ignorable at the call site rather than a convention a caller may forget. A *measured* zero correlation is still `0.0`, and a test pins both directions.

**The correlation term is measured over every mapped instrument, collapsed per asset class.**

Three pure functions in `hype_calculator`:

- `per_class_corr` — drops unmeasurable and unclassified tickers, then keeps the **strongest signed** correlation per class. Not the mean: two rates ETFs that both track the theme are one reading of the rates complex, and averaging them against a third that happens to be cash-like understates the class rather than describing it.
- `cross_asset_corr_subscore` — the mean over **measured** classes of `min(1, |c| / CORR_FULL)`. Magnitude and breadth in one number: a theme correlating strongly in four of four classes scores ~1.0; a theme correlating just as strongly in one of four scores ~0.25.
- `representative_corr` — the strongest signed per-class reading, which is what `price_corr` now persists and what `crowding_label` consumes. Crowding is a **directional** claim (co-moving = crowded consensus, inverse = natural hedge) and a breadth average would destroy the sign.

**The denominator counts classes we could MEASURE, never classes we mapped.** This is [ADR-0036](0036-edge-renormalisation.md)'s renormalise-over-what-is-present rule, applied to a second formula. A missing price history must not be scored as an absence of correlation.

**`hype_score` accepts `corr=None` and renormalises over the remaining three components.** When all four are present the arithmetic is **unchanged** — a plain weighted sum, not a renormalised one — because `/method` reproduces that line as `100 × Σ(wᵢ·sᵢ)` from the persisted sub-scores and must keep reconciling byte-for-byte.

`theme_signals_history` gains `corr_by_class`, `corr_classes_material` and `corr_classes_measured` (migration 049), so the literal claim — *"3 of 4 asset classes"* — is readable rather than inferred from a decimal.

## Consequences

- **HypeScores will move on the next run**, in both directions, and the move is a correction rather than a drift. A theme whose first mapped ticker happened to be its strongest correlate will fall (it now averages across the complex); a theme whose first ticker was unmeasurable will rise sharply (it was scoring a data gap as zero).
- `theme_signals_history.price_corr` **changes meaning** without changing name: it was "the first mapped ticker's correlation", it is now "the strongest per-class correlation". Both are one signed number in the same range, so nothing downstream breaks, but a comparison against rows written before today is comparing two different statistics. The column comment says so.
- `price_corr` is now **nullable**, and NULL means *not measurable* rather than *uncorrelated*. `crowding_label` already degrades to `"neutral"` on a non-numeric input, which is the correct reading.
- `themes.corr_score` is likewise nullable. `/method` already renders a null sub-score as *"the arithmetic cannot be reproduced"* rather than as a zero, so that path needed no change — but it means a theme with no measurable correlation shows a reconciliation notice instead of a worked example. That is the honest output.
- **`ASSET_CLASS_MAP` is now exported from `trade_ranker`**, bound to the *same dict object* as `_ASSET_CLASS_MAP` rather than a copy. `build_theme_signals` needs the whole map at once to group a theme's tickers by class, which `classify()` cannot give it one lookup at a time. ADR-0121's failure was two asset-class maps that could disagree; binding the same object means a consumer outside the module cannot acquire a stale snapshot.
- **The correlation is still between mention counts and returns, and still over a 30-day window.** Widening the instrument set does not make the statistic itself stronger: 30 observations is a thin basis for a per-class reading, and a strong correlation across four classes may still be four views of one market factor rather than four independent confirmations. This ADR fixes what the term measures, not how much the term can bear.
