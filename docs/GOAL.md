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

Live at https://andromeda-analytics.vercel.app · 502 backend + 87 frontend tests green.

- **Pipeline** L0–L5 runs daily on GitHub Actions (`daily-refresh.yml`, verified
  firing on schedule); monthly `theme-discovery.yml`; all 6 secrets configured.
  **All six stages report to `pipeline_runs`** since iteration 14 — L1 and L4 were
  silent, so `/method` said "not instrumented" while the status bar said "4/4
  succeeded".
- **Q1 book** — **5 long / 4 short across 9 positions** (XLE, JPM, SVXY, NUE, UNH
  long; SLV, BABA, PDD, NOC short) on the last 2026-07-25 run, +0.9% net at 59.6%
  gross. **Sized by conviction since iteration 38** (ADR-0053) — it had been
  HypeScore-weighted while every surface claimed otherwise; `|weight|/conviction` is
  now one constant per side. **Seven of the nine positions survived every rerun on
  identical inputs; XLE and UNH did not** (ADR-0057), and each row says which. **The long side is at Q1's five**; the
  short side holds four of the five independent ideas that existed, and `/book`'s Pool
  depth panel says so in warning colour rather than excusing it. Almost every name
  comes from a theme **below** the attention gate (ADR-0046). **The composition moves
  hard run to run** — 94% turnover against the previous book — so this is one draw
  from the pool, not a settled answer, and the turnover panel says that too. **One portfolio everywhere** since iteration 10
  (ADR-0040) — `/book` and `/risk` describe the same names and every risk number is
  computed on them, and since iteration 32 `/risk` *checks* that rather than assuming
  it — and direction no longer inverts on a regime label flip since
  iteration 11 (ADR-0041).
  Two-sided since iteration 8 (ADR-0038, direction per asset) and deeper since
  iteration 9 (ADR-0039, scope by attention). Genuinely cap-bound since iteration 7
  — **`/risk` now shows 0 breached limits**, down from 6 violations. The L5 fallback
  that dogged iterations 3–5 is **fixed and closed** (iteration 6). Remaining Q1 gap
  is depth: the ask is five and five.
- **Direction** EdgeScore = trend/regime/carry/value/sentiment, IC-weighted, with
  abstention + conviction sizing (ADR-0031/32/33).
- **Q2 hype** HypeScore (volume/sentiment/|ρ|/momentum), **absolute and therefore
  comparable over time** since iteration 12 (ADR-0042) — which is what "support risk
  monitoring" requires — plus theme discovery (LDA ∩ embeddings, 6 two-method
  agreements) surfaced on `/`.
- **Honesty surfaces** HypeScore IC panel says NOT YET VALIDATED; risk cards state
  their sample size; `/method` renders every formula from live `scoring_config`.

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

**NOT YET RENDERING LIVE — do not believe the ADR's screenshots-in-waiting.** The
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
