# ADR-0140: A hawkish/dovish-pivot reading on the regime row

**Status:** Proposed
**Date:** 2026-07-28
**Related:** [ADR-0031](0031-edge-score-direction-signal.md), [ADR-0041](0041-regime-as-a-dial-not-a-cliff.md), [ADR-0091](0091-breadth-must-be-a-share-of-something-named.md), [ADR-0128](0128-a-theme-we-did-not-name-in-advance.md), [ADR-0139](0139-dollar-debasement-indicator.md)

## Context

The `Fed Policy` theme is the only macro theme that the L1 attention layer actively scores, and it is the only theme whose narrative — "hawkish", "dovish", "rate cut", "rate hike", "Powell", "FOMC meeting" — has a directional claim embedded in the *language itself*. Every other theme is attention-and-sentiment; Fed Policy is attention and a *posture*. Yet the regime row carries no posture field. `cycle` × `sentiment` is the only reading, and it is silent on whether the Fed is tightening, easing, or about to pivot.

The Q1 reasoning agent can — and does — cite Fed posture inside a thesis ("the Fed is at the upper bound, the next move is a cut"), but it does so as LLM prose that has to be citation-verified against the L0–L4 snapshot (ADR-0012). A reader of `/book` who wants the posture as a *measurement* — not as a sentence in a thesis — has to read the prose and reverse-engineer it. That is the wrong direction of effort: posture is something the system should be able to *say*, not just *narrate*.

The data needed to measure a posture is partially on disk:

| Series | Already fetched | What it tells us about posture |
|---|---|---|
| `DFF` (Fed funds effective rate) | yes, `macro_fetcher.py:34` | The current stance — where the policy rate *is* |
| `DGS2` (2y Treasury yield) | yes, `macro_fetcher.py:32` | The market's view of where the policy rate is *going* over the next 1–2 years; 2y moves on Fed expectations more than on term premium |
| `DGS10` (10y Treasury yield) | yes, `macro_fetcher.py:31` | The longer-run anchor; the 2s10s spread separates near-term posture from neutral |
| `DGS30`, `DGS5` | yes | Available for triangulation, not used in this ADR's headline reading |

What is **not** on disk is fed funds futures. The textbook pivot signal is CME FedWatch — the implied path of the DFF over the next N meetings, derived from fed funds futures — and that source is a third-party API behind a separate credential. This ADR routes around that gap: the 2y/10y curve shape and the recent trajectory of DFF together encode the same information the futures path would, with a delay and a noise penalty documented below.

## Decision

**Add a `fed_posture` (hawkish/neutral/dovish), a `fed_pivot_delta` (signed integer in the −2..+2 range), three provenance columns, and an evidence JSONB to `regime_classifications`.** One row, six new nullable columns. No new tables.

### 1. The reading

The posture has three components, all bounded:

| Component | Formula | What it captures |
|---|---|---|
| `fed_rate_change_13w` | `DFF_t − DFF_{t−13w}`, in basis points (multiplied by 100) | Recent direction of policy — is the Fed actively hiking, actively cutting, or holding? |
| `curve_steepness_bps` | `(DGS10 − DGS2) × 100` at `t` | Market-implied posture — a steep curve says the market expects cuts; an inverted curve says the market expects hikes or holds |
| `curve_change_13w` | `curve_steepness_bps_t − curve_steepness_bps_{t−13w}`, in bps | Direction of market-implied posture over the same window |

A point in the (rate change, curve change) plane maps to one of three postures:

| `fed_rate_change_13w` | `curve_change_13w` | `fed_posture` |
|---|---|---|
| `> +25 bps` | any | `hawkish` |
| `< −25 bps` | any | `dovish` |
| `≤ +25 bps` AND `≥ −25 bps` | `> +15 bps` (curve steepening) | `dovish` |
| `≤ +25 bps` AND `≥ −25 bps` | `< −15 bps` (curve flattening) | `hawkish` |
| otherwise | otherwise | `neutral` |

