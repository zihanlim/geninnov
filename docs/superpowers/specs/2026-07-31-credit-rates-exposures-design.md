# Credit and duration exposures (L2b) -- design

**Date:** 2026-07-31
**Status:** design approved, spec under review
**Sub-project:** F of D -> F -> S -> B -> W
**ADR:** 0190 (to be written with the implementation)
**Migration:** 060

---

## 1. Why

An external PM critique was verified on 2026-07-30
(`research/20260730_222516_andromeda_pm_review/corrections.md`). Most of its specific
claims did not survive. Two did, and this spec addresses the second and less remarked of
them:

> `factor_fetcher.py` is FF5+UMD only. No credit or rates factor exists anywhere in the
> repo. **TRUE.**

The consequence is that every position in the book -- including the entire rates sleeve and
every credit ETF -- enters risk, sizing, scenarios and attribution as an *equity-beta
object*. A credit PM's first question about any position is what its spread and rate
sensitivity are, and that question has no answer anywhere in the stack today. Switching the
L5 `lens` to `credit` does not produce one: the lens filters the candidate pool, it does not
change the risk model.

Concretely, TLT is currently described to the reader by a small equity market beta, an SMB
tilt and an HML tilt. All three are true and none is useful. Its duration -- the number that
actually explains its returns -- is measured nowhere.

This is the enabling sub-project for the two that follow. S (a fallen-angel stress scenario)
transmits through these betas rather than through hand-set per-asset shocks. B (publishing
the credit-lens book) needs them so that a published credit book does not report its risk in
SMB and HML.

## 2. Scope

**In:** a new service that estimates per-asset sensitivity to duration, broad credit and
quality-premium moves; a table to hold it; a macro backfill script; an acceptance fixture
with the right answers written down in advance.

**Out, deliberately:**

- **Any UI.** Deferred to B, which restructures the surfaces these betas belong on. Building
  a `/risk` section now means building it twice.
- **Any sizing, scenario or book-metric consumption.** See section 8.
- **An issuer concept.** This measures ETFs and equities. It does not create single-name
  credit, CDS, or a rating field. The first surviving claim of the critique -- that the
  universe cannot express a credit book -- is not addressed here and is not claimed to be.
- **Analytic spread duration.** See section 10.

## 3. Placement

New module `backend/services/credit_rates_exposures.py`.

Named to match the table, for the reason given in section 6: a duration leg is not credit, and
the argument that rejects `credit_exposures` as a table name rejects it as a module name too.

`backend/data/` holds things that reach outside the system: `brave_client`, `gdelt_client`,
`macro_fetcher`, `factor_fetcher` (downloads Ken French), `cot_fetcher`. `backend/services/`
holds things that compute over data already in the database: `narrative_tracker` reads
`market_news`, `regime_classifier` reads macro rows, `book_metrics` reads the sized book.

This module downloads nothing. `DGS10`, `BAMLC0A0CM` and `BAMLH0A0HYM2` already land in
`macro_daily_history` nightly via `macro_fetcher`. So it belongs in `services/`.

Two further consequences of that placement, both intended:

1. It fails independently of Ken French. The FF5 download has failed silently before -- the
   `factor_fetcher` docstring records that "the whole L2 factor layer silently produced
   nothing: the download failed, the parser returned an empty frame, `compute_exposures`
   returned {}". The credit block must not inherit that failure mode for the *total* variant,
   which needs no FF5 data at all.
2. It is a pure function of (asset returns, macro series) and therefore fully testable with
   no network.

It imports `rolling_regression` from `backend/data/factor_fetcher.py`. There is to be exactly
one regression implementation in this repo; a second copy is the defect this import prevents.

## 4. The factor block

Three legs. All differenced day over day, all expressed in **basis points**, all signed so
that **positive means worse for a bond**.

| Leg | Series | Construction | Reads as |
|---|---|---|---|
| `d_ust10` | `DGS10` | diff x 100 | duration / rate level |
| `d_ig` | `BAMLC0A0CM` | diff x 100 | broad credit risk premium |
| `d_qual` | `BAMLH0A0HYM2` - `BAMLC0A0CM` | diff x 100 | distress / quality premium |

FRED reports all three in percent (2.69 = 2.69% = 269bp), as `macro_fetcher`'s own comment
warns. The x100 is the percent-to-bp conversion and must not be applied twice.

**Why this decomposition and not HY + IG raw.** HY OAS and IG OAS move together at roughly
rho 0.9. Including both raw reproduces, between the two credit legs, exactly the
multicollinearity problem section 5 exists to solve. Decomposing into a level (IG) and a gap
(HY - IG) separates "credit is repricing" from "quality is repricing" and leaves the two legs
far less correlated.

