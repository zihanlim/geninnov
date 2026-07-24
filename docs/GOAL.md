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

## Standing mandate for each loop firing

Re-derive — do not just take the backlog below on faith:

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

## Where things stand (update me)

Live at https://andromeda-analytics.vercel.app · 380 backend tests green.

- **Pipeline** L0–L5 runs daily on GitHub Actions (`daily-refresh.yml`, verified
  firing on schedule); monthly `theme-discovery.yml`; all 6 secrets configured.
- **Q1 book** — VERIFIED thesis w/ citations, conviction-sized, cap-aware. After
  the 2026-07-24 fixes the engine produced **shorts for the first time**
  (2 long + 3 short candidates, 5 positions, $100M). Still short of five-and-five.
- **Direction** EdgeScore = trend/regime/carry/value/sentiment, IC-weighted, with
  abstention + conviction sizing (ADR-0031/32/33).
- **Q2 hype** HypeScore (volume/sentiment/|ρ|/momentum) + theme discovery
  (LDA ∩ embeddings, 6 two-method agreements) surfaced on `/`.
- **Honesty surfaces** HypeScore IC panel says NOT YET VALIDATED; risk cards state
  their sample size; `/method` renders every formula from live `scoring_config`.

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

- **Q1 breadth** — the candidate pool is ~8 anchor themes → ~20 ETFs, which is why
  so few names clear the bar. Widening the universe is the legitimate route to a
  real five-and-five. *Highest value.* (The Q1-breadth diagnosis agent died on a
  connection error before reporting — re-run it.)
- **UI audit backlog** — a full Playwright audit ran 2026-07-24 and found no
  horizontal scroll and no console errors at either viewport, but a long list of
  real defects beyond the ones fixed: `verified=true` with 0 citations still
  presents as VERIFIED on `/book`; Sharpe's delta chip shows ▼-red for an
  improvement; the limit board stamps OK on statistics whose own tiles say the
  sample is too small; three routes are unreachable at 375px; tertiary text and
  the orange accent sit at 2.8:1 contrast; two `/method` callouts at 2.09:1.
- **L2 factor betas** — 88 rows, never reconciled against a known benchmark.
- **Q2 narrative** — data gathering → processing → quantification exists in code
  and on `/method`, but is not consolidated as one readable answer.

## Hard constraints

- Commits carry **no co-author line**.
- **Never commit** `.env.vercel` or `backend/data/factors_daily.csv`.
- Never echo or commit secrets; the anon key is public, the service key is not.
- Screenshots go to `docs/captures/<YYYY-MM-DD>/` with an absolute path.