The curve rows follow the component table above: with the policy rate on hold, a steepening 2s10s is the market pricing cuts — a **dovish** read — and a flattening or inverting curve is the market pricing hikes or a longer hold — **hawkish**. (An earlier draft had these two rows inverted, against its own component definitions. Since DFF sits inside the ±25 bps band most of the time, the curve leg decides most days, so the inversion would have flipped the label precisely when it mattered.) The rate-leg inequalities are strict on purpose: a single 25 bp step over a window spanning ~2 FOMC meetings lands *on* the threshold and falls through to the curve test — one cut can be a mid-cycle adjustment; a posture is more than one meeting's move.

A *pivot* is then:

```
sign(dovish) = +1    sign(neutral) = 0    sign(hawkish) = −1
fed_pivot_delta = sign(fed_posture_t) − sign(fed_posture_{t−13w})
```

The sign convention is written down because it is the opposite of the hawkish-is-positive many readers assume: dovish is `+1` so the pivot's sign agrees with the page's directional ink below (dovish = easing = `--long`), and `+2` = hawkish → dovish, the textbook landing. `fed_posture_{t−13w}` is the posture on the most recent `regime_classifications` row dated **on or before `run_date − 13 weeks`** — not yesterday's row. Against yesterday, the delta would be non-zero only on the single day a label flips, and a daily reader would miss it; against t−13w it reads "the net posture change over one FOMC cycle" and stays visible for the 13 weeks a pivot is news. The 13-week window is chosen to match the FOMC meeting cadence (eight meetings per year, ~6.5 weeks between them) — a longer window would smooth across meetings the reader is meant to see.

`fed_posture_evidence` is a JSONB blob of the three components plus the prior posture, written so the page can render "Hawkish → Dovish (curve steepened 38bps, DFF −25bps)" without a second round-trip.

### 2. The schema change

```sql
-- 053_hawkish_dovish_pivot_indicator.sql (plan)
ALTER TABLE regime_classifications
    ADD COLUMN IF NOT EXISTS fed_posture TEXT
        CHECK (fed_posture IN ('hawkish', 'neutral', 'dovish')),
    ADD COLUMN IF NOT EXISTS fed_pivot_delta SMALLINT
        CHECK (fed_pivot_delta BETWEEN -2 AND 2),
    ADD COLUMN IF NOT EXISTS fed_rate_change_13w_bps REAL,
    ADD COLUMN IF NOT EXISTS fed_curve_change_13w_bps REAL,
    ADD COLUMN IF NOT EXISTS fed_curve_steepness_bps REAL,
    ADD COLUMN IF NOT EXISTS fed_posture_evidence JSONB;
```

The pivot is a SIGNED integer, not a boolean. "Did posture change?" is half the question; "from what to what?" is the other half, and a boolean would force the reader to look at two adjacent rows to recover it.

### 3. The classifier change

`regime_classifier.RegimeOutput` gains five fields mirroring the columns. `classify()` reads `DFF`, `DGS2`, `DGS10` from `macro_daily_history` with the `as_of` bound every other reading in the file already uses. The 13-week window is computed only from observations dated on or before `run_date`. The comparison posture — needed for `fed_pivot_delta` — is read from the most recent `regime_classifications` row dated on or before `run_date − 13 weeks`; if no such row exists, or its `fed_posture` is NULL, the delta is NULL.

NULL semantics follow ADR-0091 and ADR-0139: a missing DFF, DGS2, or DGS10 → NULL on the entire posture row, NOT a default of `neutral`. A reader of `/book` should never see "neutral" when the truth is "we could not say".

### 4. The UI change

The posture card sits inside the `MacroCrossCurrents` component from [ADR-0139](0139-dollar-debasement-indicator.md), immediately under the debasement card. Three lines:

- **Posture** — the label (`Hawkish` / `Neutral` / `Dovish`) plus the trajectory icon (`↑` steepening, `→` unchanged, `↓` flattening) so the reader sees posture AND direction in one glance
- **Pivot delta** — the signed integer with a one-line caption ("Hawkish → Dovish", "Steepened 38 bps in 13 weeks", etc.)
- **Inputs** — DFF, DGS2, DGS10 in the same `formatSlopeBps`-style unit convention the rest of the row uses, so a reader does not have to remember which column is in bps and which is in percent

If `fed_posture` is NULL, the card says so and names the missing input — same rule as `RegimeHero` and the debasement card.

### 5. Shadow mode

Identical structure to [ADR-0139](0139-dollar-debasement-indicator.md): columns are written for 14 days, the panel is NOT mounted. The shadow test suite asserts that (a) `fed_posture` is one of the three valid values when all three inputs are present, (b) NULL when any input is missing, (c) `fed_pivot_delta` is consistent with the posture on the comparison row at t−13w, (d) `fed_rate_change_13w_bps` equals `100 × (DFF_t − DFF_{t−13w})` within a tolerance for missing intermediate observations. Only after those tests pass does the panel mount.

Identical scope, too: the shadow must cover every consumer (ADR-0100). `q1_agent` freezes the whole regime row into the L5 snapshot via `select("*")`, so during the shadow these columns join ADR-0139's on the snapshot exclusion list — otherwise a published thesis could cite a posture the harness has not yet passed. And the shadow validates **shape, not correctness** — valid labels, NULL semantics, delta consistency, bps arithmetic — not whether the posture is *right*: no two-week window can validate a 13-week reading's signal quality.

### 6. L5 thesis guardrail update

The Q1 agent's citation guardrail (ADR-0012) does NOT need a new rule for posture citations — the model's existing instruction to cite L0–L4 keys still applies, and posture becomes an L0–L4 key the day the shadow lifts (until then the key is absent from the snapshot — §5 — so a pivot claim is impossible rather than merely forbidden). The model's prompt DOES need one line: *"If you claim the Fed is pivoting, cite `fed_posture` and `fed_pivot_delta`; if those columns are NULL, you may not make a pivot claim."* Without that line, a model can still write "the Fed is at an inflection point" without citing the new columns, and the guardrail's existing reconciliation has no way to fault it.

## Consequences

- **One new column set on the regime row, no new tables.** Same architectural footprint as [ADR-0139](0139-dollar-debasement-indicator.md). The two readings are designed to ship together because they share the `MacroCrossCurrents` UI surface and the same shadow-period schedule.
- **The 2y/10y spread is a noisy proxy for the futures-implied path.** The textbook signal is fed funds futures, and we are deliberately not fetching them. The cost is documented: a Fed pause that the futures market prices as "one cut by year-end" can look like `neutral` here, because the 2y does not fully reflect that path until the cut is two meetings away. A reader who needs the sharper signal is pointed to the FedWatch page; the regime row says "what is on disk".
- **The `+25 bps` and `±15 bps` thresholds are hand-coded.** Same precedent as ADR-0139 — a fitted threshold is not auditable, and the round numbers survive a meeting. A reader can disagree with the threshold and a code change + re-run can move it; that is the right granularity for a daily publication.
- **The 13-week pivot window is one FOMC meeting cadence plus a buffer.** Shorter would chase a single meeting's signal-to-noise; longer would smooth across meetings the reader is meant to see. A reader who wants a slower read can difference `fed_curve_steepness_bps` across published rows — the snapshot column exists precisely so longer windows are *derivable* from the series rather than promised by this ADR; the headline number stays at 13 weeks.
- **The L5 prompt change is unverifiable until the next run.** Like every instruction to a model (ADR-0137 stated this for the bps fix). The reconciliation is what makes that acceptable: the new prompt line is short, specific, and impossible to follow without citing the new columns.
- **`hawkish` / `dovish` reuse the page's directional ink.** The page already uses `--long` and `--short` for *book direction* (a position sign, ADR-0085). The posture colours reuse the directional vocabulary deliberately: `--long` for dovish (loose financial conditions), `--short` for hawkish (tight), neutral-grey for neutral. This is a CONSISTENT signal across surfaces — a hawkish posture and a short book are the same shade of red on this page, because both are a "less financial liquidity" claim.
- **The comparison posture is read from `regime_classifications`, not stored redundantly.** The pivot delta is computed against the row at t−13w (§1), not against a second column on the same row. If that row's `fed_posture` is NULL — or no row that old exists, as in the first 13 weeks after rollout unless the backfill has run — the pivot delta is NULL: "no prior posture" is not "no pivot", and the two are different absences.
- **The pivot is not the same as a change in posture.** `fed_pivot_delta = 0` and posture changed from `neutral` to `hawkish-then-back-to-neutral` is the kind of case this ADR refuses to surface, by design. A reader who wants the full path can read `fed_posture_evidence`; the headline reading is the net change, which is what a publication needs.
- **The thresholds are a disclosed judgement, not a calibration.** `+25 bps` is structural (one FOMC step); `±15 bps` and 13 weeks are argued, not fitted — the same standing as the regime classifier's `VIX > 25`. If the posture is ever claimed to *predict* anything, that claim must come from measurement over accrued history, in its own ADR.