**Why a duration leg at all**, when the critique asked for credit. Three reasons. The rates
sleeve is currently invisible to the risk model and is a large part of any credit book.
Credit ETF returns are jointly driven by rates and spreads, so estimating spread sensitivity
without controlling for rates attributes rate moves to spreads. And -- decisively -- duration
is the only leg with a known correct answer, which is what makes section 9 possible.

**Scaling.** Betas are scaled to percent return per 100bp move. `-beta_ust10` therefore reads
directly as effective duration in years.

## 5. Two variants, stored together

The statistically clean construction and the number a credit PM recognises are not the same
number. Both are computed and both are stored, each carrying its method and basis. This is
the `frontend/lib/risk/varMethods.ts` pattern (ADR-0082): four VaRs shown side by side,
differing by method, horizon and basis, with one statement of what is genuinely comparable.

### 5.1 Total (univariate)

Three separate simple regressions, one per leg:

```
r_asset = alpha + beta_leg * leg + epsilon
```

This is the interpretable figure. `-total_beta_ust10` is empirical effective duration;
`-total_beta_ig` is empirical spread duration. These are the numbers that can be checked
against published fund data.

They are **total, not marginal**: they include whatever the equity factors would also have
explained. A scenario that shocks both the market factor and spreads while using total betas
double-counts the loss. **The total variant must never drive a scenario.** This constraint is
stated in the module docstring, in the ADR, and in the payload.

### 5.2 Marginal (orthogonalised)

Each leg is first regressed on the six FF5+UMD factors and the residual retained:

```
leg_t = a + b . FF5UMD_t + resid_leg_t
```

`resid_leg` is by construction orthogonal to every FF5+UMD factor -- it is the part of the
credit or rate move that equity factors do not explain. The three residuals then enter one
joint regression:

```
r_asset = alpha + b . FF5UMD + b_ust10 * resid_ust10 + b_ig * resid_ig + b_qual * resid_qual
```

Two properties follow, and both are the point:

- No multicollinearity with the equity factors, so the estimates are stable.
- **The existing published FF5+UMD betas do not move.** Appending raw delta-OAS to the
  existing regression would shift every published `beta_mkt` in `factor_exposures`, which is
  an ADR-0093 event ("a published book that changes must say so"). Orthogonalising avoids
  creating that obligation rather than discharging it.

The marginal variant is what S will later transmit shocks through.

### 5.3 Reporting them together

Wherever both appear, each carries its method id and basis, plus one reconciliation sentence:
the total includes co-movement with equity factors and the marginal excludes it, so for a
name whose credit sensitivity is mostly just equity beta the two diverge sharply, and for a
pure-duration instrument they nearly agree. The gap is a finding, not an error.

## 6. Storage

New table, migration `060_credit_rates_exposures.sql`.

**Name:** `credit_rates_exposures`. Not `credit_exposures` -- a duration leg is not credit,
and a table named for two-thirds of its contents misleads exactly the reader who most needs
it to be precise.

**Not new columns on `factor_exposures`.** It is a different regression with its own r-squared
and its own sample; overloading one row would make `r_squared` ambiguous, and it would mutate
a table whose rows are already published.

```sql
CREATE TABLE IF NOT EXISTS credit_rates_exposures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset TEXT NOT NULL,
    run_date DATE NOT NULL,
    lookback_days INT NOT NULL DEFAULT 252,

    -- Total (univariate). Percent return per 100bp. NULL when not estimable.
    total_beta_ust10 REAL,
    total_beta_ig    REAL,
    total_beta_qual  REAL,
    total_r2_ust10   REAL,
    total_r2_ig      REAL,
    total_r2_qual    REAL,

    -- Marginal (orthogonalised, joint with FF5+UMD). Percent return per 100bp.
    marginal_beta_ust10 REAL,
    marginal_beta_ig    REAL,
    marginal_beta_qual  REAL,
    marginal_r2         REAL,

    n_obs INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('measured', 'insufficient_history', 'degenerate')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(asset, run_date, lookback_days)
);

ALTER TABLE credit_rates_exposures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON credit_rates_exposures FOR SELECT TO anon USING (true);
```

`status` values: `measured`; `insufficient_history` when overlap is below the floor;
`degenerate` when the design matrix is rank-deficient or a leg has near-zero variance.

The marginal columns are independently nullable: if the FF5 download failed, the total
variant is still computed and stored and only the marginal columns are NULL. Partial success
is recorded as partial, not discarded.

## 7. Never defaulted

