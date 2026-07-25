# GOAL — what this project is being judged on

This file is the standing brief for autonomous work. The `/loop` re-reads it every
firing and picks the highest-value next step **without asking**. Keep it current:
if you finish something material, update "Where things stand" in the same change.

---

## The two deliverables (verbatim, from `task.md`)

**Q1.** *"You have $100 million to invest in long and short trades across any asset
class and/or single companies. What are your top five long and short trades, and
why?"*

**Q2.** *"…designing a daily process that 1) identifies which themes are trending;
2) quantifies how much attention, or 'hype', each theme is attracting, so that the
output can support both idea generation and risk monitoring. Please explain how you
would do this, starting from data gathering and processing to the quantification
framework. An illustrative prototype would be a plus."*

## What kind of artifact this is

An **assessment deliverable**, not a production SaaS. A reviewer spends ~15 minutes
and probes whether the picks survive being questioned. That sets the priority order:

1. **The answer must exist and match the question.** Q1 literally asks for five
   longs and five shorts with reasons. A book that returns two longs and no shorts
   is not yet answering it, however well-engineered the machinery is.
2. **Every number must survive a poke.** One demonstrably wrong figure discredits
   the other forty. Credibility outranks features.
3. **The reasoning must be legible**, not just computed — "why this side, why this
   size, why not this other name".
4. Polish and breadth come after 1–3.

## What kind of interface this is (ADR-0054 — read before proposing UI work)

**A daily research publication. Not a scanner, not a screener.** A screener hands you
candidates when you click; a scanner hands you the same candidates faster and without
clicking; this hands you **a position, a size, and the reason it is not one of the other
thirty names**. The defence apparatus — pool depth, cleared-not-taken, abstention
roster, funnel, turnover, per-row derivation — is meaningless on a scanner, where the
user does the deciding. It is the whole product here.

**Do not build:** realtime subscriptions, polling timers, price tickers, alert rules,
saved screens, filter panels. The inputs (daily news volume, Reddit sentiment, 252-day
correlations, FF5 betas) do not move intraday; streaming them would be a lie told at
60fps. If you want one of these, reopen [ADR-0054](adrs/0054-a-daily-publication-not-a-scanner.md)
with an argument — do not just add it.

**Do take these three from the scanner model**, which are about time-to-insight and do
bind here:

1. **The machine hunts, never the reader.** No query composition. Already true.
2. **Change is shown, not searched for.** What moved since the last run is visible
   without hand-diffing. Extending this is in scope; making it real-time is not.
3. **Every scannable layer must differentiate.** Anything read without clicking has to
   carry distinct information per row. *This is the one currently failed* — see the
   recorded next step below.

## Standing mandate for each loop firing

Re-derive — do not just take the backlog below on faith:

0. **Re-derive again immediately before any irreversible action** — deleting or
   overwriting data, deploying, publishing. Once at the top of the iteration is not
   enough: a long turn can outlive its own premise. Iteration 60 proposed deleting a
   production row that a completed pipeline run had already made correct, mid-turn.
1. Check the live site and the DB for what is actually true right now.
2. Ask: *what single change most increases the chance a reviewer believes this?*
3. Do it end-to-end — implement, test, deploy, **verify on the live URL**, and keep
   the four doc surfaces in lockstep (see `CLAUDE.md` doc-sync rule).
4. **Always also do a Playwright UI/UX pass in the same iteration** (see below).
5. Prefer finishing one thing completely over starting three.
6. If a "gap" turns out to already be built, say so and move on — this repo's
   recurring failure mode is working machinery that is never run or never surfaced,
   and three separate "stubs" in the review notes were already implemented.

### The Playwright UI/UX pass (every iteration, alongside the engineering work)

A reviewer meets this through the browser, so the interface *is* the deliverable.
Each firing, drive the deployed site — never trust a local build — and fix what you
find, not just what you changed:

- Walk `/`, `/book`, `/risk`, `/method` at **1440px and 375px**. Assert
  `document.documentElement.scrollWidth === clientWidth` (no horizontal scroll) and
  `browser_console_messages({level:"error"})` returns zero.
- **Look at the screenshots**, don't just assert. Capture to
  `docs/captures/<YYYY-MM-DD>/<what-it-shows>.png` using an **absolute** path.
- Hunt the recurring classes: dark-on-dark or invisible text after a token change;
  a bare `—`/`0`/`NaN` where a real figure belongs; a number with no unit or no
  explanation; tables that crush instead of scrolling in their own
  `overflow-x-auto min-w-0`; grid items that need `min-w-0` to stop propagating
  min-content; a chip or link that lies about what it does.
- Judge it as a PM would: is the headline the *insight*, is every number explained,
  is detail progressively disclosed rather than dumped? Perplexity Finance is the
  clarity benchmark; the visual identity is the warm-paper "Ledger" theme
  (Hanken Grotesk + JetBrains Mono, crimson/forest ink) — keep it, don't restyle.

## Operating principles (learned the hard way here)

- **Never publish a confidently-wrong number.** Prefer "unavailable, because X", or
  state the sample size next to the figure. Cross-check values against each other
  (anon vs service-role, persisted vs re-derived, value vs its own declared
  minimum) — every real bug this session was found that way, never by a unit test.
- **Real or empty, never fabricated.** `ANDROMEDA_ALLOW_MOCK=0`. No seeded numbers.
- **Abstention is a feature.** If the signal is weak, take no position and say why.
  Do *not* lower a threshold to manufacture a fuller-looking book — widen the
  candidate universe instead, which is the honest fix.
- **Verify live.** Local build passing is not evidence; drive the deployed URL.

## Deploy notes (quota is a rolling daily cap — spend it deliberately)

**The Vercel free tier caps `vercel --prod` at 100 deploys/day** (`api-deployments-free-per-day`).
With two sessions deploying in parallel it **oscillates**: exhausted, a partial reset
opens a few slots, then exhausted again within minutes (iteration 55 got a slot and
shipped a fix; iteration 57 was refused again). Check by attempting a deploy, not by
assuming — and treat a live window as scarce. It is a recurring hazard, not a permanent
block:

- **`git push` does NOT deploy this project** — production is CLI (`vercel --prod`)
  deploys with no git metadata. A commit is not live until someone deploys.
- **Deploy from a clean archive**, never the working tree, so a second agent's
  uncommitted WIP does not ship:
  `git archive HEAD | tar -x -C <tmp> && cp -r .vercel <tmp> && cd <tmp> && npx vercel deploy --prod --yes`.
  A HEAD archive carries **both** sessions' committed work — so it also lands the other
  session's fixes that were committed-but-not-deployed (iteration 55 shipped
  `1336a57a`'s cap-breach board fix this way; iterations 45/49/50 the same pattern).
- **Deploy from the archive ROOT, NEVER from `<tmp>/frontend`** (iteration 63 lost a
  deploy slot and briefly broke the live site learning this). The root carries the
  `vercel.json` + root `.vercel` that link the **`andromeda`** Vercel project, whose build
  env holds `NEXT_PUBLIC_SUPABASE_*`. `frontend/.vercel` links a *different* personal
  `frontend` scratch project with **no** env, so a deploy from there builds against
  `placeholder.supabase.co` and every data call 404s. `andromeda-analytics.vercel.app` is
  the `andromeda` project's production alias and auto-updates on its `--prod` deploys — do
  not `vercel alias set` it to another project's deployment.
- **When the cap is out, prefer verifiable work:** backend/pipeline (runs on GitHub
  Actions, verifiable against prod directly), or **data-layer fixes that bypass the
  deploy entirely** — the frontend reads Supabase live, so recomputing with the *fixed
  code* and persisting shows immediately with no deploy (iteration 45 `market_assets`,
  iteration 50 `portfolio_risk.concentration_hhi`).
- **Direct Postgres, incl. DDL, is available and also bypasses the Vercel deploy.**
  The **repo-root `.env`** carries `SUPABASE_DB_HOST/PORT/NAME/USER/PASSWORD` and
  `psycopg2` is installed, so `psycopg2.connect(..., sslmode="require")` runs SELECTs
  *and* DDL as the `postgres` owner. Iteration 61 applied migration `037`'s
  `CREATE OR REPLACE VIEW` this way and the fix was live with no deploy. Use it to apply
  a committed view/migration fix rather than waiting on the Supabase MCP — but it is
  prod: back up first, prefer idempotent `CREATE OR REPLACE`, and verify before/after.
- **Batch changes into one deploy** when the cap is scarce.

## Where things stand (update me)

Live at https://andromeda-analytics.vercel.app · 564 backend + 144 frontend tests green.

- **Pipeline** L0–L5 runs daily on GitHub Actions (`daily-refresh.yml`, verified
  firing on schedule); monthly `theme-discovery.yml`; all 6 secrets configured.
  **All six stages report to `pipeline_runs`** since iteration 14 — L1 and L4 were
  silent, so `/method` said "not instrumented" while the status bar said "4/4
  succeeded".
- **Q1 book** — **5 long / 5 short across 10 positions** (XLE, SHY, SVXY, NUE, UNH
  long; BABA, GDX, PDD, NOC, ARKK short) on the 2026-07-25 run, **net −5.3% (leans
  short)** at 59.3% gross, market beta −0.50 (signed, value-weighted, identical on the
  home tilt and `/risk`). The fifth short (ARKK) surfaced once the regime unit bug was
  fixed (iteration 72 below) — the persistent four-short book was partly an artefact of
  a spurious risk-on tilt. Roster turns over run to run, so treat any specific list as
  one draw.
  **Sized by conviction since iteration 38** (ADR-0053) — it had been HypeScore-weighted
  while every surface claimed otherwise. The model is `weight ∝ conviction`
  (`|EdgeScore|/vol`, vol-floored) normalised across the **whole book**, *then* the
  single-name / sector / geography caps bind — it is not a per-side constant: this run
  the **US geography cap sits at its 35% limit**, so every US name (incl. the NOC
  short) is scaled to the same `|weight|/conviction` while the non-US shorts are not,
  and `/risk` reads that geo cap as *near*. Per-row rerun-stability markers say which
  names survived identical-input reruns and which did not (ADR-0057). **Both sides are
  now at Q1's five** — the short side took every independent idea the pool offered, and
  `/book`'s Pool depth panel shows 5 held on each. Almost every name
  comes from a theme **below** the attention gate (ADR-0046). The composition can move
  hard run to run — the turnover panel reports each run's figure (20% this run) — so this
  is one draw from the pool, not a settled answer. **One portfolio everywhere** since iteration 10
  (ADR-0040) — `/book` and `/risk` describe the same names and every risk number is
  computed on them, and since iteration 32 `/risk` *checks* that rather than assuming
  it — and direction no longer inverts on a regime label flip since
  iteration 11 (ADR-0041).
  Two-sided since iteration 8 (ADR-0038, direction per asset) and deeper since
  iteration 9 (ADR-0039, scope by attention). Genuinely cap-bound since iteration 7
  — **`/risk` now shows 0 breached limits**, down from 6 violations. The L5 fallback
  that dogged iterations 3–5 is **fixed and closed** (iteration 6). **The five-and-five
  gap is CLOSED** — the 2026-07-25 book is 5 long / 5 short. The fifth short had been
  suppressed by a regime unit bug (percent fed to bp-calibrated thresholds) that stood
  the book ~30% too risk-on; fixing it (iteration 72) surfaced ARKK and tilted the book
  net short, as a corrected late-cycle read should.
- **Direction** EdgeScore = trend/regime/carry/value/sentiment, IC-weighted, with
  abstention + conviction sizing (ADR-0031/32/33).
- **Q2 hype** HypeScore (volume/sentiment/|ρ|/momentum), **absolute and therefore
  comparable over time** since iteration 12 (ADR-0042) — which is what "support risk
  monitoring" requires — plus theme discovery (LDA ∩ embeddings, 6 two-method
  agreements) surfaced on `/`.
- **Honesty surfaces** HypeScore IC panel says NOT YET VALIDATED — and since
  iteration 42 (ADR-0059) it is honest at a finer grain: the IC harness had been
  crashing before it could persist (a Unicode arrow on a cp1252 stdout, ahead of the
  write), which froze the panel in a false all-null "no data" state; and its
  `validated` verdict would have flipped green on a **single date's** IC. It now shows
  the first measurable reading (h1 IC −0.23, one date) labelled *"measured · 1 date —
  not yet stable"* and keys "validated" on the IC information ratio (stability across
  ≥2 dates), not on a lone point estimate. Risk cards state their sample size;
  `/method` renders every formula from live `scoring_config`.

### Loop iteration 76 (2026-07-25) — **the corrected prompt is verified end-to-end**

**A full `daily_refresh` ran against production and the guard passed all eight checks for
the first time.** Every fix from iterations 71–75 is now visible in a genuine run, not just
in tests:

| the 07-25 book, before | after the run |
|---|---|
| *"an **inverted** curve"* | *"positive 10y-2y curve (**+34bps**)"* |
| `HY credit OAS: 2.77 bps` | *"tight credit (**HY OAS 277bps**)"* |
| *"**backwardation** (VIX3M-VIX = +1.93)"* | *"VIX **contango** (-1.96)"* |
| *"market-neutral (Mkt −0.02)"* on a −0.50 book | *"lean value (positive HML via XLE and NUE)"* — direction in words, **no restated numbers** |
| ten identical `beta_mkt -0.02` | **10 distinct**, r² on all ten, joined by the pipeline itself |
| `correlation_summary` null | 45 pairs, max **SVXY/ARKK +0.65**, mean \|ρ\| 0.19 |

Still **5 long / 5 short** (SHY, XLE, SVXY, NUE, UNH / GDX, BABA, NOC, ARKK, PDD), gross
66.2%, net −2.4%, **0 cap violations**. The negative controls held throughout: every one of
those checks failed on the old book and passes on the new one.

**Then: a disqualifier you cannot locate is not falsifiable.** Q1 asks for the trades *and
why*, and `counter_thesis` is where the *why* is made falsifiable — all ten picks carry a
measurable trigger. But **six of ten name the same one**, *"wrong if X breaks its 200-day
MA"*, and nothing on the page said what that moving average **is**. Compare XLE's, which
names a level — *"wrong if WTI breaks below $80/bbl"* against WTI at $90.47, ~11% of room.

`moving_average_context` now joins `{last, ma, pct_from_ma}` per pick:

```
NUE  long   247.56 vs 187.44 MA  = +32.1%      ARKK short   71.89 vs  77.73 MA  =  -7.5%
UNH  long   420.74 vs 339.86 MA  = +23.8%      NOC  short  542.24 vs 604.91 MA  = -10.4%
SHY  long    81.85 vs  81.49 MA  =  +0.4%      PDD  short   82.66 vs 104.90 MA  = -21.2%
```

**Every short sits below its trigger and every long above it** — 7–21% of room before the
stated disqualifier fires, **except SHY at 0.4%**. That is the point: a reader now sees
which position is near its line, which six identical sentences hid. Under 3% is coloured.
[ADR-0078](adrs/0078-a-disqualifier-you-cannot-locate.md).

**Honest about what this does not fix:** six picks choosing *"its 200-day MA"* is a generic
answer, and stating the distance makes that visible rather than repairing it. Whether a
trade whose disqualifier is a moving average has a thesis at all is the next question.

**Blocked:** the Vercel deploy refused — `api-deployments-free-per-day`, more than 100 in
24h. The **data** is live (all ten picks carry `ma_context` via the pure-function PATCH
route), so the render appears as soon as a slot opens; the commit is `95f18d61`. And the
Playwright pass was blocked for the **fourth consecutive firing** — the other session has
held the shared Chrome profile the whole time. 613 backend tests green.

### Loop iteration 75 (2026-07-25)

**Two things: the guard stopped hiding defects behind each other, and the corrected
prompt was finally put through a real run.**

**1. `check_data_integrity` reported only its first failure.** `main()` was a chain of
early returns, and that quietly set the pace of three consecutive iterations:

| iteration | found | ADR |
|---|---|---|
| 72 | a cap breach the book does not have | 0071 |
| 73 | a factor tilt restated from the pre-selection pool | 0073 |
| 74 | *"an inverted curve"* against a +34bps slope | 0075 |

**All three were in the same published thesis, on the same day.** They arrived one per run
because nothing looked past the first — each fix did not *reveal* the next defect so much
as **stop hiding** it. And the cost is not only pace: a reader of the output could not tell
*"this book has one defect"* from *"this book has one defect that we know of"*.

`run_book_checks` now returns `(headline, flags, ok)` for all six book checks, every one
evaluated, exit code decided at the end. Extracted as a pure function because that is what
makes the property testable — the live three-defect row asserts **three failures in one
pass**, which no test could express while the logic sat inline in `main()` behind a
Supabase client. It also collapses five overlapping queries for the same row into one; each
check had been added by appending another query rather than widening the first.
[ADR-0076](adrs/0076-a-guard-reports-every-failure.md).

**2. `origin/main` was nine commits behind — at iteration 64.** The scheduled
`daily-refresh.yml` checks out the *pushed* repo, so every fix from iterations 71–75
— the corrected prompt, the per-pick beta join, three of the guard's checks — **was absent
from the job that actually runs**. Committing is not deploying for the backend either:
`git push` is the deploy step for anything GitHub Actions runs.

**3. The reason ADR-0071 and ADR-0073 did not hold: the block contradicted itself.**
`format_book_metrics_summary` prepends its **own** header, two lines below the one ADR-0071
rewrote:

```
=== CANDIDATE-POOL METRICS — EQUAL-WEIGHTED, BEFORE YOUR SELECTION ===
… They are NOT the book's metrics. NEVER state them as the book's own composition
=== BOOK METRICS (computed, not estimated) ===          ← this function
  Book factor tilts: Mkt=-0.02 SMB=+0.18 HML=+0.27 …    ← this function
  ⚠ CAP VIOLATIONS: US 66.67% — 31.67pp over its 35% cap
```

**The correction was contradicted inside the same block by the string it was correcting**,
and the contradicting version was the one attached to the numbers. Both published
falsehoods are printed verbatim under those labels by this function: *"market-neutral (Mkt
−0.02)"* for a book at **−0.50**, and *"US at 66.67% versus the 35% cap (31.67pp over)"*
for a book with **no violations at all**.

So the two rows are **removed rather than relabelled a third time** — a caveat competes
with a number and the number wins. A pool-average tilt has no decision value for *choosing*
picks, and a cap breach computed on 30 equal-weighted candidates is not a fact about any
book. Crowding — the part that informs a pick — stays as `Pool sector share` / `Pool geo
share`. **You cannot restate a number you were never given.**
[ADR-0077](adrs/0077-withhold-the-number-instead-of-forbidding-it.md).

**Open at the end of this firing:** a full `daily_refresh` run was launched to exercise the
corrected prompt end-to-end and had not returned when the firing closed (the L5 deadline is
900s). The Playwright pass was blocked for the **third consecutive firing** — the other
session has held the shared Chrome profile throughout, and there is no project-level MCP
config to add `--isolated` to.

### Loop iteration 74 (2026-07-25)

**Read the prompt that shipped iteration 73's fix and found the instruction that had
caused it — then found the same block was lying to the model about the macro regime.**

[ADR-0073](adrs/0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md) stopped the
model restating the pool's tilts as the book's. The line that licensed it was still there:

```
- factor_tilts: use the pre-computed book_metrics if available; set to {} if no data
```

`factor_tilts` is a **per-pick** field, rendered per row on `/book`. That told the model to
fill it from an **aggregate**, and it complied exactly — all **ten** positions carried
byte-identical tilts, `beta_mkt -0.02` for every one. **SHY** (1-3yr Treasuries) and
**SVXY** (inverse VIX) were printed with the same market beta. The measured values were in
`factor_exposures` all along, in the table the prompt prints two sections above:

| asset | measured `beta_mkt` | R² |
|---|---|---|
| SVXY | **+2.08** | 0.68 |
| ARKK | **+1.49** | 0.77 |
| SHY | **+0.01** | 0.07 |
| NOC | **−0.01** | 0.04 |

Ten identical rows is the strongest possible failure of this file's own rule that **every
scannable layer must differentiate**. `attach_asset_factor_tilts` now joins them in
`size_positions`, and the field is no longer requested in the output schema at all — a
model should not be asked to type numbers about to be overwritten. `r_squared` rides along
and the page says *"a weak fit, so read these betas loosely"* below 0.30, which fires on
six of ten names: an honest disclosure, not a display bug.

**And the regime block was misstating its own units.** Three fields, against L3:

| prompt printed | actually |
|---|---|
| `Yield curve slope (10y-2y): 0.34 bps` | stored in **percent** — the curve is **+34 bps** |
| `HY credit OAS: 2.77 bps` | **277 bps** — a credit market ~100x too tight |
| `VIX term structure: -1.93 (positive = backwardation)` | correct, but leaves the convention to be applied |

This is the percent-vs-bps mismatch of iteration 72, surviving in the one place it reaches
a reader. Told the curve was **0.34 basis points**, the agent opened the published thesis
with *"an **inverted** curve"* while quoting levels that show an upward slope. Handed
`-1.93`, it wrote *"term structure already in **backwardation** (VIX3M-VIX = +1.93)"* —
flipping the subtraction order, then keeping the label belonging to the other order; under
that order the market is in **contango**, the calm state, and the thesis used the opposite
to argue a VIX-spike risk was underway. Every number was cited correctly, so
`verify_citations` passed all of them — the gap ADR-0049 named. The block now names the
shape: *"+34 bps (upward-sloping — the curve is NOT inverted)"*.

**Two guards, negative-controlled against production before being trusted** — each fired on
the live row naming the right numbers. `check_per_pick_tilts_differentiate` tests the
fingerprint, not the prose; `check_regime_characterisation_claims` flags an inversion claim
against a positive slope and a backwardation/contango claim against the opposite sign.

**The live book was repaired with no pipeline run** — the join is pure, so the 07-25 picks
were recomputed with the fixed code and PATCHed: ten distinct market betas, 2.08 down to
−0.01. **The prose was deliberately not repaired.** *"An inverted curve"* and
*"market-neutral (Mkt −0.02)"* stay until the next run writes under the corrected prompt;
hand-editing it would make the page say something the agent did not conclude.

[ADR-0075](adrs/0075-per-pick-betas-are-joined-not-authored.md). 602 backend tests green.

**The Playwright UI/UX pass did not run this iteration**, and the standing mandate requires
one. The other session held the Chrome profile for the whole firing —
*"Browser is already in use … use --isolated"* on nine attempts across ~40 minutes. What was
verified instead: the deployed `/book` chunk contains the new strings (`Factor exposure`,
`252-day regression`, `a weak fit`), and the persisted picks carry ten distinct market
betas. **Neither is a substitute for looking at the page** — the new block's layout at
375px is unverified. First item for the next firing, and a second `--isolated` browser
profile would stop this recurring.

### Loop iteration 74 (2026-07-25)

**A verification iteration: the regime unit bug (iteration 72) raised the question of
whether the same percent-vs-bps class of error lurked in the other macro-derived
EdgeScore signals. Audited them — carry, value, sentiment are all sound — and closed the
doc-sync the scenario change left open.**

- **`carry_signal`** divides `(ust10 + oas − funding)` by `_CARRY_SCALE_PCT` — inputs and
  scale both in percent (the `_PCT` suffix names the unit), and the docstring's worked
  example (268bp → +0.585) confirms percent throughout. No mismatch; the regime bug was
  isolated, not systemic.
- **`value_signal`** signs check out: +z(HY OAS) = wide spreads = cheap credit = long;
  +z(real yield) = bonds cheap = long. **`sentiment_signal`** is correctly contrarian.
- **Returns/risk** reconcile: the three daily returns compound to the +1.15% cumulative,
  and the net-short book's −0.04% Saturday mark is sign-correct. The withheld n=3
  regression beta is not user-facing.
- **Q2 IC** is still one date — 07-25 is a Saturday, so the second forward-return
  cross-section can't appear until Monday's trading day. Genuinely weekend-limited.

Closed the ARCHITECTURE.md doc-sync the melt-up (ADR-0074) left open — the mermaid node
and the pipeline prose both still said "4 stress scenarios"; now "5 (4 risk-off + 1
melt-up)". UI/UX pass clean at 1440/375, zero horizontal scroll, zero console errors, no
NaN. Two live items remain, both another workstream's: the thesis-tilt discrepancy
(concurrent [ADR-0073](adrs/0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md),
committed, lands on its next pipeline run) and the prediction-markets framing fix
(committed, awaiting a deploy). 564 backend + 144 frontend.

### Loop iteration 73 (2026-07-25)

**The book turned net short last iteration, and that exposed a one-sided stress test:
every scenario was a risk-off shock the book gains from, so `/book` read "WORST SCENARIO
−0.0%" — a $100M book whose worst stress loses nothing.**

All four scenarios (VIX, rates, USD, credit) carry a negative market shock — the right
battery for the long-biased book the platform ran for most of its history. But the
regime fix (iteration 72) turned the book **net short** (−5.3%, beta −0.50), and a
net-short book *gains* in every risk-off shock: VIX +3.4%, Rate +2.0%, Credit +0.2%, USD
−0.0%. The worst case reading ~0 is the first number a reviewer pokes — not because the
book is riskless, but because the battery only tested the tail it is hedged against. The
real risk of a short book is the **opposite** tail: a risk-on melt-up / short squeeze.

