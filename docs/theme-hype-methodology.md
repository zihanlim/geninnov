# A daily process for identifying market themes and quantifying hype

**Answers `task.md` Q2.** Data gathering → processing → quantification framework, and
how one output serves both idea generation and risk monitoring.

Every figure below is from the live system on 2026-07-28, not an illustration. Where
a number is not yet measurable, that is stated rather than filled.

---

## 0. The problem, stated precisely

Themes are identified informally — by reading and conversation. Three things go wrong
when you try to systematise that, and the design is mostly a response to them:

| Failure | What it looks like | Where it is addressed |
|---|---|---|
| **You only find what you named** | A keyword list finds the themes you already believe in, and calls the absence of everything else "no signal" | §2.2, §3.4 |
| **A score that moves when its peers move** | Cross-sectional normalisation makes "Inflation fell" indistinguishable from "something else rose" | §4.1 |
| **Attention that means nothing** | A loud narrative that moves no prices is a media artefact, not a market theme | §5 |

The brief's own definition is the constraint: a theme is *"the narrative driving
**cross-asset moves**"*. Attention alone does not qualify. That is why the
quantification has a correlation term at all, and why §5 is a gate rather than a
footnote.

---

## 1. Shape of the process

One job, once per weekday, 21:30 UTC — after the US close, so a day is complete
before it is scored.

```
  ┌─ ANCHORED PATH ──────────────────────────────────────────────┐
  │  9 named themes ── per-theme queries ── theme_news           │
  │        └─> mentions · sentiment · cross-asset corr · momentum │
  │              └─> HypeScore ──┬─> idea generation  (§6)        │
  │                              └─> risk monitoring   (§7)       │
  └───────────────────────────────────────────────────────────────┘
  ┌─ DISCOVERY PATH ─────────────────────────────────────────────┐
  │  market-wide queries ── market_news (UN-themed)              │
  │        └─> 1–3-gram document frequency ── share of voice      │
  │              └─> velocity vs each phrase's OWN history        │
  │                    └─> emerging & uncovered  ── SHADOW (§3.4) │
  └───────────────────────────────────────────────────────────────┘
```

**The two paths exist because they fail differently.** The anchored path measures
well but only what it was told to look for. The discovery path finds what nobody
named but measures crudely. Neither alone is a systematic process; the second is what
stops the first from being a mirror.

---

## 2. Data gathering

### 2.1 What is collected

| Source | What it provides | Cost | Why it is in the design |
|---|---|---|---|
| **Brave Search** news | Per-theme articles, and a separate market-wide corpus | API key | Recency-ranked; the primary attention signal |
| **GDELT** | Article counts with real history | Free, keyless | An **archive**, not a ranking — see 2.3 |
| **yfinance** | Daily closes per mapped instrument | Free | The cross-asset correlation term |
| **FRED** | Macro series (curve, HY OAS, VIX, real rates) | API key | Regime context; not part of HypeScore |
| **Reddit** | Retail attention | Configured, **not live** | Declared, not silently counted (§8) |

Live volume: **630 theme-tagged articles over 7 days across all 9 themes**, and a
separate un-themed market corpus for the discovery path.

### 2.2 Two corpora, and why that is the load-bearing decision

The per-theme corpus is built from **keyword queries per theme**. That is circular by
construction: ask about "AI capex", find articles about AI capex, conclude AI capex is
trending.

So a **second corpus is collected from market-wide seed queries** that name no theme
at all (`MARKET_SEED_QUERIES` in `brave_client.py`). The discovery path reads only
that one. It is the difference between *"is the thing I named getting louder?"* and
*"is anything getting louder?"*

That corpus uniquely has **no mock fallback**. Every other fetcher degrades to
fixtures when its key is missing; a frequency tracker reading template headlines
would report the template's own vocabulary as an emerging narrative, which is a
fabricated finding rather than a missing one.

### 2.3 Recency ranking is not history

Brave returns what is *relevant now*: 48% of a 45-day window lands in the last 7 days.
GDELT returns what was *published*: 18%, with 40 of 45 days populated.

This matters more than it sounds. Backfilling attention history from a recency-ranked
provider would manufacture density that never existed — and would clear the
minimum-observation floors in §5 with fabricated data. So history comes from the
archive, and no attention series is reconstructed from the ranking provider.
([ADR-0144](adrs/0144-a-second-provider-that-is-an-archive.md))

---

## 3. Processing

### 3.1 Mentions

