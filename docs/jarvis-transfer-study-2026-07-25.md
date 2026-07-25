# im-Jarvis → Andromeda: transferable-capability study

_Dated 2026-07-25. Produced by a 17-agent cross-repo study of `ERP-AI/im-Jarvis` against this
repo, with every candidate adversarially re-verified against real code before it was kept._

**Status: findings, not decisions.** Nothing here is an ADR. Items that get built earn their own
ADR at that point. Items marked blocked-on-data are recorded so the block is not rediscovered.

**Two corrections applied after the study ran:**

1. The report proposes `ADR-0076` for the Euler decomposition. Every number through **0080** is
   taken — the next free one is **0081**. (0078 was claimed twice on 2026-07-25 by two concurrent
   sessions; the CI one was renumbered to 0080. Check `docs/adrs/` before claiming a number.)
2. The report calls the deprecated Anthropic model id a live defect. It is **latent**: this
   deployment has no `ANTHROPIC_API_KEY`, and `_select_provider` (`backend/services/q1_agent.py:138`)
   picks MiniMax first, so the Anthropic branch never executes here.

---

# Andromeda ← im-Jarvis: adoption report

## 1. Verdict

Take the **Euler risk decomposition** (`risk_decomposition.py`) — it is the one thing im-Jarvis has that Andromeda structurally cannot compute, and it fixes a live problem: `compute_risk` currently emits a "VaR" derived from three rows of `portfolio_returns` while deliberately bypassing its own `MIN_DAYS_FOR_VAR=30` gate (`backend/services/risk_engine.py:288-297`). A position-level covariance gives a well-founded ex-ante number on day one plus per-name risk contributions that sum to the total.

Honestly, though: **almost no code transfers.** im-Jarvis is Decimal-first with `getcontext().prec=60`; Andromeda's numeric core is float/pandas. Its `_covariance` is an O(n²T) pure-Python double loop that would be strictly worse than `returns.cov()`. Its 121-line `cost_model.py` is four lines of arithmetic wrapped in dataclass ceremony. What ports is **formulas, invariants, and discipline** — the Euler identity, the inner-join-on-common-dates rule, the empty-tail→`None` rule, the golden sum-to-total test — typically 20–40 lines each, rewritten in Andromeda's idiom.

The second-highest-value cluster is not quant at all: three mechanical defects surfaced during verification that im-Jarvis merely prompted us to notice — a **deprecated dated model id** on the Anthropic fallback path with a `max_tokens: 4096` that will truncate a ten-pick book, a `requirements.txt` **missing three imported packages**, and a CI file whose backend job runs `pytest scripts/` while all 30 test files live in `tests/backend/`. Those are cheaper than any port here and they are live.

---

## 2. Tier 1 — take these now

### T1.1 · Euler component / marginal VaR over a position covariance matrix

**What** — `σ_p = √(wᵀΣw)`, `MCRᵢ = (Σw)ᵢ/σ_p`, `CCRᵢ = wᵢ·MCRᵢ`, `component VaRᵢ = z·CCRᵢ`, with `Σ CCRᵢ = σ_p` exactly. Plus an ex-ante book vol computed from 252 days of position returns rather than from the book's own three-session realised series.

**im-Jarvis** — `C:/Users/zihan/ERP-AI/im-Jarvis/backend/app/services/risk_decomposition.py:180-268` (Euler block), `:102-117` (`_aligned`, inner join on common dates), `:198-201` (drop weighted names with no history, **with a warning**), `backend/tests/test_risk_decomposition.py` (the sum-to-total assertion). **Do not port `_covariance` at `:158-177`.**

**Andromeda target** — new `C:/Users/zihan/projects/andromeda/backend/services/risk_decomposition.py`; wired from `backend/services/q1_agent.py:2231` (`finalise_book_analytics`); input from `backend/services/book_metrics.py:340` (`fetch_pick_returns`); new `supabase/migrations/038_risk_decomposition.sql`; render in `frontend/components/risk/PositionRiskAttribution.tsx` (which today does `signed_weight × β_mkt`, a beta table that sums to nothing).

**What the book gains** — "which position is causing the risk," with a defensible identity behind it, and a VaR that is not three observations wearing an audit-grade label.

**Effort** — M (~40 lines of math + a test + a migration + a panel).

