# Andromeda

Systematic market theme identification and trade generation platform.

## 🚨 Doc Sync Rule — MANDATORY (read first, every session)

This project has **four living documents** that must stay in lockstep with the code. Before you finish any non-trivial change, walk this checklist. Skipping it is a bug.

| When you change... | Also update... |
|---|---|
| Any service, API, table, layer, LLM call, cron trigger, edge in the system | **`ARCHITECTURE.md`** — edit the [System Architecture Diagram](./ARCHITECTURE.md#system-architecture-diagram) mermaid block in the same change. Add/remove/move the node, edge, subgraph, or table. The diagram is the canonical wiring view; prose sections in this file or `PROGRESS.md` are not a substitute. |
| Any layer, scoring formula, data model, or new ADR-worthy decision | **`ARCHITECTURE.md`** — also update the `## Layers` table, `## Supabase Tables` table, and the `## Feature Checklist` at the bottom of that file. |
| Any non-trivial change worth remembering tomorrow | **`PROGRESS.md`** — append a dated row to the `## Completed` table and, if a build task flips state, the `## Build tasks` table. |
| Any architecturally significant decision (new service, technology swap, schema change, security/guardrail change, new layer) | **A new ADR** in `docs/adrs/` using the im-Jarvis format (Context / Decision / Consequences), with the next available `NNNN-` prefix, and add it to the index in `docs/adrs/README.md`. |
| The system architecture itself (you add a layer, rename a service, change the LLM provider, add a new external API) | **A new ADR** is non-negotiable. Architecture shifts without ADRs rot. |

**Quick rule of thumb:** if a future agent reading the repo in 6 months would look at the diagram and learn something wrong, the diagram is wrong. Fix it before you commit.

**The four doc surfaces, in priority order:**
1. `ARCHITECTURE.md` — system architecture (mermaid diagram + tables + checklist)
2. `PROGRESS.md` — what got built, when, and what's still pending
3. `docs/adrs/NNNN-*.md` — *why* a decision was made (immutable once written; new decisions get new ADRs)
4. `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` — the full design spec; update §s whose content you changed

**When in doubt, update the diagram first.** Everything else can be derived from it; the diagram cannot be derived from anything else.

## 🔀 Two sessions share this worktree — commit as you finish, not at the end

Two Claude sessions routinely run against **one working tree, one index, one
stash, one branch**. That is a deliberate choice (it keeps both continuously
integrated), and it has one failure mode you must design around:

**Uncommitted work is not stored anywhere. It is a shared mutable buffer.**

Observed on 2026-07-28: one session ran `git stash` to test something clean. It
swept *both* sessions' uncommitted work — several hours of edits across 11 shared
files reverted to HEAD with **no error, no conflict, and nothing in either
session's output**. `git status` simply showed a clean tree. Earlier the same day
a `git commit` with no pathspec consumed the other session's staged files, and
both sessions allocated the same ADR number twice.

**The rules, in order of how much they save you:**

1. **Commit each edit as you finish it**, not when the feature is done. The window
   between editing a shared file and committing it is your entire exposure.
2. **Stage and commit in ONE Bash call**, with explicit paths:
   `git add -- $NEW && git commit --only -F - -- $NEW $MOD`.
   `--only` builds the commit from HEAD plus exactly those paths and leaves the
   other session's staged files alone. Note `git commit -- <paths>` **errors on
   untracked files** (`pathspec did not match any file(s) known to git`) — new
   files must be `git add`ed first, in the same call.
3. **Never `git stash`.** It is a silent revert of everything uncommitted,
   including work you did not write. If you must, `git stash push -- <your paths>`
   only. To recover from one: `git stash list`, then **`git stash apply`** (never
   `pop` — apply keeps the stash as a backup if the result is wrong).
4. **Before claiming an ADR number**, check `ls docs/adrs/` *and*
   `docs/adrs/README.md` at the moment of writing. The indexed one wins a
   collision; expect to renumber.
5. **After committing, verify content and not just the log** —
   `git show HEAD:<file> | grep <your text>`. A whole-file write by the other
   session overwrites committed content as silently as uncommitted content.
6. **When resolving a conflict in a shared append-only doc** (`PROGRESS.md`,
   `ARCHITECTURE.md`, `docs/adrs/README.md`), keep **every** entry from both
   sides. "Take mine" / "take theirs" drops the other session's row silently,
   which is the same class of loss the rest of this section is about.

## What this is

Andromeda ingests news and social media daily, scores themes by "hype" (attention × sentiment × market correlation × momentum), generates ranked long/short trade ideas, and sizes them into a $100M portfolio with risk metrics.

On top of the theme engine, an L5 AI reasoning agent synthesizes the L0–L4 deterministic inputs (macro regime, factor exposures, theme scores, risk) into a **$100M long-short book with a per-trade thesis** — the Q1 deliverable. Every numeric claim in the thesis is citation-verified against the L0–L4 inputs before it reaches the UI. See [§14 of the design spec](docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md) for the full Q1 reasoning pipeline, and [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the citation guardrail design.

The L5 agent supports a **`lens` parameter** that filters the candidate pool by asset class (e.g. `multi_asset`, `credit`, `rates`, `equity`, `fx`, `commodity`) and injects a lens-specific framing instruction into the LLM prompt. The frontend `/portfolio` and `/trades` pages expose this as a `<LensSelector>` segmented control. The credit lens is the natural fit for Andromeda Capital's mandate. See [ADR-0015](docs/adrs/0015-lens-mode-asset-class.md) for the design rationale.

## Architecture

- **Frontend**: Next.js 14 (TypeScript, Tailwind CSS) → Vercel (live at https://andromeda-analytics.vercel.app)
- **Database**: Supabase (PostgreSQL) — frontend reads directly via `@supabase/supabase-js`
- **Scoring pipeline**: Python `daily_refresh.py` script runs once/day at market close → writes to Supabase
- **Theme discovery**: `theme_discovery.py` runs at bootstrap and monthly
- **Scheduling**: **GitHub Actions**, not cron-job.org. The pipeline is a ~10-minute Python job (news fetch → scoring → LLM book), which no HTTP-ping cron or Vercel serverless function can host inside its timeout; Actions runs Python directly, holds the secrets, and keeps run logs.

**No FastAPI, no Redis, no VPS for the backend** — see ADRs for why.

### Scheduled jobs

| Workflow | Schedule | Runs |
|---|---|---|
| `.github/workflows/daily-refresh.yml` | `30 21 * * 1-5` (21:30 UTC weekdays, after the US close) | `daily_refresh.py` (L0–L5), then refreshes the HypeScore IC validation, then `resolve_outcomes.py` (forward track record — ADR-0090), then the data-integrity guard |
| `.github/workflows/theme-discovery.yml` | `0 6 1 * *` (1st of the month) | `theme_discovery.py` — LDA ∩ embedding candidates → `discovered_themes` (shadow) |
| `.github/workflows/ci.yml` | on push / PR | backend + frontend tests |

Both scheduled jobs need these **GitHub repo secrets** (Settings → Secrets and variables → Actions). Without `SUPABASE_*` the run fails fast at the guard step; the rest degrade with a warning rather than fabricating data:

| Secret | Required? | Without it |
|---|---|---|
| `SUPABASE_URL` | **yes** | run fails at the guard |
| `SUPABASE_SERVICE_KEY` | **yes** | run fails at the guard |
| `BRAVE_SEARCH_API_KEY` | strongly recommended | news is empty → mention counts 0 |
| `MINIMAX_API_KEY` | recommended | L5 falls back to the deterministic template book |
| `FRED_API_KEY` | recommended | macro series skipped |
| `GEMINI_API_KEY` | optional | third-choice L5 fallback |

Note `workflow_dispatch` is enabled on both, so either can be run on demand from the Actions tab. GitHub also **auto-disables scheduled workflows after 60 days of repo inactivity** — if the book goes stale, check that first.

## Project docs

All project documentation lives under `docs/`:

| Path | Purpose |
|------|---------|
| `docs/superpowers/specs/2026-07-21-andromeda-market-theme-platform-design.md` | Full design spec — architecture, scoring formulas, data model, frontend pages |
| `docs/superpowers/plans/2026-07-21-andromeda-implementation-plan.md` | Implementation plan — task-by-task build guide |
| `docs/adrs/` | Architecture Decision Records in im-Jarvis format |
| `docs/theme-hype-methodology.md` | **The answer to `task.md` Q2** — the daily theme/hype process end to end: data gathering, processing, the quantification framework, and how one output serves both idea generation and risk monitoring. Written against the live system with real figures, and explicit about what is not yet measurable. Start here for "how does the theme engine work?" |
| `docs/design-goals.md` | **Read before evaluating any UI change or outside mockup.** Eight standing design goals, each with a test, plus the non-goals and a mockup-triage checklist. ADRs record decisions taken; this records the bar a proposal must clear |
| `docs/captures/YYYY-MM-DD/` | Playwright screenshots — **one folder per capture date**. See [Screenshot convention](#screenshot-convention). |
| `docs/baseline/screenshots/` | Frozen pre-refactor visual baselines. Read-only — never overwrite these with fresh captures |
| `.playwright-mcp/` | Playwright MCP scratch output (page `.yml` snapshots, console `.log` files). Gitignored, safe to delete |

## Key source files

| Path | Purpose |
|------|---------|
| `scripts/daily_refresh.py` | Daily scoring pipeline (L1–L4 + L5 Q1 agent) |
| `scripts/theme_discovery.py` | Bootstrap + monthly theme discovery |
| `backend/services/narrative_tracker.py` | **L1b: which narratives are trending, without being told what to look for** ([ADR-0128](docs/adrs/0128-a-theme-we-did-not-name-in-advance.md)). Document frequency over 1–3-grams of an UN-THEMED corpus → share of voice → robust velocity vs each phrase's own history → `new`/`emerging`/`established`/`fading`. Dependency-free and deterministic, so unlike `theme_discovery.py` it runs **daily and in CI**. `covered_by` names the anchor theme already asking for a phrase — the field that separates "Fed Policy is working" from "nothing is watching this". **Shadow: sizes nothing** |
| `backend/services/method_agreement.py` | **Two methods that fail differently, agreeing** ([ADR-0133](docs/adrs/0133-two-methods-that-fail-differently-agreeing.md)) — where the daily frequency tracker and the monthly LDA∩embedding job name the same narrative, `methods` records both. Threshold is **≥2 shared tokens, measured not picked**: at ≥1 the live top matches were `oil`/`dollar`/`fxstreet`, one word in common by chance. `days_stale` travels with every match, because discovery is monthly and this is not a simultaneous second opinion |
| `backend/services/thesis_positions.py` | **A thesis may not assert a position the book does not hold** ([ADR-0135](docs/adrs/0135-a-thesis-must-not-assert-a-position-the-book-does-not-hold.md), [ADR-0136](docs/adrs/0136-repair-the-thesis-rather-than-footnote-it.md)). The citation guardrail verifies cited NUMBERS and has no notion of a POSITION, so a live thesis argued *"the long VRT / short MSFT structure"* against a book with no MSFT. Distinguishes a **claim** from a **comparison** (a `{GDX, GLD, IAU}` cluster listing is ADR-0116 being explained, not violated), excises the offending clause deterministically rather than re-prompting, and **quotes the removed text** in the caveat |
| `backend/services/narrative_price_link.py` | **Does attention to this narrative move prices?** ([ADR-0143](docs/adrs/0143-the-price-link-gate-and-what-it-refuses-to-say.md)) — the brief defines a theme as *a narrative driving cross-asset moves*, so the decisive test is economic, not linguistic. Reuses ADR-0127's per-class correlation over a phrase's mention series. **Two floors: 5 sessions to COMPUTE, 20 to BELIEVE** — the first live run returned `linked` for all 14 phrases at n=5, so `insufficient_history` is the verdict itself below the floor rather than an opt-in flag |
| `backend/data/gdelt_client.py` | **The second news provider, and the only one with history** ([ADR-0144](docs/adrs/0144-a-second-provider-that-is-an-archive.md)). Free, keyless. Brave is a recency *ranking* (48% of a 45-day window in the last 7 days); GDELT is an *archive* (18%, 40 of 45 days populated) — which is why a Brave backfill would **clear ADR-0143's session floor with fabricated density**. Four constraints encoded because each was learned by tripping it: 1 req/5s paced **in the client**, OR-terms need `()`, `sourcelang:english` mandatory, UTF-8 decoded explicitly. A wall-clock budget reports how many queries it skipped rather than looking complete |
| `backend/data/brave_client.py` | Per-theme news (`THEME_KEYWORDS` — the eight hard-coded lists) **and** `fetch_market_news` over `MARKET_SEED_QUERIES`, which asks about the market rather than about a theme. That second corpus is what makes discovery non-circular. It has **no mock fallback**, uniquely: a frequency tracker reading template headlines would report the template's own vocabulary as an emerging narrative |
| `frontend/components/NarrativeTrends.tsx` | The narrative board on `/` — a **share × velocity detection plane** ([ADR-0146](docs/adrs/0146-a-detector-and-a-comparison-are-different-charts.md)), not a line chart: filled marks are watched by nothing (the payload), hollow marks are context, and a phrase with no measurable velocity sits in a rug below the plane rather than at y = 0. **Every region names its loudest marks** ([ADR-0162](docs/adrs/0162-a-mark-you-can-see-but-cannot-name.md)) — an encoding may not also mean "anonymous", which is how `ai` came to be the maximum of both axes and get reported as absent. Also exports `TrendPlot`, the one geometry implementation, whose only renderer is now `ThemeTrends` on the **validated** `--series-1..5` palette; two of those slots sit below 3:1 contrast, legal only with direct labels and the figures table — `narrative-trends.test.tsx` asserts they stay |
| `scripts/backfill_regime.py` | Rebuilds L3 regime history from `macro_daily_history` (pure function, no API/LLM cost). Dry-run by default; `--apply` writes; never overwrites the published rows without `--overwrite`. **L1 HypeScore and the L5 book are deliberately NOT backfillable** — see the module docstring |
| `backend/data/macro_fetcher.py` | L0: FRED + yfinance macro snapshot |
| `backend/data/factor_fetcher.py` | L2: Ken French FF5 + UMD factor exposures |
| `backend/services/regime_classifier.py` | L3: Rule-based cycle × sentiment classifier |
| `backend/services/book_metrics.py` | L5: value-weighted FF5+UMD book tilts, sector/geo caps, correlation matrix |
| `backend/services/sanctions_exposure.py` | Which held names are sanctions-exposed **and on which side** — the 2026-07-25 book is net SHORT 30.2% of gross in Chinese ADRs, so escalation is a tailwind. No credential needed ([ADR-0096](docs/adrs/0096-the-book-is-net-short-sanctions-risk-and-never-said-so.md)) |
| `backend/services/chokepoint_signal.py` | Maps a measured maritime-disruption reading to a multiplier on S6's calibration; every refusal returns the neutral 1.0 **with a reason**. Needs `WORLDMONITOR_API_KEY` (Pro tier); absent, S6 runs its documented ADR-0088 calibration ([ADR-0095](docs/adrs/0095-s6-scales-by-measured-disruption-when-there-is-a-reading.md)) |
| `backend/services/scenario_analysis.py` | L5: 6-scenario stress test — 4 risk-off (VIX/rates/USD/credit) + 1 risk-on melt-up, so a net-short book is stressed on both tails (ADR-0074), + 1 supply shock that transmits through `SECTOR_MAP` instead of market beta and is inflationary, so a position the factor model cannot see is still stressed and duration stops hedging ([ADR-0088](docs/adrs/0088-a-stress-scenario-that-does-not-transmit-through-market-beta.md)) |
| `backend/data/cot_fetcher.py` | L5: CFTC Commitments of Traders (free, keyless). Maps book assets to futures contracts and percentiles speculator net positioning over a trailing 3y window. **Only maps where the ETF tracks what the contract settles on** — GLD yes, GDX no |
| `backend/services/positioning_crowding.py` | L5: is the book leaning the way specs already are? **Coverage first** (2 of 10 live positions are observable); SVXY inverse-flipped, since long SVXY is short VIX ([ADR-0097](docs/adrs/0097-external-positioning-can-see-a-fifth-of-the-book.md)). Since [ADR-0110](docs/adrs/0110-crowding-caps-what-it-can-see.md) `crowding_caps()` also **sizes**: a crowded name's single-name limit is halved, and every other name is **absent from the map** so it is sized bit-identically. A cap, not a μ haircut — and it may only ever tighten |
| `backend/services/sanctions_exposure.py` | L5: which held names carry sanctions risk **and on which side** ([ADR-0096](docs/adrs/0096-the-book-is-net-short-sanctions-risk-and-never-said-so.md)) |
| `backend/services/q1_agent.py` | L5: 8-node Q1 reasoning agent (`run_q1_agent`) |
| `backend/services/weights_backtest.py` | L4: what the published weights WOULD have done over 252 days of constituent returns — the path statistics (drawdown, Sortino, capture) ex-ante risk cannot produce. **Not a track record**: its own column, caveats stored in the payload (not page copy, because MCP reads it), `is_track_record` literally false, and an unpriced holding excluded rather than zeroed ([ADR-0112](docs/adrs/0112-a-backtest-of-these-weights-is-not-a-track-record.md)) |
| `backend/services/optimizer.py` | L5: the sizer. Constrained mean-variance / min-CVaR / MAD + efficient frontier over cvxpy. **Signed weights, `gross ≤ 1`, caps as solver constraints binding on the GROUP total, direction pinned.** Read across from im-Jarvis and reimplemented — the source clips every weight at zero regardless of its own `long_only` flag and renormalises to sum 1, which on a long-short book deletes every short ([ADR-0107](docs/adrs/0107-the-optimizer-sizes-what-l5-chose.md)) |
| `backend/services/expected_returns.py` | L5: **not a port.** Grinold–Kahn `μ = IC × σ × z`. IC read from `backtest_results`, renormalised over the components actually testable, shrunk 50%, **never defaulted** — no measured IC means no μ and the run sizes by conviction ([ADR-0108](docs/adrs/0108-expected-returns-are-constructed-not-assumed.md)). `equalise_within_complexes` then gives one correlation complex **one** μ — without it the near-singular block makes the linear term decide and a 5% μ gap corners the book on the highest-EdgeScore member ([ADR-0116](docs/adrs/0116-the-optimizer-chooses-the-instrument-the-thesis-argues-the-idea.md)) |
| `backend/services/monte_carlo.py` | L4: Student-t Monte Carlo VaR, **seeded** so ADR-0013's determinism holds. Ex-ante, from the constituents' covariance — NOT `portfolio_risk.var_95`, which is realised and parametric |
| `backend/services/var_forecast.py` | L4: √t VaR fan over 1/5/10/21/63d. The **21-day** point is the horizon `pick_outcomes` actually scores against (ADR-0090); nothing carried it before. Assumes IID returns, and the assumption travels in the payload |
| `backend/services/volatility_models.py` | L4: EWMA (λ=0.94) + variance-targeted GARCH(1,1). Wired into `compute_and_persist_risk` as **reporting-only** `conditional_vol` — deliberately NOT the conviction denominator, which stays the sample vol with the ADR-0047 floor |
| `backend/services/benchmark_compare.py` | L4: tracking error, information ratio, beta, **up/down capture** against `benchmark_returns`. Down-capture is the field that tests this book's own claim to be short the market |
| `backend/services/cost_model.py` | L5: linear transaction costs on the optimizer's signed `weight_delta`. Prices the turnover ADR-0045/0050 already measures. No market-impact term — it understates a large trade in a thin name |
| `backend/services/book_revisions.py` | Diffs a published book against the row about to replace it, so an upsert on `run_date` cannot change a published figure silently. `reason` is NOT NULL by constraint ([ADR-0093](docs/adrs/0093-a-published-book-that-changes-must-say-so.md)) |
| `backend/services/pick_outcomes.py` | The forward track record — resolves published picks against a **pipeline-assigned** 21-trading-day spec. Pure functions; `scripts/resolve_outcomes.py` runs it. Rows are `pending` at publication so the denominator precedes the outcome. No Brier score: `conviction` is a sizing input, not a probability ([ADR-0090](docs/adrs/0090-a-published-pick-must-be-falsifiable.md)) |
| `frontend/app/book/page.tsx` | L6: The $100M book — per-trade thesis, pool depth, turnover, replication. (`/research`, `/portfolio`, `/trades` are retired server redirects to it.) |
| `frontend/lib/themeProvenance.ts` | Provenance of the attention signal, incl. `sourceIndependence()` — HypeScore currently rests on **one provider** (Brave); Reddit is fetched but unconfigured ([ADR-0094](docs/adrs/0094-no-corroboration-gate-over-a-single-source.md)) |
| `frontend/lib/supabase.ts` | Supabase client for frontend reads |
| `frontend/app/ask/page.tsx` | L8: `/ask` — interrogate the published book. A TopBar control, **not** a fifth nav destination. The route is the **scrolling-document** mount (Ctrl+F, deep links, long transcripts) and is published in `llms.txt` |
| `frontend/components/chat/AskConsole.tsx` | L8: the conversation itself — suggestions, transcript, composer. Rendered by **both** `/ask` and the TopBar popup; never copied, because the no-stream / no-persist / no-model-knowledge refusals are behavioural |
| `frontend/components/chat/AskWindow.tsx` + `AskDock.tsx` | L8: `Ask` as a **persistent floating window** (bottom-right) over `AskConsole`, opened from a TopBar control. `keepMounted` — closing HIDES it, so the transcript survives; it is never persisted anywhere, and each turn costs two LLM calls on the nightly book's quota (three on a guardrail retry), so discarding one on a stray click is expensive. Links out to `/ask` rather than replacing it |
| `frontend/components/FloatingWindow.tsx` | The shared window: drag (pointer capture, clamped), collapse, close, position + collapse state in `localStorage`, portalled to `document.body`, and **click-to-front** z-ordering. Used by `AskWindow` and `LiveNewsWindow`. `keepMounted` is the one real difference between them — see the file header |
| `frontend/components/RibbonControl.tsx` | The shared *look* of a TopBar tool control (`Ask`, `Live news`) — label gated to `wide`, `aria-label` always. Behaviour is deliberately NOT here |
| `frontend/lib/brand.ts` | The mark, traced from the supplied artwork to ONE `<path>` (`fill-rule="evenodd"` — the gaps under the arms are separate loops). `components/BrandMark.tsx` imports it; `app/icon.svg` and `app/apple-icon.png` are **build outputs** that cannot (a favicon has no module graph, Safari ignores an SVG touch icon), so `tests/unit/brand-mark.test.ts` asserts they match byte-for-byte. Regenerate all three together. `--logo-plate` is the project's only navy and is fenced to the mark ([ADR-0113](docs/adrs/0113-the-mark-is-the-artwork-and-the-plate-is-fenced.md)) |
| `frontend/components/live/LiveNewsWindow.tsx` | `Live news` as a floating window (top-right, so it does not start on top of `Ask`). `keepMounted` is **off**: closing or collapsing UNMOUNTS the player, so a collapsed tab makes **no** request to YouTube — ADR-0104's privacy property, kept |
| `frontend/app/api/chat/route.ts` | L8: the repo's only route handler. Rate limit first, then spend |
| `frontend/lib/chat/agent.ts` | L8: plan → execute → answer → verify. **Two** LLM calls per question — **three** when the guardrail rejects the first answer, since the answer step is a `for (attempt < 2)` loop that breaks early only on success. The rate limit is checked once per REQUEST, so a cap of N questions bounds 2N–3N model calls, not 2N |
| `frontend/app/api/mcp/route.ts` | L8: the book as an **MCP server** — Streamable HTTP, `2025-06-18`, stateless, POST-only, over the SAME `TOOLS` registry `/ask` uses. No LLM and no rate limit: the caller brings their own model ([ADR-0092](docs/adrs/0092-the-book-as-an-mcp-server-over-the-tools-that-already-exist.md)) |
| `frontend/app/llms.txt/route.ts` | Machine-readable site index; the tool list is generated from `TOOLS` so it cannot drift |
| `frontend/lib/chat/tools.ts` | L8: the read-only tools. They import the SAME modules the pages render — never a copy |
| `frontend/lib/risk/varMethods.ts` + `components/risk/VarMethods.tsx` | The four VaRs side by side. They differ by **method, horizon AND basis** — most of the spread is √t, not disagreement — so every row carries all three plus its method id, and `reconcileExAnte` states the one comparison that is genuinely apples-to-apples ([ADR-0082](docs/adrs/0082-euler-risk-decomposition-on-the-final-book.md)) |
| `frontend/lib/risk/sampleAdequacy.ts` | The ONE place a statistic's minimum sample lives. A field absent from `MIN_SESSIONS_BY_FIELD` is **ungated everywhere**, including `/ask` and MCP — `risk-thresholds.test.ts` parses `risk_engine.py` AND `benchmark_compare.py` and fails if they disagree ([ADR-0100](docs/adrs/0100-a-guard-that-lives-in-a-component-guards-one-consumer.md)) |
| `frontend/lib/chat/guardrail.ts` | L8: adjudicates every numeral as cited / quoted / unverified ([ADR-0087](docs/adrs/0087-a-chat-that-cannot-do-arithmetic.md)) |
| `supabase/migrations/039_chat_usage.sql` | L8 spend guard — sealed table + `chat_rate_limit()` RPC, service_role only |
| `supabase/migrations/001_initial_schema.sql` | Full database schema (L1–L4 tables) |
| `supabase/migrations/005_macro_indicators.sql` | L0 macro_indicators + macro_daily_history |
| `supabase/migrations/006_factor_exposures.sql` | L2 factor_exposures table |
| `supabase/migrations/009_asset_class_lens.sql` | L5 lens mode — `asset_class` column on `theme_assets` |
| `supabase/migrations/050_ai_capex_theme.sql` | **AI Capex as a tradeable theme** ([ADR-0129](docs/adrs/0129-ai-capex-is-a-theme-and-the-tracker-found-it-sideways.md)) — the theme universe is **nine**, not eight. 13 instruments across 4 asset classes, mapped as a chain (compute → manufacture → spenders → power → plant → copper → funding → duration → gas). Found by the L1b tracker, which measured AI in **2 of 455 documents** and both via the *Corporate Credit* query. New sectors Semiconductors / Utilities / Electrical Equipment exist so the 30% cap binds on the chain's links separately; **Taiwan is its own geo** |
| `frontend/components/LensSelector.tsx` | Lens toggle (multi-asset / credit / rates / equity / fx / commodity) |

## Running locally

```bash
# Backend
cd backend && pip install -r requirements.txt
python -m scripts.daily_refresh   # requires SUPABASE_URL + SUPABASE_SERVICE_KEY

# Frontend
cd frontend && npm install
npm run dev
```

## Environment variables

```bash
# Supabase (required for both backend and frontend)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key   # backend writes
NEXT_PUBLIC_SUPABASE_URL=...                  # frontend reads (anon key)
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Brave Search MCP (optional — falls back to mock data)
BRAVE_SEARCH_API_KEY=...

# Reddit PRAW (optional — falls back to mock data)
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT=Andromeda/1.0

# /ask (L8) — SERVER-ONLY, set on the FRONTEND deployment. Never NEXT_PUBLIC_.
MINIMAX_API_KEY=...            # required or /ask 503s. SHARED with the nightly book's quota
SUPABASE_SERVICE_KEY=...       # required in production: the spend-guard RPC is service_role only
CHAT_IP_SALT=...               # recommended — an unsalted hash of an IPv4 address is brute-forceable
CHAT_PER_IP_DAILY_CAP=15       # optional
CHAT_GLOBAL_DAILY_CAP=200      # optional — this is what protects tomorrow's book
```

**`/ask` shares the MiniMax quota with L5.** That is the reason it is capped at
all: an exhausted quota does not produce a broken chat, it produces tomorrow's
book as a deterministic template with no thesis. If the caps are raised, raise
them against that, not against the bill.

## MCP tools

Use these to interact with external services directly:

- **Supabase MCP** (`plugin:supabase:supabase`): For all Supabase work — running SQL queries, checking table data, applying migrations, verifying data was seeded correctly. Authenticate once via browser OAuth flow.
- **Vercel MCP** (`plugin:vercel`): For Vercel work — listing projects, setting env vars, checking deployments, fetching build logs, triggering redeploys. Requires `vercel login` in the terminal first.
- **Playwright MCP** (`plugin:playwright`): For frontend verification — navigate to a URL, take a screenshot, check the page snapshot, inspect console errors. Use this whenever the user asks to "check if it's working" or "see the frontend".

```bash
# Typical verification flow with Playwright MCP:
# 1. Navigate to the URL
mcp__playwright__browser_navigate({ url: "https://..." })
# 2. Take a screenshot — ALWAYS pass an absolute filename (see Screenshot convention)
mcp__playwright__browser_take_screenshot({
  type: "png",
  filename: "C:/Users/zihan/projects/andromeda/docs/captures/2026-07-24/home-desktop.png"
})
# 3. Get the page snapshot
mcp__playwright__browser_snapshot({})
# 4. Check for console errors
mcp__playwright__browser_console_messages({ level: "error" })
```

### Screenshot convention

**Every Playwright screenshot goes in `docs/captures/<YYYY-MM-DD>/`, one folder per capture date. Never the repo root.**

1. **Pass an absolute path** in `filename`. No Playwright MCP output directory is configured, so a bare relative name like `book-final.png` resolves against the repo root and dumps the file there. `/*.png` in `.gitignore` is a backstop that hides those strays — it is not permission to create them.
2. **Create the dated folder first** if today's doesn't exist: `mkdir -p docs/captures/$(date +%Y-%m-%d)`.
3. **Name by what it shows, not by attempt** — `book-positions-desktop.png`, not `book-final-2-fixed.png`. Overwrite the same name when re-capturing after a fix; the previous version is in git.
4. **`docs/baseline/screenshots/` is off-limits** for new captures. It holds frozen visual baselines referenced by `docs/baseline/frontend-routes.md`; overwriting one destroys the before-image of a regression.
5. Page snapshots and console logs land in `.playwright-mcp/` on their own. Leave them there — that folder is gitignored scratch. Only promote one into `docs/captures/` if a doc cites it.

## Scoring weights

All weights and lookbacks are stored in the `scoring_config` Supabase table — not hardcoded. To change how themes are scored, update the database, don't edit Python code.

## Q1 thesis pipeline (L0–L8)

The L5 agent (`backend/services/q1_agent.py`) is a deterministic-then-stochastic pipeline. Layers L0–L4 are pure functions — auditable, reproducible. Layer L5 is the only place an LLM is invoked — **MiniMax-M3** in this deployment. The provider is
chosen at import time by `_select_provider` (MiniMax → Anthropic → Gemini, first key present wins,
pinnable with `LLM_PROVIDER`), and per ADR-0013 the citation guardrail and candidate hard-filter
constrain whichever model answers, so the provider is swappable without weakening the L5 contract. Layers L6–L7 render the result with citation provenance, and L8 (`/ask`) lets a reader interrogate it at request time under the same citation contract — see [ADR-0087](docs/adrs/0087-a-chat-that-cannot-do-arithmetic.md).

| Layer | Source | What it does |
|-------|--------|--------------|
| L0 | `backend/data/macro_fetcher.py` | FRED + yfinance → `macro_indicators` table |
| L1 | `scripts/daily_refresh.py` → `build_theme_signals` | Brave News + Reddit → HypeScore per theme |
| **L1b** | `backend/services/narrative_tracker.py` | Un-themed market news → share of voice per phrase → emerging narratives (ADR-0128). **Shadow** — nothing here reaches L5 |
| L2 | `backend/data/factor_fetcher.py` | Ken French FF5 + UMD → per-asset betas in `factor_exposures` |
| L3 | `backend/services/regime_classifier.py` | Yield curve + HY OAS + VIX → cycle × sentiment |
| L4 | `scripts/daily_refresh.py` → `compute_and_persist_risk` | VaR, CVaR, Sharpe, Beta, HHI → `portfolio_risk` |
| **L5** | `backend/services/q1_agent.py` | 8-node pipeline: aggregate → screen → compute book metrics → scenario analysis → reason_picks (LLM) → verify_citations → size_positions → persist. On persist it also writes two **overlay analytics** over the sized book, sharing one reading of it via `_picks_and_gross`: `sanctions_exposure` (ADR-0096) and `positioning_crowding` (ADR-0097 — the only network call in the persist path, degrading per contract to "unobservable with a reason") |
| L6 | `frontend/app/book/page.tsx` | Per-trade thesis + book view rendered on `/book` |
| L7 | `frontend/components/{CitationList,ThemeDerivationDrawer,RegimeInputs}.tsx` | Citation footnotes + derivation audit trail |
| **L8** | `frontend/app/api/chat/route.ts` + `frontend/lib/chat/` | `/ask` — the only **request-time** LLM call. Plan (LLM picks ≤4 tools) → execute (deterministic, reusing the pages' own functions) → answer (LLM, restricted to fetched facts) → verify (every numeral cited/quoted/unverified, one retry). Read-only; spend-capped; fails closed |

The citation guardrail (verify_citations → retry → fallback) is the primary defense against LLM hallucination of macro numbers. See [ADR-0012](docs/adrs/0012-citation-guardrail-llm-defense.md) for the design rationale.