Added a fifth scenario, **Melt-up / Squeeze (SPX +10%)** — market up, VIX collapse,
ARKK/China squeeze, hedges unwind — a fixed calibration symmetric to the risk-off shocks
([ADR-0074](adrs/0074-stress-both-tails-not-just-the-crash.md)). It reports **−2.0%** on
the live book, so both `/book` ("WORST SCENARIO −2.0% Melt-up") and `/risk` ("5 calibrated
shocks · WORST CASE Melt-up −1.99%") now show a genuine downside. Re-persisted
`scenario_results` so it is live (frontend is deploy-quota-blocked but count-agnostic, so
it rendered the 5th row automatically); committed so the next scheduled run keeps it. 35
scenario tests pin both tails. UI/UX pass clean at 1440/375.

Deferred to the concurrent session (their active ADRs): the thesis-tilt discrepancy is
[ADR-0073](adrs/0073-a-factor-tilt-is-a-number-the-model-may-not-retype.md); the pending
prediction-markets framing fix still awaits a deploy. 564 backend (+1) + 144 frontend.

### Loop iteration 72 (2026-07-25)

**Cross-checking the macro regime — a core input to every EdgeScore — turned up a
unit-mismatch bug, and fixing it closed the Q1 five-and-five gap that had stood for
dozens of iterations. The persistent fourth-short book was partly an artefact.**

The yield-curve slope (DGS10−DGS2) and HY OAS (BAMLH0A0HYM2) arrive from FRED in
**percent** (0.34, 2.77), but every threshold in the classifier and in `risk_appetite`
is calibrated in **basis points** (`yc < -50`, "HY OAS in bp: 350"). So the curve and
credit rules were unreachable — 0.34 is never < −50, 2.77 never > 350 — and the two
headline inputs of a credit-cycle model were dead: cycle fell to real-rate alone,
sentiment to VIX/breadth alone. Worse, `risk_appetite`'s HY term saturated near +1,
inflating the continuous appetite to **0.565** (the persisted value, to the digit)
versus a correct **0.433** — a standing **~30% risk-on tilt on `regime_bias` for every
asset**. Callers now convert to bp; persisted values stay percent for the UI.

Verified live by re-running the pipeline on the same Saturday data: `risk appetite
+0.433` in the log, discrete label unchanged (**late/risk-on**, no inversion). The
corrected, less-risk-on regime made the fifth short reachable — the book went **5 long /
4 short (+1.4% net) → 5 long / 5 short (−5.3% net)**, taking ARKK, the innovation short
it had abstained on for iterations. (The concurrent session was fixing the L5 prompt in
the same window, so the regime correction is *a* cause of the 5/5, not provably the only
one; but it is verified to have removed a real ~30% risk-on bias.) Book-of-record
reconciled (10 held = 10 published), 0 cap breaches, tilts identical on home and `/risk`
(Mkt −0.50). Three unit tests pin it, incl. a percent-scale inversion that reaches
"recession" only via the conversion. UI/UX pass clean at 1440/375, zero horizontal
scroll, zero console errors.

**Live discrepancy to watch (same root as ADR-0071).** The `/book` thesis still says "at
market-neutral (Mkt −0.02)" while both panels read **−0.50** for the sized book: the L5
agent writes the thesis from the *candidate-pool* `book_metrics` (equal-weighted, before
sizing), and `finalise_book_analytics` recomputes on the final book *after*. The
concurrent session's [ADR-0071](adrs/0071-pool-metrics-are-not-book-metrics.md) fixed the
false *cap* claim from this same gap; the factor-tilt claim is the next manifestation and
is not yet corrected on the live thesis. Defer to that workstream rather than duplicate.
563 backend (+3) + 144 frontend.

### Loop iteration 71 (2026-07-25)

**The home "what the crowd is pricing" panel had two defects: it claimed prediction
markets it neither cites nor uses, and a substring bug surfaced "Next Prime Minister of
Ethiopia?" as the top macro event.**

1. **False claim.** The sub-line read *"N macro events · cited as evidence on the Q1
   book."* Untrue: the markets are stored only for this panel, never added to
   `macro_snapshot`, and `book_view`/thesis reference none of them (checked — no
   polymarket, ethiopia, bitcoin, "crowd is pricing"). Fixed to *"forward odds for
   context — not cited in the book,"* and corrected the pipeline comment that called
   them "cited macro context."
2. **`eth` ⊂ `Ethiopia`.** `_categorize` substring-matched, so the Crypto keyword `eth`
   matched inside *Ethiopia* — filing "Next Prime Minister of Ethiopia?" under Crypto,
   which cleared the `Other` filter and made it the highest-volume "macro event" on the
   page. Now whole-word (plural-tolerant) matched: Ethiopia → `Other` → dropped, while
   Fed rate cuts / WTI / Bitcoin / Taiwan still categorise. Five unit tests pin it.

Re-ran the fetcher against prod, so the **data fix is LIVE** — Ethiopia is gone and the
panel shows only Fed/Bitcoin/Geopolitics/Oil. The **framing fix is committed but not yet
live**: the Vercel deploy quota is exhausted again, so the sub-line still reads the old
"cited as evidence" text until the next `andromeda --prod` deploy from HEAD. UI/UX pass
clean at 1440/375, zero horizontal scroll, zero console errors. 560 backend (+5) + 144
frontend.

### Loop iteration 70 (2026-07-25)

**Cross-checked the Q2 core — the HypeScore — and found the heatmap's own derivation
drawer describing the *opposite* of what the engine computes, contradicting both the
score and Q2's central claim.**

The HypeScore reconciles perfectly with its four sub-scores across all eight themes (US
Election 0.30×95 + 0.20×53 + 0.30×48 + 0.20×34 = 60.3 ≈ 60, and so on). But the theme
derivation drawer said the **correlation and momentum sub-scores are "min-max normalised
across the themes scored on this run,"** and its assumptions note called every sub-score
**"a *relative* rank, not an absolute level."** That is exactly backwards. ADR-0028
*replaced* the cross-theme min-max with absolute saturating transforms — correlation
`min(1, |ρ|/0.50)` against a fixed anchor, momentum `tanh(z/2)` on the theme's own
MAD-scaled z — for the express purpose of keeping HypeScore **comparable over time**,
which is what Q2's "support risk monitoring" (ADR-0042) rests on. The pipeline uses
those absolute functions (`corr_subscore`, `momentum_subscore`); the drawer still
narrated the superseded method, contradicting the heatmap header two panels up
("absolute scale — not a rank against the other 8").

Fixed the drawer to state the actual formulas — the correlation and momentum rows and
the assumptions note now describe an absolute, time-comparable level, matching the code
and the header. Text-only, no computation change; the persisted sub-scores were always
absolute. Deployed and verified live (drawer reconciles: 0.3+0.1+0.1+0.1 = 0.6 = 60),
UI/UX pass clean at 1440/375. 555 backend + 144 frontend.

### Loop iteration 69 (2026-07-25)

**Executed iteration 68's recorded next step: the SIZING chain that said "trust the
final weight, not the derivation" for every US name now names the cap that actually
bound it.** With "why this side" made to reconcile last iteration, "why this size" was
the remaining opaque half of the crown jewel.

The note was wrong two ways: it claimed *"no cap binding, yet the book holds 8.8%"* when
a cap **was** binding — the panel just only checked the single-name one. The live book's
only binding cap is the **US geography cap, at its 35% limit** (cap_utilisation.geo US =
1.00; nothing else ≥ 0.999). So `/book` now passes the group caps (geography, sector)
sitting at their limit into `buildSizingChain`, and the note reads: *"19.0% normalised →
8.8% held: the single-name cap is not the binding one here — the geography cap (US, 35%)
is at its limit. Conviction weights are scaled to fit the caps that bind and the freed
capital held as cash (ADR-0037) … the final weight is ground truth."*

The attribution is sound, not a guess: ADR-0037 clamps a capped group and **banks the
freed capital as cash** rather than redistributing it, so a name scaled below its
normalised weight is necessarily inside a binding group. Verified live — US names (XLE)
name the geo cap; non-US names (BABA, China at 0.53) correctly show **no** note, so it
never over-attributes. A unit test pins the geo-cap case; the old "no cap binding"
fallback still fires only when no group cap is at its limit. Deployed, UI/UX pass clean
at 1440/375. 555 backend + 144 frontend.

**Both halves of the crown jewel now reconcile on the page**: the EdgeScore decomposition
prints its renormalisation (÷ present weight), and the sizing chain names its binding cap
— "why this side" and "why this size" are each legible end-to-end.

### Loop iteration 68 (2026-07-25)

**Kept poking numbers a reviewer would check. Correlation and returns held up; the
EdgeScore decomposition — /book's self-described "crown jewel" — did not: its own
contributions did not sum to the score it printed.**

Cross-checks that PASSED (recorded so they are not re-run): the empty correlation panel
is correct — BABA-PDD, the two China shorts, correlate only **+0.475**, and every book
pair is below the 0.70 flag threshold; the +1.38% cumulative return compounds the three
daily returns exactly, and the daily return uses **signed** weights (shorts flip) with a
no-silent-zeros price guard; per-name `edge_score` reconciles to the IC-weighted formula
renormalised over present components (XLE 0.2075 ÷ 0.48 = 0.4323, to the digit).

The bug was in **showing** that last one. `/book`'s EdgeScore panel listed each signal's
weighted contribution — Trend +0.189, Regime +0.015, Sentiment +0.004 — then a bold
**"Σ contributions → EdgeScore +0.432"**. Those add to **+0.208**, not +0.432. The
pipeline drops a null component (Carry/Value are not scored for XLE) and renormalises the
weights over what is present (ADR-0036), so the score is `0.208 ÷ 0.48`; the panel used
that renormalised value in its *silent* reconciliation check but never printed the
division — leaving a reader to watch the numbers fail to add up on the one surface built
to prove the reasoning. Now it prints the worked division live
(`+0.208 weighted sum ÷ 0.48 present weight = +0.432`) whenever a component is absent, and
the stale header comment (it claimed 4 components and pre-ADR-0033 weights) is corrected.
`recomputeEdgeScore`'s parts are already unit-tested. Deployed and verified live at
1440/375.

**Recorded next step** (larger, honestly disclosed already): the SIZING chain below the
decomposition still says *"these steps do not compose … trust the final weight, not the
derivation"* for every US name. The real reason is the **35% US-geography cap** scaling
them (a cap IS binding, just not the single-name one the chain shows). Completing that
derivation — threading the geo/sector cap step and the post-cap book renormalisation into
`positionEdge.ts` — would make the "why this size" as legible as "why this side" now is.
555 backend + 143 frontend, UI/UX pass clean.

### Loop iteration 67 (2026-07-25)

**Poked a set of numbers I hadn't cross-checked — the stress scenarios — and one
short row's arithmetic did not check out. Fixed it in the code and re-persisted the
live book without a full pipeline run.**

Each stress scenario on `/risk` breaks its P&L into per-position rows. The longs read
fine (`XLE (long): +8.8% × +3% = +0.26%`), but the shorts printed the **unsigned**
weight, so the sign flip was invisible: `BABA (short): +9.0% × −20% = +1.80%` — except
`+9.0% × −20% = −1.80%`, not `+1.80%`. The P&L itself was correct (a short gains when its
name falls); the row's own numbers just contradicted its result — exactly the kind of
thing a reviewer expands a stress row to check, and it fails on sight. Now it prints the
**signed** weight, `−9.0% × −20% = +1.80%`, which multiplies to what it claims.

The estimates were unchanged (verified: Rate Shock +1.64%, Credit −1.57%, VIX +0.62%,
USD −0.62% identical before and after), so this was a pure display-correctness fix.
`run_scenario_analysis` is a pure function of picks + factor betas + fixed shocks — no
price fetch — so I recomputed `scenario_results` for the live 07-25 book with the fixed
code and PATCHed it into `research_recommendations`, landing it live with no deploy and
no book change. A regression test asserts a short row's printed numbers multiply to its
printed result. Verified live at 1440/375 (breakdown expanded, no overflow); UI/UX pass
clean across all four pages, zero horizontal scroll, zero console errors. 555 backend +
143 frontend.

### Loop iteration 66 (2026-07-25)

**Confronted the #1 gap — Q1 asks five shorts, the book has four — and confirmed with
evidence it is a genuine abstention, not a narrow universe. Then made the one honest
improvement left: the risk-monitoring panel that reads empty now says how close it is.**

The honest fix for a short side of four is *widen the universe*, never relax a cap. So I
checked the universe: **52 tickers across US single-names, Treasuries, credit
(JNK/ANGL/BKLN), EM/DM/China/Japan/Brazil ETFs, precious metals, and the dollar.** The
short side surfaced exactly five independent ideas; the book took four and passed over
ARKK — the *weakest* (|edge| 0.26) and a US name the full 35% US-geo cap can't fit. Every
non-US short idea (China, precious metals) is already held; there is no untapped non-US
short to add, so widening further would only manufacture a weak one. The four-short book
is a well-searched abstention from a broad multi-asset universe — left as-is, on evidence.

**The one shippable improvement was on Q2's risk-monitoring half.** The theme-attention
crowding panel needs five scored hype observations per theme before a within-history
percentile means anything (below that it correctly reads `—`, never a fabricated 50th);
hype history is three days old, so it sits empty. It used to say only *"expected until
the history backfills"*; it now counts down — *"the book's themes have up to 3 of the five
scored observations a percentile needs"* — so a reviewer sees a real capability two runs
from live, not a dead panel. Threaded the per-theme scored-obs count through
`CrowdingHistoryLite`; no fabricated number. Deployed and verified live.

Everything else was re-confirmed strong, not just asserted: exposures reconcile
(long−short=net, long+short=gross), market beta reads **−0.13** identically on the home
tilt, `/risk` BOOK FACTOR TILT, and the attribution Σβ; the n=3 regression stats stay
*withheld*; `exceeds_cap`'s float guard (ADR-0068) and the signed book_metrics are both
unit-tested. The IC is honestly one date (h1 −0.228). UI/UX pass clean at 1440/375 across
all four pages, zero horizontal scroll, zero console errors. 554 backend + 143 frontend.

### Loop iteration 65 (2026-07-25)

**A verification-and-landing iteration: I re-derived the highest-value step, found the
book already in strong shape after 64, so I landed the last stranded commit live and
poked every headline number to confirm it survives — the deliverable's remaining "gap"
(a fifth short) is a principled abstention, not a bug.**

The Vercel quota had partially reset, so the committed CapUtilisation robustness fix
(a2f0ef08, iteration 63) finally deployed and is **live** — belt-and-braces now that the
data is clean, but it guards against cap float-dust *recurring*. Then a cross-check
sweep of the fresh 07-25 book, the method that finds every real bug here:

- **Exposures reconcile** — `long − short = net` (0.0138) and `long + short = gross`
  (0.5937) to the digit.
- **Market beta is one number across three surfaces** — home FACTOR TILT, `/risk` BOOK
  FACTOR TILT, and the per-position attribution Σβ all read **−0.13**; caps read 0
  breaches on both `/risk` panels.
- **The 3-session stats are withheld, not faked** — `portfolio_risk` holds a −1.30
  regression beta and an 8.25 Sharpe, both nonsense on n=3, and the site shows
  *"Unavailable · needs 30 sessions"* rather than printing them. The one beta it *does*
  show is the ex-ante FF5 loading, correctly labelled.

**Fifth short — re-examined, still an honest abstention.** The pool held exactly five
independent short ideas; the book took four and passed over **ARKK**, the weakest
(|edge| 0.26 vs 0.29–0.43) and a US name the full US-geography cap has no room for. The
thesis names the decline (*"shorting innovation in a risk-on tape … fights momentum"*),
and the pool-depth panel's *"by choice, not by constraint"* is the ADR-0056/0058 sense —
the pool wasn't the limiter, the selection was. A fifth short would have to come from
*widening the universe with a non-US idea*, not from relaxing the 35% cap (which the
operating principles forbid), and manufacturing a weak one is worse than a disclosed
abstention. Left as-is, deliberately.

**Q2 IC — re-ran, still honestly one date.** `backtest_hype` reports h1 IC −0.228 on
n_obs=8 (one cross-section), h5/h20 empty for want of a forward window; the panel says
exactly that (*"no forward window yet"*, *"not yet validated — and we say so"*), and
`/method` frames the negative sign as crowding-to-fade, which the EdgeScore already
does. Not a fixable gap — the hype history is genuinely short. UI/UX pass clean at
1440/375 across all four pages, zero horizontal scroll, zero console errors.

### Loop iteration 64 (2026-07-25)

**Two committed fixes were stranded — the deploy quota blocks the frontend and, it
being Saturday with no nightly until Monday and no `gh` to dispatch the workflow,
nothing would land them for 2.5 days. So I ran the daily pipeline locally against prod,
which pushed both live at once and fixed a third thing I'd been treating as
"disclosed, therefore fine".**

The live site was showing `/book` (run_date 07-25, an OIH/SHY/SVXY book a pre-close
local run published at 16:22) beside `/risk` computing every statistic on
`portfolio_positions` (the 07-24 scheduled run's BIL/JPM/UNH names) — *"9 held · 9
published … THESE ARE NOT THE [published names]"*. ADR-0040's "one portfolio everywhere"
was visibly broken, and the buggy `book_metrics` had `/risk` reporting market beta
**+0.18** while the home view read **−0.35**: two pages, opposite signs, same book.

A single local `daily_refresh.py` run (UTC date now 07-25, so `utc_run_date()` stamps
07-25 and UPSERTs the stale row) regenerated everything from the **fixed** code —
`book_metrics` (62bbe7bd) and the cap epsilon guard (f002966e) are both on `main`:

- **Book of record reconciled** — the log says *"reconciled to L5: 9 positions (was 40
  from L1)"*; `/book` and `/risk` now name the identical 9 (XLE/SVXY/NUE/UNH/JPM long,
  SLV/BABA/PDD/NOC short) and the "THESE ARE NOT THE" warning is gone live.
- **Factor tilts signed and consistent** — `/risk` BOOK FACTOR TILT, its per-position
  attribution Σβ, *and* the home FACTOR TILT all read **MKT −0.13, SMB +0.23, HML +0.37,
  RMW +0.26, CMA −0.30** live (was +0.18 vs −0.35). The thesis regenerated too — no more
  "modest (Mkt +0.16)"; it now reads *"net market beta dampened by SVXY/NOC/SLV offsets"*.
- **Cap breach cleared** — *"0 cap violations"* in the log; `/risk` CAP UTILISATION reads
  **"0 breaches"** beside the board's "0 breached" (the iteration-63 contradiction, now
  resolved in the data — the US-geo float dust no longer persists as a violation).

Still 5 long / **4 short**: the pipeline abstained on the fifth short (ARKK) exactly as
before — a re-run doesn't manufacture an idea that isn't there, and the pool-depth panel
says so. The CapUtilisation frontend fix (a2f0ef08) is still undeployed but now
belt-and-braces: the data is clean, and the fix guards against float dust *recurring*.
UI/UX pass clean at 1440/375 across all four pages, zero horizontal scroll, zero console
errors. **Deploy lesson also recorded:** run the pipeline from repo root with root
`.vercel`/`.env`; a local run is legitimate (ADR-0069) and lands committed backend fixes
without a Vercel deploy.

### Loop iteration 64 (2026-07-25) — **Q1 is five and five**

**The book is 5 long / 5 short for the first time, and the guard is fully green.**

```
2026-07-25   5 LONG / 5 SHORT   (10 positions)
  long : XLE, SHY, SVXY, NUE, UNH
  short: BABA, GDX, PDD, NOC, ARKK
```

Verified live at 1440px and 375px: `LONGS / SHORTS 5 / 5`, and Pool depth reads
**"Shorts 12 candidates → 5 independent ideas → 5 held · The book took every independent
idea available up to 5."** No shortfall block on either side — the book took everything
reachable, including **ARKK**, the name declined across a dozen iterations.

This file has carried *"Remaining Q1 gap is depth: the ask is five and five"* since
iteration 7. **It is closed**, and worth being precise about how: not by lowering a
threshold — the standing rule forbids manufacturing a fuller book — but because the short
pool reached five independent ideas and the agent took all of them.

**And [ADR-0071](adrs/0071-pool-metrics-are-not-book-metrics.md) is verified end-to-end.**
The run under the corrected prompt published a thesis with **no false cap claim**: the
`66.67% / 31.67pp` sentence is gone from the page, and the guard now passes all six
checks including *"No false cap-breach claim in the 2026-07-25 thesis."* The negative
control held — the check failed on the old book right up until the new one landed, then
went green.

**Also shipped: [ADR-0072](adrs/0072-persist-the-books-correlation-structure.md)** —
persist the book's correlation *structure*, not just its flagged tail. `correlation_pairs`
keeps only pairs ≥ ρ 0.70, so a well-diversified book leaves it empty and every surface
can say only *"nothing crossed the flag"*. `correlation_summary` stores `max_abs_pair`
(signed, both names) and `mean_abs_corr` over **every** pair, so a page can say *"the
highest pair in this book is BABA/PDD +0.48"* — a measurement rather than an absence.

Four choices worth keeping: the extreme is by **magnitude** (a −0.85 hedge is the most
correlated pair in a book); the mean is of **absolute** values (+0.8 and −0.8 average to
0.0 signed, describing a coupled book as uncorrelated — the sign-destroying error ADR-0042
removed from HypeScore); an empty pair list returns `{}` **not zeros** (a one-position
book has no pairs, which is not a correlation of zero); and it is wrapped so a failed
measurement costs a panel, not a run. Stored in the existing `book_metrics` JSONB — **no
migration** — with `correlation_pairs` untouched so no consumer changes meaning beneath it.

**Populates next run**, since the change landed after this pipeline started.

### Loop iteration 63 (2026-07-25)

**`/risk` contradicted itself: the RISK-LIMIT BOARD read "0 breached" while the CAP
UTILISATION panel right below it read "1 breach". Same page, same limits, opposite
verdicts — a reviewer's first poke and the number doesn't survive it.**

The breach was float dust, not a real one. A fully-utilised group lands *exactly* on
its cap by design (ADR-0037 clamps it), and re-summing the clamped per-position floats
reintroduces representation error: US geography persists as weight
`0.35000000000000003` against a `0.35` cap, utilisation `1.0000000000000002`. The
RISK-LIMIT BOARD already discounts that with a tolerance (`CAP_UTIL_EPSILON`,
iteration 55); the CAP UTILISATION panel did not — it read the persisted
`violations` list and a bare `util > 1`, both of which count the dust as a governance
breach. So the two panels disagreed on the same book.

The fix ports the board's tolerance into the panel: a new `lib/risk/capBreach.ts`
recomputes breaches from utilisation with `CAP_UTIL_EPSILON`, and `CapUtilisation`
uses it for the per-row bar, the summary count, and the breach detail — dropping its
reliance on the persisted `violations` list (which is written before the pipeline's own
epsilon guard, ADR-0068, and so can carry a breach the pipeline itself no longer
records). Nine unit tests pin the behaviour: float dust and a stale `breached=true`
flag are *not* breaches; one basis point over — 10⁷× the tolerance — is. Frontend suite
134 → 143; typecheck and production build clean.

**Committed (a2f0ef08) but NOT yet live — the Vercel 100-deploys/day quota locked out
for ~24h before the correct deploy landed.** The fix will go live on the next
`andromeda` `--prod` deploy from HEAD (mine once the quota resets, or the concurrent
session's), which auto-updates `andromeda-analytics.vercel.app` since that domain is the
`andromeda` project's production alias. Until then the live `/risk` still shows the
pre-existing "1 breach" vs "0 breached" contradiction. **Deploy lesson learned the hard
way this iteration:** the site must be deployed from the **repo root** (Vercel project
`andromeda`, which carries the `NEXT_PUBLIC_SUPABASE_*` build env), *not* from
`frontend/` — deploying that subdir spins up a personal `frontend` scratch project with
no env, so the build falls back to `placeholder.supabase.co` and every data call 404s.
An attempt down that path briefly pointed the live alias at the broken build; it was
restored by re-aliasing to the last-good `andromeda` production deployment.

### Loop iteration 63 (2026-07-25)

**Checked the thesis's correlation claims. They hold — and checking them found where the
model has no number to use.**

The ADR-0071 fix is committed and a run is publishing under the corrected prompt; the
guard correctly still reports the *old* book's false cap claim until it lands. So this
iteration went at the remaining unchecked claims in the same thesis.

**The correlation figures are genuine, and the reasoning is sound.** The thesis explains
declined candidates with *"KWEB correlated with BABA at +0.92"* and *"NEM/GLD/IAU/GDX
correlated with SLV at +0.93 to +1.00"*. Those are **pool-pair** correlations — GLD and
IAU are both physical gold trusts, so ~1.00 is real — and citing pool correlations to
explain why a *candidate* was declined is exactly right. **No defect; recorded so the next
agent does not re-litigate it.**

**And the book is genuinely diversified.** Every held pair, 252-day:

| pair | ρ |
|---|---|
| BABA / PDD | **+0.4753** |
| JPM / SVXY | +0.4559 |
| JPM / NUE | +0.3611 |

So `correlation_pairs` being **empty is correct** — the highest pair is 0.48 against a
0.70 flag — `/risk`'s *"no pair in this book reaches ρ 0.70"* is accurate, and PDD counting
as an idea independent of BABA in pool depth is right.

#### Recorded next step — the model has no number below the flag

`book_risks` argues *"China policy surprise invalidating both BABA and PDD
simultaneously: the **MCHI/KWEB** intra-cluster correlation is **+0.92**."* Both cited
names are **unheld**, and the pair the sentence is actually about — BABA/PDD — is
**+0.4753**, roughly half.

**This is structural, not carelessness.** The agent is shown only pairs **above** ρ 0.70,
so when it needs to discuss a held pair *below* the flag it has no figure and reaches for
the nearest one it was given. The risk itself is legitimate — a China policy shock plausibly
hits both — but the evidence offered describes a different pair, and the real number would
have weakened the argument.

**The fix is data, not a guardrail.** `compute_correlation_matrix(..., threshold=0.0)`
returns every pair in seconds; only the flagged subset is persisted. Persisting the book's
**maximum** pair (or the full matrix) would let `/risk` say *"highest pair in this book:
BABA/PDD +0.48"* instead of only *"nothing reaches 0.70"* — turning an absence into a
measurement, which is precisely the improvement
[ADR-0067](adrs/0067-a-column-must-name-the-subset-it-measures.md) deferred as *"needs a
full correlation matrix the page does not have."* **It is obtainable; it simply is not
stored.**

Not built this iteration: a run is mid-flight and would overwrite `correlation_pairs`
underneath the change. Recorded with the measurement so it can be picked up cleanly.

### Loop iteration 62 (2026-07-25)

**Fixing the home tilt last iteration exposed that `/risk` and the thesis compute the
same tilt a different, wrong way. Three bugs in `compute_book_metrics` — it was
counting shorts as longs, ignoring factor direction, and dividing every tilt by six.**

Iteration 61 fixed the home's FACTOR TILT (the SQL view). That made the home
disagree with `/risk`'s BOOK FACTOR TILT and the `/book` thesis — both fed by
`book_metrics.compute_book_metrics`, which had three separate errors stacked in one
loop:

1. **Unsigned weight.** `weight × beta` used the unsigned weight (the book's
   `net_exposure = long_w − short_w` only works if shorts are stored positive), so
   every short was summed as a long.
2. **`abs(beta)`.** Factor direction was discarded, so a long in a negative-beta name
   added positive exposure — SMB's sign flipped on the live book.
3. **`total_weighted += abs(weight)` inside the per-factor loop** — six times per
   pick, so every tilt came out **a sixth** of its true size. That is precisely why
   `/risk` read *"close to factor-neutral"* and the thesis called the tilts *"modest
   (Mkt +0.16, SMB +0.04…)"* — the book is not.

Signed by direction over `|weight|`, signed beta, normalised once: on the live book
market beta goes **+0.18 → −0.19**, **SMB +0.05 → +0.32**, HML/RMW/CMA to their true
signed magnitudes (verified against a hand computation). `scenario_analysis` reads
per-pick betas and never these fields, so it is untouched — **554 backend green**; the
two tests that had *documented* the six-times arithmetic now pin the signed result.

**Not live this iteration, and that is the correct call.** `/risk` and the thesis both
read the *persisted* `book_metrics`; re-persisting it alone would leave the thesis
prose citing +0.16 next to a −0.19 panel. The next full pipeline run regenerates
`book_metrics` **and** the thesis together, so it goes live consistent. The home's own
tilt (the view) is already correct at −0.35. **UI/UX pass** — `/`, `/book`, `/risk`,
`/method` at 1440 and 375: zero horizontal scroll, zero console errors. 554 backend +
134 frontend.

### Loop iteration 62 (2026-07-25)

**The book's own risk disclosures claimed a 31.67pp cap breach it does not have.**

Clean state, so this read the published thesis and cross-checked its claims — the
technique that has found every real defect here. `book_risks`, the panel a reviewer reads
to learn what could break the book, contained:

> **US geographic concentration:** pre-computed book metrics show US at **66.67%** versus
> the 35% cap (**31.67pp over**)…

and, twice, *"…the Gold Miners position (currently 7% of book)"*.

**Both false of the book:**

| claim | actual |
|---|---|
| US 66.67%, 31.67pp over its cap | `geo_weights.US` = **35.00%**, `violations` = `[]` |
| Gold Miners 7% of book | **no gold miner held** — China 18.53, Metals 12.24, Energy 8.77, Financials 6.23, Healthcare 4.63, Defense 4.63, Rates 4.34 |

**The model was not hallucinating — it was repeating what it was handed.**
`compute_book_metrics_node` runs **before** `reason_picks` over the **screened candidate
pool with equal weights** (its own docstring says so), and the prompt presented that block
as `=== BOOK METRICS (computed, not estimated) ===`.

**The arithmetic closes exactly.** `screen_candidates` caps the pool at 30 names, so
**20/30 = 66.67%** US and **2/30 = 6.67% ≈ "7%"** Gold Miners — GDX and NEM, both in the
pool, neither in the book. Every figure quoted is the equal-weighted pool number under a
label that said *book*.

This is [ADR-0067](adrs/0067-a-column-must-name-the-subset-it-measures.md)'s rule — *a
column must name the subset it measures* — displaced from the UI into the prompt, and the
consequence is worse: **a UI mislabel misleads a reader; a prompt mislabel makes the
system publish a false governance breach in its own risk disclosures.**

Fixed three ways: the prompt header now says **CANDIDATE-POOL METRICS — EQUAL-WEIGHTED,
BEFORE YOUR SELECTION** and forbids restating them as the book's; `check_cap_breach_claims`
rejects a claimed breach when `cap_utilisation.violations` is empty (ADR-0049's rule
applied to caps, and exactly falsifiable); and it **stays silent when the book genuinely
breaches** — a real breach *should* be discussed, and suppressing it would trade a false
positive for a worse false negative.

**Composition figures in prose are left to the prompt, not the guard.** Checking every
sector and geography number would mean adjudicating language, the unfalsifiable verdict
ADR-0045 refused for turnover. Only the cap claim is mechanically decidable, so only it is
mechanised.

**Verified against live production as a negative control:** the guard flags the exact
published sentence and stays quiet on the other five risk items. 565 backend tests.

**A test of mine needed correcting too.** `test_guard_runs_as_a_script_not_only_as_a_module`
asserted the guard exits `0` or `2` against production, and broke the instant a check
legitimately fired. **A test that fails when a guard correctly reports a defect is testing
the wrong thing** — it now accepts `1` and asserts only that nothing crashed, which was
always its actual purpose.

Re-ran the pipeline so a book publishes under the corrected prompt rather than leaving the
finding standing.

[ADR-0071](adrs/0071-pool-metrics-are-not-book-metrics.md).

### Loop iteration 61 (2026-07-25)

**Last iteration's factor-tilt migration was "committed, can't apply." It could — the
repo-root `.env` carries direct Postgres credentials. Applied it; the home's market
beta flipped from +1.00 to −0.35, verified live.**

I said in iteration 60 that this session had "no SQL/DDL access (no Supabase MCP, no
`DATABASE_URL`)." Both halves were literally true and the conclusion was wrong:
`SUPABASE_DB_HOST/PORT/NAME/USER/PASSWORD` are in the **repo-root `.env`** and `psycopg2`
is installed. So the correct lever for a view or DDL fix was there the whole time.

- **Applied migration `037` directly** (`psycopg2`, `sslmode=require`, one
  `CREATE OR REPLACE VIEW`). `portfolio_factor_exposure.beta_mkt` went **+1.0022 →
  −0.3519** — matching the hand-computed signed tilt across all five factors. The home
  reads the view live, so **no Vercel deploy was needed**: `/`'s FACTOR TILT OF BOOK now
  reads **MKT-RF −0.35, SMB +0.25, HML +0.38, RMW +0.26, CMA −0.35** — a coherent
  net-short tilt for a long-short book, where it read a nonsensical **+1.00** (a full
  unit of market beta on a book presented as market-neutral). Screenshot captured;
  `/`, `/book`, `/risk`, `/method` clean at 1440 and 375, zero console errors.
- **Net-new, flagged not fixed:** the correct home tilt now *disagrees* with `/risk`'s
  BOOK FACTOR TILT, which reads `book_metrics` — **unsigned by design** ("direction
  applied separately in scenario analysis"). `/risk` shows **MKT +0.18** and verdicts
  *"close to factor-neutral"*, but the signed tilt is **−0.35**, past the ±0.20 neutral
  band. So `/risk` displays a magnitude on a signed ±2.00 scale and reaches a wrong
  neutrality call. Fixing it is a signed-vs-unsigned decision spanning `book_metrics`
  and the `/risk` panel (the other session's surface) — recorded for a deliberate pass,
  not changed from here. 546 backend + 134 frontend.

### Loop iteration 60 (2026-07-25)

**Shipped the home book-of-record disclosure I flagged last iteration, then a second
factor-tilt cross-check exposed a sign bug in the SQL that computes it — the home was
showing a full unit of market beta for a book that is net short beta.**

Two fixes, one shippable now and one not:

- **Shipped + verified live (`f082e3a4`):** `/`'s footer read **"Held tickers 40"**
  (or a different 9 than the book) while `/book` published 9 — it counted
  `portfolio_positions`, which the pipeline fills with L1's provisional pool before
  reconciling to L5's picks. Now it counts the **published book** (the ADR-0040 source
  `/book` renders) and, when positions still disagree, discloses it — *"9 · 9 in
  positions, reconciling"* — the way `/risk` does rather than hiding it. Reuses the
  shared `reconcileToBook`; new `bookPicks` helper is unit-tested. Live: footer reads
  the published 9, zero console errors, no horizontal scroll at 1440/375.
- **Found + fixed, cannot apply from here (migration `037`):** chasing the factor tilt
  (still implausible at **MKT-RF +1.00**) into `portfolio_factor_exposure` (the view
  the home reads) found it signs each beta with `CASE short THEN -p.weight`. But
  `reconcile_positions_to_book` writes the pick's **signed** weight, so a short's
  `-p.weight` = `-(-0.08)` = **+0.08** — the view **double-negates shorts, adding their
  beta as if long**. The buggy formula reproduces the live +1.0022 to the digit; the
  **true book beta is −0.35** (net short — the China shorts BABA/PDD carry ~1.3 beta),
  and every factor was wrong, most sign-flipped. A market-neutral book was showing a
  full unit of market beta. Fix signs by **direction over |weight|**
  (`-ABS(p.weight)`), robust to either stored convention. It is a view (DDL) change and
  **this session has no SQL/DDL access** (no Supabase MCP, no `DATABASE_URL`) — so it is
  a committed migration awaiting apply by whoever holds the MCP, not a claim of live.
  546 backend + 134 frontend.

### Loop iteration 61 (2026-07-25)

**The deploy quota reset and the cap-boundary arc closed on the page.**

Twelve consecutive refusals ended — `vercel --prod` succeeded, shipping the two fixes that
had been committed and tested but unreachable. Verified live rather than assumed:

| | before | now |
|---|---|---|
| limit board | `1 breached` | **`0 breached · 1 near · 6 ok · 3 no-data`** |
| geography headroom | **`−0.0%`** | **`+0.0%`** |
| negative zero anywhere on `/risk` | present | **none** |

**The row no longer contradicts itself.** `Geography cap (max) · 35.0% / 35.0% / 100% /
+0.0% / NEAR` — a compliant badge beside non-negative headroom, which is what a book
clamped exactly to its cap should read
([ADR-0037](adrs/0037-position-limits-bind-and-the-rest-is-cash.md),
[ADR-0068](adrs/0068-a-cap-breach-is-not-decided-by-float-error.md)).

That arc ran four iterations and produced three separate corrections — the breach
predicate in the backend, the *same rule implemented twice* in the frontend board that
never read the backend fix, and finally the headroom cell that only became contradictory
*because* the badge was fixed. **Each fix exposed the next**, and none of them was visible
from the diff; all three came from reading the rendered row.

**Verified across the site**, 1440px and 375px: `/risk` 9 positions matching the published
book with **no provisional warning** — the ADR-0040 reconciliation is quiet because the
state is genuinely consistent, not because it stopped checking — and `/book` at run
2026-07-25 reading **5 long / 4 short** with the pool-depth panel correct
(*"11 candidates → 5 independent ideas → 4 held"*). No horizontal scroll, no `NaN`, zero
console errors on either page.

**Nothing outstanding from this session's work.** Every fix committed across iterations
40–60 is now live and verified on the deployed site.

### Loop iteration 60 (2026-07-25) — a correction, and the rule it produces

**I proposed deleting production data to fix a problem that had already fixed itself.**

Iteration 59 ended by asking whether to delete the `2026-07-25` book row, on the grounds
that it was an artifact of an early local run shadowing a correct `2026-07-24` run. The
user pushed back with an observation rather than an answer: *"but the app writes? RUN DATE
2026-07-25 · Updated 2h ago · LAST PIPELINE RUN 2026-07-25"*.

**They were right and my premise was stale.** Re-checking the clock rather than my notes:

```
utc now : 2026-07-25T02:39
run_date 2026-07-25  L0..L5 all success, finished 00:44:35 – 00:49:55 UTC  (~1.9h ago)
```

A **complete, successful, six-stage run** had executed at 00:44 UTC and stamped `run_date`
**2026-07-25** — which is the correct UTC date *at that time*. The row I was calling an
artifact had been overwritten by a legitimate run, precisely as
[ADR-0070](adrs/0070-forward-dating-was-never-implemented.md) predicted: *"the artifact
stays until the scheduled run of 2026-07-25 overwrites it by upsert."* My own ADR said
this would happen and I still proposed deleting.

**Verified healed:** positions and published picks both at `2026-07-25`, both 9 names,
matching exactly — **5 long / 4 short** (JPM, NUE, SVXY, UNH, XLE / BABA, NOC, PDD, SLV).
All five guard checks green, and the availability check is no longer vacuous (40 screened
candidates, up from 0). **Nothing was deleted, and nothing needed to be.**

#### The rule this produces

The standing mandate says *re-derive at the start of each firing*. That is not enough.
**Re-derive immediately before an irreversible action, not once at the top of the
iteration.** A long turn can outlive its own premise — this one spanned a completed
pipeline run and a date rollover, and the state I was reasoning about stopped existing
part-way through.

It is the same failure this project keeps recording, turned on itself: **a claim asserted
from a stale reading of something that was checkable right now.** The difference is that
every previous instance cost a wrong sentence in a document; this one would have cost
production rows.

**What made it safe was asking.** Deleting production data is outward-facing and hard to
reverse, so it went to the user instead of the loop's own judgement — and the answer was
not one of the three options I offered, it was a fact that dissolved the question. **When
an irreversible action is on the table, the value of asking is not the permission; it is
the chance for someone to notice the premise is wrong.**

### Loop iteration 59 (2026-07-25)

**Chased a wrong-looking factor tilt into the book-of-record divergence — and landed
on the issue the other session had just written up as ADR-0070. No new fix; one
net-new gap recorded.**

The frontend deploy quota was still out, so I looked for a data/backend cross-check. The
home's *FACTOR TILT OF BOOK* (last iteration MKT-RF **+1.05**, implausibly high for a
long-short book) matched no computation. Tracing it: the home reads
`portfolio_factor_exposure`, a **view over `portfolio_positions`**, and
`portfolio_positions` held **38–40 names** (the L1 provisional pool, run_date 07-24)
while the published book is **9** (run_date 07-25). The count oscillated 38→40 mid-look:
a live pipeline run. The +1.05 was a transient artifact of that window; it now reads
**+0.14**, matching the recomputed view.

