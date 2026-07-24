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

Live at https://andromeda-analytics.vercel.app · 385 backend tests green.

- **Pipeline** L0–L5 runs daily on GitHub Actions (`daily-refresh.yml`, verified
  firing on schedule); monthly `theme-discovery.yml`; all 6 secrets configured.
- **Q1 book** — **two-sided at last: 7 long / 2 short across 9 positions**
  (iteration 8, ADR-0038 — direction moved from the theme to the asset). VERIFIED
  thesis w/ citations, conviction-sized, and genuinely cap-bound since iteration 7:
  the 20/30/35 limits bind and whatever they refuse is held in cash. The L5 fallback
  that dogged iterations 3–5 is **fixed and closed** (iteration 6). Remaining Q1 gap
  is depth on the short side — 2 shorts, not 5.
- **Direction** EdgeScore = trend/regime/carry/value/sentiment, IC-weighted, with
  abstention + conviction sizing (ADR-0031/32/33).
- **Q2 hype** HypeScore (volume/sentiment/|ρ|/momentum) + theme discovery
  (LDA ∩ embeddings, 6 two-method agreements) surfaced on `/`.
- **Honesty surfaces** HypeScore IC panel says NOT YET VALIDATED; risk cards state
  their sample size; `/method` renders every formula from live `scoring_config`.

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

- **`/risk` mixes two books by construction.** Per-position attribution reads
  `portfolio_positions` (L1/L4's sized book) while cap utilisation, scenarios and
  `book_metrics` read `research_recommendations` (L5's independently re-picked
  book). When L5 picks a different subset the page contradicts itself — observed
  2026-07-24: attribution showed 8 positions at 12.5% while the single-name cap row
  claimed 50% (L5's 2-pick book). Iteration 1 fixed same-day *duplication* within
  `portfolio_positions`; it did not make L1 and L5 agree. Either have `/risk` read
  one source, or have L5 size the L1 book rather than re-pick it.
- ~~**L5 falls back because `reason_picks` never parses a response**~~ — **CLOSED,
  iteration 6.** It was a hardcoded 120s read timeout against a ~205s generation.
  `LLM_TIMEOUT_SECONDS` (default 420). Verified live: `verified=True`, 28 citations.
- **SINGLE NAMES — now correctly motivated, and the next step.** Iteration 8 found
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
- **Q1 breadth** — universe is 8 themes → 24 tickers, all ETFs/futures proxies, zero
  single names; only 3 themes clear conviction. Diagnosed in iteration 2; the
  one-line backfill change was rejected as dishonest (see above). Legitimate route:
  more expressions per theme (`004_bootstrap_live.sql` + `_theme_default_assets`),
  more themes, or single names — each needs `SECTOR_MAP`/`GEO_MAP`/`_ASSET_CLASS_MAP`
  entries too, or `is_classified` drops them silently.
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