**First commit** —
```python
# backend/services/risk_decomposition.py
def decompose_risk(signed_weights: dict[str, float],
                   returns: pd.DataFrame,
                   confidence: float = 0.95) -> dict: ...
```
with `tests/backend/test_risk_decomposition.py` asserting `sum(component_var) == portfolio_var` to 1e-9 on a hand-built 3-asset fixture — **written before anything is wired.**

**Non-negotiables**
- Use **signed** weights (`q1_agent.py:2216-2218`). A short's component VaR can legitimately be negative; render it, don't clip it.
- Do **not** renormalise. ADR-0037 leaves the cap residual as cash, so `Σ|w| < 1` and a lower `σ_p` is correct.
- Do **not** overwrite `portfolio_risk.var_95`. Ex-ante covariance VaR and realised-series VaR are different measurements; distinct `field_id`, distinct `method_id` (e.g. `risk.var.euler_exante.v1`), distinct label at render. Two contradicting VaRs on one page is exactly the regression `PROGRESS.md:114-115` documents twice.
- `diversification_ratio = Σwᵢσᵢ/σ_p` is a **long-only** construct — use `Σ|wᵢ|σᵢ` or don't emit it.
- Annualise at **252**, not im-Jarvis's 260 (`risk_decomposition.py:39`).
- Never render `risk_contribution_pct` as a share-of-whole bar or pie — it goes negative for a genuine hedge (ADR-0060).
- Units `usd` / `ratio` / `pct` already exist in the closed Literal at `backend/derivations/numeric.py:7`. No TypeScript mirror edit.

**Prerequisite refactor (do it first, it pays for itself):** hoist `fetch_pick_returns` out of `compute_correlation_matrix`. `finalise_book_analytics` currently reaches yfinance four times per run — `q1_agent.py:2224`, `:2249`, `candidate_book_correlation` at `:2265`, `independent_ideas` at `:838`. One shared frame feeds correlation, covariance and the decomposition.

New L4 analytic on the final sized book ⇒ **ADR-0076** + the `ARCHITECTURE.md` mermaid edit, per CLAUDE.md.

---

### T1.2 · Cost the daily rebalance in dollars

**What** — `cost = (commission_bps + half_spread_bps)/10000 × Σ|Δw| × NAV`, per name and total.

**im-Jarvis** — `backend/app/services/cost_model.py:45-52` and `:55-87`. Honestly: `rate = (commission_bps + half_spread_bps) / 10000; return rate * trade_value_abs`, and a loop over it. **Take the idea, write ~15 lines of Andromeda-native float code.**

**Andromeda target** — new `backend/services/cost_model.py`; called from `q1_agent.py:2231`; two seeded rows in `scoring_config` (`param_name TEXT UNIQUE, value TEXT`, `001_initial_schema.sql:112-117`) plus two fields on `ScoringConfig` in `backend/services/hype_calculator.py:43-64` — **no migration**; render alongside `frontend/lib/turnover.ts` on `/book`.

**What the book gains** — the largest invisible number in the product. ADR-0040 re-derives the whole book every weekday; `scripts/replication_test.py:10-13` records consecutive name turnover of 50%, 77%, 50%. At 15bps one-way that is a first-order fact about whether a daily cadence is economic — and it may well say it is not. `frontend/lib/turnover.ts` measures churn as a names-Jaccard ("Names, not weights", its own header at `:9`) and costs zero basis points of it.

**Effort** — S. The real work is the weight delta, and im-Jarvis supplies none of it.

**First commit** — `weight_delta(today_picks, prev_run_picks)` reading `signed_weight` from the previous `run_date`'s `research_recommendations.picks` (JSONB, `006_factor_exposures.sql:41-49`; written at `q1_agent.py:2602`). Union of both name sets. Then the four-line cost function, then the call from `finalise_book_analytics` wrapped in the same try/except-and-continue as the `correlation_summary` block at `q1_agent.py:2294`.