## Alternatives considered

- **Fetch fed funds futures (CME FedWatch).** Rejected for this ADR — the data source is a third-party API behind a separate credential, the procurement and reliability cost is non-trivial, and the 2y/10y proxy covers ~80% of the cases at a fraction of the integration cost. The constraint is the project's data posture, not a procurement punt: every L0 source is free and keyless or free-with-a-key (`cot_fetcher` is the precedent), CME derivatives data is neither, and scraping the FedWatch page is a ToS-fragile dependency under a nightly publication. A future ADR can add it as an additional component to `fed_posture_evidence` without changing this ADR's column shape.
- **Ship the three inputs with no label.** Rejected for the reason ADR-0139 rejects inputs-only: the label is a conjunction — rate trajectory × curve repricing against a stated threshold table — and saying it is the row's job. The inputs are on the card (§4), so a reader who rejects the mapping can re-derive a posture from the same line.
- **A pivot-only signal, no posture.** Rejected — posture without pivot is a snapshot, pivot without posture is a delta with no anchor. A reader needs both to interpret either: "the Fed pivoted" is uninformative without "from hawkish to dovish", and "the Fed is dovish" is uninformative without "and was hawkish 13 weeks ago".
- **Use the 3m–10y spread instead of 2s10s.** The 3m–10y spread is the Fed's own preferred recession indicator and is sometimes argued to be a cleaner policy-expectations proxy. Rejected — the 3m Treasury (`DGS3MO`) is on FRED but not currently in our `FRED_SERIES` table; adding it is a one-line change but a downstream consumer (the regime classifier) does not need it for any other purpose, so the marginal value is low. 2s10s is on disk and matches the verbal cadence of the narrative tracker.
- **A fitted posture threshold (e.g. logistic on historical NBER recession dates).** Rejected — same reasoning as ADR-0139: a fitted threshold is not auditable. The `+25 bps` and `±15 bps` constants are round, defensible, and traceable to a code comment.
- **A binary `is_pivot` column.** Rejected — see above. The signed integer preserves the magnitude and direction of the pivot in a single column, and `is_pivot` is recoverable as `fed_pivot_delta != 0` if a downstream consumer needs the boolean.
- **Reuse `cycle` to encode posture.** Rejected — `cycle` is an *output of the regime classifier*, with a four-value vocabulary chosen for the business-cycle reading (early/mid/late/recession). Conflating cycle with posture is the same class of error that produced the single-ticker breadth reading (ADR-0091): one column carrying two questions, neither of which a reader can interrogate.
