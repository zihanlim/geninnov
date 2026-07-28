# ADR-0139: A dollar-debasement pressure reading on the regime row

**Status:** Proposed
**Date:** 2026-07-28
**Related:** [ADR-0041](0041-regime-as-a-dial-not-a-cliff.md), [ADR-0091](0091-breadth-must-be-a-share-of-something-named.md), [ADR-0127](0127-the-cross-asset-term-measured-one-asset.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0137](0137-basis-points-are-not-a-hundredfold-error.md), [ADR-0140](0140-hawkish-dovish-pivot-indicator.md)

## Context

`/book` carries one macro reading — `RegimeHero` reading `regime_classifications.cycle` × `sentiment` — and that reading is silent on **monetary erosion**. A book can be marked `late-cycle, risk-off` while the dollar is being structurally weakened by a real-yield collapse and a sovereign-debasement hedge bid in gold; the current row cannot say so, because the current row was never asked to. The narrative tracker can surface "dollar debasement" as an n-gram (ADR-0128), but that is evidence a *narrative* exists, not a measurement of the underlying pressure.

`brave_client.THEME_COVERAGE_ALIASES["US Dollar"]` carries the cyclical dollar (`dollar`, `usd`, `dollar index`, `greenback`, `euro`, `yen`, `forex`) and the `THEME_KEYWORDS` line still says `["US dollar", "DXY", "currency", "FX", "dollar weakness", "dollar strength"]` — explicitly NOT the fiscal / de-dollarisation / gold-as-reserve framing that makes debasement a distinct narrative. [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md) cited this exact gap as its motivating example: *"the fiscal / de-dollarisation / gold-as-reserve framing that makes debasement a distinct narrative is asked for by nothing."*

The data needed to measure it, however, is already on disk. `macro_daily_history` already carries:

| Series | Already fetched | What it tells us about debasement |
|---|---|---|
| `DFII10` (10y real yield) | yes, `macro_fetcher.py:36` | Negative real yields are the textbook debasement channel — a holder of nominal USD assets is paid to tolerate erosion |
| `DX-Y.NYB` (DXY dollar index) | yes, `macro_fetcher.py:69` | A weaker dollar against the major basket is the symptom |
| `GC=F` (gold futures, USD) | yes, `macro_fetcher.py:70` | Gold is the debasement hedge of record — rising gold with stable real yields is *not* debasement pressure, but rising gold with falling real yields is the textbook co-move |

So this is not a data-acquisition problem. It is a *what do we say about it* problem.

## Decision

**Add a `debasement_pressure` reading (0–100) to `regime_classifications`, with four component columns and the lookback as provenance.** One row, six new columns — five nullable, plus a NOT NULL lookback with a default. No new tables.

### 1. The reading

```
debasement_pressure = clip(
    30 * real_yield_component
  + 25 * dxy_decline_component
  + 25 * gold_rise_component
  + 20 * co_movement_component,
  0, 100)
```

Component definitions, all bounded to [0, 1]:

| Component | Formula | Why this form |
|---|---|---|
| `real_yield_component` | `clip(−DFII10_pct / 2.0, 0, 1)` | `DFII10_pct` is the stored FRED value **in percent** (−2% is `−2.0`). Real yield at −2% or below maps to 1.0; at 0% or above to 0.0; one-sided because debasement pressure is the *negative-real-yield* tail |
| `dxy_decline_component` | `clip(dxy_drawdown_26w / 0.05, 0, 1)` | `dxy_drawdown_26w = (peak_26w − DXY_t) / peak_26w`, a fraction. DXY 5%+ below its rolling 26-week peak → 1.0; at or above the peak → 0.0. Drawdown from the peak, NOT change vs t−26w: a round trip that ends where it started is not sustained dollar weakness |
| `gold_rise_component` | `clip(gold_return_26w / 0.20, 0, 1)` | `gold_return_26w = (Gold_t − Gold_{t−26w}) / Gold_{t−26w}`, a fraction. Gold up 20%+ over 26 weeks → 1.0; flat or down → 0.0; one-sided |
| `co_movement_component` | `clip(−corr(ΔDFII10_daily, ΔGold_daily; 26w) / 0.50, 0, 1)` | The diagnostic — gold rising *because* real yields are falling is the debasement-hedge signature; gold rising while real yields rise is some other story. Computed on **daily** changes (~130 pairs in the window), not weekly (~26): at n≈26 the standard error of r is ≈0.2 and the 0.50 normaliser is reachable by noise alone. Fewer than 60 paired observations → this component is NULL, and the composite with it |