**Honesty constraints — these are the whole risk**
- 10+5 bps is **invented**. yfinance gives no bid/ask. Render as *"one-way trading cost at an assumed 10bps commission + 5bps half-spread; excludes borrow and short financing"*, with the assumed params visible next to the figure (ADR-0023 provenance). A $100M long/short book's short financing plausibly exceeds this entire number.
- The day-over-day diff inherits the exact comparability problem `frontend/lib/turnover.ts:47-72` already guards with `comparabilityCaveat`. Reuse that caveat; do not re-derive it.
- Credit half-spreads dwarf equity ones — seed per `asset_class` off `_ASSET_CLASS_MAP`, not one global.
- Keep it **out of the L5 prompt** until it has been stable across a week of runs. If it ever goes in, it must also go into `_collect_known_values` (`q1_agent.py:1870-1893`) or `verify_citations` rejects any thesis quoting it.

*(Note: `MIN_ADV_Millions = 2.0` at `book_metrics.py:193` stays dead. There is no ADV data source. But `backend/data/yahoo_client.py:21` already calls `yf.download(...)`, which returns `Volume`, and `:28` takes only `data["Close"]` — real ADV is one column away if you ever want it.)*

---

### T1.3 · Fix the Anthropic fallback path (deprecated model + truncating max_tokens)

**What** — im-Jarvis's rule, `docs/engineering-standards.md:22-23`: *"a dated Claude model id in source is a defect."* Andromeda has one, and it is worse than hygiene.

**Andromeda target** — `backend/services/q1_agent.py:109`, `:342`, `:343`.

`DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL_ID", "claude-sonnet-4-20250514")` — a deprecated model past its announced retirement window. Separately, `:342` sets `"max_tokens": 4096` for the same ten-pick-book prompt MiniMax is given 900 seconds to answer (`:106`). 4096 tokens truncates the JSON mid-book, which lands in the `JSONDecodeError` branch at `:1509`. **The Anthropic fallback is very likely already broken, independent of the model id, and nothing would tell you.**

**Effort** — S, but it is not the one-liner it looks like. Moving to a current model (`claude-opus-5` / `claude-sonnet-5`) *also* requires deleting `"temperature": temperature` from the Anthropic kwargs at `:343` — those models reject temperature/top_p/top_k with a 400. Do both in one commit or neither. Raise `max_tokens` in the same commit.

---

### T1.4 · Make CI a gate, run the tests that already exist, fix the dependency set

**What** — Andromeda owns 30 backend test files and CI runs none of them.

**Andromeda target** — `.github/workflows/ci.yml`, `backend/requirements.txt`, new `backend/constraints.txt`, `.github/workflows/daily-refresh.yml`.

Evidence:
- `ci.yml:57` runs `pytest scripts/`. Every test lives in `tests/backend/` (30 files: `test_risk_engine.py`, `test_book_metrics.py`, `test_q1_agent.py`, …). **Nothing is collected.**
- `ci.yml:51,54` run `ruff check scripts/` and `mypy scripts/` — `backend/` is never linted or type-checked at all.
- All three end in `|| true`. `l5-eval` is the only job in the file that can fail (its own comment at `:61-64` says so).
- `requirements.txt` omits `requests`, `scipy` and `python-dotenv`, all of which are imported — `backend/data/macro_fetcher.py:47` is on the L0 critical path; `backtest_edge.py` guards a scipy import and `sys.exit(1)`s.
- Three divergent install lists: `ci.yml:45` (`ruff mypy pytest`), `ci.yml:95` (6 packages), `daily-refresh.yml:68-73` (11 packages, all `>=`). Locally, 8 tests currently fail `ImportError: cannot import name 'Client' from 'supabase'` — that is the drift, already happening.

**Effort** — S.

**First commit** — change `ci.yml:57` to `pytest tests/backend/`, extend ruff/mypy to `backend/ scripts/`, and drop `|| true` from `pytest` only (leave it on ruff/mypy until the lint debt is paid, with a dated TODO). Then add `backend/constraints.txt` with **upper bounds** (not hashes — yfinance is a scraper and a hard pin will break the daily run in a way `>=` would self-heal), add the three missing packages to `requirements.txt`, and make all three `pip install` sites pass `-c backend/constraints.txt`.

**Do not** create `docs/engineering-standards.md`. A standards doc nothing enforces is a fifth living document to drift; CLAUDE.md's Doc Sync Rule and 75 ADRs already carry that load. Put the two rules that matter into CLAUDE.md's existing tables.

---

## 3. Tier 2 — worth it, but bigger