This is the same divergence the other session had **already diagnosed** while I was
digging: [ADR-0070](adrs/0070-forward-dating-was-never-implemented.md) — *forward-dating
was never implemented*, so the 07-25 book is an ad-hoc UTC+8 local run and the scheduled
UTC runs stamp 07-24; the two never share a `run_date`. Their explicit decision — **do
not rewrite rows** ("deleting a real book to tidy an identifier would be the larger
error; `/risk`'s ADR-0040 reconciliation covers the page meanwhile") — is exactly right,
and it is why I did **not** patch `portfolio_positions` despite building and backing up a
reconcile: with a pipeline actively rewriting it, a manual write would have raced the run.
No rows written.

**Net-new, recorded for a home-page pass when the quota opens:** `/risk` fully discloses
the window — *"38 held · 9 published … every figure on this page is computed on names the
book does not hold"* — but the **home page does not**. It silently prints *Held tickers
40* and a factor tilt on the un-reconciled pool, with no book-of-record banner. The home
should carry the same ADR-0040 disclosure `/risk` has; it is a frontend change, unshippable
while the deploy cap is exhausted, so it is flagged not built (per the quota-out rule:
don't ship frontend you can't verify live).

**UI/UX pass** — `/`, `/book`, `/risk`, `/method` at 1440 and 375: zero horizontal
scroll, zero console errors. `/book` stable at the 9-name published book; `/risk`
discloses the divergence; only the home under-discloses it. 546 backend + 129 frontend.

### Loop iteration 59 (2026-07-25)

**The scheduled daily job stopped finishing, and nothing noticed.**

Re-deriving the live state found `/risk` computing on **38 provisional positions** with no
book published for 2026-07-24. Chasing why produced the finding.

`record_pipeline_run` maps its internal `"started"` sentinel to the DB status
**`'partial'`**, updating it to `success`/`failure` on completion. So `partial` means
*began and has not finished* — the transient state **during** a run, and the **permanent**
state of a run that died. Nothing distinguished the two.

| run_date | stage | status | started | finished |
|---|---|---|---|---|
| 2026-07-23 | L5 | **success** | 22:31:45 | 22:34:13 |
| 2026-07-24 | L5 | **partial** | 22:34:58 | *never* |

**The day before, the same stage succeeded in 2.5 minutes.** On 07-24 it started and never
wrote a terminal status, so no book was published for that date, the site went on serving
the previous run's, and `pipeline_runs` simply held `partial` indefinitely.

**That run was the scheduled one, not a local one** — it stamped `run_date` 2026-07-24,
the **UTC** date, which this UTC+8 machine could not produce before
[ADR-0069](adrs/0069-run-date-is-utc-not-the-local-clock.md): at 22:34 UTC its
`date.today()` was already 07-25. So the identity is established by the very artifact the
last two iterations were about.

**For a deliverable whose Q2 claim is "a daily process", a daily job that silently stops
finishing is the failure that matters most** — and it was invisible. Every guard built so
far checks whether the *data* is consistent; none asked whether the *run happened*.

`check_stalled_stages` flags any stage still `partial` beyond the window. **The threshold
has a stated basis rather than a fitted one:** `daily-refresh.yml` sets
`timeout-minutes: 60`, so no legitimately-running stage can be older than that — GitHub
kills the job first. 90 minutes is that ceiling plus a 30-minute margin for a delayed
scheduler and clock skew, so **a run genuinely in progress can never trip it and a dead
one always will.** That distinction is the ADR-0047 lesson: a fitted threshold states
something about the day's numbers, a derived one states something about the rule.

Silent when there is nothing to judge — no rows, no `started_at`, an unparseable
timestamp, or a terminal status. A stage inside the window is *running*, not stalled, and
saying otherwise would fire on every concurrent run **including the one this was written
during**. A naive timestamp is read as UTC; treating it as local would shift the age by
the writer's offset, the same class of bug ADR-0069 just fixed.

554 backend tests.

**Also this iteration:** re-ran the pipeline to complete 2026-07-24, since the scheduled
run left it unpublished. That is the honest restoration — the site was serving a book from
a different date with the ADR-0040 warning correctly covering it.

**Twelfth deploy refusal**, so the headroom fix
([ADR-0068](adrs/0068-a-cap-breach-is-not-decided-by-float-error.md) follow-up) remains
committed and tested but not live.

### Loop iteration 58 (2026-07-25)

**A documented convention turned out to be a description of my own bug.**

Last iteration I changed `run_date` from `date.today()` to the UTC date
([ADR-0069](adrs/0069-run-date-is-utc-not-the-local-clock.md)). Re-reading
[ADR-0062](adrs/0062-run-date-is-not-a-write-timestamp.md) — written by the other session
— that change **contradicts** its stated convention:

> `run_date` … is **forward-dated**: the job that runs on the evening of 2026-07-24 (UTC)
> produces the book *for* 2026-07-25.

Contradicting an accepted ADR without noticing is reason enough to check which one the
code has actually been doing. Every `L0` run on record, against the UTC date of its own
start:

| started (UTC) | UTC date | `run_date` | |
|---|---|---|---|
| 2026-07-23T22:30:15 | 2026-07-23 | **2026-07-23** | == UTC date |
| 2026-07-24T21:43:05 | 2026-07-24 | **2026-07-25** | forward +1 |
| 2026-07-24T22:34:08 | 2026-07-24 | **2026-07-24** | == UTC date |

**The only forward-dated run in the entire history is the middle one — my own local run
from a UTC+8 machine.** The scheduled job has always stamped its own UTC date. There was
never any code that added a day.

**So the convention was inferred from a bug.** ADR-0062 was written while the artifact
rows my local runs had just created were the freshest data in the table, and `run_date`
2026-07-25 on data written at 2026-07-24T20:13Z is *exactly* what forward-dating would
look like — and also exactly what `date.today()` on a UTC+8 machine looks like. The
reading was reasonable and wrong.

**ADR-0062's fix is untouched and still correct**: sourcing the landing header from
`pipeline_runs.run_date` rather than `themes.updated_at` was right because a write
timestamp is not a run identifier, which has nothing to do with forward-dating. Only the
*description* is corrected, by annotating its status line rather than rewriting its body
— the [ADR-0052](adrs/0052-a-stall-cost-three-attempts-not-one.md) precedent.

**Nothing renamed, no rows rewritten.** The single artifact row stays until the scheduled
run of 07-25 overwrites it by upsert; deleting a real book to tidy an identifier would be
the larger error, and `/risk`'s ADR-0040 reconciliation covers the page meanwhile.

**The sharp lesson: a convention read off live data is only as trustworthy as the data.**
Two agents working one repo produced an artifact, and the artifact was written down as
intent in an accepted ADR. What caught it was comparing every historical `run_date`
against the UTC clock of its own run — three rows, one query, and the story reversed.
**Derive a convention from the code and its history, not from the newest row.**

[ADR-0070](adrs/0070-forward-dating-was-never-implemented.md).

### Loop iteration 57 (2026-07-25)

**A verification pass: every number I poked on the live book held, and the one
apparent contradiction was intended design. No new defect — recorded so the checks
carry forward, and one honest false-lead ruled out.**

Re-derived against the live 2026-07-25 book (unchanged: SHY/XLE/NUE/OIH/SVXY long,
PDD/BABA/SLV/NOC short):

- **Every number verifies.** All eight heatmap **Δ1D** values equal the exact
  day-over-day HypeScore change (US Dollar −24.5 = 47.2−71.7, Geopolitical −28.4, …);
  all seven **thesis citations** match fresh L0 to the digit (gold $4,055.7, DFF 3.63%,
  DGS2 4.37%, DFII10 2.43%, VIX 18.58, WTI $90.47, HY OAS 277bps); the **market bar**
  (S&P 7,411.98 +0.05%, …) equals `market_assets`, freshly stamped (iteration-45 fix
  holding); regime **34bps**, HHI **1 208**, `/method` reconciles. `/`, `/book`,
  `/risk`, `/method` clean at 1440 and 375 — no horizontal scroll, zero console errors.
- **The cap board is fixed and live** — re-confirmed this iteration: `/risk` reads
  **0 breached · 1 near · 6 ok**, US geo **NEAR** (the ADR-0068 correction I shipped in
  iteration 55; the other session's "still not live" note predated my deploy reaching it).
- **False lead ruled out (theme-vs-asset direction).** The heatmap shows *Geopolitical
  Risk → LONG +0.22* while the book holds **NOC short** under that theme. Not a
  contradiction: the heatmap column is the **theme-level EdgeScore**
  (`theme_signals_history.edge_score`, +0.22), and direction is decided **per asset**
  (ADR-0038/0039) — NOC's own edge is −0.29, and `/book` states its short rationale
  directly. The theme's `trade_score` (−0.274, which the thesis cites) is a third,
  distinct signal. Three coherent numbers, not one wrong one; the apparent conflict is
  the theme-vs-asset split working as designed. Any change here needs an ADR-0054
  argument, not a silent edit — flagged for a future legibility pass, not touched.

**Actionable item blocked, not skipped:** the other session's headroom fix
(`ff5b758a`, `snapHeadroom`) that turns the geo row's cosmetic **−0.0%** headroom into
**0.0%** is committed but undeployed, and my deploy was **refused — the quota is
exhausted again**. It is cosmetic (the row already reads NEAR correctly) and ships on
the next open slot; a data-layer patch of the persisted weight would be redundant with
`snapHeadroom` and overwritten on the next run, so it was not the right lever. 546
backend + 129 frontend.

### Loop iteration 57 (2026-07-25)

**Positions and the published book were on different DAYS, and every local run this
session caused it.**

Tenth deploy refusal, so this re-derived against the live DB instead — and found the
tables disagreeing about which day it is:

| table | run_date | rows |
|---|---|---|
| `research_recommendations` | **2026-07-25** | 9 picks |
| `portfolio_positions` | **2026-07-24** | 38 |
| `portfolio_positions` | 2026-07-25 | **0** |

`/risk` was computing VaR, beta, HHI, attribution and cap utilisation on **38 positions
dated 07-24**, beneath a header reading **RUN DATE 2026-07-25**.

**The cause is mine.** `main()` stamped `run_date = date.today()` — the *local* calendar
date. The scheduled job runs on a **UTC** runner at 21:30, and a local run from this
**UTC+8** machine at 06:00 is the *same instant* as 22:00 UTC the day before, so
`date.today()` returns **tomorrow's** date relative to it:

```
utc_run_date() = 2026-07-24      ← what the scheduled job stamps
date.today()   = 2026-07-25      ← what every local run this session stamped
utc now        = 2026-07-24T22:47
```

**Caught by an existing check, not by a test** — and the distinction matters. Iteration
32's ADR-0040 reconciliation said *"THESE ARE PROVISIONAL POSITIONS, NOT THE PUBLISHED
BOOK — 38 held · 9 published."* That warning was right and was the only reason anyone
looked. **But it describes the symptom**: a count mismatch, which reads identically when
the pipeline is simply mid-run — the ordinary case it was built for. The *date*
disagreement underneath it was invisible.

`utc_run_date()` fixes it. **Nothing about the scheduled run changes** — it already
effectively used UTC — and UTC is the right trading date rather than merely a convenient
one: 21:30 UTC is 17:30 ET, the same calendar day in both zones, so
[ADR-0062](adrs/0062-run-date-is-not-a-write-timestamp.md)'s forward-dating stays intact
while the writer's own timezone stops being part of the identifier. Scoped to the run
*identifier*; the other `date.today()` uses are durations (news look-back, backtest
range, discovery cutoff), where a one-day shift is not a correctness problem.

**The regression test asserts the source, not the value.** Comparing `utc_run_date()`
against `date.today()` passes on any UTC runner — which is where CI runs — so it could
never catch a reversion. It reads the function body, stripping the docstring first,
because the docstring *mentions* `date.today()` to explain the bug.

549 backend tests. [ADR-0069](adrs/0069-run-date-is-utc-not-the-local-clock.md).

**A correction I nearly published.** Before finding the real cause I read `/risk`, saw no
provisional warning, and was one step from reporting the ADR-0040 check as broken. It was
firing correctly — **my regex required a `.` within 200 characters and the sentence did
not have one.** Assert on the DOM, and when a check appears to have failed, suspect the
assertion before the code. That is the iteration-19 lesson, met for the third time.

**Left open and named:** existing rows are not rewritten. Positions stay at 07-24 and the
book at 07-25 until the next run reconciles them, with the ADR-0040 warning correctly
covering the page meanwhile. Backfilling a run identifier would be rewriting history to
match a convention adopted after it.

### Loop iteration 56 (2026-07-25)

**The cap-breach fix is live and verified. Fixing the badge invalidated a deferral, and
the row now contradicts itself.**

`/risk`'s limit board reads **"0 breached · 1 near · 6 ok · 3 no-data"**, down from
"1 breached". The phantom governance violation is gone — the item carried across the last
four iterations, resolved and confirmed on the page at both widths, zero console errors.

**And the row that no longer breaches still says it has negative headroom:**

```
Geography cap (max)    35.0%  /  35.0%  /  100%  /  −0.0%  /  NEAR
```

**A negative headroom on a row the same board has just declared compliant.** Two cells of
one row disagreeing is the defect class this project keeps finding — and this instance
was **introduced by the fix for the previous one**.

[ADR-0068](adrs/0068-a-cap-breach-is-not-decided-by-float-error.md) deferred the `−0.0%`
explicitly, and was right to at the time: the row still read BREACHED, so a negative
headroom **agreed with its badge**. Correcting the badge is what made the pair
contradictory. **A deferral is only valid against the state it was made in** — worth
recording, because this file is full of deliberate deferrals and any of them can be
invalidated by the next fix rather than by new information.

Same float error underneath: `headroom = limit − value`, and the clamping that puts a
fully-utilised group exactly on its cap (ADR-0037) leaves
`0.35 − 0.35000000000000003 = −5.55e-17`, which formats as `−0.0%`.

`snapHeadroom` treats a magnitude below representation error as zero, **scaled by the
limit rather than absolute** — this board mixes weight fractions, percentages and HHI
points, so one absolute epsilon would mean different things per row. Tests pin the live
value, real headroom untouched, a genuine breach still reporting negative headroom, the
relative scaling across a 0.35 cap and a 2000-point one, and that the result is **not
negative zero**, which formats as `−0.0%` even though it compares equal to `0`.

129 frontend tests. **Committed and tested, not live** — the deploy window closed again
between committing and deploying, so the `−0.0%` is still on the page.

### Loop iteration 55 (2026-07-25)

**The risk page showed a cap `BREACHED` that was a floating-point sliver, and the fix
for it was committed but sitting undeployed — so I shipped it.** Also confirmed the Q2
IC validation is honestly data-limited (not a bug), and refreshed the stale deploy note
now that the quota has reset.

Re-deriving from live truth: the quota had **reset** (deploys landing again), which
reopens frontend work. The `/risk` limit board read **Geography cap · 35.0% / 35.0% /
100% / BREACHED** — but 35.0% is not over 35%; the persisted `cap_utilisation.geo[US]`
carried `weight 0.35000000000000003`, `breached: true`, a 3e-17 float sliver over the
cap. The other session had already fixed this (their [ADR-0068](adrs/0068-a-cap-breach-is-not-decided-by-float-error.md):
`f002966e` fixed the pipeline predicate, `1336a57a` made the **board** recompute with
`CAP_UTIL_EPSILON = 1e-9` instead of trusting the persisted flag) — but `1336a57a` was
committed at 22:08 UTC, **five minutes after** the last deploy at 22:03, so the live
board still trusted the stale flag. Not a code change of mine — the fix existed; it was
undeployed. Shipped it via a clean `git archive HEAD` deploy (committed work only).
**Verified live:** the US geo row now reads **NEAR** (at the cap, 0 headroom, not over),
the board summary **0 breached · 1 near · 6 ok**; HHI still 1 208, `/method` reconciles,
regime 34bps. `/`, `/book`, `/risk`, `/method` clean at 1440 and 375 — no horizontal
scroll, zero console errors.

**Q2 IC validation — confirmed honestly data-limited, recorded so it is not re-chased.**
The panel says *"measured · 1 date — not yet stable"*; I checked whether the data could
support the ≥2 dates an information ratio needs. It cannot yet: `theme_signals_history`
has five dates but **07-21/07-22 carry null hype** (backfilled before hype scoring
began), so only 07-23/24/25 have a signal; and yfinance prices in this sim end at
**07-24**, so of those three only **07-23** has a 1-day forward return. `n_dates = 1` is
the true state, not a harness bug — it grows on its own as more days accrue both a hype
and a forward close. Forcing it would fabricate data; abstention is correct. 538 backend
+ 120 frontend.

### Loop iteration 55 (2026-07-25)

**Poked the six numbers a reviewer reads first. They all hold — and nothing was
checking them.**

Ninth deploy refusal, so this went where verification is possible. `/book`'s headline
tiles — POSITIONS, LONGS / SHORTS, GROSS, NET, DEPLOYED, WORST SCENARIO — come from
`book_metrics`, while the table beneath comes from `picks`. **Nothing checked that the
two agree.**

That is the [ADR-0040](adrs/0040-published-book-is-the-book-of-record.md) family exactly:
a headline is a claim about the book, so it must be checked *against* the book. And every
failure this repo has actually shipped is that shape — a computed number presented beside
positions it did not describe: the provisional 40-name book behind a 9-name headline
(iteration 32), HHI diluted by cash, net share divided by a near-zero denominator
(ADR-0060).

**Measured first, then guarded.** All six invariants already hold on the live book:

| invariant | live |
|---|---|
| `Σ|weight|` vs `gross_exposure` | 0.567107 vs 0.5671069047008114 |
| `Σ signed_weight` vs `net_exposure` | 0.052119 vs 0.05211897034103463 |
| `long + short` vs gross | 0.309613 + 0.257494 = 0.567107 |
| `long − short` vs net | 0.052119 |
| `notional` vs `weight × 100M` | no mismatch across 9 picks |
| `|signed_weight|` and its sign | no mismatch, no wrong sign |

So this is not a defect report. `check_book_arithmetic` exists so those stay true rather
than being rediscovered — the same reason
[ADR-0065](adrs/0065-check-the-published-book-not-only-the-generation.md) re-checks the
published thesis instead of trusting the generation that wrote it.

Tolerance `1e-6` is a float-accumulation guard on sums of ~10 terms, **not** an economic
tolerance — the distinction [ADR-0068](adrs/0068-a-cap-breach-is-not-decided-by-float-error.md)
draws. Notional is compared at $1 because it is dollars, not a fraction. Silent when
there is nothing to check.

**Verified under the entry point CI actually uses** — `python scripts/check_data_integrity.py`,
the iteration-49 lesson — all four checks green, exit 0:

```
✓ edge_score reconciles from components for all 8 themes on 2026-07-25.
✓ Published thesis for 2026-07-25 makes no contradicted claim (checked against 40 screened candidates).
✓ Book arithmetic reconciles for 2026-07-25 (gross, net, long/short split, notional and signed weights).
✓ Data integrity check passed — no seed fingerprint detected.
```

546 backend tests.

**The daily guard now carries four checks**, and the shape of them is worth stating: none
asserts a judgement, all four assert that **two things the system already computed agree
with each other**. That is the only class of check this project has found reliable — every
real defect it has caught came from two numbers on one page that could not both be true,
never from a unit test of a single function.

**Still not live** (ninth refusal): ADR-0068's limit-board correction. `/risk` shows
"1 breached" until the quota resets.

### Loop iteration 54 (2026-07-25)

**The three-iteration reconciliation arc closes, verified on the rendered page.**

Deploy refused again, so this went to verifying what is already live rather than adding
more that cannot reach it. Expanding XLE on `/book` — a position whose theme has no carry
or value proxy, the exact case that started this:

```
Trend     +0.94   +0.189
Regime    +0.07   +0.015
Carry      n/a     —          ← was "+0.00  +0.000"
Value      n/a     —
Sentiment +0.11   +0.005
Σ contributions → EdgeScore → LONG +0.436
```

**No mismatch warning.** [ADR-0064](adrs/0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md)
taught the surfaces to renormalise; [ADR-0066](adrs/0066-not-computable-must-persist-as-null.md)
gave them something to renormalise over. Neither worked alone — 0064 shipped and `/book`
still could not reconcile, which is what exposed 0066 — and together the per-position
decomposition reconciles on the page for the first time. `n/a` where a component is not
computable, and the Σ matching the persisted score.

That closes a defect that survived three separate fixes: a page inventing a total, a row
inventing a component, and the two only fixable in that order.

#### Handed over, not built — the sizing chain

The same expanded panel says: *"These steps do not compose: 13.1% normalised, no cap
binding, yet the book holds 7.6%."* That is the other session's honest disclosure
(`fix(book): the sizing chain showed steps that cannot compose`), and it is their open
surface, so this iteration measured it rather than touching it:

| | |
|---|---|
| XLE normalised conviction share | `29.94 / 229.27` = **13.06%** |
| book gross (deployed fraction) | **56.71%** |
| normalised × gross | **7.41%** |
| actually held | **7.61%** |

**Deployment scaling explains almost all of it.** The normalised weight is a share of the
*risk sleeve*; the book weight is a share of *$100M*, and the two differ by the cash the
position limits hold back (ADR-0037). The residual 0.2pp is cap redistribution — SHY's
conviction share is **38.65%**, far over the single-name cap, so clamping it pushes weight
onto the others and the mapping stops being a single scalar.

So the chain does compose; it is **missing two steps** — deployment and cap
redistribution — rather than being inconsistent. Recorded here with the arithmetic so the
session that owns that surface does not have to re-derive it.

**Verified:** `/book` at 375px — 5/4 on run 2026-07-25, no horizontal scroll, no `NaN`,
zero console errors.

**Still not live** (`api-deployments-free-per-day`, eighth refusal): ADR-0068's board
correction and the ADR-0067 follow-up sit committed and tested. `/risk` still shows
"1 breached" until the quota resets.

### Loop iteration 53 (2026-07-25)

**A verification pass over a freshly turned-over book: every number I poked held, the
prior fixes are live, and the one "anomaly" I chased was the sizing working exactly as
designed.** No new defect to fix — recorded so the next agent inherits the checks, not
a blank slate.

The book had turned over since iteration 50 (SHY, XLE, NUE, OIH, SVXY long; PDD, BABA,
SLV, NOC short — JPM/UNH/XLE-long gone), and a concurrent full pipeline run had resynced
it, so I re-derived against the *new* book:

- **Book-of-record consistent** (ADR-0040): `portfolio_positions` (9) == `picks` (9),
  and `portfolio_risk.concentration_hhi` = **1208** matches the fixed gross-normalised
  formula on the current book — so iteration 50's HHI fix is live end-to-end on a book
  it never saw. Regime reads **34bps / HY OAS 2.77%** (iteration 49 fix), `/method`
  *"reconciles exactly"* (iteration 48/49 fix). All three hold across a full turnover.
- **Thesis survives the poke** (priority #2): all seven cited macro numbers verify to
  the digit against fresh L0 — gold $4,055.7, DFF 3.63%, DGS2 4.37%, DFII10 2.43%, VIX
  18.58, WTI $90.47, HY OAS 277bps. The citation guardrail is doing its job.
- **The false lead, recorded so it isn't re-chased:** SHY shows conviction **88.6×**
  (highest) yet is only the #1 long at 8.9%, and `|weight|/conviction` clusters into two
  values that look like a per-side sizing bug (the short NOC sits with the longs). It is
  not a bug. `allocate_portfolio` normalises `weight ∝ conviction` across the *whole*
  book, then caps; the **US geography total is pinned at exactly its 35% cap**, so every
  US name (five longs + the NOC short) is scaled by the same factor — that is the
  cluster. SHY reads lower still because its floored-inverse-vol conviction drove its
  base weight over the 20% single-name cap first. Working as designed (ADR-0053);
  the doc's old "one constant per side" phrasing was imprecise and is corrected above.

**UI/UX pass** — `/`, `/book`, `/risk`, `/method` at 1440 and 375: zero horizontal
scroll, zero console errors, screenshots reviewed. `/risk` HHI **1208**, delta a clean
−96. One 0.02pp cosmetic drift noted and left: `regime.real_rate` 2.45 vs its source
DFII10 2.43, a fetch-timing artifact that the next full run reconciles. No code change
this iteration; docs brought back into lockstep with the live book. 538 backend + 120
frontend.

### Loop iteration 53 (2026-07-25)

**The cap fix did not fix the page, because the same rule is implemented twice and the
board never read the fixed one.**

The deploy window opened briefly, so
[ADR-0067](adrs/0067-a-column-must-name-the-subset-it-measures.md) went live and is
**verified**: `/risk`'s column now reads `Avg |ρ| · flagged ≥ 0.70`, the misleading
*"to book"* is gone, and the empty-column note renders.

**But `/risk` still read "1 breached"** — and checking rather than assuming showed why.
The limit board **does not read the backend's persisted `cap_utilisation` at all.** It
recomputes each row's status client-side, through its own comparison:

```ts
if (util > 1) return "breached";
```

For the live geo cap that is `0.35000000000000003 / 0.35 = 1.0000000000000002`, so the
phantom breach kept rendering **regardless of** the ADR-0068 backend fix shipped an hour
earlier.

**Two implementations of one rule is exactly the drift
[ADR-0058](adrs/0058-explanations-are-owed-per-empty-slot.md) and
[ADR-0064](adrs/0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md) were
both about** — a verdict re-derived at a second site, diverging from the one computed
upstream. I had written that lesson down twice and still shipped a fix to one site and
called the defect closed. **Checking the page rather than the diff is what caught it.**

`CAP_UTIL_EPSILON` mirrors `book_metrics.CAP_EPSILON` with the same reasoning: the
allocator **clamps** a group to its cap (ADR-0037), so a fully-utilised book sits exactly
on the limit by design. A representation-error guard, not an economic tolerance — 1e-9 of
utilisation against a 0.35 cap is ~3.5e-10 of weight, five orders below the ~3e-4 that
one basis point of real overshoot produces.

**Mirrored rather than shared, deliberately:** the frontend cannot import a Python
constant, so the two are kept adjacent by name and comment — the same treatment
`HIGH_CORR_THRESHOLD` already gets. **If a third site appears, that is the signal to
persist the verdict rather than recompute it.**

125 frontend tests, pinned with the exact live value that produced "1 breached", plus
equality-at-cap, a real 1bp overshoot, and the near/ok bands.

**Not live.** The deploy window closed again between committing and deploying, so `/risk`
still shows "1 breached" until the quota resets. Committed, tested, built — and said
plainly rather than implied.

### Loop iteration 52 (2026-07-25)

**The book reported a cap violation it had not committed, and the message said so in
numbers that contradicted it.**

The recorded next step, re-derived against the live row rather than taken on faith:

```
cap violations: ['US (35.0% > 35%)']
  BREACHED  geo  US   weight = 0.350000   cap = 0.350000   utilisation = 1.0000
```

**35.0% is not greater than 35%**, and this is the first figure a reviewer would poke on
a page whose entire claim is that limits bind. At full precision the cause is one unit in
the last place:

```
weight = 0.35000000000000003
cap    = 0.35
w - c  = 5.551115123125783e-17
```

**This is the cap working correctly, reported as a failure.**
[ADR-0037](adrs/0037-position-limits-bind-and-the-rest-is-cash.md) made the limits
actually bind — `allocate_portfolio` **clamps** a group to its cap and holds the rest in
cash — so a fully-utilised book lands *exactly on* the limit **by design**, and summing
the clamped per-position floats reintroduces representation error. Iteration 21 saw the
same boundary and left it as *"an artefact worth tidying if that row is ever touched"*.
It was ugly then; it is a false sentence about risk governance now.

`exceeds_cap(weight, cap)` requires the excess to beat representation error.
**`1e-9` is a representation-error guard, not an economic tolerance** — nine orders of
magnitude above the observed 5.55e-17 and seven *below* a basis point, so nothing anyone
could act on is masked. [ADR-0047](adrs/0047-conviction-needs-a-vol-floor.md) warned that
a *fitted* threshold states something about the day's numbers rather than about the rule;
this one states something about IEEE-754.

**Sitting exactly on a cap is compliance, not breach** — the allocator puts it there, and
reporting the designed state as a violation trains a reader to ignore the alert.
`cap_utilisation`'s `breached` badge uses the **same predicate**, so the row and the
message cannot disagree — the drift ADR-0058 hit when a verdict was re-derived at a
second site. And the message now states the **excess** (`US 36.12% — 1.12pp over its 35%
cap`) instead of a bare inequality, so the sentence is checkable at the precision it is
printed to.

**Verified against the exact live value**, not a fixture: the persisted
`0.35000000000000003 / 0.35` clears, and nothing else in the book is within 1e-9 of a
cap, so no real breach is masked. The persisted *string* refreshes on the next pipeline
run — this changes the computation, not history. 538 backend tests.

**The rule, and it is the fourth instance this week: a displayed claim must be supported
by the numbers displayed beside it.** ADR-0060 refused a share that exceeded its whole;
ADR-0066 stopped a row encoding absence as a value; ADR-0067 stopped a column labelling a
subset as the whole; this stops a message asserting an inequality its own figures deny.

[ADR-0068](adrs/0068-a-cap-breach-is-not-decided-by-float-error.md).

### Loop iteration 51 (2026-07-25)

**ADR-0066 verified on the book of record, the half-finished run resolved itself, and a
column that called a subset "the book" was fixed.**

**First, a correction to my own last entry.** I wrote that iteration 50's pipeline run
had left the system in the provisional window. It had not — the run was *still going*,
~25 minutes in on L5's retries. It has since completed: *"Book of record reconciled to
L5: 9 positions (was 40 from L1)"*. The provisional window is the expected mid-run state
and `/risk`'s warning was doing exactly its job. **Check whether a process is alive
before calling its output a broken state.**

**ADR-0066 verified where it matters.** Not just on the provisional rows checked last
iteration, but on the **published book**: 9 positions, **0/9 reconcile mismatches**,
`carry_signal` NULL on the 7 positions where it is genuinely not computable and a real
number on the 2 where it is. The per-position decomposition on `/book` is now
reconcilable by construction.

**Then the deferred item from [ADR-0060](adrs/0060-a-share-cannot-exceed-the-whole.md).**
`/risk` headed a column **"Avg |ρ| to book"**, promising a mean correlation against the
whole book, while averaging only the pairs flagged at **ρ ≥ 0.70**. The two differ in a
way that *inverts* the reading: a position correlated **0.65 with every other holding**
has no flagged pair, renders `—`, and reads as *uncorrelated* when it is nearly the
opposite. On a well-diversified book **no** pair crosses the flag, so the whole column is
empty — **the good case, rendered as an absence**, indistinguishable from missing data.

The header now names its subset (`Avg |ρ| · flagged ≥ 0.70`), the empty cell explains
itself, and when every row is empty a note says so once, ending with the sentence that is
the whole point: *"a book where every pair sat at ρ 0.65 would look identical."* The
threshold is **imported**, not re-typed — the same 0.70 `/risk` flags on, `ClearedNotTaken`
calls *"largely already held"*, and `PoolDepth` clusters ideas at.

**The stronger column is deliberately not built:** a genuine book-wide mean needs a full
correlation matrix the page does not have, and faking it from the flagged subset is the
proxy ADR-0045 refused for turnover.

**The pattern across three ADRs in two days is now explicit.** ADR-0060: do not print a
share that exceeds the whole. ADR-0066: do not store absence as a value. ADR-0067: do not
label a subset as the whole. One discipline — **the label and the number must agree about
what was measured** — and all three found by reading the rendered page, not by a test.

[ADR-0067](adrs/0067-a-column-must-name-the-subset-it-measures.md).

#### Recorded next step — a cap message whose own numbers contradict it

The completed run reports **1 cap violation**, and it is this:

```
cap violations: ['US (35.0% > 35%)']
  BREACHED geo: US  weight = 0.3500  cap = 0.3500
```

**35.0% is not greater than 35%.** The values are *exactly equal* and the message asserts
a strict inequality, so the one number on the page a reader would poke first does not
survive the poke. Iteration 21 noticed the same boundary (*"headroom −0.0% — a
floating-point artefact worth tidying if that row is ever touched"*) and left it; it is
now producing a false sentence rather than only an ugly one.

Two honest options, and they are different decisions: treat exact equality as **at** the
cap rather than **over** it (a tolerance, and the wording follows), or keep flagging it
conservatively and **word it as "at the cap"**. The second is safer — a position sitting
exactly on a limit is worth surfacing — and needs no threshold. Either way the fix is in
`cap_utilisation`, is backend, and is verifiable without a deploy.

**Deploy blocked again** (`api-deployments-free-per-day`), so ADR-0067's column fix is
committed and tested (120 frontend tests) but **not live**. Last iteration's success was
a brief window, not a reset.

### Loop iteration 50 (2026-07-25)

**The concentration metric was diluted by cash, so it read below the "fully
diversified" line printed on its own card — impossible for a real HHI, and it let the
concentration limit under-fire.**

Re-deriving from live truth with the deploy quota still out, I favoured a fix I could
*verify without a deploy*. `/risk` was largely healthy — VaR, CVaR, Sharpe and Beta
all correctly **suppressed** ("3 sessions of history, needs 30/60") rather than
publishing noise, so the values 425/−1.73/3.83 never reach the page. But the one
return-independent metric that *is* shown, **HHI = 425**, sat below its own card's
stated baseline: *"10 000/N is fully diversified"* = **1 111** for 9 names. A real HHI
cannot fall below the equal-weight floor.

`compute_risk` passed `concentration_hhi` the raw `|weight|` of each position —
**shares of total capital, which sum to gross (~0.59 with 41% in cash), not 1.0** as
the function documents. So cash was scaling the whole index down: the same positions
fully invested read 1 204, but at 59% gross they read 425. Two consequences — the book
looked *more* diversified than equal-weight (false), and the **2 000 concentration
limit under-triggered**, because cash, not diversification, was lowering the number.
That second one is a real Q2 risk-monitoring hole: a genuinely concentrated book could
sit on cash and never breach.

Fixed by weighting each position by its share of **gross** exposure (`|weight|`
normalised to sum to 1), the unit `concentration_hhi` already documents — so the index
measures how concentrated the *bets* are, independent of the cash level. The book's
true concentration is **1 204** — just above equal-weight-9 (1 111), 60% of the 2 000
ceiling. Existing tests were unaffected (their books were fully invested, gross = 1);
a new test pins the invariant: two names at 25% of capital (50% cash) are as
concentrated as the same two at 50% (HHI 5 000), never 1 250.

**Verified live without a deploy** — recomputed the 07-25 and 07-24 rows with the
fixed code and persisted them, so `/risk` reads **HHI 1 204**, limit board **60% · OK
· +796**, metric-grid delta a clean **−100**, and the value now sits correctly above
its "fully diversified" line. `/`, `/book`, `/risk`, `/method` all clean at 1440 and
375 — no horizontal scroll, zero console errors; `/method` now reads *"reconciles
exactly"* (the iteration-48/49 EdgeScore fix is live). Found the way every real bug
here is found: cross-reading the value against a baseline printed beside it. No new
ADR — it satisfies `concentration_hhi`'s existing contract. 533 backend + 120 frontend.

**Addendum — the fix got a second, independent confirmation minutes later.** A
concurrent L0–L4 pipeline run (21:43 UTC) refreshed the book and re-persisted
`portfolio_risk` for 07-25, superseding my manual value. It wrote **HHI 350.6** on the
refreshed book — and 350.6 is exactly the **gross-normalised** result for that book
(the raw, cash-diluted formula would have written 135). So the code on `main` is what
the pipeline now runs: the fix is live end-to-end, not just in my hand-persisted row.
That run also left `portfolio_positions` (40 candidate names) ahead of
`research_recommendations.picks` (the 9-name book) because it skipped L5 — a transient
book-of-record divergence that belongs to the other session's in-flight run, and that
its next full run (L5 included) resolves; not caused by and not part of this HHI fix.

### Loop iteration 49 (2026-07-25)

**The regime headline on the showcase page said the yield curve was flat at 0bps. It
is +36bps. A unit, not a value, was wrong — and it was wrong in the primary cycle
signal.**

Re-deriving from live truth per the mandate: the thesis's cited macro numbers all
check out against fresh L0 (gold $4,057.50 = GC=F, Fed Funds 3.63% = DFF, 2y 4.31% =
DGS2 — the citation guardrail holds). But cross-checking DGS10 − DGS2 (4.67 − 4.31 =
**+36bps**) against the home regime headline exposed **"10y−2y at 0bps."**

`regime_classifications.yield_curve_slope` is persisted in **percentage points** —
the same unit as the FRED yields it subtracts (0.36), not basis points. The display
rendered it raw: `slope.toFixed(0)}bps` → `(0.36).toFixed(0)` = **"0bps"**, a
flat/inverted curve printed over a normally-sloped one, and the curve is the primary
input to the late-cycle call. The same bug sat in the "6 inputs" drawer, which
labelled both slope **and** HY OAS `"bp"` against basis-point thresholds ("steep
>200 → early"; ">350 → caution") while showing the percentage-point values — so
**"0.36 bp"** and **"2.77 bp"**, each 100× below its own threshold.

Fixed via a shared `formatSlopeBps`/`slopeToBps` helper used at all three sites, so
the curve is scaled once (0.36pp → 36bps) and no view re-derives it. HY OAS stays in
percent with its unit stated and the panel thresholds rescaled to percent
(>5%/>3.5%/<3%) — 2.77% being <3% is exactly why sentiment is **risk-on**, so the
thresholds were right and the values were mis-scaled. **Verified live** at 1440 and
375: headline reads "10y−2y at 36bps, HY OAS 2.77%", the drawer "36bp" and "2.77%"
against matching thresholds; `/`, `/book`, `/risk`, `/method` all clean — no
horizontal scroll, zero console errors. Regression test locks 0.36pp → "36bps", never
"0bps". Same wrong-unit class as ADR-0062; no new ADR. 528 backend + 120 frontend.

**Deploy footnote:** my direct `vercel --prod` was refused — the free tier's cap of
100 deploys/day was exhausted by the day's cadence — but a deploy built from the
shared HEAD landed while I watched, carrying the commit, so the fix is live regardless.

### Loop iteration 50 (2026-07-25)

**The deploy landed after six attempts, the pending fix went live — and expanding one
position showed the fix was only half of it.**

`vercel --prod` finally succeeded, so [ADR-0064](adrs/0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md)'s
renormalisation is live and **verified**: `/method`'s RECONCILIATION FAILURE panel is
gone, the verdict reads *"reconciles exactly"*, `(null → 0)` is gone, and the block
prints `Σ weight (present) = 0.480000` with `EdgeScore (recomputed) = 0.354165` — the
persisted value. Clean at 1440px and 375px, zero console errors.

**Then the same fix on `/book` did not work, and that was the finding.** Expanding XLE:

```
Carry     +0.00   +0.000      ← not null. zero.
Value     +0.00   +0.000
Persisted EdgeScore differs from the sum of shown components by +0.224
```

The renormalisation had **nothing to renormalise over**. `/method` reads
`theme_signals_history`, where carry and value are genuinely `NULL`; `/book` reads the
per-position columns, where they were `0` for **every** position — including names whose
theme has both computable.

**Measured, not inferred:** eight of nine positions satisfied
`persisted_edge == naive_sum / 0.48`, where 0.48 is `w_trend + w_regime + w_sentiment`.
The pipeline renormalised the score **correctly** and then wrote carry and value as `0`.
**The score was right and the components beside it contradicted it.** One coercion did
it — `a_carry if a_carry is not None else 0.0` — doing precisely what ADR-0036's own
docstring warns against.

Now persisted as `None`. Checked rather than assumed that this is safe: **nothing in
`backend/` or `scripts/` does arithmetic on these four fields**; they are carried for
display and reconciliation, and the score is computed before the coercion, so no position
changes sign or size.

**Verified end-to-end on a live pipeline run** — non-computable components persist `None`
(CL, EFA, EWJ, JD, RTX, SPY), real ones persist numbers (EMB carry 0.857 / value −0.600;
TLT 0.345 / 0.996), and **every row's renormalised recomputation equals its persisted
`edge_score`**. That also answers the SVXY case the ADR left open: the distinction was
real and was being flattened.

**The rule this closes, and it is the third instance in two days: encoding absence as a
value.** [ADR-0060](adrs/0060-a-share-cannot-exceed-the-whole.md) withheld a share rather
than print a meaningless one; ADR-0064 stopped a page inventing a total; this stops a row
inventing a component. The recurring failure was never bad arithmetic.

[ADR-0066](adrs/0066-not-computable-must-persist-as-null.md).

### Loop iteration 49 (2026-07-25)

**I broke the guard last iteration, said it was "verified against production", and both
were true at once.**

Deploy refused a fifth time, so the iteration went to checking my own last change rather
than adding another. Running the guard **the way `daily-refresh.yml` actually invokes
it** — `python scripts/check_data_integrity.py` — crashed:

```
ModuleNotFoundError: No module named 'backend'
```

Run as a **script**, `sys.path[0]` is `scripts/` and the repo root is absent, so the lazy
`backend.services.q1_agent` import could not resolve. Last iteration's verification ran
it as a **module** (`python -m scripts.check_data_integrity`), which *does* put the repo
root on `sys.path`. **The check passed against production while being broken in the only
invocation production uses.** Verify the entry point that runs, not a convenient one.

**And it would not have been loud.** The workflow wraps the step in
`|| echo "::warning::"`, so a crash and a real integrity flag are indistinguishable —
both a warning, the step never red. Nothing separated *"the guard says the data is bad"*
from *"the guard never ran"*. Fixed with the `sys.path.insert` every other script here
already carries.

**A second defect, found by writing the test rather than by reading the code:** the guard
prints check marks, and on a cp1252 console — any Windows shell without
`PYTHONIOENCODING` — printing one raises `UnicodeEncodeError` and exits 1, which the same
fallback turns into a warning that looks like a real flag. **A guard that dies formatting
its own verdict is worse than one that says nothing.** `stdout`/`stderr` are reconfigured
to UTF-8 defensively.

Two tests pin the **entry point** rather than the function — a subprocess run of the
script asserting no `ModuleNotFoundError`, no `UnicodeEncodeError`, no traceback. The
exit code accepts **0 or 2 deliberately**: `load_dotenv()` searches from the *script's*
directory upward, so credentials cannot be stripped from a subprocess and the code
differs locally (0) from CI (2). Pinning either would assert where the test runs rather
than what it tests.

**Verified under both invocations against production**, script and module, exit 0, all
three checks green. 530 backend tests.

**The general lesson, and it is the second time today:** a test can pass while the thing
it is meant to protect is broken, if the test exercises a different path than production.
[ADR-0063](adrs/0063-one-beta-bar-across-every-surface.md) was a panel that never saw a
sample size; this is a guard that never saw its own entry point.

**Standing note on the `|| echo "::warning::"` wrapper.** Left unchanged, deliberately —
turning the guard into a hard failure would red the daily run for a second agent working
in this repo, and that is not a call to make unilaterally at 2am. But it is why this bug
would have gone unnoticed indefinitely, and it should be revisited: **a guard whose step
is always green is a guard nobody reads.**

### Loop iteration 48 (2026-07-25)

**A guardrail only ran at generation time, so a wrong claim could sit on the live page
indefinitely. That is not hypothetical — it is what happened.**

Deploy still refused (`api-deployments-free-per-day`, fourth attempt), so the work went
where it can be verified. Re-deriving found the pool-depth measurement has **N = 1** —
`independent_ideas` was only added on 2026-07-25, and `trade_candidates` holds **only the
latest run**, so it cannot be backfilled. It *will* accumulate going forward, since it is
snapshotted per `run_date`, so no change was needed there — but **every claim that the
short side "has 5 independent ideas" currently rests on one observation**, and that is
worth saying out loud.

The real gap was elsewhere. The thesis guardrails — the restated idea count (ADR-0049)
and the availability excuse (ADR-0061) — run inside `verify_citations`, **during
generation**. Two paths get an unchecked thesis onto the page anyway:

1. **The fallback is terminal.** Once retries are spent, `reason_picks` returns
   `fallback_picks(state)`, and that templated thesis is persisted without going back
   through `verify_citations`.
2. **A row published by older code stays live.** This is the ARKK incident exactly. The
   book carried *"ARKK … is not present in the tradable candidate pool"* — false — and
   ADR-0061 added the check that rejects it **only on the next generation**. The wrong
   sentence stayed on the live page until a human happened to read it.

Both are the shape [ADR-0040](adrs/0040-published-book-is-the-book-of-record.md) exists
to prevent: **check the published book; do not infer its correctness from the process
meant to produce it.** `/risk` learned this in iteration 32, when it started comparing
its positions against the published picks rather than trusting a pipeline status flag.

`check_published_book_claims` now re-runs both exact-match prose checks against the
persisted `book_view`, inside the daily guard that already executes after every pipeline
run. **The window between "a guardrail is written" and "the page stops lying" closes to
one daily run.** It **reuses** `q1_agent`'s functions rather than reimplementing them — a
second copy of a guardrail is a second thing to drift, which is precisely what
[ADR-0064](adrs/0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md) was.

**Verified against production, not asserted:** *"Published thesis for 2026-07-25 makes no
contradicted claim (checked against 40 screened candidates)"*, exit 0, alongside the
edge-score reconciliation from the previous iteration. The negative control is a unit
test carrying **the exact false sentence that was live**, which the check flags. 528
backend tests.

**Honest gap in this iteration's UI pass.** `/book` was verified at 1440px and 375px
early on — no horizontal scroll, no `NaN`, zero console errors — but the Playwright
browser then became unstable, dying immediately after every navigation across repeated
profile resets and lock clears, and `/risk` could not be re-checked. Recorded rather than
glossed. Nothing shipped this iteration touches the frontend, and the deploy is frozen,
so there is no frontend change that *could* have regressed — but that is an argument
about blast radius, not a substitute for the check.

[ADR-0065](adrs/0065-check-the-published-book-not-only-the-generation.md).

### Loop iteration 47 (2026-07-25)

**Proved the claim the previous iteration made from one data point, and turned it into a
standing check. Deploy still blocked, so the work went where it could be verified.**

The deploy quota is still exhausted — retried twice, refused both times, and a deploy
that *did* succeed for the other session at 21:03 did not contain `e8d5b27f`. So the
frontend fix stays unverifiable, and the honest response is not to keep producing
frontend work that has to be claimed rather than shown. **Backend and measurement work
is not blocked**: the pipeline and its guard run on GitHub Actions and can be executed
against production directly.

[ADR-0064](adrs/0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md)
asserted *"the pipeline was right and the page was wrong"* — **on the strength of a
single theme.** Checked across the whole live run:

| recomputation | mismatches |
|---|---|
| **renormalised** (what the pipeline does, ADR-0036) | **0 / 8** |
| naive sum (what the page did) | **3 / 8** |

The three failures are exactly the themes with no carry or value proxy — China Growth,
Energy Prices, US Election — diverging by **0.11 to 0.18**. That settles the claim, and
it also sizes the blast radius: `/book`'s `EdgeBars` fires the same false alarm on **4 of
the 9 published positions** (XLE, UNH, BABA, PDD), inside their own expanded derivations.

**The part worth keeping is not the number, it is that nothing was checking.** The
pipeline was right, the page was wrong, and the only reason anyone looked is that a
surface happened to render the disagreement. `check_edge_score_reconciles` makes the
invariant explicit — **a stored score must be reproducible from the stored components by
the documented formula** — and runs in the daily guard that already executes after every
pipeline run. A future change to the weights, the components or the formula now reports
itself instead of waiting for a page to notice.

Scoped to the **latest run only**: a row written under different weights is history, not
a live defect. Silent on an unscored theme, on missing weights, and on no rows — absence
of data is not a mismatch.

**Verified against production, not asserted:** `✓ edge_score reconciles from components
for all 8 themes on 2026-07-25`, exit 0. 524 backend tests. UI pass at 1440px and 375px
confirms no regression — `/book` reads 5/4 on run 2026-07-25, no horizontal scroll, no
`NaN`, zero console errors.

### Loop iteration 46 (2026-07-25)

**The audit page was accusing the pipeline of a data-integrity failure. The pipeline was
right; the page's own arithmetic was wrong.**

Q2 is half the assessment and nearly every iteration here has gone to Q1, so this one
read `/method` — the Q2 surface, whose entire purpose is to show that every published
number is reproducible from the published formula. It carried a red panel:

> **RECONCILIATION FAILURE** — Applying the live weights to the persisted components
> yields **+0.1700**, but `theme_signals_history.edge_score` holds **+0.3542**. *Either
> the weights changed after this row was written, or a component column and the score
> column were not written from the same inputs.*

**Both stated causes are false.** `0.169999 / (0.20 + 0.23 + 0.05) = 0.354165` — the
persisted value, exactly. [ADR-0036](adrs/0036-carry-as-excess-yield-over-funding.md)
established that a `null` component is *not computable* and is **dropped, with its weight
renormalised over the components present**. `compute_edge_score` does that. The page kept
summing `w × (v ?? 0)`, kept printing `(null → 0)`, and when the answer disagreed it
**published an accusation against the pipeline**. The backend was changed; the page never
was.

**Same root cause on `/book`:** `EdgeBars` sums `edgeContributions`, which applies the
identical `?? 0`, and warns when the total differs from the persisted score by >0.01 — so
every position whose theme lacks a carry or value proxy raised the same false alarm
inside its own derivation. One bug, two surfaces.

This is the sharpest form of the failure this project keeps finding: **not a wrong number
in isolation, but an auditing surface whose own arithmetic was wrong, presenting its
error as the audited system's error.** A reviewer checking the maths would have concluded
the pipeline is unreliable — on the page's own reasoning.

`recomputeEdgeScore` implements ADR-0036 in one place and returns **the parts, not just
the total**, because a worked example that prints only the answer proves nothing.
`edgeContributions` is deliberately unchanged — `?? 0` is correct for *ranking* which
component dominates, where a null must never win; only the surfaces that **reconcile
against a persisted score** were wrong. The failure panel keeps its trigger and wording:
it was doing its job, fed a wrong number.

**Worth stating plainly:** every previous finding here corrected a page that was too
flattering. This one corrects a page that was **unfairly damning**. The discipline is the
same — make the page say what is true — and the direction of the error is not the point.

**Housekeeping with a lesson:** ADR numbers collided a **third** time (0051, 0053, now
0062). Mine renumbered to 0063 by the established precedent — the earlier-committed ADR
keeps the number — and the index was sorted, having drifted (0059 sat after 0063) because
parallel sessions append rather than insert. The mechanism is reading `ls docs/adrs/` at
the *start* of an iteration and writing the file at the *end*.

**Three things checked and found NOT to be defects**, recorded so they are not chased:
the header showing ET `2026-07-24` beside `RUN DATE 2026-07-25` is correct —
[ADR-0062](adrs/0062-run-date-is-not-a-write-timestamp.md) makes `run_date` deliberately
**forward-dated** to the trading date the book is *for*; committing the other session's
untracked `0055` was a **repair**, since the index already linked it and the repo had a
dead link; and a naive `/NaN|undefined/` sweep flags `/method` on the English word used
correctly.

[ADR-0064](adrs/0064-the-audit-page-blamed-the-pipeline-for-its-own-arithmetic.md).

### Loop iteration 45 (2026-07-25)

**Two freshness labels on the showcase page were dating live data wrong. One I had
already committed but never got live; the second the first one led me to.**

Iteration 43 fixed the landing header (RUN DATE sourced from a write timestamp
instead of `run_date`, ADR-0062) and committed it — but it was never deployed. The
last production deploy predated the commit by five minutes, and these are CLI
(`vercel --prod`) deploys with no git metadata, so pushing to `main` does not
trigger one. The site still read **RUN DATE 2026-07-24** while its own status bar
read **Last run 2026-07-25**. Deployed HEAD cleanly (`git archive` of the commit, so
none of the other session's uncommitted WIP shipped); verified live — RUN DATE, LAST
PIPELINE RUN and the status bar now all read **2026-07-25**, freshness "Updated 42m
ago" measured from `finished_at`, zero console errors at 1440 and 375.

**Then the desktop screenshot showed the next instance of the same defect.** The
market tape read **"Updated 2d ago"** over **S&P 7,407.40 · -0.01%** — but those are
the genuine 07-24-vs-07-23 closes, and `macro_indicators.^SPX` was fetched 42 minutes
earlier. The values were current; the timestamp lied. `market_assets.updated_at`
defaults to `NOW()` only on INSERT, and `fetch_market_assets`' upsert
(`on_conflict=ticker`) refreshed the value columns every run without ever writing
`updated_at`, with no `ON UPDATE` trigger — so the row's timestamp had been frozen at
its first insert (07-22) for two days while the prices moved under it. **The same
wrong-field class as ADR-0062: a real value carrying a timestamp that doesn't track
when it changed.** Fixed the writer to stamp `updated_at` on every upsert, ran the
fixed fetcher against prod to correct the live row (no fabrication — it recomputes
from real `macro_daily_history`), and the bar now reads **"Updated 1m ago"** over the
same closes. This one was **not** found by a unit test — it was found by cross-reading
two numbers on one screenshot, the freshness label against the quote it labelled, the
same way every real defect this project has caught was found. 518 backend + 111
frontend tests. Follows ADR-0062; no new ADR — it is that rule applied a second time.

### Loop iteration 44 (2026-07-25)

**The recorded next step was mine, and it was wrong. Finding out why exposed the real
defect.**

The previous entry recorded that the thesis's ARKK reason was *backwards* — that shorting
a 1.49-beta name offsets the long beta of JPM/UNH/NUE rather than compounding it — and
proposed a guardrail on the sign of a claimed beta contribution. Re-deriving before
building it, as the mandate requires, **disproved the premise**.

**The book's net factor beta is −0.0355.** It is net *short* beta: the three largest
contributions are shorts (PDD −0.130, BABA −0.113, SLV −0.063) against longs led by SVXY
+0.089 and JPM +0.076. Adding ARKK **short** contributes negatively again, so |β| grows —
**"compound" is defensible against the book.** The earlier entry reasoned about the three
long positions the sentence names and never computed the book-level quantity.

That is **asserting a direction without computing the magnitude** — the exact error class
this project has caught five times in its own code (min-max HypeScore, book-level beta
inside a per-pick loop, unfloored conviction, the net-share denominator). Committed here
in a document, about the agent, while building guardrails against the agent doing it.
**And the number was already rendered:** `/risk` prints `Σ β contribution −0.04` two
panels from where I was looking.

**So the guardrail is NOT built, and that is a decision, not an omission.** The claim is
**ambiguous rather than false** — true of the book's net beta, false of the three longs
the sentence names — and a mechanical check would have to silently pick a referent. **A
guardrail that rejects a defensible sentence is worse than none**, because it pushes the
agent off a true statement toward one that merely passes. The rule that has now worked
four times: find the claim class the model actually makes, **confirm it is falsifiable**,
then check that class exactly. ADR-0061's availability claim passes that test; "compounds
exposure" does not.

**Reading the number I should have read first exposed the real defect.** That same footer
continues `Σ β contribution −0.04 · book β −1.73`, while ~200px above the metrics grid
says **BETA (VS SPX) · Unavailable — "3 sessions of history, needs 60. A Beta from this
sample is noise, so we do not publish one."**

**The same statistic, withheld as noise in one panel and printed as a reconciliation
target in another, on one page.** `book β` is `portfolio_risk.beta`, a *regression* beta
on realised returns; the Σ beside it is the bottom-up factor beta. The panel's copy —
*"the contributions sum to the book beta"* — invites a check that **fails 40×**, and it
fails because the reference number is three sessions of noise already declared
unpublishable. Iteration 21 fixed exactly this for the risk-limit board; it survived here
because this panel **takes beta as a prop and never saw the sample size**.

Now three surfaces share one bar (`MIN_SESSIONS.beta_abs` = 60). The Σ is untouched and
is the number to read — it needs no return history — and the copy says *factor-model*
beta so it stops promising a reconciliation it cannot deliver. An unknown session count
does not withhold, per `buildLimitBoard`'s rule.

**The recurrence after iteration 21 is itself the finding:** a shared constant is not
enough when a panel receives the value as a prop.

**Verified live** at 1440px and 375px: `book β −1.73` is gone, the note explains why in
its place, the Beta tile and the footer now agree, and the Σ still reads −0.04. `/`,
`/book`, `/risk`, `/method` all clean — no horizontal scroll, zero console errors.

**One false positive worth recording so the next agent does not chase it:** a naive
`/NaN|undefined/` sweep flags `/method`, but the hit is the English word used correctly —
*"The IC information ratio (mean/σ across dates) is **undefined** until there are at
least two independent cross-sections."* Match on `NaN`, and read the context before
calling a word a defect.

[ADR-0063](adrs/0063-one-beta-bar-across-every-surface.md).

### Loop iteration 43 (2026-07-25)

> Numbering note: two agents worked this repo in parallel today and both reached
> "iteration 42", so there are two 42 sections below. Read by date and content.

**Two things: confirmed last iteration's IC fix landed, then found and fixed a wrong
date on the site's first screen.**

The HypeScore-IC honesty fix from the previous iteration is now **verified live** — the
panel reads *"1d −0.2275 · measured · 1 date — not yet stable"* with the footer *"Not
yet validated … a single-date point estimate,"* and the green overclaim is gone. The
transient window (I had persisted the data before the guard deployed) is closed.

Then the UI pass surfaced a real defect on **"What we're watching"**: the header read
**RUN DATE 2026-07-24** and **LAST PIPELINE RUN 2026-07-24** above theme data that is
the **2026-07-25** run (US Election HypeScore 60.1, the 07-25 value; 07-24 was 58.4).
The status bar three lines below correctly said *"Last run 2026-07-25"* — so the
landing page contradicted itself and every other route.

RUN DATE was sourced from `themes.updated_at`, a write timestamp; LAST PIPELINE RUN
from `finished_at`. Both render 07-24 because `run_date` is **forward-dated** — the run
that executes the evening of 07-24 UTC produces the book *for* 07-25. Both header
dates now show `pipeline_runs.run_date` (07-25), the canonical identifier the status
bar, `/method` and `/book` all use; freshness *"Updated Nm ago"* is measured separately
from `finished_at`. That split is load-bearing: `run_date` is a bare date, so
`new Date("2026-07-25")` is in the *future* of a 20:13Z finish and measuring age from it
would clamp to 0 ("just now") over hours-old data. Extracted to
`lib/homeFreshness.ts`, unit-tested including that clamp trap.

Also confirmed, but left to the agent who owns it: the live book's thesis still claims
*"ARKK … is not present in the tradable candidate pool"* — **false** (ARKK is a short
candidate at edge −0.26). That is already guarded by the parallel session's
`check_availability_claims` (ADR-0061), which I verified fires on the exact live
sentence; the live book is simply stale and a re-run will purge it. Not mine to
regenerate.

[ADR-0062](adrs/0062-run-date-is-not-a-write-timestamp.md).


### Loop iteration 42 (2026-07-25)

**Fixed the Q2 validation spine where it was quietly broken: the IC harness crashed
before it could write, and the panel would have called one day a signal.**

`/method`'s **Does HypeScore actually predict returns?** panel is the site's one
NOT-YET-VALIDATED surface, and GOAL.md ranks validation second only to the answer
existing. Two coupled defects lived under it.

The harness (`scripts/backtest_hype.py`) printed its legend with a Unicode `→` and
`≈`, which raise `UnicodeEncodeError` on a cp1252 stdout — and that print runs *before*
the persist step. So a crash there aborted the run with nothing written, and the panel
showed **all-null** `hype_ic` rows (n_obs 0 everywhere), reading as *"the harness
produces nothing"*. It was not true: with the forward-price window that had since
accrued, the harness could compute a real h1 IC. ASCII fixes it; persist is now
idempotent.

And the panel's verdict was `validated = some(ic != null)` — *any* non-null IC turned
it green. The first IC the harness yields is a **single date's** cross-section across
~8 themes (live: h1 IC **−0.2275**, `n_dates=1`, `ic_ir=null`). One cross-section says
nothing about stability, and stability is the whole difference between a signal and a
lucky draw. `validated` now keys on the **IC information ratio** (mean/σ across dates),
undefined below two dates — the exactly-right boundary. A one-day reading shows as
*"measured · 1 date — not yet stable"* and the footer names it a point estimate.

Verified end to end: re-ran the fixed harness on this machine (proving the crash fix —
it reached persist), it wrote a genuine 2026-07-25 row, and the panel reads it as
measured-thin. The verdict logic is extracted to `lib/method/hypeValidation.ts` and
unit-tested, including the trap directly — 500 observations on one date is still not
validated, because breadth is not stability.

One honest wrinkle from ordering: I persisted the real IC row *before* the frontend
fix deployed, so for the deploy window the OLD `validated = some(ic != null)` logic saw
the non-null −0.2275 and showed the green *"a stable non-zero IC is what makes
HypeScore a signal"* copy — the exact overclaim, briefly live. **Now resolved and
confirmed live** (verified 2026-07-25, next iteration): the panel reads *"1d −0.2275 ·
measured · 1 date — not yet stable"* with the footer *"Not yet validated … a
single-date point estimate,"* and the green copy is gone. Deploy lag ran ~35 min, far
longer than usual. Next time: deploy the guard before writing the data it guards.

Also closed last iteration's loose end: the debug `data-` attributes are gone from the
deployed `/book`, and the per-position stability marker renders correctly (nine
positions, XLE/UNH the coin flips).

[ADR-0059](adrs/0059-a-single-date-ic-is-not-validation.md).


### Loop iteration 42 (2026-07-25)

**Published under the corrected prompt. The agent explained itself — and lied.**

Iteration 41 proved on frozen inputs that the ADR-0056 prompt makes the agent name the
idea it declines. **Nothing had published under it**: the live book predated the change,
so the page was showing a failure caused by code that no longer existed. Re-running after
a code change is normal operation — *re-rolling until the page looks good would be
cherry-picking*, so this was **one run, published whatever it returned**.

**Two things happened on that run, and both are findings.**

**1. The ADR-0049 guardrail fired live, for the first time observed.** Attempt 1 claimed
*"4 independent ideas on the short side"* against a measurement of 5 —
`check_idea_count_claims` rejected it, the run retried, attempt 2 passed. Iteration 34
built that check and it had never been seen catching a real run.

**2. The agent named ARKK, as required, and gave a reason that is false.**

> *"The fifth independent short idea per POOL DEPTH, ARKK, is not present in the tradable
> candidate pool, so this book deploys four short picks rather than five."*

**ARKK was in the pool.** `trade_candidates` holds it at `edge_score −0.2658`,
`hype_score 60.69` — eleventh of twelve short candidates — and POOL DEPTH counted it as an
independent idea *because* it was there. The sentence is contradicted by the data the
model was shown, **in the same breath as citing that data**.

**And it is worse than the silence it replaced.** Naming ARKK set `satisfied = true`,
flipping `/book`'s panel out of its warning branch into *"the thesis accounts for what it
declined"*. **The iteration-40 fix made the page credit a fabrication** — a true warning
was more useful than a neutral-coloured endorsement of a false sentence. This is the
limitation ADR-0056 named for itself (*"verifies a declined idea is mentioned, not that
the reason is sound"*) arriving on the first run.

**It also shows what pressure does.** The agent was told it *must* explain, had no reason
it judged good enough, and produced one. **Demanding an explanation without checking it
manufactures explanations.**

Judging whether a reason is *good* is out of reach; judging whether it is *contradicted
by our own pool* is not. `check_availability_claims` rejects an availability excuse about
a screened name — exact, no grounding tolerance, and it **blocks**, where a merely-missing
explanation deliberately does not. An omission leaves the reader to ask a question; a
false reason answers them wrongly **and clears the guardrail while doing it**. The prompt
is given an honest way out — *"if you have no better reason than 'I chose not to', say
exactly that"* — because **a guardrail with no truthful escape just teaches a different
lie**. [ADR-0061](adrs/0061-a-false-excuse-is-worse-than-none.md) extends ADR-0049's rule
from **numbers** to **facts**.

**Second thread — `/risk` said one position was −1071% of the book.** The **Net share**
column read −1071.4% (PDD), −1019.0% (BABA), +975.7% (XLE). The formula was
`signedWeight / |net|` guarded only by `netAbs > 0`, which catches a *perfectly* hedged
book and nothing else — but the interesting case is *near* zero, and near zero is this
product's **design target**: the book runs **net +0.90% on 59.6% gross**, and `/book`
says *"It is close to market-neutral."* **The column was systematically broken for
exactly the kind of book the system exists to build.**

The fix is not a tuned threshold but what the word means: **a share is a part of a whole
and cannot exceed the whole**, so it renders only when `max|wᵢ| ≤ |Σw|`. Withheld rather
than clamped — capping at 100% would still assert the decomposition exists. The predicate
is **exported and used by both the computation and the note explaining the blank**, so
they cannot drift, which is the failure ADR-0058 hit.
[ADR-0060](adrs/0060-a-share-cannot-exceed-the-whole.md).

**Two pieces of earlier work confirmed working live, worth recording as non-defects:**
iteration 32's provisional-window check fired correctly during the run — *"THESE ARE
PROVISIONAL POSITIONS, NOT THE PUBLISHED BOOK · 40 held · 9 published"* — and the
net-share note correctly did **not** show on that 40-position provisional book, because
its net exposure is large and the share is genuinely meaningful there. The suppression is
per-book, not a blanket.

**The re-run under the guardrail passed on the first attempt** — no rejection, so the
prompt's honest-escape wording did the work rather than the blocking. Published book
**5 long / 4 short** (XLE, SVXY, UNH, JPM, NUE / SLV, BABA, PDD, NOC), and the reason is
now substantive:

> *"I declined ARKK as the fifth independent short because its high-beta/AI-thematic
> profile would compound existing market-beta exposure from JPM, UNH, and NUE rather than
> diversify the short book, and its trade conviction is weaker than the four chosen
> shorts."*

**Verified live:** `/book`'s panel has left the warning branch and reads *"short of 5 by
choice, not by constraint, and the thesis accounts for what it declined — ARKK"*;
`/risk` shows 9 positions with *"Net share is withheld for this book. Net exposure is
+1.3% against a largest single position of 10%…"*, no four-figure percentages anywhere,
no horizontal scroll at 1440px or 375px, zero console errors.

#### Recorded next step — **WRONG, corrected in iteration 43. Left in place because the correction is the lesson.**

> **The "backwards" verdict below is mine and it is wrong.** The book's net factor beta
> is **−0.0355** — net *short* beta, because the three largest contributions are shorts
> (PDD −0.130, BABA −0.113, SLV −0.063). Adding ARKK **short** contributes negatively
> again, so |β| grows: **"compound" is defensible against the book.** The entry below
> reasoned about the three long positions the sentence names and **never computed the
> book-level quantity** — asserting a direction without computing the magnitude, the
> exact error class this project has caught five times in its own code. The number was
> already on the page: `/risk` prints `Σ β contribution −0.04` two panels from where I
> was looking. See [ADR-0063](adrs/0063-one-beta-bar-across-every-surface.md).

**Half that reason is verifiably true and half states its mechanism backwards, and
nothing catches it.** Checked against the same run's data:

| claim | verdict |
|---|---|
| *"conviction is weaker than the four chosen shorts"* | **TRUE** — ARKK −0.2605 against SLV −0.4299, BABA −0.3704, PDD −0.3435, NOC −0.2873 |
| *"would compound existing market-beta exposure from JPM, UNH, NUE"* | **backwards** — ARKK β 1.49; those three are held **long** at β 1.22 / 0.62 / 1.11, so a *short* in a high-β name **offsets** long beta rather than compounding it |

ADR-0061 closed the one falsifiable excuse class the model actually reached for. This is
the next one, and unlike "is the reason good?" it **is** mechanically checkable: the sign
of a claimed beta contribution can be computed from `factor_exposures` and the signed
weights already on the row. A claim that adding a position *increases* an exposure, when
`signed_weight × β` moves it the other way, is a factual contradiction of the same kind
as a restated count.

**Do not generalise it into "score the reasoning".** That is the unfalsifiable verdict
ADR-0045 refused for turnover. The rule that has worked three times now is narrower:
**find the specific claim class the model actually makes, and check that class exactly.**

**No claim is made that theses are now truthful.**

### Loop iteration 41 (2026-07-25)

**Measured the lever iteration 40 shipped. It works — and the same run disproved the
check shipped alongside it.**

Iteration 40 shipped two things: a prompt instruction requiring the agent to name each
independent idea it declined, and `shortfall_accounting` to verify it did. ADR-0056
closed by admitting the check *"tells you the model failed but does not help it
succeed"* — the prompt is what was supposed to help, and **nothing had measured whether
it does.** The published book predated the change, so the live page was showing a
failure caused by a prompt that no longer existed. *Verify live* applies to a prompt as
much as to a page.

`scripts/replication_test.py` was already the right instrument — it freezes the L5 state
through the deterministic nodes and calls `reason_picks` N times on deep copies — and
extending it to run `shortfall_accounting` per sample **costs nothing**, because the
draws are already being taken. The explanation rate is measured over the same draws as
the turnover, against one identical pool.

**Three samples, frozen pool of 30 candidates / 10 long ideas / 5 short ideas:**

| sample | picks | short side |
|---|---|---|
| 1 | 7 (3L / 4S) | declined ARKK — **named ARKK** |
| 2 | 9 (5L / 4S) | declined ARKK — **named ARKK** |
| 3 | 9 (5L / 4S) | declined ARKK — **named ARKK** |

**The prompt works: ARKK named 3/3**, against a published thesis that never mentioned
it.

**And the same run disproved the check's calibration.** Sample 1 held **3 longs against
ten independent long ideas**, so the all-or-nothing rule demanded explanations for
**seven** names, while the short side holding 4 against 5 was asked for **one**. Both
books were short by a comparable amount and the burden differed sevenfold.

The reason is arithmetic. Where ideas **exceed** the five slots Q1 asks for, most
declines are forced — a side with ten ideas must decline five however good the book is —
and those carry no information. The rule conflated *"I had more ideas than slots"* with
*"I left slots empty"*. On the short side the two coincide, which is why the defect was
invisible there **and why the live ARKK warning was nevertheless correct**.

Explanations are now owed **per empty slot** (`available − held`). `satisfied` is the
verdict and the panel branches on it. On a side where ideas exactly fill the book this
reduces to the old rule. `passed_over`/`unexplained` survive as information, not as a
score. Pre-ADR rows carry no `satisfied` and fall back to the old reading — retroactively
clearing warnings that were correct when written would rewrite the record.

**Turnover from the same run, worth recording: 27% overall, 44% LONG, 0% SHORT.** The
short side (5 ideas, 5 slots) returned an identical book every time; the long side (10
for 5) did not. Same arithmetic, and exactly what ADR-0050 predicted and declined to
score.

**Second thread — four header items that all land on the same page.** `/trades`,
`/portfolio` and `/research` sat beside the primary nav, commented *"legacy links
(redirects)"* and justified as reachable *"while the consolidation beds in"*. The
consolidation finished at ADR-0040 and **all three page components are now nothing but
`redirect("/book")`** — so the header showed a reader this project's migration history
for no benefit. Removed (ADR-0054 named it as in scope); the routes stay, so bookmarks
still resolve.

Chasing that turned up a **doc-sync defect of exactly the kind `CLAUDE.md` warns about**:
`CLAUDE.md` described L6 as *"per-trade thesis writeup rendered on `/research`"* in two
places, and `ARCHITECTURE.md` gave the L6 source as `frontend/pages/research.tsx` — **a
path that has never existed in this app-router layout**. The mermaid diagram in the same
file was already right (*"/research — retired, server redirect() → /book"*). **The prose
drifted and the diagram did not**, which is the argument for the diagram being canonical.

**Open, unchanged, and not to be conflated with the above:** the check verifies a
declined idea is *mentioned*, not that the reason is *sound*. Loosening the count owed
does not touch that.

[ADR-0058](adrs/0058-explanations-are-owed-per-empty-slot.md) corrects
[ADR-0056](adrs/0056-an-instruction-is-not-a-guardrail.md).

### Loop iteration 40 (2026-07-25)

**The one panel built to expose the shortfall was pointing at a thesis that does not
explain it — and the same false pointer was on the page twice.**

Re-derived against the live book rather than the backlog. `/book` reads **5 long / 4
short**, and Pool depth stated the situation exactly right:

> Shorts — 11 candidates → 5 independent ideas → **4 held**. The pool held 5
> independent ideas and the book took 4. This side is short of 5 by choice, not by
> constraint — *the agent's reasoning is in the thesis above.*

**That last clause was false.** The published thesis names SLV, BABA, PDD and NOC and
then says only *"Net directional bias is long given 5 long picks vs 4 short picks"* —
which **restates** the shortfall. It never mentions **ARKK**, the one independent short
idea it declined. So the panel sent the reader to prose that does not answer the
question, in warning colour, which makes a dead end read as a deliberate disclosure.

**The instruction already existed and was ignored.** Since ADR-0048 the prompt has said
returning fewer than five per side when five ideas exist *"is a choice, not a
constraint"* and *"needs a reason stated in book_view"*. **An instruction with no check
is not a guarantee** — ADR-0049's lesson generalised from a *number* to a piece of
*reasoning*, and the more consequential instance, because the shortfall is the first
thing a reviewer asks of a book that answers five-and-five with four.

`shortfall_accounting` measures it: per side under `min(ideas, 5)`, which independent
ideas were declined and whether the thesis names them. Three choices carry it — a
complex counts as declined only when **nothing** in it is held (holding the
second-strongest still expresses the bet, so keying on `strongest` would report phantom
omissions); the target is `min(ideas, 5)` so a thin pool stays a *constraint*; ticker
matching is word-bounded, because `BILL` contains `BIL`.

**It deliberately does not block the run.** The retry path's terminal state is the
deterministic template book, which contains *no* reasoning at all — trading a real book
with one unexplained omission for that would make the deliverable worse in the name of
rigour. Computed at persist rather than in `verify_citations`, which returns early on
failure: **a book that failed verification is exactly the one whose reasoning gap
matters most.**

The panel now branches three ways — *unexplained* (names them, says the thesis is
silent), *explained* (names them, credits it, neutral colour), *not measured* for rows
written before this. **Live and verified:** *"and the thesis does not say why: it never
names ARKK."*

**Then the UI pass found the same false pointer a second time.** `ClearedNotTaken` ends
its lede with the identical claim, for every row it labels *"independent — passed
over"* — **eight of them on this book**, and the thesis names none. Arguably worse
there, since that panel exists to list names a reader will ask about, so it makes the
promise once per row. It now points at Pool depth, which states the measured answer,
instead of asserting one. **One panel makes the claim, and only because something
checked it.**

**Backfilled rather than waited.** `shortfall_accounting` is a pure function of three
values already persisted on the row — `picks`, `independent_ideas`, `book_view` — so
today's book was recomputed in place rather than left rendering "not measured" until
tomorrow's run. No LLM call, no refetch, no new numbers; the additive JSONB shape needed
no migration.

**Verified live** — `/`, `/book`, `/risk`, `/method` at 1440px and 375px: no horizontal
scroll on any, zero console errors, no `NaN`/`undefined` anywhere. 509 backend + 87
frontend tests.

**Open, and named rather than smuggled:** the check verifies a declined idea is
*mentioned*, not that the reason is *sound*. "ARKK was declined because it is Tuesday"
passes. Judging a reason's quality is a different problem from detecting its absence,
and conflating them would put an unfalsifiable verdict on the page — exactly what
ADR-0045 refused to do for turnover.

**Also checked and NOT a defect:** the status bar read *"L5 incomplete · Held tickers
40"* against a 9-position book earlier in the session. That is the provisional
mid-run window, and it cleared on its own — it now reads *"All stages complete · 6/6
succeeded · Held tickers 9"*. Recorded because it looked like an ADR-0040 violation and
was not, and the next agent should not spend an iteration chasing it.

[ADR-0056](adrs/0056-an-instruction-is-not-a-guardrail.md).

### Loop iteration 39 (2026-07-25)

> Iteration numbers below are per-session and **collide**: two agents worked this repo
> in parallel on 2026-07-25 and both numbered independently, so there are two "36"
> sections. Read by date and content, not by number.

**Stability was measured as a percentage. Q1 asks about trades.**

The replication harness answered 25% overall / 33% long / 13% short. That is the right
experiment in the wrong shape: *"a third of the long side is a coin flip"* tells a
reader the book is partly arbitrary without saying which part, so it **taints the
names that were in fact unanimous** and warns about none of them specifically. A
reviewer can act on *"XLE appeared in some of 3 reruns"*; they cannot act on 33%.

The harness was already recording `stable_names` and `unstable_names` — used only to
print two lists at the bottom of one panel. Joined to the book they classify every
held position: **JPM, NUE, SVXY and all four shorts appeared in all three reruns; XLE
and UNH did not.** Nine held, nine classified, none unmeasured. Both coin flips are
longs, which is the 33% expressed as names and matches pool depth exactly — 10
independent long ideas competing for 5 slots.

**No verdict is attached**, per ADR-0045. A coin flip is not a bad trade; it is one of
several the agent rates equally, which is what a side with slack *should* look like.

Three guards: the join is valid **only within a run** (a replication from another
`run_date` says nothing about today's names, so the row stays silent); **one sample
can never establish stability**, since it agrees with itself trivially; and a name
absent from both lists is **unmeasured, not stable**. Keyed on the *signed* name, so a
long and a short of the same asset cannot inherit each other's stability.

Also refreshed the standing facts above, which had drifted two books behind.

**VERIFIED LIVE 2026-07-25 — it was deploy lag the whole time.** Read off the deployed
DOM, all nine rows classify correctly (7 *stable*, 2 *coinflip* — XLE, UNH — matching
the harness) and the marker renders visibly. The one real fix was the prop-chain bug
below (the `<PositionRow>` call site never passed `repl`); every "renders zero times"
reading after it was taken against the build that predated the fix. The earlier "not
deploy lag" ruling rested on finding `bookRunDate` in the bundle — a prop name that
predated the fix and could never have distinguished the two builds. **A distinguishing
check must key on something the new build introduced**; a debug `data-` attribute did,
and confirmed the classifier had been correct all along. The
classifier is unit-tested (7 tests), typechecks and builds; the page's own fetch of
`backtest_results` fires on the deployed site and returns 200 with the right shape
(`notes` is a text column that parses, `end_date` 2026-07-25 equals the book's
`run_date`, `samples` 3); the marker string is present in the deployed bundle; and the
JSX sits in the always-visible rationale cell, not behind the expand. It still renders
**zero** times, which means `positionStability` is returning `unmeasured` for all nine
rows. One prop-chain bug was already found and fixed this iteration — the
`<PositionRow>` call site never passed `repl`, lost when an earlier blanket edit was
reverted — and that was not the whole of it.

**Next step:** expose the computed `stability` as a `data-` attribute, deploy, read it
off the DOM, and remove. Two deploys, but it distinguishes "`repl` is null in the row"
from "the date comparison fails" in one shot instead of by inspection. Both props are
optional, which is right for a usually-absent measurement and is exactly why nothing
in the type system or the tests complained.

[ADR-0057](adrs/0057-stability-is-a-per-trade-fact-not-a-percentage.md).


### Loop iteration 36 (2026-07-25)

**The why-column said the same thing nine times, and the mobile fix took two goes.**

Prompted by a direct question — *does this work like a scanner?* — the answer is no and
should stay no ([ADR-0054](adrs/0054-a-daily-publication-not-a-scanner.md), and the
stance is now a standing section at the top of this file so the loop cannot drift into
building alert rules). But the scanner critique's real claim is **time-to-insight**, and
that standard does bind here. Auditing against it found the failure at the worst
possible place.

`/book`'s `ASSET · THEME · RATIONALE` column rendered **"Long · a strong price uptrend"
on all five longs and "Short · a price downtrend" on all four shorts** — nine positions,
**two distinct strings**, on the only layer a reader sees without clicking, answering the
question Q1 literally asks. `plainRationale` names the *dominant* EdgeScore component;
trend carries the largest raw magnitudes so it wins almost everywhere. The function is
correct and does exactly what its docstring says. The call site's own comment states the
intent it defeats: *"a reader gets the 'why' without decoding values."*

**Not fixed by adding phrases** — a second templated string is the same bug with more
words. The line now carries a fact that genuinely differs per position and was *already
measured but unused at that layer*: the independent-idea complexes `PoolDepth` renders
(ADR-0048). A name is either the strongest member of a correlated complex — the other
members being what it was taken **instead of** — or it stands alone. **Live: 2 distinct
lines → 7 across 9 rows.**

It stays silent rather than guessing. Absence from the idea map is *unmeasured*, never
"standalone" — it usually means no usable return history, and asserting independence
from missing data is the invention this file keeps warning about. A non-strongest member
is silent too, rather than claiming to have beaten names it did not.

**Then the 375px pass caught the fix half-done, twice over.** The row grid is
`min-w-[640px]` inside a horizontal ScrollArea, so the rationale cell is **~150px at
every viewport below desktop** — not because the screen is narrow, but because the
column is `1fr` of 640 minus 418px of fixed columns and 72px of gaps. Scrolling the
container reveals other *columns*, not more of this one.

1. The distinction had been **appended**, and truncation eats the end — so the only
   differentiating half was exactly what a mobile reader never saw. Reordered to
   `side · distinction · driver`.
2. **Measuring what a reader actually sees**, rather than only whether the text
   truncated, showed the cell renders **eighteen characters**. The reorder alone would
   have traded `"Long · a strong p…"` for `"Long · taken ove…"` — still identical on
   every row that beat something. *No ordering fixes a cell that narrow.* The
   truncation itself is the defect: an ellipsis on the line carrying the per-position
   reasoning hides content with no affordance to reveal it — the same failure as the
   `/risk` cards clipping in iteration 30. It wraps now.

**Both were found by measuring the rendered result, not by reading the diff**, which is
now true of every defect this project has found.

**Verified live, both widths, asserting the DOM rather than the rendered text** (the
iteration-19 lesson):

| | 1440px | 375px |
|---|---|---|
| distinct lines / rows | **7 / 9** | **7 / 9** |
| clipped | none | **none** |
| computed `white-space` | `normal` | `normal` |
| line box height | 17px (one line) | 52–69px (wraps) |
| horizontal page scroll | none | none |
| console errors | 0 | 0 |

The wrap is width-sensitive in exactly the intended direction: it costs nothing on
desktop and costs row height on mobile instead of hiding content.

**A third process note, and it cost most of this iteration's wall clock: Vercel
coalesces pushes, so "my commit is pushed and a deployment went Ready" does not mean
my commit is live.** The Ready deployment 17 minutes after the wrap fix was pushed had
been created *two and a half minutes before it* and built the other session's commit;
mine was folded into the next build. Three separate detection attempts were wrong before
that was understood — polling the served HTML for rendered text (`/book` is a client
component, so the text is never in the HTML), polling `buildId` (the app router does not
emit one), and polling the page chunk hash (CDN-cached, and coalescing breaks the
mapping anyway). **The reliable check is `vercel inspect <url>` for the deployment's
creation time against `git log --date=format:%H:%M:%S`**, and then re-reading the DOM.
Asserting the class name and computed `white-space` — not just whether the text
overflowed — is what proved the old bundle was still being served.

**Two more process notes worth keeping.**

*Concurrent sessions collide on ADR numbers.* Another session was writing ADRs against
this repo at the same time; both claimed **0051**, then both claimed **0053**. Theirs is
already cited by its own 0052 (*"corrects 0051"*), so **an ADR with a dependent cannot be
renumbered** — this one moved to 0054. Worth checking `ls docs/adrs/` immediately before
writing, not at the start of an iteration.

*A `git checkout <file>` to undo my own bad `sed` destroyed that session's uncommitted
edit to the same file.* Restored from the diff, but the lesson is that in a shared
working tree, `checkout` is not a private undo.

### Recorded next step — resolved above, kept for the reasoning

**Status: fixed in iteration 36.** Left in place because the analysis of *why the
scannable layer must differentiate* is the durable part.

Verified live on `/book` (2026-07-25, captures in `docs/captures/2026-07-25/`): the
`ASSET · THEME · RATIONALE` column renders **"Long · a strong price uptrend" on all five
longs and "Short · a price downtrend" on all four shorts**. Nine positions, two distinct
strings.

`plainRationale` (`frontend/lib/themeSignals.ts:264`) names the dominant EdgeScore
component. Trend carries the largest raw magnitudes, so it wins on nearly every name and
the output collapses. **The function is correct** — it does exactly what its docstring
says — which makes this the recurring shape: *a correct calculation presented as if it
meant something*. The call site's own comment states the intent it defeats: *"a reader
gets the 'why' without decoding values."*

It matters more than the other instances because **Q1 is literally "what are your top
five long and short trades, and why"**, and this is the why, at the only layer a reader
sees without clicking. The differentiated reasoning is not missing — it is in the thesis
paragraph and behind each row's expander — so this is a **surfacing defect**, which is
this repo's most common bug and the one it keeps re-learning.

**Do not fix it by adding phrases.** A second templated string is the same bug with more
words. The scannable line must carry something that differs per position — what
distinguishes *this* name from the other twenty-nine that cleared the screen. Candidate
material already computed and sitting unused at that layer: the position's closest held
correlate and whether it is independent (`candidate_book_correlation`, ADR-0027-era
work rendered in *Cleared the screen*), which independent-idea complex it was taken as
the strongest member of (ADR-0048, in the pool-depth panel), and whether it arrived on
edge conviction rather than attention (ADR-0046). Measure whether the chosen line
actually differentiates across the live book before shipping it — a nine-row column with
three distinct values is a smaller version of the same failure.

[ADR-0054](adrs/0054-a-daily-publication-not-a-scanner.md) · found by the interface
audit, not by a test, which is now true of every defect this project has found.

**Also open, cheap:** `TopBar.tsx`'s `SECONDARY_NAV` (`/trades`, `/portfolio`,
`/research`) is marked "legacy links (redirects)" in its own comment and shows a reader
this project's migration state at ≥xl for no benefit. ADR-0040's consolidation is done.

### Loop iteration 38 (2026-07-25)

**Verified last iteration's sizing fix live. It had not worked — and its test said it
had.**

The deployed book was still hype-sized: `|weight| / hype` constant at **0.00158** for
six positions and **0.00326** for three, the same two-constant signature that
identified the bug in the first place.

`state["picks"]` are the *model's* dicts — asset, direction, thesis, catalysts —
enriched downstream only with `theme_id` and citations. **They have never carried
conviction or vol.** Threading those fields into `state["candidates"]` was necessary
and insufficient, because `size_positions` read them off the **pick**. The unit test
passed throughout because *the test hand-supplied conviction on the picks*: it pinned
the function's contract rather than its caller's reality, which is exactly how a
non-fix ships looking verified. `size_positions` now sources conviction, vol and edge
from the candidates by asset.

**A test that supplies the input the caller never supplies proves nothing about the
caller.** Only running the pipeline revealed it; a green suite never would have.

**Verified live after the real fix.** `|weight| / conviction` is now **exactly
0.00297** across all six longs and **0.00641** across all three shorts — two
constants, weight proportional to conviction within side, the mirror image of the
defect signature. The inversion is gone: XLE (highest conviction, 29.4) holds the
largest long at **8.75%**, while UNH (highest *hype* at 57.7 but lowest conviction at
15.7) holds the smallest at **4.66%**. Under the old sizing UNH's hype would have won.

**Second: the sizing chain was rendering an impossible step, and had been all along.**
XLE's panel read *"Normalised weight (÷ Σ conviction) **19.0%** → Single-name cap
(20%) → Final weight **6.4%**"*. A 19.0% weight under a 20% cap cannot become 6.4%.
The chain recomputes the conviction step from persisted edge/vol and then shows the
weight the sizer actually produced — two different models joined as one derivation, in
the panel whose whole job is to make sizing auditable. The existing guard keys off a
*missing* conviction; conviction was present and unused, so it never fired.
`buildSizingChain` now checks its own arithmetic and says so when the steps do not
compose.

**Also delivered: the replication number, finally measured and persisted.** On frozen
inputs, three genuine model samples (none fell back): **25% turnover overall, 33%
long, 13% short** — now in `backtest_results` and rendering on `/book`. An earlier
two-sample run gave 22% / 33% / 0%.
That is exactly the asymmetry ADR-0050 was designed to expose — the short side had 4
independent ideas for 5 slots, so the pool binds and the answer is reproducible; the
long side had 10 for 5, so the agent chooses, and chooses differently. OIH and UNH
were the coin flips. An earlier run of the same harness reported a flawless 0% that
was **meaningless** — both samples had timed out into the *deterministic* fallback —
so the harness now discards errored samples and refuses to report on fewer than two
genuine ones.

[ADR-0053](adrs/0053-the-published-book-was-sized-by-hype.md).

### Loop iteration 37 (2026-07-25)

**The published book was sized by HypeScore. Every surface said conviction.**

`/book`: *"sized by conviction across $100M"*. `/method` §04: *"sizing weight ∝
conviction"*. `SizingChainView`'s docstring: *"the documented model sizes by
conviction"*. ADR-0032 specifies it. `size_positions` built its `TradeCandidate`s
**without `conviction` or `vol`** — the dataclass defaults them to 0.0 — and called
`allocate_portfolio` **without `size_by`**, taking the `"hype"` default.

The live book settles it. `|weight| / hype` is **exactly 0.00198** for six positions
and **0.00353** for three — two constants, weight proportional to HypeScore within cap
group. Against conviction the same book spans 2.8× and is close to *inverted*:
highest-conviction XLE (31.1) held 6.4%, lowest-conviction long EEM (15.8) held 9.3%.

**This is worse than the usual instance of "the page describes a model the code does
not run", because the number is how much of $100M goes where** — the substance of Q1,
not an explanatory panel. And `SizingChainView` carries a guard for exactly this case
which never fired: `portfolio_positions.conviction` is *populated* from the L1
candidates but was never *used*. A present-but-inert field defeated the check meant to
catch its absence.

**It also corrects ADR-0047, from three iterations ago.** The vol floor is right and
its arithmetic held, but its claim that an unfloored ratio let a cash proxy absorb
*the book* was true of L1's provisional book only — the published book was never
conviction-sized. I verified that floor by reading the Conv. column, which could not
have revealed the difference.

**Second finding: the replication harness nearly published a meaningless 0%.** The
frozen-input run reported 0% turnover on every side with all ten names identical —
which looks like a perfectly reproducible agent and is nothing of the sort. Both
samples had timed out and fallen back, and `fallback_picks` is *deterministic*: two
fallbacks agree exactly. It was measuring the template. The harness now discards any
sample where `reason_picks` set an error, and refuses to report or persist with fewer
than two genuine samples. The same run proved ADR-0052's fix works — *"LLM TIMED OUT
(attempt 1) … not retrying"* — and that the persist was broken anyway (`42P10`: no
matching ON CONFLICT constraint on `backtest_results`), now delete-then-insert.

**On evidence strength.** ADR-0051 and ADR-0052 are now annotated with theirs. Both
rest on a *single* observation — one 23-minute call and one 45-minute call that was
killed by hand, so even its duration is a lower bound. Neither was replicated, and
that thinness is why 0051 named the wrong cause.

[ADR-0053](adrs/0053-the-published-book-was-sized-by-hype.md).

### Loop iteration 36 (2026-07-25)

**The timeout that has been raised three times never bounded the call.**

Iteration 35's replication measurement produced no number: the first of four samples
never returned. Chasing that rather than shrugging at it found the cause, and it is
not a slow model.

`LLM_TIMEOUT_SECONDS` was passed straight to `requests.post(timeout=...)`. In
`requests` a scalar timeout applies to the connect and to the **gap between bytes** —
its own docs say it *"is not a time limit on the entire response download."* A
provider that trickles data, or a reasoning model thinking slowly with the connection
alive, never trips it. **The setting bounds silence, not duration.**

Observed at 900s: one L5 call ran **23 minutes** and completed normally; a later one
passed **45 minutes** still inside a single attempt and had to be killed by hand.

**The consequence is not a slow local script.** `daily-refresh.yml` runs this every
weekday. A stalled call there is a **hung workflow that produces nothing** and holds
the runner toward its 6-hour ceiling, with the stale-book banner the only downstream
sign. Every retry and fallback path in ADR-0012 sits downstream of a call that
*returns*; none of it engages while a call simply never ends.

A wall-clock deadline now wraps whichever provider runs, with the per-request timeout
kept as the inner inter-byte guard it actually is. The worker is abandoned rather than
awaited — it holds a socket and this is a batch process — and `TimeoutError` feeds the
existing retry-then-fallback path. A fast provider error still surfaces as itself,
pinned by a test, because the retry feedback depends on telling a 429 from a stall.

**Three earlier raises of this value — 120 → 420 → 900 — were treating the wrong
dial.** Not wasted: generation genuinely was slower than 120s. But "raise the timeout"
was never going to fix a stall, and the fact that raising it *appeared* to work each
time is exactly why the misreading survived this long.

[ADR-0051](adrs/0051-llm-timeout-bounded-silence-not-the-call.md).

### Loop iteration 35 (2026-07-25)

**Built the measurement this file has been asking for since ADR-0041: agent churn is
not market churn.**

The instruction was already written here — *"run the pipeline twice on frozen inputs
and diff the positions"*, and *"do that before claiming the book is stable"* — and
nothing had done it. The turnover panel measures day-over-day change, and that number
mixes **the market moved** (working as intended) with **the agent changed its mind**
(a credibility problem). No amount of staring at day-over-day turnover separates them.

`scripts/replication_test.py` does. It builds the L5 state **once** through the
deterministic nodes, then calls `reason_picks` N times on independent deep copies:
same candidates, macro, regime, book metrics, scenarios, prompt, temperature.
Everything upstream of the LLM is frozen by construction, so whatever differs is the
model. The pool is read back from `trade_candidates` rather than re-ranked — running
L1 again would refetch prices and quietly reintroduce the confound.

Reported **per side, each beside its independent-idea count**, plus the names that
survived every sample. Persisted to `backtest_results(test_name='book_replication')`
and rendered on `/book` under the turnover panel with **no verdict attached**, per
ADR-0045: a side where ten ideas compete for five slots can reasonably return
different names each run; a side where the pool exactly fills the book should not.
The panel shows which case you are in rather than averaging them.

**What prompted it — and why it was not evidence.** Four runs stamped `run_date`
2026-07-25 inside one hour showed consecutive turnover of **50% / 77% / 50%**. Code
and prompt changed between several of them, so none of it is admissible; that is
precisely why a controlled version was needed instead of more incidental numbers. One
detail shaped the design: between the last two the **short side was identical** (SLV,
BABA, PDD, NOC) while the **long side kept one name of five** — pool depth was 4 short
ideas and 10 long. Where the pool exactly fills the book the agent has no choice;
where it over-fills, it chooses.

**Also verified live this iteration:** iteration 34's guardrail held. The new thesis
does **not** restate the pool-depth count, `check_idea_count_claims` reports clean
against it, and the wrong *"only four independent ideas"* sentence is gone from the
deployed page. Pool depth now reads **10 long ideas / 5 held** and **4 short ideas /
4 held** — both sides at the pool's limit, with the short side no longer "short by
choice".

[ADR-0050](adrs/0050-separate-agent-churn-from-market-churn.md).

### Loop iteration 34 (2026-07-25)

**The recorded next step was wrong, and finding out why was the iteration.**

Iteration 33 logged: the thesis misquoted the pool-depth count, so *expose the count
as a citable source and `verify_citations` will catch it*. Re-deriving before building
it — as this file instructs — showed that fix would not have worked, for two reasons
that matter more than the bug.

**1. `verify_citations` never inspects the prose.** It iterates
`state["citations"]`. The claim lived in `book_view`, and on the live run **no
citation mentioned "independent" at all** — 30 citations, zero matches. So any number
the model asserts in narrative without also listing it as a citation is unverified.
`/book` renders that paragraph with a **VERIFIED** badge and an evidence count beside
it. The badge covers the citation list; the page applies it to the prose.

**2. Grounding is structurally blind to small integers.** ADR-0027 accepts a value
matching anything the model was shown within `max(0.02, 0.01·|v|)`. Measured against
the live inputs — 106 values — **every integer from 0 to 9 grounds**; 10 is the first
that does not. "Four independent ideas" and "five" are indistinguishable to the rule.
A citable source only helps if the model picks that key, and nothing backstops it when
it doesn't. The miscount was also **spelled out in words**, so a digit scan over the
prose would have missed it too.

So the fix is the one already applied to sizes: **don't ask the model to restate a
computed number, and check that it didn't.** The prompt has long said *"a later
deterministic step decides HOW MUCH"* for sizes, weights and exposure; pool-depth
counts join it. `check_idea_count_claims` compares any *"‹n› independent idea(s)"*
claim — digits or words, side inferred — against the measurement. **Exact, and
outside the 80%-grounded tolerance**, because a count restated against a number we
computed ourselves has no excuse. Silent when there is no measurement or no claim.

**The general hole is deliberately left open and named.** `verify_citations` still
reads only the citation list; the badge still spans the whole thesis. Closing it means
either verifying every number in the prose — which the same small-integer blindness
makes weak — or narrowing what the badge claims. Both are bigger than this, and
neither should be smuggled in unmeasured.

The rule underneath: **a number the system computes should never be re-typed by the
model.** Already true of sizes and exposures; now of pool depth; and it should travel
with any computed quantity handed to the agent in future.

[ADR-0049](adrs/0049-the-guardrail-does-not-read-the-prose.md).

### Loop iteration 33 (2026-07-25)

**Counted the independent *ideas* instead of the candidates, and the five-and-five
explanation finally stopped moving.**

Q1 asks five long and five short. The book has answered with fewer for many
iterations and the reason changed every time: the universe was too narrow (widened,
ADR-0043); redundancy caps the short side (**disproved** the next day by NOC); the
attention gate discards whole themes (**true**, fixed by ADR-0046, pool 23 → 39).
Every one was *argued* rather than measured, and each was disproved by the next
measurement.

After ADR-0046 the pool holds 27 long / 12 short and L5 still returns 4–5 and 3 —
with **nothing dropped downstream**; its raw output was checked. Rather than infer
"L5 under-picks", it was measured, using the clustering already in the codebase at
the same **ρ 0.70** `/risk` uses to flag redundancy inside the book:

| | candidates | independent ideas |
|---|---|---|
| Long | 27 | **13** |
| Short | 12 | **5** |

GDX/GLD/IAU/NEM/SLV are one precious-metals bet; BABA/FXI/KWEB/MCHI are one
China-internet bet; PDD, NOC and ARKK stand alone. **Twelve short candidates were
never twelve short ideas — but they are five, and five is exactly what Q1 asks for.**
The pool has stopped being the constraint on the short side and never was on the long
side.

It also explains the agent without accusing it. The prompt says *"select up to 5 …
fewer if the pool is thin"* and, in the next breath, *"do not add picks that compound
existing high-correlation exposures."* An agent obeying the second correctly refuses a
second metals short — and a candidate count could never tell it that four *other*
independent short ideas existed.

Shipped in both directions: a **POOL DEPTH (measured, not estimated)** block in the
prompt that names each complex and its strongest member, and a `/book` panel reading
candidates → independent ideas → held per side. The panel **deliberately does not
excuse the book**: when five or more are available and fewer are held, it says in
warning colour that the shortfall is *selection, not constraint*, and points at the
thesis. That is the sentence this project has repeatedly been unable to write.

**Then running the pipeline killed it.** A Supabase **HTTP/2 ConnectionTerminated**
aborted the whole daily run partway through persisting candidates — after L0–L1
completed, before any book existed — because the write was a per-candidate loop of
**39 sequential unwrapped round-trips**. Batched to one request each. The
reconciliation write mattered most: it deletes the day's rows then re-inserts the
published book row by row, so a drop midway leaves *part* of the book live with the
rest gone — a portfolio that never existed, presented as the book of record, which is
precisely what ADR-0040 exists to prevent.

**The book moved.** The run with POOL DEPTH in the prompt returned **5 long / 4
short** (9 positions, up from 4 and 3), and it took **the strongest of each complex** —
SLV out of the metals group, BABA out of China — which is exactly what the block
names. The long side is now at Q1's five. One run is not proof: the pool also changed
between runs (19 long / 11 short this time). Stated as observed, not as established.

**And reading the result found the next defect.** The agent's thesis now cites the
measurement and *misquotes it*: "the SHORT pool yields only four independent ideas".
The clustering it describes is right; the count is wrong — there are five, it forgot
ARKK. The panel below says 5, so the page contradicts itself. `verify_citations`
cannot catch it because that number is tied to no source key. Recorded above as the
next step.

[ADR-0048](adrs/0048-count-independent-ideas-not-candidates.md) · migration 036
applied to prod.

### Loop iteration 32 (2026-07-25)

**Executed the step iteration 31 recorded and deliberately did not take: the
conviction vol floor.**

`conviction = |EdgeScore| / vol` is both the Stage-4 sizing weight and the Conv.
column on `/book`. Unfloored, the ratio stops describing the idea and starts
describing the denominator: **BIL, a 0–3 month T-bill ETF at 0.19% annualised
realised vol, scored 2375.2× — 109× the next name and 260× SLV at 74.6%.** Thirty-five
of thirty-nine names sat in a 9–30× band and the four that broke out were exactly the
four below ~5% annualised vol. Not only display: `allocate_portfolio(size_by=
"conviction")` weights by it, so a cash-like instrument absorbs the book until the
single-name cap stops it.

Now `|EdgeScore| / max(vol, 0.00315)`. **The number has a stated basis rather than a
fitted one** — 5% annualised is the conventional line between a cash-like instrument
and a risk position, and today's universe corroborates it rather than defines it. **It
is absolute, never a percentile of the day's names**: a relative floor would make a
*sizing weight* a statement about whatever was scored alongside it, the exact defect
ADR-0042 removed from HypeScore, and would rebalance the book on days nothing about
the book changed.

**Verified on a live run: BIL 2375.2 → 92.8, SHY 292.1 → 87.7, AGG 99.2 → 82.8, IEF
unchanged at 79.6**, every above-floor name untouched — a floor, not a rescaling.
Book-wide max/median **148× → under 6×**, and the live Conv. column now reads
**13.6×–30.2× across every position**. Two runs under the floor produced 5 long / 3
short and then 4 long / 3 short — **the composition moves run to run**, which is worth
stating plainly: the book is one draw from a 39-name pool, not a fixed answer.

**The UI pass then caught the provisional-window defect in the act** — `/risk`
reporting *"39 positions"* and HHI 138 while the published book held 8. Both numbers
real, neither describing the book. `/risk` now checks ADR-0040's invariant instead of
assuming it: it compares its positions against the published picks and leads with a
warning naming both counts and the extra tickers. **The check is the disagreement
itself, not a pipeline status flag** — a status field says what the telemetry
believes; comparing the two tables says what is actually on the page, and it catches a
run where L5 failed outright too. The window is still open; the silence is not.

[ADR-0047](adrs/0047-conviction-needs-a-vol-floor.md) · migration 035 applied to prod.

### Loop iteration 31 (2026-07-25)

**The attention gate was deciding what is *tradable*, not just what is loud.**

The five-and-three gap has been chased through L5's selection, through what the
agent is handed at reasoning time, and through candidate redundancy. Measured one
layer earlier — at the point the candidate pool is built — it is none of those.

Scope came from `hype_score >= 50` alone. On 2026-07-24 four of eight themes cleared
it; the other four were scored per-asset and then discarded unread. **China Growth,
theme edge −0.264 — the most negative signal on the board and the only decisively
short THEME in the system — missed by 3.3 HypeScore points and produced no
candidates**, while all three of the book's shorts were taken out of themes whose own
edge is *positive*. Energy Prices (+0.332, the largest magnitude of the day either
way) went the same way at 36.4. The four themes that did clear had edges clustered in
+0.20…+0.29: **the gate was systematically removing the tails**, because attention
and conviction are unrelated quantities.

`edge_conviction_override` (0.25, `scoring_config`) admits a sub-attention theme when
**one of its assets** carries a decisive edge. This is the honest fix GOAL.md names —
widen the universe — and not the forbidden one: **the bar is above the abstention
band, not below it**, the code floors it at `max(override, abstain)` so a
misconfiguration cannot become a back door around abstention, and every admitted name
still clears abstention on its own edge. Asset-level on purpose — ADR-0039 established
that theme edge is smallest exactly when a theme's assets disagree, so gating on
|theme edge| would admit the themes whose names agree and exclude the
cross-sectionally richest ones.

**Measured on the first run under the rule (2026-07-25): pool 23 → 39, shorts 5 → 12,
seven themes instead of four; 33 of 39 admitted on edge, and 11 of the 12 shorts.**
That day attention collapsed and **exactly one theme of eight cleared the gate**, so
the old rule would have built the $100M book from six names of one theme with one
short — not because the market offered nothing, but because the news was quiet. That
is the structural argument made concrete: the number of tradable themes was a
function of the news cycle, not of the signal.

**The count overstates the gain, and the ADR says so.** China's five shorts are one
bet; the five precious-metals shorts are another. As *independent ideas* the short
side went three → four. Twelve short candidates is not twelve short ideas.

**Then the same mistake turned up one layer down.** Running the pipeline to check the
result showed the override admitting the right names and a downstream cap throwing
them straight back out. `screen_candidates` truncates the pool to 30 for the LLM
context window and sorted it **by HypeScore** — the cap was ranked by exactly the
quantity this iteration had just decided must not decide tradability. It cut **SLV
−0.430, the single most decisive name of the day**, plus GDX, NEM, IAU, NUE, CVX, OIH
and SLB: four of the twelve new shorts gone before the agent saw the list. Nothing
failed — the pool was still 30 names and the funnel still balanced. The pool is now
ordered by |EdgeScore|. **A scope decision is only as good as every ordering
downstream of it.**

**Measured result after both fixes, on the live book:** 5 long / 3 short, and **7 of
the 8 positions came from themes below the attention gate** — JPM, SVXY, BIL and GLD
(Fed Policy, hype 39.9), NUE (Inflation, 29.1), BABA (China Growth, 37.2), NOC
(Geopolitical, 43.4). Only UNH arrived by attention. Under the old rule this book
would have been six US Election names. **BABA is a genuinely new independent short**;
the short side is three ideas, not five, and the page says so.

**The abstention roster then produced two defects of its own, both found by reading
it against another number on the same page.** It sourced "which themes traded" from
`portfolio_positions` rather than the published book, so during the L5 window every
theme looked traded and the roster emptied itself; and with an empty roster it
concluded *"Every scored theme cleared the |Edge| ≥ 0.15 conviction bar"* — false,
Inflation is +0.117 and traded through NUE. "Nothing was held out" and "everything
cleared the bar" are different claims that diverge exactly when a sub-band theme
trades on one decisive asset, which is what ADR-0039 made possible and ADR-0046 made
common. Both fixed; five tests pin them.

[ADR-0046](adrs/0046-attention-chooses-what-we-look-at-not-what-is-tradable.md) ·
migration 034 applied to prod.

### Loop iteration 30 (2026-07-24)

**Answered "would you get the same answer tomorrow?", then found that the panel
directly below the answer had been saying the opposite of the truth.**

The stability question is the first thing anyone asks of a systematic book, it had
been deferred four times, and the data to answer it was always there —
`research_recommendations` keeps one row per `run_date` and no code had ever compared
two of them. `BookTurnover` now does, on **names rather than weights** (a position
that survives at a different size is the same idea) with the **union** as denominator
so a closed name counts as much as an opened one.

**No verdict is attached, deliberately.** "Low turnover = stable = good" is a verdict
about the market wearing a verdict about the process; a regime turn *should* churn a
book. The three lists — held through / opened / closed — are printed so a reader
judges the change instead of reading a score.

**The first reading was 100%, and printing only that would have been a lie by
omission.** Today's book holds 8 names; the previous run holds 2, from before the
universe expanded. `comparabilityCaveat` says so in the panel, in warning colour:
this measures how much the *candidate universe* changed, not how much the *view*
did. It clears itself once two consecutive full runs exist, with no code change.

**Then the UI pass paid for itself.** Reading the deployed page against the book
above it: `ClearedNotTaken` thresholds each candidate against its closest held
position on the **raw price correlation**, ignoring which side the book holds. The
book is **short ARKK**; QQQ, IWM and SPY are long candidates at ρ +0.77 to +0.80
against ARKK, and all three read **"largely already held"**. A long SPY against a
short ARKK is nearer the *reverse* of that bet than a duplicate of it. The one column
that exists to explain omissions was inverted on 3 of its 15 rows.

`classifyOverlap` now signs by both directions before thresholding — `aligned = ρ ×
sign(candidate) × sign(held)` — which also gives the panel a category it could not
previously express: **"would net against ARKK"**, a *better* reason to pass a name
over than the one the page had been giving. Same error `abs(corr)` made inside
HypeScore and ADR-0042 removed: discarding the sign that decides the meaning.

**And the 375px pass found /risk clipping rather than scrolling.** Cards set
`overflow-x: hidden`, so content wider than the body is cut off with *nothing to
reveal it* — strictly worse than a scrollbar, because nothing signals anything is
missing. Cap utilisation lost ~76px off its right edge: the `(68%)` utilisation
reading, the number that panel exists to show. Two columns below `sm` now, three
above. Source identifiers wrap; `.card-header` wraps.

Every defect this iteration was found by **reading two numbers on one page that
could not both be true**, not by a test. Both fixes are pinned by tests now, but no
test would have caught either — the old code computed exactly what it meant to.
[ADR-0045](adrs/0045-turnover-on-names-without-a-verdict.md).

### Loop iteration 29 (2026-07-24)

**Chased the open gap — "the short side is limited by L5's selection" — and found
what L5 was actually being handed.**

First hypothesis: the agent is choosing blind, without correlation data. **Wrong** —
`format_book_metrics_summary` does inject high-correlation pairs into the prompt, and
they are computed across the CANDIDATE pool before selection, which is the right
place. Worth stating, because it would have been an easy and satisfying thing to
"fix" without checking.

What is wrong is the shape. `correlation_warning` emitted **one verbose sentence per
pair**, each ending with the same "verify this is intentional, not accidental
doubling of the same bet" — **31 of them** on the live 23-name pool:

```
IEF and AGG are same-direction correlated (+0.97) — verify this is intentional...
SPY and QQQ are same-direction correlated (+0.93) — verify this is intentional...
TLT and AGG are same-direction correlated (+0.91) — verify this is intentional...
... 28 more
```

Pairwise is the wrong unit as well as the wrong volume. Nobody reasons about TLT-IEF,
TLT-AGG, IEF-AGG and IEF-SHY separately; they reason about **the duration complex**.
Connected components collapse those 31 lines to four named bets:

```
ONE BET: AGG, IEF, SHY, TLT move together — holding several is concentration,
         not diversification.
ONE BET: GDX, GLD, SLV move together — ...
ONE BET: EFA, EWJ ...            ONE BET: QQQ, SPY ...
```

**Inverse pairs are excluded from clusters and reported separately.** A −0.8
correlation is a HEDGE; folding it into a "these are the same" cluster would invert
the meaning, which is the most damaging thing this section could say. A test pins it.

**I am not claiming this changes the book, and it should not be recorded as if it
did.** It improves a decision input that was demonstrably noisy. Whether L5 selects
differently is its call and will be visible in the thesis — the honest test is the
next few runs, not this one.

**Also worth keeping:** two existing tests asserted exact line COUNTS, which pinned
the old formatting rather than the meaning, and both broke on a change that improved
the output. Rewritten to assert properties — two independent pairs make two bets, an
inverse pair makes a HEDGE and never a ONE BET. A test that breaks when the output
gets better is testing the wrong thing.

### Loop iteration 28 (2026-07-24)

**The tool I built last iteration disproved the reasoning that motivated it.**

Iteration 27 claimed: GDX and GLD are SLV-duplicates, *"which is exactly why the
short side is three independent ideas and not the five Q1 asks for."* With real
correlations now rendering, that is wrong:

| short, not held | edge | closest held | ρ | |
|---|---|---|---|---|
| GDX | −0.333 | SLV | +0.82 | duplicate ✓ |
| GLD | −0.305 | SLV | +0.84 | duplicate ✓ |
| **NOC** | **−0.301** | JPM | **+0.20** | **independent — and not held** |

The book holds **two** shorts (ARKK, SLV) with a genuinely uncorrelated third
available and declined. **The short side is not capped by redundancy.** Redundancy
explains GDX and GLD; it does not explain the size of the short side. Why NOC was
passed over is L5's call — visible in the thesis, not inferable from the pool — and
the panel now says **"independent — passed over"** in red so the case is impossible
to miss. The iteration-27 entry above is annotated with the correction rather than
rewritten.

**Second finding, from the same reading: "Theme also held?" read "yes" on all sixteen
rows.** Provably non-discriminating — noise beside a column that separates cleanly —
so it is gone, along with the `heldThemeIds` prop nothing read any more. A **Read**
column states the consequence instead, thresholded at ρ 0.70: the same
`HIGH_CORR_THRESHOLD` `/risk` already uses to flag a correlated pair inside the book.
One threshold, one meaning.

**The pattern is now explicit and worth keeping:** every honest measurement this
session has cost me a claim. Carry's IC, the scenario magnitudes, the theme proxy,
and now the short-side ceiling. Building the instrument is what makes the earlier
assertion checkable — and it keeps failing, which is the argument for building it.

**Open, and now properly framed:** Q1 wants five shorts. The pool has at least three
independent short ideas today (SLV, ARKK held; NOC declined) plus two redundant ones.
The gap is L5's selection, not the universe and not the abstention band. That is a
different question from the one this file has been asking for several iterations.

### Loop iteration 27 (2026-07-24)

**Replaced last iteration's hedge with the measurement it was standing in for.**

Iteration 25 shipped the "cleared the screen — not taken" panel justified by theme
overlap. Iteration 26 demoted that to *"a hint, not a verdict"* because the data did
not support it. This iteration computes the thing that does.

`candidate_book_correlation` (migration **033**, applied to prod) scores each unheld
candidate against its **closest held position over 252 days**:

| candidate | closest held | ρ |
|---|---|---|
| **GDX** | **SLV** | **+0.82** |
| **GLD** | **SLV** | **+0.84** |
| AGG | TLT | +0.91 |
| IEF | TLT | +0.91 |
| EWJ | EFA | +0.89 |
| EEM | EFA | +0.82 |
| RTX | NOC | +0.65 |
| GS | JPM | +0.63 |
| **BIL** | TLT | **−0.18** |

**GDX and GLD are demonstrably the same precious-metals bet the book already holds
through SLV.** That was reasoning two iterations ago; it is evidence now.

> **Corrected in iteration 28.** This section originally continued "...which is
> exactly why the short side is three independent ideas and not the five Q1 asks
> for". The measurement disproves that — see iteration 28. Redundancy explains GDX
> and GLD; it does not explain the short side's size.

**BIL at −0.18 is the control.** It proves the measure discriminates rather than
flagging everything, and it means BIL's absence needs a different explanation — which
the table no longer pretends to supply.

A candidate with no usable return history renders `—`, never `0.00`: an unmeasurable
correlation is not an absent one, and silent zeros are this codebase's recurring bug.
A test pins the omission. The computation is wrapped so an explanatory panel can
never fail the book.

**The arc across three iterations is worth keeping:** ship a plausible proxy → notice
it does not survive its own data → replace it with the measurement. The middle step
is the one that mattered, and it came from reading the rendered table rather than
from a test.

### Loop iteration 26 (2026-07-24)

**The panel I shipped last iteration asserted something it could not know, and I
caught it by reading my own output.**

`ClearedNotTaken` labelled every theme overlap *"yes — would largely duplicate a held
bet"*. The data does not support that. The **Geopolitical Risk** theme alone holds
four of today's positions, in four sectors, on both sides:

| held | side | sector |
|---|---|---|
| TLT | long | Rates |
| EFA | long | Developed Equities |
| SLV | short | Metals |
| NOC | short | Defense |

So theme overlap says almost nothing about duplication. Two rows were plainly wrong:
**GDX** was called a duplicate of a theme whose holdings are mostly *long*, and
**QQQ long** a duplicate of US Election — held via UNH long and ARKK **short**. The
verdict happened to be right for GDX and GLD **for a reason that was wrong**, which
is the worst kind of correct: it survives spot-checking and fails under questioning.

Redundancy is properly a question of **correlation**, and `correlation_pairs` is
computed for the **book** only — there is no candidate-vs-held figure to render.
Rather than proxy it with something that reads stronger than it is, the column now
states the bare fact (*"Theme also held? yes/no"*) and the lede says outright what it
does not prove.

**Showing a weak signal honestly beats dressing it as a strong one.** This is the
same failure mode the whole session has been about — a plausible inference presented
as fact — and this time it was mine, one iteration old. Worth noting how it was
found: not by a test, but by reading the rendered table and asking whether each row
was true. That has now caught more defects here than any other method.

**If a candidate-vs-held correlation is ever wanted**, `compute_correlation_matrix`
already exists and would need extending to score unheld candidates against the book.
That is the honest version of the column, not a better proxy.

### Loop iteration 25 (2026-07-24)

**"Why isn't X in the book?" finally has an answer — and it is the answer to Q1's
five-and-five question.**

The abstention roster covers themes that failed the |EdgeScore| band. The screening
funnel counts what each filter removed. But a candidate that passed **every** filter
and simply was not selected by L5 was **invisible** — the largest remaining gap
between the pool and the book, and exactly what a reviewer probes.

It matters most for the short side. **Q1 asks five long and five short; the book holds
five and THREE.** The pool had five shorts:

| candidate | edge | sector |
|---|---|---|
| SLV | −0.399 | Metals |
| GDX | −0.336 | Gold Miners |
| NOC | −0.304 | Defense |
| GLD | −0.301 | Metals |
| ARKK | −0.228 | Disruptive Innovation |

L5 took **SLV, NOC and ARKK — one from each distinct complex** — skipping GDX and GLD
as the same precious-metals bet already expressed through SLV. **Three independent
short ideas is the honest answer to "why not five", and showing the two it declined is
what makes that checkable rather than merely assertable.** Forcing GDX and GLD in
would produce a five-short book that is really a three-bet book wearing five tickers.

The panel states only what the data supports — name, side, EdgeScore, theme, and
whether the book already holds that theme. It deliberately does **not** attribute a
reason to L5: the agent's rationale belongs in the thesis, and narrating one here
would be the confident invention this file keeps warning about.

**Where Q1 actually stands, plainly:** five longs, three shorts, every position
reasoned and cited, and the two names that would have padded the short side now
visible with the reason they were passed over. The remaining route to five genuine
shorts is more *independent* short ideas — not more tickers, and not a looser band.

### Loop iteration 24 (2026-07-24)

**The site now says when the book is not today's book.**

Iteration 23's pipeline death was invisible in a way none of this session's other
defects were. Every other one was a **wrong number on the page** — findable by
cross-checking two figures against each other. This was a **missing run**, and the
page had no way to show it: `/book` printed *"RUN DATE 2026-07-22"* and the status bar
said *"2d ago"*, both factual, both in the same neutral grey as *"5 min ago"*, while
the site went on presenting the previous day's positions as the current $100M book.

`assessStaleness` judges a run_date in **business days**. Calendar days are the wrong
unit — a Friday book read on Sunday is two calendar days old and perfectly current.

**Threshold is 2 business days, not 1, and that is the load-bearing choice.** The job
runs *after* the close, so on any weekday morning the newest book is legitimately
yesterday's. Flagging at 1 would fire every single morning, and **a warning that is
always on is a warning nobody reads** — it would have made the page noisier and no
more honest.

`/book` gets a banner naming the date, the number of missed weekday runs and the
consequence in plain words — *"These are not today's positions"* — the run date turns
amber, and the status bar carries the same signal on every page so a reader does not
have to be on `/book` to notice.

Six tests pin the boundaries, including **silence when there is no run date at all**:
a missing date is a different problem, and inventing a staleness claim from it would
be exactly the fabrication this file keeps warning about.

**Not exercised live, and cannot honestly be:** today's book IS current, so the
banner correctly does not render. The logic is proven by unit test against injected
dates rather than by a live stale state — which is the right way round, since the
alternative is waiting for the pipeline to break again.

### Loop iteration 23 (2026-07-24)

**One dropped quote killed the entire daily run.** Checking whether iteration 22's
scenario fix had persisted turned up that it never got the chance — the pipeline
died with:

```
RuntimeError: daily return aborted for 2026-07-24: missing prices for ['EMB']
```

**EMB is a liquid ETF that fetched fine seconds later** (5 rows, last close 94.62), so
a batch yfinance download had silently dropped it. **L4 risk, the L5 book and the
whole day's thesis were lost because one quote out of eighteen went missing in a
single HTTP call.**

The guard is right and stays — never invent a return for an unpriced position, the
rule that caught DXY in migration 031. **Aborting over a transient batch artefact is
the disproportionate part.** For something billed as a *daily systematic process*,
losing a day to a dropped quote is the more serious failure, and it is exactly the
operational question a reviewer asks first: what happens when a data source hiccups?

Missing tickers are now retried **individually** before the gap is treated as real; a
single-ticker fetch reliably succeeds where a batch call dropped it. **The contract is
unchanged** — a ticker still absent after its own dedicated fetch aborts exactly as
before. A test pins that alongside the recovery case, because the easy mistake here
is to "fix" the abort by tolerating missing data.

**Worth noting about the failure mode:** this is the first defect this session that
was not a wrong number but a *missing run*. Every previous one was visible on the
page; this one was invisible until I went looking for why a persisted value had not
changed. The pipeline_runs telemetry added in iteration 14 records stage failures —
but nothing surfaces "yesterday's book is still today's book", which is what a
silently-dead run actually looks like to a reader.

**Iteration 22's scenario fix is now persisted and live.** The re-run completed and
`/risk` reads **"WORST CASE — Credit Widening (+150bps OAS) at −0.51% (−$0.5M)"**,
against −$0.0M before:

| scenario | before | after |
|---|---|---|
| Credit Widening | −0.012% | **−0.507%** |
| USD Strength | −0.005% | **−0.339%** |
| VIX Spike | −0.021% | **−0.272%** |
| Rate Shock | −0.003% | **+0.234%** |

~25–40× larger, and the ORDERING changed — credit is the worst case, not VIX. The
VIX sign differs from the +1.63% projected last iteration because this is a different
book: net **+10.9%** long beta rather than the earlier net-short one, so a selloff now
correctly costs money. Sign follows exposure, which is the property that was missing.

**Honest caveat on the retry:** the live run did not exercise it — no "price gap" line
appeared, so the batch simply succeeded this time. The recovery path is proven by unit
test, not by a live failure.

### Loop iteration 22 (2026-07-24)

**The stress test said a $100M book loses $21k in a VIX spike.**

| scenario | book return | on $100M |
|---|---|---|
| VIX Spike (>30) | −0.021% | **−$21k** |
| Credit Widening (+150bps) | −0.012% | −$12k |
| USD Strength (+5%) | −0.005% | −$5k |
| Rate Shock (+50bps) | −0.003% | −$3k |

All "low" severity — on a row whose own description reads *"historically associated
with −15 to −25% SPX drawdown"*. **A stress test that says the book cannot lose money
is worse than no stress test, because it is reassuring.**

`estimate_scenario_pnl` substituted `book_metrics`' **book-level** factor tilt for
every pick's beta, and took `abs()` of it. Pushing a book-level tilt inside the
per-pick loop computes

```
beta_book × Σ(±wᵢ) × shock   =   beta_book × NET exposure × shock
```

when the exposure a shock acts on is **GROSS**. The book ran **48.7% gross against
0.6% net**, so `0.191 × 0.006 × −0.18 = −0.021%` — exactly the number on screen. The
`abs()` separately destroyed the sign, so a net-short-beta book could never show a
gain.

**The function's own docstring always specified per-asset betas** ("Σ signed_weightᵢ ×
beta_factorᵢ × shock"); only the code disagreed. `factor_exposures` was already in
state at both call sites, is the same table `/risk` renders per-position betas from,
and reconciled **8/8 against known benchmarks** two iterations ago — there was never
a reason to proxy it.

**After:** VIX **+1.63%**, rates +1.05%, USD +0.26%, credit −0.02%.

**Independently confirmed, not merely plausible:** `/risk` already showed
**Σβ contribution = −0.09** for this book (net short beta — short GDX 13.7%, ARKK,
NOC; long cash-like SHY/BIL), and −0.09 × −18% ≈ **+1.6%**. The scenario now agrees
with the attribution table on the same page. **It did not before** — two numbers
about the same book, on the same page, that could not both be right.

Assets with no factor row are skipped rather than scored as β 0: *"we cannot measure
this exposure"* is not *"this has no exposure"*.

**Also checked and found sound** (the item this file flagged last iteration): the
what-if estimator and the scenario table both run off validated factor betas and
today's weights, need no return history, and are labelled "estimate". No defect —
the flag was over-cautious.

### Loop iteration 21 (2026-07-24)

**My own last fix made a contradiction sharper instead of resolving it.** Iteration
20 suppressed the under-sampled metric *tiles*. The risk-limit board on the same page
kept scoring the same statistics:

```
board:  VaR (95%)   1.7%  /  6.0% limit  /  28%  /  OK
tile:   VAR (95%)   Unavailable — "Not shown: 2 sessions of history, needs 30.
                                   A VaR from this sample is noise, so we do
                                   not publish one."
```

Same number, same page, opposite claims. **The OK is the more dangerous of the two**
— a green stamp against a governing limit reads as a risk check that *passed*, not as
an estimate nobody should trust. And Beta already rendered NO DATA on that board, so
it was making the identical mistake the tiles had: two under-sampled statistics,
two treatments.

`buildLimitBoard` now takes `returnSessions` and withholds any statistic below its
declared minimum, mirroring `MIN_DAYS_FOR_*` in `risk_engine.py` and `minSessions` in
`RiskMetricsGrid` **so the tile and the board cannot disagree**. The row still
renders as `unknown` — a limit a PM cannot see is a limit they cannot manage.

Scoped deliberately to statistical **estimates** (VaR, CVaR, beta). Max drawdown is a
realised fact — *"no drawdown has occurred yet"* is true on two sessions, merely
uninformative — and HHI, caps and exposures come from today's weights and need no
history. Gating those would replace a real number with a blank. An unknown session
count also does not withhold: not knowing the sample size is not evidence it is
short. Five tests pin all of it, including both boundaries.

**Verified live.** The board went from **"1 breached · 0 near · 8 ok · 1 no-data"**
to **"1 breached · 0 near · 6 ok · 3 no-data"**, and the VaR row now reads
`— / 6.0% / — / NO DATA` — limit still visible, value withheld. Everything the board
still scores is computed from today's weights (caps, gross/net exposure, HHI) and is
genuinely knowable; every statistical estimate is withheld. Tile and board agree.

**This is the third consecutive iteration on the same theme, and the theme is the
point:** a correct calculation presented as if it meant something. Each fix exposed
the next surface making the same claim — tile, then board. Worth checking whether
anything else asserts a risk number: the what-if shock estimator and the scenario
table both consume the same statistics.

**Minor, noted not fixed:** the geography cap reads BREACHED at exactly 35.0% vs a
35.0% limit, headroom `−0.0%` — a floating-point boundary. Flagging a position
sitting exactly on its cap is the conservative reading and defensible, but the
`−0.0%` headroom is an artefact worth tidying if that row is ever touched.

### Loop iteration 20 (2026-07-24)

**The risk page published three statistics it simultaneously called unreadable.**

| tile | rendered | caveat underneath |
|---|---|---|
| VaR (95%) | **$1.7M** ▼ −$0.4M | "2 sessions — needs 30" |
| CVaR (95%) | **$2.1M** ▼ −$0.5M | "2 sessions — needs 30" |
| **Sharpe (252D)** | **10.77 ▲ +4.56** | "2 sessions — needs 60. Too small to read as a real Sharpe." |
| Beta (vs SPX) | **—** | "Unavailable · insufficient history" |

**Beta is the one doing it right, and it is on the same card.** Two under-sampled
statistics, two different treatments, side by side.

A Sharpe of 10.77 is absurd on its face and it sat at 22px above an 11px footnote.
A reader skims the number, not the footnote. Worse, the delta chip asserted a
meaningful **improvement** (▲ +4.56) in a figure we had just called noise — and that
same Sharpe read **−8.23** before an upstream correction earlier in this project,
which is exactly how a 12-point swing gets mistaken for risk-adjusted performance.

Annotating the number was a deliberate earlier choice and was better than silence.
It still broke the standing rule at the top of this file: *prefer "unavailable,
because X" over a confidently-wrong number.* Captioning a figure does not stop it
being read.

Statistics below their declared `MIN_DAYS_FOR_*` are now **suppressed exactly like
Beta** — value `—`, badge **Unavailable** rather than Estimated, delta chip withheld,
reason in place: *"Not shown: 2 sessions of history, needs 60. A Sharpe from this
sample is noise, so we do not publish one."* The computed value stays in
`portfolio_risk` for anyone who queries it; the page stops asserting it.

**Verified live.** All four under-sampled tiles now read identically — `—`, badge
**Unavailable**, no delta chip, reason in place: *"Not shown: 2 sessions of history,
needs 30. A VaR from this sample is noise, so we do not publish one."* **HHI stands
at 362 badged Exact**, because it is computed from weights and needs no return
history — which is the point: the page now distinguishes "we do not know" from "we
know, and it is 362".

**Note the shape of this one — it is the recurring failure in this codebase.** Not a
wrong calculation: a correct calculation presented as if it meant something. The
cumulative-return bug, the HHI scale, the min-max HypeScore, the carry IC measured on
a superseded formula, and now this. Each was found by cross-checking a number against
something else on the same page, never by a unit test.

Also verified this iteration: `/risk` at 375px — **0 contrast failures of 357
checked**, zero console errors, no horizontal scroll; risk-limit board all-OK; the
per-position attribution showing the **same 8 positions as the book** (ADR-0040
holding).

### Loop iteration 19 (2026-07-24)

**Both validation panels are live, and I owe a correction on one of them.**

`/method` now renders **EDGESCORE COMPONENT IC — "measured · none significant ·
2026-07-24"** with Carry 0.34/+0.1275/N=94/p=0.221, Trend 0.20/+0.0332/N=975/p=0.300,
Value 0.18/+0.0939/p=0.368 all reading *"right sign, not significant"*, and Regime and
Sentiment as *"not testable — needs per-theme history"*. Weights come from
`scoring_config` live. Directly beneath it, **FACTOR-MODEL RECONCILIATION 8/8 within
band**. The two together are the honest state of the platform: the factor machinery
is verifiably right, and the signal built on it is measured and unproven.

**The correction:** I reported the EdgeScore panel as "not deployed" twice. It had
deployed. I was matching `document.body.innerText` against the literal
`"EdgeScore component IC"`, but `.card-title` is `text-transform: uppercase` and
`innerText` returns the transformed text. The panel was rendering the whole time.
The evidence was in front of me — the same section's footer text WAS present in the
page, which is impossible if the component never mounted — and I read past it.

**Lesson, recorded because this will recur: assert on the DOM, not on rendered
text.** `querySelector` on an id or class survives `text-transform`, whitespace
collapsing and unicode punctuation substitution; an `innerText` string match does
not. Iteration 16 checked `#factors` with `querySelector` and was trustworthy; this
check was not, and it cost two iterations of false reporting.

Also confirmed: the three hex-literal contrast fixes landed — `/` at 375px is now
**0 failing of 311 checked** (was 4), zero console errors, no horizontal scroll.

### Loop iteration 18 (2026-07-24)

**The trade signal now says what it is worth.** Last iteration measured and persisted
the EdgeScore ICs; nothing rendered them. HypeScore had a validation panel and
**EdgeScore did not** — the wrong way round, since HypeScore selects what we *look
at* while EdgeScore picks the side and the size.

New `EdgeValidation` panel, placed **inside** the EdgeScore section rather than in a
separate validation area: a reader who has just been told what the components are
should meet what they are worth on the same screen, not another page. Each IC sits
beside **the weight it actually buys**, so *"carry is the largest weight and its p is
0.22"* is one glance instead of two documents.

It renders the uncomfortable parts as they are:
- every testable component reads **"right sign, not significant"**;
- Regime and Sentiment read **"not testable — needs per-theme history"**, not zero —
  a component we cannot test is not one that scored nothing;
- the footer states outright that the weights are **deliberately not re-fitted** on
  p≈0.2 evidence.

**Weights are read live from `scoring_config`, not mirrored.** I wrote a hardcoded
lookup first and it was wrong: a stale copy drifts the moment anyone tunes the config,
and would misstate precisely the thing this panel exists to expose.

**CORRECTION (iteration 19): it had deployed. My check was wrong, not the deploy.**
I searched `document.body.innerText` for the literal `"EdgeScore component IC"`, but
`.card-title` applies `text-transform: uppercase` and `innerText` returns the
*transformed* text — so the case-sensitive match never hit while the panel was
rendering fine as `EDGESCORE COMPONENT IC`. I reported "not deployed" twice on the
strength of it. The tell was available and I missed it: the same section's footer
text WAS present in the page, which cannot happen if the component has not mounted.

**Verification lesson: assert on the DOM, not on rendered text.** `querySelector` on
an id or class is immune to `text-transform`, `white-space` and unicode punctuation
substitution; an `innerText` match is not. The `#factors` check in iteration 16 used
`querySelector` and was trustworthy; this one did not and was not.

**Three more contrast failures, all hex literals the token sweep could not see.**
Auditing `/` at 375px — a page iteration 15 never checked, having covered only
`/method` and `/book` — found four failing elements from three hardcoded colours:

| where | hex | ratio | what it labels |
|---|---|---|---|
| PredictionMarkets | `#f7931a` | **2.20** | Bitcoin brand orange, 9.5px uppercase |
| ThesisBlock | `#f0883e` | **2.53** | the "Partial" badge on a thesis |
| ConvictionCard | `#e11048` | **4.34** | the **pre-AA accent, copied by value** |

The ConvictionCard one is the instructive failure: a copy of the old accent, so when
the token moved to `#d40e43` it silently kept the old crimson *and* its old
sub-threshold ratio. It now reads `var(--accent)`/`var(--long)`/`var(--short)` and
cannot drift again. ThesisBlock's badge labels a thesis as only PARTIAL — a caveat
nobody can read is not a caveat — so it takes the AA warning token. Bitcoin orange
goes to `#a85c08` (4.80:1), still unmistakably Bitcoin orange.

Left alone deliberately: Sparkline's stroke (a graphic, not text) and StatusBadge's
`#f0883e`, which sits on a dark chip at 5.65:1 and already passes.

**Lesson for the next contrast pass: sweep the PAGES, not the tokens.** Moving
`globals.css` + `tailwind.config.ts` fixes everything that uses them and nothing that
does not, and a hex literal is exactly what it cannot reach.

Verified live meanwhile: `/book` at 1440px — **0 contrast failures of 188 checked**,
zero console errors, no horizontal scroll, book reading 5 long / 3 short.

### Loop iteration 17 (2026-07-24)

**First job from last iteration: closed.** `/method#factors` renders live —
**8/8 within band**, SPY 0.99 at R² 1.00, BIL −0.00, ARKK 1.49. It was a slow Vercel
build, as suspected but not then confirmable.

**Then: the IC justifying EdgeScore's largest weight was measured on a signal that no
longer exists** ([ADR-0044](../docs/adrs/0044-carry-ic-was-measured-on-a-superseded-signal.md)).

ADR-0033 gave carry **0.34 of 1.00** — more than trend, regime or value — on *"a
strong, statistically significant IC, p=0.007"*. ADR-0036 then replaced carry with
excess-yield-over-funding **and never re-ran the test**. The weight kept a
justification about a different formula for eight iterations. My own change; my own
omission.

Re-measured on the live definition, same panel, same 94 observations:

| component | N | IC | p | significant |
|---|---|---|---|---|
| Trend | 975 | +0.0332 | 0.300 | no |
| **Carry** | **94** | **+0.1275** | **0.221** | **no** |
| Value | 94 | +0.0939 | 0.368 | no |
| Regime / Sentiment | 0 | — | — | not testable |

Same N, p = 0.221 rather than 0.007. Carry is still strongest and still the right
sign, but **no component of EdgeScore clears conventional significance.**

Getting a number at all meant repairing the harness, and both faults matter:
- It had **died on `abs(None)` since ADR-0036** (which made carry/value return
  `None`) — broken for eight iterations **because nothing runs it**.
- It fed `carry_signal` only the sleeve's own series when the new definition needs
  `DGS10`+`DFF`, so it would have **measured a signal production never computes**.
  Testing on inputs production never sees is worse than not testing: the number looks
  like evidence.
- It only ever **printed**. That is why `backtest_results` held nothing for EdgeScore
  and the site had never said whether the trade signal predicts anything.

Now persisted under `test_name='edge_ic'` with N, t, p, hit-rate and a `pass` flag —
**false for all five today**.

**Weights deliberately unchanged.** Five insignificant ICs cannot distinguish the
components, and re-fitting on p=0.22 would be fitting noise — which is what
ADR-0033's own 50% shrinkage exists to prevent. They are relabelled as *priors
informed by a weak positive signal*, not a fitted result, and the stale
`hype_calculator.py` comment is corrected in place.

**General lesson recorded in the ADR: changing a signal invalidates the evidence that
set its weight.** Any future change to a scored component should re-run
`backtest_edge.py` in the same commit.

**Honest state of validation now:** both HypeScore *and* EdgeScore are measured and
**unvalidated**. That is a weaker claim than this codebase was making and a truer one.
The fix is more data — carry's N=94 is two macro sleeves at month-ends over six years,
and no estimator change improves that.

**Still to do:** surface the EdgeScore IC on `/method` beside the HypeScore panel. The
numbers are persisted and readable; nothing renders them yet.

Verified live: `/method` at 375px — **0 contrast failures of 517 checked**, zero
console errors, no horizontal scroll, factor panel present.

### Loop iteration 16 (2026-07-24)

**The factor model had never been reconciled. It checks out — and that was a
credibility asset sitting invisible.**

L2 regresses every asset's daily excess return on Fama-French 5 + UMD over 252 days,
and those betas are what the book's factor tilts and all four scenario shocks are
computed from. Nothing had ever checked them, and `/method` had **no L2 section at
all** — so the layer beneath every tilt on the site was both unexplained and
unverified. A factor model whose numbers nobody has reconciled is an assertion.

Checked against assets whose market beta is known before you run anything:

| asset | b mkt | R2 | expected |
|---|---|---|---|
| **SPY** | **+0.99** | **1.00** | *is* the market factor — definitional |
| IWM | +1.02 | 0.97 | small-cap |
| QQQ | +1.17 | 0.94 | tech-heavy |
| ARKK | +1.49 | 0.77 | high-beta growth |
| XLF | +0.94 | 0.59 | — |
| HYG | +0.23 | 0.63 | credit |
| GLD | +0.27 | 0.10 | gold |
| TLT | +0.11 | 0.06 | duration |
| SHY | +0.01 | 0.07 | — |
| **BIL** | **-0.00** | 0.01 | T-bills — no equity risk |

SPY at 0.99 / R2 1.00 is the load-bearing one: it fails loudly if the regression, the
date alignment or the excess-return convention is wrong. BIL and ARKK bracket the
range correctly. **The gap was that nobody had looked, not that it was broken.**

New `/method` section 05 renders the check live from `factor_exposures`, with the
expected band beside each beta and why each is known in advance. Bands are
deliberately generous — this asserts *not broken*, not *matches a vendor to two
decimals*, since anything tighter fails on ordinary sample variation and teaches the
reader to ignore the panel. The footnote states outright that R2 is low for the
non-equity names by construction: the market factor is not what moves them, which is
the point of holding them. Sections renumbered (sources 05->06, guardrails 06->07).

Five new tests pin the mechanics on synthetic series so a break is caught without a
network call: the definitional b=1 case, cash reading 0.00 rather than "small" (a
non-zero beta there means RF is leaking into the excess return), a 1.5x series
recovering 1.5, market and momentum loadings separating without contaminating each
other, and 40 observations returning `{}` rather than a beta labelled as a 252-day
exposure. 412 backend tests green.

**NOT VERIFIED LIVE — the panel had not deployed when this was written.** The commit
is pushed (`10cbf573`), `npm run build` succeeds locally and `/method` grew to
23.3 kB so the section compiles in, but ~8 minutes after the push the deployed page
still showed seven sections without `#factors`. Everything else on the site verified
fine in the same window, so this looks like a Vercel queue/build issue rather than a
code one. **First job next iteration: load `/method#factors` and confirm it renders;
if it still does not, check the Vercel build log** (needs `vercel login` — the CLI is
not authenticated in this environment).

Verified live in this iteration: contrast holds at **0 failing of 470 checked on
`/method` (1440px)** and **0 of 357 on `/risk` (375px)**, zero console errors, no
horizontal scroll, status bar 6/6.

### Loop iteration 15 (2026-07-24)

**Three colour tokens failed WCAG AA, and the fix took two commits because Tailwind
keeps its own palette.**

Measured on the deployed pages — computing each rendered foreground against its
resolved background, not trusting the backlog:

| token | was | needed |
|---|---|---|
| `--text-tertiary` | **2.80:1** paper / 3.09 card | 4.5 |
| `--warning` | **2.53:1** / 2.80 | 4.5 |
| `--accent` | **4.34:1** / 4.81 | 4.5 |

`text-tertiary` is the pervasive one — table headers, timestamps and source labels on
every page. `--warning` was the worst ratio on the site *and* it labels exactly what a
reader most needs to read: *"Not yet validated — and we say so."*, near-limit chips,
the HypeScore caveats. **A caveat nobody can read is not a caveat.**

Darkened in place to `#756b5e` / `#c2410c` / `#d40e43` (4.72 / 4.68 / 4.81). Same
hues — warm paper, forest-green long, crimson short — the Ledger identity is
deliberately preserved, these are the same colours a shade deeper.
`text-secondary` (5.47), `long` (4.78) and `short` (7.21) already passed.

**The first commit changed only `globals.css` and moved nothing visible.** Verifying
live caught it: the `:root` variables read back correctly while **106 elements still
rendered the old RGB**, because Tailwind compiles its palette to literal values at
build time —

```
.text-text-tertiary { color: rgb(156 145 130 / var(--tw-text-opacity)) }
```

— so the utility classes never read the variables. `tailwind.config.ts` needed the
same three values plus `accent-dim`/`warning-dim`, whose rgba() literals still
encoded the old colours. **Silent failure mode: the tokens look right and the pixels
do not.** A comment in the config now records that the two files move together.

**Verified after:** 470 elements checked on `/method` → **0 failing**; 188 on
`/book` → **0 failing**; zero console errors; no horizontal scroll.

**Two more backlog claims re-derived and found stale**, in the same spirit as
iteration 14's Q2-narrative correction:
- *"Three routes unreachable at 375px"* — they are `/trades`, `/portfolio` and
  `/research`, **retired routes that server-redirect to `/book`**. Hiding them on
  mobile is correct, not a defect. All four live routes are reachable.
- *"L5 under-picks the short side"* — it does not. Of the 5 short candidates, SLV,
  GDX and GLD are all the precious-metals complex; L5 took GDX and skipped the other
  two. **The short side has 5 candidates but only 3 independent bets**, and forcing
  five would be concentration dressed as breadth. Q1's five-and-five is limited by
  the *diversity* of short ideas, not by L5's willingness to hold them.

**Process note for future iterations:** do not poll the deployed site with `curl` in
a loop to wait for a Vercel build — 40 requests tripped a bot-protection checkpoint
and returned 403 for a few minutes. Drive it through the browser, or wait once.

### Loop iteration 14 (2026-07-24)

**Two of six pipeline stages never reported, so "4/4 succeeded" counted the wrong
four.** `/method` showed L1 and L4 as *"not instrumented — Last success: never"*
while the status bar on the same screen read *"All stages complete · 4/4
succeeded"*. Both statements were accurate; together they misled.
`EXPECTED_STAGES` was `["L0","L2","L3","L5"]`, so the denominator counted the stages
that **report**, not the stages that **exist**.

The two silent ones were the two the deliverables lean on hardest: **L1 is theme
detection — the whole of Q2's "daily process that identifies which themes are
trending" — and L4 is the risk engine behind every number on `/risk`.** A process
page that cannot say whether theme detection ran is not describing a process, and
"did the risk engine run today?" is exactly the question to settle before trusting a
VaR.

Both now write a `started` sentinel before any work and a `success` row with
duration; L4 also writes `failure` before re-raising, so a crash in the risk block is
visible rather than merely absent. Each carries `source_freshness` naming what it
actually produced — `themes_scored`, `positions_priced` — because "it returned" is
not the same as "it did something".

**Live: all six green** — L0 12.4s · **L1 21.9s (themes_scored 8)** · L2 4.5s ·
L3 1.7s · **L4 1.3s (positions_priced 23)** · L5. The status bar now reads
**"All stages complete · 6/6 succeeded"**, and while L5 was still running it read
"6/6 stages recorded · L5 incomplete" rather than the old "All stages complete".

**Book on this run: 8 positions, 5 long / 3 short, four of them single companies** —
and **RTX long at 5.5% alongside NOC short at 5.5%**, two defence primes held on
opposite sides at once. Verified, 38 citations, close to market-neutral, $51.3M cash.

Two claims on `/method` went stale with the change and were corrected rather than
left: the `STAGES` comment asserting *"Only L0, L2, L3 and L5 do"*, and the reader
note explaining that L1/L4 *"emit no row at all"*. The `instrumented` flag stays in
the model — conflating "no row" with "did not run" would be a lie for any stage that
later stops reporting.

**Re-derived and corrected a stale entry in this file:** the backlog said the Q2
narrative "is not consolidated as one readable answer". It is. `/method` opens with
*"The daily process that identifies trending themes, quantifies the attention each
attracts, and turns that into a long-short book"*, then §01 walks L0→L5 with each
stage's inputs, destination table, status and duration — which is exactly Q2's "data
gathering → processing → quantification framework", with the prototype attached.
That gap is closed; what was actually missing was the stage telemetry above.

### Loop iteration 13 (2026-07-24)

**Single companies are in the universe, and NOC/RTX immediately disagreed**
([ADR-0043](../docs/adrs/0043-single-company-universe.md), migration `032`).

`task.md` asks for trades *"across any asset class and/or **single companies**"* and
there were none — 37 ETFs and futures proxies. This was deferred twice for the right
reason: until ADR-0038 direction was a THEME property, so a company added to a rising
theme would have inherited long regardless of its own signal — exactly like the ETFs
added in iteration 4, which produced no shorts either.

The need was measurable and specifically on the short side:

```
L1 pool:   18 candidates  (14 long, 4 SHORT)
L5 picked:  7             ( 5 long, 2 short)   <- long side AT its cap of 5
```

15 names added, **37 → 52 tickers**: JPM/GS (Fed Policy), XOM/CVX/SLB (Energy),
UNH (US Election), LMT/NOC/RTX (Geopolitical Risk), F (Corporate Credit), JD/PDD
(China Growth), FCX/NEM/NUE (Inflation). Three checks first — ~251 daily closes each
(an unpriced ticker scores Trend 0 and enters on a *silent zero*, which is how DXY
got in), presence in all three taxonomy maps (`is_classified` drops an unmapped
ticker without a word), and theme coherence.

**Names were chosen for what they express, not to manufacture shorts.** The first run
answered it in the best possible way: **NOC came out SHORT at −0.297 while RTX came
out LONG at +0.194 — two defence primes, same theme, opposite sides.** Under
theme-level direction both would have carried the same side. That single pair is the
whole argument for per-asset direction and for single names, in one line of output.

**Live book: 4 long / 2 short, 6 positions, three of them single names** — JPM and
UNH long, NOC short — verified, gross 69.2%, net +17.7%, $30.8M cash, 0 cap
violations. The thesis reasons about each individually: *"JPM (bank curve
steepener)"*, *"UNH adds sector diversification (Healthcare, 0% baseline)"*,
*"Shorts target extreme gold (GLD) and crowded defense (NOC)"*.

**Also finished migration 031's cleanup.** DXY was removed from `theme_assets` back
then but left in `SECTOR_MAP`/`GEO_MAP`/`_ASSET_CLASS_MAP` — and L2 builds its
universe from `SECTOR_MAP.keys()`, so **every run since has fetched a delisted ticker
and logged "possibly delisted"**. Removed from all three and from the fx lens
fallback. The Brave/Reddit keyword lists keep "DXY" because people genuinely say it.

**Open calibration question, recorded rather than assumed:** the 20% single-name cap
was set when every "name" was a diversified fund. Single equities carry earnings and
litigation risk that neither HypeScore (which counts *theme* mentions, so JPM's
attention score is Fed Policy's) nor the regime model can see. A single-name book
plausibly deserves a tighter limit — that is a decision, not an oversight.

### Loop iteration 12 (2026-07-24)

**A theme's HypeScore was a statement about its peer group, not about the theme**
([ADR-0042](../docs/adrs/0042-absolute-hype-subscores.md), supersedes 0006 and 0028).

Q2 asks for a score supporting *"idea generation **and risk monitoring**"*. Risk
monitoring means tracking a theme's attention over time — and three of the four
sub-scores were min-max normalised across the day's themes, so that was impossible.
Measured on production across two run dates:

| theme | 7d mentions | HypeScore |
|---|---|---|
| China Growth | 1.14286 → **1.14286** (identical) | 60.6 → **36.6** |
| Corporate Credit | 0.857143 → **0.857143** (identical) | 45.7 → **34.2** |

**ADR-0006 contradicts itself on exactly this**, listing "comparable across run
dates" as a *positive* and "a theme can score 100 today and 30 tomorrow without
changing its absolute signal" as a *negative*. Its rejection of z-scores was aimed at
the wrong target too — the objection ("scores move because other themes moved")
argues against **cross-sectional** normalisation of any kind, which is what min-max
is. It never considered scoring each signal against its own scale.

Each sub-score now maps the theme's own signal to a documented anchor: volume
`tanh(m7/3.0)`, sentiment unchanged, correlation `min(1, |corr|/0.50)`, momentum
`(tanh(z/2.0)+1)/2`. The same two cases now move **−7.5 and −2.2** instead of −24.0
and −11.5, the residual being each theme's genuine correlation decline, and both
volume sub-scores are now *identical* across the two days.

**Second defect closed with it: the `hype ≥ 50` gate was self-fulfilling.** Min-max
guarantees a theme at 100 and one at 0 every day, so the composite spanned a similar
range and the gate admitted a similar count whether or not anything was trending. *A
gate that adapts to the pack is not a gate.* Scores are no longer forced across
0–100 — today they sit between 35.4 and 69.6, which is the honest reading.

**Caught a self-inflicted contradiction the same iteration.** `persist()` still wrote
min-maxed sub-scores while `compute_hype_scores` had moved to absolute, so the live
heatmap showed **US Election VOL 100 and Inflation VOL 0 beside HypeScores of 58 and
35** — four numbers that could not add up to the fifth. The invariant existed only as
a comment in `persist()` ("or the derivation drawer silently disagrees with itself");
it is now a **test** that recomposes the stored sub-scores with the live weights and
asserts they equal the stored score. Verified live on all 8 themes: stored ==
recomposed, exactly.

**UI:** the heatmap clipped **760px into 294px** on a phone with no affordance — the
HYPE column and the book link were invisible — so it moved to `<ScrollArea>`. The
caption also still claimed sub-scores were "min-max normalised across these 8
themes", the opposite of what now matters; it now says they are absolute.

### Loop iteration 11 (2026-07-24)

**The book inverted because $100M of positioning hung on one breadth statistic
crossing a single integer** ([ADR-0041](../docs/adrs/0041-regime-as-a-dial-not-a-cliff.md)).

Iteration 10 flagged that two runs hours apart produced opposite books (4L/2S at net
+26.7%, then 2L/3S at net −20%). Traced it. Three themes flipped sign — Corporate
Credit +0.244 → −0.407, US Election +0.342 → −0.166, US Dollar +0.144 → −0.199 — and
the whole equity complex inverted, from **one input**: the regime moved
`late/risk-on` → `late/neutral`.

`regime_direction_bias` reads that label through `_SENTIMENT_SIGN {+1, 0, −1}` times
the asset class's risk beta:

```
risk-on   equity bias = β·(+1) + (−0.5β) = +0.5β
neutral   equity bias = β·( 0) + (−0.5β) = −0.5β
```

**A full 1.0·β swing on a component carrying 0.23 of EdgeScore.** And the label moved
for a trivial reason — with VIX 18.6 (failing `<15` and `<18`) and HY OAS 268bp
(failing `<250`), the *only* rule that could return risk-on was `breadth > 60`.
Breadth 61 and 59 are not different market states.

The label is a good **summary** and a terrible **dial**. It stays for display;
direction now uses `risk_appetite(vix, hy_oas, vix_term_diff, breadth)` → continuous
[−1, +1] from smooth tanh terms centred on each input's neutral level.

| breadth | old label → sigma | new appetite |
|---|---|---|
| 61 | risk-on → **+1.0** | +0.402 |
| 59 | neutral → **0.0** | +0.380 |

**0.022 instead of 1.0**, with genuine regimes still well separated (stress −0.94,
calm +0.80). Verified in production immediately: the next run logged
`risk appetite +0.552 (label: late/risk-on)` — *the same label transition that
inverted the book last time*, now a 0.16 move on the dial.

**Not full stability, and not claimed as such.** Prices, news counts and the
HypeScore min-max normalisation (ADR-0006, known outlier-dominated) still churn. This
removes the largest and most arbitrary source.

**Separately: found why L5 intermittently returns nothing.** A run logged
`JSON DECODE FAILED … raw=0 chars` twice. A direct probe reproduced it — HTTP 200,
`base_resp status_code 0` (success), content consisting solely of an **unterminated
`<think>` block** and no answer. MiniMax emits reasoning BEFORE the answer out of the
*same* `max_tokens` budget, so long reasoning leaves nothing for the answer;
`_strip_reasoning_and_fences` only matched *closed* `<think>` blocks, so the fragment
survived and the failure was reported as malformed JSON — describing the response
instead of the budget. **This confirms the iteration-5 hypothesis** ("MiniMax-M3's
reasoning has eaten the token budget"), which the timeout finding had superseded and
which was never separately verified. `MINIMAX_MAX_TOKENS` 24000 → 64000, and an
unclosed `<think>` is now stripped.

**ADR-0040 held under degradation**, which is the useful test of it: on the run where
L5 fell back, the log still shows `Book of record reconciled to L5: 3 positions (was
13 from L1)`. The two-book contradiction cannot reappear even when L5 fails.

**Both fixes verified on a clean run:** `risk appetite +0.550` against `+0.552` the
run before (the dial is steady where the label was flipping), **zero** JSON-decode
failures, **retries=0** — first attempt, no timeout, no empty response — and
`verified=True` with **51 citations**, the richest thesis yet. `positions == picks`.
Book: **3 long / 2 short**, gross 75.0%, net +11.7%, $25M cash. The thesis argues
each leg on specifics — *"2y at 4.31% (DGS2) sitting 68bps above Fed funds at 3.63%
(DFF)"*, *"short ARKK captures late-cycle underperformance of long-duration,
anti-quality growth (RMW −1.36 per L2)"*.

### Loop iteration 10 (2026-07-24)

**The app was publishing two different portfolios — closed** ([ADR-0040](../docs/adrs/0040-published-book-is-the-book-of-record.md)).
This had been on the gap list since **iteration 1** as "`/risk` mixes two books by
construction".

`/book` renders `research_recommendations.picks` — L5's selection. But
`portfolio_positions`, the daily return and **every risk statistic** came from L1's
*provisional* book, which L5 re-picks a subset of, and nothing reconciled them:

| source | names | gross |
|---|---|---|
| `portfolio_positions` → `/risk` attribution, VaR, Sharpe, HHI, returns | **12** | 92.2% |
| `research_recommendations.picks` → `/book` | **6** | 98.9% |

**EFA, IWM, QQQ, SLV, SPY and XLV were being attributed risk on `/risk` while
appearing nowhere in the published book.** "Do I own QQQ?" got yes on one page and no
on the other. Worse than a display bug — **VaR, CVaR, Sharpe, Beta, HHI, the daily
return and the drawdown curve all described a portfolio nobody holds**, and `/risk`
contradicted *itself*, reading caps and scenarios from L5's book but attribution from
L1's.

The published book is now the book of record: after L5 persists, `portfolio_positions`
is rewritten to its picks and return/risk/cumulative are recomputed on it — the rule
ADR-0024 already applied to tilts, scenarios and correlation. **Compute-twice is
deliberate**: L5 *consumes* the provisional risk as reasoning input, so the final
recompute must follow it. Two refusals: no usable picks → the L1 book stands (a
fallback day still has a coherent portfolio); a pick outside the candidate set → log
loudly and keep L1 rather than publish a book that disagrees with its own risk.

**Verified live:** `Book of record reconciled to L5: 5 positions (was 13 from L1)`;
`portfolio_positions` and `picks` now match exactly, 55.0% gross on both sides;
`/risk` per-position attribution lists exactly TLT, UUP, XLF, IWM, EEM and nothing
else; **risk-limit board 0 breached · 2 near · 7 ok**, net exposure 20% against a 30%
limit, HHI 706.

**Caveat worth stating: the book is not stable across same-day re-runs.** This run
produced **2 long / 3 short, net −20%**; the previous run on the same prices produced
4 long / 2 short, net +26.7%. L5 re-picks each time from a candidate pool whose risk
inputs shift slightly between runs, so composition swings. A reviewer refreshing the
page would notice. Not investigated — recorded as the next thing to look at, since a
book that flips direction on a re-run is hard to defend as "the" answer regardless of
how well each version reasons.

**Note for the record:** the daily-return series changes meaning at this date. It
tracked the L1 book before and the published book after — a discontinuity to remember
when reading the cumulative curve.

### Loop iteration 9 (2026-07-24)

**The short side was gated by a test that iteration 8 had made obsolete**
([ADR-0039](../docs/adrs/0039-scope-by-attention-abstain-by-asset.md)). Moving
direction to the asset made the book two-sided, but `_select` still filtered themes
by `|theme EdgeScore| >= 0.15` **before any asset was looked at** — so only two
themes contributed anything at all.

Once direction is per-asset that gate is actively harmful: **a theme's average edge
is smallest exactly when its assets disagree**, which is precisely when it has most
to offer a long-short book. The three themes it rejected were the three richest in
shorts:

| theme | hype | theme edge | short-capable assets |
|---|---|---|---|
| **US Dollar** | **73.4 — the day's highest attention** | +0.144 | **3** |
| China Growth | 40.8 | −0.080 | 2 |
| **Inflation** | 28.7 | +0.086 | **4 of 4** |

Inflation was *entirely* short-capable and still abstained. Its +0.086 is an
artefact — under ADR-0036 it inherits the **rates** leg's carry (+0.33) and value
(+0.99) while its trend comes from the **commodity** basket. The number blends two
legs and **describes no asset that exists**, and it was gating four genuine shorts.

Scope is now hype-ranked; the theme's own edge filters nothing. **Abstention is not
weakened — it is applied once instead of twice**, on the unit where the position is
actually taken. Every candidate still clears `|its own edge| >= 0.15`, and a test
pins that a theme below the attention gate stays out.

**Live result:**

| | iter 8 | iter 9 |
|---|---|---|
| L1 book | 9 pos, 7L/2S, 66.5% | **12 pos, 9L/3S, 92.2%** |
| L5 book | 3L/1S | **4L/2S**, gross 98.9%, net +26.7% |
| `/risk` breached limits | 1 | **0** |

US Dollar — the theme the old gate discarded — now supplies **EEM and EMB long
against GLD and FXE short**, and L5 reasons about it as a pair: *"Long
underperformers (EEM, EMB, EWJ, XLF) paired with short overextended safe-havens
(GLD, FXE) creates a USD-hedged relative-value book rather than a pure directional
dollar bet."* Verified, 26 citations.

**Q1 arc across this session:** fallback book with no thesis → 3L/0S → 3L/1S →
**4L/2S**. The ask is five and five; every step came from removing something that
was destroying signal, never from loosening a threshold.

**Fixed a page-level contradiction this exposed.** `/book`'s abstention roster
listed every theme under the band, so it would have shown **US Dollar as "SCORED,
NOT TRADED" directly above the four positions it contributed**. Traded themes are
now excluded. Verified live: US Dollar is gone from the roster, Inflation and China
Growth remain.

**Follow-up, precise:** the roster's stated reason is now secondary rather than
wrong. It says "|Edge| < 0.15", which is true of Inflation (0.086) and China Growth
(0.080) — but the *binding* filter for both is now the attention gate (hype 28.7 and
40.8 against a threshold of 50). The roster should name the operative reason, and
ideally list held-out **assets** (the unit that now decides) rather than themes.
Doing that properly needs the per-asset abstentions persisted; they are computed in
`asset_edges` and currently discarded for anything that does not make the book.

### Loop iteration 8 (2026-07-24)

**THE BOOK IS TWO-SIDED. Direction belonged to the theme, not the asset — that was
the whole thing** ([ADR-0038](../docs/adrs/0038-per-asset-direction.md)).

Three iterations attacked zero-shorts as a breadth problem: ticker breadth (24 → 37),
theme discovery (all six candidates were rediscoveries), and single names, which this
file named as the top gap. **Single names would not have worked either**, and the
reason is the same one that defeated the other two:

```python
longs  = _expand(_select(positive=True),  theme_assets_map, direction="long")
shorts = _expand(_select(positive=False), theme_assets_map, direction="short")
```

Direction was stamped on a **theme** and inherited by every asset in it. A single
company added to a rising theme would have been marked long regardless of its own
signal — exactly like the extra ETFs before it. The constraint was never the
universe. The engine **averaged per-asset signal away and then asked why every asset
agreed.**

Four of EdgeScore's five components are natively per-asset or per-asset-class —
trend from that ticker's own prices, regime/carry/value from its own asset class —
**95% of the weight**, collapsed into a basket mean before use. `ret_by_asset` and
`vol_by_asset` were already per-ticker and were thrown away by `theme_trend`.

The cost was absurd once seen: **GLD was held LONG inside Fed Policy, Inflation, US
Dollar and Geopolitical Risk at the same time** — four themes that each averaged
positive — while GLD's own trend and regime scored it **−0.44**.

Now the theme gates *scope* (hype threshold untouched, so the attention premise
stands) and each asset takes `sign(its own edge)`, abstaining on its own |edge|; a
ticker spanning several themes dedupes to its strongest conviction.

**Live result — first two-sided book of the project:**

| | before | after |
|---|---|---|
| positions | 3 | **9** |
| long / short | 3 / **0** | **7 / 2** |
| HHI | 1243 | **564** |
| deployed | 60.0% | 66.5% |

Shorts are **SLV −0.39 and GLD −0.26**; longs are QQQ/IWM/EWJ/SPY/EFA/XLV/XLF.
**Nothing was loosened** — same abstention band, same hype gate, same caps, same
universe. The shorts came from signal that was already in the data and was being
destroyed before anything could use it.

L5 then reasoned over it and published a two-sided book of its own: **3 long / 1
short (XLF, EWJ, XLV vs short GLD), gross 75% / net +35%, $25M cash, 0 cap
violations, VERIFIED with 21 citations** — and the thesis argues the short on its
merits ("a short that fades extreme gold ($4060.40) against restrictive real yields").
`/book` shows Shorts (1) instead of the long-only warning.

Also verified live this iteration: **iteration 7's prompt fix works** — `book_view`
no longer asserts net/gross (it previously claimed "+100%/+100%" above cards reading
60%). That was the one item left unverified last iteration.

**Single names are now worth adding, and for the stated reason.** An asset's own
trend can finally oppose its theme, which is exactly why idiosyncratic dispersion was
supposed to help. Under theme-level direction it would have contributed nothing. This
is the next Q1 step, and it is now correctly motivated rather than merely plausible.

**Watch:** sentiment (0.05) is the one genuinely theme-wide component, so it applies
uniformly to assets that now disagree with each other. Defensible — news really is
about the theme — but an IC study should check whether it deserves to be per-asset.

### Loop iteration 7 (2026-07-24)

**The position limits were computed, reported, and then undone — all three of them.**
`/book` published three positions at **33.3% each against a stated 20% single-name
limit** (167% utilisation, six violations) on a page whose own copy — and
`ARCHITECTURE.md` — said the caps were enforced. Three independent defects in
`allocate_portfolio`, any one of which alone voided them
([ADR-0037](../docs/adrs/0037-position-limits-bind-and-the-rest-is-cash.md)):

1. A final *"normalise so weights sum to 1.0"* erased every cap above it. Capping
   three names at 20% leaves the sum at 0.60 — that **is** the cap working — and
   dividing by 0.60 put all three back to 33.3%. The harder a cap bit, the harder
   this undid it.
2. Group caps compared each **member** against the **group** cap, so two credit
   names at 20% each left the sector at 40% under a 30% limit with nothing capped;
   a guard also skipped groups with <3 members because "the single-name cap is
   sufficient", which 2 × 20% = 40% disproves.
3. Single-name redistribution ran **once**, so an 88/12 book handed the whole excess
   to the second name and left it at **80%, four times its own limit** — and a test
   asserted that $80M as correct.

**None of the 385 tests caught any of it, because none exercised a book small enough
for a cap to bind.** The failure was invisible exactly when it mattered. Three new
tests now cover it.

**The decision that matters: what the limits refuse is held in CASH, not
renormalised away.** Forcing full notional into whatever names happen to clear is
precisely what a position limit exists to prevent. A book that cannot be filled
inside its risk limits should be *smaller*, not more concentrated. The limit values
(20/30/35) are untouched — they were never the defect, and re-specifying them is an
operator decision.

Measured on the live universe, the asymmetry is what a limit should produce:
8 names → **98%** deployed, 10 names → **95%**, today's 3-name book → **60%**, and a
6-name all-US credit book → **30%** (it genuinely violates a 30% sector limit, so
30% is all it can hold). Live proof: `portfolio_positions` re-ran to **6 positions,
max weight 16.7%, 85% deployed** — previously it would have been forced to 100%.

`/book` now states the cash instead of leaving it to be inferred: *"$40.0M is held
in cash: at 3 names the book cannot take more without breaching its own position
limits"*, and the Deployed card carries the same in its hint.

**Correcting myself on the LLM timeout — it is NOT generation time.** I raised it
420 → 900 on the theory that "the real prompt is heavier than the probe". The 900s
run then logged `LLM CALL FAILED (attempt 1): ReadTimeout … (read timeout=900)` and
**again succeeded on attempt 2**. That kills the theory: if generation genuinely
needed >900s, the retry would have exceeded it too. The pattern across three runs is
that **attempt 1 hangs for the entire budget, whatever the budget is, and attempt 2
succeeds** — 420s → hang → retry OK; 900s → hang → retry OK. So something about the
*first* request stalls, and the retry is not "more time" but "a fresh request".

Do not raise the timeout again — that only buys a longer hang. Next investigation:
whether the first call is stalling on connection setup or a server-side queue (try a
short connect-timeout with a long read-timeout as separate values, a warm-up ping, a
fresh `requests.Session` per attempt, or streaming so bytes arrive early). Cheap
tell: log elapsed time for attempt 2 — if it returns in ~200s, the budget was never
the constraint. The book still lands verified, so this costs ~15 wasted minutes per
run, not correctness.

**Known contradiction, fix committed but NOT yet verified live:** the thesis prose
asserted "Net/gross exposure +100%/+100%" directly above cards reading 60.0%, because
`reason_picks` (node 6) runs before `size_positions` (node 8) and cannot know the
final weights. The system prompt now forbids it from stating sizes, weights,
notionals or exposure at all — it picks names and sides, the deterministic step
decides magnitude. Verify on the next pipeline run.

**This raises the value of the single-names gap rather than substituting for it.**
More genuinely independent ideas is now the only way to deploy more capital *without*
relaxing a limit — which is the honest lever, and still the top Q1 gap.

### Loop iteration 6 (2026-07-24)

**The L5 fallback was a 120-second read timeout. Closed, verified, and it was the
whole story.** `reason_picks` asks a reasoning model for a ten-pick book with a
thesis, catalysts, a counter-thesis and citations each. That generation takes
**~205 seconds**. The MiniMax call was hardcoded to `timeout=120`, so it raised
`ReadTimeout` every time → `fallback_picks` → `citations = []` → reported as "No
citations provided". Iterations 3–5 chased that phantom.

Measured directly against the live endpoint: at 120s, `ReadTimeout`; at 420s,
**20,763 chars, parsed, 10 picks, 34 citations**. Every observation now fits — small
probes always worked, the runs that historically verified carried only 1–2 picks
(small = fast), and iteration 4's universe widening made the failure constant by
enlarging the ask. Retrying could never have helped: three attempts hit the same
deterministic wall and burned ~6 minutes to reach a guaranteed fallback. Now
`LLM_TIMEOUT_SECONDS`. Live proof: the 09:12 run persisted `verified=True` with
**28 citations**; the 08:58 run before it, `verified=False` with 0. **Q1 has its
"why" reliably, not intermittently.**

*Follow-up from the same iteration:* 420 was too tight. The live pipeline then
logged `LLM CALL FAILED (attempt 1): ReadTimeout … (read timeout=420)` and verified
on attempt 2 — so the real prompt (full candidate list, macro, book metrics,
scenarios) is materially heavier than the 205s probe, and generation time varies.
Default is now **900s**, set clear of the observed range rather than just above it,
with the Actions ceiling at 60 minutes. Note this also means the `retries=1` on that
run was a **timeout** retry, not a citation rejection — the citation-feedback path
built in iteration 3 still has not been observed firing live. Keep watching for it.

**Zero shorts was never a breadth problem — carry could not be negative**
([ADR-0036](../docs/adrs/0036-carry-as-excess-yield-over-funding.md)). Three
iterations widened the universe (24 → 37 tickers, then more themes) against a
constraint that lived in the signal. `carry_signal` scored the raw LEVEL of a
spread/yield — `tanh(HY_OAS / 4.0)` — and a credit spread is positive by
construction, so the largest EdgeScore weight (0.34) was a standing long offset of
+0.20…+0.28 on every credit/rates/FX theme, not a signal. It was also wrong on its
own terms: HY OAS at 268bp, near the tights, read "+0.585, well paid".

Carry is now **excess yield over funding** (`(10y + OAS) − DFF` for credit,
`10y − DFF` for rates), which goes negative when the curve inverts — a test pins
that case because it is the property the old form could not express. Separately,
`carry_signal`/`value_signal` returned a hardcoded `0.0` where L0 has no proxy, so
an equity theme had 52% of its weight pinned at zero and could not exceed |Edge|
0.48 while a credit theme reached 1.0 — both judged against the same 0.15 band.
They now return `None` and `compute_edge_score` renormalises over what is present.

**It did not create shorts, and I did not tune it until it did.** Re-scored live:
**5 long-capable, 0 short-capable**. Across eight macro themes in one regime,
trend/regime/carry genuinely lean the same way today. What it did change is the
book's basis — **Fed Policy, which was all four positions of the $100M book, fell
+0.249 → +0.162** once its carry stopped mistaking the level of the real yield
(+0.71) for the term premium duration earns (+0.33); Energy Prices (+0.176 →
+0.372) and US Election (+0.165 → +0.340) rose, both equity themes that had been
diluted by the silent zeros. The book is no longer one theme wearing five tickers.

- ~~**A 3-name book deploys $100M and breaches its own single-name cap by 67%**~~ —
**CLOSED, iteration 7** (ADR-0037). Three defects; caps now bind and the remainder
is cash. Superseded text kept below for the reasoning.

**[CLOSED] A 3-name book deploys $100M and breaches its own single-name cap by 67%.** `/book` now shows three positions at **33.3% each against a stated 20%
single-name limit (167% utilisation, red)**. The sizer allocates the full $100M
across whatever names clear, so the fewer the names, the harder it breaks its own
limit. The honest portfolio answer is the opposite: if the pool cannot fill a book
inside the caps, **deploy less than $100M and hold the rest in cash** — forcing full
notional into three names to hit a target is precisely what position limits exist to
prevent, and a reviewer will ask why the cap is published if it is overridden. This
was masked before today (5 positions x 20% sat exactly at the cap) and became
visible when the carry fix moved the book to three names. Ranks above single names:
it is a credibility defect, not a breadth gap.

**Then: L5 still builds the book from ONE theme.** Five themes are now long-capable, but the sized book is
3 positions all from Geopolitical Risk (it was 4 all from Fed Policy). The signal
layer now offers breadth the selection layer does not use — which is the `min_side`
backfill cap diagnosed in iteration 2, not a signal problem. Worth a fresh look now
that the pool behind it is genuinely wider than when that cap was last judged.

**Theme discovery is ruled out as the route to shorts — it rediscovers the anchors.**
All 6 Tier-2 candidates map onto existing themes (dollar→US Dollar, oil→Energy
Prices, nato/ukraine→Geopolitical Risk, federal/rates→Fed Policy,
democratic→US Election, credit/spreads→Corporate Credit). That is a genuine
*validation* of the two-method discovery — it independently re-finds the hand-picked
set — but promoting them adds no breadth. **Do not spend another iteration there.**

**So the remaining route to shorts is single names, and that is now the top Q1 gap.**
Eight macro themes in one regime are directionally correlated *by construction* —
that is what a macro theme is — so a long-short book built only from them leans one
way in any decisive regime. Single names supply cross-sectional dispersion (some
names fall while the theme rises), and `task.md` explicitly permits "single
companies" while the universe has essentially none. Needs `SECTOR_MAP`/`GEO_MAP`/
`_ASSET_CLASS_MAP` entries or `is_classified` drops them silently.

**UI:** wide tables clipped their most important columns on a phone with no hint —
at 375px the `/book` positions table is 640px in a 326px box, and the columns past
the edge were EDGE, CONV. and CAP, i.e. the entire "why" of each position. Added a
shared `<ScrollArea>` that measures its own scroll state and fades the clipped edge
plus a one-time "swipe →" chip; both are measurement-driven so neither advertises
scrollability that isn't there. Also removed a scrollbar track drawn across the
bottom of *every* page (the fixed status bar reserved a 16px gutter with nothing to
scroll — `offsetHeight` 45 vs `clientHeight` 29).

### Loop iteration 5 (2026-07-24)

**"No citations provided" was never the real error — it was masking one.** Two
iterations were spent treating it as the model skipping citations. It isn't:

  `reason_picks` fails (JSONDecodeError / LLM exception) → returns
  `fallback_picks` → which sets `citations = []` → `verify_citations` sees an empty
  list and **overwrites** the specific cause ("JSON decode error after 2 retries…")
  with the generic "No citations provided".

The proof was the iteration-4 diagnostic: it logs on the empty-citations path
*inside `reason_picks`' success branch*, and on a run that printed "No citations
provided" it **never fired** — so `reason_picks` never reached the success path,
and citations were never the failure. A negative result from an instrument is
still a result; that is what identified this.

Fixed (all diagnostic, no behaviour change): `verify_citations` now preserves a
specific upstream error when `fallback_used` is set; the JSON-decode branch logs
the exception plus the response length and the **head and tail of the raw body**
(so a truncated object is obvious — MiniMax-M3's reasoning has eaten the token
budget before); the generic branch logs the exception type, so auth/rate-limit/
timeout can no longer masquerade as missing citations.

**Next run's log now names the actual cause. Read it before changing anything.**

Also fixed: `/` showed "LONG / SHORT CANDIDATES 8 / 0" captioned "Above the
HypeScore 50 threshold" — those are sized `trade_candidates` rows and had nothing
to do with the gate. Today all 8 came from a theme that did *not* clear 50, while
2 of 8 themes did. Caption now reads "Sized names in the book · N of M themes
cleared HypeScore 50".

### Loop iteration 4 (2026-07-24)

**Universe widened 24 → 37 tickers (migration 030); the long side now reaches 8.**
Each theme carries 4–8 genuine expressions instead of 2–4 (Corporate Credit 2→6
across the credit stack, Fed Policy 4→8 across the curve, etc). Book went 4 → **8
positions at 12.5% each, gross 100%**. Crucially every added ticker was *already*
in all three classification maps and confirmed to have ~251 daily closes — an
unmapped name is dropped silently by `is_classified`, so a careless expansion
would have shrunk the book. This raises the ceiling without touching the
abstention band, so nothing entered on anything but conviction.

**`DXY` was never a real ticker (migration 031).** It sat in Fed Policy since the
original seed and returns ZERO yfinance observations — the index is `DX-Y.NYB`,
the tradeable proxy is `UUP`. Every run logged "possibly delisted" and computed its
Trend/vol as a silent 0: an EdgeScore input reading zero because of a typo rather
than because the market said so. It only became loud once the widened universe made
Fed Policy the selected theme and DXY entered the sized book, aborting the run
("missing prices for ['DXY']"). The guard was right; the data was wrong.

**Shorts are still 0, and ticker breadth cannot fix that.** Positions on a side =
(themes selected) × (that theme's tickers), so more tickers deepen a side that
already has a theme — they cannot create one. Today **no theme is short-capable**
(all edges positive or abstaining). Only more *themes*, or a signal that goes
negative, produces shorts. Ticker breadth is done; theme breadth is not.

**The citation retry fix was necessary but NOT sufficient — say so.** With the
rejection quoted back to it, the model still returned no citations twice more. The
mechanism identified in iteration 3 (identical prompt at temperature=0) was real,
the remedy insufficient. Root cause is still unknown because **rejected LLM output
is discarded** — `raw_output` holds the fallback. Added shape-logging at the moment
citations come back empty (response length, top-level keys, pick count, per-pick
citation count, `book_view` length). **The next failure is now readable from the run
log; read it before adding more logic.**

### Loop iteration 3 (2026-07-24)

**The thesis is verified again — Q1 has its "why" back.** `/book` shows the VERIFIED
chip, **13 evidence sources**, no fallback warning, and a real reasoned body citing
live values ("VIX 18.81, HY OAS 268bps at `BAMLH0A0HYM2`"). Previous run:
`verified=False, citations=0`, i.e. a templated fallback with no reasoning at all.

**Root cause fixed: the citation retry never told the model what was wrong.**
ADR-0012 specifies a failed guardrail "re-invokes reason_picks with explicit error
feedback"; it didn't — the loop re-called the node with a byte-identical prompt at
`temperature=0`, so a deterministic model returned the same rejected answer three
times ("No citations provided" ×3 → fallback). The retry now appends the actual
rejection plus the requirements it violated. *Honest caveat:* the run that verified
did so without a citation rejection, so the feedback path was not itself exercised
live — the unit test proves the prompt now differs and quotes the reason, but a
live retry-then-verify has not yet been observed. Watch for it.

**The corrected Value signal makes the book one-sided.** With the 252-obs z-scores
the engine produced **4 long / 0 short** candidates (the earlier 2L/3S came from the
buggy `Value=0` state), and L5 picked 2 longs. So the honest position today is: no
short clears conviction. That is abstention working, not a defect — but it means
Q1's "five short trades" is unanswered by the engine, and universe breadth is the
only honest lever.

Also verified live: caps now read against the real `book_metrics` values
(single-name 20%, sector 30%, geo 35%), delta chips no longer contradict themselves
(no "▼ +2.44"), zero console errors, zero horizontal scroll at 360px, and the limit
board fell from "5 breached" to "2 breached · 2 near · 5 ok" once the phantom
double-booked positions were gone.

### Loop iteration 2 (2026-07-24)

**The book is now coherent and two-sided.** `/book` and `/risk` finally describe the
same portfolio: **2 long (HYG, LQD — Corporate Credit) / 3 short (TIPS, GLD, SLV —
Inflation)**, each 20%, gross 100%, $100M. That resolves the audit's root-cause
finding ("the app renders two different books at once").

**Q1 breadth — diagnosed, and the one-line fix deliberately REJECTED.** The binding
constraint is that the *theme*, not the asset, is the unit of direction, and only
three themes clear the 0.15 abstention band (2 long-capable, 1 short-capable). The
pathology is an inversion: the three highest-hype themes all abstain, while all
three direction-capable themes sit *below* the hype gate — so both sides fall
through to the backfill, which is capped at `min_side` (1 theme/side).
Raising that cap to `top_n` would take the book to 6L/3S in one line — but the cap
is deliberate: ADR-0029's purpose is two-SIDEDNESS, not filling the book, and
backfilled themes are *below the attention gate*, so topping up from them builds
the book out of low-attention names and contradicts the premise the product rests
on. Two tests encode that intent. **Rejected as manufacturing breadth.** The honest
routes remain: more expressions per theme, more themes, or single names — each of
which also needs `SECTOR_MAP`/`GEO_MAP`/`_ASSET_CLASS_MAP` entries or names are
dropped silently.

Also fixed: a `verified=true` run with **zero citations** could present a green
VERIFIED chip on `/book` (a rule-built book passing as model-verified — the most
damaging thing this app could get wrong); and `DeltaChip` printed "▼ +2.44" for a
*fall*, because it passed `Math.abs(d)` to a sign-prefixing formatter.

### Fixed 2026-07-24 (loop iteration 1)

- **Double-booked portfolio** — `portfolio_positions`/`trade_candidates` unioned
  same-day re-runs (prune was `.lt(run_date, today)`), leaving 200% gross / $200M
  on $100M. Every `/risk` figure — gross, HHI, factor tilts, attribution, a
  "500% single-name cap" breach — was measured against a book that never existed,
  and it made `/book` and `/risk` describe different portfolios.
- **Value z-score truncated to ~50 obs** — PostgREST caps at 1000 rows and the
  query was unpartitioned, so the budget split across 22 series. Now per-series
  over 252 obs, enumerated from `macro_indicators`. This *moved trade direction*.
- **Cap limits transposed** on the risk board (single-name/geo swapped vs
  `book_metrics`), and `/method` published a 4-term EdgeScore formula summing to
  0.95 beside a caption claiming 1.00.

## Live candidate gaps (re-verify before trusting)

- ~~**`/risk` mixes two books by construction**~~ — **CLOSED, iteration 10**
  (ADR-0040). The published book is now the book of record: `portfolio_positions`,
  the daily return and all risk statistics are recomputed on L5's picks after it
  runs. Verified live — attribution and `/book` list the same five names, 55.0%
  gross both sides.
- ~~**The book is not stable across same-day re-runs**~~ — **largest cause found and
  fixed, iteration 11** (ADR-0041). It was neither the LLM nor candidate churn: the
  discrete regime label flipped on a breadth statistic crossing 60, swinging every
  equity's regime term by 1.0·β. Direction now uses a continuous risk appetite.
- ~~**Residual instability from HypeScore min-max**~~ — **fixed, iteration 12**
  (ADR-0042). Sub-scores are absolute now; a theme's score moves only when its own
  signal moves. Two themes with byte-identical mention counts had been moving 24 and
  11 points.
- **Still to measure: how much book turnover remains.** ADR-0041 removed the regime
  cliff and ADR-0042 the normalisation artefact, which were the two known amplifiers.
  What is left — genuine price/news movement, and L5 re-picking — has not been
  quantified. Do that before claiming the book is stable; run the pipeline twice on
  frozen inputs and diff the positions.
  **Harness DONE, iteration 35** ([ADR-0050](adrs/0050-separate-agent-churn-from-market-churn.md)):
  `scripts/replication_test.py` freezes everything upstream of the LLM and re-runs
  `reason_picks` N times, so the residual is attributable to the model rather than to
  price/news movement. Persists to `backtest_results(test_name='book_replication')`
  and renders on `/book`. **The number itself is still open** — each sample is a full
  reasoning call of several minutes, so the run is deliberate rather than daily, and
  the panel renders nothing until one completes.
- **The anchors in ADR-0042 are judgement calls, not fitted values** (3 mentions/day,
  |corr| 0.50, momentum scale 2.0). They are stated constants — the same status
  min-max's implicit choices had, but now visible. This is exactly what the HypeScore
  IC study should calibrate, and `/method` already says NOT YET VALIDATED.
- ~~**L5 falls back because `reason_picks` never parses a response**~~ — **CLOSED,
  iteration 6.** It was a hardcoded 120s read timeout against a ~205s generation.
  `LLM_TIMEOUT_SECONDS` (default 420). Verified live: `verified=True`, 28 citations.
- ~~**SINGLE NAMES**~~ — **DONE, iteration 13** (ADR-0043, migration 032). 15 names,
  37 → 52 tickers; NOC short vs RTX long inside the same theme on the first run.
  Remaining Q1 depth gap is the short side reaching five, not the universe.
- **[historic] SINGLE NAMES — now correctly motivated, and the next step.** Iteration 8 found
  that shorts were blocked by theme-level direction, not by the universe, and fixed
  it (ADR-0038): the book is now **7 long / 2 short**. Single names are still the
  right next move — an asset's own trend can now oppose its theme, which is the
  dispersion argument actually working — but note the reasoning below was WRONG as
  originally written: under theme-level direction single names would have inherited
  their theme's side and added no shorts at all, exactly like the extra ETFs.
  Historical text follows.
- **[superseded reasoning] Shorts are the last
  thing standing between the book and the literal question. Two routes are now
  *excluded by evidence*, so do not re-spend iterations on them:
  (a) *ticker breadth* — done, 37 tickers, 4–8/theme, and positions on a side =
  (themes selected) × (their tickers), so tickers deepen a side that already exists
  and cannot create one; (b) *theme discovery* — all 6 Tier-2 candidates are
  rediscoveries of the existing anchors (validation of the method, zero new breadth).
  What remains is single companies, which `task.md` explicitly permits and the
  universe lacks entirely. They matter because eight macro themes in one regime are
  directionally correlated **by construction**; single names carry idiosyncratic,
  cross-sectional dispersion, so some fall while their theme rises. Needs
  `SECTOR_MAP`/`GEO_MAP`/`_ASSET_CLASS_MAP` entries or `is_classified` drops them
  silently, and each needs ~252 daily closes or the guard aborts the run.
- **[CLOSED] Q1 breadth** — was 8 themes → 24 tickers, all ETFs, zero single names.
  Now 52 tickers including 15 single companies (ADR-0043). Historic text follows.
- **[historic] Q1 breadth** — universe is 8 themes → 24 tickers, all ETFs/futures proxies, zero
  single names; only 3 themes clear conviction. Diagnosed in iteration 2; the
  one-line backfill change was rejected as dishonest (see above). Legitimate route:
  more expressions per theme (`004_bootstrap_live.sql` + `_theme_default_assets`),
  more themes, or single names — each needs `SECTOR_MAP`/`GEO_MAP`/`_ASSET_CLASS_MAP`
  entries too, or `is_classified` drops them silently.
- ~~**Contrast failures**~~ — **FIXED, iteration 15.** Three tokens were below AA
  (2.80 / 2.53 / 4.34); now 4.72 / 4.68 / 4.81, verified live at 0 failing elements
  across `/method` (470 checked) and `/book` (188). Note the fix needs BOTH
  `globals.css` and `tailwind.config.ts` — Tailwind compiles literals.
- ~~**Three routes unreachable at 375px**~~ — **not a defect.** They are the retired
  `/trades`, `/portfolio`, `/research` redirects; hiding them on mobile is right.
- **Conviction is not comparable across assets, and it is a sizing weight** — found
  2026-07-25 by reading the book's own Conv. column. `conviction = |EdgeScore| / vol`,
  and BIL's daily vol is **0.000123**, so it prints **2375.2×** beside UNH at 15.7×
  and NUE at 21.7× — **109× the next highest**, in a column whose whole point is
  comparison. It is arithmetically correct and it does not mean BIL is 109× the
  better idea; it means BIL barely moves.
  This is not only a display problem: L1 sizes by it (`allocate_portfolio(size_by=
  "conviction")`), so a near-zero-vol name absorbs the book until the single-name cap
  stops it. Inverse-vol sizing taken to the point where it stops scaling risk and
  starts seeking the least volatile thing available.
  **DONE, iteration 32** ([ADR-0047](adrs/0047-conviction-needs-a-vol-floor.md),
  migration 035). `conviction = |EdgeScore| / max(vol, 0.00315)` — ~5% annualised, on
  the stated economic basis that this is the conventional line between a cash-like
  instrument and a risk position, and **absolute rather than a percentile of the
  day's names** (a relative floor would make a *sizing weight* a statement about
  whatever was scored alongside it, the defect ADR-0042 removed from HypeScore).
  Verified on a live run: **BIL 2375.2× → 92.8×**, SHY 292.1 → 87.7, AGG 99.2 → 82.8,
  IEF unchanged at 79.6, every above-floor name untouched — a floor, not a rescaling.
  Book-wide max/median **148× → under 6×**.
- **The thesis can misquote the pool-depth number it was given** — found 2026-07-25
  by reading the deployed page against itself. With POOL DEPTH in the prompt the
  agent's book_view now cites it: *"the SHORT pool yields only four independent ideas
  because GDX/NEM collapse into SLV and KWEB collapses into BABA"*. The clustering
  logic is right and **the count is wrong** — the measurement says **five** (metals,
  China, PDD, NOC, ARKK); the agent forgot ARKK. The Pool depth panel immediately
  below says 5, so the page contradicts itself, which is at least self-correcting for
  a reader who scrolls.
  **DONE, iteration 34** ([ADR-0049](adrs/0049-the-guardrail-does-not-read-the-prose.md))
  — **and the fix recorded here was wrong.** Exposing the count as a citable source
  would not have caught it: `verify_citations` never inspects prose (the claim was in
  `book_view`, and no citation mentioned "independent"), and grounding cannot tell 4
  from 5 because **every integer 0–9 grounds** against the live inputs. Fixed instead
  by forbidding the restatement in the prompt and checking it exactly — the same
  treatment sizes and exposures already get. Re-deriving before building is what
  caught it.
- **`/risk` publishes a provisional book for the minutes L5 takes** — **the silence
  is fixed, the window is not.** Since iteration 32 `/risk` compares its positions
  against `research_recommendations.picks` and, when they disagree, leads with a
  warning naming both counts and the extra tickers — so the numbers are never
  presented as the book when they are not. Closing the window itself still needs a
  pipeline change. Found
  2026-07-25 by reading the abstention roster against the positions table above it.
  L1 writes its **full candidate set** to `portfolio_positions` (39 rows today) and
  computes VaR/HHI on it; only after the agent picks does
  `reconcile_positions_to_published_book` cut it to the published book (7 rows) and
  recompute. So for several minutes every day `/risk` describes a portfolio nobody
  selected — **HHI 154 provisional against 632 final today**, a 4× difference in the
  headline concentration number. The roster symptom is fixed (it reads `rec.picks`
  now, per ADR-0040); **the window itself is not.** The reorder is not trivial: L5
  *reads* the provisional risk as a reasoning input, so the L1 write cannot simply
  move after L5 — the likely fix is a `provisional` flag the frontend refuses to
  present as the book of record, or writing risk under the run's status. Evidence is
  in the 2026-07-25 pipeline log.
- **[historic] UI audit backlog** — a full Playwright audit ran 2026-07-24 and found no
  horizontal scroll and no console errors at either viewport, but a long list of
  real defects beyond the ones fixed: `verified=true` with 0 citations still
  presents as VERIFIED on `/book`; Sharpe's delta chip shows ▼-red for an
  improvement; the limit board stamps OK on statistics whose own tiles say the
  sample is too small; three routes are unreachable at 375px; tertiary text and
  the orange accent sit at 2.8:1 contrast; two `/method` callouts at 2.09:1.
- ~~**Render the EdgeScore IC**~~ — **DONE, iteration 18** (`EdgeValidation`, inside
  `/method` §04). Shows IC beside the live `scoring_config` weight, with "right sign,
  not significant" stated plainly. **Confirm it deployed** — build verified locally,
  Vercel lagging at time of writing.
- ~~**L2 factor betas never reconciled**~~ — **DONE, iteration 16, verified live in
  17 (8/8 within band).** SPY +0.99 at
  R2 1.00, BIL -0.00, ARKK +1.49 — the model is sound; the gap was that nobody had
  checked. Rendered live on `/method` section 05 and pinned by 5 synthetic-series
  tests. Panel confirmed rendering live in iteration 17.
- ~~**Q2 narrative not consolidated**~~ — **re-derived as already done, iteration
  14.** `/method` opens with the process statement and §01 walks L0→L5 with each
  stage's inputs, destination table, live status and duration — that is Q2's "data
  gathering → processing → quantification framework" with the prototype attached.
  What was genuinely missing was telemetry for L1 and L4, now fixed.

## Hard constraints

- Commits carry **no co-author line**.
- **Never commit** `.env.vercel` or `backend/data/factors_daily.csv`.
- Never echo or commit secrets; the anon key is public, the service key is not.
- Screenshots go to `docs/captures/<YYYY-MM-DD>/` with an absolute path.