Per theme per day: document count, plus a **7-day trailing average**.

The average is the primary input rather than the day count because a daily run often
collects **zero** articles dated that exact calendar day — news carries prior-day
timestamps. With a cross-sectional score, an all-zero day made every theme identical
and the scoring returned a uniform neutral. The 7-day average is the honest daily
attention level. ([ADR-0035](adrs/0035-volume-subscore-7day-average.md))

### 3.2 Sentiment

VADER compound per article, averaged per theme, in `[-1, +1]`.

Rescaled to `[0, 1]` for the composite but **never cross-sectionally normalised**: the
sign carries the meaning. Ranking sentiment across themes would destroy the
bullish/bearish distinction that makes it useful.

### 3.3 Cross-asset correlation

For each theme, its mapped instruments' returns are correlated against the theme's
attention series, **per asset class**, over the available overlap.

Two numbers travel with it: `corr_classes_measured` and `corr_classes_material`. On
the live run, *US Election* has **1 class measured, 0 material** — attention exists,
cross-asset movement does not. *Corporate Credit* has **2 measured, 2 material**. A
single correlation number cannot distinguish those, so both are stored.

### 3.4 Discovery: the narratives nobody named

Over the un-themed corpus: document frequency of 1–3-grams → share of voice →
**robust velocity against each phrase's own history** → `new` / `emerging` /
`established` / `fading`. `covered_by` names the anchor theme already asking for a
phrase, which is what separates *"Fed Policy is working"* from *"nothing is watching
this"*.

Deliberately dependency-free and deterministic, so unlike the monthly LDA ∩ embedding
job it runs **daily and in CI**.

**Live state, stated honestly: 358 phrases tracked, 279 covered by no anchor theme,
and velocity measurable on 0 of them.** Velocity needs a phrase's own history and the
tracker was rebuilt recently, so nothing can yet be classified `emerging`. The board
says so rather than showing an empty list as a finding — an empty instrument and a
measured negative are different claims.

---

## 4. The quantification framework

### 4.1 HypeScore

```
HypeScore = 100 × [ 0.30·volume + 0.20·sentiment + 0.30·correlation + 0.20·momentum ]
```

Weights live in `scoring_config`, not in code. Each component is an **absolute
sub-score on its own documented scale** — this is the central design decision:

| Component | Transform | Full credit at |
|---|---|---|
| **Volume** | `tanh(m / 3.0)` on 7-day avg mentions | 3 mentions/day → 0.76 |
| **Sentiment** | VADER compound rescaled to `[0,1]` | sign preserved |
| **Correlation** | `\|corr\|` ÷ documented material level | a fixed anchor |
| **Momentum** | `tanh(z / k)`, MAD-scaled, centred 0.5 | 0.5 = no change |

**Why absolute and not min-max across themes.** A cross-sectional score is a statement
about the day's peer group, not about the theme. Observed directly: China Growth's
mention count was byte-identical to the previous day while its normalised score moved,
because *other* themes moved. A reader cannot act on that, and it cannot be compared
across time. ([ADR-0042](adrs/0042-absolute-hype-subscores.md))

**Momentum uses median + MAD, not mean + std.** On a 7-point window one viral day
inflates the mean and one quiet day shrinks the std, so a naive z-score swings on
noise. Clipped to `[-4, 4]`.

**A missing component is dropped and the remainder renormalised** — never scored zero.
With a 0.30 correlation weight, scoring an unmeasurable correlation as 0 silently
deducts up to 30 points and is indistinguishable from a measured absence of
correlation. ([ADR-0036](adrs/0036-carry-as-excess-yield-over-funding.md))

### 4.2 Live output

| Theme | Hype | Mentions/day | Sentiment | Corr | Momentum | Classes material |
|---|---:|---:|---:|---:|---:|---:|
| AI Capex | 70.1 | 6.00 | +0.009 | −0.531 | 0.67 | 3 of 4 |
| Fed Policy | 69.8 | 6.57 | +0.063 | +0.404 | 4.00 | 1 of 4 |
| US Election | 69.4 | 6.71 | +0.081 | −0.235 | 1.12 | **0 of 1** |
| US Dollar | 67.0 | 5.86 | +0.070 | +0.302 | 1.85 | 1 of 4 |
| Geopolitical Risk | 63.1 | 3.00 | −0.098 | −0.304 | 4.00 | 1 of 3 |
| Corporate Credit | 59.4 | 1.29 | +0.143 | −0.465 | 0.67 | 2 of 2 |
| Energy Prices | 59.4 | 2.29 | −0.006 | −0.221 | 2.70 | 0 of 2 |
| Inflation | 45.0 | 2.57 | +0.013 | −0.210 | −0.67 | 0 of 3 |
| China Growth | 43.8 | 0.43 | −0.016 | −0.329 | 0.00 | 1 of 1 |