| # | Item | im-Jarvis | Andromeda target | Effort | Note |
|---|---|---|---|---|---|
| T2.1 | **Historical VaR/ES + Sortino** alongside the parametric pair — the *gap* between the two methodologies is the fat-tail statement | `backend/app/services/risk_service.py:60-89`, `:96-102` | `backend/services/risk_engine.py` | M | **Strict follow-on to T1.1.** Run on the synthetic 252-day book series (signed weights × position returns), never on the 3-row realised series. Keep two details: the midpoint-interpolation quantile, and hist-ES = mean of returns *strictly below* hist VaR → `None` when the tail is empty (ADR-0066). **Drop max drawdown** — `frontend/lib/risk/analytics.ts:461-467` already computes it identically, and `riskBoard.ts:292-293` records why it's exempt from the sample gates. **Drop Calmar** — needs an annualised return you won't have for a year. Keep 252, not 260. |
| T2.2 | **Benchmark comparison vs SPX** — active return, TE, IR, correlation, geometric up/down capture | `backend/app/services/benchmark_compare.py:105-119`, `:122-203` | new `backend/services/benchmark_compare.py`, called from `daily_refresh.py:1197-1216` | S–M | **Split it.** Ship the SPX *cumulative overlay series* now — it's the only piece with value at n=3, and `DrawdownChart.tsx` currently draws a book curve with nothing to judge it against. It needs a real home (a column on `portfolio_returns` or its own JSONB), **not** `numeric_derivations` — `NumericDerivation.value` is `Optional[float]` (`backend/derivations/numeric.py:32`). The six scalars render `unavailable` for ~3 more months. **Drop beta** — `risk_engine.py:157-166` already owns it. Replace im-Jarvis's zeroed `n=0` result (`:129-143`) with `display_status='unavailable'` + reason. `RiskMetricsGrid.tsx:63` reads by explicit key, so each metric needs its own tile. |
| T2.3 | **Per-ticker contribution to cumulative return**, Cariño-linked | `attribution.py:140-170` (`_carino_k`, 12 lines) | `backend/services/portfolio.py`, `daily_refresh.py:1074-1082`, new JSONB on `portfolio_returns` | M | **Reverse the proposed order.** `compute_daily_contributions` (`portfolio.py:12-17`) already exists and is dead outside tests — `compute_daily_return` sums it and throws the per-ticker map away. **Persist the map first**; that alone answers "which position produced the P&L" and needs zero im-Jarvis code. Add `_carino_k` second — at 3 sessions and +0.73% cumulative the linking correction is ~1e-5, i.e. invisible. Discard `return_contribution.py`'s price/income split and `D_t = dtd_nav + cw` denominator; Andromeda has no dividends or cash flows, so `D_t = 1`. Label it *"contribution by name over the period"* — ADR-0040 rewrites positions daily. Backfill is impossible; say so. |
| T2.4 | **Per-theme exception isolation in the L1 loop** | `orchestration/flows.py:53-70` | `scripts/daily_refresh.py:146-215`, `:1622` | S | Today one theme's Brave/Reddit/yfinance blip aborts the entire L1 stage and kills the run before L4 and L5. Wrap the loop body in try/except; `build_theme_signals` returns `(results, skipped: list[str])`; the L1 `record_pipeline_run` at `:1622` puts `{"themes_scored": n, "themes_skipped": [...]}` into `pipeline_runs.source_freshness` (already JSONB — no migration). **Persist the roster, not a count, and not to stdout** — trading a loud abort for a quietly thinner book is what ADR-0023 forbids. **Skip the generic retry module**: im-Jarvis's `with_retry` is async with no injectable sleep (so it's a rewrite, not a port), the one call site that demonstrably cost a day already has a targeted fix (`daily_refresh.py:1053-1069`), and `q1_agent` deliberately does not retry timeouts with a documented reason (`:1522-1537`). |
| T2.5 | **Diagnostics on failed LLM attempts** | `agents/shared/base_agent.py:140-152` (`finally` + `response = f"ERROR: {exc}"`) | `supabase/migrations/038_llm_attempt_diagnostics.sql`, `q1_agent.py:1509-1512`, `daily_refresh.py:1726-1740` | M | **Skip the new table.** `research_agent_runs` (`006_factor_exposures.sql:54-66`) already carries prompt_version, model_id, input_snapshot, raw_output, citations, verified, retries — *and a declared `duration_ms` that has never been written*. Add four columns (`error_class`, `error_detail`, `response_head`, `provider`) and populate `duration_ms`. Then (a) stash the head/tail already being printed at `q1_agent.py:1509-1512` into state so `_persist_to_supabase` writes it, and (b) write a minimal row from the L5 exception handler at `daily_refresh.py:1726-1740`, so a hard crash stops vanishing. Store `prompt_sha256`, not prompt bodies. One `ARCHITECTURE.md` table-cell edit instead of a mermaid node. |

---

## 4. UI/UX

### U1 · Delete the dark-theme header slab in `DerivationDrawer` — **do this first, it is the highest-value UI item in the set**

`frontend/components/DerivationDrawer.tsx:104` hardcodes `style={{ background: "linear-gradient(180deg, #1a2230 0%, #131822 100%)" }}` — a corpse from the superseded dark palette (`docs/design/redesign/index.html:13-16` defines the same `#161b24`/`#1c2230` family). The `<h2>` at `:107` sets no colour, no ancestor sets one, so it inherits `--text-primary` `#1c1815`. **Computed contrast: 1.10:1.** The subtitle (`:109`) and close button (`:115`) are equally illegible. This is on every theme derivation drawer, in a product whose `globals.css` records measured AA ratios in every token comment.

Fix: delete the inline `style`, let the sticky header fall back to `bg-bg-surface`. Re-capture `docs/captures/<today>/theme-derivation-drawer-desktop.png`.

Two riders in the same commit:
- **Hygiene, not a bug:** mirror `onClose` into a ref and change the effect dep array at `:85` from `[open, onClose]` to `[open]`. im-Jarvis annotated exactly this fix in `Dialog.tsx:29-33`. Verified: it does *not* currently misfire — `app/page.tsx` has one `useEffect` and no polling, so nothing re-renders the parent while the drawer is open. Bill it accordingly.
- **Do not add `createPortal`.** Traced the ancestor chain (`layout.tsx:35 → :37 → <main>`); nothing creates a stacking context, and `TopBar`'s `backdrop-blur-md` is a *sibling*. It fixes nothing today and costs an SSR `mounted` guard plus a 375px re-verify against `layout.tsx:37`'s `min-w-0`.

**Also:** `frontend/components/TradeDerivationDrawer.tsx` is 721 lines imported by nothing. Wire it up or delete it, or the same fix has to be applied twice.

### U2 · A `/styleguide` route as the design-system contract

**im-Jarvis** — `frontend/src/app/styleguide/page.tsx` (572 lines; imports 20 real primitives at `:3-24`; declares colours as literal class strings with a JIT warning at `:53`; states the contract at `:48-51` — *"if it is not on this page, it is not in the system"*).

The structural case is airtight: `vitest.config.ts` is `environment: "node"` with `include: ["tests/unit/**/*.test.ts"]`, so **no React component renders in any test**; `ci.yml:118-119` runs only lint and typecheck, so Playwright never runs in CI either; and `tests/e2e/accessibility.spec.ts:31` targets `/trades`, `/research`, `/portfolio` — all bare `redirect('/book')`. Component drift has no detector at all. Meanwhile the only design artifact on disk, `docs/design/redesign/index.html`, is 1048 lines of a superseded dark palette (`#0a0e14`, `#4d8fff`, Inter) with no historical marker, actively contradicting the shipped Ledger tokens.

Build: literal-class swatches for every `:root` token with its recorded contrast ratio on paper *and* on card; `StatusBadge` in all five `NumericStatus` values; **the five parallel empty-state implementations side by side** (`status/EmptyState.tsx:31` + `:81`, `risk/SectionGap.tsx:10` + `:65`, `method/primitives.tsx:94` + `:119` + `:134`) — that reconciliation is arguably the biggest single win; and `Sparkline`/`SubScoreBars`/`EdgeBars` fed `null` to prove the "—" rule.

Constraints: keep it out of `TopBar.tsx:18-21` and any sitemap — ADR-0054 fixes the four-route IA, this is an internal contract page. Needs its own ADR stating the fifth-route exception and that it ships publicly on Vercel. **Do not** port im-Jarvis's `tailwindcss/no-arbitrary-value: error` — it would fail the build on `text-[11.5px]` and dozens of siblings.

Free in the same commit: date-stamp or delete `docs/design/redesign/index.html`, and fix the unreachable `#e11048` default at `Sparkline.tsx:7` before it becomes reachable.

*Two "dark-theme corpses" originally offered as motivation don't exist — `StatusBadge.tsx:16` is fully tokenised and carries a comment recording the fix, and `Sparkline`'s bad default is never exercised (`ConvictionCard.tsx:176` always passes a token-derived colour). The two real ones are `DerivationDrawer.tsx:104` and `book/page.tsx:176` (`SEVERITY_COLOR.high = '#e8833a'`). Pitch it structurally, not anecdotally.*

**Effort** — M.

### U3 · A `.lc` label-caps utility

`frontend/app/globals.css`, in the existing `@layer components` block:
```css
.lc { @apply text-[11px] uppercase tracking-[0.1em] text-text-tertiary; }
```
Place it **directly after `.card-title`**, not after `.num` — because `.card-title` (`globals.css:99-101`, `text-[11px] uppercase tracking-[0.12em] text-text-secondary font-medium`, 35 usages) *is already* a label-caps utility. This is a second tertiary-ink variant beside it, not a new idea.

Scope honestly: `grep -rn 'uppercase tracking-'` over `app/` + `components/` returns 98, but only **20** match the proposed string exactly. The distribution is 22× `0.1em`@11px, 18× `0.1em`@10px, 13× `0.12em`@11px (sites that should have been `.card-title`), plus 10.5px and one-off tracking values. Convert the 20 exact sites and the 13 `.card-title` sites. **Leave every 10px/10.5px variant alone** — that is a deliberate density tier for table headers, and flattening it is a visual regression dressed as cleanup. **Skip `EdgeBars.tsx` entirely**: its only uppercase label (`:101`) is 10px/`0.08em`, and `:104,:107,:108` are *not* uppercase — applying `.lc` would silently uppercase three data-column headers.

Keep Andromeda's sans/tertiary values; do **not** copy im-Jarvis's `font-mono`/700 (`globals.css:150-157`) — JetBrains Mono is reserved for figures via `.num`. **Effort S.**

### U4 · `prefers-reduced-motion` + retarget the axe spec

Zero handling exists (`grep -rn 'prefers-reduced-motion|reducedMotion'` over `frontend/` → nothing). But the gap is smaller than it looks: `animate-fade-in` (`tailwind.config.ts:58`) and `animate-pulse-soft` (`:60`) have **zero call sites**; `animate-slide-in` runs once. The only real surface is `.skeleton` (`globals.css:123-128`, `animation: shimmer 1.5s infinite`, 26 usages across 14 files) — and `docs/captures/2026-07-25/risk-desktop.png` shows `/risk` loading as ~10 stacked shimmering blocks, i.e. a full-viewport infinite animation.

Two independent changes, both three lines:
1. Add `@media (prefers-reduced-motion: reduce)` scoped to `.skeleton` and `.animate-slide-in`, nulling `animation` while keeping the background gradient so the block still reads as a placeholder. While in `tailwind.config.ts`, **delete** the dead `fade-in` and `pulse-soft` keyframes rather than writing rules for animations that run nowhere.
2. Fix `tests/e2e/accessibility.spec.ts:31` to `['/', '/book', '/risk', '/method']`. `/risk` is the densest page in the product and **has never been axe-tested** — axe currently runs on `/book` three times. This is the more valuable half. (It is documentation, not a gate, until Playwright is in CI.)

Don't sell this as an a11y milestone — the shimmer only runs during a short Supabase fetch, so WCAG 2.2.2's five-second threshold is arguably not crossed. **Effort S.**

---

## 5. Considered and rejected

| Item | Why not |
|---|---|
| **Liquidity-horizon bucketing / liquidity-adjusted VaR** (`liquidity.py`) | The days-map has no data behind it. Universe is ~45 liquid ETFs + 15 large-caps; at $100M gross with a 20% cap the largest position is $20M, so every bucket collapses to `≤1d` unless the days are chosen to make the panel interesting — the definition of the ADR-0023 failure. Also the quadrature `√(ΣVaRᵢ²)` assumes independent sleeves, which ADR-0072 exists because they aren't. |
| **Monte Carlo VaR/ES with Student-t innovations** | Strictly downstream of T1.1 (needs the covariance that doesn't exist yet), and **nothing consumes the output** — sizing is by conviction (`trade_ranker.py:407-445`), no code path reads `portfolio_risk.var_95` to gate anything. A third VaR while the first is built on 3 observations. Also injects a stochastic routine into the layer whose product claim is determinism (ADR-0013), inside a job already at `timeout-minutes: 60`. |
| **Bond math — DV01, duration, convexity, YTM** (`bond_math.py`, ~855 LOC across 5 modules) | **Blocked on data that does not exist.** `BondTerms` needs coupon, frequency, maturity, day-count, and a marked clean price. `theme_assets` is `(ticker, weight, run_date, asset_class)`; nothing in `supabase/` has a coupon, maturity, face or CUSIP, and neither yfinance nor FRED supplies them. An ETF has no maturity. Note im-Jarvis's own `dv01 = -modified * price * 1e-4` (`:248`) — for an input whose only real datum is a duration estimate, the whole module collapses to one multiplication. |
| **Realised-vol-ratio regime replacing the SPX-breadth stub** | Diagnosis is right, port is architecturally impossible. L3 runs at `daily_refresh.py:1570`, before the book exists at `:1688` — there are no held tickers at classification time, and feeding it yesterday's book closes a loop (regime → risk_appetite → EdgeScore → picks → tomorrow's regime). Also double-counts: `risk_appetite` already carries VIX level and VIX term structure. **The fix that matters is a three-line deletion in Andromeda's own `regime_classifier.py:85-89`** — make `_compute_spx_breadth` return `None`; it needs nothing from im-Jarvis. |
| **EWMA(0.94) vol in the conviction sizer** | Changes live position sizes on a $100M book and nothing here can measure whether it helps — `backend/eval` scores the LLM's book and contains no sizing check; `replication_test.py` measures LLM variance. λ=0.94 is an ~11-day half-life replacing a 126-day sample std on a book already turning 50-77% of names, and `conviction_vol_floor=0.00315` was calibrated against the old denominator. Also im-Jarvis's emitted vol *path* (`volatility_models.py:83-85`) uses same-day returns — a look-ahead artefact if charted. |
| **Real-P&L backtest replay** (`backtest_service.py`) | Long-only at three independent levels: `:124` filters `w > ZERO` (deleting the entire short book), `:130` applies the same filter to the *missing-price warning* so the deletion is silent, `:146-147` renormalises to 1.0 (contradicting ADR-0037), `:166-170` marks NAV as `Σ shares × close` with no cash account. Rewriting for signed weights is rewriting the engine. And the headline would be an equity curve from signals whose own ICs are carry p=0.221, trend p=0.300, value p=0.368. |
| **Schema↔frontend column auditor** | Compares against the wrong oracle. `docs/baseline/schema.md:31-32` records migrations 010 and 011 as *present locally, missing in the deployed schema* — an auditor reading `supabase/migrations/*.sql` passes while the browser 404s. Also misses the biggest targets: `app/risk/page.tsx:59-70` puts six column lists behind consts. A live PostgREST OpenAPI check under the anon key is strictly better. |
| **RGB-triple `<alpha-value>` token refactor** | 205 `var(--token)` call sites across 36 files consume tokens as **complete colour values** in inline styles and SVG attrs (`borderColor: 'var(--warning)'`, `stroke="var(--long)"`). Rewriting `:root` to triples makes those invalid CSS that silently falls back — and neither lint, tsc, vitest (node env, no component rendering) nor CI-Playwright (never runs) can see it. *Do* fix the four real defects it surfaced: 22 stray `rgba()` literals; `--long-dim`/`--short-dim` undefined in `:root` so `book/page.tsx:602` takes its 0.06 fallback while `.badge-long` renders 0.11; orphan amber `rgba(210,153,34,…)` inside a `var(--warning)` border at `SizingChainView.tsx:47-49`; raw `#e8833a` at `book/page.tsx:176`. |
| **What-if before→after→Δ table + save-and-compare** | im-Jarvis's panel is a thin client over a server-side scenario engine (`WhatIfPanel.tsx:13` imports a Server Action) — the FastAPI backend Andromeda has ruled out. `estimateWhatIf` (`riskBoard.ts:678-732`) never reweights the book, so two of four proposed rows have `before = 0` by construction and two move only by second-order drift. Compare-n over a one-metric table isn't a capability. |
| **Sparklines on the risk KPI cards** | **Blocked on data.** Live query: `portfolio_risk` and `portfolio_returns` each hold **3 rows**, and `beta` is NULL in two of them. Every metric is suppressed by its own `minSessions` gate (VaR/CVaR 30, Sharpe/Beta 60), leaving only HHI — a 3-point line, below the proposal's own floor. VaR unblocks in ~6 weeks, Sharpe/Beta in ~3 months. Also unexercised in im-Jarvis: its only production consumer passes `spark` on none of five cards. |
| **Operator promote/reject gate for `discovered_themes`** | Promotion produces an inert theme. `themes` (`001_initial_schema.sql:20-32`) has no tickers; tradability comes from `theme_assets`, and `discovered_themes` (`021`) carries only `label`, `terms`, `tier`, `methods`. The button would change nothing. |

---

## 6. Sequencing

**Week 0 — no dependencies, all mechanical, ship in a day**
1. **T1.3** Anthropic model id + `temperature` removal + `max_tokens` (`q1_agent.py:109,342,343`) — one commit, all three or none.
2. **T1.4** `ci.yml:57` → `pytest tests/backend/`; ruff/mypy over `backend/ scripts/`; `constraints.txt` + the three missing packages.
3. **U1** Delete `DerivationDrawer.tsx:104`. Decide `TradeDerivationDrawer.tsx`'s fate.
4. Free rider: make `_compute_spx_breadth` (`regime_classifier.py:85-89`) return `None` instead of the literal 65.0/35.0. Three lines; ADR-0066 handles the rest.

**Week 1 — the shared-returns refactor, then the two quant items**

5. **Prerequisite:** hoist `fetch_pick_returns` out of `compute_correlation_matrix` so `finalise_book_analytics` pulls 252d once instead of four times (`q1_agent.py:838, 2224, 2249, 2265`). Everything below rides on this frame.
6. **T1.1** Euler decomposition — test first, then wire, then migration `038`, then ADR-0076 + mermaid.
7. **T1.2** Cost model — independent of T1.1, can run in parallel. Weight delta first, arithmetic second.

**Week 2–3 — follow-ons**

8. **T2.1** Historical VaR/ES + Sortino — *depends on T1.1* for the synthetic 252-day book series. Do not start earlier.
9. **T2.4** L1 per-theme isolation — independent, cheap, prevents a class of full-run outage.
10. **T2.2a** SPX cumulative overlay only. **T2.2b** (the six scalars) is *blocked on ~60 more trading days* of `portfolio_returns`; schedule it, don't build it now.
11. **T2.3a** Persist the per-ticker contribution map. **T2.3b** (Cariño linking) is *blocked on the correction being non-trivial* — revisit when the record is long enough to matter.
12. **T2.5** LLM attempt diagnostics — independent; fold the four columns into migration `038` if it hasn't shipped yet, otherwise `039`.

**Later — needs its own ADR and a design conversation**

13. **U2** `/styleguide` (ADR for the fifth-route exception vs ADR-0054). **U3** `.lc`. **U4** reduced-motion + axe retarget — U3/U4 are S and can slot anywhere.

**Blocked, tracked, not scheduled**
- Anything ADV- or capacity-related → needs `Volume` persisted from `yahoo_client.py:21` first.
- Anything duration/DV01/credit-analytic → needs an instrument master with coupon/maturity/day-count in Supabase. No current data source supplies it; do not synthesise one.
- All realised-history statistics (TE, IR, capture, Calmar, KPI sparklines) → 3 sessions today. Gate on `display_status='unavailable'` and revisit in ~3 months.

**Doc-sync obligations (CLAUDE.md, mandatory):** T1.1 → new ADR-0076 + `ARCHITECTURE.md` mermaid + Layers/Tables/Checklist + `PROGRESS.md` row. T1.2 → `ARCHITECTURE.md` tables + `PROGRESS.md` (no new layer, ADR optional). T2.5 → one `ARCHITECTURE.md` table-cell edit. U2 → its own ADR. Also fix the existing drift: `ARCHITECTURE.md`'s "Cap Enforcement" section still describes the ≥3-member group-cap and "normalize once" behaviour that ADR-0037 removed.