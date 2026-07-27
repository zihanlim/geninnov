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

## The four bars from the practitioner transcript (added 2026-07-27)

Source: [`transcript-quantamental-ai-podcast-2026-07-26.md`](transcript-quantamental-ai-podcast-2026-07-26.md)
— a quantamental PM's account of where the alpha is and is not. Four claims are testable
against this repo. **These are bars, not a backlog** — each names the check that settles
it, and each is legitimately answerable with "we looked and stated the absence", which is
this repo's standing move (ADR-0066, ADR-0094, ADR-0097).

1. **Sizing takes four inputs, not two: vol, conviction, crowding, upside.**
   `size_positions` sizes by `conviction = |EdgeScore| / vol` (`q1_agent.py:2239`) — the
   first two. `positioning_crowding.py` computes the third and says in its own docstring
   that it never feeds sizing. The fourth does not exist: `price_target`,
   `expected_return`, `upside_pct` appear nowhere in `backend/`, `frontend/lib/`, or
   `scripts/`.
   **Test:** at equal conviction, can a reader see why the crowded position is smaller
   than the uncrowded one? Today: no, because it is not.
   **Constraint before wiring it:** crowding is observable on ~20% of book gross. A
   sizing input that is unmeasurable on four fifths of the book must degrade to neutral
   **with its coverage stated at the point of use** — never silently, or the caps become
   a claim the data cannot support. Raising coverage is the honest prerequisite.

   **SETTLED 2026-07-27 — three of four, and the fourth is stated rather than filled.**
   *Vol and conviction* now enter through `expected_returns.build_mu`
   (`μ = IC × σ × z`, [ADR-0108](adrs/0108-expected-returns-are-constructed-not-assumed.md)),
   which the optimizer trades off against variance ([ADR-0107](adrs/0107-the-optimizer-sizes-what-l5-chose.md)).
   *Crowding* enters as a **per-name cap**, not a μ haircut
   ([ADR-0110](adrs/0110-crowding-caps-what-it-can-see.md)) — the exit being narrow
   supports holding *less*, not a claim about returns, and a cap is visible in
   `binding_constraints` where a μ adjustment would leave a smaller weight
   unattributable. The test above is now `test_at_equal_conviction_the_crowded_position_is_smaller_*`,
   asserted on **both** sizing paths; the constraint is
   `test_crowding_is_neutral_where_unobservable`, which requires an unmapped name's
   weight to be **bit-identical** with the input wired and unwired.
   *Upside* is **addressed in units, absent in substance** and stays on this register
   ([ADR-0111](adrs/0111-mu-is-the-return-input-and-what-it-is-not.md)): `optimizer_result.mu`
   is denominated in expected return, but its cross-sectional content is
   `sign × |EdgeScore| × σ` — a rank in return units, carrying no view of how far a name
   can travel. The claim above that `expected_return` appears nowhere is therefore
   **stale**; it now appears, as this construction and not as a target. Closing it needs
   a fundamentals or estimates feed with a per-name valuation anchor, which this repo
   does not have.
   **Measured on the live book: nothing was tightened.** Coverage 22.2%, and both
   observable positions (SHY 69.9, SVXY 33.2) sit mid-range against the 80/20 threshold,
   so the recorded reason is *"2 observable positions were checked and none sits at a
   speculator extreme"*. The machinery is wired and correct and today changes no weight,
   because the data says nothing. That is the result, not a reason to loosen the
   multiplier. **The bias remains and is watched, not solved**: penalising only what is
   observable advantages what is not, so `coverage_share` is persisted every run.

2. **The alpha is in data neither the quant nor the fundamental process can use.**
   The examples are scraped state highway-patrol data and hand-mapped fire perimeters:
   too few tickers to backtest, too much scraping to be desk work. Andromeda's attention
   signal rests on **one** public provider (Brave; Reddit fetched but unconfigured —
   ADR-0094). That is the *most crowded input available*, and the transcript's poker
   argument says a shared input puts everyone on the same side of the boat.
   **Test:** name one input in this pipeline that a competing desk could not buy or
   query this afternoon. Today there is none. Until there is, say so where HypeScore is
   published rather than implying breadth.