Read it as intended: **US Election is third on attention and last on evidence** — 6.71
mentions/day, and zero asset classes moving materially with it. Under the brief's own
definition that is not yet a theme; it is a story. A single ranked number would have
hidden that, which is why the material-class count is published beside the score.

---

## 5. The gate: does attention move prices?

The brief defines a theme as a narrative driving cross-asset moves, so the decisive
test is economic rather than linguistic. Per-class correlation is computed over a
phrase's mention series, with **two floors**:

- **5 sessions** to compute anything
- **20 sessions** to believe it

Below the lower floor the verdict *is* `insufficient_history` — not an optional flag.
The reason is empirical: the first live run returned `linked` for all 14 phrases at
n=5. A test that always passes is not a test.
([ADR-0143](adrs/0143-the-price-link-gate-and-what-it-refuses-to-say.md))

---

## 6. Supporting idea generation

HypeScore gates **which themes are in scope**. Direction comes from a separate score,
because attention has no sign:

```
EdgeScore = 0.20·Trend + 0.23·RegimeFit + 0.34·Carry + 0.18·Value + 0.05·Sentiment
side      = sign(EdgeScore)          |EdgeScore| < 0.15 → abstain
conviction = |EdgeScore| / max(vol, floor)
```

Sentiment enters with a small **contrarian** sign and the smallest weight. Weights are
priors from a weak positive IC, deliberately not refit: measured on the live
definition, carry IC is +0.128 (N=94, p=0.221) and trend +0.033 (p=0.300) — all
positive, none significant. Refitting on p=0.22 is fitting noise.
([ADR-0044](adrs/0044-carry-ic-was-measured-on-a-superseded-signal.md))

`conviction` is the mandate-free handoff to sizing: a ratio, identical at $100M or
$5bn.

---

## 7. Supporting risk monitoring

The same output, read the other way. An attention score means nothing in isolation —
it means something **against how much attention that theme normally gets**. So themes
are ranked by percentile within their **own** history, and the ones the book is
positioned in are flagged.

A long in a theme the crowd is already loud about is a crowded long: mean-reversion
risk the book is walking into. Below 5 observations the percentile renders `—`, never
a fabricated 50th.

This is the specific reason the framework does not stop at a ranked list. A ranked
list serves idea generation only; a **self-referenced percentile plus book position**
is what makes the same number a risk instrument.

---

## 8. What this does not claim

| Limit | Status |
|---|---|
| **Attention rests on one provider** | Brave. Reddit is fetched but unconfigured; a corroboration gate over a single source would be theatre ([ADR-0094](adrs/0094-no-corroboration-gate-over-a-single-source.md)) |
| **Per-theme queries are biased by construction** | Disclosed, not laundered — the anchored board is captioned as *relative attention among the anchors*, not share of an unbiased corpus |
| **Discovery sizes nothing** | Shadow. 358 phrases tracked, 0 with measurable velocity today |
| **The price-link gate is mostly abstaining** | By design, until 20 sessions accumulate |
| **The 9 themes are hand-chosen** | Discovery is what is meant to fix this, and it is not yet load-bearing |

Nine themes is a starting universe, not a claim about the world. The honest summary:
**the anchored measurement is sound and narrow; the discovery layer is the part that
makes it a process rather than a mirror, and it is real but not yet mature.**

---

## 9. The prototype

Live at **[andromeda-analytics.vercel.app](https://andromeda-analytics.vercel.app)**.

| Where | What it shows |
|---|---|
| `/` | Theme ranking, share-of-voice over time, discovery board with the uncovered shortlist |
| `/method#hypescore` | Every formula rendered from `scoring_config` at request time, against live data |
| `/method/evidence` | Whether it ran, what it read, and the guardrail audit |
| `/risk#limits` | Attention crowding against held positions (§7) |
| `/book` | The Q1 deliverable — what the process produced |
| `/ask`, `/api/mcp` | Interrogate any figure; every numeral adjudicated cited / quoted / unverified |

Reproduce: `python scripts/daily_refresh.py`. One job, ~10 minutes, one book.
