# ADR-0056 — An instruction is not a guardrail: check that the declined idea was explained

**Date:** 2026-07-25
**Status:** Accepted
**Relates to:** [0048](0048-count-independent-ideas-not-candidates.md), [0049](0049-the-guardrail-does-not-read-the-prose.md), [0045](0045-turnover-on-names-without-a-verdict.md), [0054](0054-a-daily-publication-not-a-scanner.md)

## Context

Q1 asks for five long and five short trades **"and why"**. The live 2026-07-25 book
holds **5 long and 4 short**, and `/book`'s Pool depth panel states the situation
exactly right:

> Shorts — 11 candidates → 5 independent ideas → 4 held
> The pool held 5 independent ideas and the book took 4. **This side is short of 5 by
> choice, not by constraint** — the agent's reasoning is in the thesis above.

That last clause is false, and it is the defect.

The published thesis reads, in full on this point:

> …Short book fades crowded trades — precious-metals extreme (SLV with gold at
> $4,057.8 against 2.39% real rates), China structural headwinds (BABA, PDD), and
> defense bubble (NOC). **Net directional bias is long given 5 long picks vs 4 short
> picks**…

It **never mentions ARKK**, the one independent short idea it declined. "Net bias is
long given 5 long vs 4 short" *restates* the shortfall; it does not explain it. So the
single panel built to expose the gap points the reader at prose that does not answer
it — and does so in warning colour, which makes it read as a deliberate disclosure
rather than a dead end.

**The instruction already existed.** Since ADR-0048 the prompt has said:

> Returning fewer picks than that count needs a reason stated in book_view; returning
> fewer than five per side when five independent ideas exist is a choice, not a
> constraint.

The model was told, and did not comply, and nothing noticed. **An instruction with no
check is not a guarantee** — which is [ADR-0049](0049-the-guardrail-does-not-read-the-prose.md)'s
lesson generalised from a *number* to a piece of *reasoning*. ADR-0049 established that
`verify_citations` never inspects the prose; this is a second thing living in that same
blind spot, and it is the more consequential one, because the shortfall is the first
question a reviewer asks of a book that answers "five and five" with four.

This is also the third time this project has published a page that asserts something it
had not checked — after the `ClearedNotTaken` overlap verdict (ADR-0045) and the VERIFIED
badge spanning unverified prose (ADR-0049). The recurring shape is not a wrong
calculation; it is **a correct calculation wearing a claim it does not support**.

## Decision

**Measure whether the thesis accounts for the ideas it declined, and let the panel say
which case it is.**

`shortfall_accounting(picks, idea_counts, prose)` returns, for each side that came back
under `min(independent ideas, 5)`:

| field | meaning |
|---|---|
| `held` / `available` | positions taken vs what was reachable |
| `passed_over` | representative ticker per declined independent idea |
| `named` | those the thesis mentions |
| `unexplained` | those it does not |

Three design choices carry the weight:

1. **A complex is declined only when *nothing* in it is held.** Holding the
   second-strongest name still expresses the bet. Representing a complex by its
   `strongest` member alone would report a phantom omission the moment the agent picked
   any other member — the panel would demand an explanation for an idea the book holds.
2. **The target is `min(ideas, 5)`, not 5.** A side with three independent ideas that
   holds three is not short of anything; the pool is the constraint, and that case
   already has its own sentence. Only a side that left reachable ideas on the table is
   asked to account for them.
3. **Ticker matching is word-bounded.** `BILL` contains `BIL`; without a boundary a
   thesis discussing an unrelated name would be credited with explaining a T-bill ETF it
   never took. Pinned by test.

**It does not block the run.** A missing explanation sets no `verified=False` and
triggers no retry. Blocking would risk discarding a good book — with real picks, real
citations and a real thesis — over a missing sentence, and the retry path's terminal
state is the deterministic template book, which contains *no* reasoning at all. Trading
a book with one unexplained omission for a book with no reasoning would make the
deliverable worse in the name of rigour.

**The prompt is strengthened alongside**, because the check tells you the model failed
but does not help it succeed: it must now name each declined idea by the ticker shown in
POOL DEPTH and give a reason per clause, and is told outright that restating the
shortfall is not explaining it, that specific reasons look like *"it would net against a
position already on"*, and that this is checked afterwards and surfaced on the page.

**The panel now branches three ways** instead of asserting one thing:

- **unexplained** — names the declined ideas and says outright that the thesis does not
  say why;
- **explained** — names them and credits the thesis, in neutral rather than warning
  colour, because a justified four is a legitimate answer to Q1;
- **not measured** — for rows written before this ADR. Saying "the reasoning is in the
  thesis" for those would be the same false pointer, only older.

## Consequences

- **`independent_ideas` gains a per-side `shortfall` key**, persisted into the existing
  JSONB column. **No migration** — the shape is additive and the frontend type makes it
  optional, so old rows render the "not measured" branch rather than breaking.
- It is computed at **persist** time, not inside `verify_citations`, because that node
  returns early on failure and **a book that failed verification is exactly the one
  whose reasoning gap matters most**. Wrapped so the measurement can never break the
  book, the same rule `candidate_correlations` follows.
- **The panel can now report against the agent**, which is the point. Its previous
  wording could only ever flatter the thesis; it can now contradict it, on the same page,
  from a measurement rather than an impression.
- **This does not make the book five-and-five**, and must not be mistaken for that. It
  makes a four-short book either *explained* or *visibly unexplained*. Manufacturing a
  fifth short by loosening a threshold remains forbidden (`docs/GOAL.md`); the honest
  routes are a better-reasoned decline or a genuinely deeper pool.
- **Open, and named rather than smuggled:** the check verifies that a declined idea is
  *mentioned*, not that the reason given is *sound*. A thesis saying "ARKK was declined
  because it is Tuesday" passes. Judging the quality of a reason is a different problem
  from detecting its absence, and conflating them would put an unfalsifiable verdict on
  the page — precisely what ADR-0045 refused to do for turnover.
