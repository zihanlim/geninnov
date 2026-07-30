---
status: accepted
date: 2026-07-30
deciders: platform owner
---

# ADR-0172 — Every phase answers its own question above the fold

## Context

The app was hard to read for a PM trying to decide something. Measured at 1500×950
rather than asserted:

| route | screens | numerals | where its OWN answer sat |
|---|---|---|---|
| `/` Alpha | 4.0 | **420** | heatmap 770px, top themes 1356px |
| `/mandate` | 5.3 | 232 | mandate panel 284px |
| `/scenario` | 6.5 | 298 | **stress scenarios 2622px** |
| `/book` | 5.4 | 333 | answer row ~230px — the only one |
| `/attribution` | 1.5 | 123 | most of phase 6 was elsewhere |
| `/method` | 1.4 | 23 | process map 246px |

**25 screens, 1,444 numerals, zero inner scrollers** — so design-goal 7 was intact and
density was not the fault. That goal says density is *correct* when a reader is
comparing. Two things were wrong instead:

1. **Five of six phases had no decision surface.** `/book` had one and nothing else
   did.
2. **Blocks sat on the tab whose question they did not answer.** `/scenario` asked
   *"what proves the thesis right, and what do the other paths cost?"* while its stress
   matrix was three screens down; `/mandate` carried *"versus the benchmark"* and *"these
   weights over the past year"* — both backward-looking, i.e. phase 6 — while
   `/attribution`, whose declared question is *"was the thesis right?"*, was the thinnest
   page in the app.

The fix already existed on one page. `components/book/AnswerCards.tsx` states the
diagnosis in its own header: *"The measured defect this fixes is PLACEMENT, not paint."*

## Decision

**Generalise the proven row to every phase, and move each block to the tab whose
question it answers** — where "which question" is not taste, it is the `question` field
already declared per phase in `lib/method/phases.ts`.

`components/AnswerRow.tsx` carries the contract, extracted unchanged from the book's
usage: **LABEL / FIGURE / CONSEQUENCE**, consequence *computed* from the same row the
figure came from, figure linking into the panel that derives it, `source` naming the
`table.column`, `figure={null}` rendering an em-dash whose consequence must then say
why. Four cards, never five — a fifth pushes the evidence down, which is the defect the
row exists to remove reintroduced by its own growth.

**Phase 3 is renamed `Risk` and reclaims `/risk`.** Its question always *was* the risk
question and the `Scenario` label hid that. This simplified ADR-0170: `/risk#stress`,
`#attribution`, `#exposure` and `#concentration` resolve natively again, and the
fragment hop shrank to the three that genuinely moved.

**The moves, each justified by the destination's question:**

| Block | From | To |
|---|---|---|
| Cap utilisation | `/risk` | `/mandate` — the limit board it measures against is there |
| Versus the benchmark | `/mandate` | `/attribution` — backward-looking |
| Weights backtest | `/mandate` | `/attribution` — backward-looking (ADR-0112) |
| Track record | `/method/evidence` | `/attribution` — phase 6 *is* "was it right" |
| VaR by method | `/mandate` | `/risk` — a risk analysis, not a limits check |
| Stress scenarios | 2622px | **top** of `/risk` |

**Nothing is collapsed**, at the owner's direction. No block gained a `<details>` or a
`CollapsibleSection`; the moves carry the whole gain.

**A hard refusal travels with the component.** No card may show Sharpe, Sortino,
Calmar, max drawdown, realised beta, tracking error or information ratio. Those come
from `portfolio_returns`, which is costless on a book measured at **92.7% mean daily
turnover** — `CostDrag` measured what that is worth: +0.76% gross against −0.72% net,
**the sign flips** — and they sit at 6 sessions against minimums of 30–252. Wrong on
sample *and* basis, and an answer row is the worst place for a wrong number.
`sampleAdequacy` already suppresses them on the panels; they must not reappear above
the fold. Ex-ante figures (VaR, CVaR, factor tilts, HHI, scenario stress, cap
utilisation) **are** valid on a recommendation — pure functions of weights and
covariance, needing no holding history — and those are what the rows use.

## Consequences

Positive — the check this was written to pass, **no phase route where the block
answering its own question sits below 1000px**:

| route | answer at | row at |
|---|---|---|
| `/mandate` | 466px | 208px |
| `/` | 91px | 154px |
| `/risk` | **576px** (was 2622) | 286px |
| `/book` | 557px | 334px |
| `/execution` | 84px | — |
| `/attribution` | 447px | 188px |
| `/method` | 233px | — |

`/mandate` fell 5.3 → 3.6 screens and 232 → 122 numerals; `/attribution` grew 1.5 →
2.5, which was the point.

Three findings the rows surfaced that nothing had aggregated before:

- **Only 4 of 10 limits are sourced from `scoring_config`** — six fall back to a house
  default. `LimitRow.limitSource` carried this per row and no surface summed it. A cap
  that binds but cannot be attributed is a decision nobody recorded.
- **The same Σ sizes the book and reports its risk.** `covariance_from_returns` feeds
  both the optimizer and the VaR/MC path, so the reported vol is a **lower bound** —
  and μ is shrunk 50% (ADR-0033) while Σ is not shrunk at all. Disclosed on `/risk`'s
  fourth card; the shrinkage itself is separate work.
- **`/` read `narrative_signals` twice** before this change.

Negative / friction:

- `/risk` grew to ~7.7 screens: it gained VaR by method and the row while losing cap
  headroom. Its answer is at the top, but it is now the tallest page.
- **Three labels per phase** (`name`, `tab`, `short`) plus a `question` the rows are
  generated from. Widening a phase's question is now a behavioural change, not an
  editorial one.
- `CorrelationMatrix` lost its measured pair and goes full-width. The comment
  justifying the pairing argues for exactly this in its own words once one side leaves.

## Two mistakes made building it, recorded because both looked right

**929 tests passed with `RiskBody` syntactically broken and every page 500ing.** The
only test touching that file reads it with `readFileSync`, so nothing imports it — tsc
catches this and vitest structurally cannot. The break was a `{/* */}` comment placed
between `&& (` and its element, a position that expects an expression.

**Lifting `useNarrativeSeries` to the page made the fetch count worse, 2 → 6.** A React
hook cannot be called conditionally, so `const own = useNarrativeSeries()` still ran its
effect in both components; the `shared` prop only chose which *result* was displayed and
removed no read. The hook now takes `{ skip }`. Measured again: 2. **The prop alone was
the plausible fix and it was the wrong one.**

## Alternatives considered

**Collapse optional detail behind `<details>`** (goal 7's own remedy). Refused by the
owner. It turned out unnecessary: the moves took `/mandate` from 5.3 to 3.6 screens on
their own.

**Put the worst-case figure on `/risk`'s row.** The obvious first card, and rejected:
`/book` already publishes it and links here, so it would be a second copy of one number
— AnswerRow's own rule and ADR-0084's split-by-section-never-by-copy. `/risk` shows
*both* tails instead, which is new information.

**A down-capture-vs-benchmark card on `/attribution`.** In an earlier draft of the plan
and wrong: tracking error needs 60 sessions and `portfolio_returns` has 6, so it would
render an em-dash. Two em-dashes in a four-card row is a weak answer to a page's own
question. The fourth card reports **sample adequacy itself** — which statistics are
withheld and at what n they unlock — which is the honest answer at n=6 and explains
the blank tiles a reader would otherwise just find.