3. **A horizontal model has no domain knowledge, and the output is confidently wrong
   without it** — "nobody cares about total revenue for a bank."
   The `reason_picks` prompt carries macro, regime, theme table, factor table, book
   metrics, scenarios, risk, candidates and news. It carries **nothing about what
   matters for a specific name or sector.**
   **Test:** does the book's thesis for a position turn on something specific to that
   asset, or only on theme-level attention plus macro? Anything derivable without
   knowing which asset it is, is per the transcript's own definition the quant half.

4. **A bet the market grades must change something.** "Make the bet, see how it reacts,
   figure out what you got wrong, learn."
   `pick_outcomes` resolves published picks on a pipeline-assigned 21-day spec
   (ADR-0090) — the grading half exists, which is more than most. But nothing reads it
   back: it is written by `resolve_outcomes.py`, displayed on `/method`, and consumed by
   no pipeline step.
   **Test:** does any published number differ because of a resolved outcome? Today: no.
   **The disclosure surface exists** — `TrackRecordPanel` renders on `/book` at the point
   of the claim, and `/method` keeps the full table. **The blocker was NOT only the
   calendar.** Audited 2026-07-27: the live book had published 9 claims and recorded
   **0** `pick_outcomes` rows — 28% of every claim the project had ever made, permanently
   ungradeable, and invisible because the panel counts what IS recorded, so a missing
   claim reads as a smaller denominator rather than a gap. ADR-0090's "record the
   commitment" was enforced only by `resolve_outcomes.py` running as a sibling step in
   `daily-refresh.yml`. Fixed and repaired ([ADR-0117](adrs/0117-a-falsifiability-guarantee-that-lives-in-a-yaml-step-is-not-a-guarantee.md));
   all 5 books now reconcile 32/32. **What remains is genuinely the calendar and only
   that:** earliest book 2026-07-22 + 21 trading days, so nothing resolves before
   2026-08-20, and there is no older history to backfill.
   **The honest version is not RL** — the sample is far too small to tune on, and fitting
   thresholds to a dozen resolved picks would be overfitting dressed as learning. It is
   **disclosure**: the track record visible next to the claim it grades.

**What already clears the bar — do not rebuild these:** the interface is a publication
with `/ask` as a control rather than a chat-first product (the transcript's explicit
complaint about AI tooling); the citation guardrail is precisely the audit layer it says
someone must retain the skill to perform; and abstention-with-a-reason is the "state the
absence" discipline. This repo's recurring failure mode is working machinery that is
never surfaced — check before building.

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

Live at https://andromeda-analytics.vercel.app · 626 backend tests green; the frontend rewrite is deployed to prod and **passed a browser-driven UI/UX pass at 1440 + 375** (iteration 94: zero page horizontal scroll, zero console errors, zero page errors on `/`, `/book`, `/risk`, `/method`; Q1 book renders correctly). Its beta-panel gating — which retired the Euler-render need — is live.

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
  `/method` renders every formula from live `scoring_config`. The `/book` thesis badge
  now certifies the **figures, not the prose** — a bar-3 audit found the per-position
  reasoning carries genuine domain claims (a name over-owned, a sector defensive) that the
  citation guardrail never reads (ADR-0049), so a tertiary line beside the VERIFIED badge
  says the reasoning that connects the figures is the model's own.

## Iteration history → `loop-log.md`

The per-iteration log lives in **[`loop-log.md`](loop-log.md)** (116 entries, newest
first). It was split out of this file on 2026-07-27, where it had grown to 5,035 of
5,452 lines and was re-read in full on every firing.

Append each firing's entry **there**, under its header — not here. What belongs in this
file is only what should still bind the next firing: the sections above, plus the two
below.

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