Units are declared, not assumed — ADR-0137's lesson, one layer up: `DFII10_pct` is the value as stored in `macro_daily_history` (**percent**), while the DXY drawdown and gold return are **fractions** computed from price levels. An implementation feeding the stored percent into a decimal anchor would saturate the component at 0 or 1 forever, and the shadow-period bounds test would never catch it because a saturated value is still in bounds.

Weights are hand-coded (30 / 25 / 25 / 20) and live in the function body, not config. Per ADR-0013 the L0–L4 layer is deterministic and the threshold is part of the audit trail — moving it should require a code change and a re-run, not a Supabase update.

### 2. The schema change

```sql
-- 052_dollar_debasement_indicator.sql (plan)
ALTER TABLE regime_classifications
    ADD COLUMN IF NOT EXISTS debasement_pressure REAL
        CHECK (debasement_pressure BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS debasement_real_yield_comp REAL
        CHECK (debasement_real_yield_comp BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS debasement_dxy_decline_comp REAL
        CHECK (debasement_dxy_decline_comp BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS debasement_gold_rise_comp REAL
        CHECK (debasement_gold_rise_comp BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS debasement_comovement_comp REAL
        CHECK (debasement_comovement_comp BETWEEN 0 AND 1),
    ADD COLUMN IF NOT EXISTS debasement_lookback_weeks INT NOT NULL DEFAULT 26;
```

A composite plus four component columns, not one opaque number. The composite alone is a black box; per ADR-0091 a reading must be a share of something named, and the components are what is being shared against. The four-component shape also lets a reader audit *why* the reading moved — was it real yields or was it DXY?

### 3. The classifier change

`regime_classifier.RegimeOutput` gains five new fields (`debasement_pressure`, four components; the lookback is a constant stamped at persist). `classify()` reads `DFII10`, `DX-Y.NYB`, `GC=F` from `macro_daily_history` with the same `as_of` bound the cycle/sentiment reading already uses (the look-ahead fix from `regime_classifier.py:67`); the 26-week window is computed only from observations dated on or before `run_date`. The composite is then written into the new columns on the same `regime_classifications` row.

NULL semantics follow ADR-0091: a missing input → NULL on the composite AND NULL on the components that depend on it, NOT zero. A reader of the page will see "debasement pressure: —" on a row where DXY is missing, which is honest, rather than "debasement pressure: 17" because gold and real yields alone happened to add to 17.

### 4. The UI change

A `MacroCrossCurrents` component on `/book`, immediately under `RegimeHero`. Three cards:

- **Debasement pressure** — the 0–100 number, the four components as a stacked bar (each in its own band, no legend required), and the 26-week lookback as a caption. An **Inputs** line carries the raw readings — DFII10, DXY against its 26-week peak, the 26-week gold return — so a reader who rejects the weighting can re-derive a view from the same card. Same provenance rule as `RegimeHero`: if the composite is NULL, the card shows "—" and names the missing input.
- **Fed posture** — the indicator from [ADR-0140](0140-hawkish-dovish-pivot-indicator.md), its week-over-week delta, and the rolling window.
- **Cycle × posture matrix** — a 2×4 readout making the (cycle, posture) pair explicit, since these are now THREE independent readings (cycle, posture, debasement) and conflating them is how the current page implies "late-cycle" when the question on the reader's mind is "is the dollar being eroded."

This component is the only place these three readings are presented together. `RegimeHero` continues to show cycle × sentiment as it does today.

