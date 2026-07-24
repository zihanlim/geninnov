# 0038 — Direction is a property of the asset, not of its theme

- **Status:** accepted
- **Date:** 2026-07-24
- **Supersedes (in part):** [ADR-0031](0031-edge-score-direction-signal.md) — EdgeScore
  still sets direction; the unit it is computed on changes from theme to asset.

## Context

The book had produced **zero shorts** for the entire life of the project, and three
separate iterations attacked it as a breadth problem:

- *Ticker breadth* — 24 → 37 tickers, 4–8 expressions per theme. No shorts.
- *Theme discovery* — all six Tier-2 candidates turned out to be rediscoveries of the
  existing anchors. No new breadth at all.
- *Single names* — recorded as the top remaining gap, on the reasoning that single
  companies carry idiosyncratic dispersion so "some fall while their theme rises".

That last line contained the answer and we misread it. Direction was assigned to a
**theme**, and every asset inherited it:

```python
longs  = _expand(_select(positive=True),  theme_assets_map, direction="long")
shorts = _expand(_select(positive=False), theme_assets_map, direction="short")
```

So a single name added to a rising theme would have been stamped long regardless of
its own signal — exactly like the extra tickers before it. Single names could never
have produced shorts either. The constraint was never the universe; it was that the
engine **averaged per-asset signal away and then asked why every asset agreed**.

Four of EdgeScore's five components are natively per-asset or per-asset-class:

| Component | Weight | Natural unit |
|---|---|---|
| Trend | 0.20 | **per asset** — from that ticker's own prices |
| Regime fit | 0.23 | **per asset class** |
| Carry | 0.34 | **per asset class** |
| Value | 0.18 | **per asset class** |
| Sentiment | 0.05 | theme — news is about the theme |

95% of the weight was being averaged across a basket before use. `ret_by_asset` and
`vol_by_asset` were already computed per ticker and then collapsed by `theme_trend`.

The cost was concrete and absurd. **GLD was held LONG inside Fed Policy, Inflation,
US Dollar and Geopolitical Risk simultaneously** — four themes that each averaged to a
positive edge — while GLD's own trend and regime scored it **−0.44**. The book was
long an asset whose every asset-level signal said short, in four places at once.

Re-scoring the existing universe per-asset, with no new tickers and no threshold
change, found **14 short-capable assets and 5 sign flips** against their own themes.

## Decision

**The theme decides what is in scope. The asset decides which way it goes.**

`compute_edge_scores` now also fills `asset_edges[(theme_id, asset)]` with a full
per-asset EdgeScore — its own trend (via the same `theme_trend` squash applied to a
single-asset dict, so the two can never drift apart), its own asset class's regime,
carry and value, and the theme's sentiment. `rank_trade_candidates` takes that map;
`_expand` gives each asset `direction = sign(its own edge)` and drops it when its own
|edge| falls inside the abstention band.

Theme selection is **unchanged** — the hype gate still decides which themes are in
scope, so the attention premise the product rests on is untouched. What changes is
that a theme in scope can now contribute a long *and* a short.

A ticker expressing several themes is deduped to its strongest conviction, or the
book would double-count one position.

Passing `asset_edges` is optional; without it every asset inherits the theme's
direction exactly as before, so existing callers are unaffected.

## Consequences

**The book is two-sided for the first time.** The live 2026-07-24 run produced
**7 long / 2 short across 9 positions** where the previous run produced 3 long / 0
short:

- Long: QQQ +0.49, IWM +0.47, EWJ +0.45, SPY +0.41, EFA +0.41, XLV +0.32, XLF +0.32
- **Short: SLV −0.39, GLD −0.26**
- 66.5% deployed, largest position 12.7%, HHI **564** (was 1243 — materially more
  diversified)

Nothing was loosened to get there. The abstention band, the hype gate, the caps and
the universe are all exactly as they were; the shorts come from signal that was
present in the data and was being destroyed before it could be used.

**It also makes the diagnosis of "single names" correct rather than merely
plausible.** Single companies are now genuinely worth adding, because an asset's own
trend can finally oppose its theme — which is the entire reason idiosyncratic names
were supposed to help. Under theme-level direction they would have added nothing.

**The theme-level score is retained**, not replaced: it still drives the `/` heatmap
and the abstention roster, which are statements *about themes* and remain correct as
such. Only position direction moves to the asset.

**Watch the sentiment component.** It is the one genuinely theme-wide term, so at
0.05 weight it now applies uniformly to assets that disagree with each other. That is
defensible — news sentiment really is about the theme — but it means an asset's score
is not fully independent of its theme, and a future IC study should check whether
sentiment deserves to be per-asset too.

**Cost.** `compute_edge_scores` and `rank_trade_candidates` gained an optional
parameter; `_expand` gained per-asset direction and abstention. Four new tests cover
the behaviour that had no coverage: an asset taking the opposite side to its theme, an
asset abstaining on its own edge inside a strong theme, one ticker deduped across
themes to its strongest view, and the legacy theme-direction path still working.
392 backend tests green.