A missing beta is stored as **NULL with a status**, never as `0.0`. A zero beta is a claim --
"this asset is insensitive to rates" -- and it is a claim that would be false for exactly the
assets most likely to fail estimation.

This follows `expected_returns.py` (ADR-0108): no measured IC means no mu and the run sizes by
conviction, rather than a defaulted IC of zero. And `narrative_price_link.py` (ADR-0143):
below the session floor, `insufficient_history` is the verdict itself rather than an opt-in
flag.

`MIN_SESSIONS = 252` is registered in `frontend/lib/risk/sampleAdequacy.ts`
(`MIN_SESSIONS_BY_FIELD`) in the same change as the Python constant. Per ADR-0100, a field
absent from that map is ungated everywhere including `/ask` and MCP, and
`risk-thresholds.test.ts` parses the Python and fails if the two disagree. The new fields must
be added to both sides together or the test will catch it -- which is the intent.

## 8. Shadow on arrival

F persists and validates. **It sizes nothing and changes no published figure.**

This is how every new signal has arrived in this repo: `narrative_tracker` ships as "Shadow:
sizes nothing"; `discovered_themes` is shadow; `volatility_models` is wired in as
reporting-only and is deliberately *not* the conviction denominator, which stays the sample
vol with the ADR-0047 floor.

`daily_refresh.py` calls the service after L2, writes rows, and stops. No call site in
`scenario_analysis.py`, `book_metrics.py`, `optimizer.py` or `expected_returns.py`. S and B
each opt in deliberately, in their own ADR, once F has been validated in production for at
least one run.

The benefit is that F is independently verifiable before three consumers depend on it. If the
orthogonalisation is wrong, that is discovered against a fixture and a SQL query rather than
inside a scenario loss the reader has already been shown.

## 9. Acceptance fixture

Published effective durations are known in advance, so the right answers are written down
**before** the code runs, in the manner of the L5 acceptance battery (ADR-0055).

| Assertion | Expected | Tolerance | What it proves |
|---|---|---|---|
| `TLT.total_beta_ust10` | ~ -17 | +/- 3 | duration recovered on a long-duration instrument |
| `IEF.total_beta_ust10` | ~ -7.5 | +/- 2 | recovered at intermediate duration |
| `SHY.total_beta_ust10` | ~ -1.9 | +/- 1 | recovered at short duration; sign and magnitude ordering holds |
| `HYG.total_beta_qual` vs `LQD.total_beta_qual` | HYG materially more negative | gap > 1.0 | the quality leg separates HY from IG rather than being noise |
| `LQD.total_beta_ig` | materially negative | < -2.0 | an IG ETF loads on IG spreads |
| `SPY.total_beta_ig` | materially negative | < -0.5 | equities load on credit stress, as expected |
| `SPY.marginal_beta_ig` | near zero | \|b\| < 0.3 | **the orthogonalisation did something** |

The last row is load-bearing. If total and marginal do not diverge for SPY, the residualisation
is not working and the entire two-variant design in section 5 is decoration. A spread beta has
no external anchor to check against; duration does. That is what the duration leg bought
beyond its own usefulness, and it is why a spread-only build was rejected.

The fixture freezes a dated slice of returns and macro series in the repo so the test is
deterministic and offline.

## 10. What this is not

Stated in the module docstring, the ADR, and any surface that later renders these figures.

- **An empirical beta, not analytic spread duration.** A regression coefficient over 252
  days, not a cash-flow-weighted sensitivity computed from a bond's schedule. A credit PM
  knows the difference on sight, so the label must carry it. Where the distinction matters
  the field is named `*_beta_*`, never `duration`.
- **ETF-level, not issuer-level.** HYG's spread beta is the index's, not any issuer's. This
  does not narrow the gap between the book's instruments and a real credit book; it measures
  the instruments that exist.
- **One regime.** Three years of history spans one broad macro regime. A spread beta
  estimated 2023-2026 is not a spread beta through 2008. The window is stated with the figure.
- **Not a substitute for a rating or a maturity bucket.** The mandate still cannot express
  rating-bucket or duration-bucket caps. That remains open after F.

## 11. Backfill

New script `scripts/backfill_macro.py`, mirroring `scripts/backfill_regime.py`'s contract
exactly: dry-run by default, `--apply` to write, `--overwrite` required to touch existing rows.

**Why it is needed.** Live counts as of 2026-07-30:

| Series | Observations | Range |
|---|---|---|
| `DGS10` | 255 | 2025-07-22 -> 2026-07-28 |
| `DGS2` | 255 | 2025-07-22 -> 2026-07-28 |
| `BAMLC0A0CM` | 268 | 2025-07-23 -> 2026-07-28 |
| `BAMLH0A0HYM2` | 269 | 2025-07-22 -> 2026-07-28 |