### 5. Shadow mode

First 14 days after rollout: the columns are written but `MacroCrossCurrents` is NOT mounted, **and the columns are stripped from the L5 input snapshot**. The second gate is the one that matters: `q1_agent` reads the regime row with `select("*")` and freezes the whole dict into the snapshot the LLM reasons over (`q1_agent.py:645,651`), so without an explicit exclusion the model could cite `debasement_pressure` on day one of the shadow, before the harness has passed it — ADR-0100's lesson that a guard living in one component guards one consumer. (`/ask` and MCP are safe by construction: the `regime` tool projects named columns.) One exclusion list covers this ADR's columns and ADR-0140's; lifting it is the same change that mounts the panel.

The shadow period is for the existing test harness to assert that (a) `debasement_pressure` is between 0 and 100, (b) it is NULL when an input is missing, (c) the weighted sum of components matches the composite within a documented tolerance for floating-point ordering, and (d) the co-movement correlation was computed against enough paired daily observations (≥ 60; the regime classifier's breadth refuses a moved denominator for the same reason — `MIN_UNIVERSE = 8` of 11). Only after those tests pass does the panel mount.

The 14-day window is ~10 pipeline runs — enough real rows to exercise the NULL paths and the bounds, short enough that the shadow is visible on the next release. What it validates is **shape, not correctness**: bounds, NULL semantics, arithmetic consistency. No two-week window can validate a 26-week reading's signal quality, and this ADR does not claim one does.

### 6. L5 prompt line

Once the shadow lifts, `debasement_pressure` is an L0–L4 key like any other and the citation guardrail (ADR-0012) needs no new rule. The prompt gains the mirror of ADR-0140's line: *"If you claim dollar debasement, cite `debasement_pressure`; if it is NULL, you may not make a debasement claim."* During the shadow the key is absent from the snapshot, so the claim is impossible rather than merely forbidden.

## Consequences

- **Six new columns on the regime row, no new tables.** Frontend reads `regime_classifications` exactly as it does today; the new columns are additional projections in the `MacroCrossCurrents` fetch (`RegimeHero` is unchanged).
- **The reading is a dial, not a flag.** `> 70` is not "debasement is happening" — it is "the components sit near the top of their fixed, hand-coded anchors". The page will label bands (`low / moderate / elevated / extreme`) as presentation only; the bands live in the component, not the schema. (An earlier draft said the page would reuse the cycle vocabulary — a pressure dial and a business-cycle stage are different questions, and one vocabulary would conflate them.)
- **The 26-week lookback is hard-coded.** Choosing 52 weeks would catch slower trends but halve responsiveness; 13 weeks would chase noise on gold. 26 sits between the L1 momentum window (4w) and the L3 breadth window (200d MA). Changing it is a code change and a re-run of the shadow period.
- **NULL is the right answer for missing data.** A Supabase client reading `debasement_pressure` and seeing `0` would conclude "no pressure". A reader of the same row seeing `NULL` would conclude "we cannot say". ADR-0091's precedent is that we have been wrong about this kind of zero before.
- **Gold is a noisy series and 26w is short for it.** A geopolitical spike moves gold 10% in a week; the 26w window absorbs it but does not erase it. The co-movement component exists to discount a gold move that is NOT being driven by real yields — that is precisely the case where a gold-only signal would mis-fire.
- **DXY decline and gold rise co-move mechanically, and that overlap is accepted, not fixed.** A weaker dollar IS rising gold in many regimes, so those two components are correlated inputs carrying 50 of the 100 points between them. The co-movement term does NOT decouple them — it conditions on a *different* pair (gold vs real yields), and what it buys is the ability to discount a gold move that real yields are not driving (a geopolitical bid, say). A version that wanted to remove the double-count would residualise gold on DXY; this ADR deliberately does not, because a fitted residual is one more object a reader cannot audit. The cost — dollar-weakness episodes score somewhat higher than a decorrelated design would score them — is disclosed here instead.
- **This does not change `cycle` or `sentiment`.** Debasement pressure is presented next to them, not folded into them. A reader of `/book` who has come for the cycle call gets the cycle call unchanged.
- **The component thresholds are deliberately round.** `−2%` real yield and `5%` DXY decline are easy to defend in a meeting and easy to grep in the code. The exact constants would be better fitted, but a fitted constant is not auditable — the alternative is documented as an alternative (below).
- **Migrating historical rows.** Historical rows are backfilled by the CLASSIFIER, not by SQL: migration 052 deliberately defers the backfill, because a second implementation of the formula in SQL would silently drift from the Python on the next threshold change. The vehicle already exists — `scripts/backfill_regime.py` calls `classify()` per historical `run_date` with the `as_of` bound; the new columns ride the same path. A reader who scans the regime row chronologically expects a continuous series; NULLs on the backfill would read as a one-day pipeline failure rather than a deliberate rollout, so the backfill runs before the panel mounts.
- **This is a disclosed judgement, not a calibrated signal.** The weights, anchors and window are argued, not fitted; the shadow validates shape, not correctness. That is the same standing as the regime classifier's own hand-coded thresholds (`VIX > 25`, `breadth < 40`), and the same honesty: if the composite is ever claimed to *predict* anything, that claim must come from a measurement over accrued history, in its own ADR.

## Alternatives considered

- **A separate `debasement_pressure` table.** Rejected — every other reading on the page lives on `regime_classifications` and the regime row is the only place the page reads from. A second table forces a second join on `/book` and a second piece of freshness plumbing, with no gain — the reading is one number with provenance columns, exactly like `yield_curve_slope` / `hy_oas` already are.
- **A fitted component weight vector.** Rejected — the 30/25/25/20 split is a judgement, not a measurement, and shipping a fitted vector would imply it was measured. An IC-style backtest on a 26-week rolling window over 5 years of history would produce a number; it would not tell us whether the number generalises. Round numbers with hand-coded weights are greppable and arguable. There is also nothing to fit ON: the 26-week window overlaps itself almost entirely day to day — a year of daily rows is roughly two independent observations — and no labelled "debasement" target exists to regress against.
- **Ship the raw inputs only — no composite — and let a composite earn its place after N publications.** Partially absorbed: the card carries an Inputs line (§4) precisely so the evidence is readable without the weights. Rejected as the whole answer, twice over. First, the reading's distinctive content is a *conjunction* — gold rising WHILE real yields fall — and a reader cannot eyeball a correlation off two sparklines; inputs-only outsources exactly the computation the row exists to perform. Second, "fit the weights after 30–60 publications" founders on the overlap problem above: 60 daily observations of a 26-week rolling statistic are not 60 samples. Cycle × sentiment shipped as hand-coded rules for the same reason; this row follows that precedent with the judgement disclosed.
- **Real yield only, no gold.** Rejected — a real-yield-only signal fires every time the Fed eases into a recession, including episodes where the dollar strengthened on rate-differential flows. Without gold (or another confirmation term) the signal would fire too often to be useful.
- **A separate `dollar_debasement` theme.** Rejected — themes carry mapped instruments, a HypeScore, an EdgeScore, and a position. "Dollar debasement" is a *condition on the macro state*, not a tradable idea — there is no long-debasement or short-debasement trade that the book would put on. The narrative tracker can surface the phrase, and an operator can promote it to a theme if a tradable framing emerges, but the regime reading is the right level of abstraction today.
- **Use gold miners (GDX) instead of gold futures.** Rejected — `cot_fetcher.py:23` documents that *"positioning in gold futures is not positioning in miners"*, and the same reasoning applies to a debasement reading: a 5% gold move and a 20% gold-miners move are not the same fact, and the debasement hedge is the metal, not the equity.
- **A 52-week or 13-week window.** Rejected — 52w lags the cycle too far to be useful on a daily publication; 13w puts too much weight on a single quarter of DXY. 26w is one full option cycle and one Fed meeting cadence, which is the natural frequency for a "structural pressure" claim.