`macro_fetcher._get_lookback_start` defaults to 365 calendar days, which backfilled roughly a
year on first run. 255 observations is one bad intersection away from unusable at a 252-day
lookback: differencing costs one, Treasury and OAS series keep different holiday calendars,
and the result must then intersect each asset's own return series. Realistic overlap is
248-252. The regression would succeed on some assets and silently skip others.

Backfilling to 3 years removes the edge case and buys stability analysis: enough history to
roll the 252-day window back and report whether an asset's spread beta is stable or drifting.
No other figure in the repo can currently answer that, and it is a question a credit PM asks.

**This is safe to backfill, unlike L1 and L5.** FRED and yfinance history is a start-date
parameter and is identical whenever it is fetched. `backfill_regime.py` exists on the same
premise, and its module docstring records why HypeScore and the L5 book are deliberately not
backfillable. Nothing here changes that.

The 3-year fetch runs once, manually, before the first live run.

## 12. Data flow

```
macro_fetcher (L0, nightly)        factor_fetcher (L2, nightly)
  FRED -> macro_daily_history        Ken French -> FF5 + UMD daily
         |                                    |
         |  DGS10, BAMLC0A0CM, BAMLH0A0HYM2   |
         v                                    v
  +--------------------------------------------------+
  | services/credit_rates_exposures.py  (L2b, NEW)   |
  |   build legs -> d_ust10, d_ig, d_qual (bp)       |
  |   total:    3 univariate regressions             |
  |   marginal: residualise vs FF5+UMD, joint fit    |
  |   (imports rolling_regression from factor_fetcher)|
  +--------------------------------------------------+
         |
         v
  credit_rates_exposures        <-- terminal. Nothing reads this yet.
```

`asset_returns_df` is the same frame `factor_fetcher.compute_exposures` already receives; no
new price fetch.

## 13. Testing

| Test | Asserts |
|---|---|
| Synthetic recovery | build `y = -17 * d_ust10 + noise`, recover -17 within tolerance |
| Orthogonality | each `resid_leg` has correlation ~0 with every FF5+UMD factor |
| Published betas unchanged | running F leaves `factor_exposures` rows bit-identical |
| Acceptance fixture | the six assertions in section 9, offline and deterministic |
| Short history | 200 observations -> `status='insufficient_history'`, all betas NULL, no zeros |
| Degenerate input | constant leg -> `status='degenerate'`, not a divide-by-zero |
| Partial failure | FF5 unavailable -> total columns populated, marginal NULL, status `measured` |
| Threshold agreement | `risk-thresholds.test.ts` passes with the new fields in both maps |
| Entry point | import path works under the invocation `daily_refresh` actually uses, in a subprocess -- a bare `from services...` passes pytest and kills the nightly run |

## 14. Documentation obligations

Per the CLAUDE.md doc sync rule, in the same change:

- **ADR-0190** -- new layer and new table, non-negotiable. Records: why a credit factor at
  all; why total and marginal both; why orthogonalised rather than raw; why shadow on
  arrival; why the duration leg is what makes it falsifiable.
- **ARCHITECTURE.md** -- add the L2b node and its edges to the mermaid diagram; add rows to
  the Layers table, the Supabase Tables table, and the Feature Checklist.
- **PROGRESS.md** -- dated row in Completed.
- **CLAUDE.md** -- a key-source-files row for `credit_rates_exposures.py`, and one for
  `backfill_macro.py`.

## 15. Definition of done

1. `credit_rates_exposures` exists with RLS public read.
2. Macro history backfilled to 3 years; every series has >= 700 observations.
3. A nightly run populates a row per asset with `status='measured'` for the assets that have
   the history.
4. The acceptance fixture passes, including the SPY divergence assertion.
5. `factor_exposures` rows are byte-identical before and after.
6. No consumer reads the table.
7. ADR-0190, ARCHITECTURE.md, PROGRESS.md, CLAUDE.md updated in the same change.
8. Backend tests green; `risk-thresholds.test.ts` green.

## 16. Open, deliberately deferred

| Question | Deferred to |
|---|---|
| Rendering these betas to a reader | B |
| Scenario transmission through the marginal betas | S |
| A value-weighted book-level spread beta | B |
| Rating / duration / liquidity-tier mandate caps | after B |
| Single-name credit instruments, issuers, CDS | out of scope for all of D-F-S-B |
| Beta stability over rolling windows | possible follow-on; the backfill makes it available |
